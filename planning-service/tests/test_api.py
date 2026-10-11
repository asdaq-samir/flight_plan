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
from vfr import airports, airspace, faa_data, pattern
from vfr import model_registry, tfr, weather
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


# --- /api/checkpoints: the chart's read failing as an HTTP status ---


def test_checkpoints_translates_a_chart_that_would_not_read_to_502(monkeypatch):
    from app import chart_model

    def unread(route, wait):
        raise RuntimeError(f"the chart along {route} could not be read: tile fetch failed")

    monkeypatch.setattr(chart_model, "corridor", unread)

    resp = client.get("/api/checkpoints", params={"dep": "C81", "dest": "KDLH"})

    assert resp.status_code == 502
    assert "could not be read" in resp.json()["detail"]


# --- /api/status, /api/retrain, /api/aircraft-profiles ---


def test_status_reports_every_service_and_the_data_on_disk(monkeypatch):
    monkeypatch.setattr(system, "NAV_LOG_AGENT_URL", "http://nav-log-agent:8000")
    monkeypatch.setattr(system, "CREWAI_AGENT_URL", None)
    monkeypatch.setattr(system, "AIRFLOW_URL", None)
    monkeypatch.setattr(system, "probe", lambda url: (True, "HTTP 401"))
    monkeypatch.setattr(system, "_webapp_status", lambda: (
        system.ServiceStatus(up=True, detail="HTTP 200"), system.ServiceStatus(up=False, detail="HTTP 503")))
    monkeypatch.setattr(system, "_model_service_status",
                        lambda: system.ModelServiceStatus(up=False, detail="connection refused"))
    # Not the chart model's real count: that reads the real ratings'
    # corridors, a chart read of its own.
    monkeypatch.setattr(system, "_training", lambda: None)

    resp = client.get("/api/status")

    assert resp.status_code == 200
    body = resp.json()
    assert body["services"]["model_service"] == {"up": False, "detail": "connection refused", "trained_at": None}
    assert body["services"]["nav_log_agent"] == {"up": True, "detail": "HTTP 401"}
    assert body["services"]["crewai_agent"] is None
    assert body["services"]["webapp"] == {"up": True, "detail": "HTTP 200"}
    assert body["services"]["db"] == {"up": False, "detail": "HTTP 503"}
    assert body["pipeline"]["airflow_configured"] is False
    # Every weather source, the winds for each forecast period included.
    assert {w["name"] for w in body["weather"]} == {
        "metars", "tafs", "airsigmets", "pireps", "gairmets", "winds-06", "winds-12", "winds-24",
    }
    for corridor in body["corridors"]:
        assert corridor["departure_ident"].isupper() and "by_rating" in corridor["labels"]


def test_retrain_writes_the_chart_models_table_and_says_how_when_airflow_is_not_configured(monkeypatch):
    written = []
    monkeypatch.setattr(system, "AIRFLOW_URL", None)
    monkeypatch.setattr(system, "_training", lambda: None)
    monkeypatch.setattr(system.chart_model, "write_training_table", lambda: written.append(True))

    resp = client.post("/api/retrain")

    assert resp.status_code == 501
    assert "pipeline-training chart-retrain" in resp.json()["detail"]
    # Written first, so the command it gives trains on the ratings as they are.
    assert written == [True]


def test_retrain_with_too_few_ratings_says_why_instead_of_starting_a_run(monkeypatch):
    # It started the run, which failed in Airflow minutes later with the
    # news in a log nobody was shown.
    started = []
    monkeypatch.setattr(system, "AIRFLOW_URL", "http://airflow:8080")
    monkeypatch.setattr(system, "_airflow_credentials", lambda: started.append("asked") or ("a", "b"))
    monkeypatch.setattr(system, "_training", lambda: system.TrainingReadiness(
        usable=28, needed=30, ready=False, rated=32, off_detection=4, reading=[],
        message="28 of the 30 ratings training needs."))

    resp = client.post("/api/retrain")

    assert resp.status_code == 409
    assert resp.json()["detail"] == "28 of the 30 ratings training needs."
    assert started == []


def test_aircraft_profiles_lists_the_stock_profiles():
    resp = client.get("/api/aircraft-profiles")

    assert resp.status_code == 200
    names = {p["name"]: p for p in resp.json()["profiles"]}
    assert names["c172"]["cruise_tas_kt"] == 110 and names["c172"]["type"] == "Cessna 172"
    # The same for every pilot: a browser and the CDN may keep the list.
    assert resp.headers["cache-control"] == "public, max-age=300, s-maxage=3600"


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


def test_each_taf_station_is_placed_along_the_route_and_read_for_when_the_flight_is_there(monkeypatch):
    """For the Weather tab's places: the destination's TAF is read for the
    arrival, an hour either side, not over the whole flight."""
    monkeypatch.setattr(weather, "hazards_along_route", lambda start, end: [])
    monkeypatch.setattr(weather, "ceiling_visibility_along_route", lambda start, end, window=None: {
        "min_ceiling_ft": 900.0, "min_visibility_sm": 4.0, "stations": [
            {"icaoId": "KDLH", "lat": 46.8421, "lon": -92.1936, "elevation_ft": 1424, "ceiling_ft": 900.0, "visibility_sm": 4.0}]})
    monkeypatch.setattr(weather, "metar_for_idents", lambda idents: {ident: None for ident in idents})
    monkeypatch.setattr(airports, "get_runways", lambda ident: [])
    monkeypatch.setattr(airports, "get_frequencies", lambda ident: [])
    windows = {}
    monkeypatch.setattr(weather, "tafs_over", lambda asked: windows.update(asked) or {
        "KDLH": {"ceiling_ft": 3000.0, "visibility_sm": 6.0, "raw": "TAF KDLH 251720Z ..."}})

    body = client.get("/api/briefing", params={
        "dep": "C81", "dest": "KDLH", "depart": "2026-09-25T13:00:00Z", "ete_min": 150}).json()

    station = body["forecast"]["stations"][0]
    arrival = 1790341200.0 + 150 * 60
    assert windows == {"KDLH": (arrival - 3600, arrival + 3600)}
    assert station["eta"] == "2026-09-25T15:30:00Z" and station["along_track_nm"] > 250
    assert (station["eta_ceiling_ft"], station["eta_visibility_sm"]) == (3000.0, 6.0)
    # The whole flight's worst stays the go/no-go read.
    assert (station["ceiling_ft"], body["forecast"]["min_ceiling_ft"]) == (900.0, 900.0)
    assert station["raw"].startswith("TAF KDLH")


def test_the_briefing_tells_the_tfrs_pilot_reports_and_g_airmets_on_the_route(monkeypatch):
    monkeypatch.setattr(weather, "hazards_along_route", lambda start, end: [])
    monkeypatch.setattr(weather, "ceiling_visibility_along_route", lambda start, end, window=None: (
        {"min_ceiling_ft": None, "min_visibility_sm": None, "stations": []}))
    monkeypatch.setattr(weather, "metar_for_idents", lambda idents: {ident: None for ident in idents})
    monkeypatch.setattr(airports, "get_runways", lambda ident: [])
    monkeypatch.setattr(airports, "get_frequencies", lambda ident: [])
    paths = []
    monkeypatch.setattr(tfr, "along_route", lambda path, start, end: paths.append(path) or [{
        "notam_id": "6/6664", "kind": "Security", "floor_ft": 0.0, "floor_ref": "AGL", "ceiling_ft": 400.0,
        "ceiling_ref": "AGL", "effective": "2026-10-06T23:00:00Z", "expires": "2026-10-07T01:00:00Z",
        "along_track_nm": 12.0, "crosses": True, "active_now": False, "geometry": {"type": "MultiPolygon"}}])
    monkeypatch.setattr(weather, "pireps_along_route", lambda path: [{
        "observed_at": "2026-10-04T04:07:00Z", "altitude_ft": 7000.0, "aircraft": "BE58", "urgent": False,
        "turbulence": "MOD", "icing": None, "raw": "UA /OV ...", "along_track_nm": 40.0}])
    monkeypatch.setattr(weather, "gairmets_along_route", lambda path, window: [{
        "hazard": "Icing", "severity": "MOD", "due_to": "ICE", "valid_at": "2026-10-04T03:00:00Z",
        "altitude_low_ft": None, "from_freezing_level": True, "altitude_high_ft": 22000.0}])

    body = client.get("/api/briefing", params={"dep": "C81", "dest": "KDLH", "stops": "KMSN"}).json()

    # Along the whole route, through its stop.
    assert [len(path) for path in paths] == [3]
    assert body["tfrs"][0]["notam_id"] == "6/6664" and body["tfrs"][0]["crosses"] and "geometry" not in body["tfrs"][0]
    assert body["pireps"][0]["turbulence"] == "MOD"
    assert body["gairmets"][0]["hazard"] == "Icing"


def test_each_airport_landed_at_has_its_pattern_and_its_runway_ends(monkeypatch):
    """For the pattern card and the radio calls: how high the pattern is
    and which way round at each end, the class over the field and what
    it is called."""
    monkeypatch.setattr(weather, "hazards_along_route", lambda start, end: [])
    monkeypatch.setattr(weather, "ceiling_visibility_along_route", lambda start, end, window=None: (
        {"min_ceiling_ft": None, "min_visibility_sm": None, "stations": []}))
    monkeypatch.setattr(weather, "metar_for_idents", lambda idents: {ident: None for ident in idents})
    monkeypatch.setattr(airports, "get_runways", lambda ident: [{
        "ends": "09/27", "end_headings": [("09", 90.2), ("27", 270.2)], "length_ft": 3270, "width_ft": 40,
        "surface": "ASP", "lighted": True, "closed": False}])
    monkeypatch.setattr(airports, "get_frequencies", lambda ident: [])
    monkeypatch.setattr(pattern, "right_traffic_ends", lambda ident, cache_dir=None: {"27"} if ident == "C81" else set())
    monkeypatch.setattr(faa_data, "published_pattern_agl_ft", lambda ident, cache_dir: 800.0 if ident == "DLH" else None)
    monkeypatch.setattr(airspace, "surface_class_at", lambda lat, lon, shp: "C" if lat > 46 else "E")

    body = client.get("/api/briefing", params={"dep": "C81", "dest": "KDLH"}).json()

    c81, dlh = body["airports"]["C81"], body["airports"]["KDLH"]
    assert c81["pattern"] == {"agl_ft": 1000.0, "altitude_ft": 1900.0, "published": False}
    assert dlh["pattern"] == {"agl_ft": 800.0, "altitude_ft": 1700.0, "published": True}
    assert [(e["ident"], e["traffic"]) for e in c81["runways"][0]["runway_ends"]] == [("09", "left"), ("27", "right")]
    assert c81["runways"][0]["runway_ends"][0]["heading_true_deg"] == 90.2
    assert (c81["airspace_class"], dlh["airspace_class"]) == ("E", "C")
    assert dlh["name"] == "KDLH" and dlh["elevation_ft"] == 900.0


def test_a_tfr_site_that_does_not_answer_is_said_not_taken_for_none(monkeypatch):
    monkeypatch.setattr(weather, "hazards_along_route", lambda start, end: [])
    monkeypatch.setattr(weather, "ceiling_visibility_along_route", lambda start, end, window=None: (
        {"min_ceiling_ft": None, "min_visibility_sm": None, "stations": []}))
    monkeypatch.setattr(weather, "metar_for_idents", lambda idents: {ident: None for ident in idents})
    monkeypatch.setattr(airports, "get_runways", lambda ident: [])
    monkeypatch.setattr(airports, "get_frequencies", lambda ident: [])

    def down(*args):
        raise tfr.TfrUnavailable("down")
    monkeypatch.setattr(tfr, "along_route", down)
    monkeypatch.setattr(tfr, "all_tfrs", down)

    assert "tfrs" in client.get("/api/briefing", params={"dep": "C81", "dest": "KDLH"}).json()["weather_unavailable"]
    resp = client.get("/api/tfrs")
    assert resp.status_code == 502 and "tfr.faa.gov" in resp.json()["detail"]


# --- / ---


def test_the_health_probe_says_whether_the_warm_up_is_done(monkeypatch):
    """CI waits on this before the browser suite starts: a planner that
    answers its probe while still loading airspace and obstacles had
    the first tests timing out under it."""
    from app import main

    main.WARM.clear()
    assert client.get("/").json()["warm"] is False
    main.WARM.set()
    assert client.get("/").json()["warm"] is True


def test_a_failure_is_held_for_the_dev_console_with_its_words(monkeypatch):
    from app import errors

    errors._HELD.clear()

    def down(*args, **kwargs):
        raise WeatherServiceError("aviationweather.gov metars unavailable: 503")

    monkeypatch.setattr(weather, "reporting_idents", down)
    monkeypatch.setattr(weather, "metar_for_idents", down)
    client.get("/api/airports/in-view", params={"south": 42, "west": -89, "north": 43, "east": -88})
    monkeypatch.setattr(tfr, "all_tfrs", lambda: (_ for _ in ()).throw(tfr.TfrUnavailable("down")))
    client.get("/api/tfrs")

    held = errors.recent()
    assert [(e["path"].split("?")[0], e["status"]) for e in held] == [("/api/tfrs", 502)]
    assert held[0]["detail"].startswith("Bad gateway")


# --- /api/chart-tile ---


def test_a_chart_tile_no_sheet_covers_is_an_empty_204_kept_as_long_as_a_drawn_one(monkeypatch):
    # It was a 404: an error in the browser's console for every tile of sea
    # or Canada round the country as the planner opens.
    from vfr import charts
    monkeypatch.setattr(charts, "tile_png", lambda x, y, z, kind: None)
    empty = client.get("/api/chart-tile/sec/4/1/8.png")
    assert empty.status_code == 204 and empty.content == b""
    monkeypatch.setattr(charts, "tile_png", lambda x, y, z, kind: b"\x89PNG")
    drawn = client.get("/api/chart-tile/sec/4/3/6.png")
    assert drawn.status_code == 200 and drawn.headers["content-type"] == "image/png"
    assert empty.headers["cache-control"] == drawn.headers["cache-control"]
    # Outside the chart's zooms, and a kind there is none of, are still 404s.
    assert client.get("/api/chart-tile/sec/2/0/0.png").status_code == 404
    assert client.get("/api/chart-tile/wac/4/3/6.png").status_code == 404


def test_registry_has_its_own_thread_and_switch(monkeypatch):
    """The registry download runs off the weather loop, on REGISTRY_REFRESH
    alone (not the charts' flag), and a failed read is tried again."""
    from app import main

    calls = []
    sleeps = []

    def refresh():
        calls.append(1)
        if len(calls) == 1:
            raise OSError("FAA out of reach")

    def stop(seconds):
        sleeps.append(seconds)
        if len(sleeps) == 2:
            monkeypatch.setattr(main, "REGISTRY_REFRESH", False)

    monkeypatch.setattr(main.registry, "refresh", refresh)
    monkeypatch.setattr(main.time, "sleep", stop)
    monkeypatch.setattr(main, "REGISTRY_REFRESH", True)
    monkeypatch.setattr(main.chart_refresh, "AUTO_REFRESH", False)
    main._keep_registry_current()
    assert len(calls) == 2  # the failed first read was tried again

    calls.clear()
    monkeypatch.setattr(main, "REGISTRY_REFRESH", False)
    main._keep_registry_current()
    assert calls == []
