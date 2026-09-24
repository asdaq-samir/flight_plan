"""Lookups the pages need around the planner itself: the route form's
airport search, the corridors already collected, and every trained
algorithm side by side (Settings' Dev ML panel, and the one line in
Plan's own info popover naming the model that scored the checkpoints).
Nothing the planner's own scoring path depends on."""
import json

from fastapi import APIRouter, HTTPException
from vfr import aircraft, airports, model_client, model_registry

from ..schemas import AircraftProfiles, AirportSearch, BuiltRoutes, ModelComparison

router = APIRouter()


@router.get("/api/aircraft-profiles")
def aircraft_profiles() -> AircraftProfiles:
    """The stock performance profiles (data/aircraft/*.json) the nav log
    can be computed for -- a pilot's own aeroplane overrides the cruise
    TAS and fuel burn on top of one of these, see /api/navlog."""
    profiles = []
    for path in sorted(aircraft.DEFAULT_PROFILE_DIR.glob("*.json")):
        profile = aircraft.load_aircraft_profile(path)
        profiles.append({"name": path.stem, **profile})
    return {"profiles": profiles}


@router.get("/api/airports/search")
def airport_search(q: str = "") -> AirportSearch:
    """DEP/DEST's own autocomplete -- every airport whose ident or name
    starts with `q`, for the route inputs to suggest as a pilot types.
    Runs against the same in-memory OurAirports table the real lookup
    uses, not a second data source that could drift from it.
    """
    return {"airports": airports.search_airports(q)}


@router.get("/api/routes")
def built_routes() -> BuiltRoutes:
    """Corridors model-service already has a feature store for."""
    try:
        return model_client.list_routes()
    except model_client.ModelServiceError as err:
        raise HTTPException(err.status, str(err)) from err


@router.get("/api/model-comparison")
def model_comparison() -> ModelComparison:
    """Every algorithm anyone has actually trained for this problem,
    not just the sklearn family retrain() grid-searches: the promoted
    model's own comparison against Ridge/GradientBoosting/a dummy
    "predict the mean" baseline, plus PyTorch/TensorFlow/Spark's own
    candidates (vfr.model_candidates), when they exist.

    Each entry names its own metric rather than pretending they are
    all the same number: the sklearn family's own selection already
    runs 5-fold CV (cv_mae), while the new candidates report a single
    held-out split's MAE (held_out_mae) -- except Spark, whose own
    CrossValidator gives it a real cv_mae too. Blending these into one
    unlabeled column would overstate how comparable they actually are.
    """
    # Nothing promoted yet is an empty comparison, not an error: it was a
    # 404, and a fresh stack's Performance tab toasted it as a failure.
    metrics_path = model_registry.CURRENT_MODEL_DIR / "metrics.json"
    current_metrics = json.loads(metrics_path.read_text()) if metrics_path.exists() else {}

    models = [
        {"name": name, "metric": "cv_mae", "score": score, "promoted": name == current_metrics.get("model_type")}
        for name, score in (current_metrics.get("cv_mae_by_model") or {}).items()
    ]

    candidates_dir = model_registry.MODELS_DIR / "candidates"
    for algo_dir in ("pytorch", "tensorflow", "spark"):
        candidate_metrics_path = candidates_dir / algo_dir / "metrics.json"
        if not candidate_metrics_path.exists():
            continue
        candidate_metrics = json.loads(candidate_metrics_path.read_text())
        metric_name = "cv_mae" if "cv_mae" in candidate_metrics else "held_out_mae"
        models.append({
            "name": candidate_metrics.get("model_type", algo_dir),
            "metric": metric_name,
            "score": candidate_metrics.get(metric_name),
            "promoted": False,
        })

    return {
        "models": models,
        "trained_at": current_metrics.get("trained_at"),
        "n_labeled": current_metrics.get("n_labeled"),
    }
