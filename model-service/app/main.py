"""Model-serving microservice, called by the Spring Boot app over REST.

Structured toward /ping + /invocations -- the health-check and inference
route names a SageMaker inference container expects -- so the eventual
AWS migration (deferred, see project memory) doesn't need a rename, even
though nothing here actually talks to SageMaker yet. That shape extends
to where things are read from: the model is loaded from MODEL_DIR,
defaulting to /opt/ml/model, which is the path SageMaker mounts a model
artifact at. Locally, docker-compose bind-mounts data/models/current
there, so the same code path serves in both places.

/invocations returned a hand-written stub until 2026-09-10, on the
grounds that no trained model existed yet. One now does: all 206
candidates are hand-labeled and a RandomForest is promoted to
data/models/current. This module does real inference against it.

What it does NOT do is run the collection pipeline per request. Scoring a
brand-new route means Overpass and FAA downloads and an elevation lookup
per candidate -- minutes of network I/O, which is a batch job, not an
inference call. So this serves whichever precomputed feature stores
(engineer_features' parquets) are present in FEATURES_DIR, and answers
404 with the exact build commands for anything else rather than
pretending. That is also how it would work on AWS: a Processing Job
builds features, an endpoint scores them.

One model serves every corridor. The model is route-agnostic by
construction -- route position was deliberately removed from its features
-- so the only thing that varies per route is which parquet to score.
"""
import json
import os
from pathlib import Path

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException

from .schemas import Checkpoint, RouteRequest, RouteResponse

MODEL_DIR = Path(os.environ.get("MODEL_DIR", "/opt/ml/model"))
FEATURES_DIR = Path(os.environ.get("FEATURES_DIR", "/opt/ml/features"))

# One model, many corridors. This used to serve a single route fixed by
# env var, which meant a second route needed a second container on
# another port -- fine for a one-off check, useless behind a UI where
# someone types an ident. The model itself is route-agnostic (route
# position was deliberately removed from its features), so the only thing
# that varies per route is which feature store to score.
FEATURES_PATTERN = "features_{dep}_{dest}.parquet"

app = FastAPI(title="vfr-route model-service")

_state: dict = {}
_features_cache: dict = {}


def _features_path(dep: str, dest: str) -> Path:
    return FEATURES_DIR / FEATURES_PATTERN.format(dep=dep.lower(), dest=dest.lower())


def available_routes() -> list:
    """Route pairs this instance can serve, from the feature stores
    actually present on disk."""
    routes = []
    for path in sorted(FEATURES_DIR.glob("features_*.parquet")):
        parts = path.stem.split("_")
        if len(parts) == 3:
            routes.append({"departure_ident": parts[1].upper(), "destination_ident": parts[2].upper()})
    return routes


def _load() -> dict:
    """Load the model and its metrics once, on first use rather than at
    import time -- a missing artifact should surface as an unhealthy
    /ping and a 503, not a container that crashloops before it can report
    why.
    """
    if _state:
        return _state
    model_path = MODEL_DIR / "model.joblib"
    metrics_path = MODEL_DIR / "metrics.json"
    if not model_path.exists() or not metrics_path.exists():
        return {}
    metrics = json.loads(metrics_path.read_text())
    _state.update(
        model=joblib.load(model_path),
        metrics=metrics,
        # metrics.json is the authority on column order and membership.
        # Reading it back rather than hardcoding a list is what keeps this
        # service correct across a retrain that adds or drops a category
        # one-hot -- which has happened repeatedly (towers, water towers,
        # quarries) and silently breaks anything holding its own copy.
        feature_cols=metrics["feature_cols"],
    )
    return _state


def _features(dep: str, dest: str):
    """The feature store for one corridor, cached after first read."""
    key = (dep.lower(), dest.lower())
    if key not in _features_cache:
        _features_cache[key] = pd.read_parquet(_features_path(dep, dest))
    return _features_cache[key]


@app.get("/ping")
def ping() -> dict:
    """SageMaker's health check. Reports whether the artifacts actually
    loaded, so an endpoint serving nothing is visible rather than quietly
    returning 200.
    """
    state = _load()
    return {
        "status": "ok" if state else "no model loaded",
        "model_loaded": bool(state),
        "model_dir": str(MODEL_DIR),
        "trained_at": state.get("metrics", {}).get("trained_at"),
        "routes": available_routes(),
    }


@app.get("/routes")
def routes() -> dict:
    """Which corridors have a feature store built, so a caller can offer
    them rather than guessing and getting a 404."""
    return {"routes": available_routes(), "features_dir": str(FEATURES_DIR)}


@app.post("/invocations", response_model=RouteResponse)
def invocations(request: RouteRequest) -> RouteResponse:
    state = _load()
    if not state:
        raise HTTPException(
            status_code=503,
            detail=(
                f"No model artifact at {MODEL_DIR}. Run the pipeline "
                "(collect -> engineer-features -> retrain -> promote) before serving."
            ),
        )

    dep = request.departure_ident.strip().upper()
    dest = request.destination_ident.strip().upper()
    path = _features_path(dep, dest)
    if not path.exists():
        # 404 rather than "just build it": collecting a corridor is
        # Overpass queries, FAA downloads and a per-candidate elevation
        # lookup -- minutes of network I/O. That is a batch job, so this
        # says exactly how to run it instead of blocking an inference
        # request on it.
        raise HTTPException(
            status_code=404,
            detail=(
                f"No feature store for {dep}->{dest}. Build it first:\n"
                f"  docker compose run --rm pipeline-processing collect "
                f"--dep-ident {dep} --dest-ident {dest} "
                f"--out-path /workspace/data/processed/candidates_{dep.lower()}_{dest.lower()}.csv\n"
                f"  docker compose run --rm pipeline-processing engineer-features "
                f"--in-path /workspace/data/processed/candidates_{dep.lower()}_{dest.lower()}.csv "
                f"--out-path /workspace/data/processed/{path.name}"
            ),
        )

    df = _features(dep, dest)
    # Reindex to exactly the columns the model was fitted on: a category
    # present in the parquet but not in training would shift the column
    # order, and one the model expects but the data lacks would raise. A
    # category no candidate on this route has is legitimately all-zero.
    X = df.reindex(columns=state["feature_cols"], fill_value=0)
    X = X.fillna({"name_uniqueness": 0.0})
    scores = state["model"].predict(X)

    scored = df.assign(predicted_score=scores).sort_values("along_track_nm")
    checkpoints = [
        Checkpoint(
            osm_id=str(row.osm_id),
            category=row.category,
            name=row.name if isinstance(row.name, str) and row.name else "(unnamed)",
            lat=float(row.lat),
            lon=float(row.lon),
            along_track_nm=float(row.along_track_nm),
            predicted_score=round(float(row.predicted_score), 4),
        )
        for row in scored.itertuples(index=False)
    ]
    return RouteResponse(
        departure_ident=request.departure_ident,
        destination_ident=request.destination_ident,
        checkpoints=checkpoints,
        stub=False,
    )
