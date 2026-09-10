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
import os
import threading
import traceback
import uuid
from pathlib import Path

import requests
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from vfr import aircraft as aircraft_module
from vfr import airports, altitude as altitude_module, checkpoints as checkpoint_selection
from vfr import geo, labeling, navlog, pipeline
from vfr.config import DATA_DIR

MODEL_SERVICE_URL = os.environ.get("MODEL_SERVICE_URL", "http://model-service:8000")
PROCESSED_DIR = DATA_DIR / "processed"
DEFAULT_AIRCRAFT = "c172"

app = FastAPI(title="vfr-route planner")

_INDEX = Path(__file__).resolve().parent / "index.html"

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
def index() -> FileResponse:
    return FileResponse(_INDEX)


@app.get("/api/routes")
def built_routes() -> dict:
    """Corridors model-service already has a feature store for."""
    try:
        return requests.get(f"{MODEL_SERVICE_URL}/routes", timeout=10).json()
    except requests.RequestException as err:
        raise HTTPException(502, f"Could not reach model-service: {err}") from err


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


def _score(dep: str, dest: str) -> list:
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
    return resp.json()["checkpoints"]


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
        altitude_selection = altitude_module.select_cruise_altitude(start, end, profile)
        altitude_ft = altitude_selection.get("recommended_ft")
        if altitude_ft is None:
            raise HTTPException(
                422,
                "No legal VFR cruising altitude exists for this route and aircraft "
                f"(floor {altitude_selection.get('floor_ft')} ft, ceiling "
                f"{altitude_selection.get('band_ceiling_ft')} ft). Supply altitude_ft "
                "explicitly to plan anyway.",
            )

    # The nav log flies departure -> checkpoints -> destination. The
    # airports are the ends of the flight, so they bound the legs even
    # though neither is a checkpoint candidate.
    fixes = (
        [{"name": dep_ident, "category": "departure", "lat": start[0], "lon": start[1]}]
        + selected
        + [{"name": dest_ident, "category": "destination", "lat": end[0], "lon": end[1]}]
    )
    legs = []
    for a, b in zip(fixes, fixes[1:]):
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
            if leg[field] in (float("inf"), float("-inf")) or leg[field] != leg[field]:
                leg[field] = None
        legs.append(leg)

    def _total(field: str):
        values = [l[field] for l in legs if l[field] is not None]
        return round(sum(values), 1) if len(values) == len(legs) else None

    return {
        "departure": {"ident": dep_ident, "name": dep_airport["name"], "lat": start[0], "lon": start[1]},
        "destination": {"ident": dest_ident, "name": dest_airport["name"], "lat": end[0], "lon": end[1]},
        "distance_nm": round(geo.distance_nm(start[0], start[1], end[0], end[1]), 1),
        "course_line": _course_line(start, end),
        "candidates": scored,
        "selected": selected,
        "legs": legs,
        "totals": {
            "distance_nm": round(sum(l["distance_nm"] for l in legs), 1),
            # None rather than a wrong number if any leg is unflyable:
            # silently summing the flyable ones would understate the trip.
            "ete_min": _total("ete_min"),
            "fuel_gal": _total("fuel_gal"),
            "unflyable_legs": sum(1 for l in legs if l["ete_min"] is None),
            # Surfaced rather than averaged away: a leg with no nearby
            # winds-aloft station is a no-wind-data estimate, not a calm
            # one, and a pilot should know which legs those are.
            "legs_without_wind": sum(1 for l in legs if l.get("wind") is None),
        },
        "altitude_ft": altitude_ft,
        "altitude_selection": altitude_selection,
        "aircraft": {"name": aircraft, **profile},
        "tile_url": labeling.FAA_VFR_SECTIONAL_URL,
        "max_zoom": labeling.VFR_SECTIONAL_MAX_ZOOM,
        "min_zoom": labeling.VFR_SECTIONAL_MIN_ZOOM,
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
