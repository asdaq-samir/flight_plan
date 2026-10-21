"""Fuel stops in the trip's totals (plan.fuel_stops_of)."""

from app.common import Route
from app.routers import plan
from vfr.fuelstops import FuelStop

ROUTE = Route(("C81", "KJAX"), ({"lat": 42.3, "lon": -88.1}, {"lat": 30.5, "lon": -81.7}))
SHORT = {"fuel_margin_gal": -15.0, "usable_fuel_gal": 48.0, "distance_nm": 774.0, "fuel_gal": 61.0, "ete_min": 387.0,
         "taxi_gal": 1.4, "reserve_gal": 4.75}
STOP = FuelStop(ident="KSCX", name="SCOTT MUNI", city="ONEIDA", lat=36.45, lon=-84.59, from_nm=388.0, added_nm=0.0,
                lands_with_gal=16.0, minutes=194.0, fuel_types="100LL,A+", runway_ft=5505, elevation_ft=1545.0)


def test_a_flight_the_tanks_do_not_hold_gets_its_stops(monkeypatch):
    asked = {}

    def suggest(start, end, **figures):
        asked.update(figures, start=start, end=end)
        return [STOP], []

    monkeypatch.setattr(plan.fuelstops, "suggest", suggest)
    out = plan.fuel_stops_of(ROUTE, [SHORT])
    assert out == [{"departure": "C81", "destination": "KJAX", "usable_gal": 48.0, "stops": [STOP.as_dict()], "choices": []}]
    # The flight's own burn and minutes a mile, its reserve, and none of
    # the route's own fields offered.
    assert asked["fuel_per_nm"] == SHORT["fuel_gal"] / SHORT["distance_nm"]
    assert asked["min_per_nm"] == SHORT["ete_min"] / SHORT["distance_nm"]
    assert asked["reserve_gal"] == 4.75 and asked["skip"] == {"C81", "KJAX"}


def test_none_where_the_fuel_check_passes_or_cannot_be_made(monkeypatch):
    monkeypatch.setattr(plan.fuelstops, "suggest", lambda *a, **k: (_ for _ in ()).throw(AssertionError("asked")))
    assert plan.fuel_stops_of(ROUTE, [{**SHORT, "fuel_margin_gal": 2.0}]) == []
    assert plan.fuel_stops_of(ROUTE, [{**SHORT, "usable_fuel_gal": None}]) == []
    assert plan.fuel_stops_of(ROUTE, [{**SHORT, "fuel_gal": None}]) == []
