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

import math
import threading
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import requests
from cachetools import LRUCache, TTLCache
from shapely.geometry import LineString, shape

from .geo import along_track_distance_nm

SHAPES_URL = (
    "https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature"
    "&typeName=TFR:V_TFR_LOC&outputFormat=application/json"
)
DETAIL_URL = "https://tfr.faa.gov/download/detail_{}.xml"
# The site turns away a bare python-requests User-Agent, as the FAA's
# others do (vfr.faa_data).
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; vfr-route-learning-project/0.1)"}

#: How long the shapes are held: the site updates them every few minutes.
SHAPES_TTL_S = 10 * 60
#: How near the route a TFR is listed with it: a pilot plans round one,
#: not along its edge.
NEAR_NM = 5.0
_NM_PER_DEG = 60.0

#: The rule each kind of TFR is issued under, in words.
RULES = {
    "91.137(a)(1)": "disaster or hazard (91.137(a)(1))",
    "91.137(a)(2)": "relief aircraft operations (91.137(a)(2))",
    "91.137(a)(3)": "disaster or hazard (91.137(a)(3))",
    "91.138": "national disaster in Hawaii (91.138)",
    "91.139": "emergency air traffic rules (91.139)",
    "91.141": "VIP movement (91.141)",
    "91.143": "space operations (91.143)",
    "91.144": "high barometric pressure (91.144)",
    "91.145": "aerial demonstration or sporting event (91.145)",
    "99.7": "special security instructions (99.7)",
    "44812": "unmanned aircraft near a public gathering",
}

_SHAPES: TTLCache = TTLCache(maxsize=1, ttl=SHAPES_TTL_S)
_DETAILS: LRUCache = LRUCache(maxsize=1024)
_LOCK = threading.Lock()


class TfrUnavailable(RuntimeError):
    """tfr.faa.gov did not answer."""


def _shapes() -> list:
    """Every TFR area's GeoJSON feature, held SHAPES_TTL_S."""
    with _LOCK:
        hit = _SHAPES.get("all")
    if hit is not None:
        return hit
    try:
        resp = requests.get(SHAPES_URL, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        features = resp.json().get("features", [])
    except (requests.RequestException, ValueError) as err:
        raise TfrUnavailable(f"tfr.faa.gov did not answer: {err}") from err
    with _LOCK:
        _SHAPES["all"] = features
    return features


def _utc(text: str | None) -> str | None:
    """An XNOTAM time (UTC, no zone) as ISO 8601 with its Z."""
    if not text:
        return None
    try:
        return datetime.fromisoformat(text).replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
    except ValueError:
        return None


def _sentence(text: str | None) -> str | None:
    """A NOTAM's words as a sentence: in capitals they are made lower
    case after the first letter; otherwise kept as written."""
    text = (text or "").strip()
    if not text:
        return None
    return text.capitalize() if text.isupper() else text


def _height(area, side: str) -> tuple[float | None, str | None]:
    """An area's floor ("Lower") or ceiling ("Upper") in feet, and MSL or
    AGL; a flight level in feet, MSL."""
    value, uom, code = (area.findtext(f"{k}DistVer{side}") for k in ("val", "uom", "code"))
    try:
        feet = float(value) * (100 if uom == "FL" else 1)
    except (TypeError, ValueError):
        return None, None
    return feet, "AGL" if code == "HEI" else "MSL"


def parse_detail(xml_bytes: bytes) -> dict:
    """What a NOTAM's XNOTAM file says a pilot needs: {"effective",
    "expires" (ISO UTC; None until further notice), "rule", "purpose",
    "floor_ft", "floor_ref", "ceiling_ft", "ceiling_ref"}."""
    root = ET.fromstring(xml_bytes)
    notam = root.find(".//Not")
    if notam is None:
        return {}
    rule_code = (root.findtext(".//TfrNot/codeType") or "").strip()
    floors, ceilings = [], []
    for area in root.iter("aseTFRArea"):
        floor, ceiling = _height(area, "Lower"), _height(area, "Upper")
        if floor[0] is not None:
            floors.append(floor)
        if ceiling[0] is not None:
            ceilings.append(ceiling)
    floor = min(floors, key=lambda h: h[0]) if floors else (None, None)
    ceiling = max(ceilings, key=lambda h: h[0]) if ceilings else (None, None)
    return {
        "effective": _utc(notam.findtext("dateEffective")),
        "expires": _utc(notam.findtext("dateExpire")),
        "rule": RULES.get(rule_code, rule_code or None),
        "purpose": _sentence(notam.findtext("txtDescrPurpose")),
        "floor_ft": floor[0], "floor_ref": floor[1],
        "ceiling_ft": ceiling[0], "ceiling_ref": ceiling[1],
    }


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
    return [
        {**{k: v for k, v in e.items() if k not in ("polygons", "modified")},
         "geometry": {"type": "MultiPolygon", "coordinates": e["polygons"]}, **detail}
        for e, detail in zip(entries, details)
    ]


def in_force(tfr: dict, start: datetime, end: datetime) -> bool:
    """Whether a TFR is in force at any time from `start` to `end` (UTC):
    one with no times is taken as in force."""
    effective = datetime.fromisoformat(tfr["effective"].replace("Z", "+00:00")) if tfr.get("effective") else None
    expires = datetime.fromisoformat(tfr["expires"].replace("Z", "+00:00")) if tfr.get("expires") else None
    return (effective is None or effective <= end) and (expires is None or expires >= start)


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
