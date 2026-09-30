"""vfr.performance against hand-worked figures: the standard atmosphere,
the cruise scaled from the reference altitude, the power full throttle
makes, and the climb falling to 100 fpm at the service ceiling."""
import math

import pytest

from vfr import performance

C172 = {"service_ceiling_ft": 13500.0, "climb_rate_fpm_sea_level": 730.0, "cruise_tas_kt": 110.0,
        "fuel_burn_gph": 8.5, "cruise_power_pct": 65.0, "climb_tas_kt": 74.0}


def _isa_plus(dev_c):
    return lambda altitude_ft: performance.isa_temp_c(altitude_ft) + dev_c


def _standard_sigma(altitude_ft):
    return performance.density_ratio(altitude_ft, performance.isa_temp_c(altitude_ft))


def test_a_standard_days_density_altitude_is_the_altitude():
    for altitude_ft in (0.0, 5000.0, 12500.0):
        assert performance.density_altitude_ft(_standard_sigma(altitude_ft)) == pytest.approx(altitude_ft, abs=0.5)
    # The standard atmosphere's own table: 0.7860 at 8,000 ft.
    assert _standard_sigma(8000.0) == pytest.approx(0.7860, abs=0.0005)


def test_warm_air_is_about_120_ft_of_density_altitude_a_degree():
    sigma = performance.density_ratio(5000.0, performance.isa_temp_c(5000.0) + 15)
    assert performance.density_altitude_ft(sigma) - 5000.0 == pytest.approx(15 * 120, rel=0.1)


def test_the_profiles_figures_are_its_cruise_at_the_reference_altitude():
    cruise = performance.cruise(C172, performance.REFERENCE_ALTITUDE_FT)
    assert cruise.tas_kt == pytest.approx(110.0) and cruise.fuel_burn_gph == pytest.approx(8.5)
    assert cruise.power_pct == pytest.approx(65.0)


def test_at_the_same_power_thinner_air_is_faster_and_burns_the_same():
    low, high = performance.cruise(C172, 2500.0), performance.cruise(C172, 8500.0)
    # TAS goes as the cube root of power over density.
    assert high.tas_kt / low.tas_kt == pytest.approx((_standard_sigma(2500.0) / _standard_sigma(8500.0)) ** (1 / 3))
    assert high.tas_kt > 112 > 107 > low.tas_kt
    assert high.fuel_burn_gph == low.fuel_burn_gph == pytest.approx(8.5)
    # A warm day at 4,500 flies like a standard one higher up.
    warm = performance.cruise(C172, 4500.0, performance.isa_temp_c(4500.0) + 15)
    assert warm.tas_kt > performance.cruise(C172, 4500.0).tas_kt
    assert warm.density_altitude_ft == pytest.approx(6220, abs=50)


def test_above_its_full_throttle_height_the_engine_makes_less_and_burns_less():
    # 75% is full throttle at about 8,000 ft on a standard day (Gagg and
    # Ferrar: 1.132 sigma - 0.132 = 0.75 at sigma 0.779).
    archer = {**C172, "cruise_tas_kt": 125.0, "fuel_burn_gph": 9.5, "cruise_power_pct": 75.0}
    at_7000, at_10500 = performance.cruise(archer, 7000.0), performance.cruise(archer, 10500.0)
    assert at_7000.power_pct == pytest.approx(75.0)
    assert at_10500.power_pct == pytest.approx((1.132 * _standard_sigma(10500.0) - 0.132) * 100)
    assert at_10500.power_pct < 70
    assert at_10500.fuel_burn_gph == pytest.approx(9.5 * at_10500.power_pct / 75.0)


def test_the_climb_falls_to_100_fpm_at_the_service_ceiling():
    assert performance.climb_rate_fpm(C172, 0.0) == 730.0
    assert performance.climb_rate_fpm(C172, 13500.0) == pytest.approx(100.0)
    assert performance.climb_rate_fpm(C172, 30000.0) == performance.MIN_CLIMB_RATE_FPM


def test_a_climbs_minutes_are_the_straight_lines_integral():
    # 730 fpm falling 630 over 13,500 ft: minutes = ln(r1 / r2) / b.
    b = 630.0 / 13500.0
    climb = performance.climb(C172, 1000.0, 8000.0)
    assert climb.minutes == pytest.approx(math.log((730.0 - b * 1000.0) / (730.0 - b * 8000.0)) / b, rel=1e-3)
    # Burning the climb's sea-level flow as full-throttle power falls:
    # less than that flow for the whole time, more than the cruise's.
    assert climb.minutes / 60 * 8.5 < climb.gallons < climb.minutes / 60 * performance.climb_burn_gph(C172)
    assert performance.climb(C172, 8000.0, 1000.0) == (0.0, 0.0)


def test_a_warm_days_climb_is_slower():
    assert performance.climb(C172, 1000.0, 8000.0, 15.0).minutes > performance.climb(C172, 1000.0, 8000.0).minutes * 1.15


def test_the_service_ceiling_comes_down_on_a_warm_day_and_up_on_a_cold_one():
    assert performance.altitude_at_density_altitude(13500.0, _isa_plus(0)) == pytest.approx(13500.0, abs=1)
    warm = performance.altitude_at_density_altitude(13500.0, _isa_plus(15))
    cold = performance.altitude_at_density_altitude(13500.0, _isa_plus(-10))
    assert 11500 < warm < 12000 and 14500 < cold < 15000
