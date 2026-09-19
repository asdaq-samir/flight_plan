"""The corridor read behind /api/detect/stream: one shared job per
route, plus the charted airports that come first."""
import threading
import time

from vfr import chartvision, faa_data, geo
from vfr.config import DATA_DIR

_APT_CACHE: dict = {}


def faa_airports(start, end, half_width_nm, dep_ident, dest_ident) -> list:
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


def detect_job(key: tuple, start: tuple, end: tuple, half_width_nm: float) -> dict:
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
