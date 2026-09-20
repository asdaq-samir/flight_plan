"""A stream that fails after its first line cannot change its status
any more, so the failure has to arrive as the stream's own last line --
the only thing a browser can tell apart from a stream still loading."""
import json
import threading

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from vfr import airports, chartlabels, navlog
from vfr import altitude as altitude_module
from vfr.weather import WeatherServiceError

from app import scoring
from app.main import app
from app.routers import chart

client = TestClient(app)

ALTITUDE = {
    "recommended_ft": 4500.0, "floor_ft": 2200.0, "airspace_ceiling_ft": None, "airspace_transits": [],
    "freezing_level_ft": None, "band_ceiling_ft": None, "min_ceiling_ft": None, "min_visibility_sm": None,
    "hazards": [], "low_ceiling_or_visibility": False, "weather_unavailable": [],
}


def _airport(ident: str) -> dict:
    coords = {"C81": (42.3172, -88.0905), "KDLH": (46.8421, -92.1936)}[ident]
    return {"ident": ident, "name": ident, "lat": coords[0], "lon": coords[1], "elevation_ft": 900.0,
            "municipality": "", "region": ""}


def _messages(resp) -> list:
    return [json.loads(line) for line in resp.text.splitlines() if line.strip()]


@pytest.fixture(autouse=True)
def _known_airports(monkeypatch):
    monkeypatch.setattr(airports, "get_airport", lambda ident, **kw: _airport(ident.upper()))


def test_a_weather_failure_mid_navlog_is_the_streams_last_line(monkeypatch):
    monkeypatch.setattr(scoring, "invoke_model", lambda dep, dest, model=None: {"checkpoints": []})
    monkeypatch.setattr(altitude_module, "select_cruise_altitude", lambda start, end, profile: dict(ALTITUDE))

    def no_winds(*args, **kwargs):
        raise WeatherServiceError("aviationweather.gov request failed: timed out")

    monkeypatch.setattr(navlog, "assemble_leg", no_winds)

    resp = client.get("/api/navlog", params={"dep": "C81", "dest": "KDLH"})

    assert resp.status_code == 200
    messages = _messages(resp)
    assert any(m["type"] == "altitude" for m in messages)
    assert messages[-1] == {"type": "error", "detail": "aviationweather.gov request failed: timed out"}


def test_an_uncollected_corridor_is_reported_inside_the_navlog_stream(monkeypatch):
    def not_collected(dep, dest, model=None):
        raise HTTPException(404, f"{dep}->{dest} has not been collected yet")

    monkeypatch.setattr(scoring, "invoke_model", not_collected)

    resp = client.get("/api/navlog", params={"dep": "C81", "dest": "KDLH"})

    assert resp.status_code == 200
    assert _messages(resp)[-1] == {"type": "error", "detail": "C81->KDLH has not been collected yet"}


def test_a_failed_corridor_read_ends_the_detect_stream_with_an_error(monkeypatch):
    failed_job = {
        "blocks": [], "done": True, "error": "RuntimeError: tile fetch failed",
        "at": 0.0, "cond": threading.Condition(),
    }
    monkeypatch.setattr(chart, "detect_job", lambda key, start, end, half_width_nm: failed_job)
    monkeypatch.setattr(chart, "faa_airports", lambda *args, **kwargs: [])
    monkeypatch.setattr(chartlabels, "load_picks", lambda route: [])

    resp = client.get("/api/detect/stream", params={"dep": "C81", "dest": "KDLH"})

    assert resp.status_code == 200
    messages = _messages(resp)
    assert [m["type"] for m in messages] == ["start", "block", "error"]
    assert "tile fetch failed" in messages[-1]["detail"]
