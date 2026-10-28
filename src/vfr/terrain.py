"""Terrain + registered-obstacle floor for a VFR route -- the minimum
altitude a pilot should plan to cruise at, given what's actually on the
ground along the way.

The clearances are 14 CFR 91.119's (eCFR, current to 2026-10-22):

  (b) Over congested areas. Over any congested area of a city, town, or
  settlement, or over any open air assembly of persons, an altitude of
  1,000 feet above the highest obstacle within a horizontal radius of
  2,000 feet of the aircraft.

  (c) Over other than congested areas. An altitude of 500 feet above the
  surface, except over open water or sparsely populated areas. In those
  cases, the aircraft may not be operated closer than 500 feet to any
  person, vessel, vehicle, or structure.

The floor is the higher of two figures:

- The ground plus 1,000 ft everywhere (PLANNING_GROUND_MARGIN_FT): the
  owner's planning margin for the altitude plans ("every 500 ft below
  3,000 AGL over a floor 1,000 ft above the ground"), above 91.119(c)'s
  500 ft over open country and equal to (b)'s over a town.
- Each DOF obstacle's top plus 91.119's clearance for where it stands:
  1,000 ft over or within 2,000 ft of a congested area (vfr.congested: the
  Census urban areas and gazetteer places), and 500 ft elsewhere, since
  500 ft from a structure is at least that over its top. Where the towns
  cannot be read, every obstacle takes 1,000 ft, the safer answer.

91.119's own minimum -- the ground or obstacle plus its clearance, with
the ground's 500 ft over open country -- is kept beside the floor (the
SegmentFloor's highest_ft and clearance_ft) for a caution to measure a
pilot's own altitude against: between 500 and 1,000 ft over open fields is
legal, under the planner's floor but not 91.119. Over sparsely populated
land 91.119(c) asks only the 500 ft from structures, not over the surface;
the minimum keeps 500 ft over the surface there as well, the simpler and
safer reading. 91.119(a)'s altitude for a power-off landing "without undue
hazard" has no figure, and is the pilot's.

The floor used to take only 100 ft over a DOF obstacle, the sectional
MEF's measurement buffer: a plan could cross a tower in a town at 100 ft
over its top, where 91.119(b) asks 1,000.

Like a sectional's Maximum Elevation Figure it is the highest of those,
rounded up to the next 100 ft, but computed continuously along the actual
route line (every cell of vfr.ground_grid it crosses, else every
SAMPLE_INTERVAL_NM), not gridded to a fixed 30-minute quadrangle, so it
doesn't dilute a single tall feature across a whole quadrangle the way
the printed chart figure does. It is what the planner suggests, never a
limit: a pilot's own altitude under 91.119's minimum is flown with a
caution (app.planning.floor_caution).
"""
import threading
from pathlib import Path
from typing import NamedTuple

import numpy as np

from . import congested, elevation, faa_data, geo, ground_grid
from .units import M_TO_FT

SAMPLE_INTERVAL_NM = 2.0  # how finely to sample terrain along the route
CORRIDOR_HALF_WIDTH_NM = 5.0  # how far off the direct line an obstacle still counts
#: 14 CFR 91.119(b): 1,000 ft above the highest obstacle within 2,000 ft,
#: over a congested area.
CONGESTED_CLEARANCE_FT = 1000
#: 14 CFR 91.119(c): 500 ft above the surface elsewhere; over open water or
#: sparsely populated areas instead, no closer than 500 ft to any person,
#: vessel, vehicle or structure.
OTHER_CLEARANCE_FT = 500
#: The floor's own margin over the ground, everywhere: the owner's for the
#: altitude plans (a floor 1,000 ft above the ground), over 91.119(c)'s 500.
PLANNING_GROUND_MARGIN_FT = 1000

DEFAULT_FAA_CACHE_DIR = Path(__file__).resolve().parents[2] / "data" / "raw" / "faa_nasr"


def _round_up_100(value: float) -> float:
    import math

    return math.ceil(value / 100) * 100


def _route_sample_points(route_start: tuple, route_end: tuple, interval_nm: float) -> list:
    total_nm = geo.distance_nm(route_start[0], route_start[1], route_end[0], route_end[1])
    bearing = geo.bearing_deg(route_start[0], route_start[1], route_end[0], route_end[1])
    n_samples = max(2, int(total_nm // interval_nm) + 1)
    return [
        geo.destination_point(route_start[0], route_start[1], bearing, d)
        for d in (i * total_nm / (n_samples - 1) for i in range(n_samples))
    ]


# The route's ground, read once however many ask for it at the same time:
# the planner reads it ahead as a route is entered (app.prefetch) and its
# altitude selection may ask while that read is still going -- each one
# reading every point from USGS's EPQS, a few seconds a point, was two
# full reads at once. A second caller waits for the first and is answered
# from the disk cache it filled (vfr.elevation).
_READING: dict[tuple, threading.Event] = {}
_READING_LOCK = threading.Lock()
# Longer than any one read takes, so a stuck one is not waited on forever.
_READ_WAIT_S = 120


def _elevations_m(points: list) -> dict:
    key = tuple((round(lat, 5), round(lon, 5)) for lat, lon in points)
    with _READING_LOCK:
        running = _READING.get(key)
        if running is None:
            done = _READING[key] = threading.Event()
    if running is not None:
        running.wait(_READ_WAIT_S)
        return elevation.get_elevations_m(points)
    try:
        return elevation.get_elevations_m(points)
    finally:
        with _READING_LOCK:
            del _READING[key]
        done.set()


class SegmentFloor(NamedTuple):
    """One segment's floor (MSL, the clearances above), and the lowest
    ground under it (MSL): 3,000 ft above that is where 14 CFR 91.159's
    hemispheric rule begins to apply over the whole segment.

    And 14 CFR 91.119's own minimum there, for a caution to measure a
    pilot's altitude against: the ground or the DOF obstacle whose top
    plus 91.119's clearance is highest, its height MSL, the obstacle's DOF
    type (TOWER, BLDG ...), that clearance, and whether it is for a
    congested area (91.119(b)) -- None where the towns could not be read
    and it took the 1,000 ft anyway. The floor is at or above it: the
    ground takes the planner's 1,000 ft everywhere."""

    floor_ft: float
    lowest_ground_ft: float
    highest_ft: float | None = None
    highest_is_obstacle: bool | None = None
    obstacle_type: str | None = None
    clearance_ft: float | None = None
    congested: bool | None = None


def min_safe_altitude_msl(
    route_start: tuple,
    route_end: tuple,
    sample_interval_nm: float = SAMPLE_INTERVAL_NM,
    corridor_half_width_nm: float = CORRIDOR_HALF_WIDTH_NM,
    faa_cache_dir=DEFAULT_FAA_CACHE_DIR,
) -> float:
    """MEF-style floor for the route, in feet MSL -- see module docstring
    for the clearances.

    Terrain is sampled at fixed intervals along the direct route line
    (reusing geo.destination_point the same way vfr.elevation's ring
    sampling does) via vfr.elevation.get_elevations_m -- already
    batched/cached/parallel, so this is just handing it a new list of
    points. Obstacles come from vfr.faa_data.load_obstacles, restricted
    to corridor_half_width_nm of the direct line (a wider corridor than
    the tight pilotage corridor used elsewhere in this project, since
    terrain/obstacle awareness should tolerate some lateral track
    deviation) -- their FAA-reported AMSL height is used directly rather
    than combining a separately-sampled terrain point with obstacle AGL,
    since the DOF data already gives the obstacle's true top elevation.
    """
    total_nm = geo.distance_nm(*route_start, *route_end)
    return max(segment.floor_ft for segment in floor_profile(
        route_start, route_end, [0.0, total_nm], sample_interval_nm, corridor_half_width_nm, faa_cache_dir,
    ))


def floor_profile(
    route_start: tuple,
    route_end: tuple,
    breaks_nm: list,
    sample_interval_nm: float = SAMPLE_INTERVAL_NM,
    corridor_half_width_nm: float = CORRIDOR_HALF_WIDTH_NM,
    faa_cache_dir=DEFAULT_FAA_CACHE_DIR,
) -> list:
    """The MEF-style floor of each segment of the route, in feet MSL, with
    the lowest ground under it (SegmentFloor): one per consecutive pair
    of `breaks_nm` (along-track distances from route_start, ascending,
    from 0 to the route's length -- a nav log's fixes, say). The same
    samples, obstacles and margins as min_safe_altitude_msl, read once
    for the whole route and split by along-track distance, so a leg
    under a low airspace shelf gets its own floor rather than the whole
    route's: that is what lets a nav log step down under the shelf and
    back up past it. Each segment also sees one terrain sample beyond
    either end, and obstacles up to the corridor's half-width beyond, so
    what sits at a boundary counts for both legs.
    """
    from itertools import pairwise

    # The ground from the built grid where it covers the route (vfr.
    # ground_grid): every cell the line crosses, its highest ground for the
    # floor and its lowest for the lowest ground under it, in a few array
    # reads; else points along the line read off the tiles, as before.
    lats, lons, along = ground_grid.line_points(route_start, route_end)
    read = ground_grid.ground_ft(lats, lons)
    if read is not None:
        terrain_ft, terrain_low_ft = read
        sample_along = along
        spacing_nm = float(along[1] - along[0]) if len(along) > 1 else 0.0
    else:
        total_nm = geo.distance_nm(*route_start, *route_end)
        sample_points = _route_sample_points(route_start, route_end, sample_interval_nm)
        spacing_nm = total_nm / (len(sample_points) - 1)
        elevations_m = _elevations_m(sample_points)
        sample_along = np.arange(len(sample_points)) * spacing_nm
        terrain_ft = terrain_low_ft = np.array([elevations_m[p] for p in sample_points]) * M_TO_FT
        lats = np.array([p[0] for p in sample_points])
        lons = np.array([p[1] for p in sample_points])

    # Every obstacle in the box placed on the route in one call -- the
    # corridor's thousands of them were two scalar geodesic solutions
    # each, the same azimuth work done twice, most of this function's
    # half a second.
    bbox = geo.corridor_bbox(route_start, route_end, buffer_nm=corridor_half_width_nm + 2)
    obstacles = faa_data.load_obstacles(faa_data.ensure_nasr_file("DOF.DAT", faa_cache_dir), bbox, min_agl_ft=0)
    if len(obstacles):
        obstacle_lats = obstacles["lat"].to_numpy(dtype=float)
        obstacle_lons = obstacles["lon"].to_numpy(dtype=float)
        cross, along = geo.track_distances_nm(obstacle_lats, obstacle_lons, route_start, route_end)
        near = np.abs(cross) <= corridor_half_width_nm
        obstacle_along, obstacle_ft = along[near], obstacles["amsl_ft"].to_numpy(dtype=float)[near]
        obstacle_lats, obstacle_lons = obstacle_lats[near], obstacle_lons[near]
        obstacle_types = obstacles["type"].to_numpy(dtype=object)[near] if "type" in obstacles else np.full(near.sum(), None)
    else:
        obstacle_along = obstacle_ft = obstacle_lats = obstacle_lons = np.empty(0)
        obstacle_types = np.empty(0, dtype=object)

    # The ground under the line and each obstacle near it, over a town or
    # not (vfr.congested), one read for both, for 91.119's clearances: where
    # the towns cannot be read, all of it is taken as congested -- 91.119(b)'s
    # 1,000 ft, the safer answer -- and said to be unknown (None). The
    # floor's own 1,000 ft over the ground is added after, whatever this says.
    over_town = congested.congested(np.concatenate([lats, obstacle_lats]), np.concatenate([lons, obstacle_lons]))
    known = over_town is not None
    if over_town is None:
        over_town = np.ones(len(lats) + len(obstacle_lats), dtype=bool)
    clearance = np.where(over_town, CONGESTED_CLEARANCE_FT, OTHER_CLEARANCE_FT).astype(float)
    terrain_clearance, obstacle_clearance = clearance[:len(lats)], clearance[len(lats):]

    floors = []
    for a, b in pairwise(breaks_nm):
        here = np.flatnonzero((sample_along >= a - spacing_nm) & (sample_along <= b + spacing_nm))
        there = np.flatnonzero(
            (obstacle_along >= a - corridor_half_width_nm) & (obstacle_along <= b + corridor_half_width_nm))
        ground_need = terrain_ft[here] + terrain_clearance[here]
        i = int(here[np.argmax(ground_need)])
        bound = (float(terrain_ft[i]), False, None, float(terrain_clearance[i]))
        if there.size:
            obstacle_need = obstacle_ft[there] + obstacle_clearance[there]
            j = int(there[np.argmax(obstacle_need)])
            # The obstacle where it needs more than the ground, the ground
            # on a tie: the ground is under the airplane the whole way.
            if obstacle_need.max() > ground_need.max():
                kind = obstacle_types[j]
                bound = (float(obstacle_ft[j]), True, kind.strip() or None if isinstance(kind, str) else None,
                         float(obstacle_clearance[j]))
        highest, is_obstacle, kind, need = bound
        floor = max(float(terrain_ft[here].max()) + PLANNING_GROUND_MARGIN_FT, highest + need)
        floors.append(SegmentFloor(
            _round_up_100(floor), float(terrain_low_ft[here].min()),
            highest_ft=round(highest), highest_is_obstacle=is_obstacle, obstacle_type=kind, clearance_ft=need,
            congested=(need == CONGESTED_CLEARANCE_FT) if known else None,
        ))
    return floors
