"""Model-serving microservice, called by the Spring Boot app over REST.

Structured toward /ping + /invocations -- the health-check and inference
route names a SageMaker inference container expects -- so the eventual
AWS migration (see docs/README-AWS.md) doesn't need a rename, even
though nothing here actually talks to SageMaker yet. That shape extends
to where things are read from: the promoted model is loaded from
MODEL_DIR, defaulting to /opt/ml/model, which is the path SageMaker
mounts a model artifact at. Locally, docker-compose bind-mounts
data/models/current there, so the same code path serves in both places.

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

Several models serve every corridor now, not one -- the promoted
sklearn model plus whichever of PyTorch/TensorFlow/Spark's own
candidates (vfr.model_candidates, trained one-off inside the `ml`
image; see that module's docstring) have actually been trained,
selected per request via RouteRequest.model. Every one of them is
still route-agnostic by construction (route position was deliberately
removed from the features), so the only thing that varies per route,
for any of them, is which parquet to score. Spark is the one
exception worth calling out: it is never loaded here at all (a JVM +
Spark session's cold-start time has no place in a container everything
else answers in milliseconds) -- its own trainer instead persists
predictions for every candidate it saw, and this just looks them up.
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
CANDIDATES_DIR = Path(os.environ.get("CANDIDATES_DIR", "/opt/ml/candidates"))

# One model, many corridors. This used to serve a single route fixed by
# env var, which meant a second route needed a second container on
# another port -- fine for a one-off check, useless behind a UI where
# someone types an ident. Every model here is route-agnostic (route
# position was deliberately removed from its features), so the only thing
# that varies per route is which feature store to score.
FEATURES_PATTERN = "features_{dep}_{dest}.parquet"

app = FastAPI(title="vfr-route model-service")

# name -> that model's loaded state, populated lazily by _LOADERS below.
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


def _load_current() -> dict:
    """The promoted sklearn model -- unchanged behavior from before
    multiple models existed, just keyed into _state under "current"
    instead of being the only thing this service could ever load.
    """
    model_path = MODEL_DIR / "model.joblib"
    metrics_path = MODEL_DIR / "metrics.json"
    if not model_path.exists() or not metrics_path.exists():
        return {}
    metrics = json.loads(metrics_path.read_text())
    return {
        "kind": "sklearn",
        "model": joblib.load(model_path),
        "metrics": metrics,
        # metrics.json is the authority on column order and membership.
        # Reading it back rather than hardcoding a list is what keeps this
        # service correct across a retrain that adds or drops a category
        # one-hot -- which has happened repeatedly (towers, water towers,
        # quarries) and silently breaks anything holding its own copy.
        "feature_cols": metrics["feature_cols"],
    }


def _load_pytorch() -> dict:
    d = CANDIDATES_DIR / "pytorch"
    model_path, scaler_path, metrics_path = d / "model_state.pt", d / "scaler.joblib", d / "metrics.json"
    if not (model_path.exists() and scaler_path.exists() and metrics_path.exists()):
        return {}
    import torch

    from .torch_model import SpottabilityMLP

    metrics = json.loads(metrics_path.read_text())
    feature_cols = metrics["feature_cols"]
    model = SpottabilityMLP(n_features=len(feature_cols))
    model.load_state_dict(torch.load(model_path, map_location="cpu"))
    model.eval()  # disables dropout -- this is inference, not training
    return {
        "kind": "pytorch", "model": model, "scaler": joblib.load(scaler_path),
        "metrics": metrics, "feature_cols": feature_cols,
    }


def _load_tensorflow() -> dict:
    d = CANDIDATES_DIR / "tensorflow"
    model_path, scaler_path, metrics_path = d / "model.keras", d / "scaler.joblib", d / "metrics.json"
    if not (model_path.exists() and scaler_path.exists() and metrics_path.exists()):
        return {}
    import tensorflow as tf

    metrics = json.loads(metrics_path.read_text())
    return {
        "kind": "tensorflow", "model": tf.keras.models.load_model(model_path), "scaler": joblib.load(scaler_path),
        "metrics": metrics, "feature_cols": metrics["feature_cols"],
    }


def _load_spark() -> dict:
    """Not a Spark session -- see the module docstring on why. Just the
    predictions its trainer already computed, keyed by osm_id."""
    d = CANDIDATES_DIR / "spark"
    predictions_path, metrics_path = d / "predictions.json", d / "metrics.json"
    if not (predictions_path.exists() and metrics_path.exists()):
        return {}
    return {
        "kind": "spark",
        "predictions": json.loads(predictions_path.read_text()),
        "metrics": json.loads(metrics_path.read_text()),
    }


_LOADERS = {"current": _load_current, "pytorch": _load_pytorch, "tensorflow": _load_tensorflow, "spark": _load_spark}

# The files each model is read from, for noticing a change on disk.
_ARTIFACTS = {
    "current": lambda: [MODEL_DIR / "model.joblib", MODEL_DIR / "metrics.json"],
    "pytorch": lambda: [CANDIDATES_DIR / "pytorch" / "model_state.pt", CANDIDATES_DIR / "pytorch" / "metrics.json"],
    "tensorflow": lambda: [CANDIDATES_DIR / "tensorflow" / "model.keras", CANDIDATES_DIR / "tensorflow" / "metrics.json"],
    "spark": lambda: [CANDIDATES_DIR / "spark" / "predictions.json", CANDIDATES_DIR / "spark" / "metrics.json"],
}


def _signature(name: str) -> tuple:
    """When each of a model's files was last written -- what changes
    when a retrain promotes a new one into the same path."""
    return tuple(p.stat().st_mtime_ns if p.exists() else None for p in _ARTIFACTS[name]())


def _load(name: str = "current") -> dict:
    """Load one named model's state on first *successful* use, and
    again whenever its files change on disk -- same reasoning as the
    single-model version this replaced: a missing artifact should
    surface as an unhealthy /ping (or a 503 for that one model), not a
    container that crashloops before it can report why, and one not
    yet trained when first asked for should start being served the
    moment it exists rather than staying cached as absent for the life
    of the container. A promotion (vfr.model_registry.promote, from
    the pipeline or the Dev console's retrain) writes new files into
    data/models/current; their timestamps are checked on every request,
    a stat each, so the new model is what scores the next route rather
    than the one this process happened to start with.
    """
    if name not in _LOADERS:
        return {}
    signature = _signature(name)
    loaded = _state.get(name)
    if not loaded or loaded.get("_signature") != signature:
        loaded = _LOADERS[name]()
        if loaded:
            loaded["_signature"] = signature
        _state[name] = loaded
    return _state[name]


def _features(dep: str, dest: str):
    """The feature store for one corridor, cached after first read."""
    key = (dep.lower(), dest.lower())
    if key not in _features_cache:
        _features_cache[key] = pd.read_parquet(_features_path(dep, dest))
    return _features_cache[key]


@app.get("/ping")
def ping() -> dict:
    """SageMaker's health check. Reports whether the promoted model
    loaded (the top-level fields, unchanged shape from before this
    service could serve more than one model, since that is the one
    SageMaker's own health check actually cares about), plus which of
    the others are currently available.
    """
    current = _load("current")
    return {
        "status": "ok" if current else "no model loaded",
        "model_loaded": bool(current),
        "model_dir": str(MODEL_DIR),
        "trained_at": current.get("metrics", {}).get("trained_at"),
        "routes": available_routes(),
        "models": {name: bool(_load(name)) for name in _LOADERS},
    }


@app.get("/routes")
def routes() -> dict:
    """Which corridors have a feature store built, so a caller can offer
    them rather than guessing and getting a 404."""
    return {"routes": available_routes(), "features_dir": str(FEATURES_DIR)}


def _score(state: dict, df: pd.DataFrame) -> pd.Series:
    """Every model's own inference call, dispatched on `state["kind"]`
    -- the one place that actually differs between a joblib-pickled
    sklearn estimator, a PyTorch module, a Keras model and a lookup
    into Spark's precomputed predictions. Returns a Series aligned to
    `df`'s own index; a Spark score not found for some osm_id comes
    back as NaN, not faked as zero -- the same "no answer" reasoning
    the nav log already uses for an unflyable leg's fuel.
    """
    kind = state["kind"]
    if kind == "spark":
        return df["osm_id"].astype(str).map(state["predictions"])

    # Reindex to exactly the columns the model was fitted on: a category
    # present in the parquet but not in training would shift the column
    # order, and one the model expects but the data lacks would raise. A
    # category no candidate on this route has is legitimately all-zero.
    X = df.reindex(columns=state["feature_cols"], fill_value=0)
    X = X.fillna({"name_uniqueness": 0.0})

    if kind == "sklearn":
        return pd.Series(state["model"].predict(X), index=df.index)
    if kind == "pytorch":
        import torch

        X_scaled = state["scaler"].transform(X)
        with torch.no_grad():
            preds = state["model"](torch.tensor(X_scaled, dtype=torch.float32)).squeeze(1).numpy()
        return pd.Series(preds, index=df.index)
    if kind == "tensorflow":
        X_scaled = state["scaler"].transform(X)
        preds = state["model"].predict(X_scaled, verbose=0).squeeze(-1)
        return pd.Series(preds, index=df.index)
    raise HTTPException(500, f"unknown model kind {kind!r}")


@app.post("/invocations", response_model=RouteResponse)
def invocations(request: RouteRequest) -> RouteResponse:
    model_name = (request.model or "current").lower()
    state = _load(model_name)
    if not state:
        raise HTTPException(
            status_code=503,
            detail=(
                f"No '{model_name}' model artifact available. "
                + (
                    "Run the pipeline (collect -> engineer-features -> retrain -> promote) before serving."
                    if model_name == "current"
                    else f"Train it first: docker compose run --rm ml python -m vfr.model_candidates {model_name}"
                )
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
    scores = _score(state, df)

    scored = df.assign(predicted_score=scores).sort_values("along_track_nm")
    # Spark only ever scored the candidates it saw at training time
    # (the 206 labeled ones) -- a route with candidates outside that
    # set legitimately has no Spark score for them, dropped here
    # rather than shown as a fabricated 0.
    scored = scored.dropna(subset=["predicted_score"])
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
        model_type=state["metrics"].get("model_type", model_name),
    )
