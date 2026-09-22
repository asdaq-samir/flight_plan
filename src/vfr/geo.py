"""Great-circle navigation helpers.

A sphere, the same approximation flight computers use and plenty
accurate for spacing VFR checkpoints. The distance and forward-azimuth
solutions are PROJ's, through pyproj, rather than this project's own:
one `Geod` configured as a sphere whose radius is given in nautical
miles, so PROJ works in the unit the answers are wanted in and nothing
here converts.

Two things follow from PROJ doing it, and both matter.

It is fast, scalar and in bulk. A single call costs about a microsecond
-- less than the hand-written haversine that used to be here -- and an
array of points costs about 0.6 microseconds each, in C, with no Python
loop. Every function below therefore takes scalars or arrays
interchangeably, and the callers that work a whole corridor at a time
(vfr.pipeline's corridor filter, vfr.osm's crossing finder,
vfr.features' clutter measure) pass arrays. An earlier version of this
module went through an object-per-call library and made those callers
fifty times more expensive; this is the fix, and it leaves them faster
than they were before either change.

And it is somebody else's implementation, which is the point of not
hand-rolling the formulas. The two that PROJ does not provide --
cross-track and along-track distance, which are the standard spherical
identities on top of an azimuth and a distance -- are written here, and
tests/test_geo.py pins every function in this file against pygeodesy's
independent implementations. pygeodesy is a test dependency only
(requirements-dev.txt): it guards the maths without shipping in any
service image.

Sign convention for cross-track: positive is right of course, negative
is left. Along-track is negative behind the route start.
"""
import numpy as np
from pyproj import Geod
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import KDTree

EARTH_RADIUS_NM = 3440.065

# A sphere (f=0), sized in nautical miles, so inv() returns nautical
# miles directly. PROJ treats `a` as whatever unit it is given.
_GEOD = Geod(a=EARTH_RADIUS_NM, f=0.0)

# isinstance against a tuple, not np.ndim: the scalar path is the one
# the nav log takes a few hundred times per plan, and np.ndim on a
# plain float costs more than the PROJ call it is guarding.
_NUMBER = (int, float, np.integer, np.floating)


def _inv(lat1, lon1, lat2, lon2):
    """(forward azimuth in degrees [0, 360), distance in nm) from point
    one to point two.

    Scalars in, scalars out, on PROJ's own scalar path -- about a
    microsecond. Otherwise every argument is broadcast to one shape,
    since PROJ requires all four arrays the same length and the usual
    call here is one route start against a whole corridor of points.
    """
    if isinstance(lat1, _NUMBER) and isinstance(lon1, _NUMBER) \
            and isinstance(lat2, _NUMBER) and isinstance(lon2, _NUMBER):
        azimuth, _, distance = _GEOD.inv(lon1, lat1, lon2, lat2)
        return azimuth % 360.0, distance

    shape = np.broadcast_shapes(np.shape(lat1), np.shape(lon1), np.shape(lat2), np.shape(lon2))
    # broadcast_to gives a read-only view and PROJ wants writable,
    # contiguous buffers, so this copies rather than views.
    lon1, lat1, lon2, lat2 = (
        np.ascontiguousarray(np.broadcast_to(np.asarray(v, dtype=float), shape))
        for v in (lon1, lat1, lon2, lat2)
    )
    azimuth, _, distance = _GEOD.inv(lon1, lat1, lon2, lat2)
    return np.mod(azimuth, 360.0), distance


def _plain(value):
    """A numpy 0-d result back to a plain float. Everything downstream --
    a nav log serialised to JSON, a Pydantic response model -- is
    happier with a float than with a numpy scalar, and an array result
    passes through untouched."""
    return float(value) if isinstance(value, _NUMBER) else value


def distance_nm(lat1, lon1, lat2, lon2):
    """Great-circle distance between two points, in nautical miles."""
    return _inv(lat1, lon1, lat2, lon2)[1]


def bearing_deg(lat1, lon1, lat2, lon2):
    """Initial great-circle bearing from point 1 to point 2, in degrees
    [0, 360).

    Zero for two points that coincide. The bearing between a point and
    itself is undefined and PROJ answers 180, which would give a
    zero-length leg of a nav log a due-south course; zero is what this
    project has always reported and what vfr.navlog's callers expect.
    """
    azimuth, distance = _inv(lat1, lon1, lat2, lon2)
    if isinstance(distance, _NUMBER):
        return 0.0 if distance == 0.0 else azimuth
    return np.where(distance == 0.0, 0.0, azimuth)


def _track(lat, lon, route_start, route_end):
    """(cross-track, along-track) in nautical miles, both signed.

    The standard spherical identities, given the bearing and distance
    from the route's start to the point and to the route's end:

        xtd = asin(sin(d13/R) * sin(t13 - t12)) * R
        atd = acos(cos(d13/R) / cos(xtd/R)) * R, signed by cos(t13 - t12)

    The sign on the along-track is what makes a point behind the
    departure read negative, which vfr.pipeline's corridor filter
    depends on -- it bounds along-track at -MARGIN_NM, a bound an
    unsigned value could never cross.
    """
    start_lat, start_lon = route_start
    end_lat, end_lon = route_end
    bearing_to_point, distance_to_point = _inv(start_lat, start_lon, lat, lon)
    bearing_to_end, _ = _inv(start_lat, start_lon, end_lat, end_lon)

    angular = distance_to_point / EARTH_RADIUS_NM
    offset = np.radians(bearing_to_point - bearing_to_end)
    cross = np.arcsin(np.clip(np.sin(angular) * np.sin(offset), -1.0, 1.0)) * EARTH_RADIUS_NM
    ratio = np.cos(angular) / np.cos(cross / EARTH_RADIUS_NM)
    along = np.arccos(np.clip(ratio, -1.0, 1.0)) * EARTH_RADIUS_NM * np.sign(np.cos(offset))
    return _plain(cross), _plain(along)


def cross_track_distance_nm(lat, lon, route_start: tuple, route_end: tuple):
    """Perpendicular distance from the point(s) to the great-circle route
    route_start -> route_end, in nautical miles. Positive = right of course.
    """
    return _track(lat, lon, route_start, route_end)[0]


def along_track_distance_nm(lat, lon, route_start: tuple, route_end: tuple):
    """Signed distance along the route from route_start to the projection
    of the point(s) onto it, in nautical miles. Negative behind the start.
    """
    return _track(lat, lon, route_start, route_end)[1]


def track_distances_nm(lat, lon, route_start: tuple, route_end: tuple):
    """Both at once, for the callers that want both -- they share the
    two azimuth solutions, so asking separately does the work twice."""
    return _track(lat, lon, route_start, route_end)


def destination_point(lat: float, lon: float, bearing: float, distance_nm_: float) -> tuple:
    """Point reached from (lat, lon) travelling `bearing` degrees for
    `distance_nm_` nautical miles along a great circle.
    """
    lon2, lat2, _ = _GEOD.fwd(lon, lat, bearing, distance_nm_)
    return lat2, lon2


def corridor_bbox(route_start: tuple, route_end: tuple, buffer_nm: float) -> tuple:
    """Padded (min_lat, min_lon, max_lat, max_lon) bounding box around the
    route, generous enough for an Overpass query. The real corridor width
    is enforced later by filtering on cross_track_distance_nm.
    """
    lats = [route_start[0], route_end[0]]
    lons = [route_start[1], route_end[1]]
    pad_deg = buffer_nm / 60.0  # ~1 nm per minute of latitude
    return (min(lats) - pad_deg, min(lons) - pad_deg, max(lats) + pad_deg, max(lons) + pad_deg)


# --- Neighbourhood questions, answered with a KD-tree on the unit sphere ---
#
# Chord length rises monotonically with great-circle distance, so a
# chord radius selects exactly the points an arc radius would, and a
# KD-tree can answer "who is near whom" without the n-by-n distance
# matrix -- or the nested Python loop -- these used to cost.


def _unit_sphere(lat, lon) -> np.ndarray:
    lat_r = np.radians(np.asarray(lat, dtype=float))
    lon_r = np.radians(np.asarray(lon, dtype=float))
    return np.column_stack(
        [np.cos(lat_r) * np.cos(lon_r), np.cos(lat_r) * np.sin(lon_r), np.sin(lat_r)]
    )


def _chord(distance_nm_: float) -> float:
    return 2 * np.sin(distance_nm_ / (2 * EARTH_RADIUS_NM))


def _arc_nm(chord: np.ndarray) -> np.ndarray:
    return 2 * EARTH_RADIUS_NM * np.arcsin(np.clip(chord / 2, 0.0, 1.0))


def nearest_neighbour_nm(lat, lon) -> np.ndarray:
    """Great-circle distance from each point to its closest *other*
    point, in input order -- "clutter". Two landmarks a tenth of a mile
    apart are harder to tell apart from the air, and to describe
    unambiguously on a nav log, than two ten miles apart.

    A lone point has no neighbour and gets infinity; callers decide what
    that means for them.
    """
    xyz = _unit_sphere(lat, lon)
    if len(xyz) < 2:
        return np.full(len(xyz), np.inf)
    chord, _ = KDTree(xyz).query(xyz, k=2)
    return _arc_nm(chord[:, 1])


def neighbours_within_nm(lat, lon, radius_nm: float) -> list:
    """For each point, the indices of every point within radius_nm of it,
    itself included."""
    xyz = _unit_sphere(lat, lon)
    if len(xyz) == 0:
        return []
    tree = KDTree(xyz)
    return tree.query_ball_point(xyz, _chord(radius_nm))


def cluster_points(lat, lon, cluster_distance_nm: float) -> np.ndarray:
    """Connected-components clustering: two points share a cluster if
    within cluster_distance_nm of each other, transitively (e.g. a chain
    of wind turbines spread along a ridge). Returns a cluster id (int)
    per input point, in input order.
    """
    xyz = _unit_sphere(lat, lon)
    if len(xyz) == 0:
        return np.empty(0, dtype=int)

    pairs = KDTree(xyz).query_pairs(_chord(cluster_distance_nm), output_type="ndarray")
    graph = coo_matrix(
        (np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(len(xyz), len(xyz))
    )
    return connected_components(graph, directed=False)[1]
