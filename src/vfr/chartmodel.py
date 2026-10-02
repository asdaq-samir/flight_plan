"""The chart reader's scorer: how a pilot rates what the reader finds.

vfr.chartvision finds what the sectional draws and gives each kind of
thing one constant (PaletteClass.base_score): every river crossing 4.3,
every road or rail crossing 3.6, whatever it is. The training page's
ratings say otherwise -- a power line read as a road is a 0, and so was
a graticule tick -- and this learns from them: a rating from 0 to 5 for
every detection, from the features vfr.chartfeatures gives it, a 0
meaning "no feature at all".

The first of two stages. Now the model scores the reader's points on
the training page, beside the palette's constants. The planner's
checkpoints stay on the OpenStreetMap landmark model until this one
beats the constants on ratings it did not learn from -- metrics.json's
`held_out_mae` against `palette_held_out_mae` -- and only then move to
the chart.

Who does what: the planner writes the table (`labeled_rows` over its
corridor reads), as it holds the chart reader and the pipeline images
do not (no GDAL there); `retrain` runs in the training image; and
vfr.model_registry evaluates and promotes into data/models/chart/
current, which model-service serves and the planner asks for scores.
"""
from __future__ import annotations

import json
import zlib
from pathlib import Path

import pandas as pd

from . import chartfeatures
from .chartlabels_join import label_detections
from .config import DATA_DIR, MIN_LABELED_ROWS
from .model_registry import CHART_CANDIDATE_DIR, CHART_CURRENT_DIR
from .routecsv import SAME_PLACE_NM

# Every route's rated detections, as the planner last wrote them.
TRAINING_TABLE_PATH = DATA_DIR / "processed" / "chart_training.parquet"
FEATURE_COLS = chartfeatures.FEATURE_COLS

# The scale a score is held to, scored and served alike (metrics.json
# says it, and model-service clips to it): a linear model extrapolates,
# and gave the largest lake in a corridor 15.
RATING_RANGE = (0.0, 5.0)


def _clipped(predictions):
    import numpy as np

    return np.clip(predictions, *RATING_RANGE)


def _palette_score(detection) -> float:
    return float(detection["score"] if isinstance(detection, dict) else detection.score)


def labeled_rows(route: str, detections: list, picks: list) -> pd.DataFrame:
    """The route's rated picks on the detections they were made on, a row
    each: the detection's features (worked out over the whole corridor,
    as they count its neighbours), the palette's constant for it, and the
    rating, 0 to 5. A pick claims the nearest detection within
    SAME_PLACE_NM, as the training page matches them. One no detection is
    that close to is left out: the reader no longer finds it (a
    graticule tick, before it learnt to pass over them), or it was
    added by hand, where the model will never be asked."""
    rated = [p for p in picks if p.get("rating") is not None]
    claimed = label_detections(detections, rated, tolerance_nm=SAME_PLACE_NM)
    if not claimed:
        return pd.DataFrame(columns=["route", "lat", "lon", "category", *FEATURE_COLS, "palette_score", "rating"])
    rows = chartfeatures.build(detections).iloc[[index for index, _ in claimed]].copy()
    rows["palette_score"] = [_palette_score(detections[index]) for index, _ in claimed]
    rows["rating"] = [int(rating) for _, rating in claimed]
    rows.insert(0, "route", route)
    return rows.reset_index(drop=True)


def readiness(usable: int, rated: int, off_detection: int, reading: list,
              needed: int = MIN_LABELED_ROWS) -> dict:
    """Whether the ratings are enough to train on, and in a sentence what
    to do if not: `usable` of them on a detection, of the `rated`, with
    `off_detection` on none, and the routes whose chart is still being
    read (`reading`), which cannot be counted yet."""
    ready = usable >= needed and not reading
    message = f"{usable} of the {needed} ratings training needs."
    if off_detection:
        message += f" {off_detection} of your {rated} are on points the chart reader no longer finds."
    if reading:
        message += f" Reading the chart along {', '.join(reading)} to count the rest."
    elif not ready:
        message += f" Rate {needed - usable} more."
    return {
        "usable": usable, "needed": needed, "ready": ready, "rated": rated,
        "off_detection": off_detection, "reading": list(reading), "message": message,
    }


def holdout_split(rows: pd.DataFrame) -> pd.Series:
    """True for the rows held out, about a fifth: fixed by each
    detection's route and place rather than drawn at random, so a new
    model and the promoted one are scored on the same ratings while more
    are added between runs. At least one, so there is a score to give."""
    keys = rows.apply(lambda r: zlib.crc32(f"{r['route']}/{r['lat']:.4f}/{r['lon']:.4f}".encode()), axis=1)
    held = keys % 5 == 0
    return held if held.any() else keys == keys.min()


def _score_current(X_test, y_test) -> float | None:
    """The promoted chart model's MAE on this run's holdout, or None when
    none is promoted, or it was trained on other features."""
    import joblib
    from sklearn.metrics import mean_absolute_error

    model_path, metrics_path = CHART_CURRENT_DIR / "model.joblib", CHART_CURRENT_DIR / "metrics.json"
    if not model_path.exists() or not metrics_path.exists():
        return None
    if json.loads(metrics_path.read_text()).get("feature_cols") != FEATURE_COLS:
        return None
    try:
        return float(mean_absolute_error(y_test, _clipped(joblib.load(model_path).predict(X_test))))
    except Exception:  # noqa: BLE001 -- an unreadable current model is "none to compare with"
        return None


def retrain(table_path: Path = TRAINING_TABLE_PATH, out_dir: Path = CHART_CANDIDATE_DIR,
            min_rated: int = MIN_LABELED_ROWS) -> dict:
    """The model, chosen as the landmark model is (pipeline.select_model),
    scored on the held-out ratings against the palette's constants and a
    predict-the-mean baseline on the same ones, and written as the
    candidate. Raises InsufficientLabelsError below `min_rated`."""
    import joblib
    from sklearn.metrics import mean_absolute_error

    from .pipeline import InsufficientLabelsError, _ensure_local_dir, _publish, held_out_scores, metrics_record, select_model

    rows = pd.read_parquet(table_path) if Path(table_path).exists() else pd.DataFrame()
    if len(rows) < min_rated:
        raise InsufficientLabelsError(
            f"{len(rows)} of the {min_rated} ratings training the chart model needs. Rate {min_rated - len(rows)} more."
        )
    held = holdout_split(rows)
    train, test = rows[~held], rows[held]
    X_train, y_train = train[FEATURE_COLS], train["rating"].astype(float)
    X_test, y_test = test[FEATURE_COLS], test["rating"].astype(float)
    best_name, best_model, cv_mae, dummy_mae = select_model(X_train, y_train)

    # The two it has to beat, on the very same held-out ratings: the
    # palette's constant for each detection's kind, which is what the
    # training page shows today, and the training ratings' mean.
    metrics = metrics_record(
        best_name, held_out_scores(y_test, _clipped(best_model.predict(X_test))),
        palette_held_out_mae=float(mean_absolute_error(y_test, test["palette_score"])),
        dummy_held_out_mae=float(mean_absolute_error(y_test, [y_train.mean()] * len(y_test))),
        current_held_out_mae=_score_current(X_test, y_test),
        cv_mae=cv_mae[best_name],
        cv_mae_by_model={**cv_mae, "Dummy": dummy_mae},
        dummy_cv_mae=dummy_mae,
        n_labeled=len(rows), n_train=len(train), n_test=len(test),
        feature_cols=FEATURE_COLS,
        rating_range=list(RATING_RANGE),
        routes=sorted(rows["route"].unique()),
    )
    out_dir = _ensure_local_dir(out_dir)
    _publish(out_dir / "model.joblib", lambda tmp: joblib.dump(best_model, tmp))
    _publish(out_dir / "metrics.json", lambda tmp: Path(tmp).write_text(json.dumps(metrics, indent=2)))
    return metrics
