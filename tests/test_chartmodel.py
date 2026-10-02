"""vfr.chartmodel: the training page's ratings on the chart reader's
detections, whether they are enough, and the model they train.

The table and the readiness need nothing past vfr's own list. retrain
needs scikit-learn, which the root suite does not install (it is the
training image's), so that test runs where it is there and skips where
it is not."""
import json

import pandas as pd
import pytest

from vfr import chartmodel
from vfr.chartfeatures import FEATURE_COLS


def _detection(lat, lon, category="road_or_rail", score=3.6):
    return {"lat": lat, "lon": lon, "category": category, "area_m2": 0.0, "pixels": 40,
            "cross_track_nm": 0.1, "along_track_nm": 5.0, "score": score}


def _pick(lat, lon, rating):
    return {"route": "C81->KDLH", "lat": lat, "lon": lon, "rating": rating}


def test_a_rated_pick_trains_on_the_detection_it_was_made_on_and_a_0_counts():
    detections = [_detection(42.0, -88.0), _detection(42.5, -88.5, "river", 4.3)]
    picks = [_pick(42.0, -88.0, 0), _pick(42.5001, -88.5, 3), _pick(43.0, -89.0, 5), _pick(42.2, -88.2, None)]

    rows = chartmodel.labeled_rows("C81->KDLH", detections, picks)

    # The 0 says "no feature" -- what the model is to learn about power
    # lines. The 5 lands on nothing the reader finds; the unrated pick
    # is no rating.
    assert list(rows["rating"]) == [0, 3]
    assert list(rows["palette_score"]) == [3.6, 4.3]
    assert set(FEATURE_COLS) <= set(rows.columns)
    assert set(rows["route"]) == {"C81->KDLH"}


def test_no_ratings_still_give_the_tables_columns():
    rows = chartmodel.labeled_rows("C81->KDLH", [_detection(42.0, -88.0)], [])
    assert rows.empty and {"rating", "palette_score", *FEATURE_COLS} <= set(rows.columns)


def test_readiness_says_how_many_more_and_why_some_do_not_count():
    short = chartmodel.readiness(usable=28, rated=32, off_detection=4, reading=[], needed=30)
    assert not short["ready"]
    assert short["message"] == ("28 of the 30 ratings training needs. 4 of your 32 are on points the chart "
                                "reader no longer finds. Rate 2 more.")

    assert chartmodel.readiness(usable=30, rated=30, off_detection=0, reading=[], needed=30)["ready"]

    # A route still being read cannot be counted, so it is not ready yet.
    reading = chartmodel.readiness(usable=30, rated=40, off_detection=0, reading=["C81->KDLH"], needed=30)
    assert not reading["ready"]
    assert reading["message"].endswith("Reading the chart along C81->KDLH to count the rest.")


def test_the_holdout_is_the_same_ratings_from_one_run_to_the_next_and_never_empty():
    rows = pd.DataFrame({"route": ["C81->KDLH"] * 40, "lat": [42 + i / 100 for i in range(40)], "lon": [-88.0] * 40})
    held = chartmodel.holdout_split(rows)
    assert held.equals(chartmodel.holdout_split(rows.iloc[::-1]).sort_index())
    assert 0 < held.sum() < len(rows)
    assert chartmodel.holdout_split(rows.iloc[:1]).sum() == 1


def test_retrain_scores_the_model_against_the_palettes_constants_on_the_same_held_out_ratings(tmp_path):
    pytest.importorskip("sklearn")
    from vfr.pipeline import InsufficientLabelsError

    # A power line read as a road is a 0, a real crossing a 4: the
    # palette gives both 3.6, and the model can tell them by their ink.
    rows = pd.DataFrame([
        {"route": "C81->KDLH", "lat": 42 + i / 50, "lon": -88.0, "category": "road_or_rail",
         **{c: 0.0 for c in FEATURE_COLS}, "linework_px": 200.0 if i % 2 else 20.0, "is_road_or_rail": 1.0,
         "palette_score": 3.6, "rating": 0 if i % 2 else 4}
        for i in range(40)
    ])
    table = tmp_path / "chart_training.parquet"
    rows.to_parquet(table)

    metrics = chartmodel.retrain(table, tmp_path / "candidate", min_rated=30)

    assert metrics["palette_held_out_mae"] > 1.0
    assert metrics["held_out_mae"] < metrics["palette_held_out_mae"]
    assert metrics["feature_cols"] == FEATURE_COLS
    assert metrics["rating_range"] == [0.0, 5.0]
    assert json.loads((tmp_path / "candidate" / "metrics.json").read_text())["n_labeled"] == 40
    with pytest.raises(InsufficientLabelsError, match="Rate 1 more"):
        chartmodel.retrain(table, tmp_path / "candidate", min_rated=41)
