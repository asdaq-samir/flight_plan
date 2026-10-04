"""HTTP-layer tests for model-service's FastAPI app, against a real
TestClient. The chart model a test needs is written to `tmp_path` and
pointed at via `app.main`'s own CHART_MODEL_DIR (monkeypatched per test),
rather than mocking anything: real joblib files through the service's
own loading and inference code.

`_cache` is populated lazily and kept at module scope while the files
are unchanged (see main.py's `_fresh`), which would otherwise leak one
test's model into the next -- the autouse fixture below clears it
before every test.
"""
import json

import joblib
import pytest
from fastapi.testclient import TestClient
from sklearn.linear_model import LinearRegression

from app import main

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def _reset_loaded_state():
    main._cache.clear()


def _write_chart_model(chart):
    chart.mkdir(parents=True, exist_ok=True)
    # rating = log_area - is_river: a row without is_river reads it as 0.
    model = LinearRegression().fit([[1.0, 0.0], [2.0, 1.0], [3.0, 0.0]], [1.0, 1.0, 3.0])
    joblib.dump(model, chart / "model.joblib")
    (chart / "metrics.json").write_text(json.dumps({
        "model_type": "LinearRegression", "feature_cols": ["log_area", "is_river"], "trained_at": "2026-10-02T00:00:00Z",
        "held_out_mae": 0.6, "palette_held_out_mae": 1.4, "rating_range": [0, 5],
    }))


# --- /ping ---


def test_ping_is_up_with_no_chart_model_promoted(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "CHART_MODEL_DIR", tmp_path / "chart")

    resp = client.get("/ping")

    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "chart_model": False, "trained_at": None}


def test_ping_says_when_the_promoted_chart_model_was_trained(tmp_path, monkeypatch):
    _write_chart_model(tmp_path / "chart")
    monkeypatch.setattr(main, "CHART_MODEL_DIR", tmp_path / "chart")

    body = client.get("/ping").json()

    assert body["chart_model"] is True
    assert body["trained_at"] == "2026-10-02T00:00:00Z"


def test_ping_does_not_load_the_model(tmp_path, monkeypatch):
    # A model that would not load is a failed scoring call, not an
    # unhealthy service the planner waits on.
    chart = tmp_path / "chart"
    chart.mkdir()
    (chart / "model.joblib").write_text("not a model")
    (chart / "metrics.json").write_text(json.dumps({"trained_at": "2026-10-02T00:00:00Z"}))
    monkeypatch.setattr(main, "CHART_MODEL_DIR", chart)

    resp = client.get("/ping")

    assert resp.status_code == 200 and resp.json()["chart_model"] is True


# --- /score-detections ---


def test_score_detections_503s_while_no_chart_model_is_promoted(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "CHART_MODEL_DIR", tmp_path / "chart")

    resp = client.post("/score-detections", json={"rows": [{"log_area": 4.0}]})

    assert resp.status_code == 503


def test_score_detections_scores_each_row_in_order_on_the_columns_the_model_was_fitted_on(tmp_path, monkeypatch):
    _write_chart_model(tmp_path / "chart")
    monkeypatch.setattr(main, "CHART_MODEL_DIR", tmp_path / "chart")

    resp = client.post("/score-detections", json={"rows": [
        {"is_river": 1.0, "log_area": 4.0, "nn_dist_nm": 9.0},
        {"log_area": 2.0},
        # 9 by the line, held to the scale it was trained on.
        {"log_area": 9.0},
    ]})

    assert resp.status_code == 200
    body = resp.json()
    assert body["scores"] == pytest.approx([3.0, 2.0, 5.0])
    assert (body["held_out_mae"], body["palette_held_out_mae"]) == (0.6, 1.4)
