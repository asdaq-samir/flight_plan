"""Temporary flight restrictions: the FAA's own, from tfr.faa.gov.

The shapes are the site's GeoServer layer (TFR:V_TFR_LOC), one polygon
per area of each NOTAM, with its title and kind ("HAZARDS", "SECURITY",
"VIP", "SPACE OPERATIONS", "AIR SHOWS/SPORTS", "UAS PUBLIC GATHERING").
What a pilot needs besides -- when it is in force, how high it reaches,
why, under which rule -- is in each NOTAM's own XNOTAM file
(detail_6_6654.xml), read once per NOTAM and modification.

A NOTAM's times in that file are UTC whatever time zone it names (the
zone is the one its text gives the times in). Its areas' floors and
ceilings are MSL ("ALT"), above the ground ("HEI") or a flight level
(feet "FL"); a NOTAM of several areas is given as the lowest floor and
the highest ceiling of them.
"""
from __future__ import annotations

import json
import logging
import math
import threading
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import requests
import wingtip_native
from cachetools import LRUCache, TTLCache
from shapely.geometry import LineString, Point, shape

# The site turns away a bare python-requests User-Agent, as the FAA's
# others do (wingtip.faa_data).
from .config import FAA_HEADERS as HEADERS
from .geo import along_track_distance_nm

log = logging.getLogger(__name__)

SHAPES_URL = (
    "https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature"
    "&typeName=TFR:V_TFR_LOC&outputFormat=application/json"
)
DETAIL_URL = "https://tfr.faa.gov/download/detail_{}.xml"

#: How long the shapes are held: the site updates them every few minutes.
SHAPES_TTL_S = 10 * 60
#: After tfr.faa.gov fails to answer, how long before it is asked again:
#: every map pan and briefing in an outage must not wait on a time-out.
RETRY_AFTER_S = 60
#: How near the route a TFR is listed with it: a pilot plans round one,
#: not along its edge.
NEAR_NM = 5.0
_NM_PER_DEG = 60.0

# The rules a TFR is issued under, named for a pilot, are the engine's
# (wingtip_engine::tfr's RULES), with the rest of its detail.

_SHAPES: TTLCache = TTLCache(maxsize=1, ttl=SHAPES_TTL_S)
_DETAILS: LRUCache = LRUCache(maxsize=1024)
_LOCK = threading.Lock()
#: When the shapes held were fetched from tfr.faa.gov (UNIX seconds), for
#: the map to say how old its TFRs are; None before the first fetch.
_FETCHED_AT: float | None = None
#: The last list tfr.faa.gov gave, kept past SHAPES_TTL_S for when it
#: does not answer: a momentary outage then shows the TFRs known a few
#: minutes ago, their age said (fetched_at), rather than a sky with none.
_HELD: list | None = None
#: Not before this (UNIX seconds) is tfr.faa.gov asked again after a failure.
_RETRY_AT = 0.0
# Whether the last ask failed: the held list is then what is served.
_FAILING = False


class TfrUnavailable(RuntimeError):
    """tfr.faa.gov did not answer."""


def _shapes() -> list:
    """Every TFR area's GeoJSON feature, held SHAPES_TTL_S, and the last
    list fetched served on while tfr.faa.gov does not answer (asked again
    after RETRY_AFTER_S); TfrUnavailable only where none was ever had."""
    global _FETCHED_AT, _HELD, _RETRY_AT, _FAILING
    with _LOCK:
        hit = _SHAPES.get("all")
        if hit is not None:
            return hit
        if _HELD is not None and time.time() < _RETRY_AT:
            return _HELD
    try:
        resp = requests.get(SHAPES_URL, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        features = resp.json().get("features", [])
    except (requests.RequestException, ValueError) as err:
        with _LOCK:
            _RETRY_AT = time.time() + RETRY_AFTER_S
            _FAILING = True
            held, fetched = _HELD, _FETCHED_AT
        if held is not None:
            log.warning("tfr.faa.gov did not answer (%s); serving the TFRs fetched %.0f minutes ago",
                        err, (time.time() - (fetched or time.time())) / 60)
            return held
        raise TfrUnavailable(f"tfr.faa.gov did not answer: {err}") from err
    with _LOCK:
        _SHAPES["all"] = features
        _HELD = features
        _FETCHED_AT = time.time()
        _FAILING = False
    return features


def _ended(detail: dict, now: datetime) -> bool:
    """Whether a TFR's NOTAM has passed its expiry: a TFR is in force only
    from its effective to its expiry time, as its NOTAM gives them (AIM
    3-5-3; 14 CFR 91.137-91.145). One with no expiry is until further
    notice."""
    expires = detail.get("expires")
    if not expires:
        return False
    try:
        return datetime.fromisoformat(expires.replace("Z", "+00:00")) < now
    except ValueError:
        return False


def failing() -> bool:
    """Whether the last ask of tfr.faa.gov failed, the list held before
    served on in its place (for the pilot's Status page)."""
    return _FAILING


def fetched_at() -> float | None:
    """When the TFRs the map is drawn from were fetched (UNIX seconds),
    None before the first fetch."""
    return _FETCHED_AT


def parse_detail(xml_bytes: bytes) -> dict:
    """What a NOTAM's XNOTAM file says a pilot needs: {"effective",
    "expires" (ISO UTC; None until further notice), "rule", "purpose",
    "floor_ft", "floor_ref", "ceiling_ft", "ceiling_ref"} -- the lowest
    floor and the highest ceiling over its areas, a flight level in feet
    MSL. Read by the engine (wingtip_engine::tfr), the phones' same code;
    a file that is not XML raises ElementTree's ParseError, as it did."""
    try:
        got = wingtip_native.tfr_detail_json(xml_bytes.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError) as e:
        raise ET.ParseError(str(e)) from e
    if got is None:
        return {}
    detail = json.loads(got)
    for key in ("floor_ft", "ceiling_ft"):
        if detail[key] is not None:
            detail[key] = float(detail[key])
    return detail


def _detail(notam_id: str, modified: str) -> dict:
    """A NOTAM's detail, read once per modification; nothing where its
    file cannot be had (the shape and title still stand)."""
    key = (notam_id, modified)
    with _LOCK:
        hit = _DETAILS.get(key)
    if hit is not None:
        return hit
    try:
        resp = requests.get(DETAIL_URL.format(notam_id.replace("/", "_")), headers=HEADERS, timeout=20)
        resp.raise_for_status()
        detail = parse_detail(resp.content)
    except (requests.RequestException, ET.ParseError):
        return {}
    with _LOCK:
        _DETAILS[key] = detail
    return detail


def all_tfrs() -> list:
    """Every TFR in force or to come, one per NOTAM: {"notam_id", "title",
    "kind", "state", "geometry" (GeoJSON, a MultiPolygon of its areas)}
    and its detail (parse_detail), the details read eight at a time."""
    by_notam: dict = {}
    for feature in _shapes():
        props = feature.get("properties") or {}
        notam_id = (props.get("NOTAM_KEY") or "").split("-")[0]
        if not notam_id or not feature.get("geometry"):
            continue
        entry = by_notam.setdefault(notam_id, {
            "notam_id": notam_id, "title": props.get("TITLE"), "kind": (props.get("LEGAL") or "").title() or None,
            "state": props.get("STATE"), "modified": props.get("LAST_MODIFICATION_DATETIME") or "", "polygons": [],
        })
        geometry = feature["geometry"]
        entry["polygons"].extend([geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"])
    entries = list(by_notam.values())
    with ThreadPoolExecutor(max_workers=8) as pool:
        details = list(pool.map(lambda e: _detail(e["notam_id"], e["modified"]), entries))
    # A list held through an outage may name TFRs that have since expired,
    # which the site's own list would no longer carry: those are left out.
    # One issued since cannot be known; the map says how old the list is.
    held = _FETCHED_AT is not None and time.time() - _FETCHED_AT >= SHAPES_TTL_S
    now = datetime.now(timezone.utc)
    return [
        {**{k: v for k, v in e.items() if k not in ("polygons", "modified")},
         "geometry": {"type": "MultiPolygon", "coordinates": e["polygons"]}, **detail}
        for e, detail in zip(entries, details)
        if not (held and _ended(detail, now))
    ]


def in_force(tfr: dict, start: datetime, end: datetime) -> bool:
    """Whether a TFR is in force at any time from `start` to `end` (UTC):
    one with no times is taken as in force. The engine's window
    (pass_times.rs, `gonogo_hazard_window`), with no margin."""
    def at(key: str) -> float | None:
        return datetime.fromisoformat(tfr[key].replace("Z", "+00:00")).timestamp() if tfr.get(key) else None
    when = json.loads(wingtip_native.call("gonogo_hazard_window", json.dumps({
        "enter": start.timestamp(), "leave": end.timestamp(), "valid_from": at("effective"), "valid_to": at("expires"),
        "margin_min": 0})))
    return when not in ("before", "after")


def along_route(path: list, start: datetime, end: datetime, near_nm: float = NEAR_NM) -> list:
    """The TFRs within `near_nm` of a route flown through `path` [(lat,
    lon)], in force at some time from `start` to `end`, in along-route
    order: each of all_tfrs()'s, with "along_track_nm", how far along it
    is, "crosses", whether the route goes through it, and "active_now"."""
    line = LineString([(lon, lat) for lat, lon in path])
    # Degrees of buffer, as many as `near_nm` of longitude at the route's
    # latitude, which are the more: a little generous north and south.
    mid_lat = sum(lat for lat, _ in path) / len(path)
    buffer_deg = near_nm / _NM_PER_DEG / max(0.2, math.cos(math.radians(mid_lat)))
    near = line.buffer(buffer_deg)
    now = datetime.now(timezone.utc)
    found = []
    for tfr in all_tfrs():
        try:
            geometry = shape(tfr["geometry"])
        except (KeyError, TypeError, ValueError):
            continue
        if not near.intersects(geometry) or not in_force(tfr, start, end):
            continue
        point = geometry.representative_point()
        found.append({
            **tfr,
            "along_track_nm": round(along_track_distance_nm(point.y, point.x, path[0], path[-1]), 1),
            "crosses": line.intersects(geometry),
            "active_now": in_force(tfr, now, now),
        })
    return sorted(found, key=lambda t: t["along_track_nm"])


def at_point(lat: float, lon: float) -> list:
    """The TFRs in force or to come over a point: each of all_tfrs()'s,
    with "active_now"."""
    point = Point(lon, lat)
    now = datetime.now(timezone.utc)
    found = []
    for tfr in all_tfrs():
        try:
            geometry = shape(tfr["geometry"])
        except (KeyError, TypeError, ValueError):
            continue
        if geometry.contains(point):
            found.append({**tfr, "active_now": in_force(tfr, now, now)})
    return found
