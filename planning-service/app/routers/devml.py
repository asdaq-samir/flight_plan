"""Lookups the pages need around the planner itself: the route form's
airport search, and every trained
algorithm side by side (Settings' Dev ML panel, and the one line in
Plan's own info popover naming the model that scored the checkpoints).
Nothing the planner's own scoring path depends on."""
import json

from fastapi import APIRouter, Response
from vfr import aircraft, airports, model_registry, places
from vfr import fixes as fixes_module

from ..common import SHARED_CACHE
from ..schemas import AircraftProfiles, AirportSearch, ModelComparison

router = APIRouter()


@router.get("/api/aircraft-profiles")
def aircraft_profiles(response: Response) -> AircraftProfiles:
    """The stock performance profiles (data/aircraft/*.json) the nav log
    can be computed for -- a pilot's own aeroplane overrides the cruise
    TAS and fuel burn on top of one of these, see /api/navlog. Kept for
    an hour at most (SHARED_CACHE): this is the picker's list; the nav
    log's figures come from the profile on the server."""
    response.headers["Cache-Control"] = SHARED_CACHE
    profiles = []
    for path in sorted(aircraft.DEFAULT_PROFILE_DIR.glob("*.json")):
        profile = aircraft.load_aircraft_profile(path)
        profiles.append({"name": path.stem, **profile})
    return {"profiles": profiles}


def _where(fix: dict) -> str | None:
    """A fix's line under its name: where it is, and its state -- "by
    Bangs Lake, IL" (vfr.places) -- or the state alone."""
    where = places.describe(fix["lat"], fix["lon"])
    return ", ".join(part for part in (where, fix["state"]) if part) or None


def _near(near: str) -> tuple:
    """"42.2,-88.1;46.8,-92.2" as ((42.2, -88.1), (46.8, -92.2)); what is
    not a pair of numbers left out."""
    points = []
    for pair in near.split(";"):
        try:
            lat, lon = (float(v) for v in pair.split(","))
        except ValueError:
            continue
        points.append((lat, lon))
    return tuple(points)


@router.get("/api/airports/index", responses={200: {"content": {"application/json": {}}}})
def airport_index() -> Response:
    """Every US airport the search answers with, for the app to search on
    the phone itself as a pilot types (vfr.airports.search_index): its
    answers there at once, where each letter's question waited on this
    planner, a second and more while it planned a route. Gzipped as it is
    kept -- about 530 KB, from 1.8 MB -- and the same for every pilot until
    OurAirports' table changes, so kept a day by the browser and the CDN
    (PlannerProxyController passes both headers on)."""
    return Response(
        content=airports.search_index(), media_type="application/json",
        headers={"Content-Encoding": "gzip", "Cache-Control": "public, max-age=86400", "Vary": "Accept-Encoding"},
    )


@router.get("/api/airports/search")
def airport_search(response: Response, q: str = "", fixes: bool = False, near: str = "") -> AirportSearch:
    """DEP/DEST's own autocomplete -- every airport whose ident or name
    starts with `q`, for the route inputs to suggest as a pilot types.
    Runs against the same in-memory OurAirports table the real lookup
    uses, not a second data source that could drift from it. With
    `fixes`, a stop's: the named fixes and navaids whose ident starts with
    it too, after the airports -- VFR waypoints first (vfr.fixes). `near`,
    the route's points as "lat,lon;lat,lon": of an ident's navaids in two
    places, the one the route would fly over (fixes.find_navaid), as the
    stop typed will be -- the row named the other where they differed.
    Kept for an hour at most (SHARED_CACHE): these are suggestions, and
    the stop picked is looked up afresh when the route is planned.
    """
    response.headers["Cache-Control"] = SHARED_CACHE
    found = airports.search_airports(q)
    if fixes:
        known = {a["ident"] for a in found}
        by_route = _near(near)
        found_fixes = [
            (fixes_module.find_navaid(f["ident"], by_route) or f) if f.get("navaid") else f
            for f in fixes_module.search_fixes(q) if f["ident"] not in known
        ]
        named = [{"ident": f["ident"], "name": fixes_module.title(f), "region": _where(f), "kind": "fix"} for f in found_fixes]
        # The fix typed whole before the airports: "RFD" is the navaid a
        # stop by that ident flies over (app.common.resolve_stop), and the
        # airport, KRFD, is listed under it.
        exact = [f for f in named if f["ident"] == q.strip().upper()]
        found = exact + found + [f for f in named if f not in exact]
    return {"airports": found}


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
