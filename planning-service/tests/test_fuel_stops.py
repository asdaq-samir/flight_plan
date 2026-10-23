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
    assert out == [{"departure": "C81", "destination": "KJAX", "usable_gal": 48.0, "reason": "fuel",
                    "stops": [STOP.as_dict()], "choices": []}]
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


def test_the_fields_along_the_route_with_their_places_once_read(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app
    route = Route(("C81", "KOMA"), ({"lat": 42.3, "lon": -88.1}, {"lat": 41.3, "lon": -95.9}))
    monkeypatch.setattr(plan, "load_route", lambda dep, dest, stops="": route)
    monkeypatch.setattr(plan.fuelstops, "along", lambda flights, skip: [
        {"ident": "KIOW", "name": "IOWA CITY MUNI", "city": "IOWA CITY", "lat": 41.64, "lon": -91.55, "flight": 0, "departure": "C81",
         "from_nm": 152.0, "added_nm": 1.8, "fuel_types": ["100LL"], "runway_ft": 4355, "elevation_ft": 668.0},
        {"ident": "KVTI", "name": "VINTON VETERANS MEML", "city": "VINTON", "lat": 42.22, "lon": -92.03, "flight": 0, "departure": "C81",
         "from_nm": 175.0, "added_nm": 2.0, "fuel_types": ["100LL"], "runway_ft": 4200, "elevation_ft": 842.0}])
    diner = {"name": "Dairy Queen", "kind": "Fast food restaurant", "distance_m": 700, "walk_min": 9, "phone": None,
             "website": None, "lat": 41.6, "lon": -91.5}
    monkeypatch.setattr(plan.nearby, "kept", lambda ident: {"food": [diner], "lodging": [], "cars": []} if ident == "KIOW" else None)
    later = []
    monkeypatch.setattr(plan.nearby, "read_later", lambda ident, lat, lon: later.append(ident))
    monkeypatch.setattr(plan.nearby, "courtesy_car", lambda ident: ident == "KVTI")
    body = TestClient(app).get("/api/route-stops?dep=C81&dest=KOMA").json()
    assert body["pending"] == 1 and later == ["KVTI"]
    kiow, kvti = body["fields"]
    assert kiow["food"] == diner and kiow["nearby_known"] is True and kiow["lodging"] is None
    assert kvti["nearby_known"] is False and kvti["courtesy_car"] is True
