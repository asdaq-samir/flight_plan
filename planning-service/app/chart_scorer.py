"""The chart model's scores for the chart reader's detections, in this
process: the promoted model (wingtip.chartmodel, promoted by
wingtip.model_registry into data/models/chart/current) loaded with the
scikit-learn it was pickled with, and read again whenever a promotion
rewrites it.

It was a container of its own, model-service, for this one call. It
moved here (2026-11-06) because the planner was its only caller and
already had the model's directory mounted: one fewer image to build,
push and keep healthy, and no HTTP hop on every plan. scikit-learn and
joblib are imported on first use, so a planner that never scores pays
nothing for them at start.

`score_detections` is the seam: app.chart_model calls it, and a test
replaces it."""
import json
import threading
from pathlib import Path

from wingtip import model_registry

# Where the promoted chart model is. A module attribute, not read once
# into the functions, so a test points it at a temporary directory.
CHART_MODEL_DIR: Path = model_registry.CHART_CURRENT_DIR

# What is read from disk, by one rule: kept while its files are
# unchanged, read again the moment any of them changes. key -> (the
# files' signature, what was read from them). A lock, as the planner
# serves on many threads and an unpickle is not cheap to do twice.
_cache: dict = {}
_cache_lock = threading.Lock()


def _signature(files: list) -> tuple | None:
    """When and how big each file was last written, or None while any
    of them is missing. The size as well as the time, so a rewrite in
    the same clock tick still counts."""
    stats = []
    for path in files:
        try:
            st = path.stat()
        except FileNotFoundError:
            return None
        stats.append((st.st_mtime_ns, st.st_size))
    return tuple(stats)


def _fresh(key, files: list, load):
    """What `load()` reads from `files`, read on first use and again
    whenever any of them changes on disk; None while any is missing.

    A promotion (wingtip.model_registry.promote) renames new files over
    these under a running planner: a stat each per call is what makes
    the next score come from the new ones, with no restart. The
    signature is taken before the read, so a read that races a write is
    read again next time."""
    signature = _signature(files)
    with _cache_lock:
        if signature is None:
            _cache.pop(key, None)
            return None
        held = _cache.get(key)
        if held is None or held[0] != signature:
            held = (signature, load())
            _cache[key] = held
        return held[1]


def _chart_files() -> list:
    return [CHART_MODEL_DIR / "model.joblib", CHART_MODEL_DIR / "metrics.json"]


def _chart_model() -> dict | None:
    """The promoted chart model, or None while there is none."""
    import joblib

    files = _chart_files()
    return _fresh(("model", "chart"), files, lambda: {
        "model": joblib.load(files[0]), "metrics": json.loads(files[1].read_text()),
    })


def score_detections(rows: list[dict]) -> list | None:
    """The chart model's score for each of the chart reader's detections,
    from their feature rows (wingtip.chartfeatures), in order; None where
    no chart model is promoted, or it will not load or score. Never an
    error: the planner ranks by the palette's constants then, as it did
    before there was a model.

    The rows are reindexed to the columns the model was fitted on, so a
    retrain that adds or drops a feature changes what is scored with no
    change here, and a feature not sent reads as 0. Each score is held to
    the scale the model was trained on (metrics.json's rating_range): a
    linear model extrapolates past it."""
    try:
        state = _chart_model()
        if state is None:
            return None
        if not rows:
            return []
        import pandas as pd

        metrics = state["metrics"]
        X = pd.DataFrame(rows).reindex(columns=metrics["feature_cols"]).fillna(0.0)
        low, high = metrics.get("rating_range", (float("-inf"), float("inf")))
        return [round(min(max(float(s), low), high), 4) for s in state["model"].predict(X)]
    except Exception:  # noqa: BLE001 -- a broken model file is no scores, not a failed plan
        return None
