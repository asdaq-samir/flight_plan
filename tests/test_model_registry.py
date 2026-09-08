import json

from vfr.model_registry import evaluate, promote


def _write_metrics(directory, mae):
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "metrics.json").write_text(json.dumps({"held_out_mae": mae}))
    (directory / "model.joblib").write_text("not a real model, just a placeholder for the test")


def test_evaluate_true_when_nothing_promoted_yet(tmp_path):
    candidate_dir = tmp_path / "candidate"
    current_dir = tmp_path / "current"
    _write_metrics(candidate_dir, mae=1.0)
    assert evaluate(candidate_dir, current_dir) is True


def test_evaluate_true_when_candidate_beats_current(tmp_path):
    candidate_dir, current_dir = tmp_path / "candidate", tmp_path / "current"
    _write_metrics(candidate_dir, mae=0.5)
    _write_metrics(current_dir, mae=1.0)
    assert evaluate(candidate_dir, current_dir) is True


def test_evaluate_false_when_candidate_loses_to_current(tmp_path):
    candidate_dir, current_dir = tmp_path / "candidate", tmp_path / "current"
    _write_metrics(candidate_dir, mae=1.5)
    _write_metrics(current_dir, mae=1.0)
    assert evaluate(candidate_dir, current_dir) is False


def test_promote_copies_model_and_metrics_and_writes_a_version(tmp_path):
    candidate_dir, current_dir = tmp_path / "candidate", tmp_path / "current"
    _write_metrics(candidate_dir, mae=0.5)

    result = promote(candidate_dir, current_dir)

    assert result == current_dir
    assert (current_dir / "model.joblib").exists()
    assert (current_dir / "metrics.json").exists()
    versions = list((tmp_path / "versions").iterdir())
    assert len(versions) == 1
    assert (versions[0] / "model.joblib").exists()
