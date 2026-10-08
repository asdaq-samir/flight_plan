"""The planner's side of the chart model (vfr.chartmodel): the table it
trains on, whether the ratings are enough for it, and its scores for the
training page's points, from model-service, which serves it.

Here rather than in the pipeline because the planner holds the chart
reader -- the pipeline images have no GDAL -- and has every rated
route's corridor read already, kept on disk (app.detection)."""
import logging
import multiprocessing
import os
import threading
import time
from concurrent.futures import Future, ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool

import pandas as pd
from vfr import chartfeatures, chartlabels, chartmodel, model_client
from vfr.pipeline import _publish

from . import chart_reader, detection
from .common import load_hop
from .detection import detect_job, faa_airports

# How far either side of the course the training page reads the chart:
# its points, which its ratings are made on and the model learns from.
# Here, not in app.detection, whose source names its kept reads -- a
# change there reads every corridor again.
TRAINING_HALF_WIDTH_NM = 4.0

log = logging.getLogger(__name__)

# A corridor not yet read is read in a process of its own, kept on disk
# there (app.detection), and loaded here from what it kept: read on one of
# this process's threads it held the interpreter for seconds at a time,
# and every other request waited -- an airspace card took 86 s while a
# route's chart was read (measured 2026-10-07). Two at once at the most.
# Off where CHART_READS_IN_PROCESS=0 (the tests, which stub the read).
READS_IN_PROCESS = os.environ.get("CHART_READS_IN_PROCESS", "1") != "0"
_PROCESSES: ProcessPoolExecutor | None = None
_READING: dict = {}
_READING_LOCK = threading.Lock()
# A pool with nothing to read for this long is let go (release_idle, from
# the planner's own loop): its processes keep what their last reads grew
# to -- 215 and 342 MB, seen 2026-10-07, beside a planner of 1 GB, on a
# machine whose browsers were being killed for memory. The next read
# starts them again, some 3 s of imports (app.chart_reader), under its 2
# to 8 s of reading: half an hour, so a pilot planning on and off does
# not pay it at every route.
IDLE_S = 1800
_LAST_READ = 0.0


def _pool() -> ProcessPoolExecutor:
    # Spawned, not forked: this process runs threads, and a fork copies
    # their locks held.
    return ProcessPoolExecutor(max_workers=2, mp_context=multiprocessing.get_context("spawn"))


def _reading(key: tuple, start: tuple, end: tuple) -> Future | None:
    """The read of a corridor neither in this process's memory nor kept on
    disk, started in the pool once however many ask; None where there is
    nothing to read (or the pool is not to be used)."""
    global _PROCESSES, _LAST_READ
    if not READS_IN_PROCESS or key in detection._DETECT_JOBS or detection._kept_path(key).exists():
        return None
    with _READING_LOCK:
        running = _READING.get(key)
        if running is not None and not running.done():
            return running
        if _PROCESSES is None:
            _PROCESSES = _pool()
        try:
            future = _PROCESSES.submit(chart_reader.read_corridor, key, start, end, TRAINING_HALF_WIDTH_NM)
        except BrokenProcessPool:
            # One of its processes died -- the kernel's out-of-memory killer
            # took one with the machine short of memory, 2026-10-07, where a
            # read of 1,457 nm peaks at 364 MB on its own -- and a pool with
            # a dead process takes no more work, ever: every route's
            # checkpoints failed after it. A new pool, for this read and the
            # ones after.
            log.warning("the chart reader's pool lost a process; starting a new one")
            _PROCESSES.shutdown(wait=False, cancel_futures=True)
            _PROCESSES = _pool()
            future = _PROCESSES.submit(chart_reader.read_corridor, key, start, end, TRAINING_HALF_WIDTH_NM)
        _READING[key] = future
        _LAST_READ = time.time()
        future.add_done_callback(_read_ended)
        return future


def _read_ended(_future: Future) -> None:
    global _LAST_READ
    _LAST_READ = time.time()


def release_idle(now: float | None = None) -> bool:
    """The pool's processes let go where none has read for IDLE_S; whether
    they were."""
    global _PROCESSES
    now = time.time() if now is None else now
    with _READING_LOCK:
        if _PROCESSES is None or now - _LAST_READ < IDLE_S or any(not f.done() for f in _READING.values()):
            return False
        _PROCESSES.shutdown(wait=False, cancel_futures=True)
        _PROCESSES = None
        _READING.clear()
        return True


def corridor_kept(route: str) -> bool:
    """Whether a route's corridor ("C81->KDLH") is read already, here or
    on disk: its checkpoints are a moment away, and the web app asks for
    no route as entered beside them (Course.checkpoints_ready)."""
    key = (route, TRAINING_HALF_WIDTH_NM)
    job = detection._DETECT_JOBS.get(key)
    if job is not None and job.get("done") and job.get("error") is None:
        return True
    return detection._kept_path(key).exists()


def corridor(route: str, wait: bool) -> list | None:
    """Every detection the training page shows along a route ("C81->KDLH"):
    its charted airports and what the reader found, at the page's own
    half-width -- so a pick claims what it was made on. None while the
    read is still going and `wait` is False; the job it asks for is the
    page's own, shared, so this starts no second read."""
    dep, dest = route.split("->")
    r = load_hop(dep, dest)
    key = (route, TRAINING_HALF_WIDTH_NM)
    # A read whose process died part way -- or another read's did, which
    # takes the pool and all its reads down with it -- once more, in the
    # new pool _reading starts; not here, where a read that ran a process
    # out of memory would take the planner with it.
    for tries in (1, 2):
        elsewhere = _reading(key, r.start, r.end)
        if elsewhere is None:
            break
        if not wait and not elsewhere.done():
            return None
        try:
            error = elsewhere.result()
        except BrokenProcessPool as err:
            log.warning("the chart reader stopped part way along %s (try %d)", route, tries)
            if tries == 2:
                raise RuntimeError(f"the chart along {route} could not be read: the reader stopped part way") from err
            continue
        except Exception as err:  # noqa: BLE001 -- the pool would not take it: read here instead, as before
            error = None
            log.warning("the chart along %s was not read in a process of its own: %s", route, err)
        if error is not None:
            raise RuntimeError(f"the chart along {route} could not be read: {error}")
        break
    job = detect_job(key, r.start, r.end, TRAINING_HALF_WIDTH_NM)
    with job["cond"]:
        if wait:
            job["cond"].wait_for(lambda: job["done"])
        if not job["done"]:
            return None
        if job["error"] is not None:
            raise RuntimeError(f"the chart along {route} could not be read: {job['error']}")
        blocks = list(job["blocks"])
    airports = faa_airports(r.start, r.end, TRAINING_HALF_WIDTH_NM, r.dep_ident, r.dest_ident)
    return airports + [landmark for block in blocks for landmark in block["landmarks"]]


def _rated_by_route() -> dict[str, list]:
    by_route: dict[str, list] = {}
    for pick in chartlabels.load_picks():
        if pick.get("rating") is not None:
            by_route.setdefault(pick["route"], []).append(pick)
    return by_route


def readiness() -> dict:
    """Whether the ratings are enough to train the chart model on
    (vfr.chartmodel.readiness): asked by the console's status and before
    a retrain is started. A route whose chart is still being read is
    named rather than counted."""
    usable = rated = off_detection = 0
    reading = []
    for route, picks in _rated_by_route().items():
        rated += len(picks)
        landmarks = corridor(route, wait=False)
        if landmarks is None:
            reading.append(route)
            continue
        rows = chartmodel.labeled_rows(route, landmarks, picks)
        usable += len(rows)
        off_detection += len(picks) - len(rows)
    return chartmodel.readiness(usable=usable, rated=rated, off_detection=off_detection, reading=reading)


def write_training_table():
    """Every rated route's rows (vfr.chartmodel.labeled_rows) into the one
    table the training image reads, written whole or not at all."""
    frames = [chartmodel.labeled_rows(route, corridor(route, wait=True), picks)
              for route, picks in _rated_by_route().items()]
    table = pd.concat(frames, ignore_index=True) if frames else chartmodel.labeled_rows("", [], [])
    return _publish(chartmodel.TRAINING_TABLE_PATH, lambda tmp: table.to_parquet(tmp, index=False))


def predicted_scores(landmarks: list) -> list:
    """The chart model's score for each landmark, in order; all None
    where none is promoted or model-service does not answer. The
    features of the whole list at once, as each counts its neighbours."""
    if not landmarks:
        return []
    rows = chartfeatures.build(landmarks)[chartfeatures.FEATURE_COLS].astype(float).to_dict("records")
    return model_client.score_detections(rows) or [None] * len(landmarks)
