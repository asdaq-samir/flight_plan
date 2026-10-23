"""vfr.fuelstops: where a flight too long for its tanks lands for fuel."""

import pandas as pd
import pytest

from vfr import fuelstops

# On the equator a degree of longitude is about 60 nm, so the fields below
# are where their longitudes say along a course due east from 0,0.
START, END = (0.0, 0.0), (0.0, 10.0)  # about 600 nm
# 10 gal/h at 100 kt: a tenth of a gallon and 0.6 min a mile.
FIGURES = dict(fuel_per_nm=0.1, min_per_nm=0.6, usable_gal=40.0, taxi_gal=1.0, reserve_gal=5.0)


def fields(*rows) -> pd.DataFrame:
    return pd.DataFrame([
        {"ident": ident, "faa_ident": ident, "name": f"{ident} FIELD", "city": "SOMEWHERE", "lat": lat, "lon": lon,
         "elevation_ft": 500.0, "fuel_types": "100LL"}
        for ident, lat, lon in rows
    ])


@pytest.fixture(autouse=True)
def paved(monkeypatch):
    # Every field a 5,000 ft paved runway, but SHORT's 1,800 ft.
    monkeypatch.setattr(fuelstops, "paved_runway_ft", lambda ident: 1800 if ident == "SHORT" else 5000)


def test_no_stop_where_the_tanks_hold_the_flight():
    assert fuelstops.suggest(START, (0.0, 3.0), fields=fields(("MID", 0.0, 1.5)), **FIGURES) == ([], [])


def test_one_stop_on_the_line_before_one_off_it():
    stops, choices = fuelstops.suggest(START, END, fields=fields(("ONLINE", 0.0, 5.0), ("OFFLINE", 0.3, 5.0)), **FIGURES)
    assert [s.ident for s in stops] == ["ONLINE"]
    assert [c.ident for c in choices] == ["OFFLINE"]
    assert stops[0].added_nm == pytest.approx(0.0, abs=0.1)
    # 300 nm at 0.1 gal a mile and the taxi allowance from 40 gal.
    assert stops[0].lands_with_gal == pytest.approx(40 - 1 - 30, abs=0.3)


def test_of_two_as_quick_the_one_that_lands_with_more_fuel_on_both_legs():
    # Both on the line, so the trip takes the same time; the one in the
    # middle leaves neither leg close to the reserve.
    stops, _ = fuelstops.suggest(START, END, fields=fields(("EARLY", 0.0, 4.5), ("MIDDLE", 0.0, 5.0)), **FIGURES)
    assert [s.ident for s in stops] == ["MIDDLE"]


def test_every_landing_keeps_the_reserve():
    # The tanks reach 340 nm (40 - 1 - 5 gal at 0.1 a mile): a field 6
    # degrees out, 360 nm, is out of reach and the flight has no stop.
    assert fuelstops.suggest(START, END, fields=fields(("FAR", 0.0, 6.0)), **FIGURES) == ([], [])


def test_two_stops_where_one_is_not_enough():
    stops, _ = fuelstops.suggest(START, (0.0, 15.0), fields=fields(("A", 0.0, 5.0), ("B", 0.0, 10.0)), **FIGURES)
    assert [s.ident for s in stops] == ["A", "B"]
    assert stops[1].from_nm == pytest.approx(600, abs=2)
    assert all(s.lands_with_gal >= FIGURES["reserve_gal"] for s in stops)


def test_a_short_runway_and_the_routes_own_fields_are_never_offered():
    stops, choices = fuelstops.suggest(
        START, END, fields=fields(("SHORT", 0.0, 5.0), ("MINE", 0.0, 4.5), ("OK", 0.0, 5.5)), skip={"MINE"}, **FIGURES)
    assert [s.ident for s in stops] + [c.ident for c in choices] == ["OK"]


def test_a_break_about_half_way_on_a_long_flight_the_tanks_hold():
    # 400 nm at 0.6 min a mile is four hours; 40 gal at 0.1 a mile hold it.
    end = (0.0, 6.6667)
    stops, choices = fuelstops.suggest_break(
        START, end, fields=fields(("EARLY", 0.0, 1.0), ("NEARMID", 0.0, 3.0), ("MIDOFF", 1.0, 3.3), ("LATE", 0.0, 4.2)),
        fuel_per_nm=0.1, min_per_nm=0.6, usable_gal=40.0, taxi_gal=1.0)
    # On the line and nearest the middle first; one 18 nm off the line
    # after a field on it; one a sixth of the way not at all.
    assert [s.ident for s in stops] == ["NEARMID"]
    assert [c.ident for c in choices] == ["LATE", "MIDOFF"]
    # 180 nm flown from 40 gal less the taxi allowance.
    assert stops[0].lands_with_gal == pytest.approx(40 - 1 - 18, abs=0.3)
    assert stops[0].minutes == pytest.approx(108, abs=1)


def test_no_break_on_a_flight_of_three_hours_or_less():
    # 294 nm at 0.6 min a mile: under three hours.
    assert fuelstops.suggest_break(START, (0.0, 4.9), fields=fields(("MID", 0.0, 2.45)),
                                   fuel_per_nm=0.1, min_per_nm=0.6, usable_gal=40.0, taxi_gal=1.0) == ([], [])


def test_a_field_with_food_a_walk_away_goes_before_a_quicker_one_with_nothing():
    # Both reach and keep the reserve; FOOD's 6 nm off the line cost under
    # APPEAL_MINUTES, so its diner a walk away wins it.
    asked = []

    def appeal(fields):
        asked.extend(ident for ident, _, _ in fields)
        return {"FOOD": 3}

    stops, choices = fuelstops.suggest(START, END, fields=fields(("PLAIN", 0.0, 5.0), ("FOOD", 0.1, 5.0)), appeal=appeal, **FIGURES)
    assert [s.ident for s in stops] == ["FOOD"] and [c.ident for c in choices] == ["PLAIN"]
    assert sorted(asked) == ["FOOD", "PLAIN"]


def test_food_is_not_worth_more_than_appeal_minutes():
    # FAR adds 26 nm, 16 minutes: more than a meal is worth.
    stops, _ = fuelstops.suggest(START, END, fields=fields(("PLAIN", 0.0, 5.0), ("FAR", 1.5, 5.0)),
                                 appeal=lambda f: {"FAR": 4}, **FIGURES)
    assert [s.ident for s in stops] == ["PLAIN"]


def test_a_break_at_the_field_with_the_most_on_the_ground():
    end = (0.0, 6.6667)
    stops, choices = fuelstops.suggest_break(
        START, end, fields=fields(("NEARMID", 0.0, 3.0), ("LATE", 0.0, 4.2)), appeal=lambda f: {"LATE": 2},
        fuel_per_nm=0.1, min_per_nm=0.6, usable_gal=40.0, taxi_gal=1.0)
    assert [s.ident for s in stops] == ["LATE"] and [c.ident for c in choices] == ["NEARMID"]
