"""Terrain + registered-obstacle floor for a VFR route -- the minimum
altitude a pilot should plan to cruise at, given what's actually on the
ground along the way.

This computes a Maximum Elevation Figure (MEF) for the route, using the
same margin rule FAA sectional charts use for the printed MEF in each
chart quadrangle: a man-made obstacle's height + 100ft (measurement-error
buffer), or natural terrain + 300ft (100ft measurement buffer + 200ft
for unsurveyed vegetation/growth/construction) -- whichever is higher --
rounded up to the next 100ft. The difference from a real chart MEF: this
is computed continuously along the actual route line (every
SAMPLE_INTERVAL_NM), not gridded to a fixed 30-minute quadrangle, so it
doesn't dilute a single tall feature across a whole quadrangle the way
the printed chart figure does.
"""
from pathlib import Path

from . import elevation, faa_data, geo

M_TO_FT = 3.28084

SAMPLE_INTERVAL_NM = 2.0  # how finely to sample terrain along the route
CORRIDOR_HALF_WIDTH_NM = 5.0  # how far off the direct line an obstacle still counts
OBSTACLE_MARGIN_FT = 100  # measurement-error buffer, man-made obstacles
TERRAIN_MARGIN_FT = 300  # measurement-error buffer + unsurveyed vegetation/growth/construction

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
    return max(floor_profile(
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
    """The MEF-style floor of each segment of the route, in feet MSL: one
    per consecutive pair of `breaks_nm` (along-track distances from
    route_start, ascending, from 0 to the route's length -- a nav log's
    fixes, say). The same samples, obstacles and margins as
    min_safe_altitude_msl, read once for the whole route and split by
    along-track distance, so a leg under a low airspace shelf gets its
    own floor rather than the whole route's: that is what lets a nav log
    step down under the shelf and back up past it. Each segment also
    sees one terrain sample beyond either end, and obstacles up to the
    corridor's half-width beyond, so what sits at a boundary counts for
    both legs.
    """
    from itertools import pairwise

    total_nm = geo.distance_nm(*route_start, *route_end)
    sample_points = _route_sample_points(route_start, route_end, sample_interval_nm)
    spacing_nm = total_nm / (len(sample_points) - 1)
    elevations_m = elevation.get_elevations_m(sample_points)
    terrain_ft = [(i * spacing_nm, elevations_m[p] * M_TO_FT) for i, p in enumerate(sample_points)]

    bbox = geo.corridor_bbox(route_start, route_end, buffer_nm=corridor_half_width_nm + 2)
    obstacles = faa_data.load_obstacles(faa_data.ensure_nasr_file("DOF.DAT", faa_cache_dir), bbox, min_agl_ft=0)
    obstacle_ft = [
        (geo.along_track_distance_nm(lat, lon, route_start, route_end), tags["amsl_ft"])
        for lat, lon, tags in zip(obstacles["lat"], obstacles["lon"], obstacles["tags"])
        if abs(geo.cross_track_distance_nm(lat, lon, route_start, route_end)) <= corridor_half_width_nm
    ]

    floors = []
    for a, b in pairwise(breaks_nm):
        terrain_here = [ft for at, ft in terrain_ft if a - spacing_nm <= at <= b + spacing_nm]
        obstacles_here = [
            ft for at, ft in obstacle_ft if a - corridor_half_width_nm <= at <= b + corridor_half_width_nm
        ]
        terrain_mef = max(terrain_here) + TERRAIN_MARGIN_FT
        obstacle_mef = max(obstacles_here) + OBSTACLE_MARGIN_FT if obstacles_here else 0
        floors.append(_round_up_100(max(terrain_mef, obstacle_mef)))
    return floors
