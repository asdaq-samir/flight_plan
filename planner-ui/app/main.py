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
import os
import threading
import traceback
import uuid
from pathlib import Path

import requests
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from vfr import aircraft as aircraft_module
from vfr import airports, altitude as altitude_module, checkpoints as checkpoint_selection
from vfr import chartlabels, chartvision, faa_data, geo, navlog, pipeline
from vfr.config import (
    DATA_DIR,
    FAA_VFR_SECTIONAL_URL,
    VFR_SECTIONAL_MAX_ZOOM,
    VFR_SECTIONAL_MIN_ZOOM,
)

MODEL_SERVICE_URL = os.environ.get("MODEL_SERVICE_URL", "http://model-service:8000")
PROCESSED_DIR = DATA_DIR / "processed"
DEFAULT_AIRCRAFT = "c172"

app = FastAPI(title="vfr-route planner")



# The React build. Served here while the port is in progress so the pages
# it replaces stay reachable and can be compared against it; when Spring
# Boot becomes the public surface this is the only part that moves.
_WEB = Path(__file__).resolve().parent / "web"
if _WEB.exists():
    app.mount("/app/assets", StaticFiles(directory=_WEB / "assets"), name="web-assets")

    @app.get("/app/{path:path}")
    def spa(path: str) -> FileResponse:
        """Any /app route serves the bundle.

        Routing happens in the browser, so /app/label is not a file and
        StaticFiles would 404 it. Real files under /app/assets are mounted
        above and never reach here.
        """
        return FileResponse(_WEB / "index.html")

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
def index() -> RedirectResponse:
    """The planner now lives in the bundle. Redirected rather than
    removed so an existing bookmark still lands somewhere."""
    return RedirectResponse("/app/plan")


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
        "tile_url": FAA_VFR_SECTIONAL_URL,
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


@app.get("/label")
def label_page() -> RedirectResponse:
    """Likewise -- /label was the labeling page's address for long enough
    that it is worth keeping as a redirect."""
    return RedirectResponse("/app/label")


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
        "departure": {"ident": dep_ident, "name": dep_airport["name"], "lat": start[0], "lon": start[1]},
        "destination": {"ident": dest_ident, "name": dest_airport["name"], "lat": end[0], "lon": end[1]},
        "distance_nm": round(geo.distance_nm(start[0], start[1], end[0], end[1]), 1),
        "bearing_deg": round(geo.bearing_deg(start[0], start[1], end[0], end[1])),
        "course_line": _course_line(start, end),
        "tile_url": FAA_VFR_SECTIONAL_URL,
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


@app.get("/api/detect/stream")
def detect_stream(dep: str, dest: str, half_width_nm: float = 4.0) -> StreamingResponse:
    """Detections as newline-delimited JSON, one line per block.

    Same work as /api/detect, handed over as it is produced instead of
    after all of it. Blocks advance along the course, so the map fills
    from the departure end and a pilot can start judging the first thirty
    miles while the rest of the corridor is still being read. Airports
    come first, in their own line, because they are a local file lookup
    and cost nothing to produce.
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

        # Blocks overlap by a column so a feature on a seam is seen whole
        # by one of them, which means the same feature arrives twice.
        # The batched path dedupes at the end; a stream has to do it as it
        # goes or the duplicates are already on the map. Streaming
        # produced 350 candidates against the batched 288 before this.
        emitted, seen = [], 0
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
            seen += len(fresh)
            yield json.dumps({
                "type": "block",
                "block": batch["block"],
                "blocks": batch["blocks"],
                "tiles": batch["tiles"],
                "missing": batch["missing"],
                "detections": [as_detection(l) for l in fresh],
            }) + "\n"

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
    return StreamingResponse(
        lines(), media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
) -> dict:
    """Altitude and the dead-reckoning legs. The slow half, because it
    reads terrain, the obstacle file, the airspace shapefile and live
    winds; asked for separately so none of that delays the chart."""
    plan_result = plan(dep=dep, dest=dest, altitude_ft=altitude_ft, aircraft=aircraft)
    return {
        "legs": plan_result["legs"],
        "totals": plan_result["totals"],
        "altitude_ft": plan_result["altitude_ft"],
        "altitude_selection": plan_result["altitude_selection"],
        "aircraft": plan_result["aircraft"],
    }
