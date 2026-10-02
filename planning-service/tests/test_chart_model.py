"""The planner's side of the chart model: its ratings counted on the
corridor the training page reads, the table written from them, and the
model's scores on the training page's points."""
import threading

import pandas as pd
from fastapi.testclient import TestClient
from vfr import chartlabels, chartmodel, chartvision, model_client

from app import chart_model
from app.main import app
from app.routers import chart

client = TestClient(app)


def _landmark(lat, lon, category="road_or_rail", score=3.6):
    return chartvision.Landmark(category, lat, lon, 0.0, score, 40,
                                extras={"along_track_nm": 5.0, "cross_track_nm": 0.1})


def _job(landmarks, done=True):
    return {"blocks": [{"block": 0, "blocks": 1, "tiles": 4, "missing": 0, "landmarks": landmarks}],
            "done": done, "error": None, "at": 0.0, "cond": threading.Condition()}


PICKS = [
    {"route": "C81->KDLH", "lat": 42.4, "lon": -88.1, "rating": 0},
    {"route": "C81->KDLH", "lat": 42.6, "lon": -88.3, "rating": 4},
    # Where the reader found a graticule tick, before it learnt not to.
    {"route": "C81->KDLH", "lat": 42.5, "lon": -88.0, "rating": 0},
    {"route": "C81->KDLH", "lat": 42.7, "lon": -88.4, "rating": None},
]


def _corridor(monkeypatch, done=True):
    landmarks = [_landmark(42.4, -88.1), _landmark(42.6, -88.3, "river", 4.3)]
    monkeypatch.setattr(chart_model, "detect_job", lambda key, start, end, half_width_nm: _job(landmarks, done))
    monkeypatch.setattr(chart_model, "faa_airports", lambda *args: [])
    monkeypatch.setattr(chartlabels, "load_picks", lambda route=None: PICKS)
    return landmarks


def test_the_ratings_on_points_the_reader_finds_count_and_the_rest_are_named(monkeypatch):
    _corridor(monkeypatch)

    readiness = chart_model.readiness()

    assert (readiness["usable"], readiness["rated"], readiness["off_detection"]) == (2, 3, 1)
    assert not readiness["ready"]
    assert readiness["message"] == ("2 of the 30 ratings training needs. 1 of your 3 are on points the chart "
                                    "reader no longer finds. Rate 28 more.")


def test_a_corridor_still_being_read_is_named_not_counted(monkeypatch):
    _corridor(monkeypatch, done=False)

    readiness = chart_model.readiness()

    assert readiness["reading"] == ["C81->KDLH"] and readiness["usable"] == 0 and not readiness["ready"]


def test_the_table_holds_every_rating_on_a_detection_0s_and_all(monkeypatch, tmp_path):
    _corridor(monkeypatch)
    monkeypatch.setattr(chartmodel, "TRAINING_TABLE_PATH", tmp_path / "chart_training.parquet")

    table = pd.read_parquet(chart_model.write_training_table())

    assert sorted(table["rating"]) == [0, 4]
    assert sorted(table["palette_score"]) == [3.6, 4.3]


def test_the_training_pages_points_carry_the_chart_models_scores(monkeypatch, messages):
    landmarks = _corridor(monkeypatch)
    monkeypatch.setattr(chart, "detect_job", lambda key, start, end, half_width_nm: _job(landmarks))
    monkeypatch.setattr(chart, "faa_airports", lambda *args, **kwargs: [])
    monkeypatch.setattr(chartlabels, "load_picks", lambda route=None: [])
    sent = []
    monkeypatch.setattr(model_client, "score_detections", lambda rows: sent.append(rows) or [0.4, 3.9])

    lines = messages(client.get("/api/detect/stream", params={"dep": "C81", "dest": "KDLH"}))

    detections = [d for m in lines if m["type"] == "block" for d in m["detections"]]
    assert [d["predicted_score"] for d in detections] == [0.4, 3.9]
    assert [d["score"] for d in detections] == [3.6, 4.3]
    # Every point's features at once, as each counts its neighbours.
    assert len(sent) == 1 and len(sent[0]) == 2 and "abs_cross_track_nm" not in sent[0][0]


def test_with_no_chart_model_the_points_carry_the_palettes_constants_alone(monkeypatch, messages):
    landmarks = _corridor(monkeypatch)
    monkeypatch.setattr(chart, "detect_job", lambda key, start, end, half_width_nm: _job(landmarks))
    monkeypatch.setattr(chart, "faa_airports", lambda *args, **kwargs: [])
    monkeypatch.setattr(chartlabels, "load_picks", lambda route=None: [])

    lines = messages(client.get("/api/detect/stream", params={"dep": "C81", "dest": "KDLH"}))

    detections = [d for m in lines if m["type"] == "block" for d in m["detections"]]
    assert [d["predicted_score"] for d in detections] == [None, None]
