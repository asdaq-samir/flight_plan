"""What every test here shares: fresh caches, two known airports, a
flyable altitude selection and an NDJSON reader."""
import json

import pytest
from vfr import airports, airspace, faa_data, fixes, model_client, pattern, publications, tfr, weather

from app import chart_model, detection, planning, prefetch, scoring


@pytest.fixture(autouse=True)
def _fresh_caches():
    """The app remembers per-route work (cruise altitude, model scores,
    corridor detections) across requests, so a test that monkeypatches
    one of those dependencies must not be handed the previous test's
    answer instead."""
    for cache in (planning._ALTITUDE_CACHE, planning._PLANS_CACHE, scoring._SCORE_CACHE, detection._DETECT_JOBS):
        cache.clear()


def airport(ident: str) -> dict:
    coords = {"C81": (42.3172, -88.0905), "KDLH": (46.8421, -92.1936), "KMSN": (43.1399, -89.3375)}[ident]
    return {"ident": ident, "name": ident, "lat": coords[0], "lon": coords[1], "elevation_ft": 900.0,
            "municipality": "", "region": ""}


@pytest.fixture(autouse=True)
def chart_read_here(monkeypatch):
    """The corridor read on this process's own thread, as the tests stub
    it, not in the pool's processes (app.chart_model.READS_IN_PROCESS),
    which would not see the stubs."""
    monkeypatch.setattr(chart_model, "READS_IN_PROCESS", False)


@pytest.fixture(autouse=True)
def no_reads_ahead(monkeypatch):
    """No route read ahead as its course is asked for (app.prefetch): a
    test is about the answer, and the reads would reach the chart reader
    and USGS from a thread that outlives it. test_prefetch has its own."""
    monkeypatch.setattr(prefetch, "route", lambda dep, dest, stops="": None)


@pytest.fixture(autouse=True)
def no_chart_model(monkeypatch):
    """No chart model promoted: model-service is not running here, and a
    test about the chart model's scores stubs this again itself."""
    monkeypatch.setattr(model_client, "score_detections", lambda rows: None)


@pytest.fixture(autouse=True)
def no_navaids(monkeypatch):
    """No navaid by any ident, without NASR's NAV_BASE -- which a fresh
    checkout does not have, and would download. A test about one stubs
    find_navaid again itself."""
    monkeypatch.setattr(fixes, "find_navaid", lambda ident, near=(): None)


@pytest.fixture(autouse=True)
def known_airports(monkeypatch):
    """C81, KDLH and KMSN, without the airports table. A test about an unknown
    ident stubs get_airport again itself."""
    monkeypatch.setattr(airports, "get_airport", lambda ident, **kw: airport(ident.upper()))


@pytest.fixture(autouse=True)
def known_patterns(monkeypatch):
    """Every field's pattern 1,000 ft above it and left-hand all round,
    without the FAA's airport files -- which a fresh checkout does not
    have, and would download."""
    monkeypatch.setattr(faa_data, "published_pattern_agl_ft", lambda ident, cache_dir: None)
    # No field the armed services own, without the FAA's airport file: a
    # test about one stubs it again itself.
    monkeypatch.setattr(faa_data, "military_fields", lambda cache_dir: {})
    monkeypatch.setattr(faa_data, "private_fields", lambda cache_dir: frozenset())
    monkeypatch.setattr(faa_data, "airport_contact", lambda ident, cache_dir: {"phone": None, "address": None})
    monkeypatch.setattr(pattern, "right_traffic_ends", lambda ident, cache_dir=None: set())


@pytest.fixture(autouse=True)
def uncontrolled_fields(monkeypatch):
    """Class G at every field's surface, without the FAA's airspace
    shapefile: a test about the class stubs these again itself."""
    monkeypatch.setattr(airspace, "ensure_class_airspace_shapefile", lambda cache_dir: "Class_Airspace.shp")
    monkeypatch.setattr(airspace, "surface_class_at", lambda lat, lon, shp: "G")
    monkeypatch.setattr(airspace, "surface_classes", lambda points, shp: ["G"] * len(points))


@pytest.fixture(autouse=True)
def quiet_sky(monkeypatch):
    """No TFRs, PIREPs or G-AIRMETs near any route, without asking
    tfr.faa.gov or aviationweather.gov: a test about them stubs them
    again itself."""
    monkeypatch.setattr(tfr, "along_route", lambda path, start, end: [])
    monkeypatch.setattr(weather, "pireps_along_route", lambda path: [])
    monkeypatch.setattr(weather, "gairmets_along_route", lambda path, window: [])


@pytest.fixture(autouse=True)
def no_runway_end_positions(monkeypatch):
    """No surveyed runway ends, without NASR's file: a test about them
    stubs them itself."""
    monkeypatch.setattr(pattern, "end_positions", lambda ident, cache_dir=None: {})


@pytest.fixture(autouse=True)
def no_publications(monkeypatch):
    """No airport diagram or Chart Supplement page, without the FAA's
    indexes."""
    monkeypatch.setattr(publications, "airport_diagram_url", lambda ident: None)
    monkeypatch.setattr(publications, "airport_diagram_cycle", lambda ident: None)
    monkeypatch.setattr(publications, "terminal_charts", lambda ident: [])
    monkeypatch.setattr(publications, "chart_supplement_url", lambda ident: None)


@pytest.fixture
def altitude() -> dict:
    """What vfr.altitude.select_cruise_altitude returns for a flyable route."""
    return {
        "recommended_ft": 4500.0, "candidates_ft": [4500.0], "course_magnetic_deg": 335.0, "eastbound": False,
        "floor_ft": 2200.0, "airspace_ceiling_ft": None,
        "airspace_transits": [], "freezing_level_ft": None, "band_ceiling_ft": None, "min_ceiling_ft": None,
        "min_visibility_sm": None, "hazards": [], "low_ceiling_or_visibility": False, "weather_unavailable": [],
        "segments": [],
    }


def select_cruise_altitude_stub(altitude: dict):
    """A select_cruise_altitude that answers `altitude` and, given the
    nav log's fixes, one segment per leg with the recommended altitude
    as its only legal one -- or none at all when there is no
    recommendation, which is what makes a route unflyable."""
    def select(start, end, profile, faa_cache_dir=None, fixes=None, fcst_hr="06", pending=None, window=None):
        candidates = [] if altitude["recommended_ft"] is None else [altitude["recommended_ft"]]
        segments = [
            {"from_nm": 0.0, "to_nm": 10.0, "floor_ft": altitude["floor_ft"], "airspace_ceiling_ft": None,
             "band_ceiling_ft": None, "candidates_ft": candidates}
            for _ in range(len(fixes) - 1)
        ] if fixes else []
        return {**altitude, "segments": segments}
    return select


@pytest.fixture
def messages():
    """An NDJSON response's lines, parsed."""
    return lambda resp: [json.loads(line) for line in resp.text.splitlines() if line.strip()]
