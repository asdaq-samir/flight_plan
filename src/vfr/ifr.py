"""IFR cruising altitudes and fuel: the minimum IFR altitude over each
leg, the cruising altitudes the direction of flight allows above it, and
the IFR fuel reserve.

The minimum altitude is 14 CFR 91.177(a)(2)'s, the one for a course with
no altitude published for it in Parts 95 and 97 -- a direct or GPS
route, which is what the planner flies until the airways and their MEAs
and MOCAs come in: 1,000 ft above the highest obstacle within 4 nm of
the course, 2,000 ft over a mountainous area Part 95 designates (95.11
to 95.21). The obstacles are the FAA's Digital Obstacle File and the
ground itself, read off USGS 3DEP heights by way of the terrain tiles
vfr.elevation already uses (Terrain Tiles on AWS, zoom 12, about 38 m a
pixel): every pixel within the 4 nm, not samples along the line, since
a summit 3 nm off course counts as much as one under it.

The cruising altitudes are 14 CFR 91.179(b)'s in uncontrolled airspace
and FAA Order JO 7110.65's (para 4-5-2, TBL 4-5-1) as ATC assigns them in
controlled: odd thousands on a magnetic course of 000 to 179, even on
180 to 359, flight levels the same from 18,000 ft, every 2,000 ft up to
FL410 where RVSM applies (91.179(b)(4)).
"""
from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor
from typing import NamedTuple

import numpy as np
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union
from shapely.prepared import prep

from . import elevation, faa_data, geo
from .retry import with_retries
from .terrain import DEFAULT_FAA_CACHE_DIR
from .units import M_TO_FT

#: 14 CFR 91.177(a)(2): the highest obstacle within 4 nm of the course.
OBSTACLE_RADIUS_NM = 4.0
#: 91.177(a)(2)(ii): 1,000 ft above it ...
CLEARANCE_FT = 1000.0
#: ... and (i): 2,000 ft over a mountainous area Part 95 designates.
MOUNTAINOUS_CLEARANCE_FT = 2000.0

#: 14 CFR 91.167(a)(3): after the alternate (or the destination, where
#: 91.169 asks for none), 45 minutes at normal cruising speed -- an
#: airplane's; a helicopter's is 30.
RESERVE_MIN = 45.0

#: The terrain tiles' zoom: 76 m a pixel, and within 20 ft of the
#: published summits of Rainier (14,396 ft against 14,411), Whitney
#: (14,486 against 14,505), Mitchell (6,671 against 6,684) and Pikes Peak
#: (14,117 against 14,115), measured 2026-10-11 as the highest pixel
#: within half a mile of each -- zoom 12's 38 m pixels came within 15 ft,
#: for four times the tiles: a 90 nm leg in the Rockies took 18 s to
#: read at 12.
TILE_ZOOM = 11
#: What is added to the tiles' highest ground before its clearance, so a
#: summit the pixels shave a few feet off is never undercounted.
TILE_ALLOWANCE_FT = 50.0
#: A leg is measured in pieces no longer than this, each flat on its own
#: (equirectangular about its middle), a few metres off the true distance
#: from the course at 4 nm out; and each piece reads only the tiles beside
#: it, where a long diagonal leg's whole box was hundreds of tiles of
#: ground nowhere near it (C81 to KDLH: 30 s, its tiles already on disk).
PIECE_NM = 10.0
#: Feet in the hundred the floor is rounded up to.
ROUND_FT = 100

# FAA Order JO 7110.65 TBL 4-5-1 and 91.179(b)(4): every 2,000 ft by the
# direction of flight up to FL410 in RVSM airspace (all of the US's
# domestic airspace from FL290 to FL410).
TOP_FT = 41000.0


def _dms(deg: int, minutes: int) -> float:
    return deg + minutes / 60


def _ring(points: list[tuple[float, float]]) -> Polygon:
    """A polygon from (lat, lon) points; shapely's own order is (x, y),
    (lon, lat)."""
    return Polygon([(lon, lat) for lat, lon in points])


# The mountainous areas, 14 CFR Part 95 subpart B, in (lat, lon), west
# longitudes negative. Where Part 95 runs a boundary along a border or a
# coastline the polygon below runs past it instead -- into Canada or
# Mexico or out to sea -- which keeps every part of the United States
# the rule names in, and adds only ground outside it; where an exception
# runs along one, its polygon takes the straight line inside it, which
# can only leave some of the exception mountainous: 2,000 ft where 1,000
# would do, never the other way.
_EASTERN = _ring([
    # 95.13(a): from 47°10'N 67°55'W "west and south along the Canadian
    # border" to 45°00'N 74°15'W -- run north of the border here.
    (_dms(47, 10), -_dms(67, 55)), (48.5, -_dms(67, 55)), (48.5, -71.0), (45.5, -74.25),
    (_dms(45, 0), -_dms(74, 15)), (_dms(44, 20), -_dms(75, 30)), (_dms(43, 5), -_dms(75, 30)),
    (_dms(42, 57), -_dms(77, 30)), (_dms(42, 52), -_dms(78, 42)), (_dms(42, 26), -_dms(79, 13)),
    (_dms(42, 5), -_dms(80, 0)), (_dms(40, 50), -_dms(80, 0)), (_dms(40, 26), -_dms(79, 54)),
    (_dms(38, 25), -_dms(81, 46)), (_dms(36, 0), -_dms(86, 0)), (_dms(33, 37), -_dms(86, 45)),
    (_dms(32, 30), -_dms(86, 25)), (_dms(33, 22), -_dms(85, 0)), (_dms(36, 35), -_dms(79, 20)),
    (_dms(40, 11), -_dms(76, 24)), (_dms(41, 24), -_dms(74, 30)), (_dms(41, 43), -_dms(72, 40)),
    (_dms(42, 13), -_dms(72, 44)), (_dms(43, 12), -_dms(71, 30)), (_dms(43, 45), -_dms(70, 30)),
    (_dms(45, 0), -_dms(69, 30)),
])
# 95.13(b): the Hudson, Champlain and Mohawk valleys.
_EASTERN_EXCEPTION = _ring([
    (_dms(45, 0), -_dms(73, 26)), (_dms(44, 32), -_dms(73, 4)), (_dms(42, 51), -_dms(73, 41)),
    (_dms(41, 38), -_dms(73, 46)), (_dms(41, 16), -_dms(73, 50)), (_dms(41, 17), -_dms(74, 0)),
    (_dms(41, 25), -_dms(73, 58)), (_dms(41, 26), -_dms(74, 1)), (_dms(41, 37), -_dms(73, 58)),
    (_dms(42, 41), -_dms(73, 55)), (_dms(43, 2), -_dms(76, 15)), (_dms(43, 17), -_dms(75, 21)),
    (_dms(42, 59), -_dms(74, 43)), (_dms(42, 52), -_dms(73, 53)), (_dms(44, 30), -_dms(73, 18)),
    (_dms(45, 0), -_dms(73, 39)),
])
_WESTERN = _ring([
    # 95.15(a): west of this line, "from the Pacific coastline ... along
    # the Canadian and Mexican borders" -- run out past both, and to sea.
    (_dms(49, 0), -_dms(108, 0)), (_dms(46, 45), -_dms(104, 0)), (_dms(44, 6), -_dms(103, 15)),
    (_dms(43, 0), -_dms(103, 15)), (_dms(41, 52), -_dms(103, 39)), (_dms(35, 11), -_dms(103, 39)),
    (_dms(33, 17), -_dms(104, 27)), (_dms(32, 17), -_dms(104, 14)), (_dms(29, 48), -_dms(102, 0)),
    (25.0, -102.0), (25.0, -130.0), (50.0, -130.0), (50.0, -108.0),
])
# 95.15(b)(1): California's Central Valley.
_CENTRAL_VALLEY = _ring([
    (_dms(35, 25), -_dms(119, 9)), (_dms(35, 29), -_dms(118, 58)), (_dms(36, 49), -_dms(119, 37)),
    (_dms(38, 30), -_dms(121, 24)), (_dms(39, 30), -_dms(121, 32)), (_dms(40, 8), -_dms(122, 8)),
    (_dms(40, 6), -_dms(122, 20)), (_dms(39, 5), -_dms(122, 12)), (_dms(38, 1), -_dms(121, 51)),
    (_dms(37, 37), -_dms(121, 12)), (_dms(37, 0), -_dms(120, 58)), (_dms(36, 14), -_dms(120, 11)),
])
# 95.15(b)(2): Puget Sound, its run "north and east along the United
# States and Canada boundary" taken straight, inside the boundary.
_PUGET_SOUND = _ring([
    (_dms(49, 0), -_dms(122, 21)), (_dms(48, 34), -_dms(122, 21)), (_dms(48, 8), -_dms(122, 0)),
    (_dms(47, 12), -_dms(122, 0)), (_dms(46, 59), -_dms(122, 13)), (_dms(46, 52), -_dms(122, 16)),
    (_dms(46, 50), -_dms(122, 40)), (_dms(46, 35), -_dms(122, 48)), (_dms(46, 35), -_dms(123, 17)),
    (_dms(47, 15), -_dms(123, 17)), (_dms(47, 41), -_dms(122, 54)), (_dms(48, 3), -_dms(122, 48)),
    (_dms(48, 17), -_dms(123, 15)),
])
# 95.17: the State of Alaska, all of it here, in a box that takes in some
# of Canada beside it: its seven exceptions (the Fairbanks-Nenana,
# Anchorage-Homer and North Slope areas among them) are left
# mountainous, 2,000 ft where Part 95 asks 1,000. West of 180° too, for
# the Aleutians.
_ALASKA = unary_union([box(-180.0, 51.0, -129.9, 72.0), box(172.0, 51.0, 180.0, 56.0)])
# 95.19: Kauai, Oahu, Molokai, Lanai, Kahoolawe, Maui and Hawaii, and the
# water between them here.
_HAWAII = box(-159.9, 18.8, -154.7, 22.3)
# 95.21: Puerto Rico's.
_PUERTO_RICO = _ring([
    (_dms(18, 22), -_dms(66, 58)), (_dms(18, 19), -_dms(66, 6)), (_dms(18, 20), -_dms(65, 50)),
    (_dms(18, 20), -_dms(65, 42)), (_dms(18, 3), -_dms(65, 52)), (_dms(18, 2), -_dms(65, 51)),
    (_dms(17, 59), -_dms(65, 55)), (_dms(18, 5), -_dms(66, 57)), (_dms(18, 11), -_dms(67, 7)),
])

MOUNTAINOUS = unary_union([
    _EASTERN.difference(_EASTERN_EXCEPTION),
    _WESTERN.difference(_CENTRAL_VALLEY).difference(_PUGET_SOUND),
    _ALASKA, _HAWAII, _PUERTO_RICO,
])
_MOUNTAINOUS = prep(MOUNTAINOUS)


def mountainous(lat: float, lon: float) -> bool:
    """Whether a point is in a designated mountainous area (14 CFR Part 95
    subpart B), as drawn above."""
    return _MOUNTAINOUS.contains(Point(lon, lat))


def over_mountainous(a: tuple, b: tuple) -> bool:
    """Whether a course from a to b crosses a designated mountainous area
    anywhere along it: its 2,000 ft then holds for the whole leg."""
    return _MOUNTAINOUS.intersects(LineString([(a[1], a[0]), (b[1], b[0])]))


def cruising_altitudes(floor_ft: float, ceiling_ft: float | None, course_magnetic_deg: float) -> list[float]:
    """Every IFR cruising altitude for the course from the floor up to the
    ceiling, ascending: odd thousands (and odd flight levels) on a
    magnetic course of 000 to 179, even on 180 to 359 -- 14 CFR 91.179(b)
    (1), (2) and (4), and FAA Order JO 7110.65 TBL 4-5-1 -- to FL410.
    Empty where the first one above the floor is above the ceiling."""
    odd = 0 <= course_magnetic_deg % 360 < 180
    thousands = max(1, math.ceil(floor_ft / 1000))
    if (thousands % 2 == 1) != odd:
        thousands += 1
    top = TOP_FT if ceiling_ft is None else min(TOP_FT, ceiling_ft)
    return [float(t * 1000) for t in range(thousands, int(top // 1000) + 1, 2)]


class LegFloor(NamedTuple):
    """One leg's minimum IFR altitude (14 CFR 91.177(a)(2)), with what it
    was found from: the highest obstacle within 4 nm, ground or a DOF
    obstacle, its height, and whether the leg is over a mountainous area.
    Or, on an airway, its published MEA (91.177(a)(1)), `airway` its
    segment's published altitudes and the rest None."""

    floor_ft: float
    highest_ft: float | None
    highest_is_obstacle: bool | None
    mountainous: bool | None
    airway: dict | None = None


def published_floor(airway: dict) -> float | None:
    """An airway segment's minimum IFR altitude (14 CFR 91.177(a)(1)): its
    MEA, or its GNSS MEA where it publishes no other (a T route's)."""
    return airway.get("mea_ft") or airway.get("gnss_mea_ft")


def published_floors(legs: int, airway: dict) -> list[LegFloor]:
    """Each leg of a hop flown along an airway segment: its MEA."""
    return [LegFloor(float(published_floor(airway)), None, None, None, airway) for _ in range(legs)]


def _pixel_lat_lon(z: int, x: int, y: int, size: int) -> tuple[np.ndarray, np.ndarray]:
    """Each pixel's centre in a slippy-map tile, as (lat, lon) grids."""
    within = (np.arange(size) + 0.5) / size
    lats, lons = geo.tile_lat_lon(within + x, within + y, z)
    return np.meshgrid(lats, lons, indexing="ij")


def _tiles_over(bbox: tuple, z: int) -> list[tuple[int, int]]:
    """The tiles at zoom z that cover (min_lat, min_lon, max_lat, max_lon)."""
    min_lat, min_lon, max_lat, max_lon = bbox
    x0, y0 = (int(v) for v in geo.tile_xy(max_lat, min_lon, z))
    x1, y1 = (int(v) for v in geo.tile_xy(min_lat, max_lon, z))
    return [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]


def _from_course_nm(lat, lon, a: tuple, b: tuple):
    """Each point's distance from the course a to b (a segment: its ends
    rounded, as "within 4 nm of the course" takes the ends too), in nm,
    on a flat plane about the segment's middle."""
    lat0 = (a[0] + b[0]) / 2
    k = math.cos(math.radians(lat0)) * 60.0

    def plane(p_lat, p_lon):
        return (np.asarray(p_lon) - a[1]) * k, (np.asarray(p_lat) - a[0]) * 60.0

    px, py = plane(lat, lon)
    bx, by = plane(b[0], b[1])
    length2 = float(bx * bx + by * by)
    t = np.clip((px * bx + py * by) / length2, 0.0, 1.0) if length2 else np.zeros_like(px)
    return np.hypot(px - t * bx, py - t * by)


def _pieces(a: tuple, b: tuple) -> list[tuple[tuple, tuple]]:
    """The course a to b in pieces of at most PIECE_NM, along its great circle."""
    total = geo.distance_nm(*a, *b)
    count = max(1, math.ceil(total / PIECE_NM))
    bearing = geo.bearing_deg(*a, *b)
    points = [a] + [geo.destination_point(*a, bearing, total * i / count) for i in range(1, count)] + [b]
    return list(zip(points, points[1:]))


def _tiles_beside(piece: tuple) -> list[tuple[int, int]]:
    """The tiles that hold the ground within OBSTACLE_RADIUS_NM of a piece."""
    (a, b) = piece
    reach_lat = (OBSTACLE_RADIUS_NM + 1) / 60.0
    reach_lon = reach_lat / max(0.2, math.cos(math.radians(max(abs(a[0]), abs(b[0])))))
    return _tiles_over((min(a[0], b[0]) - reach_lat, min(a[1], b[1]) - reach_lon,
                        max(a[0], b[0]) + reach_lat, max(a[1], b[1]) + reach_lon), TILE_ZOOM)


def _highest_ground_ft(pieces: list, heights: dict) -> float:
    """The highest ground within OBSTACLE_RADIUS_NM of any piece, feet
    MSL: each tile's pixels against the pieces beside it alone."""
    beside: dict[tuple[int, int], list] = {}
    for piece in pieces:
        for tile in _tiles_beside(piece):
            beside.setdefault(tile, []).append(piece)
    highest = -math.inf
    # The highest tiles first, and none whose highest pixel is no higher
    # than the ground already found: the same answer, from a handful of
    # tiles rather than every pixel of hundreds (a 600 nm route's floor
    # was three seconds of pixel distances, 2026-10-21).
    by_top = sorted(beside.items(), key=lambda item: -float(heights[item[0]].max()))
    for (x, y), near_pieces in by_top:
        tile = heights[(x, y)]
        if float(tile.max()) * M_TO_FT <= highest:
            break
        lats, lons = _pixel_lat_lon(TILE_ZOOM, x, y, tile.shape[0])
        near = np.zeros(tile.shape, dtype=bool)
        for a, b in near_pieces:
            near |= _from_course_nm(lats, lons, a, b) <= OBSTACLE_RADIUS_NM
        if near.any():
            highest = max(highest, float(tile[near].max()) * M_TO_FT)
    return highest


#: Tiles fetched at once: more, and Docker's resolver gave up on some of
#: them (2026-10-11, sixteen at once, "Temporary failure in name
#: resolution").
TILE_WORKERS = 8


def _tile(xy: tuple[int, int]) -> np.ndarray:
    """One tile's heights, fetched again after a failure: it is the floor,
    and a route without one cannot be planned under IFR at all."""
    return with_retries(lambda: elevation._terrain_tile(TILE_ZOOM, *xy), describe=f"terrain tile {xy}", backoff_s=1.0)


def floor_profile(fixes: list, faa_cache_dir=DEFAULT_FAA_CACHE_DIR) -> list[LegFloor]:
    """Each leg's minimum IFR altitude (14 CFR 91.177(a)(2)) between the
    nav log's fixes: the highest obstacle within 4 nm of its course --
    the ground (TILE_ALLOWANCE_FT added) or a DOF obstacle's top -- plus
    1,000 ft, 2,000 over a mountainous area, rounded up to the next
    100 ft."""
    legs = list(zip(fixes, fixes[1:]))
    leg_pieces = [_pieces(a, b) for a, b in legs]
    reach_deg = (OBSTACLE_RADIUS_NM + 1) / 60.0
    wanted = sorted({tile for pieces in leg_pieces for piece in pieces for tile in _tiles_beside(piece)})
    with ThreadPoolExecutor(max_workers=min(TILE_WORKERS, max(1, len(wanted)))) as pool:
        heights = dict(zip(wanted, pool.map(_tile, wanted)))

    lats = [p[0] for p in fixes]
    lons = [p[1] for p in fixes]
    bbox = (min(lats) - reach_deg, min(lons) - 2 * reach_deg, max(lats) + reach_deg, max(lons) + 2 * reach_deg)
    obstacles = faa_data.load_obstacles(faa_data.ensure_nasr_file("DOF.DAT", faa_cache_dir), bbox, min_agl_ft=0)
    obstacle_lat = obstacles["lat"].to_numpy(dtype=float)
    obstacle_lon = obstacles["lon"].to_numpy(dtype=float)
    obstacle_ft = obstacles["amsl_ft"].to_numpy(dtype=float)

    floors = []
    for (a, b), pieces in zip(legs, leg_pieces):
        ground_ft = _highest_ground_ft(pieces, heights) + TILE_ALLOWANCE_FT
        near = np.zeros(obstacle_ft.shape, dtype=bool)
        for p, q in pieces:
            near |= _from_course_nm(obstacle_lat, obstacle_lon, p, q) <= OBSTACLE_RADIUS_NM
        tallest_ft = float(obstacle_ft[near].max()) if near.any() else -math.inf
        highest_ft = max(ground_ft, tallest_ft)
        over = over_mountainous(a, b)
        clearance = MOUNTAINOUS_CLEARANCE_FT if over else CLEARANCE_FT
        floors.append(LegFloor(
            floor_ft=float(math.ceil((highest_ft + clearance) / ROUND_FT) * ROUND_FT),
            highest_ft=round(highest_ft),
            highest_is_obstacle=tallest_ft >= ground_ft,
            mountainous=over,
        ))
    return floors
