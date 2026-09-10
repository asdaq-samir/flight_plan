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
brand-new route means Overpass and FAA downloads and an elevation
lookup per candidate -- minutes of network I/O, which is a batch job, not
an inference call. So this serves the precomputed feature store
(engineer_features' parquet) and rejects a request for any other route
rather than pretending to. That is also how it would work on AWS: a
Processing Job builds features, an endpoint scores them.
"""
import json
import os
from pathlib import Path

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException

from .schemas import Checkpoint, RouteRequest, RouteResponse

MODEL_DIR = Path(os.environ.get("MODEL_DIR", "/opt/ml/model"))
FEATURES_PATH = Path(
    os.environ.get("FEATURES_PATH", "/opt/ml/features/features_c81_kdlh.parquet")
)
# The feature store covers exactly one corridor. Kept as configuration
# rather than parsed out of the parquet filename so that pointing this at
# a different route's features is an env change, not a code change.
SERVED_DEPARTURE = os.environ.get("SERVED_DEPARTURE", "C81").upper()
SERVED_DESTINATION = os.environ.get("SERVED_DESTINATION", "KDLH").upper()

app = FastAPI(title="vfr-route model-service")

_state: dict = {}


def _load() -> dict:
    """Load the model, its metrics and the feature store once, on first
    use rather than at import time -- a missing artifact should surface as
    an unhealthy /ping and a 503, not a container that crashloops before
    it can report why.
    """
    if _state:
        return _state
    model_path = MODEL_DIR / "model.joblib"
    metrics_path = MODEL_DIR / "metrics.json"
    if not model_path.exists() or not metrics_path.exists() or not FEATURES_PATH.exists():
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
        features=pd.read_parquet(FEATURES_PATH),
    )
    return _state


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
        "route": f"{SERVED_DEPARTURE}->{SERVED_DESTINATION}",
    }


@app.post("/invocations", response_model=RouteResponse)
def invocations(request: RouteRequest) -> RouteResponse:
    state = _load()
    if not state:
        raise HTTPException(
            status_code=503,
            detail=(
                f"No model artifact at {MODEL_DIR} or no feature store at "
                f"{FEATURES_PATH}. Run the pipeline (collect -> engineer-features -> "
                "retrain -> promote) before serving."
            ),
        )

    dep = request.departure_ident.strip().upper()
    dest = request.destination_ident.strip().upper()
    if (dep, dest) != (SERVED_DEPARTURE, SERVED_DESTINATION):
        raise HTTPException(
            status_code=400,
            detail=(
                f"This endpoint serves the precomputed {SERVED_DEPARTURE}->"
                f"{SERVED_DESTINATION} feature store; {dep}->{dest} was requested. "
                "Scoring a new route means re-running collection, which is a batch "
                "job rather than an inference call."
            ),
        )

    df = state["features"]
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
