import pytest

from app import detection, planning, scoring


@pytest.fixture(autouse=True)
def _fresh_caches():
    """The app remembers per-route work (cruise altitude, model scores,
    corridor detections) across requests, so a test that monkeypatches
    one of those dependencies must not be handed the previous test's
    answer instead."""
    for cache in (planning._ALTITUDE_CACHE, scoring._SCORE_CACHE, detection._DETECT_JOBS):
        cache.clear()
