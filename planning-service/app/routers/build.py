"""Collecting a corridor that has no feature store yet: minutes of
Overpass, FAA and elevation I/O, run on a background thread and polled
by job id. In-process rather than as a pipeline container, because
launching one would mean handing this service the Docker socket -- a
much larger grant than it needs. The same vfr.pipeline functions the
Airflow DAG calls, so there is one implementation, not two.

One build runs at a time, from a short queue. Each used to get a thread
of its own, so a caller could start as many as it had airport pairs --
each hammering Overpass, which rate-limits or bans the address -- and
the job table only ever grew."""
import logging
import queue
import threading
import time
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from vfr import pipeline

from ..common import paths, resolve, route_key
from ..schemas import BuildJob

log = logging.getLogger(__name__)

router = APIRouter()

#: Builds waiting behind the running one. A request past this is told to
#: come back rather than queued without bound.
MAX_QUEUED = 3
#: How long a finished job stays pollable before it is forgotten.
KEEP_FINISHED_S = 3600

# job id -> {"state": queued|running|done|failed, "step", "detail", "route", "finished"}
_builds: dict = {}
_builds_lock = threading.Lock()
_queue: queue.Queue = queue.Queue()
_worker: threading.Thread | None = None


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


def _forget_finished(now: float) -> None:
    """Drop jobs that finished more than KEEP_FINISHED_S ago. Call under
    _builds_lock."""
    for job_id in [j for j, b in _builds.items() if b.get("finished") and now - b["finished"] > KEEP_FINISHED_S]:
        del _builds[job_id]


def _run_build(job_id: str, dep: str, dest: str) -> None:
    candidates_path, features_path = paths(dep, dest)

    def step(name: str) -> None:
        with _builds_lock:
            _builds[job_id]["step"] = name

    with _builds_lock:
        _builds[job_id].update(state="running", step="starting")
    try:
        step("collecting candidates (Overpass + FAA)")
        pipeline.collect(dep_ident=dep, dest_ident=dest, out_path=candidates_path)
        step("engineering features (elevation lookups)")
        pipeline.engineer_features(in_path=candidates_path, out_path=features_path)
        with _builds_lock:
            _builds[job_id].update(state="done", step="ready", detail=None, finished=time.time())
    except Exception as err:  # noqa: BLE001 -- surfaced to the caller as one line
        # The traceback goes to the log, not the response: it names the
        # service's own files and paths, which are no caller's business.
        log.exception("building %s->%s failed", dep, dest)
        with _builds_lock:
            _builds[job_id].update(
                state="failed", step="failed", detail=f"{type(err).__name__}: {err}", finished=time.time(),
            )


def _work(jobs: queue.Queue) -> None:
    while True:
        job_id, dep, dest = jobs.get()
        try:
            with _builds_lock:
                cancelled = _builds.get(job_id, {}).get("state") != "queued"
            if not cancelled:
                _run_build(job_id, dep, dest)
        finally:
            jobs.task_done()


def _ensure_worker() -> None:
    global _worker
    if _worker is None or not _worker.is_alive():
        _worker = threading.Thread(target=_work, args=(_queue,), name="corridor-builds", daemon=True)
        _worker.start()


@router.post("/api/build")
def build(request: BuildRequest) -> BuildJob:
    """Queue collecting a corridor. Returns a job id to poll.

    Asynchronous because this is minutes of network I/O -- Overpass, the
    FAA subscription, and an elevation lookup per candidate -- not
    something to hold an HTTP request open for. A route already queued
    or building answers with that job; a full queue is a 429.
    """
    dep, dest = route_key(request.departure_ident, request.destination_ident)
    resolve(dep, dest)
    if dep == dest:
        raise HTTPException(422, "Departure and destination are the same airport")
    _, features_path = paths(dep, dest)
    if features_path.exists():
        return {"job_id": None, "state": "done", "step": "already built"}

    route = f"{dep}->{dest}"
    with _builds_lock:
        _forget_finished(time.time())
        pending = {j: b for j, b in _builds.items() if b["state"] in ("queued", "running")}
        for job_id, job in pending.items():
            if job["route"] == route:
                return {"job_id": job_id, "state": job["state"], "step": job["step"], "route": route}
        if sum(1 for b in pending.values() if b["state"] == "queued") >= MAX_QUEUED:
            raise HTTPException(429, f"{MAX_QUEUED} corridors are already waiting to be built -- try again in a few minutes")
        job_id = uuid.uuid4().hex[:12]
        _builds[job_id] = {"state": "queued", "step": "waiting for the builds ahead of it", "route": route, "detail": None}
    _queue.put((job_id, dep, dest))
    _ensure_worker()
    return {"job_id": job_id, "state": "queued", "step": _builds[job_id]["step"], "route": route}


@router.get("/api/build/{job_id}")
def build_status(job_id: str) -> BuildJob:
    with _builds_lock:
        _forget_finished(time.time())
        job = _builds.get(job_id)
        if job is None:
            raise HTTPException(404, f"No build job {job_id}")
        return {"job_id": job_id, **{k: v for k, v in job.items() if k != "finished"}}
