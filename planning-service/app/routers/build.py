"""Collecting a corridor that has no feature store yet: minutes of
Overpass, FAA and elevation I/O, run on a background thread and polled
by job id. In-process rather than as a pipeline container, because
launching one would mean handing this service the Docker socket -- a
much larger grant than it needs. The same vfr.pipeline functions the
Airflow DAG calls, so there is one implementation, not two."""
import threading
import traceback
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from vfr import pipeline

from ..common import paths, resolve, route_key

router = APIRouter()

# job id -> {"state": queued|running|done|failed, "step", "detail", ...}
# In-memory on purpose: a build is only meaningful to the page that
# started it, and a restart should forget a half-finished one rather than
# resume something whose partial output is already on disk.
_builds: dict = {}
_builds_lock = threading.Lock()


class BuildRequest(BaseModel):
    departure_ident: str
    destination_ident: str


def interrupt_running() -> None:
    """Called from the app's shutdown hook. It can't save a build's
    in-memory progress across the restart that's about to happen, but it
    closes the narrow window where a load balancer still routing a
    drained connection's GET /api/build/{job_id} would otherwise see a
    "running" job simply vanish with no explanation."""
    with _builds_lock:
        for job in _builds.values():
            if job["state"] in ("queued", "running"):
                job.update(state="failed", step="failed", detail="interrupted by service shutdown")


def _run_build(job_id: str, dep: str, dest: str) -> None:
    candidates_path, features_path = paths(dep, dest)

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


@router.post("/api/build")
def build(request: BuildRequest) -> dict:
    """Start collecting a corridor. Returns a job id to poll.

    Asynchronous because this is minutes of network I/O -- Overpass, the
    FAA subscription, and an elevation lookup per candidate -- not
    something to hold an HTTP request open for.
    """
    dep, dest = route_key(request.departure_ident, request.destination_ident)
    resolve(dep, dest)
    if dep == dest:
        raise HTTPException(422, "Departure and destination are the same airport")

    _, features_path = paths(dep, dest)
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


@router.get("/api/build/{job_id}")
def build_status(job_id: str) -> dict:
    with _builds_lock:
        job = _builds.get(job_id)
    if job is None:
        raise HTTPException(404, f"No build job {job_id}")
    return {"job_id": job_id, **job}
