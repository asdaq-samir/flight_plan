"""app.gonogo.weight_balance and app.gonogo.runways, with
web/src/lib/weightBalance.test.ts's, runwayCheck.test.ts's and
runwayFlown.test.ts's cases, on the stock profile itself
(data/aircraft/c172.json, the 172S's POH figures)."""
import pytest
from vfr.aircraft import load_aircraft_profile

from app.gonogo.runways import (
    density_altitude_ft, field_air, picked_end, runway_checks, runway_flown, short_field, soft_surface,
)
from app.gonogo.weight_balance import balance, default_load, in_envelope

C172 = {"name": "c172", **load_aircraft_profile("c172")}
LOADING = C172["loading"]


def test_the_pohs_own_sample_loading_weighs_2550_lb_at_takeoff_within_the_envelope():
    # Figure 6-5's sample: empty 1,642 lb at 62.6 (thousand lb-in), 30 gal,
    # 340 lb in front, 340 behind, 56 lb of baggage in area 1 at its arm of 95 in.
    b = balance(LOADING, {"empty_weight_lb": 1642, "empty_arm_in": 62600 / 1642, "stations_lb": [340, 340, 56, 0], "fuel_gal": 30}, 0)
    assert b["takeoff"]["weight_lb"] == 2550
    assert b["takeoff"]["arm_in"] == pytest.approx((62600 + 180 * 48 + 340 * 37 + 340 * 73 + 56 * 95 - 8 * 48) / 2550, abs=1e-6)
    assert b["problems"] == []


def test_over_its_weight_and_the_baggage_over_its_own():
    b = balance(LOADING, {"empty_weight_lb": 1642, "empty_arm_in": 38.1, "stations_lb": [170, 400, 120, 50], "fuel_gal": 53}, 10)
    assert "The takeoff weight, 2,692 lb, is 142 lb over its most" in b["problems"]
    assert "The baggage, 170 lb in all, is over its 120 lb" in b["problems"]


def test_the_envelope_is_the_pohs():
    envelope = LOADING["envelope"]
    assert in_envelope(envelope, 36, 1900) is True
    assert in_envelope(envelope, 36, 2500) is False
    assert in_envelope(envelope, 47.5, 2000) is False


def test_the_default_load_is_the_sample_airplane_and_a_pilot():
    assert default_load(LOADING, 40) == {"empty_weight_lb": 1642, "empty_arm_in": 38.12, "stations_lb": [170, 0, 0, 0], "fuel_gal": 40}


TAKEOFF, LANDING = C172["takeoff"], C172["landing"]


def test_the_table_at_sea_level_and_15_c_half_way_between_its_10_and_20():
    assert short_field(TAKEOFF, 0, 15, 2550, 0, False) == {"ground_roll_ft": 960, "total_ft": 1635, "caveats": []}


def test_a_headwind_takes_a_tenth_off_every_9_kt_a_tailwind_adds_a_tenth_every_2_grass_the_ground_rolls_15_pct():
    assert short_field(TAKEOFF, 0, 10, 2550, 9, False)["ground_roll_ft"] == 835      # 925 less 10%
    assert short_field(TAKEOFF, 0, 10, 2550, -2, False)["ground_roll_ft"] == 1020    # 925 and 10%
    grass = short_field(TAKEOFF, 0, 10, 2550, 0, True)
    assert (grass["ground_roll_ft"], grass["total_ft"]) == (1065, 1715)


def test_between_its_weights_and_its_one_landing_table_at_any_weight():
    assert short_field(TAKEOFF, 0, 0, 2475, 0, False)["ground_roll_ft"] == 805       # between 860 and 745
    landing = short_field(LANDING, 2000, 20, 2200, 0, False)
    assert (landing["ground_roll_ft"], landing["total_ft"]) == (630, 1420)


def test_density_altitude_is_the_pressure_altitude_on_a_standard_day_and_higher_the_hotter_it_is():
    assert density_altitude_ft(0, 15) == pytest.approx(0, abs=1e-6)
    # ISA at 5,000 ft is 5.1 °C: at 25 °C the rule of thumb's 120 ft a
    # degree gives 7,390 ft; the atmosphere itself, 7,260.
    assert density_altitude_ft(5000, 5.094) == pytest.approx(5000, abs=5)
    assert 7200 < density_altitude_ft(5000, 25) < 7400
    assert density_altitude_ft(2000, -10) < 2000


def test_a_fields_air_off_the_altimeter_and_a_standard_days_temperature_where_none_is_reported():
    # A thousand feet an inch under 29.92; ISA at 900 ft is 13.2 °C.
    air = field_air(900, 29.42, 25)
    assert air["pressure_alt_ft"] == pytest.approx(1400)
    assert air["temp_c"] == 25
    standard = field_air(900, None, None)
    assert standard["pressure_alt_ft"] == 900
    assert standard["temp_c"] == pytest.approx(13.2, abs=0.05)


def test_takes_turf_grass_dirt_and_gravel_as_soft_and_asphalt_not():
    assert [soft_surface({"surface": s}) for s in ["TURF", "GRS", "grass", "DIRT", "GRAVEL-G"]] == [True] * 5
    assert soft_surface({"surface": "ASPH-G"}) is False
    assert soft_surface(None) is False


def runway(length: int, headwind: float, crosswind: float, **extra) -> dict:
    return {"ends": "09/27", "length_ft": length, "width_ft": 75, "surface": "ASP", "lighted": True, "closed": False,
            "runway_ends": [], "wind": {"end": "27", "headwind_kt": headwind, "crosswind_kt": crosswind}, **extra}


FIELDS = [{"ident": "C81", "elevation_ft": 900}, {"ident": "KDLH", "elevation_ft": 1400}]
BRIEFING = {
    "metars": {"C81": {"temp_c": 30, "altimeter_in_hg": 29.92}, "KDLH": None},
    "airports": {
        "C81": {"runways": [runway(1500, 2, 18)]},
        "KDLH": {"runways": [runway(9000, 10, 3), runway(12000, 0, 0, closed=True)]},
    },
}


def test_takes_off_from_the_departure_and_lands_at_the_destination_on_the_runway_the_wind_favours():
    start, end = runway_checks(C172, BRIEFING, FIELDS, 2550, 2400)
    assert start["role"] == "Departure"
    assert [d["kind"] for d in start["distances"]] == ["takeoff"]
    assert [d["kind"] for d in end["distances"]] == ["landing"]
    # A closed runway is not one to land on, however long.
    assert end["runway"]["length_ft"] == 9000
    assert end["reported"] is False


def test_says_a_runway_too_short_and_a_crosswind_past_the_172s_demonstrated_15_kt():
    start, end = runway_checks(C172, BRIEFING, FIELDS, 2550, 2400)
    assert start["distances"][0]["over"] is True
    assert start["crosswind_kt"] == 18
    assert start["crosswind_over"] is True
    assert start["density_alt_ft"] > start["pressure_alt_ft"]
    assert end["distances"][0]["over"] is False
    assert end["crosswind_over"] is False


def ends(a: str, b: str) -> list[dict]:
    return [{"ident": a, "heading_true_deg": 0}, {"ident": b, "heading_true_deg": 180}]


def test_checks_the_runway_the_pilot_picked_whatever_the_wind_with_the_wind_on_the_end_picked():
    # KDLH: a long runway into the wind, and a short one the pilot picked.
    picked = {**BRIEFING, "airports": {**BRIEFING["airports"], "KDLH": {"runways": [
        runway(9000, 10, 3, ends="09/27", runway_ends=ends("09", "27")),
        runway(1200, 8, 0, ends="18/36", runway_ends=ends("18", "36"), wind={"end": "36", "headwind_kt": 8, "crosswind_kt": 0}),
    ]}}}
    into = runway_checks(C172, picked, FIELDS, 2550, 2400)[1]
    assert [into["end"], into["picked"], into["distances"][0]["over"]] == ["27", False, False]
    flown = runway_checks(C172, picked, FIELDS, 2550, 2400, {"pattern": {"KDLH": "18"}, "takeoff": {}})[1]
    # 18 is the far end of the wind's 36: its headwind is a tailwind.
    assert [flown["end"], flown["picked"], flown["headwind_kt"], flown["runway"]["length_ft"]] == ["18", True, -8, 1200]
    assert flown["distances"][0]["over"] is True


def test_is_not_worked_out_without_the_pohs_tables():
    assert runway_checks({**C172, "takeoff": None}, BRIEFING, FIELDS, 2550, 2400) == []


def flown_runway(pairs: list[tuple[str, float]], length: int, wind: dict | None = None, closed: bool = False) -> dict:
    return {"closed": closed, "ends": "/".join(p[0] for p in pairs), "length_ft": length, "lighted": True, "surface": "ASP",
            "turf": [], "width_ft": 75, "runway_ends": [{"ident": i, "heading_true_deg": h, "traffic": "left"} for i, h in pairs],
            "wind": wind}


# A long runway into the wind and a short one across it.
FIELD = [
    flown_runway([("09", 90), ("27", 270)], 6000, {"end": "27", "headwind_kt": 12, "crosswind_kt": 1, "gust_crosswind_kt": None}),
    flown_runway([("18", 180), ("36", 360)], 2400, {"end": "36", "headwind_kt": 0, "crosswind_kt": -12, "gust_crosswind_kt": None}),
]


def test_runway_flown_the_pilots_pick_where_they_made_one_even_off_the_wind():
    flown = runway_flown(FIELD, "36")
    assert flown["end"]["ident"] == "36"
    assert flown["runway"]["length_ft"] == 2400


def test_runway_flown_else_the_runway_most_nearly_into_the_wind():
    assert runway_flown(FIELD, None)["end"]["ident"] == "27"
    assert runway_flown(FIELD, "NONE")["end"]["ident"] == "27"


def test_a_pick_on_a_closed_runway_or_one_the_field_doesnt_have_falls_back_to_the_winds():
    closed = [FIELD[0], flown_runway([("18", 180), ("36", 360)], 2400, None, True)]
    assert runway_flown(closed, "36")["end"]["ident"] == "27"
    assert runway_flown(FIELD, "4")["end"]["ident"] == "27"


PICKS = {"pattern": {"C81": "24", "UES": "10", "KDLH": "NONE"}, "takeoff": {"UES": "28"}}


def test_picked_end_the_departures_runway_out_and_every_fields_runway_in_from_pattern_a_stops_runway_out_from_takeoff():
    assert picked_end(PICKS, "C81", "takeoff", True) == "24"
    assert picked_end(PICKS, "UES", "landing", False) == "10"
    assert picked_end(PICKS, "UES", "takeoff", False) == "28"


def test_picked_end_by_the_fields_icao_or_faa_ident_alike_none_for_no_pick_or_the_pilots_none():
    assert picked_end(PICKS, "KUES", "landing", False) == "10"
    assert picked_end(PICKS, "KDLH", "landing", False) is None
    assert picked_end(PICKS, "KMSN", "landing", False) is None
    assert picked_end(None, "C81", "takeoff", True) is None
