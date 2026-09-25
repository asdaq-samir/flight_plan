"""Special-use airspace along a route: prohibited and restricted areas,
MOAs, warning, alert and national-defense areas.

Class B, C and D come from the NASR shapefile (vfr.airspace). Special use
airspace is not in that file, and the planner never looked at it: a
route across P-56 in Washington, or through an active restricted area,
came back with a nav log and no word about it. It comes from the FAA's
own published feature service (ADDS), asked for the polygons around the
route and held a day, since the areas change on the chart cycle.

TFRs are NOTAMs, which this project has no source for; the briefing
already says so and links to a real briefing service.
"""
from __future__ import annotations

import requests
from cachetools import TTLCache
from shapely.geometry import LineString, shape

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

_CACHE_TTL_S = 24 * 3600
_CACHE = TTLCache(maxsize=256, ttl=_CACHE_TTL_S)


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


def _query(bbox: tuple) -> list:
    """GeoJSON features intersecting bbox (min_lat, min_lon, max_lat,
    max_lon), cached a day per bbox rounded to a tenth of a degree."""
    key = tuple(round(v, 1) for v in bbox)
    if key in _CACHE:
        return _CACHE[key]
    min_lat, min_lon, max_lat, max_lon = key
    params = {
        "where": "1=1",
        "geometry": f"{min_lon - 0.1},{min_lat - 0.1},{max_lon + 0.1},{max_lat + 0.1}",
        "geometryType": "esriGeometryEnvelope", "inSR": "4326", "outSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "NAME,TYPE_CODE,UPPER_VAL,UPPER_UOM,UPPER_CODE,LOWER_VAL,LOWER_UOM,LOWER_CODE,TIMESOFUSE,CONT_AGENT",
        "returnGeometry": "true", "f": "geojson",
    }
    try:
        resp = requests.get(FEATURE_SERVICE, params=params, timeout=30)
        resp.raise_for_status()
        features = resp.json().get("features", [])
    except (requests.RequestException, ValueError) as err:
        raise SpecialUseUnavailable(f"the FAA's special-use airspace service did not answer: {err}") from err
    _CACHE[key] = features
    return features


def along_route(route_start: tuple, route_end: tuple, fixes: list | None = None) -> list:
    """Special-use airspace the route's legs pass laterally through, in
    along-route order: {"name", "type", "kind", "floor_ft", "ceiling_ft",
    "times_of_use", "controlling_agency", "along_track_nm", "legs"}, where
    `legs` are the indices of the legs (between consecutive fixes) that
    cross it. One entry per named area, however many polygons it is drawn
    as."""
    path = list(fixes) if fixes and len(fixes) >= 2 else [route_start, route_end]
    boxes = [corridor_bbox(a, b, buffer_nm=2.0) for a, b in zip(path, path[1:])]
    bbox = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    line = LineString([(lon, lat) for lat, lon in path])
    legs = [LineString([(a[1], a[0]), (b[1], b[0])]) for a, b in zip(path, path[1:])]

    found = {}
    for feature in _query(bbox):
        props = feature.get("properties") or {}
        try:
            geometry = shape(feature["geometry"])
        except (KeyError, TypeError, ValueError):
            continue
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
            type_code = props.get("TYPE_CODE") or ""
            found[name] = {
                "name": name,
                "type": type_code,
                "kind": TYPES.get(type_code, type_code.lower() or "special-use airspace"),
                "floor_ft": _height_ft(props.get("LOWER_VAL"), props.get("LOWER_UOM"), props.get("LOWER_CODE")),
                "floor_ref": props.get("LOWER_CODE"),
                "ceiling_ft": _height_ft(props.get("UPPER_VAL"), props.get("UPPER_UOM"), props.get("UPPER_CODE")),
                "ceiling_ref": props.get("UPPER_CODE"),
                "times_of_use": props.get("TIMESOFUSE"),
                "controlling_agency": props.get("CONT_AGENT"),
                "along_track_nm": along,
                "legs": sorted(set(crossed) | set(entry["legs"] if entry else [])),
            }
    return sorted(found.values(), key=lambda a: a["along_track_nm"])


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
