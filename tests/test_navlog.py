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
