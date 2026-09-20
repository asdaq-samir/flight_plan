"""A promotion writes new files into the model directory while the
service runs; the next request must score with the new model, not
the one the process started with."""
import json
import os

import joblib
from sklearn.dummy import DummyRegressor

from app import main


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


def test_a_promoted_model_replaces_the_loaded_one_without_a_restart(tmp_path, monkeypatch):
    main._state.clear()
    monkeypatch.setattr(main, "MODEL_DIR", tmp_path / "model")
    _write_model(tmp_path / "model", constant=3.0, mtime_s=1_700_000_000)

    first = main._load("current")
    assert first["model"].predict([[0.0]])[0] == 3.0
    # Unchanged files: the same loaded state, no re-read.
    assert main._load("current") is first

    _write_model(tmp_path / "model", constant=5.0, mtime_s=1_700_000_060)

    promoted = main._load("current")
    assert promoted is not first
    assert promoted["model"].predict([[0.0]])[0] == 5.0
