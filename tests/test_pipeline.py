"""pipeline.py's actual collect/engineer_features/retrain need live
network/real data, out of unit-test scope (see docs/README.md's Testing &
CI section for their manual live-verification record) -- this covers the
pure helper functions around them: the local-vs-remote-path guard, and
SageMaker script-mode channel resolution.
"""
import pytest

from vfr.pipeline import _ensure_local_dir, _ensure_local_output_dir, _find_one, _reject_remote_uri


def test_reject_remote_uri_rejects_uri_style_paths():
    with pytest.raises(NotImplementedError):
        _reject_remote_uri("s3://some-bucket/some-key")


def test_reject_remote_uri_allows_local_paths(tmp_path):
    _reject_remote_uri(tmp_path / "features.parquet")  # must not raise


def test_ensure_local_output_dir_creates_the_parent(tmp_path):
    target = tmp_path / "nested" / "dir" / "out.csv"
    result = _ensure_local_output_dir(target)
    assert result == target
    assert target.parent.is_dir()
    assert not target.exists()  # only the parent dir is created, not the file itself


def test_ensure_local_output_dir_rejects_a_uri():
    with pytest.raises(NotImplementedError):
        _ensure_local_output_dir("s3://some-bucket/features.parquet")


def test_ensure_local_dir_creates_the_directory_itself(tmp_path):
    target = tmp_path / "candidate"
    result = _ensure_local_dir(target)
    assert result == target
    assert target.is_dir()


def test_find_one_resolves_a_glob_match(tmp_path):
    (tmp_path / "whatever-sagemaker-named-it.parquet").write_text("not real data")
    found = _find_one(tmp_path, "*.parquet")
    assert found == tmp_path / "whatever-sagemaker-named-it.parquet"


def test_find_one_raises_when_nothing_matches(tmp_path):
    with pytest.raises(FileNotFoundError):
        _find_one(tmp_path, "*.parquet")
