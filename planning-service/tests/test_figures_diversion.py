"""web/src/lib/diversion.test.ts's cases for app.figures.diversion."""
import pytest

from app.figures.diversion import divert, reasonable, wind_triangle

LEG = {"tas_kt": 110, "fuel_burn_gph": 8.5, "magnetic_variation_deg": -3,
       "wind": {"wind_dir_true_deg": 270, "wind_speed_kt": 20}}


def test_the_wind_triangle():
    # A direct headwind: no correction, the ground speed the difference.
    head = wind_triangle(270, 110, 270, 20)
    assert head["wca"] == 0 and head["th"] == 270 and head["gs"] == pytest.approx(90)
    # From the left on a northerly course: correct left, a little slower.
    north = wind_triangle(360, 110, 270, 20)
    assert north["wca"] == pytest.approx(-10.48, abs=0.05)
    assert north["th"] == pytest.approx(349.52, abs=0.05)
    assert north["gs"] == pytest.approx(108.2, abs=0.05)
    # A wind faster than the airplane across the course holds no heading.
    assert wind_triangle(360, 50, 270, 60) is None


def test_to_the_field_heading_magnetic_time_and_fuel_at_the_legs_burn():
    d = divert(LEG, 360, 18)
    # 3 degrees west: west is best, so it is added.
    assert d["mh"] == pytest.approx(352.52, abs=0.05)
    assert d["ete"] == pytest.approx((18 / d["gs"]) * 60, rel=1e-9)
    assert d["fuel"] == pytest.approx((d["ete"] / 60) * 8.5, rel=1e-9)
    # No wind is calm.
    calm = divert({**LEG, "wind": None}, 90, 22)
    assert calm["wca"] == 0 and calm["gs"] == pytest.approx(110) and calm["ete"] == pytest.approx(12)


def test_a_reasonable_estimate_headings_round_the_compass():
    assert reasonable("mh", 2, 355) is True
    assert reasonable("mh", 10, 355) is False
    assert reasonable("ete", 13, 10) is True
    assert reasonable("fuel", 3.6, 2.5) is False
