import pytest

from app import main


@pytest.fixture(autouse=True)
def _fresh_caches():
    """app.main remembers per-route work (cruise altitude, model scores,
    corridor detections) across requests, so a test that monkeypatches
    one of those dependencies must not be handed the previous test's
    answer instead."""
    for cache in (main._ALTITUDE_CACHE, main._SCORE_CACHE, main._DETECT_JOBS):
        cache.clear()
