"""HTTP-layer tests for model-service's FastAPI app, against a real
TestClient -- this service had zero tests before this pass. Every
model/feature-store artifact a test needs is written to `tmp_path` and
pointed at via `app.main`'s own MODEL_DIR/FEATURES_DIR/CANDIDATES_DIR
(monkeypatched per test, the same module-level names `_load`/
`_features_path` actually read), rather than mocking anything -- real
joblib/parquet files through the service's own real loading and
inference code is what actually exercises it.

`_state`/`_features_cache` are populated lazily and cached at module
scope for the life of the process (see main.py's own comment on why),
which would otherwise leak one test's model/feature-store artifacts
into the next -- the autouse fixture below clears both before every
test so each one starts from "nothing loaded yet."
"""
import json

import joblib
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sklearn.dummy import DummyRegressor

from app import main

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def _reset_loaded_state():
    main._state.clear()
    main._features_cache.clear()


def _write_current_model(model_dir, feature_cols=("x",)):
    model_dir.mkdir(parents=True, exist_ok=True)
    model = DummyRegressor(strategy="constant", constant=3.0)
    model.fit([[0.0]], [0.0])
    joblib.dump(model, model_dir / "model.joblib")
    (model_dir / "metrics.json").write_text(json.dumps({
        "model_type": "dummy", "feature_cols": list(feature_cols), "trained_at": "2026-01-01T00:00:00Z",
    }))


def _write_features(path, rows: dict):
    pd.DataFrame(rows).to_parquet(path)


# --- /ping ---


def test_ping_reports_no_model_loaded_when_nothing_has_been_promoted(tmp_path, monkeypatch):
    features_dir = tmp_path / "features"
    features_dir.mkdir()
    monkeypatch.setattr(main, "MODEL_DIR", tmp_path / "model")
    monkeypatch.setattr(main, "FEATURES_DIR", features_dir)
    monkeypatch.setattr(main, "CANDIDATES_DIR", tmp_path / "candidates")

    resp = client.get("/ping")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "no model loaded"
    assert body["model_loaded"] is False
    assert body["models"]["current"] is False


def test_ping_reports_model_loaded_and_the_routes_built_for_it(tmp_path, monkeypatch):
    features_dir = tmp_path / "features"
    features_dir.mkdir()
    monkeypatch.setattr(main, "MODEL_DIR", tmp_path / "model")
    monkeypatch.setattr(main, "FEATURES_DIR", features_dir)
    monkeypatch.setattr(main, "CANDIDATES_DIR", tmp_path / "candidates")
    _write_current_model(tmp_path / "model")
    _write_features(features_dir / "features_c81_kdlh.parquet", {"osm_id": [1]})

    resp = client.get("/ping")

    assert resp.status_code == 200
    body = resp.json()
    assert body["model_loaded"] is True
    assert body["trained_at"] == "2026-01-01T00:00:00Z"
    assert body["routes"] == [{"departure_ident": "C81", "destination_ident": "KDLH"}]
    assert body["models"] == {"current": True, "pytorch": False, "tensorflow": False, "spark": False}


# --- /routes ---


def test_routes_lists_every_built_feature_store(tmp_path, monkeypatch):
    features_dir = tmp_path / "features"
    features_dir.mkdir()
    monkeypatch.setattr(main, "FEATURES_DIR", features_dir)
    _write_features(features_dir / "features_c81_kdlh.parquet", {"osm_id": [1]})
    _write_features(features_dir / "features_kosh_ksbn.parquet", {"osm_id": [1]})

    resp = client.get("/routes")

    assert resp.status_code == 200
    body = resp.json()
    assert {"departure_ident": "C81", "destination_ident": "KDLH"} in body["routes"]
    assert {"departure_ident": "KOSH", "destination_ident": "KSBN"} in body["routes"]


# --- /invocations ---


def test_invocations_503s_with_the_pipeline_command_when_no_model_is_promoted(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "MODEL_DIR", tmp_path / "model")
    monkeypatch.setattr(main, "FEATURES_DIR", tmp_path / "features")
    monkeypatch.setattr(main, "CANDIDATES_DIR", tmp_path / "candidates")

    resp = client.post("/invocations", json={"departure_ident": "C81", "destination_ident": "KDLH"})

    assert resp.status_code == 503
    assert "promote" in resp.json()["detail"]


def test_invocations_503s_with_a_train_command_for_an_unbuilt_named_model(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "MODEL_DIR", tmp_path / "model")
    monkeypatch.setattr(main, "FEATURES_DIR", tmp_path / "features")
    monkeypatch.setattr(main, "CANDIDATES_DIR", tmp_path / "candidates")

    resp = client.post(
        "/invocations", json={"departure_ident": "C81", "destination_ident": "KDLH", "model": "pytorch"},
    )

    assert resp.status_code == 503
    assert "vfr.model_candidates pytorch" in resp.json()["detail"]


def test_invocations_404s_with_the_collection_commands_for_an_uncollected_route(tmp_path, monkeypatch):
    features_dir = tmp_path / "features"
    features_dir.mkdir()
    monkeypatch.setattr(main, "MODEL_DIR", tmp_path / "model")
    monkeypatch.setattr(main, "FEATURES_DIR", features_dir)
    monkeypatch.setattr(main, "CANDIDATES_DIR", tmp_path / "candidates")
    _write_current_model(tmp_path / "model")

    resp = client.post("/invocations", json={"departure_ident": "C81", "destination_ident": "KDLH"})

    assert resp.status_code == 404
    detail = resp.json()["detail"]
    assert "collect" in detail
    assert "engineer-features" in detail


def test_invocations_rejects_a_malformed_ident(tmp_path, monkeypatch):
    resp = client.post("/invocations", json={"departure_ident": "TOO-LONG", "destination_ident": "KDLH"})

    assert resp.status_code == 422


def test_invocations_scores_checkpoints_and_sorts_by_along_track_distance(tmp_path, monkeypatch):
    features_dir = tmp_path / "features"
    features_dir.mkdir()
    monkeypatch.setattr(main, "MODEL_DIR", tmp_path / "model")
    monkeypatch.setattr(main, "FEATURES_DIR", features_dir)
    monkeypatch.setattr(main, "CANDIDATES_DIR", tmp_path / "candidates")
    _write_current_model(tmp_path / "model", feature_cols=("x",))
    _write_features(features_dir / "features_c81_kdlh.parquet", {
        "osm_id": [2, 1], "category": ["lake", "tower"], "name": [None, "Tower A"],
        "lat": [42.0, 43.0], "lon": [-88.0, -89.0], "along_track_nm": [20.0, 5.0], "x": [1.0, 2.0],
    })

    resp = client.post("/invocations", json={"departure_ident": "c81", "destination_ident": "kdlh"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["stub"] is False
    assert body["model_type"] == "dummy"
    # Sorted by along_track_nm -- the tower (5nm) before the lake (20nm),
    # the reverse of the row order they were written in.
    assert [c["osm_id"] for c in body["checkpoints"]] == ["1", "2"]
    assert body["checkpoints"][0]["name"] == "Tower A"
    # No name in the source data -- the "(unnamed)" fallback, not a
    # null/empty string reaching the caller.
    assert body["checkpoints"][1]["name"] == "(unnamed)"
    # DummyRegressor(strategy="constant", constant=3.0) -- every row
    # gets the same score back, rounded to 4dp same as the real path.
    assert body["checkpoints"][0]["predicted_score"] == 3.0
