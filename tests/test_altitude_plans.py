"""The legal-altitude arithmetic and the three plans -- lowest, highest,
fastest -- over a small route with hand-set winds, no network anywhere:
the per-leg wind lookup is stubbed, and the segments come in the shape
vfr.altitude.select_cruise_altitude produces."""
import pytest

from vfr import navlog
from vfr.altitude import is_eastbound, legal_cruising_altitudes, lowest_vfr_cruising_altitude

PROFILE = {"cruise_tas_kt": 100.0, "fuel_burn_gph": 8.0, "climb_rate_fpm_sea_level": 800.0, "climb_tas_kt": 70.0}


def test_lowest_legal_altitude_follows_the_hemispheric_rule():
    assert lowest_vfr_cruising_altitude(2200.0, 328.0) == 2500.0   # westbound: even thousands + 500
    assert lowest_vfr_cruising_altitude(2200.0, 90.0) == 3500.0    # eastbound: odd thousands + 500


def test_the_hemisphere_is_decided_once_for_the_page_to_name():
    assert is_eastbound(0.0) and is_eastbound(179.9)
    assert not is_eastbound(180.0) and not is_eastbound(328.0)
    assert is_eastbound(-10.0) is False and is_eastbound(370.0) is True


def test_legal_altitudes_run_from_the_floor_to_the_ceiling():
    assert legal_cruising_altitudes(2200.0, 7000.0, 328.0) == [2500.0, 4500.0, 6500.0]
    assert legal_cruising_altitudes(2200.0, 3600.0, 328.0) == [2500.0]
    assert legal_cruising_altitudes(3000.0, 3600.0, 328.0) == []


def test_legal_altitudes_stop_under_class_a_when_nothing_else_caps_them():
    assert legal_cruising_altitudes(1000.0, None, 90.0)[-1] == 17500.0


def test_climb_penalty_charges_climbs_only():
    assert navlog.climb_penalty_min(-2000.0, PROFILE) == 0.0
    # 2,000 ft at 600 fpm (800 x 0.75) is 3.3 min, at 70 kt rather than
    # 100: 30% of that time is ground not covered.
    assert navlog.climb_penalty_min(2000.0, PROFILE) == pytest.approx(1.0, abs=0.01)


# A straight north-east course: three fixes, two legs, each 60 nm.
FIXES = [
    {"name": "AAA", "category": "departure", "lat": 40.0, "lon": -90.0},
    {"name": "Lake", "category": "lake", "lat": 40.7, "lon": -89.1},
    {"name": "BBB", "category": "destination", "lat": 41.4, "lon": -88.2},
]


def _segments(candidates_per_leg):
    return [
        {"from_nm": 0.0, "to_nm": 60.0, "floor_ft": 2000.0, "airspace_ceiling_ft": None,
         "band_ceiling_ft": max(c) if c else None, "candidates_ft": list(c)}
        for c in candidates_per_leg
    ]


def _winds(by_altitude):
    """A wind_at_altitude stand-in: the same wind everywhere, keyed by altitude."""
    def wind(lat, lon, altitude_ft, fcst_hr="06"):
        return by_altitude.get(altitude_ft)
    return wind


def test_fastest_climbs_for_a_tailwind_and_lowest_stays_low(monkeypatch):
    # Dead calm at 3,500, a 30 kt tailwind straight up the course at
    # 5,500 and 7,500: climbing pays, and lowest ignores it.
    monkeypatch.setattr(navlog, "wind_at_altitude", _winds({
        3500.0: {"wind_dir_true_deg": 225.0, "wind_speed_kt": 0.0},
        5500.0: {"wind_dir_true_deg": 225.0, "wind_speed_kt": 30.0},
        7500.0: {"wind_dir_true_deg": 225.0, "wind_speed_kt": 30.0},
    }))
    plans = navlog.altitude_profiles(FIXES, _segments([[3500.0, 5500.0, 7500.0]] * 2), PROFILE)

    assert [s["altitude_ft"] for s in plans["lowest"]["steps"]] == [3500.0]
    assert [s["altitude_ft"] for s in plans["highest"]["steps"]] == [7500.0]
    # 5,500 has the whole tailwind and a shorter climb than 7,500.
    assert [s["altitude_ft"] for s in plans["fastest"]["steps"]] == [5500.0]
    assert plans["fastest"]["ete_min"] < plans["lowest"]["ete_min"]
    assert plans["fastest"]["tailwind_kt"] == pytest.approx(30.0, abs=0.5)
    assert plans["lowest"]["steps"][0]["from"] == "AAA" and plans["lowest"]["steps"][0]["to"] == "BBB"


def test_a_shelf_over_the_first_leg_makes_the_plans_step(monkeypatch):
    # Under a Class B shelf the first leg can only fly 3,500; past it
    # the band opens up. Highest and fastest step up after the shelf;
    # lowest stays at 3,500 throughout, since stepping buys it nothing.
    monkeypatch.setattr(navlog, "wind_at_altitude", _winds({
        3500.0: {"wind_dir_true_deg": 225.0, "wind_speed_kt": 0.0},
        5500.0: {"wind_dir_true_deg": 225.0, "wind_speed_kt": 25.0},
    }))
    plans = navlog.altitude_profiles(FIXES, _segments([[3500.0], [3500.0, 5500.0]]), PROFILE)

    assert [s["altitude_ft"] for s in plans["lowest"]["steps"]] == [3500.0]
    assert [(s["from"], s["to"], s["altitude_ft"]) for s in plans["highest"]["steps"]] == [
        ("AAA", "Lake", 3500.0), ("Lake", "BBB", 5500.0),
    ]
    assert [s["altitude_ft"] for s in plans["fastest"]["steps"]] == [3500.0, 5500.0]
    assert plans["fastest"]["legs"][1]["altitude_ft"] == 5500.0
    assert plans["fastest"]["climb_penalty_min"] > plans["lowest"]["climb_penalty_min"]


def test_a_plan_says_whether_it_needs_oxygen(monkeypatch):
    monkeypatch.setattr(navlog, "wind_at_altitude", _winds({}))
    # The second leg's only legal altitudes are above 12,500 ft, so
    # every plan goes there and says so; the page words the rule.
    plans = navlog.altitude_profiles(FIXES, _segments([[3500.0, 13500.0], [13500.0, 15500.0]]), PROFILE)
    assert all(plan["needs_oxygen"] for plan in plans.values())
    plans = navlog.altitude_profiles(FIXES, _segments([[3500.0, 5500.0]] * 2), PROFILE)
    assert not any(plan["needs_oxygen"] for plan in plans.values())


def test_a_leg_with_no_legal_altitude_means_no_plan(monkeypatch):
    monkeypatch.setattr(navlog, "wind_at_altitude", _winds({}))
    assert navlog.altitude_profiles(FIXES, _segments([[3500.0], []]), PROFILE) == {}


def _cruise_leg(distance_nm, altitude_ft, gs_kt=100.0):
    return {
        "distance_nm": distance_nm, "altitude_ft": altitude_ft, "groundspeed_kt": gs_kt,
        "ete_min": distance_nm / gs_kt * 60, "fuel_gal": distance_nm / gs_kt * PROFILE["fuel_burn_gph"], "wind": None,
    }


def test_the_climb_from_the_field_is_flown_on_the_first_leg():
    # 3,000 ft at 600 fpm is five minutes, at 70 kt over the ground:
    # 5.8 nm of the first 60 nm leg climbing, the rest at cruise.
    legs = navlog.with_climbs([_cruise_leg(60.0, 3500.0), _cruise_leg(60.0, 3500.0)], 500.0, PROFILE)
    assert legs[0]["climb_min"] == 5.0
    assert legs[0]["ete_min"] == pytest.approx(5.0 + (60.0 - 5.83) / 100 * 60, abs=0.05)
    assert legs[0]["fuel_gal"] > _cruise_leg(60.0, 3500.0)["fuel_gal"]
    assert legs[1]["climb_min"] == 0.0 and legs[1]["ete_min"] == pytest.approx(36.0)


def test_a_step_up_mid_route_is_climbed_on_the_leg_that_steps():
    legs = navlog.with_climbs([_cruise_leg(60.0, 3500.0), _cruise_leg(60.0, 5500.0)], None, PROFILE)
    assert legs[0]["climb_min"] == 0.0            # started level at the first leg's altitude
    assert legs[1]["climb_min"] == pytest.approx(2000.0 / 600.0, abs=0.05)


def test_a_climb_longer_than_a_leg_carries_into_the_next():
    # 9,000 ft at 600 fpm is fifteen minutes; a 10 nm first leg at 70 kt
    # takes 8.6 of them, the rest lands on the second leg.
    legs = navlog.with_climbs([_cruise_leg(10.0, 9500.0), _cruise_leg(60.0, 9500.0)], 500.0, PROFILE)
    assert legs[0]["climb_min"] == pytest.approx(8.6, abs=0.05)
    assert legs[1]["climb_min"] == pytest.approx(15.0 - 8.57, abs=0.05)
