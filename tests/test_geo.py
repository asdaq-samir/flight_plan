import math

import pytest

from vfr.geo import (
    EARTH_RADIUS_NM,
    along_track_distance_nm,
    bearing_deg,
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


def test_along_track_distance_at_route_midpoint():
    route_start, route_end = (0, 0), (0, 10)
    midpoint = (0, 5)
    total = distance_nm(*route_start, *route_end)
    along = along_track_distance_nm(*midpoint, route_start, route_end)
    assert along == pytest.approx(total / 2, rel=1e-3)


def test_corridor_bbox_padding():
    route_start, route_end = (40.0, -90.0), (42.0, -88.0)
    min_lat, min_lon, max_lat, max_lon = corridor_bbox(route_start, route_end, buffer_nm=60)
    assert min_lat < 40.0 and max_lat > 42.0
    assert min_lon < -90.0 and max_lon > -88.0
