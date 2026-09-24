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

# Everything read from disk -- each model and each corridor's feature
# store -- by one rule: kept while its files are unchanged, read again
# the moment any of them changes. key -> (the files' signature, what was
# read from them).
_cache: dict = {}


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

    A missing file is an unhealthy /ping or a 503 (or a 404 for a
    corridor), not a container that crashloops before it can say why,
    and a model or corridor that appears later is served from the next
    request. A promotion (vfr.model_registry.promote) and a feature
    rebuild (the pipeline, or the planner's build) both rewrite files in
    place under a running service: a stat each per request is what makes
    the next answer come from the new ones. The feature stores used to be
    read once for the life of the process, so a rebuilt corridor was
    scored from the old table -- and a category new to it was silently
    zeroed by the reindex in _score. The signature is taken before the
    read, so a read that races a write is read again next time.
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


def _load_current() -> dict:
    """The promoted sklearn model."""
    metrics = json.loads((MODEL_DIR / "metrics.json").read_text())
    return {
        "kind": "sklearn",
        "model": joblib.load(MODEL_DIR / "model.joblib"),
        "metrics": metrics,
        # metrics.json is the authority on column order and membership.
        # Reading it back rather than hardcoding a list is what keeps this
        # service correct across a retrain that adds or drops a category
        # one-hot -- which has happened repeatedly (towers, water towers,
        # quarries) and silently breaks anything holding its own copy.
        "feature_cols": metrics["feature_cols"],
    }


def _load_pytorch() -> dict:
    import torch

    from .torch_model import SpottabilityMLP

    d = CANDIDATES_DIR / "pytorch"
    metrics = json.loads((d / "metrics.json").read_text())
    feature_cols = metrics["feature_cols"]
    model = SpottabilityMLP(n_features=len(feature_cols))
    model.load_state_dict(torch.load(d / "model_state.pt", map_location="cpu"))
    model.eval()  # disables dropout -- this is inference, not training
    return {
        "kind": "pytorch", "model": model, "scaler": joblib.load(d / "scaler.joblib"),
        "metrics": metrics, "feature_cols": feature_cols,
    }


def _load_tensorflow() -> dict:
    import tensorflow as tf

    d = CANDIDATES_DIR / "tensorflow"
    metrics = json.loads((d / "metrics.json").read_text())
    return {
        "kind": "tensorflow", "model": tf.keras.models.load_model(d / "model.keras"),
        "scaler": joblib.load(d / "scaler.joblib"), "metrics": metrics, "feature_cols": metrics["feature_cols"],
    }


def _load_spark() -> dict:
    """Not a Spark session -- see the module docstring on why. Just the
    predictions its trainer already computed, keyed by osm_id."""
    d = CANDIDATES_DIR / "spark"
    return {
        "kind": "spark",
        "predictions": json.loads((d / "predictions.json").read_text()),
        "metrics": json.loads((d / "metrics.json").read_text()),
    }


# Each model once: the files it is read from, and how. The scaler is one
# of those files -- it used to be missing from the list that noticed a
# change, so a retrained scaler was not picked up.
_MODELS = {
    "current": (lambda: [MODEL_DIR / "model.joblib", MODEL_DIR / "metrics.json"], _load_current),
    "pytorch": (lambda: [CANDIDATES_DIR / "pytorch" / f for f in ("model_state.pt", "scaler.joblib", "metrics.json")],
                _load_pytorch),
    "tensorflow": (lambda: [CANDIDATES_DIR / "tensorflow" / f for f in ("model.keras", "scaler.joblib", "metrics.json")],
                   _load_tensorflow),
    "spark": (lambda: [CANDIDATES_DIR / "spark" / f for f in ("predictions.json", "metrics.json")], _load_spark),
}


def _load(name: str = "current") -> dict | None:
    """One named model's state, or None while its files are not all there."""
    files, load = _MODELS[name]
    return _fresh(("model", name), files(), load)


def _features(dep: str, dest: str) -> pd.DataFrame | None:
    """One corridor's feature store, or None if it has not been built."""
    path = _features_path(dep, dest)
    return _fresh(("features", dep.lower(), dest.lower()), [path], lambda: pd.read_parquet(path))


@app.get("/ping")
def ping() -> dict:
    """SageMaker's health check: whether the promoted model loads, the
    one SageMaker's own check cares about, plus which of the others have
    been trained -- their files are there. Those are not loaded here: it
    used to load every one, so a candidate nobody had asked for that
    failed to load made this 500, the service unhealthy, and the planner,
    which waits for a healthy model-service, unable to start.
    """
    current = _load("current")
    return {
        "status": "ok" if current else "no model loaded",
        "model_loaded": current is not None,
        "model_dir": str(MODEL_DIR),
        "trained_at": current["metrics"].get("trained_at") if current else None,
        "routes": available_routes(),
        "models": {name: _signature(files()) is not None for name, (files, _) in _MODELS.items()},
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
    if model_name not in _MODELS:
        # It used to answer as though the model were merely untrained,
        # with a command that rejects the name.
        raise HTTPException(422, f"No model named {model_name!r}: one of {', '.join(_MODELS)}.")
    state = _load(model_name)
    if state is None:
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
    df = _features(dep, dest)
    if df is None:
        # 404 rather than "just build it": collecting a corridor is
        # Overpass queries, FAA downloads and a per-candidate elevation
        # lookup -- minutes of network I/O. That is a batch job, so this
        # says exactly how to run it instead of blocking an inference
        # request on it.
        raise HTTPException(
            status_code=404,
            detail=(
                f"No feature store for {dep}->{dest}. Build it first:\n"
                f"  docker compose run --rm pipeline-processing collect --dep-ident {dep} --dest-ident {dest}\n"
                f"  docker compose run --rm pipeline-processing engineer-features --dep-ident {dep} --dest-ident {dest}"
            ),
        )

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
