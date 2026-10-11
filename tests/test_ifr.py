"""vfr.ifr: the minimum IFR altitude over each leg (14 CFR 91.177(a)(2)),
the cruising altitudes the direction of flight allows (91.179(b), FAA
Order JO 7110.65 TBL 4-5-1), and the designated mountainous areas (Part
95 subpart B). The terrain tiles are made flat here, with what peaks a
test puts on them, and the obstacles are a real DOF file of a few lines."""
import numpy as np
import pytest

from tests.test_terrain import _dof_line
from vfr import elevation, faa_data, geo, ifr

GROUND_M = 300.0   # 984.25 ft
START = (45.0, -90.0)   # Wisconsin: no mountainous area
END = (45.0, -89.5)


def _at(start: tuple, along_nm: float, left_nm: float = 0.0) -> tuple[float, float]:
    """A point `along_nm` east of `start` and `left_nm` north of that."""
    lat, lon = geo.destination_point(*start, 90.0, along_nm)
    if left_nm:
        lat, lon = geo.destination_point(lat, lon, 0.0, left_nm)
    return lat, lon


@pytest.fixture
def land(tmp_path, monkeypatch):
    """Flat ground everywhere, with the peaks a test adds, and the
    obstacles it writes."""
    peaks: list[tuple[float, float, float]] = []

    def tile(z, x, y):
        heights = np.full((256, 256), GROUND_M)
        lats, lons = ifr._pixel_lat_lon(z, x, y, 256)
        for lat, lon, metres in peaks:
            near = np.hypot((lats - lat) * 60, (lons - lon) * 60 * np.cos(np.radians(lat))) <= 0.05
            heights[near] = metres
        return heights

    monkeypatch.setattr(elevation, "_terrain_tile", tile)
    monkeypatch.setattr(faa_data, "_OBSTACLES_CACHE", {})
    dof = tmp_path / "DOF.DAT"
    dof.write_text("", encoding="latin-1")
    monkeypatch.setattr(faa_data, "ensure_nasr_file", lambda name, cache_dir: dof, raising=False)

    class Land:
        def peak(self, point, metres):
            peaks.append((point[0], point[1], metres))

        def obstacles(self, *lines):
            dof.write_text("".join(lines), encoding="latin-1")
            monkeypatch.setattr(faa_data, "_OBSTACLES_CACHE", {})

    return Land()


def test_eastbound_flies_odd_thousands_and_westbound_even_up_to_the_ceiling():
    assert ifr.cruising_altitudes(4100, 12000, 90) == [5000, 7000, 9000, 11000]
    assert ifr.cruising_altitudes(4100, 12000, 270) == [6000, 8000, 10000, 12000]
    # A floor on one of them is flown at it.
    assert ifr.cruising_altitudes(5000, 9000, 45)[0] == 5000
    # 000 through 179 odd, 180 through 359 even (91.179(b)(1)).
    assert ifr.cruising_altitudes(2100, 6000, 179.9) == [3000, 5000]
    assert ifr.cruising_altitudes(2100, 6000, 180.0) == [4000, 6000]
    # Nothing between the floor and the ceiling.
    assert ifr.cruising_altitudes(8100, 8900, 90) == []


def test_flight_levels_follow_the_same_rule_to_fl410():
    # 91.179(b)(2): odd flight levels east, even west, from 18,000 ft.
    assert ifr.cruising_altitudes(17500, 23000, 90) == [19000, 21000, 23000]
    assert ifr.cruising_altitudes(17500, 22000, 270) == [18000, 20000, 22000]
    # (b)(4) and JO 7110.65 TBL 4-5-1: every 2,000 ft to FL410, no further.
    assert ifr.cruising_altitudes(38000, None, 90)[-1] == 41000
    assert ifr.cruising_altitudes(38000, None, 270)[-1] == 40000


@pytest.mark.parametrize(("place", "lat", "lon", "expected"), [
    ("Denver, west of 95.15's line", 39.74, -104.99, True),
    ("Asheville, in 95.13's area", 35.60, -82.55, True),
    ("Chicago, in neither", 41.88, -87.63, False),
    ("Fresno, the Central Valley's exception", 36.74, -119.79, False),
    ("Seattle, Puget Sound's exception", 47.61, -122.33, False),
    ("Albany, the Hudson valley's exception", 42.65, -73.75, False),
    ("Amarillo, east of the line", 35.22, -101.83, False),
    ("Anchorage, Alaska kept whole", 61.22, -149.90, True),
    ("Hilo, Hawaii's islands", 19.72, -155.08, True),
    ("Puerto Rico's mountains", 18.20, -66.50, True),
    ("San Juan, on Puerto Rico's coast", 18.45, -66.07, False),
])
def test_the_designated_mountainous_areas(place, lat, lon, expected):
    assert ifr.mountainous(lat, lon) is expected, place


def test_the_floor_is_1000_ft_over_the_highest_ground_within_4_nm(land):
    [floor] = ifr.floor_profile([START, END])
    # 984 ft of ground, 50 ft for the tiles' pixels, 1,000 ft: 2,100.
    assert floor.floor_ft == 2100
    assert not floor.mountainous
    assert not floor.highest_is_obstacle


def test_a_peak_3_nm_off_the_course_counts_and_one_5_nm_off_does_not(land):
    land.peak(_at(START, 10, 5), 900.0)
    assert ifr.floor_profile([START, END])[0].floor_ft == 2100
    land.peak(_at(START, 12, -3), 900.0)
    # 2,953 ft of ground, 50 and 1,000 more: 4,100.
    assert ifr.floor_profile([START, END])[0].floor_ft == 4100


def test_a_peak_past_the_courses_end_but_within_4_nm_of_it_counts(land):
    land.peak(_at(END, 3), 900.0)
    assert ifr.floor_profile([START, END])[0].floor_ft == 4100


def test_an_obstacle_within_4_nm_sets_the_floor_where_it_is_higher(land):
    land.obstacles(_dof_line(*_at(START, 8, 3.5), amsl_ft=2400), _dof_line(*_at(START, 8, -4.5), amsl_ft=5000))
    [floor] = ifr.floor_profile([START, END])
    assert floor.floor_ft == 3400
    assert floor.highest_is_obstacle
    assert floor.highest_ft == 2400


def test_each_leg_has_its_own_floor(land):
    middle = _at(START, 20)
    land.peak(_at(middle, 10), 900.0)
    first, second = ifr.floor_profile([START, middle, _at(middle, 20)])
    # The peak is 10 nm past the first leg's end: the second leg's alone.
    assert first.floor_ft == 2100
    assert second.floor_ft == 4100


def test_over_a_mountainous_area_the_clearance_is_2000_ft(land):
    a, b = (39.7, -105.5), (39.7, -105.0)
    [floor] = ifr.floor_profile([a, b])
    assert floor.mountainous
    assert floor.floor_ft == 3100
