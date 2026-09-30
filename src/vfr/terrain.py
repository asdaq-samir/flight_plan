"""Terrain + registered-obstacle floor for a VFR route -- the minimum
altitude a pilot should plan to cruise at, given what's actually on the
ground along the way.

This is a Maximum Elevation Figure (MEF) for the route, by the rule FAA
sectional charts use for the printed MEF in each chart quadrangle -- a
man-made obstacle's height + 100ft (measurement-error buffer), or natural
terrain plus a margin, whichever is higher, rounded up to the next 100ft
-- except that the terrain margin is 14 CFR 91.119's 1,000 ft, where the
chart's is 300. 91.119 asks 1,000 ft over a congested area (above the
highest obstacle within 2,000 ft) and 500 ft elsewhere, and nothing here
can tell a town from a field, so it keeps the 1,000. The floor used to
be the chart's figure, only 300 ft over the highest ground; the
hemispheric rounding above it hid that, until altitudes within 3,000 ft
of the ground, where the rounding does not apply (vfr.altitude), could
be flown right at it -- at 500 ft, the lowest plan out of C81 flew
1,500 ft over the Chicago suburbs. The other difference from a real
chart MEF: this is
computed continuously along the actual route line (every
SAMPLE_INTERVAL_NM), not gridded to a fixed 30-minute quadrangle, so it
doesn't dilute a single tall feature across a whole quadrangle the way
the printed chart figure does.
"""
from pathlib import Path
from typing import NamedTuple

import numpy as np

from . import elevation, faa_data, geo

M_TO_FT = 3.28084

SAMPLE_INTERVAL_NM = 2.0  # how finely to sample terrain along the route
CORRIDOR_HALF_WIDTH_NM = 5.0  # how far off the direct line an obstacle still counts
OBSTACLE_MARGIN_FT = 100  # measurement-error buffer, man-made obstacles
TERRAIN_MARGIN_FT = 1000  # 14 CFR 91.119(b): 1,000 ft over a congested area

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


class SegmentFloor(NamedTuple):
    """One segment's floor (MSL, the margin rule above), and the lowest
    ground under it (MSL): 3,000 ft above that is where 14 CFR 91.159's
    hemispheric rule begins to apply over the whole segment."""

    floor_ft: float
    lowest_ground_ft: float


def min_safe_altitude_msl(
    route_start: tuple,
    route_end: tuple,
    sample_interval_nm: float = SAMPLE_INTERVAL_NM,
    corridor_half_width_nm: float = CORRIDOR_HALF_WIDTH_NM,
    faa_cache_dir=DEFAULT_FAA_CACHE_DIR,
) -> float:
    """MEF-style floor for the route, in feet MSL -- see module docstring
    for the margin rule.

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

    total_nm = geo.distance_nm(*route_start, *route_end)
    sample_points = _route_sample_points(route_start, route_end, sample_interval_nm)
    spacing_nm = total_nm / (len(sample_points) - 1)
    elevations_m = elevation.get_elevations_m(sample_points)
    sample_along = np.arange(len(sample_points)) * spacing_nm
    terrain_ft = np.array([elevations_m[p] for p in sample_points]) * M_TO_FT

    # Every obstacle in the box placed on the route in one call -- the
    # corridor's thousands of them were two scalar geodesic solutions
    # each, the same azimuth work done twice, most of this function's
    # half a second.
    bbox = geo.corridor_bbox(route_start, route_end, buffer_nm=corridor_half_width_nm + 2)
    obstacles = faa_data.load_obstacles(faa_data.ensure_nasr_file("DOF.DAT", faa_cache_dir), bbox, min_agl_ft=0)
    if len(obstacles):
        cross, along = geo.track_distances_nm(
            obstacles["lat"].to_numpy(dtype=float), obstacles["lon"].to_numpy(dtype=float), route_start, route_end,
        )
        near = np.abs(cross) <= corridor_half_width_nm
        obstacle_along, obstacle_ft = along[near], obstacles["amsl_ft"].to_numpy(dtype=float)[near]
    else:
        obstacle_along = obstacle_ft = np.empty(0)

    floors = []
    for a, b in pairwise(breaks_nm):
        terrain_here = terrain_ft[(sample_along >= a - spacing_nm) & (sample_along <= b + spacing_nm)]
        obstacles_here = obstacle_ft[
            (obstacle_along >= a - corridor_half_width_nm) & (obstacle_along <= b + corridor_half_width_nm)
        ]
        terrain_mef = terrain_here.max() + TERRAIN_MARGIN_FT
        obstacle_mef = obstacles_here.max() + OBSTACLE_MARGIN_FT if obstacles_here.size else 0
        floors.append(SegmentFloor(_round_up_100(max(terrain_mef, obstacle_mef)), float(terrain_here.min())))
    return floors
