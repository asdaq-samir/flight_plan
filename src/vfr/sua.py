"""Special-use airspace along a route: prohibited and restricted areas,
MOAs, warning, alert and national-defense areas.

Class B, C and D come from the NASR shapefile (vfr.airspace). Special use
airspace is not in that file, and the planner never looked at it: a
route across P-56 in Washington, or through an active restricted area,
came back with a nav log and no word about it. It comes from the FAA's
own published feature service (ADDS), every area in the country read once
and held a day, since the areas change on the chart cycle.

TFRs are NOTAMs, which this project has no source for; the briefing
already says so and links to a real briefing service.
"""
from __future__ import annotations

import threading

import requests
from cachetools import TTLCache
from shapely.geometry import LineString, Point, shape

from .geo import along_track_distance_nm, corridor_bbox

FEATURE_SERVICE = (
    "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Special_Use_Airspace/FeatureServer/0/query"
)

#: The feature service's TYPE_CODE, in words.
TYPES = {
    "P": "prohibited area",
    "R": "restricted area",
    "MOA": "military operations area",
    "W": "warning area",
    "A": "alert area",
    "D": "danger area",
}

#: The time zone an area's times of use are written in, by the FAA's own
#: fields for it in this data set: GMTOFFSET, the hours from UTC of its
#: standard time, and DST_CODE, "1" where its times move an hour with
#: daylight saving time and "0" where they do not -- as AIXM 5.1's
#: Timesheet has them (timeReference, daylightSavingAdjust), and as the
#: data has them: "-7"/"0" for Arizona's areas, "-10"/"0" for Hawaii's,
#: "-7"/"1" for a Nevada MOA used on "MOUNTAIN TIME". Each pair is named by
#: an IANA zone with that offset and that rule, for the browser's own Intl
#: to read a pass time in. Every US zone that keeps daylight saving time
#: changes on the same days and hour (15 U.S.C. 260a), so any one zone of
#: an offset stands for all of them. A pair not here is no zone: the web
#: then leaves an area's local hours for the pilot to read.
TIME_ZONES = {
    ("-4", "0"): "America/Puerto_Rico",
    ("-5", "1"): "America/New_York",
    ("-6", "1"): "America/Chicago",
    ("-7", "1"): "America/Denver",
    ("-7", "0"): "America/Phoenix",
    ("-8", "1"): "America/Los_Angeles",
    ("-9", "1"): "America/Anchorage",
    ("-10", "1"): "America/Adak",
    ("-10", "0"): "Pacific/Honolulu",
    ("10", "0"): "Pacific/Guam",
}

# Every area in the country, read once a day: asked for round each route,
# a new route's areas were a request to the feature service of 0.3 to 2.5
# s under its altitudes (2026-10-23), where the whole set is 1,542 areas,
# 22 MB, read in half a minute once (`preload`, at the planner's start).
# TTLCache is not thread-safe and the planner asks from its request
# threads, hence the lock.
_CACHE: TTLCache = TTLCache(maxsize=4, ttl=24 * 3600)
_CACHE_LOCK = threading.Lock()
# One download at a time: a second asker waits for it.
_FETCH_LOCK = threading.Lock()
#: The service's most features an answer, paged past.
PAGE = 2000
_FIELDS = ("NAME,TYPE_CODE,UPPER_VAL,UPPER_UOM,UPPER_CODE,LOWER_VAL,LOWER_UOM,LOWER_CODE,"
           "TIMESOFUSE,GMTOFFSET,DST_CODE,CONT_AGENT")


class SpecialUseUnavailable(RuntimeError):
    """The FAA's feature service did not answer."""


def _height_ft(value, uom, code) -> float | None:
    """A floor or ceiling in feet, from the service's value and unit (FT
    or FL); SFC is 0. The reference (MSL or AGL) is reported beside it."""
    if code == "SFC":
        return 0.0
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number * 100 if uom == "FL" else number


def _everything() -> list:
    """Every area's feature with its shape and bounds, [(feature, shape,
    (min_lon, min_lat, max_lon, max_lat))], held a day."""
    with _CACHE_LOCK:
        hit = _CACHE.get("all")
    if hit is not None:
        return hit
    with _FETCH_LOCK:
        with _CACHE_LOCK:
            hit = _CACHE.get("all")
        if hit is not None:
            return hit
        features, offset = [], 0
        while True:
            params = {
                "where": "1=1", "outSR": "4326", "outFields": _FIELDS, "returnGeometry": "true", "f": "geojson",
                "resultOffset": offset, "resultRecordCount": PAGE,
            }
            try:
                resp = requests.get(FEATURE_SERVICE, params=params, timeout=90)
                resp.raise_for_status()
                answer = resp.json()
            except (requests.RequestException, ValueError) as err:
                raise SpecialUseUnavailable(f"the FAA's special-use airspace service did not answer: {err}") from err
            page = answer.get("features", [])
            features += page
            more = answer.get("exceededTransferLimit") or (answer.get("properties") or {}).get("exceededTransferLimit")
            if not more or not page:
                break
            offset += len(page)
        held = []
        for feature in features:
            try:
                geometry = shape(feature["geometry"])
            except (KeyError, TypeError, ValueError, AttributeError):
                continue
            held.append((feature, geometry, geometry.bounds))
        with _CACHE_LOCK:
            _CACHE["all"] = held
        return held


def preload() -> None:
    """Reads every area now, at the planner's start, not under a route."""
    _everything()


def _shapes_in(bbox: tuple) -> list:
    """The areas whose bounds meet bbox (min_lat, min_lon, max_lat,
    max_lon), [(feature, shape)]."""
    min_lat, min_lon, max_lat, max_lon = bbox
    return [
        (feature, geometry) for feature, geometry, (w, s, e, n) in _everything()
        if w <= max_lon and e >= min_lon and s <= max_lat and n >= min_lat
    ]


def _query(bbox: tuple) -> list:
    """GeoJSON features meeting bbox (min_lat, min_lon, max_lat, max_lon)."""
    return [feature for feature, _ in _shapes_in(bbox)]


def along_route(route_start: tuple, route_end: tuple, fixes: list | None = None) -> list:
    """Special-use airspace the route's legs pass laterally through, in
    along-route order: {"name", "type", "kind", "floor_ft", "ceiling_ft",
    "times_of_use", "time_zone", "controlling_agency", "along_track_nm",
    "legs"}, where
    `legs` are the indices of the legs (between consecutive fixes) that
    cross it. One entry per named area, however many polygons it is drawn
    as."""
    path = list(fixes) if fixes and len(fixes) >= 2 else [route_start, route_end]
    boxes = [corridor_bbox(a, b, buffer_nm=2.0) for a, b in zip(path, path[1:])]
    bbox = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    line = LineString([(lon, lat) for lat, lon in path])
    legs = [LineString([(a[1], a[0]), (b[1], b[0])]) for a, b in zip(path, path[1:])]

    found = {}
    for feature, geometry in _shapes_in(bbox):
        props = feature.get("properties") or {}
        if not line.intersects(geometry):
            continue
        name = props.get("NAME") or "(unnamed)"
        crossing = line.intersection(geometry)
        point = crossing.representative_point() if not crossing.is_empty else geometry.representative_point()
        along = round(along_track_distance_nm(point.y, point.x, route_start, route_end), 1)
        crossed = [i for i, leg in enumerate(legs) if leg.intersects(geometry)]
        entry = found.get(name)
        if entry is not None:
            entry["legs"] = sorted(set(entry["legs"]) | set(crossed))
        if entry is None or along < entry["along_track_nm"]:
            found[name] = {
                **_area(props),
                "along_track_nm": along,
                "legs": sorted(set(crossed) | set(entry["legs"] if entry else [])),
            }
    return sorted(found.values(), key=lambda a: a["along_track_nm"])


def _area(props: dict) -> dict:
    """One area's description, from the feature service's fields."""
    type_code = props.get("TYPE_CODE") or ""
    return {
        "name": props.get("NAME") or "(unnamed)",
        "type": type_code,
        "kind": TYPES.get(type_code, type_code.lower() or "special-use airspace"),
        "floor_ft": _height_ft(props.get("LOWER_VAL"), props.get("LOWER_UOM"), props.get("LOWER_CODE")),
        "floor_ref": props.get("LOWER_CODE"),
        "ceiling_ft": _height_ft(props.get("UPPER_VAL"), props.get("UPPER_UOM"), props.get("UPPER_CODE")),
        "ceiling_ref": props.get("UPPER_CODE"),
        "times_of_use": props.get("TIMESOFUSE"),
        "time_zone": time_zone(props.get("GMTOFFSET"), props.get("DST_CODE")),
        "controlling_agency": props.get("CONT_AGENT"),
    }


def time_zone(gmt_offset, dst_code) -> str | None:
    """The IANA zone an area's times of use are read in (TIME_ZONES), from
    the data set's GMTOFFSET and DST_CODE; None where it gives none, or a
    pair no zone here keeps."""
    def text(value) -> str:
        return str(value).strip().lstrip("+") if value is not None else ""
    return TIME_ZONES.get((text(gmt_offset), text(dst_code)))


def areas_in(bbox: tuple) -> list:
    """Every special-use polygon in bbox (min_lat, min_lon, max_lat,
    max_lon) as (area, shapely geometry), an area as at_point's: several
    polygons can share a name."""
    return [(_area(feature.get("properties") or {}), geometry) for feature, geometry in _shapes_in(bbox)]


def at_point(lat: float, lon: float) -> list:
    """The special-use airspace over a point, one entry per named area,
    lowest first: as along_route's, without the route's own fields."""
    point = Point(lon, lat)
    found = {}
    for area, geometry in areas_in((lat, lon, lat, lon)):
        if geometry.contains(point):
            found.setdefault(area["name"], area)
    return sorted(found.values(), key=lambda a: (a["floor_ft"] is None, a["floor_ft"] or 0))


def blocked(altitude_ft: float, areas: list) -> bool:
    """Whether a cruising altitude would enter a prohibited area the
    route crosses: between its floor and ceiling. Cautious where the
    numbers are not MSL: an AGL floor is taken as that many feet MSL
    (lower than it is), and an AGL or missing ceiling as unlimited."""
    for area in areas:
        if area["type"] != "P":
            continue
        floor = area["floor_ft"] if area["floor_ft"] is not None else 0.0
        ceiling = area["ceiling_ft"] if area["ceiling_ft"] is not None and area.get("ceiling_ref") != "AGL" else float("inf")
        if floor <= altitude_ft <= ceiling:
            return True
    return False
