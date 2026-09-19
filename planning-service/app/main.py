"""The route planner: two airport idents in, a chart with the course and
its checkpoints out, plus the dead-reckoning nav log for the legs between
them.

This is the human-facing surface of everything else in the project. The
model scores candidate landmarks (model-service), vfr.checkpoints narrows
them to the handful worth flying, and vfr.navlog turns those into legs
with real wind and magnetic variation -- but none of that is inspectable
from a JSON response. Seeing the checkpoints on the sectional is the only
way to judge whether they are findable in the air, which is the question
the whole model exists to answer.

Split of responsibility, and why it falls this way:

- model-service owns the model artifact and its pinned scikit-learn, and
  stays /ping + /invocations + /routes, mirroring a SageMaker inference
  container. This service never loads a model.
- This service owns everything route-shaped: collecting a corridor,
  building its features, computing the nav log, and drawing it.

Collection runs here in-process on a background thread rather than by
launching a pipeline container, because that would mean handing this
service the Docker socket -- a much larger grant than it needs. It is the
same vfr.pipeline functions the Airflow DAG calls, so there is one
implementation, not two.
"""
import json
import math
import os
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError
from contextlib import asynccontextmanager
from itertools import pairwise

import anthropic
import requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel
from vfr import aircraft as aircraft_module
from vfr import (
    airports,
    chartlabels,
    chartvision,
    checkpoint_notes,
    faa_data,
    geo,
    model_registry,
    navlog,
    pipeline,
    weather,
)
from vfr import altitude as altitude_module
from vfr import checkpoints as checkpoint_selection
from vfr.config import (
    DATA_DIR,
    VFR_SECTIONAL_MAX_ZOOM,
    VFR_SECTIONAL_MIN_ZOOM,
)

MODEL_SERVICE_URL = os.environ.get("MODEL_SERVICE_URL", "http://model-service:8000")
# Same env-var convention as nav-log-agent's NAV_LOG_AGENT_MODEL -- this
# is the only other place in the repo that names a Claude model.
CHECKPOINT_NOTE_MODEL = os.environ.get("CHECKPOINT_NOTE_MODEL", "claude-sonnet-5")
# These fail the same way for every checkpoint in the route, not just
# the one that happened to hit it first -- a bad key or an exhausted
# rate limit does not get better by trying the next 20 checkpoints the
# same way, it just burns 20 more calls to learn the same thing.
# APITimeoutError is a subclass of APIConnectionError already.
GLOBAL_ANTHROPIC_ERRORS = (
    anthropic.AuthenticationError,
    anthropic.PermissionDeniedError,
    anthropic.APIConnectionError,
    anthropic.RateLimitError,
)
PROCESSED_DIR = DATA_DIR / "processed"
DEFAULT_AIRCRAFT = "c172"


@asynccontextmanager
async def _lifespan(app: FastAPI):
    yield
    # uvicorn's graceful SIGTERM shutdown runs this before the process
    # exits. It can't save a build's in-memory progress across the
    # restart that's about to happen (_builds starts empty either way),
    # but it closes the narrow window where a load balancer still
    # routing a drained connection's GET /api/build/{job_id} would
    # otherwise see a "running" job simply vanish with no explanation.
    with _builds_lock:
        for job in _builds.values():
            if job["state"] in ("queued", "running"):
                job.update(state="failed", step="failed", detail="interrupted by service shutdown")


app = FastAPI(title="vfr-route planner", lifespan=_lifespan)


@app.exception_handler(weather.WeatherServiceError)
async def _weather_service_error(request: Request, exc: weather.WeatherServiceError):
    # One place, not one try/except per call site -- weather.py's
    # functions are called from /api/plan, /api/navlog, /api/briefing
    # and /api/altitude-breakdown alike, and a down or slow
    # aviationweather.gov should read as "the weather source is
    # unavailable" everywhere, not a raw 500.
    return JSONResponse(status_code=502, content={"detail": str(exc)})


# The React build. Served here while the port is in progress so the pages
# it replaces stay reachable and can be compared against it; when Spring
# Boot becomes the public surface this is the only part that moves.

# job id -> {"state": queued|running|done|failed, "step", "detail", ...}
# In-memory on purpose: a build is only meaningful to the page that
# started it, and a restart should forget a half-finished one rather than
# resume something whose partial output is already on disk.
_builds: dict = {}
_builds_lock = threading.Lock()


class BuildRequest(BaseModel):
    departure_ident: str
    destination_ident: str


def _route_key(dep: str, dest: str) -> tuple:
    return dep.strip().upper(), dest.strip().upper()


def _paths(dep: str, dest: str) -> tuple:
    slug = f"{dep.lower()}_{dest.lower()}"
    return (
        PROCESSED_DIR / f"candidates_{slug}.csv",
        PROCESSED_DIR / f"features_{slug}.parquet",
    )


def _resolve(dep: str, dest: str) -> tuple:
    """Both airports, or a 404 naming the one that failed.

    Done before anything else so a typo'd ident says so, rather than
    surfacing later as "this corridor has not been collected" -- advice
    whose next step would fail for a different reason.
    """
    try:
        return airports.get_airport(dep), airports.get_airport(dest)
    except ValueError as err:
        raise HTTPException(404, str(err)) from err


@app.get("/")
def index() -> dict:
    """This service has no pages any more.

    The front end is built into the Spring Boot gateway's jar and served
    from there, which is also the only thing that calls this -- so this
    answers a health probe and says where the UI went, rather than
    redirecting to a path it no longer serves.
    """
    return {"service": "planner", "ui": "served by the gateway at /app"}


@app.get("/api/routes")
def built_routes() -> dict:
    """Corridors model-service already has a feature store for."""
    try:
        return requests.get(f"{MODEL_SERVICE_URL}/routes", timeout=10).json()
    except requests.RequestException as err:
        raise HTTPException(502, f"Could not reach model-service: {err}") from err


@app.get("/api/airports/search")
def airport_search(q: str = "") -> dict:
    """DEP/DEST's own autocomplete -- every airport whose ident or name
    starts with `q`, for the route inputs to suggest as a pilot types.
    Runs against the same in-memory OurAirports table `_resolve` above
    already uses for the real lookup, not a second data source that
    could drift from it.
    """
    return {"airports": airports.search_airports(q)}


@app.get("/api/model-comparison")
def model_comparison() -> dict:
    """Every algorithm anyone has actually trained for this problem,
    not just the sklearn family retrain() grid-searches: the promoted
    model's own comparison against Ridge/GradientBoosting/a dummy
    "predict the mean" baseline, plus PyTorch/TensorFlow/Spark's own
    candidates (vfr.model_candidates), when they exist. For Settings'
    Dev ML tab's comparison panel, not anything the planner itself
    uses.

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


@app.get("/api/playground/score")
def playground_score(dep: str, dest: str, model: str = "current") -> dict:
    """Scored checkpoints from one specific algorithm -- Settings' Dev
    ML tab's own model-comparison demo, kept deliberately separate
    from _score()/the planner's real scoring path (used by
    /api/checkpoints etc.), which never needs to choose an algorithm:
    it always uses whatever is currently promoted. A thin passthrough
    to model-service's own `model` selector on /invocations.
    """
    dep_ident, dest_ident = _route_key(dep, dest)
    try:
        resp = requests.post(
            f"{MODEL_SERVICE_URL}/invocations",
            json={"departure_ident": dep_ident, "destination_ident": dest_ident, "model": model},
            timeout=90,
        )
    except requests.RequestException as err:
        raise HTTPException(502, f"Could not reach model-service: {err}") from err
    if resp.status_code == 404:
        raise HTTPException(404, f"{dep_ident}->{dest_ident} has not been collected yet")
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, resp.json().get("detail", resp.text))
    return resp.json()


@app.get("/api/altitude-breakdown")
def altitude_breakdown(dep: str, dest: str, aircraft: str = DEFAULT_AIRCRAFT) -> dict:
    """The full altitude_module.select_cruise_altitude() breakdown for
    any route -- floor, ceiling band and each of its own components
    (airspace/freezing level/aircraft service ceiling), and the
    weather go/no-go flags.

    /api/navlog's own "altitude" stream message already carries this
    exact dict, which is what the Brief tab's own "Cruise Altitude"
    section actually shows a pilot -- for whichever route they have
    open on the Plan page right now. This is a standalone read of the
    same computation for any dep/dest pair, independent of a session's
    own state; no current UI calls it directly (it used to be Settings'
    own Altitude Selection Breakdown panel, before that panel moved to
    the Brief tab and became a read of already-loaded nav-log data
    instead of a second fetch), but it stays as a real, documented
    endpoint in its own right.
    """
    dep_ident, dest_ident = _route_key(dep, dest)
    dep_airport, dest_airport = _resolve(dep_ident, dest_ident)
    start = (dep_airport["lat"], dep_airport["lon"])
    end = (dest_airport["lat"], dest_airport["lon"])
    profile = aircraft_module.load_aircraft_profile(aircraft)
    return _cruise_altitude(start, end, profile, aircraft)


# The altitude selection re-ran its whole stack -- terrain sampling
# (USGS EPQS, network), the airspace shapefile, and three separate
# aviationweather.gov calls -- on every single nav-log request, for a
# result that only moves when the weather does. The terrain and airspace
# halves are static per route outright; the weather half already runs on
# aviationweather.gov products reissued a few times a day, and
# vfr.weather's own winds cache uses this same 15-minute TTL. On a bad
# aviationweather.gov day (504s, retries) one uncached selection was
# observed taking over two minutes -- a price worth paying once per
# route per quarter hour, not on every page load.
_ALTITUDE_CACHE: dict = {}
_ALTITUDE_TTL_S = 900
_ALTITUDE_CACHE_LOCK = threading.Lock()


def _cruise_altitude(start: tuple, end: tuple, profile: dict, aircraft: str) -> dict:
    key = (round(start[0], 4), round(start[1], 4), round(end[0], 4), round(end[1], 4), aircraft)
    with _ALTITUDE_CACHE_LOCK:
        hit = _ALTITUDE_CACHE.get(key)
        if hit is not None and time.time() - hit[0] < _ALTITUDE_TTL_S:
            return hit[1]
    selection = altitude_module.select_cruise_altitude(start, end, profile)
    with _ALTITUDE_CACHE_LOCK:
        _ALTITUDE_CACHE[key] = (time.time(), selection)
    return selection


def _no_altitude_detail(selection: dict) -> str:
    return (
        "No legal VFR cruising altitude exists for this route and aircraft "
        f"(floor {selection.get('floor_ft')} ft, ceiling "
        f"{selection.get('band_ceiling_ft')} ft). Supply altitude_ft "
        "explicitly to plan anyway."
    )


def _course_line(start: tuple, end: tuple, step_nm: float = 5.0) -> list:
    """The course line as [[lat, lon], ...], following the great circle.

    Stepped with the bearing recomputed toward the destination at every
    point, which is what makes it the actual great circle: hold the
    initial bearing constant instead and you trace a different path that
    sits a couple of miles off true course at the midpoint of a 300 nm
    leg. That matters because candidate positions come from great-circle
    cross-track distance, so a line drawn any other way would show
    on-course checkpoints as visibly off it.
    """
    total = geo.distance_nm(start[0], start[1], end[0], end[1])
    points, current, travelled = [list(start)], start, 0.0
    while travelled + step_nm < total:
        bearing = geo.bearing_deg(current[0], current[1], end[0], end[1])
        current = geo.destination_point(current[0], current[1], bearing, step_nm)
        travelled += step_nm
        points.append(list(current))
    points.append(list(end))
    return points


def _fixes(dep_ident: str, dest_ident: str, start: tuple, end: tuple, selected: list) -> list:
    """The nav log flies departure -> checkpoints -> destination. The
    airports are the ends of the flight, so they bound the legs even
    though neither is a checkpoint candidate."""
    return (
        [{"name": dep_ident, "category": "departure", "lat": start[0], "lon": start[1]}]
        + selected
        + [{"name": dest_ident, "category": "destination", "lat": end[0], "lon": end[1]}]
    )


def _assemble_leg(a: dict, b: dict, altitude_ft: float, profile: dict) -> dict:
    leg = navlog.assemble_leg((a["lat"], a["lon"]), (b["lat"], b["lon"]), altitude_ft, profile)
    leg["from"] = a["name"] or a["category"]
    leg["to"] = b["name"] or b["category"]
    # assemble_leg returns inf for ETE when groundspeed is zero or
    # negative -- a headwind at or above cruise TAS. Python's json
    # emits that as a bare Infinity, which is not valid JSON and
    # makes JSON.parse throw in the browser, so the whole plan would
    # fail to render because of one unflyable leg. None says
    # "unflyable" honestly and the page shows it as such.
    for field in ("ete_min", "fuel_gal", "groundspeed_kt"):
        if not math.isfinite(leg[field]):
            leg[field] = None
    return leg


def _totals(legs: list) -> dict:
    def _total(field: str):
        values = [leg[field] for leg in legs if leg[field] is not None]
        return round(sum(values), 1) if len(values) == len(legs) else None

    return {
        "distance_nm": round(sum(leg["distance_nm"] for leg in legs), 1),
        # None rather than a wrong number if any leg is unflyable:
        # silently summing the flyable ones would understate the trip.
        "ete_min": _total("ete_min"),
        "fuel_gal": _total("fuel_gal"),
        "unflyable_legs": sum(1 for leg in legs if leg["ete_min"] is None),
        # Surfaced rather than averaged away: a leg with no nearby
        # winds-aloft station is a no-wind-data estimate, not a calm
        # one, and a pilot should know which legs those are.
        "legs_without_wind": sum(1 for leg in legs if leg.get("wind") is None),
    }


# Scored checkpoints per route, keyed by what actually changes the
# result: the features file and the promoted model. /api/checkpoints and
# /api/navlog each call _score for the same route on every single page
# load -- two full model-service round trips (features parquet read +
# inference) for one screen, and the second one always returned exactly
# what the first just had.
_SCORE_CACHE: dict = {}
_SCORE_CACHE_LOCK = threading.Lock()


def _mtime_or_none(path) -> float | None:
    try:
        return path.stat().st_mtime
    except OSError:
        return None


def _score(dep: str, dest: str) -> list:
    _, features_path = _paths(dep, dest)
    key = (
        dep, dest,
        _mtime_or_none(features_path),
        _mtime_or_none(model_registry.CURRENT_MODEL_DIR / "metrics.json"),
    )
    with _SCORE_CACHE_LOCK:
        cached = _SCORE_CACHE.get((dep, dest))
        if cached is not None and cached["key"] == key:
            # Copies, not the cached dicts themselves -- /api/checkpoints
            # writes a "selected" flag onto every entry it returns, and
            # two requests doing that to one shared list is a data race.
            return [dict(c) for c in cached["checkpoints"]]

    try:
        resp = requests.post(
            f"{MODEL_SERVICE_URL}/invocations",
            json={"departure_ident": dep, "destination_ident": dest},
            timeout=90,
        )
    except requests.RequestException as err:
        raise HTTPException(502, f"Could not reach model-service: {err}") from err
    if resp.status_code == 404:
        raise HTTPException(404, f"{dep}->{dest} has not been collected yet")
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, resp.json().get("detail", resp.text))
    checkpoints = resp.json()["checkpoints"]
    with _SCORE_CACHE_LOCK:
        _SCORE_CACHE[(dep, dest)] = {"key": key, "checkpoints": [dict(c) for c in checkpoints]}
    return checkpoints


@app.get("/api/plan")
def plan(
    dep: str,
    dest: str,
    altitude_ft: float | None = None,
    aircraft: str = DEFAULT_AIRCRAFT,
) -> dict:
    """The whole plan: course line, every scored candidate, the selected
    checkpoints, and a nav log leg between each consecutive pair.

    altitude_ft is optional. Omitted, vfr.altitude picks one that clears
    terrain and obstacles, respects the hemispheric rule for the course,
    stays under the aircraft's service ceiling and dodges controlled
    airspace -- and the reasoning comes back with it, since "why am I at
    6,500" is a question a pilot will actually ask.
    """
    dep_ident, dest_ident = _route_key(dep, dest)
    dep_airport, dest_airport = _resolve(dep_ident, dest_ident)
    start = (dep_airport["lat"], dep_airport["lon"])
    end = (dest_airport["lat"], dest_airport["lon"])

    scored = _score(dep_ident, dest_ident)
    selected = checkpoint_selection.select_checkpoints(scored)
    selected_keys = {(c["osm_id"], c["category"]) for c in selected}
    for c in scored:
        c["selected"] = (c["osm_id"], c["category"]) in selected_keys

    profile = aircraft_module.load_aircraft_profile(aircraft)

    altitude_selection = None
    if altitude_ft is None:
        altitude_selection = _cruise_altitude(start, end, profile, aircraft)
        altitude_ft = altitude_selection.get("recommended_ft")
        if altitude_ft is None:
            raise HTTPException(422, _no_altitude_detail(altitude_selection))

    fixes = _fixes(dep_ident, dest_ident, start, end, selected)
    legs = [_assemble_leg(a, b, altitude_ft, profile) for a, b in pairwise(fixes)]

    return {
        "departure": {"ident": dep_ident, "name": dep_airport["name"], "lat": start[0], "lon": start[1]},
        "destination": {"ident": dest_ident, "name": dest_airport["name"], "lat": end[0], "lon": end[1]},
        "distance_nm": round(geo.distance_nm(start[0], start[1], end[0], end[1]), 1),
        "course_line": _course_line(start, end),
        "candidates": scored,
        "selected": selected,
        "legs": legs,
        "totals": _totals(legs),
        "altitude_ft": altitude_ft,
        "altitude_selection": altitude_selection,
        "aircraft": {"name": aircraft, **profile},
        "max_zoom": VFR_SECTIONAL_MAX_ZOOM,
        "min_zoom": VFR_SECTIONAL_MIN_ZOOM,
    }


def _run_build(job_id: str, dep: str, dest: str) -> None:
    candidates_path, features_path = _paths(dep, dest)

    def step(name: str) -> None:
        with _builds_lock:
            _builds[job_id]["step"] = name

    try:
        step("collecting candidates (Overpass + FAA)")
        pipeline.collect(dep_ident=dep, dest_ident=dest, out_path=candidates_path)
        step("engineering features (elevation lookups)")
        pipeline.engineer_features(in_path=candidates_path, out_path=features_path)
        with _builds_lock:
            _builds[job_id].update(state="done", step="ready", detail=str(features_path))
    except Exception as err:  # noqa: BLE001 -- surfaced to the caller verbatim
        with _builds_lock:
            _builds[job_id].update(
                state="failed",
                step="failed",
                detail=f"{type(err).__name__}: {err}",
                traceback=traceback.format_exc(limit=3),
            )


@app.post("/api/build")
def build(request: BuildRequest) -> dict:
    """Start collecting a corridor. Returns a job id to poll.

    Asynchronous because this is minutes of network I/O -- Overpass, the
    FAA subscription, and an elevation lookup per candidate -- not
    something to hold an HTTP request open for.
    """
    dep, dest = _route_key(request.departure_ident, request.destination_ident)
    _resolve(dep, dest)
    if dep == dest:
        raise HTTPException(422, "Departure and destination are the same airport")

    _, features_path = _paths(dep, dest)
    if features_path.exists():
        return {"job_id": None, "state": "done", "step": "already built"}

    with _builds_lock:
        running = [
            j for j, b in _builds.items()
            if b["state"] in ("queued", "running") and b["route"] == f"{dep}->{dest}"
        ]
        if running:
            return {"job_id": running[0], "state": "running", "step": _builds[running[0]]["step"]}
        job_id = uuid.uuid4().hex[:12]
        _builds[job_id] = {
            "state": "running", "step": "starting", "route": f"{dep}->{dest}", "detail": None,
        }

    threading.Thread(target=_run_build, args=(job_id, dep, dest), daemon=True).start()
    return {"job_id": job_id, "state": "running", "step": "starting"}


@app.get("/api/build/{job_id}")
def build_status(job_id: str) -> dict:
    with _builds_lock:
        job = _builds.get(job_id)
    if job is None:
        raise HTTPException(404, f"No build job {job_id}")
    return {"job_id": job_id, **job}


# ---------------------------------------------------------------------
# Chart-vision path: the fast one. Nothing below touches Overpass, the
# FAA subscription or the elevation service.
# ---------------------------------------------------------------------


class Pick(BaseModel):
    departure_ident: str
    destination_ident: str
    lat: float
    lon: float
    source: str = "detected"   # "detected" (the CV found it) or "added" (it missed it)
    role: str | None = None    # "dr" (fly over it) or "visual" (see it abeam); inferred if omitted
    category: str = "water"
    rating: int | None = None  # 1-5, or 0/None for "detected but I would not use it"
    area_m2: float | None = None
    note: str | None = None


@app.get("/api/course")
def course(dep: str, dest: str) -> dict:
    """Just the course line and its endpoints.

    Separate from detection so the chart can draw a line the instant two
    idents are entered. Reading tiles takes seconds even on the fast
    path, and there is no reason a pilot should watch an empty map for
    them.
    """
    dep_ident, dest_ident = _route_key(dep, dest)
    dep_airport, dest_airport = _resolve(dep_ident, dest_ident)
    start = (dep_airport["lat"], dep_airport["lon"])
    end = (dest_airport["lat"], dest_airport["lon"])
    return {
        "departure": {
            "ident": dep_ident, "name": dep_airport["name"], "lat": start[0], "lon": start[1],
            "elevation_ft": dep_airport.get("elevation_ft"),
        },
        "destination": {
            "ident": dest_ident, "name": dest_airport["name"], "lat": end[0], "lon": end[1],
            "elevation_ft": dest_airport.get("elevation_ft"),
        },
        "distance_nm": round(geo.distance_nm(start[0], start[1], end[0], end[1]), 1),
        "bearing_deg": round(geo.bearing_deg(start[0], start[1], end[0], end[1])),
        "course_line": _course_line(start, end),
        "max_zoom": VFR_SECTIONAL_MAX_ZOOM,
        "min_zoom": VFR_SECTIONAL_MIN_ZOOM,
    }


# There is no /api/detect. It returned the whole corridor in one
# response and duplicated the stream's pick-matching, which is exactly
# how a bug survived being fixed: the matching was repaired here while
# the page went on calling /api/detect/stream, which still had it wrong.
# One implementation, and it is the streaming one.


@app.post("/api/picks")
def add_pick(pick: Pick) -> dict:
    dep_ident, dest_ident = _route_key(pick.departure_ident, pick.destination_ident)
    dep_airport, dest_airport = _resolve(dep_ident, dest_ident)
    start = (dep_airport["lat"], dep_airport["lon"])
    end = (dest_airport["lat"], dest_airport["lon"])

    if pick.source not in ("detected", "added"):
        raise HTTPException(422, "source must be 'detected' or 'added'")
    if pick.role is not None and pick.role not in chartlabels.ROLES:
        raise HTTPException(422, f"role must be one of {chartlabels.ROLES}")
    if pick.rating is not None and not (0 <= pick.rating <= 5):
        raise HTTPException(422, "rating must be 0-5, where 0 means 'would not use'")

    route = chartlabels.route_key(dep_ident, dest_ident)
    cross_track_nm = round(geo.cross_track_distance_nm(pick.lat, pick.lon, start, end), 3)
    saved = chartlabels.save_pick(
        {
            "route": route,
            "source": pick.source,
            # Inferred from how far off course it sits unless stated: a
            # landmark you do not fly over is not a DR checkpoint.
            "role": pick.role or chartlabels.default_role(cross_track_nm),
            "category": pick.category,
            "lat": pick.lat,
            "lon": pick.lon,
            "along_track_nm": round(geo.along_track_distance_nm(pick.lat, pick.lon, start, end), 2),
            "cross_track_nm": cross_track_nm,
            "rating": pick.rating,
            "area_m2": pick.area_m2,
            "note": pick.note,
        }
    )
    return {"ok": True, "pick": saved, "summary": chartlabels.summarise(route)}


@app.delete("/api/picks")
def remove_pick(dep: str, dest: str, lat: float, lon: float) -> dict:
    dep_ident, dest_ident = _route_key(dep, dest)
    route = chartlabels.route_key(dep_ident, dest_ident)
    removed = chartlabels.delete_pick(route, lat, lon)
    return {"ok": removed, "summary": chartlabels.summarise(route)}


@app.get("/api/picks")
def list_picks(dep: str, dest: str) -> dict:
    route = chartlabels.route_key(*_route_key(dep, dest))
    return {"route": route, "picks": chartlabels.load_picks(route),
            "summary": chartlabels.summarise(route)}


@app.get("/api/classify")
def classify(lat: float, lon: float) -> dict:
    """What the chart draws at a point, so a hand-marked checkpoint is
    categorised from the pixels rather than from whatever the dropdown
    happened to be left on."""
    return chartvision.classify_point(lat, lon)


# One chart cycle, in seconds -- how long a browser (or a CDN in front
# of this app) may keep a tile before asking again. PlannerProxyController
# forwards Cache-Control for this path alone; see its own comment.
_SECTIONAL_TILE_MAX_AGE_S = 28 * 24 * 3600


@app.get("/api/sectional-tile/{z}/{x}/{y}.png")
def sectional_tile(z: int, x: int, y: int) -> Response:
    """The sectional as a {z}/{x}/{y} tile pyramid, built from the TAMU
    dynamic map service one tile-sized export at a time and cached on
    disk (vfr.chartvision's own tile cache -- the same files the
    detector reads, so a corridor planned once has its map tiles ready,
    and a map browsed once has its detection tiles ready).

    This is what makes the map's sectional layer a plain Leaflet tile
    layer again: edge-only fetches on a pan, the previous zoom's tiles
    scaled under the zoom animation, a prefetch ring -- everything a
    tile pyramid gets for free that a one-image-per-view dynamic layer
    (the previous approach) structurally could not, however it was
    padded or faded. Outside the chart's own useful zoom range there is
    nothing worth rendering: the tile layer's maxNativeZoom keeps the
    browser from asking, and this keeps anyone else from making TAMU
    render it.
    """
    if not (VFR_SECTIONAL_MIN_ZOOM <= z <= VFR_SECTIONAL_MAX_ZOOM):
        raise HTTPException(404, f"sectional tiles exist for zoom {VFR_SECTIONAL_MIN_ZOOM}-{VFR_SECTIONAL_MAX_ZOOM}")
    png = chartvision.sectional_tile_png(x, y, z)
    if png is None:
        raise HTTPException(404, "no chart coverage for this tile")
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": f"public, max-age={_SECTIONAL_TILE_MAX_AGE_S}"},
    )


_APT_CACHE: dict = {}


def _faa_airports(start, end, half_width_nm, dep_ident, dest_ident) -> list:
    """Charted airports in the corridor, as chartvision Landmarks.

    Read once and held: APT_BASE is a large CSV and a planner request
    should not re-parse it. Departure and destination are excluded -- you
    are not using them as references, you are flying from one to the
    other.
    """
    if "path" not in _APT_CACHE:
        _, apt_csv_path, _dof = faa_data.ensure_nasr_data(DATA_DIR / "raw" / "faa_nasr")
        _APT_CACHE["path"] = apt_csv_path
    bbox = geo.corridor_bbox(start, end, half_width_nm + 1.0)
    # APT_BASE is a large national CSV and re-parsing it per request cost
    # 2.1 s, which was the entire time-to-first-marker on a streamed
    # route -- airports are meant to be the cheap thing shown first.
    df = faa_data.load_route_airports(
        _APT_CACHE["path"], bbox, exclude_idents=(dep_ident, dest_ident)
    )

    landmarks = []
    for row in df.itertuples(index=False):
        cross = geo.cross_track_distance_nm(row.lat, row.lon, start, end)
        along = geo.along_track_distance_nm(row.lat, row.lon, start, end)
        route_nm = geo.distance_nm(start[0], start[1], end[0], end[1])
        if abs(cross) > half_width_nm or not (-5.0 <= along <= route_nm + 5.0):
            continue
        landmarks.append(
            chartvision.Landmark(
                category="airport",
                lat=float(row.lat),
                lon=float(row.lon),
                area_m2=0.0,
                # A runway is among the least ambiguous things on a
                # chart, which is why these start high.
                score=4.6,
                pixels=0,
                name=row.name,
                extras={"cross_track_nm": cross, "along_track_nm": along, "source": "faa_apt"},
            )
        )
    return landmarks


def _ndjson(lines) -> StreamingResponse:
    """One JSON object per line, sent as each is produced. The headers keep
    any proxy in between (nginx, the Spring webapp) from buffering lines
    until the stream ends, which would defeat streaming entirely."""
    return StreamingResponse(
        lines, media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# One corridor detection per route, shared and remembered -- not one per
# request. Reading the chart is the most CPU-expensive thing this service
# does (a mosaic build plus numpy segmentation per block, ~40 blocks on a
# 300 nm route), and it used to run from scratch on every single Label
# page load: open the page five times, pay for five full corridor reads,
# each grinding on in its worker thread long after its own client had
# navigated away. That pile-up is what pegged this service's CPU for
# minutes with no traffic at all. Now the first request starts one
# background job, every concurrent request follows the same job's blocks
# as they land, and later requests replay the finished result until the
# TTL says the chart is worth re-reading.
_DETECT_TTL_S = 3600
_DETECT_JOBS: dict = {}
_DETECT_JOBS_GUARD = threading.Lock()


def _detect_job(key: tuple, start: tuple, end: tuple, half_width_nm: float) -> dict:
    with _DETECT_JOBS_GUARD:
        job = _DETECT_JOBS.get(key)
        if job is not None:
            fresh = not job["done"] or (time.time() - job["at"]) < _DETECT_TTL_S
            if fresh and job["error"] is None:
                return job
        # Stale entries for other routes cost nothing to keep except
        # memory; prune the finished ones while we're holding the lock
        # anyway so the dict tracks routes actually in use.
        for k in [k for k, j in _DETECT_JOBS.items() if j["done"] and (time.time() - j["at"]) >= _DETECT_TTL_S]:
            del _DETECT_JOBS[k]
        job = {
            "blocks": [], "done": False, "error": None,
            "at": time.time(), "cond": threading.Condition(),
        }
        _DETECT_JOBS[key] = job
        threading.Thread(
            target=_run_detect, args=(job, start, end, half_width_nm), daemon=True,
        ).start()
        return job


def _run_detect(job: dict, start: tuple, end: tuple, half_width_nm: float) -> None:
    """The corridor read itself, off on its own thread so it finishes
    (and caches) once regardless of how many clients started, followed
    or abandoned it. Dedupe lives here, not per-request: blocks overlap
    by a column so a feature on a seam is seen whole by one of them,
    which means the same feature is detected twice -- streaming showed
    350 candidates against the batched path's 288 before this."""
    try:
        emitted: list = []
        for batch in chartvision.iter_landmarks_along_route(
            start, end, half_width_nm=half_width_nm
        ):
            fresh = []
            for landmark in batch["landmarks"]:
                if any(
                    other.category == landmark.category
                    and geo.distance_nm(other.lat, other.lon, landmark.lat, landmark.lon)
                    < chartvision.DEDUPE_NM
                    for other in emitted
                ):
                    continue
                emitted.append(landmark)
                fresh.append(landmark)
            with job["cond"]:
                job["blocks"].append({
                    "block": batch["block"], "blocks": batch["blocks"],
                    "tiles": batch["tiles"], "missing": batch["missing"],
                    "landmarks": fresh,
                })
                job["cond"].notify_all()
        with job["cond"]:
            job["done"] = True
            job["at"] = time.time()
            job["cond"].notify_all()
    except Exception as err:  # noqa: BLE001 -- carried to every follower verbatim
        with job["cond"]:
            job["error"] = f"{type(err).__name__}: {err}"
            job["done"] = True
            job["cond"].notify_all()


@app.get("/api/detect/stream")
def detect_stream(dep: str, dest: str, half_width_nm: float = 4.0) -> StreamingResponse:
    """Detections as newline-delimited JSON, one line per block.

    Same work as /api/detect, handed over as it is produced instead of
    after all of it. Blocks advance along the course, so the map fills
    from the departure end and a pilot can start judging the first thirty
    miles while the rest of the corridor is still being read. Airports
    come first, in their own line, because they are a local file lookup
    and cost nothing to produce.

    The landmarks come from the shared per-route job above; only the
    pick-matching is per-request, because picks change between requests
    and the chart does not.
    """
    dep_ident, dest_ident = _route_key(dep, dest)
    dep_airport, dest_airport = _resolve(dep_ident, dest_ident)
    start = (dep_airport["lat"], dep_airport["lon"])
    end = (dest_airport["lat"], dest_airport["lon"])
    route = chartlabels.route_key(dep_ident, dest_ident)

    # Picks are claimed as blocks arrive, each by the nearest landmark it
    # has not already been claimed by. find_existing per landmark was
    # wrong the same way /api/detect was: it let one pick mark two
    # neighbouring detections as rated, and left picks whose detection
    # has moved out of range with no marker at all.
    unclaimed = {id(p): p for p in chartlabels.load_picks(route)}

    def as_detection(landmark) -> dict:
        best, best_nm = None, chartlabels.SAME_PLACE_NM
        for key, pick in unclaimed.items():
            gap = geo.distance_nm(pick["lat"], pick["lon"], landmark.lat, landmark.lon)
            if gap < best_nm:
                best, best_nm = key, gap
        pick = unclaimed.pop(best) if best is not None else None
        return {
            "lat": landmark.lat,
            "lon": landmark.lon,
            "category": landmark.category,
            "area_m2": round(landmark.area_m2, 1),
            "score": landmark.score,
            "along_track_nm": round(landmark.extras["along_track_nm"], 2),
            "cross_track_nm": round(landmark.extras["cross_track_nm"], 3),
            "rating": pick["rating"] if pick else None,
            "role": pick.get("role") if pick else None,
            "rated": pick is not None and pick["rating"] is not None,
        }

    job = _detect_job((route, half_width_nm), start, end, half_width_nm)

    def lines():
        # The picks cannot be sorted into matched and unmatched until
        # every block has been read, so they arrive at the end rather
        # than the start.
        yield json.dumps({"type": "start", "route": route}) + "\n"

        airports_found = _faa_airports(start, end, half_width_nm, dep_ident, dest_ident)
        yield json.dumps({
            "type": "block", "block": -1, "blocks": 0,
            "detections": [as_detection(a) for a in airports_found],
        }) + "\n"

        # Follow the shared job's blocks as they land -- instant when the
        # corridor was already read, progressive when this request is the
        # one (or one of the ones) waiting on a fresh read.
        seen, at = 0, 0
        while True:
            with job["cond"]:
                job["cond"].wait_for(lambda: len(job["blocks"]) > at or job["done"])
                fresh_blocks = job["blocks"][at:]
                done, error = job["done"], job["error"]
            at += len(fresh_blocks)
            for block in fresh_blocks:
                seen += len(block["landmarks"])
                yield json.dumps({
                    "type": "block",
                    "block": block["block"],
                    "blocks": block["blocks"],
                    "tiles": block["tiles"],
                    "missing": block["missing"],
                    "detections": [as_detection(landmark) for landmark in block["landmarks"]],
                }) + "\n"
            if done and at >= len(job["blocks"]):
                if error is not None:
                    # Same outcome an in-generator exception always had
                    # here: the stream truncates. The job records it so
                    # every follower fails the same way, not just the
                    # request that happened to run the corridor read.
                    raise RuntimeError(f"corridor detection failed: {error}")
                break

        # Whatever no landmark claimed: the detector's misses, plus picks
        # that have drifted apart from the detection they were made
        # against. Each carries rated derived from its own rating, so a
        # rated point cannot describe itself as unrated.
        yield json.dumps({
            "type": "done",
            "total": seen,
            "added": [
                {**pick, "rated": pick["rating"] is not None,
                 "area_m2": pick.get("area_m2") or 0.0}
                for pick in unclaimed.values()
            ],
            "summary": chartlabels.summarise(route),
        }) + "\n"

    # Buffering off: a proxy holding these until the generator finishes
    # would defeat the entire point of streaming them.
    return _ndjson(lines())


# ---------------------------------------------------------------------
# The plan, in the three pieces it naturally falls into. /api/plan still
# returns all of it at once for anything that wants one call, but a page
# should ask for these in order: the course draws immediately, the
# checkpoints land a tenth of a second later, and the nav log -- which
# needs terrain, obstacles, airspace and weather -- arrives when it can
# without holding up the map.
# ---------------------------------------------------------------------


@app.get("/api/checkpoints")
def checkpoints(dep: str, dest: str) -> dict:
    """Scored candidates and the subset worth flying. Fast: the model is
    already loaded and the features are already built."""
    dep_ident, dest_ident = _route_key(dep, dest)
    dep_airport, dest_airport = _resolve(dep_ident, dest_ident)
    start = (dep_airport["lat"], dep_airport["lon"])
    end = (dest_airport["lat"], dest_airport["lon"])

    scored = _score(dep_ident, dest_ident)
    selected = checkpoint_selection.select_checkpoints(scored)
    keys = {(c["osm_id"], c["category"]) for c in selected}
    for c in scored:
        c["selected"] = (c["osm_id"], c["category"]) in keys
    return {
        "departure": {"ident": dep_ident, "name": dep_airport["name"], "lat": start[0], "lon": start[1]},
        "destination": {"ident": dest_ident, "name": dest_airport["name"], "lat": end[0], "lon": end[1]},
        "candidates": scored,
        "selected": selected,
    }


@app.get("/api/navlog")
def navlog_only(
    dep: str,
    dest: str,
    altitude_ft: float | None = None,
    aircraft: str = DEFAULT_AIRCRAFT,
) -> StreamingResponse:
    """Altitude and the dead-reckoning legs, as newline-delimited JSON --
    the slow half, because it reads terrain, the obstacle file, the
    airspace shapefile and live winds; asked for separately so none of
    that delays the chart.

    Streamed rather than a single blocking response so a pilot sees
    the table fill in as it goes rather than a blank screen: a "stage"
    line before each real piece of work (scoring, altitude selection,
    the live aviationweather.gov fetch), an "altitude" line the moment
    that's decided, one "leg" line per leg as each is actually
    computed (so the checkpoints already on screen from
    /api/checkpoints get their dead-reckoning numbers one row at a
    time instead of all 21 waiting on the last one), then one "done"
    line with the totals, which need every leg in before they mean
    anything. This is its own
    implementation, not a thin wrapper over /api/plan (a separate,
    documented endpoint "for non-browser callers") -- that one commits
    to a single synchronous JSON response and has its own callers to
    keep that promise to, and mixing a streaming and a non-streaming
    contract into one function would compromise both. The overlap
    (scored candidates, altitude selection, the leg loop) is the same
    handful of vfr calls either way; only how the result gets back to
    the caller differs.

    An unflyable route (no legal cruising altitude at all) is reported
    as an "error" line, not an HTTP error status -- by the time that's
    known, a 200 and a stream of NDJSON have already gone out, and an
    HTTP status can't change after that.
    """
    dep_ident, dest_ident = _route_key(dep, dest)
    dep_airport, dest_airport = _resolve(dep_ident, dest_ident)
    start = (dep_airport["lat"], dep_airport["lon"])
    end = (dest_airport["lat"], dest_airport["lon"])

    def lines():
        yield json.dumps({"type": "stage", "detail": "Scoring checkpoints…"}) + "\n"
        scored = _score(dep_ident, dest_ident)
        selected = checkpoint_selection.select_checkpoints(scored)

        profile = aircraft_module.load_aircraft_profile(aircraft)

        nav_altitude_ft = altitude_ft
        altitude_selection = None
        if nav_altitude_ft is None:
            yield json.dumps({
                "type": "stage",
                "detail": "Selecting a cruise altitude (terrain, obstacles, airspace)…",
            }) + "\n"
            # On a side thread with a heartbeat, not inline: an uncached
            # selection on a bad aviationweather.gov day was observed
            # taking over two minutes, all of it silent -- and the
            # webapp proxy cuts a stream that has been silent that long,
            # so the browser saw the nav log simply end with no legs and
            # no error. A stage line every few seconds keeps the
            # connection visibly alive (and tells the pilot what it's
            # still waiting on) for however long the fetch takes.
            with ThreadPoolExecutor(max_workers=1) as altitude_pool:
                future = altitude_pool.submit(_cruise_altitude, start, end, profile, aircraft)
                while True:
                    try:
                        altitude_selection = future.result(timeout=8)
                        break
                    except FuturesTimeoutError:
                        yield json.dumps({
                            "type": "stage",
                            "detail": "Selecting a cruise altitude (still waiting on aviationweather.gov)…",
                        }) + "\n"
            nav_altitude_ft = altitude_selection.get("recommended_ft")
            if nav_altitude_ft is None:
                yield json.dumps({"type": "error", "detail": _no_altitude_detail(altitude_selection)}) + "\n"
                return

        # Sent the moment it's decided, well before any leg -- the
        # checkpoints already on screen from /api/checkpoints can show
        # their own cruise altitude immediately rather than waiting on
        # the first leg to carry it.
        yield json.dumps({
            "type": "altitude",
            "altitude_ft": nav_altitude_ft,
            "altitude_selection": altitude_selection,
            "aircraft": {"name": aircraft, **profile},
        }) + "\n"

        fixes = _fixes(dep_ident, dest_ident, start, end, selected)
        yield json.dumps({
            "type": "stage", "detail": "Fetching winds aloft from aviationweather.gov…",
        }) + "\n"
        legs = []
        for a, b in pairwise(fixes):
            leg = _assemble_leg(a, b, nav_altitude_ft, profile)
            legs.append(leg)
            # The first leg's own wind lookup is the one that actually
            # pays for the aviationweather.gov round trip (later legs
            # hit vfr.weather's own 15-minute cache) -- yielding this
            # leg right away, rather than batching all of them into the
            # final "done" line, is most of why this streams at all.
            yield json.dumps({"type": "leg", **leg}) + "\n"

        yield json.dumps({"type": "done", "totals": _totals(legs)}) + "\n"

    return _ndjson(lines())


# ---------------------------------------------------------------------
# The Flight Briefing page: adverse conditions, current conditions,
# forecast, and airport/frequency info around the nav log -- the FAA's
# own standard-briefing sequence (AIM/FAA-H-8083-25), minus the two
# pieces this service has no real source for: NOTAMs (the official FAA
# NOTAM API is gated to certain commercial/public operators, emailed
# credentials only -- the page links out to a real briefing service
# instead of faking data) and a synoptic narrative (needs real
# meteorological analysis, not a data fetch).
#
# One plain synchronous response, not a stream like /api/navlog: every
# piece here is one quick independent call (hazards, forecast, METAR,
# runways/frequencies), not the slow per-leg loop that justified
# streaming there. "Independent" is also why they run concurrently,
# not one after another -- three separate blocking round trips to
# aviationweather.gov, summed instead of overlapped, was the whole
# reason this page felt slow to open even though no single piece
# actually is.
# ---------------------------------------------------------------------


@app.get("/api/briefing")
def briefing(dep: str, dest: str) -> dict:
    """Everything the nav log's own leg math doesn't cover: adverse
    conditions (SIGMET/AIRMET), current conditions (METAR) and
    forecast (TAF-derived ceiling/visibility) along the route, and
    each airport's runways and radio frequencies.
    """
    dep_ident, dest_ident = _route_key(dep, dest)
    dep_airport, dest_airport = _resolve(dep_ident, dest_ident)
    start = (dep_airport["lat"], dep_airport["lon"])
    end = (dest_airport["lat"], dest_airport["lon"])

    # Runways/frequencies are in this pool too, not just the three
    # weather calls -- on a freshly started container (an empty
    # in-memory table cache, see vfr.airports._TABLE_CACHE) those are
    # each a multi-megabyte CSV parse, the same order of cost as a
    # weather round trip, and were previously paying that cost after
    # the weather pool had already finished instead of alongside it.
    with ThreadPoolExecutor(max_workers=7) as pool:
        hazards_future = pool.submit(weather.hazards_along_route, start, end)
        forecast_future = pool.submit(weather.ceiling_visibility_along_route, start, end)
        metars_future = pool.submit(weather.metar_for_idents, [dep_ident, dest_ident])
        runways = {ident: pool.submit(airports.get_runways, ident) for ident in (dep_ident, dest_ident)}
        frequencies = {ident: pool.submit(airports.get_frequencies, ident) for ident in (dep_ident, dest_ident)}

        # Same reasoning as vfr.altitude.select_cruise_altitude: these are
        # three independent live aviationweather.gov calls, and a transient
        # failure on any one of them (a 504 on a slow bbox query, observed
        # 2026-09-18) used to take the whole briefing down even though the
        # other two -- plus runways/frequencies, unaffected local lookups --
        # had already succeeded. Each is now caught on its own and recorded
        # in weather_unavailable, so the page can say "hazards unavailable"
        # instead of failing to load at all.
        weather_unavailable = []
        try:
            hazards = hazards_future.result()
        except weather.WeatherServiceError:
            hazards = []
            weather_unavailable.append("hazards")
        try:
            forecast = forecast_future.result()
        except weather.WeatherServiceError:
            forecast = {"min_ceiling_ft": None, "min_visibility_sm": None, "stations": []}
            weather_unavailable.append("forecast")
        try:
            metars = metars_future.result()
        except weather.WeatherServiceError:
            metars = {ident: None for ident in (dep_ident, dest_ident)}
            weather_unavailable.append("metars")
        runways = {ident: f.result() for ident, f in runways.items()}
        frequencies = {ident: f.result() for ident, f in frequencies.items()}

    return {
        "hazards": hazards,
        "forecast": forecast,
        "metars": metars,
        "weather_unavailable": weather_unavailable,
        "airports": {
            ident: {"runways": runways[ident], "frequencies": frequencies[ident]}
            for ident in (dep_ident, dest_ident)
        },
    }


# ---------------------------------------------------------------------
# Per-checkpoint identification notes: a short, pilot-facing "how to
# spot it" sentence, streamed one checkpoint at a time rather than
# making the whole nav log wait on N sequential LLM calls. Persisted
# separately from chart_picks.csv (that file is ML training data);
# this is an operational annotation a pilot edits, not a label.
# ---------------------------------------------------------------------


class CheckpointNote(BaseModel):
    departure_ident: str
    destination_ident: str
    lat: float
    lon: float
    description: str


def _describe_checkpoint(
    checkpoint: dict, dep_ident: str, prev_name: str | None, next_name: str | None,
) -> str:
    """One Claude call, one checkpoint. The prompt is deliberately
    told not to invent geographic specifics it cannot know: the
    checkpoint data reaching this service is a lat/lon point plus a
    category and an optional OSM name -- no polygon or shoreline
    survives the pipeline this far, so a claim like "the east shore"
    would be a guess dressed as a fact.
    """
    name = checkpoint.get("name") or checkpoint["category"]
    prompt = (
        "In one short sentence (under 20 words), describe exactly where a "
        "VFR pilot should look to positively identify this checkpoint from "
        "the air, so they know they're at the right spot and not somewhere "
        "similar-looking nearby.\n\n"
        f"Checkpoint: {name}, category \"{checkpoint['category']}\".\n"
        f"{checkpoint['along_track_nm']:.1f} nm along the route from {dep_ident}.\n"
        f"Previous checkpoint: {prev_name or 'none (departure)'}\n"
        f"Next checkpoint: {next_name or 'none (destination)'}\n\n"
        "If you don't have specific knowledge of this named feature's "
        "actual shape or layout, say only what's safely inferable from its "
        "category and position -- don't invent specific geographic "
        "details (which shore, which bend) you can't know."
    )
    resp = anthropic.Anthropic().messages.create(
        model=CHECKPOINT_NOTE_MODEL,
        max_tokens=128,
        messages=[{"role": "user", "content": prompt}],
    )
    return resp.content[0].text.strip()


@app.get("/api/checkpoint-notes")
def describe_checkpoints(
    dep: str,
    dest: str,
    altitude_ft: float | None = None,
    aircraft: str = DEFAULT_AIRCRAFT,
) -> StreamingResponse:
    """One "how to spot it" line per checkpoint, as newline-delimited
    JSON -- the same streaming shape /api/detect/stream already
    proves end-to-end, reused here so a slow LLM call on checkpoint 3
    does not hold up checkpoints 1 and 2 that already arrived.

    Two different kinds of failure, reported two different ways. A
    single checkpoint's own LLM call failing for a reason specific to
    it does not take the rest of the stream down -- every other
    checkpoint is independent and still worth generating, so that one
    gets its own per-checkpoint "error" line and the loop moves on.
    GLOBAL_ANTHROPIC_ERRORS is the opposite case: a bad key or an
    exhausted rate limit fails identically for every checkpoint, so
    it's reported once as a single stream-level "error" (for one
    banner instead of the same text repeated per row) -- but the
    stream itself keeps going: every remaining checkpoint still gets
    its own per-checkpoint "error" line too, just without spending a
    call to learn what's already known. A pilot still gets a row to
    type a note into for every checkpoint, not just the ones that
    happened to come before the failure.
    """
    dep_ident, dest_ident = _route_key(dep, dest)
    scored = _score(dep_ident, dest_ident)
    selected = checkpoint_selection.select_checkpoints(scored)  # already along-track order
    route = checkpoint_notes.route_key(dep_ident, dest_ident)
    existing = checkpoint_notes.load_notes(route)

    def checkpoint_line(cp: dict, description: str | None, source: str, detail: str | None = None) -> str:
        line = {
            "type": "checkpoint",
            "lat": cp["lat"], "lon": cp["lon"], "osm_id": cp["osm_id"],
            "description": description, "source": source,
        }
        if detail is not None:
            line["detail"] = detail
        return json.dumps(line) + "\n"

    def lines():
        yield json.dumps({"type": "start", "count": len(selected)}) + "\n"
        global_error: str | None = None
        for i, cp in enumerate(selected):
            saved = checkpoint_notes.find_note(existing, cp["lat"], cp["lon"])
            if saved is not None:
                yield checkpoint_line(cp, saved["description"], "saved")
                continue
            if global_error is not None:
                yield checkpoint_line(cp, None, "error", global_error)
                continue
            try:
                prev = selected[i - 1] if i > 0 else None
                prev_name = (prev["name"] or prev["category"]) if prev else None
                next_cp = selected[i + 1] if i + 1 < len(selected) else None
                next_name = (next_cp["name"] or next_cp["category"]) if next_cp else None
                description = _describe_checkpoint(cp, dep_ident, prev_name, next_name)
                checkpoint_notes.save_note(route, cp["lat"], cp["lon"], description)
            except GLOBAL_ANTHROPIC_ERRORS as err:
                global_error = str(err)
                yield json.dumps({"type": "error", "detail": global_error}) + "\n"
                yield checkpoint_line(cp, None, "error", global_error)
                continue
            except Exception as err:  # noqa: BLE001 -- one bad LLM call must not stop the rest
                yield checkpoint_line(cp, None, "error", str(err))
                continue
            yield checkpoint_line(cp, description, "generated")
        yield json.dumps({"type": "done"}) + "\n"

    return _ndjson(lines())


@app.post("/api/checkpoint-notes")
def save_checkpoint_note(note: CheckpointNote) -> dict:
    """A pilot's own edit to a checkpoint's identification note --
    replaces whatever was saved at that place, generated or not."""
    if not note.description.strip():
        raise HTTPException(422, "description must not be empty")
    dep_ident, dest_ident = _route_key(note.departure_ident, note.destination_ident)
    route = checkpoint_notes.route_key(dep_ident, dest_ident)
    saved = checkpoint_notes.save_note(route, note.lat, note.lon, note.description.strip())
    return {"ok": True, "note": saved}
