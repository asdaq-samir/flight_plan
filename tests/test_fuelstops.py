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


def test_the_fields_along_each_flight_in_route_order_the_routes_own_left_out():
    found = fuelstops.along(
        [("A", START, (0.0, 5.0)), ("MID", (0.0, 5.0), END)],
        skip={"A", "MID", "B"},
        fields=fields(("LATE", 0.0, 4.0), ("EARLY", 0.0, 1.0), ("SECOND", 0.1, 7.0), ("OFF", 3.0, 2.0), ("MID", 0.0, 5.0),
                      ("SHORT", 0.0, 3.0)),
    )
    # On the first flight in order, then the second's; one far off the line,
    # a short runway and the route's own fields not at all.
    assert [(f["ident"], f["flight"], f["departure"]) for f in found] == [
        ("EARLY", 0, "A"), ("LATE", 0, "A"), ("SECOND", 1, "MID")]
    assert found[0]["from_nm"] == pytest.approx(60, abs=1) and found[0]["fuel_types"] == ["100LL"]


def test_a_long_trip_is_given_every_stop_it_needs_at_once():
    # 1,500 nm at 340 nm a tank: four stops, where three were the most
    # put in, and the fourth asked for only once the three were kept.
    end = (0.0, 25.0)
    stops, _ = fuelstops.suggest(START, end, fields=fields(*[(f"S{k}", 0.0, 5.0 * k) for k in range(1, 5)]), **FIGURES)
    assert [s.ident for s in stops] == ["S1", "S2", "S3", "S4"]
