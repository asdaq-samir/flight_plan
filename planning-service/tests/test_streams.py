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
    monkeypatch.setattr(scoring, "score", lambda dep, dest: [])
    monkeypatch.setattr(altitude_module, "select_cruise_altitude", select_cruise_altitude_stub(altitude))

    def no_winds(*args, **kwargs):
        raise WeatherServiceError("aviationweather.gov request failed: timed out")

    monkeypatch.setattr(navlog, "assemble_leg", no_winds)

    resp = client.get("/api/navlog", params={"dep": "C81", "dest": "KDLH"})

    assert resp.status_code == 200
    lines = messages(resp)
    altitude = next(m for m in lines if m["type"] == "altitude")
    assert altitude["flown"] is None and altitude["altitude_ft"] is None and altitude["altitude_selection"]
    assert lines[-1] == {
        "type": "error", "detail": "aviationweather.gov request failed: timed out", "retry": True, "reasons": [], "advice": None,
    }


def test_a_chart_that_would_not_read_is_reported_inside_the_navlog_stream(monkeypatch, messages):
    def unread(dep, dest):
        raise HTTPException(502, f"the chart along {dep}->{dest} could not be read: tile fetch failed")

    monkeypatch.setattr(scoring, "score", unread)

    resp = client.get("/api/navlog", params={"dep": "C81", "dest": "KDLH"})

    assert resp.status_code == 200
    detail = "the chart along C81->KDLH could not be read: tile fetch failed"
    assert messages(resp)[-1] == {"type": "error", "detail": detail, "retry": True, "reasons": [], "advice": None}


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


def test_a_stuck_altitude_selection_ends_the_navlog_stream_saying_what_it_waits_on(monkeypatch, altitude, messages):
    """The 2026-09-23 hang: the stream used to heartbeat "still waiting on
    aviationweather.gov" for as long as the selection never finished.
    Now each heartbeat names the stage actually running, and the stream
    ends at the limit with an error line saying so."""
    from app.routers import plan as plan_router

    monkeypatch.setattr(scoring, "score", lambda dep, dest: [])
    release = threading.Event()

    def stuck(start, end, profile, faa_cache_dir=None, fixes=None, fcst_hr="06", pending=None, window=None):
        pending.add("terrain.floor_profile")
        release.wait(timeout=5)
        return altitude

    monkeypatch.setattr(altitude_module, "select_cruise_altitude", stuck)
    monkeypatch.setattr(plan_router, "HEARTBEAT_S", 0.05)
    monkeypatch.setattr(plan_router, "COMPUTE_LIMIT_S", 0.4)
    try:
        resp = client.get("/api/navlog", params={"dep": "C81", "dest": "KDLH"})
    finally:
        release.set()

    lines = messages(resp)
    heartbeats = [m["detail"] for m in lines if m["type"] == "stage" and "s, waiting on" in m["detail"]]
    assert heartbeats and "the terrain and obstacles" in heartbeats[-1]
    assert "aviationweather.gov" not in " ".join(heartbeats)
    assert lines[-1]["type"] == "error"
    assert "waiting on the terrain and obstacles" in lines[-1]["detail"]
