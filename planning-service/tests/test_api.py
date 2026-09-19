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

import requests
from fastapi.testclient import TestClient
from vfr import airports
from vfr import altitude as altitude_module
from vfr.weather import WeatherServiceError

from app.main import app, model_registry

client = TestClient(app)


# --- /api/model-comparison ---


def test_model_comparison_404s_when_nothing_has_been_promoted(tmp_path, monkeypatch):
    monkeypatch.setattr(model_registry, "CURRENT_MODEL_DIR", tmp_path / "current")
    monkeypatch.setattr(model_registry, "MODELS_DIR", tmp_path)

    resp = client.get("/api/model-comparison")

    assert resp.status_code == 404


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


# --- /api/playground/score ---


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self) -> dict:
        return self._payload


def test_playground_score_passes_the_model_choice_through_to_model_service(monkeypatch):
    captured = {}

    def fake_post(url, json, timeout):
        captured["url"], captured["json"] = url, json
        return _FakeResponse(200, {"checkpoints": [], "model_type": "spark_gbt"})

    monkeypatch.setattr(requests, "post", fake_post)

    resp = client.get("/api/playground/score", params={"dep": "c81", "dest": "kdlh", "model": "spark"})

    assert resp.status_code == 200
    assert resp.json()["model_type"] == "spark_gbt"
    assert captured["json"] == {"departure_ident": "C81", "destination_ident": "KDLH", "model": "spark"}


def test_playground_score_translates_an_uncollected_route_to_404(monkeypatch):
    monkeypatch.setattr(requests, "post", lambda url, json, timeout: _FakeResponse(404, {}))

    resp = client.get("/api/playground/score", params={"dep": "C81", "dest": "KDLH"})

    assert resp.status_code == 404


def test_playground_score_translates_a_down_model_service_to_502(monkeypatch):
    def fake_post(url, json, timeout):
        raise requests.ConnectionError("no route to host")

    monkeypatch.setattr(requests, "post", fake_post)

    resp = client.get("/api/playground/score", params={"dep": "C81", "dest": "KDLH"})

    assert resp.status_code == 502


# --- /api/altitude-breakdown ---


def _stub_airport(ident: str) -> dict:
    coords = {"C81": (42.3172, -88.0905), "KDLH": (46.8421, -92.1936)}[ident]
    return {"ident": ident, "name": ident, "lat": coords[0], "lon": coords[1], "elevation_ft": 900.0,
            "municipality": "", "region": ""}


def test_altitude_breakdown_returns_select_cruise_altitudes_result(monkeypatch):
    monkeypatch.setattr(airports, "get_airport", lambda ident, **kw: _stub_airport(ident.upper()))
    monkeypatch.setattr(altitude_module, "select_cruise_altitude", lambda start, end, profile: {
        "recommended_ft": 2500.0, "floor_ft": 2200.0, "airspace_ceiling_ft": None, "airspace_transits": [],
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
    monkeypatch.setattr(airports, "get_airport", lambda ident, **kw: _stub_airport(ident.upper()))

    def raise_weather_error(start, end, profile):
        raise WeatherServiceError("aviationweather.gov request failed: timed out")

    monkeypatch.setattr(altitude_module, "select_cruise_altitude", raise_weather_error)

    resp = client.get("/api/altitude-breakdown", params={"dep": "C81", "dest": "KDLH"})

    assert resp.status_code == 502
