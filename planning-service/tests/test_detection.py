"""The corridor read, kept on disk beside its tiles: a planner that has
not read the corridor replays a finished read rather than reading it
again, and a new cycle of tiles is read afresh."""
import numpy as np
import pytest
from vfr import charts, chartvision

from app import detection

C81, KDLH = (42.3172, -88.0905), (46.8421, -92.1936)
KEY = ("C81-KDLH", 4.0)


@pytest.fixture
def tiles(tmp_path, monkeypatch):
    """The tile cache in a directory of the test's own, serving one cycle."""
    monkeypatch.setattr(detection, "CHART_TILE_CACHE_DIR", tmp_path)
    monkeypatch.setattr(charts, "serving_cycle", lambda: "2026-09-03")
    monkeypatch.setattr(charts, "tiles_revision", lambda cycle: 0)
    return tmp_path


@pytest.fixture
def reads(monkeypatch):
    """A one-block corridor, with numpy's scalars in it as the reader
    leaves them; each read of it counted."""
    counted = []

    def iter_landmarks(start, end, half_width_nm):
        counted.append(half_width_nm)
        yield {"block": 0, "blocks": 1, "tiles": 4, "missing": 0, "landmarks": [
            chartvision.Landmark("water", 43.0, -89.0, np.float64(1200.0), 3.5, np.int64(40),
                                 extras={"along_track_nm": 50.0, "cross_track_nm": np.float64(0.5)}),
        ]}

    monkeypatch.setattr(chartvision, "iter_landmarks_along_route", iter_landmarks)
    return counted


def _finished(job: dict) -> dict:
    with job["cond"]:
        job["cond"].wait_for(lambda: job["done"], timeout=10)
    return job


def test_a_finished_read_is_kept_and_a_planner_that_never_read_it_replays_it(tiles, reads):
    first = _finished(detection.detect_job(KEY, C81, KDLH, 4.0))
    assert reads == [4.0] and first["error"] is None
    assert list(tiles.glob("2026-09-03/detections/C81-KDLH-4nm-r0-*.json"))

    detection._DETECT_JOBS.clear()   # a planner just started
    again = _finished(detection.detect_job(KEY, C81, KDLH, 4.0))

    assert reads == [4.0]
    (landmark,) = again["blocks"][0]["landmarks"]
    assert landmark.category == "water" and landmark.pixels == 40 and landmark.extras["cross_track_nm"] == 0.5


def test_a_new_cycle_of_tiles_is_read_afresh(tiles, reads, monkeypatch):
    _finished(detection.detect_job(KEY, C81, KDLH, 4.0))
    detection._DETECT_JOBS.clear()
    monkeypatch.setattr(charts, "serving_cycle", lambda: "2026-10-29")

    _finished(detection.detect_job(KEY, C81, KDLH, 4.0))

    assert reads == [4.0, 4.0]
