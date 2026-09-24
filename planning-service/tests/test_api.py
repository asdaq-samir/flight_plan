"""HTTP-layer tests for the endpoints this session added, against a real
FastAPI TestClient -- planning-service had zero tests at this layer for
any of its ~24 endpoints before this pass. Scoped to the newest/least
proven ones rather than all 24; external dependencies (model-service,
aviationweather.gov, the OurAirports/FAA downloads) are mocked at the
same module-level names app.main itself calls, so these tests check the
HTTP contract (status codes, response shape, error translation) rather
than re-testing vfr.altitude/vfr.weather's own logic, which has its own
tests in the root tests/ package.
"""
import json

from fastapi.testclient import TestClient
from vfr import airports
from vfr import altitude as altitude_module
from vfr import model_client, model_registry, weather
from vfr.weather import WeatherServiceError

from app.main import app
from app.routers import system

client = TestClient(app)


# --- /api/model-comparison ---


def test_model_comparison_is_empty_when_nothing_has_been_promoted(tmp_path, monkeypatch):
    # It was a 404, which a fresh stack's Performance tab toasted.
    monkeypatch.setattr(model_registry, "CURRENT_MODEL_DIR", tmp_path / "current")
    monkeypatch.setattr(model_registry, "MODELS_DIR", tmp_path)

    resp = client.get("/api/model-comparison")

    assert resp.status_code == 200
    assert resp.json() == {"models": [], "trained_at": None, "n_labeled": None}


def test_model_comparison_lists_the_promoted_model_and_any_trained_candidates(tmp_path, monkeypatch):
    current_dir = tmp_path / "current"
    current_dir.mkdir()
    (current_dir / "metrics.json").write_text(json.dumps({
        "model_type": "random_forest",
        "trained_at": "2026-09-10T00:00:00Z",
        "n_labeled": 206,
        "cv_mae_by_model": {"random_forest": 0.41, "ridge": 0.52},
    }))
    candidates_dir = tmp_path / "candidates" / "pytorch"
    candidates_dir.mkdir(parents=True)
    (candidates_dir / "metrics.json").write_text(json.dumps({
        "model_type": "pytorch_mlp",
        "held_out_mae": 0.47,
    }))
    monkeypatch.setattr(model_registry, "CURRENT_MODEL_DIR", current_dir)
    monkeypatch.setattr(model_registry, "MODELS_DIR", tmp_path)

    resp = client.get("/api/model-comparison")

    assert resp.status_code == 200
    body = resp.json()
    assert body["n_labeled"] == 206
    names = {m["name"]: m for m in body["models"]}
    assert names["random_forest"]["promoted"] is True
    assert names["ridge"]["promoted"] is False
    assert names["pytorch_mlp"]["metric"] == "held_out_mae"


# --- /api/checkpoints: model-service's failures as HTTP statuses ---


def test_checkpoints_translates_an_uncollected_route_to_404(monkeypatch):
    def not_collected(dep, dest):
        raise model_client.RouteNotCollected(dep, dest)

    monkeypatch.setattr(model_client, "invoke", not_collected)

    resp = client.get("/api/checkpoints", params={"dep": "C81", "dest": "KDLH"})

    assert resp.status_code == 404


def test_checkpoints_translates_a_down_model_service_to_502(monkeypatch):
    def unreachable(dep, dest):
        raise model_client.ModelServiceError("Could not reach model-service: no route to host")

    monkeypatch.setattr(model_client, "invoke", unreachable)

    resp = client.get("/api/checkpoints", params={"dep": "C81", "dest": "KDLH"})

    assert resp.status_code == 502


# --- /api/status, /api/retrain, /api/aircraft-profiles ---


def test_status_reports_every_service_and_the_data_on_disk(monkeypatch):
    monkeypatch.setattr(system, "NAV_LOG_AGENT_URL", "http://nav-log-agent:8000")
    monkeypatch.setattr(system, "CREWAI_AGENT_URL", None)
    monkeypatch.setattr(system, "AIRFLOW_URL", None)
    monkeypatch.setattr(system, "probe", lambda url: (True, "HTTP 401"))
    monkeypatch.setattr(system, "_model_service_status",
                        lambda: system.ModelServiceStatus(up=False, detail="connection refused"))

    resp = client.get("/api/status")

    assert resp.status_code == 200
    body = resp.json()
    assert body["services"]["model_service"] == {"up": False, "detail": "connection refused", "trained_at": None, "models": {}}
    assert body["services"]["nav_log_agent"] == {"up": True, "detail": "HTTP 401"}
    assert body["services"]["crewai_agent"] is None
    assert body["pipeline"]["airflow_configured"] is False
    assert {w["name"] for w in body["weather"]} == {"metars", "tafs", "airsigmets"}
    for corridor in body["corridors"]:
        assert corridor["departure_ident"].isupper() and "by_rating" in corridor["labels"]


def test_retrain_says_how_when_airflow_is_not_configured(monkeypatch):
    monkeypatch.setattr(system, "AIRFLOW_URL", None)

    resp = client.post("/api/retrain")

    assert resp.status_code == 501
    assert "pipeline-training retrain" in resp.json()["detail"]


def test_aircraft_profiles_lists_the_stock_profiles():
    resp = client.get("/api/aircraft-profiles")

    assert resp.status_code == 200
    names = {p["name"]: p for p in resp.json()["profiles"]}
    assert names["c172"]["cruise_tas_kt"] == 110 and names["c172"]["type"] == "Cessna 172"


# --- /api/altitude-breakdown ---


def test_altitude_breakdown_returns_select_cruise_altitudes_result(monkeypatch):
    monkeypatch.setattr(altitude_module, "select_cruise_altitude", lambda start, end, profile, pending=None: {
        "recommended_ft": 2500.0, "course_magnetic_deg": 335.0, "eastbound": False,
        "floor_ft": 2200.0, "airspace_ceiling_ft": None, "airspace_transits": [],
        "freezing_level_ft": None, "band_ceiling_ft": None, "min_ceiling_ft": None, "min_visibility_sm": None,
        "hazards": [], "low_ceiling_or_visibility": False,
    })

    resp = client.get("/api/altitude-breakdown", params={"dep": "C81", "dest": "KDLH"})

    assert resp.status_code == 200
    assert resp.json()["recommended_ft"] == 2500.0


def test_altitude_breakdown_404s_for_an_unknown_ident(monkeypatch):
    def raise_unknown(ident, **kw):
        raise ValueError(f"Airport identifier {ident!r} not found")

    monkeypatch.setattr(airports, "get_airport", raise_unknown)

    resp = client.get("/api/altitude-breakdown", params={"dep": "ZZZZ", "dest": "KDLH"})

    assert resp.status_code == 404


def test_altitude_breakdown_surfaces_a_weather_outage_as_502(monkeypatch):
    """The point of Priority 1's WeatherServiceError fix: an
    aviationweather.gov failure anywhere inside select_cruise_altitude
    reaches the caller as a clean 502 from the global exception handler,
    not a raw 500."""
    def raise_weather_error(start, end, profile, pending=None):
        raise WeatherServiceError("aviationweather.gov request failed: timed out")

    monkeypatch.setattr(altitude_module, "select_cruise_altitude", raise_weather_error)

    resp = client.get("/api/altitude-breakdown", params={"dep": "C81", "dest": "KDLH"})

    assert resp.status_code == 502


# --- /api/briefing ---


def test_the_briefing_says_why_vfr_is_not_recommended(monkeypatch):
    """The reasons are the planner's to give (vfr.weather); the page only
    shows them."""
    monkeypatch.setattr(weather, "hazards_along_route", lambda start, end: [])
    windows = []

    def forecast(start, end, window=None):
        windows.append(window)
        return {"min_ceiling_ft": 800.0, "min_visibility_sm": 6.0, "stations": []}

    monkeypatch.setattr(weather, "ceiling_visibility_along_route", forecast)
    monkeypatch.setattr(weather, "metar_for_idents", lambda idents: {ident: None for ident in idents})
    monkeypatch.setattr(airports, "get_runways", lambda ident: [])
    monkeypatch.setattr(airports, "get_frequencies", lambda ident: [])

    resp = client.get("/api/briefing", params={"dep": "C81", "dest": "KDLH"})

    assert resp.status_code == 200
    assert resp.json()["vfr_not_recommended"] == ["forecast ceiling as low as 800 ft along the route"]


def test_the_briefing_forecast_is_read_over_the_flight(monkeypatch):
    """From the departure to an hour past arrival, not whenever it was asked."""
    windows = []
    monkeypatch.setattr(weather, "hazards_along_route", lambda start, end: [])
    monkeypatch.setattr(weather, "ceiling_visibility_along_route", lambda start, end, window=None: (
        windows.append(window) or {"min_ceiling_ft": None, "min_visibility_sm": None, "stations": []}))
    monkeypatch.setattr(weather, "metar_for_idents", lambda idents: {ident: None for ident in idents})
    monkeypatch.setattr(airports, "get_runways", lambda ident: [])
    monkeypatch.setattr(airports, "get_frequencies", lambda ident: [])

    resp = client.get("/api/briefing", params={
        "dep": "C81", "dest": "KDLH", "depart": "2026-09-25T13:00:00Z", "ete_min": 150})

    assert resp.status_code == 200
    start = 1790341200.0  # 2026-09-25T13:00:00Z
    assert windows == [(start, start + 150 * 60 + 3600)]
