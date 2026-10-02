"""The planner's side of the chart model (vfr.chartmodel): the table it
trains on, whether the ratings are enough for it, and its scores for the
training page's points, from model-service, which serves it.

Here rather than in the pipeline because the planner holds the chart
reader -- the pipeline images have no GDAL -- and has every rated
route's corridor read already, kept on disk (app.detection)."""
import pandas as pd
from vfr import chartfeatures, chartlabels, chartmodel, model_client
from vfr.pipeline import _publish

from .common import load_route
from .detection import detect_job, faa_airports

# How far either side of the course the training page reads the chart:
# its points, which its ratings are made on and the model learns from.
# Here, not in app.detection, whose source names its kept reads -- a
# change there reads every corridor again.
TRAINING_HALF_WIDTH_NM = 4.0


def corridor(route: str, wait: bool) -> list | None:
    """Every detection the training page shows along a route ("C81->KDLH"):
    its charted airports and what the reader found, at the page's own
    half-width -- so a pick claims what it was made on. None while the
    read is still going and `wait` is False; the job it asks for is the
    page's own, shared, so this starts no second read."""
    dep, dest = route.split("->")
    r = load_route(dep, dest)
    job = detect_job((route, TRAINING_HALF_WIDTH_NM), r.start, r.end, TRAINING_HALF_WIDTH_NM)
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
