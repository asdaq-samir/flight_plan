"""What every test here shares: fresh caches, two known airports, a
flyable altitude selection and an NDJSON reader."""
import json

import pytest
from vfr import airports

from app import detection, planning, scoring


@pytest.fixture(autouse=True)
def _fresh_caches():
    """The app remembers per-route work (cruise altitude, model scores,
    corridor detections) across requests, so a test that monkeypatches
    one of those dependencies must not be handed the previous test's
    answer instead."""
    for cache in (planning._ALTITUDE_CACHE, planning._PLANS_CACHE, scoring._SCORE_CACHE, detection._DETECT_JOBS):
        cache.clear()


def airport(ident: str) -> dict:
    coords = {"C81": (42.3172, -88.0905), "KDLH": (46.8421, -92.1936)}[ident]
    return {"ident": ident, "name": ident, "lat": coords[0], "lon": coords[1], "elevation_ft": 900.0,
            "municipality": "", "region": ""}


@pytest.fixture(autouse=True)
def known_airports(monkeypatch):
    """C81 and KDLH, without the airports table. A test about an unknown
    ident stubs get_airport again itself."""
    monkeypatch.setattr(airports, "get_airport", lambda ident, **kw: airport(ident.upper()))


@pytest.fixture
def altitude() -> dict:
    """What vfr.altitude.select_cruise_altitude returns for a flyable route."""
    return {
        "recommended_ft": 4500.0, "candidates_ft": [4500.0], "floor_ft": 2200.0, "airspace_ceiling_ft": None,
        "airspace_transits": [], "freezing_level_ft": None, "band_ceiling_ft": None, "min_ceiling_ft": None,
        "min_visibility_sm": None, "hazards": [], "low_ceiling_or_visibility": False, "weather_unavailable": [],
        "segments": [],
    }


def select_cruise_altitude_stub(altitude: dict):
    """A select_cruise_altitude that answers `altitude` and, given the
    nav log's fixes, one segment per leg with the recommended altitude
    as its only legal one -- or none at all when there is no
    recommendation, which is what makes a route unflyable."""
    def select(start, end, profile, faa_cache_dir=None, fixes=None, fcst_hr="06"):
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
