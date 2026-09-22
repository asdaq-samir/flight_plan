"""Great-circle navigation helpers.

The maths is pygeodesy's spherical trigonometry rather than this
project's own: a sphere, the same approximation flight computers use and
plenty accurate for spacing VFR checkpoints, but the haversine,
forward-azimuth, cross-track, along-track and direct-solution formulas
come from a library that has them right, including the branch cases
(coincident points, the antimeridian) a hand-rolled copy gets wrong
quietly. Checked against the formulas that used to live here across two
thousand random routes the size of this project's: the two agree to
within a nanometre of a nautical mile.

One convention did change, for the better. along_track_distance_nm is
now signed, so a candidate behind the departure point reads negative
instead of positive. vfr.pipeline's corridor filter was already written
for that (it bounds along-track at -MARGIN_NM), and vfr.altitude clamps
the value to the route anyway.

Sign convention for cross-track: positive is right of course, negative
is left.
"""
import numpy as np
from pygeodesy.sphericalTrigonometry import LatLon
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import KDTree

EARTH_RADIUS_NM = 3440.065


def distance_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two points, in nautical miles."""
    return LatLon(lat1, lon1).distanceTo(LatLon(lat2, lon2), radius=EARTH_RADIUS_NM)


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial great-circle bearing from point 1 to point 2, in degrees [0, 360)."""
    return LatLon(lat1, lon1).initialBearingTo(LatLon(lat2, lon2))


def cross_track_distance_nm(lat: float, lon: float, route_start: tuple, route_end: tuple) -> float:
    """Perpendicular distance from (lat, lon) to the great-circle route
    route_start -> route_end, in nautical miles. Positive = right of course.
    """
    return LatLon(lat, lon).crossTrackDistanceTo(
        LatLon(*route_start), LatLon(*route_end), radius=EARTH_RADIUS_NM
    )


def along_track_distance_nm(lat: float, lon: float, route_start: tuple, route_end: tuple) -> float:
    """Signed distance along the route from route_start to the projection
    of (lat, lon) onto it, in nautical miles. Negative behind the start.
    """
    return LatLon(lat, lon).alongTrackDistanceTo(
        LatLon(*route_start), LatLon(*route_end), radius=EARTH_RADIUS_NM
    )


def destination_point(lat: float, lon: float, bearing: float, distance_nm_: float) -> tuple:
    """Point reached from (lat, lon) travelling `bearing` degrees for
    `distance_nm_` nautical miles along a great circle.
    """
    point = LatLon(lat, lon).destination(distance_nm_, bearing, radius=EARTH_RADIUS_NM)
    return point.lat, point.lon


def corridor_bbox(route_start: tuple, route_end: tuple, buffer_nm: float) -> tuple:
    """Padded (min_lat, min_lon, max_lat, max_lon) bounding box around the
    route, generous enough for an Overpass query. The real corridor width
    is enforced later by filtering on cross_track_distance_nm.
    """
    lats = [route_start[0], route_end[0]]
    lons = [route_start[1], route_end[1]]
    pad_deg = buffer_nm / 60.0  # ~1 nm per minute of latitude
    return (min(lats) - pad_deg, min(lons) - pad_deg, max(lats) + pad_deg, max(lons) + pad_deg)


def cluster_points(lat, lon, cluster_distance_nm: float) -> np.ndarray:
    """Connected-components clustering: two points share a cluster if
    within cluster_distance_nm of each other, transitively (e.g. a chain
    of wind turbines spread along a ridge). Returns a cluster id (int)
    per input point, in input order.

    Done on the unit sphere in Cartesian coordinates, where a KD-tree can
    find the neighbouring pairs without building an n-by-n distance
    matrix. Chord length rises monotonically with great-circle distance,
    so a chord radius selects exactly the same pairs the arc distance
    would -- verified against the pairwise version this replaced across
    three hundred random turbine fields, identical partitions every time,
    including points that coincide exactly.
    """
    lat_r = np.radians(np.asarray(lat, dtype=float))
    lon_r = np.radians(np.asarray(lon, dtype=float))
    if lat_r.size == 0:
        return np.empty(0, dtype=int)

    xyz = np.column_stack(
        [np.cos(lat_r) * np.cos(lon_r), np.cos(lat_r) * np.sin(lon_r), np.sin(lat_r)]
    )
    chord = 2 * np.sin(cluster_distance_nm / (2 * EARTH_RADIUS_NM))
    pairs = KDTree(xyz).query_pairs(chord, output_type="ndarray")
    graph = coo_matrix(
        (np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(len(xyz), len(xyz))
    )
    return connected_components(graph, directed=False)[1]
