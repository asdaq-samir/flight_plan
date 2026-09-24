"""pipeline.py's actual collect/engineer_features/retrain need live
network/real data, out of unit-test scope (see docs/README.md's Testing &
CI section for their manual live-verification record) -- this covers the
pure helper functions around them: the local-vs-remote-path guard, the
temp-and-rename every output is written through, and SageMaker
script-mode channel resolution.
"""
from pathlib import Path

import pytest

from vfr.pipeline import _ensure_local_dir, _ensure_local_output_dir, _find_one, _publish, _reject_remote_uri


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


def test_publish_leaves_only_the_finished_file(tmp_path):
    target = tmp_path / "processed" / "features_c81_kdlh.parquet"
    assert _publish(target, lambda tmp: Path(tmp).write_bytes(b"whole")) == target
    assert target.read_bytes() == b"whole"
    assert [p.name for p in target.parent.iterdir()] == [target.name]
    assert oct(target.stat().st_mode & 0o777) == oct(0o644)


def test_a_write_cut_short_leaves_the_previous_file_and_no_temp(tmp_path):
    # It used to write in place: a torn table read as built until someone
    # deleted it by hand.
    target = tmp_path / "features_c81_kdlh.parquet"
    target.write_bytes(b"previous")

    def torn(tmp):
        Path(tmp).write_bytes(b"half")
        raise OSError("No space left on device")

    with pytest.raises(OSError):
        _publish(target, torn)
    assert target.read_bytes() == b"previous"
    assert [p.name for p in tmp_path.iterdir()] == [target.name]


def test_the_temp_file_is_not_a_corridor_to_any_reader(tmp_path):
    target = tmp_path / "features_c81_kdlh.parquet"
    seen = []

    def write(tmp):
        Path(tmp).write_bytes(b"x")
        seen.extend(p.name for pattern in ("features_*.parquet", "*.parquet") for p in tmp_path.glob(pattern))

    _publish(target, write)
    assert seen == []


def test_engineer_features_on_the_command_line_defaults_to_the_corridor_named(monkeypatch):
    # Its paths defaulted to C81->KDLH's whatever idents were given, so the
    # command model-service suggests for another route rebuilt that one.
    import sys

    from vfr import pipeline
    from vfr.config import PROCESSED_DIR

    calls = []
    monkeypatch.setattr(pipeline, "engineer_features", lambda **kw: calls.append(kw))
    monkeypatch.setattr(sys, "argv", ["pipeline", "engineer-features", "--dep-ident", "KDSM", "--dest-ident", "KOMA"])
    pipeline._cli()
    assert calls == [{
        "in_path": PROCESSED_DIR / "candidates_kdsm_koma.csv",
        "out_path": PROCESSED_DIR / "features_kdsm_koma.parquet",
    }]


def test_find_one_resolves_a_glob_match(tmp_path):
    (tmp_path / "whatever-sagemaker-named-it.parquet").write_text("not real data")
    found = _find_one(tmp_path, "*.parquet")
    assert found == tmp_path / "whatever-sagemaker-named-it.parquet"


def test_find_one_raises_when_nothing_matches(tmp_path):
    with pytest.raises(FileNotFoundError):
        _find_one(tmp_path, "*.parquet")


def test_chart_picks_are_training_labels_and_win_over_older_ratings(tmp_path):
    """A pick in the training workspace claims the nearest OSM candidate
    within SAME_PLACE_NM; before this, training never read chart_picks."""
    import pandas as pd

    from vfr import pipeline

    features = tmp_path / "features_c81_kdlh.parquet"
    pd.DataFrame([
        {"osm_id": "1", "osm_type": "way", "lat": 45.0, "lon": -90.0, **{c: 0.0 for c in pipeline.FEATURE_COLS_BASE}},
        {"osm_id": "2", "osm_type": "node", "lat": 45.5, "lon": -90.5, **{c: 0.0 for c in pipeline.FEATURE_COLS_BASE}},
        {"osm_id": "3", "osm_type": "node", "lat": 46.0, "lon": -91.0, **{c: 0.0 for c in pipeline.FEATURE_COLS_BASE}},
    ]).to_parquet(features)
    labels = tmp_path / "ratings.csv"
    labels.write_text("osm_id,osm_type,name,category,rating\n1,way,Lake,lake,2\n2,node,Town,town,3\n")
    picks = tmp_path / "picks.csv"
    picks.write_text(
        "route,source,role,category,lat,lon,along_track_nm,cross_track_nm,rating,area_m2,note,created_at\n"
        "C81->KDLH,detected,visual,lake_or_pond,45.0005,-90.0005,1,0,5,,,2026-09-20T00:00:00+00:00\n"   # on 1
        "C81->KDLH,added,dr,town,46.0,-91.0,2,0,4,,,2026-09-20T00:00:00+00:00\n"                        # on 3
        "C81->KDLH,detected,visual,town,45.5,-90.5,3,0,0,,,2026-09-20T00:00:00+00:00\n"                 # a rejection
        "C81->KDLH,added,dr,river,47.0,-92.0,4,0,5,,,2026-09-20T00:00:00+00:00\n"                       # on nothing
        "KDSM->KOMA,added,dr,town,45.5,-90.5,1,0,5,,,2026-09-20T00:00:00+00:00\n"                       # another route
    )

    labeled, _ = pipeline._load_labeled(features, labels, picks_path=picks)

    assert dict(zip(labeled["osm_id"], labeled["rating"])) == {"1": 5, "2": 3, "3": 4}


def test_the_holdout_is_the_same_landmarks_every_run():
    import pandas as pd

    from vfr import pipeline

    df = pd.DataFrame({"osm_id": [str(i) for i in range(200)], "osm_type": ["node"] * 200})
    first, again = pipeline.holdout_split(df), pipeline.holdout_split(df.sample(frac=1, random_state=1))
    assert first.sum() == again.sum() and 25 <= first.sum() <= 55
    assert set(df["osm_id"][first]) == set(df.loc[again.index]["osm_id"][again])
