"""Hand-derived headwind/tailwind/crosswind cases -- these are the same
sanity checks worked through manually while building vfr.navlog (see
project memory: [[project-navlog-dr-math]]), formalized as regression tests.
"""
import math

import pytest

from vfr.navlog import groundspeed_kt, wind_correction_angle_deg
from vfr.weather import _interp_circular_deg


def test_direct_headwind_no_wca_reduces_groundspeed():
    tc, wind_dir, wind_speed, tas = 90, 90, 20, 110
    wca = wind_correction_angle_deg(tc, wind_dir, wind_speed, tas)
    gs = groundspeed_kt(tc, wind_dir, wind_speed, tas, wca)
    assert wca == pytest.approx(0, abs=1e-9)
    assert gs == pytest.approx(90, abs=1e-9)


def test_direct_tailwind_no_wca_increases_groundspeed():
    tc, wind_dir, wind_speed, tas = 90, 270, 20, 110
    wca = wind_correction_angle_deg(tc, wind_dir, wind_speed, tas)
    gs = groundspeed_kt(tc, wind_dir, wind_speed, tas, wca)
    assert wca == pytest.approx(0, abs=1e-9)
    assert gs == pytest.approx(130, abs=1e-9)


def test_direct_crosswind_matches_hand_derivation():
    tc, wind_dir, wind_speed, tas = 90, 180, 20, 110
    wca = wind_correction_angle_deg(tc, wind_dir, wind_speed, tas)
    gs = groundspeed_kt(tc, wind_dir, wind_speed, tas, wca)
    expected_wca = math.degrees(math.asin(wind_speed / tas))
    assert wca == pytest.approx(expected_wca, rel=1e-9)
    assert wca > 0  # crab to the right for a wind from the south on an eastbound course
    assert gs == pytest.approx(tas * math.cos(math.radians(expected_wca)), rel=1e-9)


def test_circular_interpolation_across_the_360_wrap():
    assert _interp_circular_deg(350, 10, 0.5) == pytest.approx(0.0, abs=1e-9)
    assert _interp_circular_deg(10, 350, 0.5) == pytest.approx(0.0, abs=1e-9)


def test_circular_interpolation_normal_case():
    assert _interp_circular_deg(100, 200, 0.25) == pytest.approx(125.0, abs=1e-9)


def _leg_with_wind(monkeypatch, wind_dir, wind_speed, tas=100.0):
    from vfr import navlog
    monkeypatch.setattr(navlog, "wind_at_altitude", lambda lat, lon, alt, fcst_hr="06": {
        "wind_dir_true_deg": wind_dir, "wind_speed_kt": wind_speed})
    monkeypatch.setattr(navlog, "magnetic_variation_deg", lambda lat, lon: 0.0)
    a = {"name": "A", "category": "departure", "lat": 45.0, "lon": -90.0}
    b = {"name": "B", "category": "destination", "lat": 45.0, "lon": -89.0}   # due east, 090
    return navlog.leg_between(a, b, 4500, {"cruise_tas_kt": tas, "fuel_burn_gph": 8.5})


def test_a_crosswind_stronger_than_tas_is_unflyable(monkeypatch):
    """150 kt from 190 on an eastbound course, for a 100 kt aeroplane:
    no heading holds the course, though the clamped wind correction angle
    and the wind's tail component used to give a positive ground speed."""
    leg = _leg_with_wind(monkeypatch, 190, 150)
    assert leg["ete_min"] is None and leg["groundspeed_kt"] is None and leg["fuel_gal"] is None


def test_an_unflyable_headwind_has_no_ground_speed_either(monkeypatch):
    """Flyability is decided once: no ETE means no ground speed or fuel,
    not a negative ground speed beside an empty ETE."""
    leg = _leg_with_wind(monkeypatch, 90, 120)
    assert leg["ete_min"] is None and leg["groundspeed_kt"] is None and leg["fuel_gal"] is None


def test_a_strong_but_holdable_crosswind_still_flies(monkeypatch):
    leg = _leg_with_wind(monkeypatch, 180, 60)
    assert leg["ete_min"] is not None and leg["groundspeed_kt"] > 0


def test_the_fuel_required_includes_start_taxi_and_takeoff():
    from vfr import navlog
    plan = navlog.fuel_plan(20.0, {"fuel_burn_gph": 8.0, "usable_fuel_gal": 40}, night=False)
    assert plan["taxi_gal"] == navlog.DEFAULT_TAXI_FUEL_GAL
    assert plan["fuel_required_gal"] == round(20.0 + navlog.DEFAULT_TAXI_FUEL_GAL + 4.0, 1)
    assert navlog.fuel_plan(20.0, {"fuel_burn_gph": 8.0, "taxi_fuel_gal": 2.0}, night=False)["fuel_required_gal"] == 26.0
