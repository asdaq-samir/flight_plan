"""Where a route is over a congested area, for the terrain floor's
clearances (vfr.terrain), which 14 CFR 91.119 sets by it:

  (b) Over congested areas. Over any congested area of a city, town, or
  settlement, or over any open air assembly of persons, an altitude of
  1,000 feet above the highest obstacle within a horizontal radius of
  2,000 feet of the aircraft.

  (c) Over other than congested areas. An altitude of 500 feet above the
  surface, except over open water or sparsely populated areas. In those
  cases, the aircraft may not be operated closer than 500 feet to any
  person, vessel, vehicle, or structure.

(eCFR, Title 14, current to 2026-10-22.) 14 CFR 1.1 does not define a
congested area; the FAA judges it case by case. So the towns are read
from two Census Bureau data sets, both the US government's and public
domain, and anything either of them names counts:

- The 2020 Census urban areas (cartographic boundary file
  cb_2020_us_ua20_corrected_500k, the 2023 correction): every built-up
  area of 5,000 people or 2,000 housing units and more, drawn round its
  houses rather than its town line.
- The places in the Census gazetteer vfr.geocode already keeps (every
  incorporated place and census-designated place, 2025): the villages
  under the urban areas' threshold, which 91.119(b)'s "settlement" still
  takes in. The gazetteer gives a point and a land area, not an outline,
  so each is a circle of that area round its point, at most
  PLACE_RADIUS_M -- a place's land can be a whole county (Greeley County,
  Kansas), and only its core is built on.

Neither knows an open air assembly of persons (a fair, a race), which is
the pilot's to see. Where the data cannot be had, nothing can be ruled
out, and the caller takes every point as congested: 91.119(b)'s 1,000 ft,
the safer answer.
"""
from __future__ import annotations

import logging
import math
import threading
import time
from pathlib import Path

import numpy as np
import requests
import shapely

from . import geocode
from .units import M_PER_NM

logger = logging.getLogger(__name__)

DIR = Path(__file__).resolve().parents[2] / "data" / "raw" / "census"
#: The Census Bureau's own file, pinned to the 2020 urban areas, so a later
#: delineation cannot move a town's edge under a kept answer.
URBAN_AREAS_URL = "https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_ua20_corrected_500k.zip"
URBAN_AREAS_PATH = DIR / "cb_2020_us_ua20_corrected_500k.zip"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; wingtip-maps/0.1; terrain floor)"}
#: 14 CFR 91.119(b): the obstacles that count over a congested area are
#: those "within a horizontal radius of 2,000 feet of the aircraft". An
#: airplane over the edge of a town is that close to whatever stands that
#: far outside it, so a point this near a town counts as over it.
RADIUS_FT = 2000.0
#: The largest circle a gazetteer place is drawn as, m: a nautical mile,
#: the planner's own figure -- about the built-up core of a small town.
PLACE_RADIUS_M = M_PER_NM
#: A degree of latitude: sixty nautical miles of 6,076.12 ft, near enough
#: (the earth's flattening moves it under 1% from the equator to the pole).
FT_PER_DEG_LAT = 60 * 6076.12
M_PER_DEG_LAT = 60 * M_PER_NM
#: After a failed download, the next try waits this long.
RETRY_AFTER_S = 300

_LOCK = threading.Lock()
_HELD: dict = {}
_RETRY_AT = 0.0


def _urban_areas() -> list:
    """The urban areas' outlines, downloaded once and kept."""
    if not URBAN_AREAS_PATH.exists():
        resp = requests.get(URBAN_AREAS_URL, headers=HEADERS, timeout=60)
        resp.raise_for_status()
        DIR.mkdir(parents=True, exist_ok=True)
        part = URBAN_AREAS_PATH.with_suffix(".part")
        part.write_bytes(resp.content)
        part.replace(URBAN_AREAS_PATH)
    import shapefile
    from shapely.geometry import shape

    with shapefile.Reader(str(URBAN_AREAS_PATH)) as reader:
        return [shape(s.__geo_interface__) for s in reader.iterShapes()]


def _places() -> list:
    """Each gazetteer place as a circle of its land area, at most
    PLACE_RADIUS_M, in degrees round its point (east-west scaled by its
    latitude). Empty where the gazetteer cannot be had."""
    towns = geocode._towns()
    if not towns:
        return []
    lats = np.array([t[2] for t in towns], dtype=float)
    lons = np.array([t[3] for t in towns], dtype=float)
    radius_m = np.minimum(np.sqrt(np.array([t[4] for t in towns], dtype=float) / math.pi), PLACE_RADIUS_M)
    # A circle in degrees of latitude, stretched east-west by the latitude's
    # cosine: a degree of longitude is that much shorter. Sixteen sides,
    # all the places at once.
    r_lat = np.maximum(radius_m, 1.0) / M_PER_DEG_LAT
    r_lon = r_lat / np.maximum(0.2, np.cos(np.radians(lats)))
    angle = np.linspace(0.0, 2 * math.pi, 17)
    ring = np.stack([lons[:, None] + r_lon[:, None] * np.cos(angle), lats[:, None] + r_lat[:, None] * np.sin(angle)], axis=-1)
    ring[:, -1] = ring[:, 0]
    return list(shapely.polygons(ring))


def _tree() -> shapely.STRtree | None:
    """Every congested area, in one tree; None where either data set could
    not be had (both are needed to rule a point out)."""
    global _RETRY_AT
    with _LOCK:
        if "tree" in _HELD:
            return _HELD["tree"]
        if time.monotonic() < _RETRY_AT:
            return None
        try:
            areas = _urban_areas()
        except (requests.RequestException, OSError, ValueError) as err:
            logger.warning("No Census urban areas, every point taken as congested: %s", err)
            _RETRY_AT = time.monotonic() + RETRY_AFTER_S
            return None
        places = _places()
        if not places:
            logger.warning("No Census gazetteer of places, every point taken as congested")
            _RETRY_AT = time.monotonic() + RETRY_AFTER_S
            return None
        _HELD["tree"] = shapely.STRtree(areas + places)
        return _HELD["tree"]


def preload() -> None:
    """Read the towns now, not on the first route's ask."""
    _tree()


def congested(lats, lons) -> np.ndarray | None:
    """Whether each point is over a congested area or within RADIUS_FT of
    one; None where that cannot be told (the data could not be had), for
    the caller to take every point as congested."""
    lats = np.asarray(lats, dtype=float)
    lons = np.asarray(lons, dtype=float)
    if lats.size == 0:
        return np.zeros(0, dtype=bool)
    tree = _tree()
    if tree is None:
        return None
    points = shapely.points(lons, lats)
    found = np.zeros(lats.size, dtype=bool)
    # Inside one first: the candidates by their boxes, then each town's
    # own points against its outline at once, the outline prepared on its
    # first use. The tree's own "intersects" tested each point against a
    # whole city's outline unprepared, 80 ms of a route over Chicago.
    by_box, area = tree.query(points)
    for j in np.unique(area).tolist():
        mine = by_box[area == j]
        outline = tree.geometries[j]
        if not shapely.is_prepared(outline):
            shapely.prepare(outline)
        found[mine[shapely.contains_xy(outline, lons[mine], lats[mine])]] = True
    # Then those outside within 2,000 ft of one: first by a distance in
    # degrees that is never short of 2,000 ft any way (a degree of
    # longitude is shorter than one of latitude by the latitude's cosine),
    # then each of those few measured on its own, the town's edge near it
    # scaled east-west by its own latitude's cosine -- so an obstacle
    # 2,100 ft north of a town is not counted as within 2,000.
    widest = max(0.2, math.cos(math.radians(min(89.0, float(np.abs(lats).max())))))
    reach = RADIUS_FT / FT_PER_DEG_LAT / widest
    rest = np.flatnonzero(~found)
    if rest.size:
        near_point, near_area = tree.query(points[rest], predicate="dwithin", distance=reach)
        if near_point.size:
            near = _within(tree.geometries[near_area], lats[rest][near_point], lons[rest][near_point], reach)
            found[rest[near_point[near]]] = True
    return found


def _within(areas, lats, lons, reach: float) -> np.ndarray:
    """Whether each of `areas` comes within RADIUS_FT of its own point
    (lats, lons): its part near the point, east-west scaled by the cosine
    of the point's latitude.

    Every pair at once: one at a time, a clip, a transform and a distance
    each in Python, it was most of a cold route's terrain floor -- the
    thousands of DOF obstacles round Chicago and Milwaukee each measured
    on their own (py-spy on the live planner, 2026-10-28), each of its
    calls letting the interpreter go and waiting to have it back from the
    planner's other threads. Now the clip alone is one a pair; the moving,
    scaling and measuring are done for all of them at once. The same GEOS
    calls on the same numbers, so the same answer to the bit: the cosine
    is still math's, one a point, as it was."""
    lats = np.asarray(lats, dtype=float)
    lons = np.asarray(lons, dtype=float)
    # GEOS's clip one pair at a time: shapely.clip_by_rect takes one
    # rectangle a call (2.2 refuses arrays of them, and the ufunc under it
    # in 2.1 answered wrong given arrays: tried, and the equality tests in
    # tests/test_congested.py failed), and the same clip keeps the same
    # answer at the 2,000 ft edge, where an intersection with a box might not.
    pieces = np.array([shapely.clip_by_rect(area, lon - reach, lat - reach, lon + reach, lat + reach)
                       for area, lat, lon in zip(areas, lats.tolist(), lons.tolist())], dtype=object)
    scale = np.array([max(0.2, math.cos(math.radians(lat))) for lat in lats.tolist()])
    xy, which = shapely.get_coordinates(pieces, return_index=True)
    flat = shapely.set_coordinates(
        pieces.copy(), (xy - np.stack([lons, lats], axis=1)[which]) * np.stack([scale, np.ones_like(scale)], axis=1)[which])
    near = shapely.distance(flat, shapely.Point(0.0, 0.0)) * FT_PER_DEG_LAT <= RADIUS_FT
    return near & ~shapely.is_empty(pieces)
