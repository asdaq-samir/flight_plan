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

from .conftest import select_cruise_altitude_stub

client = TestClient(app)

CANDIDATES = [
    {"osm_id": "411077224", "category": "lake_or_pond", "name": "Long Lake", "lat": 42.35, "lon": -88.09,
     "predicted_score": 4.4, "along_track_nm": 3.9},
    {"osm_id": "153546173", "category": "town", "name": "Round Lake", "lat": 42.6, "lon": -88.4,
     "predicted_score": 3.9, "along_track_nm": 22.0},
]


def _leg(start, end, altitude_ft, profile, fcst_hr="06") -> dict:
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
    monkeypatch.setattr(altitude_module, "select_cruise_altitude", select_cruise_altitude_stub(altitude))
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
    # The three plans, the lowest flown unless asked otherwise. One legal
    # altitude here, so all three are the same plan.
    assert [o["kind"] for o in body["altitude_options"]] == ["lowest", "highest", "fastest"]
    assert body["altitude_choice"] == "lowest"
    assert body["altitude_options"][0]["steps"] == [
        {"from": "C81", "to": "KDLH", "altitude_ft": 4500.0, "distance_nm": 30.0},
    ]
    assert "total_min" not in body["altitude_options"][2]   # it only ever repeated ete_min


def test_plan_flies_the_plan_the_pilot_chose():
    resp = client.get("/api/plan", params={"dep": "C81", "dest": "KDLH", "altitude_choice": "fastest"})

    assert resp.status_code == 200
    assert resp.json()["altitude_choice"] == "fastest"


def test_plan_with_a_pilots_own_altitude_flies_it_and_still_offers_the_plans():
    resp = client.get("/api/plan", params={"dep": "C81", "dest": "KDLH", "altitude_ft": 3500})

    body = resp.json()
    assert body["altitude_ft"] == 3500.0 and all(leg["altitude_ft"] == 3500.0 for leg in body["legs"])
    # No plan is being flown, but the three are there beside the pilot's
    # own, with the reasoning's floor and ceiling.
    assert body["altitude_choice"] is None
    assert [o["kind"] for o in body["altitude_options"]] == ["lowest", "highest", "fastest"]
    assert body["altitude_selection"]["floor_ft"] == 2200.0


def test_plan_refuses_a_route_with_no_legal_altitude(monkeypatch, altitude):
    monkeypatch.setattr(altitude_module, "select_cruise_altitude",
                        select_cruise_altitude_stub({**altitude, "recommended_ft": None}))

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
    altitude = next(m for m in lines if m["type"] == "altitude")
    assert [o["kind"] for o in altitude["options"]] == ["lowest", "highest", "fastest"]
    assert altitude["flown"] == "lowest" and altitude["altitude_ft"] == 4500.0


def test_a_departure_time_picks_the_winds_forecast_period(messages):
    from datetime import datetime, timedelta, timezone

    soon = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    later = (datetime.now(timezone.utc) + timedelta(hours=14)).isoformat()
    tomorrow = (datetime.now(timezone.utc) + timedelta(hours=30)).isoformat()

    for depart, expected in ((None, "06"), (soon, "06"), (later, "12"), (tomorrow, "24")):
        params = {"dep": "C81", "dest": "KDLH", **({"depart": depart} if depart else {})}
        altitude = next(m for m in messages(client.get("/api/navlog", params=params)) if m["type"] == "altitude")
        assert altitude["winds_forecast_hr"] == expected, depart
    assert client.get("/api/plan", params={"dep": "C81", "dest": "KDLH", "depart": later}).json()["winds_forecast_hr"] == "12"


def test_totals_carry_the_fuel_check(messages):
    from datetime import datetime, timezone

    lines = messages(client.get("/api/navlog", params={"dep": "C81", "dest": "KDLH"}))
    t = lines[-1]["totals"]
    # The day reserve at the C172's 8.5 gph is 4.25 gal on top of the
    # legs' own fuel (the first leg's climb from the field included);
    # the profile holds 40 usable. No departure time: the day reserve is
    # assumed and `night` says so by being null.
    assert t["reserve_min"] == 30 and t["reserve_gal"] == 4.25 and t["night"] is None
    assert t["taxi_gal"] == 1.4    # the C172S handbook's start, taxi and takeoff allowance
    assert t["fuel_required_gal"] == round(t["fuel_gal"] + 1.4 + 4.25, 1)
    assert t["usable_fuel_gal"] == 40 and t["fuel_margin_gal"] == round(40 - t["fuel_required_gal"], 1)
    # The climb from the 900 ft field to 4,500 ft is on the first leg.
    legs = [m for m in lines if m["type"] == "leg"]
    assert legs[0]["climb_min"] > 0 and legs[1]["climb_min"] == 0
    assert legs[0]["ete_min"] > legs[1]["ete_min"] and legs[0]["fuel_gal"] > legs[1]["fuel_gal"]

    # A pilot's own tanks, too small: the margin goes negative.
    short = messages(client.get("/api/navlog", params={"dep": "C81", "dest": "KDLH", "usable_fuel_gal": 5}))[-1]
    assert short["totals"]["fuel_margin_gal"] == round(5 - short["totals"]["fuel_required_gal"], 1) < 0

    # Departing Chicago at 03:00 local (08:00 UTC) is night: 45 minutes.
    at_night = datetime(2026, 9, 22, 8, 0, tzinfo=timezone.utc).isoformat()
    night = messages(client.get("/api/navlog", params={"dep": "C81", "dest": "KDLH", "depart": at_night}))[-1]
    assert night["totals"]["night"] is True and night["totals"]["reserve_min"] == 45
    by_day = datetime(2026, 9, 22, 17, 0, tzinfo=timezone.utc).isoformat()
    day = messages(client.get("/api/navlog", params={"dep": "C81", "dest": "KDLH", "depart": by_day}))[-1]
    assert day["totals"]["night"] is False and day["totals"]["reserve_min"] == 30


def test_navlog_flies_the_chosen_plan_and_says_so(messages):
    resp = client.get("/api/navlog", params={"dep": "C81", "dest": "KDLH", "altitude_choice": "highest"})

    altitude = next(m for m in messages(resp) if m["type"] == "altitude")
    assert altitude["flown"] == "highest"


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
                        select_cruise_altitude_stub({**altitude, "recommended_ft": None}))

    resp = client.get("/api/navlog", params={"dep": "C81", "dest": "KDLH"})

    last = messages(resp)[-1]
    assert last["type"] == "error"
    assert "No legal VFR cruising altitude" in last["detail"]


# --- the altitude outcome, decided once ---

def _no_winds(monkeypatch):
    from vfr.weather import WeatherServiceError

    def fail(*args, **kwargs):
        raise WeatherServiceError("aviationweather.gov winds-06 unavailable: timed out")

    monkeypatch.setattr(navlog, "assemble_leg", fail)


def test_navlog_at_a_pilots_own_altitude_streams_it_then_its_legs(messages):
    """No stream test passed an altitude before."""
    lines = messages(client.get("/api/navlog", params={"dep": "C81", "dest": "KDLH", "altitude_ft": 3500}))

    altitude = next(m for m in lines if m["type"] == "altitude")
    assert altitude["altitude_ft"] == 3500.0 and altitude["flown"] == "custom"
    assert [o["kind"] for o in altitude["options"]] == ["lowest", "highest", "fastest"]
    assert all(m["altitude_ft"] == 3500.0 for m in lines if m["type"] == "leg")
    assert lines[-1]["type"] == "done"


def test_navlog_at_a_pilots_own_altitude_without_winds_says_the_altitude_then_the_failure(monkeypatch, messages):
    _no_winds(monkeypatch)
    lines = messages(client.get("/api/navlog", params={"dep": "C81", "dest": "KDLH", "altitude_ft": 3500}))

    assert [m["type"] for m in lines if m["type"] != "stage"] == ["altitude", "error"]
    # Nothing is flown: no altitude, and no "custom" either -- the page
    # showed "· yours" with Custom pressed for this.
    assert lines[-2]["flown"] is None and lines[-2]["altitude_ft"] is None
    assert lines[-2]["altitude_selection"]["floor_ft"] == 2200.0
    assert "winds-06 unavailable" in lines[-1]["detail"]


def test_plan_without_winds_is_a_502(monkeypatch):
    _no_winds(monkeypatch)
    resp = client.get("/api/plan", params={"dep": "C81", "dest": "KDLH"})

    assert resp.status_code == 502
    assert "winds-06 unavailable" in resp.json()["detail"]


def test_each_outcome_of_the_altitude_resolver(monkeypatch, altitude):
    from app.planning import aircraft_profile
    from app.common import load_route
    from app.routers.plan import Flown, NoWinds, Unflyable, resolve_altitude

    r = load_route("C81", "KDLH")
    fix_list = navlog.fixes(r.dep_ident, r.dest_ident, r.start, r.end, [])
    profile = aircraft_profile("c172")

    chosen = resolve_altitude(r, fix_list, profile, "c172", None, "highest")
    assert isinstance(chosen, Flown) and chosen.choice == "highest" and chosen.altitude_ft == 4500.0

    typed = resolve_altitude(r, fix_list, profile, "c172", 3500.0, "lowest")
    assert isinstance(typed, Flown) and typed.choice is None and len(typed.options) == 3

    monkeypatch.setattr(altitude_module, "select_cruise_altitude",
                        select_cruise_altitude_stub({**altitude, "recommended_ft": None}))
    from app import planning
    planning._ALTITUDE_CACHE.clear()
    planning._PLANS_CACHE.clear()
    assert isinstance(resolve_altitude(r, fix_list, profile, "c172", None, "lowest"), Unflyable)

    monkeypatch.setattr(altitude_module, "select_cruise_altitude", select_cruise_altitude_stub(altitude))
    planning._ALTITUDE_CACHE.clear()
    planning._PLANS_CACHE.clear()
    _no_winds(monkeypatch)
    outcome = resolve_altitude(r, fix_list, profile, "c172", None, "lowest")
    assert isinstance(outcome, NoWinds) and outcome.options == []


def test_a_plan_whose_scoring_hangs_answers_within_the_bound(monkeypatch):
    """Scoring ran before the bounded wait, so a slow model-service put the
    plan past the agents' client timeout."""
    import threading

    from app.routers import plan as plan_router

    release = threading.Event()

    def slow_model(dep, dest, model=None):
        release.wait(timeout=5)
        return {"checkpoints": []}

    monkeypatch.setattr(scoring, "invoke_model", slow_model)
    monkeypatch.setattr(plan_router, "COMPUTE_LIMIT_S", 0.3)
    try:
        resp = client.get("/api/plan", params={"dep": "C81", "dest": "KDLH"})
    finally:
        release.set()

    assert resp.status_code == 504
    assert "model-service's checkpoint scores" in resp.json()["detail"]
