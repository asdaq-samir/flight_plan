"""The plan endpoints through their response models, with every live
dependency stubbed: model-service, the airports table, the altitude
selection and the per-leg wind lookup. What this proves is the contract
-- that a real leg dict validates as a Leg (including the `from` alias),
that /api/plan and /api/checkpoints serialise, and that the nav-log
stream's lines are the messages app.schemas declares."""
import pytest
from fastapi.testclient import TestClient
from vfr import altitude as altitude_module
from vfr import navlog

from app import scoring
from app.main import app

client = TestClient(app)

CANDIDATES = [
    {"osm_id": "411077224", "category": "lake_or_pond", "name": "Long Lake", "lat": 42.35, "lon": -88.09,
     "predicted_score": 4.4, "along_track_nm": 3.9},
    {"osm_id": "153546173", "category": "town", "name": "Round Lake", "lat": 42.6, "lon": -88.4,
     "predicted_score": 3.9, "along_track_nm": 22.0},
]


def _leg(start, end, altitude_ft, profile) -> dict:
    """What vfr.navlog.assemble_leg returns, minus the live winds call."""
    return {
        "true_course_deg": 320.0, "distance_nm": 10.0, "altitude_ft": altitude_ft,
        "wind": {"wind_dir_true_deg": 270.0, "wind_speed_kt": 15.0},
        "wca_deg": -6.0, "true_heading_deg": 314.0, "magnetic_variation_deg": -3.0,
        "magnetic_heading_deg": 317.0, "groundspeed_kt": 105.0, "ete_min": 5.7, "fuel_gal": 0.8,
    }


@pytest.fixture(autouse=True)
def _stubbed_world(monkeypatch, altitude):
    monkeypatch.setattr(scoring, "invoke_model", lambda dep, dest, model=None: {"checkpoints": [dict(c) for c in CANDIDATES]})
    monkeypatch.setattr(altitude_module, "select_cruise_altitude", lambda start, end, profile: dict(altitude))
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


def test_plan_refuses_a_route_with_no_legal_altitude(monkeypatch, altitude):
    monkeypatch.setattr(altitude_module, "select_cruise_altitude",
                        lambda start, end, profile: {**altitude, "recommended_ft": None})

    resp = client.get("/api/plan", params={"dep": "C81", "dest": "KDLH"})

    assert resp.status_code == 422


def test_navlog_streams_altitude_then_legs_then_done(messages):
    resp = client.get("/api/navlog", params={"dep": "C81", "dest": "KDLH"})

    assert resp.status_code == 200
    lines = messages(resp)
    types = [m["type"] for m in lines]
    assert types[0] == "stage" and types[-1] == "done"
    assert types.index("altitude") < types.index("leg")
    legs = [m for m in lines if m["type"] == "leg"]
    assert legs[0]["from"] == "C81" and legs[0]["wind"]["wind_speed_kt"] == 15.0
    assert lines[-1]["totals"]["distance_nm"] == 10.0 * len(legs)


def test_navlog_flies_a_pilots_own_aeroplane_over_a_stock_profile(messages):
    resp = client.get("/api/navlog", params={
        "dep": "C81", "dest": "KDLH", "aircraft": "pa28", "cruise_tas_kt": 118, "fuel_burn_gph": 9.9,
    })

    assert resp.status_code == 200
    aircraft = next(m for m in messages(resp) if m["type"] == "altitude")["aircraft"]
    assert aircraft["name"] == "pa28"
    assert aircraft["cruise_tas_kt"] == 118 and aircraft["fuel_burn_gph"] == 9.9
    assert aircraft["service_ceiling_ft"] == 14100   # the profile's own, untouched


def test_navlog_reports_an_unflyable_route_as_an_error_line(monkeypatch, altitude, messages):
    monkeypatch.setattr(altitude_module, "select_cruise_altitude",
                        lambda start, end, profile: {**altitude, "recommended_ft": None})

    resp = client.get("/api/navlog", params={"dep": "C81", "dest": "KDLH"})

    last = messages(resp)[-1]
    assert last["type"] == "error"
    assert "No legal VFR cruising altitude" in last["detail"]
