"""Model-serving microservice: the chart model's scores for the chart
reader's detections, which the planner sends it (vfr.model_client).

The planner never loads a model itself. This owns the promoted chart
model (vfr.chartmodel, promoted to data/models/chart/current, which
docker-compose mounts at CHART_MODEL_DIR) and the scikit-learn it was
pickled with, and reads it again whenever a promotion rewrites it.
"""
import json
import os
from pathlib import Path

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException

from .schemas import DetectionRows, DetectionScores

CHART_MODEL_DIR = Path(os.environ.get("CHART_MODEL_DIR", "/opt/ml/chart-model"))

app = FastAPI(title="Wingtip Maps model service")

# What is read from disk, by one rule: kept while its files are
# unchanged, read again the moment any of them changes. key -> (the
# files' signature, what was read from them).
_cache: dict = {}


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

    A missing file is a 503, not a container that crashloops before it
    can say why, and a model that appears later is served from the next
    request. A promotion (vfr.model_registry.promote) rewrites the files
    in place under a running service: a stat each per request is what
    makes the next answer come from the new ones. The signature is taken
    before the read, so a read that races a write is read again next
    time.
    """
    signature = _signature(files)
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
    files = _chart_files()
    return _fresh(("model", "chart"), files, lambda: {
        "model": joblib.load(files[0]), "metrics": json.loads(files[1].read_text()),
    })


@app.get("/ping")
def ping() -> dict:
    """The health check: whether a chart model is promoted, and when it
    was trained. Its metrics alone are read, not the model: a model that
    would not load is a failed scoring call, not an unhealthy service the
    planner waits on."""
    promoted = _signature(_chart_files()) is not None
    trained_at = None
    if promoted:
        try:
            trained_at = json.loads(_chart_files()[1].read_text()).get("trained_at")
        except (OSError, ValueError):
            pass
    return {"status": "ok", "chart_model": promoted, "trained_at": trained_at}


@app.post("/score-detections", response_model=DetectionScores)
def score_detections(request: DetectionRows) -> DetectionScores:
    """The chart model's score for each of the chart reader's detections
    the planner sends, 503 while none is promoted. The rows are reindexed
    to the columns the model was fitted on; a feature the planner did not
    send, for any row, is 0. Each score is held to the scale the model
    was trained on (metrics.json's rating_range): a linear model
    extrapolates past it."""
    state = _chart_model()
    if state is None:
        raise HTTPException(503, "No chart model promoted yet: retrain from the developer console's Performance tab.")
    metrics = state["metrics"]
    scores = []
    if request.rows:
        X = pd.DataFrame(request.rows).reindex(columns=metrics["feature_cols"]).fillna(0.0)
        low, high = metrics.get("rating_range", (float("-inf"), float("inf")))
        scores = [round(min(max(float(s), low), high), 4) for s in state["model"].predict(X)]
    return DetectionScores(
        scores=scores, model_type=metrics.get("model_type"), trained_at=metrics.get("trained_at"),
        held_out_mae=metrics.get("held_out_mae"), palette_held_out_mae=metrics.get("palette_held_out_mae"),
    )
