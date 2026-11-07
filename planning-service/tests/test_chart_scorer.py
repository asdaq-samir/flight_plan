"""app.chart_scorer: the chart model's scores, in the planner's process.
model-service's own tests until it was folded in here (2026-11-06). The
chart model a test needs is written to `tmp_path` and pointed at through
the module's CHART_MODEL_DIR, rather than mocking anything: real joblib
files through the scorer's own loading and inference code.

conftest's autouse fixture stubs `score_detections` for every other
test, so the real one is taken here at import, before any fixture runs.
`_cache` is kept at module scope while the files are unchanged, which
would leak one test's model into the next: cleared before each."""
import json
import os

import joblib
import pytest
from sklearn.dummy import DummyRegressor
from sklearn.linear_model import LinearRegression

from app import chart_scorer

score_detections = chart_scorer.score_detections


@pytest.fixture(autouse=True)
def _chart_dir(tmp_path, monkeypatch):
    chart_scorer._cache.clear()
    monkeypatch.setattr(chart_scorer, "CHART_MODEL_DIR", tmp_path / "chart")
    return tmp_path / "chart"


def _write_chart_model(chart):
    chart.mkdir(parents=True, exist_ok=True)
    # rating = log_area - is_river: a row without is_river reads it as 0.
    model = LinearRegression().fit([[1.0, 0.0], [2.0, 1.0], [3.0, 0.0]], [1.0, 1.0, 3.0])
    joblib.dump(model, chart / "model.joblib")
    (chart / "metrics.json").write_text(json.dumps({
        "model_type": "LinearRegression", "feature_cols": ["log_area", "is_river"], "trained_at": "2026-10-02T00:00:00Z",
        "held_out_mae": 0.6, "palette_held_out_mae": 1.4, "rating_range": [0, 5],
    }))


def test_no_chart_model_promoted_is_no_scores(_chart_dir):
    assert score_detections([{"log_area": 4.0}]) is None


def test_each_row_is_scored_in_order_on_the_columns_the_model_was_fitted_on(_chart_dir):
    _write_chart_model(_chart_dir)

    scores = score_detections([
        {"is_river": 1.0, "log_area": 4.0, "nn_dist_nm": 9.0},
        {"log_area": 2.0},
        # 9 by the line, held to the scale it was trained on.
        {"log_area": 9.0},
    ])

    assert scores == pytest.approx([3.0, 2.0, 5.0])


def test_no_rows_is_no_scores_to_give_not_none(_chart_dir):
    _write_chart_model(_chart_dir)

    assert score_detections([]) == []


def test_a_model_that_will_not_load_is_no_scores_not_an_error(_chart_dir):
    _chart_dir.mkdir()
    (_chart_dir / "model.joblib").write_text("not a model")
    (_chart_dir / "metrics.json").write_text(json.dumps({"feature_cols": ["log_area"]}))

    assert score_detections([{"log_area": 4.0}]) is None


def _write_model(model_dir, constant: float, mtime_s: float):
    model_dir.mkdir(parents=True, exist_ok=True)
    model = DummyRegressor(strategy="constant", constant=constant)
    model.fit([[0.0]], [0.0])
    joblib.dump(model, model_dir / "model.joblib")
    (model_dir / "metrics.json").write_text(json.dumps({
        "model_type": "dummy", "feature_cols": ["x"], "trained_at": "2026-01-01T00:00:00Z",
    }))
    for name in ("model.joblib", "metrics.json"):
        os.utime(model_dir / name, (mtime_s, mtime_s))


def test_a_promoted_model_replaces_the_loaded_one_without_a_restart(_chart_dir):
    # A promotion writes new files into the chart model's directory while
    # the planner runs; the next score must come from the new model, not
    # the one the process started with.
    _write_model(_chart_dir, constant=3.0, mtime_s=1_700_000_000)

    first = chart_scorer._chart_model()
    assert first["model"].predict([[0.0]])[0] == 3.0
    # Unchanged files: the same loaded state, no re-read.
    assert chart_scorer._chart_model() is first
    assert score_detections([{"x": 0.0}]) == [3.0]

    _write_model(_chart_dir, constant=5.0, mtime_s=1_700_000_060)

    promoted = chart_scorer._chart_model()
    assert promoted is not first
    assert promoted["model"].predict([[0.0]])[0] == 5.0
    assert score_detections([{"x": 0.0}]) == [5.0]
