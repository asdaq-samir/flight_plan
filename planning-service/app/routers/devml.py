"""Lookups the pages need around the planner itself: the route form's
airport search, the corridors already collected, and Settings' Dev ML
tab (every trained algorithm side by side, and scoring from a chosen
one). Nothing the planner's own scoring path depends on."""
import json

from fastapi import APIRouter, HTTPException
from vfr import airports, model_client, model_registry

from ..common import route_key
from ..scoring import invoke_model

router = APIRouter()


@router.get("/api/airports/search")
def airport_search(q: str = "") -> dict:
    """DEP/DEST's own autocomplete -- every airport whose ident or name
    starts with `q`, for the route inputs to suggest as a pilot types.
    Runs against the same in-memory OurAirports table the real lookup
    uses, not a second data source that could drift from it.
    """
    return {"airports": airports.search_airports(q)}


@router.get("/api/routes")
def built_routes() -> dict:
    """Corridors model-service already has a feature store for."""
    try:
        return model_client.list_routes()
    except model_client.ModelServiceError as err:
        raise HTTPException(err.status, str(err)) from err


@router.get("/api/model-comparison")
def model_comparison() -> dict:
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
    metrics_path = model_registry.CURRENT_MODEL_DIR / "metrics.json"
    if not metrics_path.exists():
        raise HTTPException(404, "no model has been promoted yet")
    current_metrics = json.loads(metrics_path.read_text())

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


@router.get("/api/playground/score")
def playground_score(dep: str, dest: str, model: str = "current") -> dict:
    """Scored checkpoints from one specific algorithm -- the Dev ML
    tab's demo, kept apart from the planner's real scoring path
    (app.scoring), which never chooses an algorithm: it always uses
    whatever is promoted. A thin passthrough to model-service's own
    `model` selector on /invocations.
    """
    dep_ident, dest_ident = route_key(dep, dest)
    return invoke_model(dep_ident, dest_ident, model=model)
