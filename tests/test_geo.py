import math

import pytest

from vfr.geo import (
    EARTH_RADIUS_NM,
    along_track_distance_nm,
    bearing_deg,
    cluster_points,
    corridor_bbox,
    cross_track_distance_nm,
    destination_point,
    distance_nm,
)


def test_distance_nm_one_degree_of_longitude_at_equator():
    # circumference / 360, since a degree of longitude at the equator is
    # one 360th of the way around the globe
    expected = 2 * math.pi * EARTH_RADIUS_NM / 360
    assert distance_nm(0, 0, 0, 1) == pytest.approx(expected, rel=1e-3)


def test_distance_nm_same_point_is_zero():
    assert distance_nm(42.0, -88.0, 42.0, -88.0) == pytest.approx(0.0, abs=1e-9)


def test_bearing_deg_cardinal_directions():
    assert bearing_deg(0, 0, 1, 0) == pytest.approx(0, abs=1e-6)  # due north
    assert bearing_deg(0, 0, 0, 1) == pytest.approx(90, abs=1e-6)  # due east
    assert bearing_deg(0, 0, -1, 0) == pytest.approx(180, abs=1e-6)  # due south
    assert bearing_deg(0, 0, 0, -1) == pytest.approx(270, abs=1e-6)  # due west


def test_destination_point_round_trips_with_distance_and_bearing():
    start = (42.0, -88.0)
    lat2, lon2 = destination_point(*start, bearing=90, distance_nm_=100)
    assert distance_nm(*start, lat2, lon2) == pytest.approx(100, rel=1e-6)
    assert bearing_deg(*start, lat2, lon2) == pytest.approx(90, abs=1e-3)


def test_cross_track_distance_is_zero_on_the_route():
    route_start, route_end = (0, 0), (0, 10)
    midpoint = (0, 5)
    assert cross_track_distance_nm(*midpoint, route_start, route_end) == pytest.approx(0, abs=1e-6)


def test_cross_track_distance_off_route_is_nonzero_and_signed():
    route_start, route_end = (0, 0), (0, 10)
    north_of_route = (1, 5)
    south_of_route = (-1, 5)
    north_xt = cross_track_distance_nm(*north_of_route, route_start, route_end)
    south_xt = cross_track_distance_nm(*south_of_route, route_start, route_end)
    assert north_xt != pytest.approx(0, abs=1e-6)
    assert north_xt == pytest.approx(-south_xt, rel=1e-6)  # symmetric about the route


def test_cross_track_sign_is_positive_right_of_course():
    # Flying due east along the equator, a point to the south is off the
    # right wing. vfr.pipeline's corridor filter and the nav log both
    # read this sign.
    route_start, route_end = (0, 0), (0, 10)
    assert cross_track_distance_nm(-1, 5, route_start, route_end) > 0
    assert cross_track_distance_nm(1, 5, route_start, route_end) < 0


def test_along_track_distance_at_route_midpoint():
    route_start, route_end = (0, 0), (0, 10)
    midpoint = (0, 5)
    total = distance_nm(*route_start, *route_end)
    along = along_track_distance_nm(*midpoint, route_start, route_end)
    assert along == pytest.approx(total / 2, rel=1e-3)


def test_along_track_distance_behind_the_start_is_negative():
    # The signed convention vfr.pipeline's corridor filter is written
    # for: it bounds along-track between -MARGIN_NM and the route length
    # plus MARGIN_NM, which only excludes anything if a candidate behind
    # the departure point reads negative.
    route_start, route_end = (0, 0), (0, 10)
    behind = along_track_distance_nm(0, -2, route_start, route_end)
    assert behind < 0
    assert behind == pytest.approx(-distance_nm(0, 0, 0, 2), rel=1e-6)


def test_coincident_points_give_zero_distance_and_no_error():
    # A route whose two ends are the same point should not take the nav
    # log down; the library returns zero rather than raising.
    assert distance_nm(42.0, -88.0, 42.0, -88.0) == 0
    assert bearing_deg(42.0, -88.0, 42.0, -88.0) == pytest.approx(0)


def test_cluster_points_chains_transitively():
    # Three points a half mile apart in a line are one cluster even
    # though the ends are a mile apart -- a ridge of wind turbines is one
    # checkpoint, not three.
    a = (44.0, -89.0)
    b = destination_point(*a, bearing=90, distance_nm_=0.5)
    c = destination_point(*a, bearing=90, distance_nm_=1.0)
    lats, lons = zip(*[a, b, c])
    ids = cluster_points(lats, lons, cluster_distance_nm=0.6)
    assert len(set(ids)) == 1


def test_cluster_points_separates_beyond_the_distance():
    a = (44.0, -89.0)
    far = destination_point(*a, bearing=90, distance_nm_=5.0)
    ids = cluster_points([a[0], far[0]], [a[1], far[1]], cluster_distance_nm=1.0)
    assert len(set(ids)) == 2


def test_cluster_points_handles_duplicates_and_empty_input():
    # Overpass hands back turbines at identical coordinates often enough
    # to matter, and an empty corridor is not an error.
    ids = cluster_points([42.0, 42.0], [-88.0, -88.0], cluster_distance_nm=0.03)
    assert len(set(ids)) == 1
    assert len(cluster_points([], [], cluster_distance_nm=1.0)) == 0


def test_corridor_bbox_padding():
    route_start, route_end = (40.0, -90.0), (42.0, -88.0)
    min_lat, min_lon, max_lat, max_lon = corridor_bbox(route_start, route_end, buffer_nm=60)
    assert min_lat < 40.0 and max_lat > 42.0
    assert min_lon < -90.0 and max_lon > -88.0
