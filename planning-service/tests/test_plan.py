"""The plan endpoints through their response models, with every live
dependency stubbed: model-service, the airports table, the altitude
selection and the per-leg wind lookup. What this proves is the contract
-- that a real leg dict validates as a Leg (including the `from` alias),
that /api/plan and /api/checkpoints serialise, and that the nav-log
stream's lines are the messages app.schemas declares."""
import json

import pytest
from fastapi.testclient import TestClient
from vfr import airports, navlog
from vfr import altitude as altitude_module

from app import scoring
from app.main import app

client = TestClient(app)

CANDIDATES = [
    {"osm_id": "411077224", "category": "lake_or_pond", "name": "Long Lake", "lat": 42.35, "lon": -88.09,
     "predicted_score": 4.4, "along_track_nm": 3.9},
    {"osm_id": "153546173", "category": "town", "name": "Round Lake", "lat": 42.6, "lon": -88.4,
     "predicted_score": 3.9, "along_track_nm": 22.0},
]

ALTITUDE = {
    "recommended_ft": 4500.0, "floor_ft": 2200.0, "airspace_ceiling_ft": None, "airspace_transits": [],
    "freezing_level_ft": None, "band_ceiling_ft": None, "min_ceiling_ft": None, "min_visibility_sm": None,
    "hazards": [], "low_ceiling_or_visibility": False, "weather_unavailable": [],
}


def _airport(ident: str) -> dict:
    coords = {"C81": (42.3172, -88.0905), "KDLH": (46.8421, -92.1936)}[ident]
    return {"ident": ident, "name": ident, "lat": coords[0], "lon": coords[1], "elevation_ft": 900.0,
            "municipality": "", "region": ""}


def _leg(start, end, altitude_ft, profile) -> dict:
    """What vfr.navlog.assemble_leg returns, minus the live winds call."""
    return {
        "true_course_deg": 320.0, "distance_nm": 10.0, "altitude_ft": altitude_ft,
        "wind": {"wind_dir_true_deg": 270.0, "wind_speed_kt": 15.0},
        "wca_deg": -6.0, "true_heading_deg": 314.0, "magnetic_variation_deg": -3.0,
        "magnetic_heading_deg": 317.0, "groundspeed_kt": 105.0, "ete_min": 5.7, "fuel_gal": 0.8,
    }


@pytest.fixture(autouse=True)
def _stubbed_world(monkeypatch):
    monkeypatch.setattr(airports, "get_airport", lambda ident, **kw: _airport(ident.upper()))
    monkeypatch.setattr(scoring, "invoke_model", lambda dep, dest, model=None: {"checkpoints": [dict(c) for c in CANDIDATES]})
    monkeypatch.setattr(altitude_module, "select_cruise_altitude", lambda start, end, profile: dict(ALTITUDE))
    monkeypatch.setattr(navlog, "assemble_leg", _leg)


def test_checkpoints_marks_the_selected_candidates():
    resp = client.get("/api/checkpoints", params={"dep": "c81", "dest": "kdlh"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["departure"]["ident"] == "C81"
    assert {c["osm_id"] for c in body["selected"]} <= {c["osm_id"] for c in body["candidates"]}
    assert all("selected" in c for c in body["candidates"])


def test_plan_returns_legs_with_from_and_to_and_totals():
    resp = client.get("/api/plan", params={"dep": "C81", "dest": "KDLH"})

    assert resp.status_code == 200
    body = resp.json()
    legs = body["legs"]
    assert legs[0]["from"] == "C81" and legs[-1]["to"] == "KDLH"
    assert len(legs) == len(body["selected"]) + 1
    assert body["totals"]["unflyable_legs"] == 0
    assert body["altitude_ft"] == 4500.0
    assert body["aircraft"]["name"] == "c172" and body["aircraft"]["cruise_tas_kt"] > 0


def test_plan_refuses_a_route_with_no_legal_altitude(monkeypatch):
    monkeypatch.setattr(altitude_module, "select_cruise_altitude",
                        lambda start, end, profile: {**ALTITUDE, "recommended_ft": None})

    resp = client.get("/api/plan", params={"dep": "C81", "dest": "KDLH"})

    assert resp.status_code == 422


def test_navlog_streams_altitude_then_legs_then_done():
    resp = client.get("/api/navlog", params={"dep": "C81", "dest": "KDLH"})

    assert resp.status_code == 200
    messages = [json.loads(line) for line in resp.text.splitlines() if line.strip()]
    types = [m["type"] for m in messages]
    assert types[0] == "stage" and types[-1] == "done"
    assert types.index("altitude") < types.index("leg")
    legs = [m for m in messages if m["type"] == "leg"]
    assert legs[0]["from"] == "C81" and legs[0]["wind"]["wind_speed_kt"] == 15.0
    assert messages[-1]["totals"]["distance_nm"] == 10.0 * len(legs)


def test_navlog_reports_an_unflyable_route_as_an_error_line(monkeypatch):
    monkeypatch.setattr(altitude_module, "select_cruise_altitude",
                        lambda start, end, profile: {**ALTITUDE, "recommended_ft": None})

    resp = client.get("/api/navlog", params={"dep": "C81", "dest": "KDLH"})

    messages = [json.loads(line) for line in resp.text.splitlines() if line.strip()]
    assert messages[-1]["type"] == "error"
    assert "No legal VFR cruising altitude" in messages[-1]["detail"]
