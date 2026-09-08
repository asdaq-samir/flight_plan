"""Great-circle navigation helpers (spherical Earth — same approximation
flight computers use, plenty accurate for spacing VFR checkpoints).
"""
import math

import numpy as np

EARTH_RADIUS_NM = 3440.065


def _to_rad(deg: float) -> float:
    return math.radians(deg)


def distance_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two points, in nautical miles."""
    phi1, phi2 = _to_rad(lat1), _to_rad(lat2)
    dphi = _to_rad(lat2 - lat1)
    dlambda = _to_rad(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_NM * math.asin(math.sqrt(a))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial great-circle bearing from point 1 to point 2, in degrees [0, 360)."""
    phi1, phi2 = _to_rad(lat1), _to_rad(lat2)
    dlambda = _to_rad(lon2 - lon1)
    y = math.sin(dlambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlambda)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def cross_track_distance_nm(
    lat: float, lon: float, route_start: tuple, route_end: tuple
) -> float:
    """Perpendicular distance from (lat, lon) to the great-circle route
    route_start -> route_end, in nautical miles. Positive = right of course.
    """
    lat1, lon1 = route_start
    lat2, lon2 = route_end
    d13 = distance_nm(lat1, lon1, lat, lon) / EARTH_RADIUS_NM
    brng13 = _to_rad(bearing_deg(lat1, lon1, lat, lon))
    brng12 = _to_rad(bearing_deg(lat1, lon1, lat2, lon2))
    return math.asin(math.sin(d13) * math.sin(brng13 - brng12)) * EARTH_RADIUS_NM


def along_track_distance_nm(
    lat: float, lon: float, route_start: tuple, route_end: tuple
) -> float:
    """Distance along the route from route_start to the projection of
    (lat, lon) onto the route, in nautical miles.
    """
    lat1, lon1 = route_start
    d13 = distance_nm(lat1, lon1, lat, lon) / EARTH_RADIUS_NM
    dxt = cross_track_distance_nm(lat, lon, route_start, route_end) / EARTH_RADIUS_NM
    dat = math.acos(min(1.0, max(-1.0, math.cos(d13) / math.cos(dxt))))
    return dat * EARTH_RADIUS_NM


def destination_point(lat: float, lon: float, bearing: float, distance_nm_: float) -> tuple:
    """Point reached from (lat, lon) travelling `bearing` degrees for
    `distance_nm_` nautical miles along a great circle.
    """
    phi1, lambda1 = _to_rad(lat), _to_rad(lon)
    theta = _to_rad(bearing)
    delta = distance_nm_ / EARTH_RADIUS_NM
    phi2 = math.asin(
        math.sin(phi1) * math.cos(delta) + math.cos(phi1) * math.sin(delta) * math.cos(theta)
    )
    lambda2 = lambda1 + math.atan2(
        math.sin(theta) * math.sin(delta) * math.cos(phi1),
        math.cos(delta) - math.sin(phi1) * math.sin(phi2),
    )
    return math.degrees(phi2), (math.degrees(lambda2) + 540) % 360 - 180


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
    per input point, in input order. O(n^2) pairwise distance -- fine at
    the scale of turbines within a single route corridor.
    """
    lat_r = np.radians(np.asarray(lat, dtype=float))
    lon_r = np.radians(np.asarray(lon, dtype=float))
    dlat = lat_r[:, None] - lat_r[None, :]
    dlon = lon_r[:, None] - lon_r[None, :]
    a = np.sin(dlat / 2) ** 2 + np.cos(lat_r[:, None]) * np.cos(lat_r[None, :]) * np.sin(dlon / 2) ** 2
    dist_matrix = 2 * EARTH_RADIUS_NM * np.arcsin(np.sqrt(np.clip(a, 0, 1)))
    adjacency = dist_matrix <= cluster_distance_nm

    n = len(lat_r)
    cluster_ids = -np.ones(n, dtype=int)
    next_id = 0
    for i in range(n):
        if cluster_ids[i] != -1:
            continue
        stack = [i]
        cluster_ids[i] = next_id
        while stack:
            j = stack.pop()
            for k in np.nonzero(adjacency[j])[0]:
                if cluster_ids[k] == -1:
                    cluster_ids[k] = next_id
                    stack.append(k)
        next_id += 1
    return cluster_ids
