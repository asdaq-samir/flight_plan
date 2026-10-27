"""The map's Stops (/api/stops/near and /api/stops/along): the fields with
fuel, food, repair or a flight school, near the pilot or along a route,
each with what it has of the four and its phone."""
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.main import app
from app.routers import airports as router

FIELDS = [
    {"ident": "KAAA", "source_ident": "KAAA", "name": "A Field", "municipality": "Aville", "lat": 42.0, "lon": -88.0,
     "distance_nm": 5.0, "bearing_deg": 90},
    {"ident": "KBBB", "source_ident": "KBBB", "name": "B Field", "municipality": "Btown", "lat": 42.5, "lon": -88.0,
     "distance_nm": 30.0, "bearing_deg": 0},
    {"ident": "KCCC", "source_ident": "KCCC", "name": "C Field", "municipality": None, "lat": 43.0, "lon": -88.0,
     "distance_nm": 60.0, "bearing_deg": 0},
    {"ident": "KMIL", "source_ident": "KMIL", "name": "Some AFB", "municipality": None, "lat": 42.2, "lon": -88.0,
     "distance_nm": 12.0, "bearing_deg": 0},
    {"ident": "KORD", "source_ident": "KORD", "name": "O'Hare", "municipality": "Chicago", "lat": 41.98, "lon": -87.9,
     "distance_nm": 15.0, "bearing_deg": 180, "kind": "large"},
]
DINER = {"name": "Runway Diner", "kind": "Diner", "distance_m": 300, "walk_min": 4, "phone": None, "website": None,
         "lat": 42.0, "lon": -88.0, "on_field": True}
ACROSS = {**DINER, "name": "Across the Road", "distance_m": 450, "walk_min": 6, "on_field": False}
TOWN = {**DINER, "name": "Downtown Grill", "distance_m": 4000, "walk_min": None, "on_field": False}
SCHOOL = {**DINER, "name": "Aville Flight School", "kind": "Flight school", "on_field": False, "walk_min": 5}
FAR_SCHOOL = {**SCHOOL, "name": "Town Flying Club", "distance_m": 5000, "walk_min": None}

NONE = {"fuel_types": [], "airframe_repair": None, "powerplant_repair": None}


def _services(by_ident: dict):
    return lambda ident, cache_dir: {**NONE, **by_ident.get(ident, {})}


def _quiet(monkeypatch, services=None, phones=None):
    monkeypatch.setattr(router.faa_data, "airport_services", _services(services or {}))
    monkeypatch.setattr(router.faa_data, "airport_contact", lambda ident, cache_dir: {"phone": (phones or {}).get(ident), "address": None})


def test_near_the_pilot_each_field_with_what_it_has_nearest_first(monkeypatch):
    read: list[str] = []
    kept = {"KAAA": {"food": [DINER, ACROSS, TOWN], "training": [SCHOOL, FAR_SCHOOL]}, "KBBB": {"food": [ACROSS, TOWN]},
            "KMIL": {"food": [DINER]}, "KORD": {"food": [DINER]}}
    monkeypatch.setattr(router.airports, "nearest", lambda lat, lon, limit: FIELDS)
    monkeypatch.setattr(router, "_owners", lambda places: [(p["ident"] == "KMIL", False) for p in places])
    monkeypatch.setattr(router.nearby, "kept", lambda ident: kept.get(ident))
    monkeypatch.setattr(router.nearby, "read_later", lambda ident, lat, lon: read.append(ident))
    _quiet(monkeypatch, services={"KAAA": {"fuel_types": ["100LL", "A"], "airframe_repair": "major", "powerplant_repair": "minor"},
                                  "KCCC": {"fuel_types": ["100LL"]}},
           phones={"KAAA": "815-555-0100"})
    answer = TestClient(app).get("/api/stops/near?lat=42.0&lon=-88.0&nm=100").json()
    # KBBB's food is across the road and in town, and it sells nothing:
    # not a stop. The military field and the airline airport not offered.
    # KCCC sells fuel, listed at once while its places are still read.
    assert [f["ident"] for f in answer["fields"]] == ["KAAA", "KCCC"]
    aaa, ccc = answer["fields"]
    assert [p["name"] for p in aaa["food"]] == ["Runway Diner"]
    # A school a walk from the field, not one in town.
    assert [p["name"] for p in aaa["training"]] == ["Aville Flight School"]
    assert (aaa["fuel_types"], aaa["airframe_repair"], aaa["powerplant_repair"]) == (["100LL", "A"], "major", "minor")
    assert aaa["phone"] == "815-555-0100" and aaa["places_known"] is True
    assert (aaa["distance_nm"], aaa["bearing_deg"], aaa["city"]) == (5.0, 90, "Aville")
    assert ccc["places_known"] is False and ccc["food"] == [] and ccc["phone"] is None
    assert answer["pending"] == 1 and read == ["KCCC"]


def test_near_the_pilot_within_the_radius_asked_twenty_five_at_first(monkeypatch):
    monkeypatch.setattr(router.airports, "nearest", lambda lat, lon, limit: FIELDS)
    monkeypatch.setattr(router, "_owners", lambda places: [(False, False) for _ in places])
    monkeypatch.setattr(router.nearby, "kept", lambda ident: {"food": [DINER]})
    _quiet(monkeypatch)
    near = TestClient(app).get("/api/stops/near?lat=42.0&lon=-88.0").json()
    # Within 25 nm: KAAA and the AFB (taken as public here); KORD's an airline airport.
    assert [f["ident"] for f in near["fields"]] == ["KAAA", "KMIL"]
    wide = TestClient(app).get("/api/stops/near?lat=42.0&lon=-88.0&nm=100").json()
    assert [f["ident"] for f in wide["fields"]] == ["KAAA", "KBBB", "KCCC", "KMIL"]


def test_along_a_route_in_route_order_with_how_far_off_course(monkeypatch):
    flight = SimpleNamespace(dep_ident="C81", start=(42.3, -88.1), end=(46.8, -92.2))
    monkeypatch.setattr(router, "load_route", lambda dep, dest, stops="": SimpleNamespace(flights=[flight], idents=("C81", "KDLH")))
    along = [{"ident": "KAAA", "name": "A", "city": "Aville", "lat": 43.0, "lon": -89.0, "departure": "C81", "from_nm": 60.0,
              "added_nm": 2.0, "flight": 0},
             {"ident": "KBBB", "name": "B", "city": "Btown", "lat": 44.0, "lon": -89.8, "departure": "C81", "from_nm": 150.0,
              "added_nm": 5.0, "flight": 0},
             # A diner on the field, but 23 nm off: past the owner's 10 to 15.
             {"ident": "KFAR", "name": "Far", "city": "Fartown", "lat": 44.0, "lon": -89.0, "departure": "C81", "from_nm": 150.0,
              "added_nm": 9.0, "flight": 0}]
    monkeypatch.setattr(router.fuelstops, "along", lambda flights, skip=None: along)
    monkeypatch.setattr(router.nearby, "kept", lambda ident: {"food": [DINER] if ident in ("KBBB", "KFAR") else [ACROSS]})
    monkeypatch.setattr(router.airports, "find_place", lambda ident: {"kind": "small"})
    _quiet(monkeypatch, services={"KAAA": {"powerplant_repair": "major"}})
    answer = TestClient(app).get("/api/stops/along?dep=C81&dest=KDLH").json()
    assert [(f["ident"], f["distance_nm"], f["added_nm"], f["departure"]) for f in answer["fields"]] == [
        ("KAAA", 60.0, 2.0, "C81"), ("KBBB", 150.0, 5.0, "C81")]
    # KAAA for its engine shop alone, its food across the road.
    assert answer["fields"][0]["food"] == [] and answer["fields"][0]["powerplant_repair"] == "major"
    assert all(0 <= f["off_nm"] <= router.STOP_OFF_COURSE_NM for f in answer["fields"])


def test_no_airline_airport_along_a_route(monkeypatch):
    flight = SimpleNamespace(dep_ident="C81", start=(42.3, -88.1), end=(42.2, -83.0))
    monkeypatch.setattr(router, "load_route", lambda dep, dest, stops="": SimpleNamespace(flights=[flight], idents=("C81", "KDET")))
    along = [{"ident": "KDTW", "name": "Detroit Metro", "city": "Detroit", "lat": 42.2, "lon": -83.35, "departure": "C81",
              "from_nm": 206.0, "added_nm": 0.3, "flight": 0}]
    monkeypatch.setattr(router.fuelstops, "along", lambda flights, skip=None: along)
    monkeypatch.setattr(router.nearby, "kept", lambda ident: {"food": [DINER]})
    monkeypatch.setattr(router.airports, "find_place", lambda ident: {"kind": "large"})
    _quiet(monkeypatch, services={"KDTW": {"fuel_types": ["100LL", "A"]}})
    assert TestClient(app).get("/api/stops/along?dep=C81&dest=KDET").json()["fields"] == []
