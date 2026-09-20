"""A stream that fails after its first line cannot change its status
any more, so the failure has to arrive as the stream's own last line --
the only thing a browser can tell apart from a stream still loading."""
import threading

from fastapi import HTTPException
from fastapi.testclient import TestClient
from vfr import altitude as altitude_module
from vfr import chartlabels, navlog
from vfr.weather import WeatherServiceError

from app import scoring
from app.main import app
from app.routers import chart

from .conftest import select_cruise_altitude_stub

client = TestClient(app)


def test_a_weather_failure_mid_navlog_is_the_streams_last_line(monkeypatch, altitude, messages):
    monkeypatch.setattr(scoring, "invoke_model", lambda dep, dest, model=None: {"checkpoints": []})
    monkeypatch.setattr(altitude_module, "select_cruise_altitude", select_cruise_altitude_stub(altitude))

    def no_winds(*args, **kwargs):
        raise WeatherServiceError("aviationweather.gov request failed: timed out")

    monkeypatch.setattr(navlog, "assemble_leg", no_winds)

    resp = client.get("/api/navlog", params={"dep": "C81", "dest": "KDLH"})

    assert resp.status_code == 200
    lines = messages(resp)
    assert any(m["type"] == "altitude" for m in lines)
    assert lines[-1] == {"type": "error", "detail": "aviationweather.gov request failed: timed out"}


def test_an_uncollected_corridor_is_reported_inside_the_navlog_stream(monkeypatch, messages):
    def not_collected(dep, dest, model=None):
        raise HTTPException(404, f"{dep}->{dest} has not been collected yet")

    monkeypatch.setattr(scoring, "invoke_model", not_collected)

    resp = client.get("/api/navlog", params={"dep": "C81", "dest": "KDLH"})

    assert resp.status_code == 200
    assert messages(resp)[-1] == {"type": "error", "detail": "C81->KDLH has not been collected yet"}


def test_a_failed_corridor_read_ends_the_detect_stream_with_an_error(monkeypatch, messages):
    failed_job = {
        "blocks": [], "done": True, "error": "RuntimeError: tile fetch failed",
        "at": 0.0, "cond": threading.Condition(),
    }
    monkeypatch.setattr(chart, "detect_job", lambda key, start, end, half_width_nm: failed_job)
    monkeypatch.setattr(chart, "faa_airports", lambda *args, **kwargs: [])
    monkeypatch.setattr(chartlabels, "load_picks", lambda route: [])

    resp = client.get("/api/detect/stream", params={"dep": "C81", "dest": "KDLH"})

    assert resp.status_code == 200
    lines = messages(resp)
    assert [m["type"] for m in lines] == ["start", "block", "error"]
    assert "tile fetch failed" in lines[-1]["detail"]
