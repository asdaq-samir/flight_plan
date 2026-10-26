"""The map's fly-in food (/api/airports/food): fields with somewhere to eat
a short walk from the ramp, nearest first."""

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


def test_fields_with_food_at_the_airport_itself_nearest_first_the_unread_asked_for(monkeypatch):
    read: list[str] = []
    kept = {"KAAA": {"food": [DINER, ACROSS, TOWN]}, "KBBB": {"food": [ACROSS, TOWN]}, "KMIL": {"food": [DINER]}, "KORD": {"food": [DINER]}}
    monkeypatch.setattr(router.airports, "nearest", lambda lat, lon, limit: FIELDS)
    monkeypatch.setattr(router, "_owners", lambda places: [(p["ident"] == "KMIL", False) for p in places])
    monkeypatch.setattr(router.nearby, "kept", lambda ident: kept.get(ident))
    monkeypatch.setattr(router.nearby, "read_later", lambda ident, lat, lon: read.append(ident))
    answer = TestClient(app).get("/api/airports/food?lat=42.0&lon=-88.0").json()
    # KAAA's diner at the field; KBBB's food across the road and in town; the
    # military field and the airline airport not offered; KCCC's places
    # not yet read.
    assert [f["ident"] for f in answer["fields"]] == ["KAAA"]
    assert [p["name"] for p in answer["fields"][0]["food"]] == ["Runway Diner"]
    assert answer["pending"] == 1 and read == ["KCCC"]
