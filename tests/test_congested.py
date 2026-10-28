"""vfr.congested: whether a point is over a congested area or within
14 CFR 91.119(b)'s "horizontal radius of 2,000 feet" of one, from the
Census urban areas and gazetteer places -- here a town of a few streets
drawn by hand."""
import math

import numpy as np
import pytest
import requests
import shapely

from vfr import congested

LAT, LON = 45.0, -90.0
FT_LAT = 1 / congested.FT_PER_DEG_LAT                       # a foot, in degrees of latitude
FT_LON = FT_LAT / math.cos(math.radians(LAT))               # and of longitude at 45 N
# A town a mile on a side, its south-west corner at (LAT, LON).
TOWN = shapely.box(LON, LAT, LON + 5280 * FT_LON, LAT + 5280 * FT_LAT)


@pytest.fixture
def town(monkeypatch):
    monkeypatch.setattr(congested, "_tree", lambda: shapely.STRtree([TOWN]))


def _at(north_ft: float, east_ft: float) -> tuple[float, float]:
    """A point `north_ft` and `east_ft` from the town's south-west corner."""
    return LAT + north_ft * FT_LAT, LON + east_ft * FT_LON


def _congested(*points) -> list:
    lats, lons = zip(*points)
    return congested.congested(np.array(lats), np.array(lons)).tolist()


def test_inside_the_town_is_congested(town):
    assert _congested(_at(2640, 2640)) == [True]


def test_within_2000_ft_south_of_the_town_counts_and_beyond_does_not(town):
    # An airplane over the town's edge is within 2,000 ft of what stands
    # 1,999 ft outside it, and not of what stands 2,001 ft out.
    assert _congested(_at(-1999, 2640), _at(-2001, 2640)) == [True, False]


def test_within_2000_ft_west_of_the_town_counts_and_beyond_does_not(town):
    # East-west by the latitude's own degree of longitude.
    assert _congested(_at(2640, -1999), _at(2640, -2001)) == [True, False]


def test_off_a_corner_the_distance_is_to_the_corner(town):
    # 1,400 ft south and 1,400 west is 1,980 ft from the corner; 1,450
    # each way is 2,051.
    assert _congested(_at(-1400, -1400), _at(-1450, -1450)) == [True, False]


def test_no_points_is_no_answer_needed(town):
    assert congested.congested(np.array([]), np.array([])).tolist() == []


def test_a_gazetteer_place_is_a_circle_of_its_land_area(monkeypatch):
    # A village of a square kilometre: a circle 564 m across its point.
    monkeypatch.setattr(congested.geocode, "_towns", lambda: [["Smallville", "KS", LAT, LON, 1_000_000.0]])
    (circle,) = congested._places()
    radius_m = math.sqrt(1_000_000.0 / math.pi)
    assert shapely.contains_xy(circle, LON, LAT + 0.95 * radius_m / congested.M_PER_DEG_LAT)
    assert not shapely.contains_xy(circle, LON, LAT + 1.05 * radius_m / congested.M_PER_DEG_LAT)


def test_a_place_with_a_county_of_land_is_its_core_alone(monkeypatch):
    monkeypatch.setattr(congested.geocode, "_towns", lambda: [["Greeley County", "KS", LAT, LON, 2.0e9]])
    (circle,) = congested._places()
    north_ft = (circle.bounds[3] - LAT) * congested.FT_PER_DEG_LAT
    assert north_ft == pytest.approx(congested.PLACE_RADIUS_M / 0.3048, rel=0.01)


def test_without_the_census_data_nothing_is_ruled_out(monkeypatch, tmp_path):
    # The caller then takes every point as congested: 91.119(b)'s 1,000 ft.
    monkeypatch.setattr(congested, "_HELD", {})
    monkeypatch.setattr(congested, "_RETRY_AT", 0.0)
    monkeypatch.setattr(congested, "URBAN_AREAS_PATH", tmp_path / "ua.zip")

    def offline(*args, **kwargs):
        raise requests.ConnectionError("offline")

    monkeypatch.setattr(congested.requests, "get", offline)
    assert congested.congested(np.array([LAT]), np.array([LON])) is None


def _one_at_a_time(tree, lats, lons) -> np.ndarray:
    """vfr.congested.congested as it was before its 2,000 ft test took
    every pair at once: each point near a town clipped, scaled and
    measured on its own -- the oracle the vectorised one must match to
    the bit (14 CFR 91.119(b)'s 2,000 ft, RADIUS_FT)."""
    lats, lons = np.asarray(lats, dtype=float), np.asarray(lons, dtype=float)
    points = shapely.points(lons, lats)
    found = np.zeros(lats.size, dtype=bool)
    by_box, area = tree.query(points)
    for j in np.unique(area).tolist():
        mine = by_box[area == j]
        found[mine[shapely.contains_xy(tree.geometries[j], lons[mine], lats[mine])]] = True
    widest = max(0.2, math.cos(math.radians(min(89.0, float(np.abs(lats).max())))))
    reach = congested.RADIUS_FT / congested.FT_PER_DEG_LAT / widest

    def within(shape, lat, lon):
        piece = shapely.clip_by_rect(shape, lon - reach, lat - reach, lon + reach, lat + reach)
        if piece.is_empty:
            return False
        scale = max(0.2, math.cos(math.radians(lat)))
        flat = shapely.transform(piece, lambda xy: (xy - np.array([lon, lat])) * np.array([scale, 1.0]))
        return shapely.distance(flat, shapely.Point(0.0, 0.0)) * congested.FT_PER_DEG_LAT <= congested.RADIUS_FT

    rest = np.flatnonzero(~found)
    if rest.size:
        near_point, near_area = tree.query(points[rest], predicate="dwithin", distance=reach)
        for i, j in zip(rest[near_point].tolist(), near_area.tolist()):
            if not found[i]:
                found[i] = within(tree.geometries[j], float(lats[i]), float(lons[i]))
    return found


@pytest.mark.parametrize("lat", [LAT, 64.84, 71.29])
def test_every_pair_at_once_matches_one_at_a_time_at_the_2000_ft_edge(monkeypatch, lat):
    # A town a mile on a side at 45 N, Fairbanks's and Utqiagvik's
    # latitudes, with points 1,990 and 2,010 ft off each side and corner
    # and a scatter round it: the same answer as each measured on its own.
    ft_lon = FT_LAT / math.cos(math.radians(lat))
    town = shapely.box(LON, lat, LON + 5280 * ft_lon, lat + 5280 * FT_LAT)
    tree = shapely.STRtree([town, shapely.buffer(shapely.Point(LON + 0.1, lat + 0.05), 0.01)])
    monkeypatch.setattr(congested, "_tree", lambda: tree)
    north, east = [], []
    for off in (1990, 2010):
        for n, e in ((-off, 2640), (5280 + off, 2640), (2640, -off), (2640, 5280 + off),
                     (-off / math.sqrt(2), -off / math.sqrt(2)), (5280 + off / math.sqrt(2), 5280 + off / math.sqrt(2))):
            north.append(n)
            east.append(e)
    rng = np.random.default_rng(91119)
    north += rng.uniform(-8000, 13000, 3000).tolist()
    east += rng.uniform(-8000, 60000, 3000).tolist()
    lats = lat + np.array(north) * FT_LAT
    lons = LON + np.array(east) * ft_lon
    got = congested.congested(lats, lons)
    assert got.tolist() == _one_at_a_time(tree, lats, lons).tolist()
    # The edge points themselves: 1,990 ft in, 2,010 ft out, each side.
    assert got[:12].tolist() == [True] * 6 + [False] * 6


@pytest.mark.skipif(not (congested.URBAN_AREAS_PATH.exists() and (congested.DIR.parents[0] / "faa_nasr" / "DOF.DAT").exists()),
                    reason="needs the Census urban areas and the FAA's DOF.DAT on disk")
def test_every_pair_at_once_matches_one_at_a_time_on_the_real_obstacles_round_chicago_and_milwaukee():
    from vfr import faa_data

    tree = congested._tree()
    if tree is None:
        pytest.skip("no Census gazetteer")
    dof = faa_data.load_obstacles(congested.DIR.parents[0] / "faa_nasr" / "DOF.DAT", (41.4, -88.6, 43.3, -87.5), min_agl_ft=0)
    lats, lons = dof["lat"].to_numpy(dtype=float), dof["lon"].to_numpy(dtype=float)
    assert lats.size > 1000
    got = congested.congested(lats, lons)
    assert got.tolist() == _one_at_a_time(tree, lats, lons).tolist()
    assert 0 < got.sum() < lats.size
