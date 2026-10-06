"""Scored checkpoints for a route, read off the chart: whatever the chart
reader finds along it (app.chart_model.corridor, the training page's own
read, shared and kept on disk), scored by the chart model the training
page's ratings trained (vfr.chartmodel, served by model-service) -- or,
while none is promoted, by the palette's constant for each kind of
thing. Remembered per route until the chart or the model changes.

They were OpenStreetMap's landmarks, scored by a model of their own: a
route had to be collected first -- minutes of Overpass, FAA and
elevation downloads -- before it had a checkpoint, and the planner
offered "Collect this route" for every new one. The chart is read in
seconds for any route it covers, and it is what the pilot will be
looking at."""
import threading

from cachetools import LRUCache
from fastapi import HTTPException
from vfr import chartlabels, charts, model_registry, places
from vfr import checkpoints as checkpoint_selection

from . import chart_model

# Within a mile of the course, as the landmark model's corridor was: a
# checkpoint a pilot looks for off the nose, not one four miles abeam,
# which the training page's wider read is there to rate.
HALF_WIDTH_NM = 1.0

# What the nav log calls a detection with no name of its own: the chart
# draws a lake's outline, not always its name, and the reader reads no
# words. The charted airports carry the FAA's names.
KIND_NAMES = {"water": "Lake", "town": "Town", "river": "River", "road_or_rail": "Road or railway", "airport": "Airport"}

# Keyed by what changes the answer: the chart's cycle and revision (which
# name the corridor's kept read) and the promoted chart model. Bounded,
# so a long-lived process is not holding every route it ever served.
_SCORE_CACHE: LRUCache = LRUCache(maxsize=256)
_SCORE_CACHE_LOCK = threading.Lock()


def _mtime_or_none(path) -> float | None:
    try:
        return path.stat().st_mtime
    except OSError:
        return None


def _checkpoint(landmark, predicted: float | None) -> dict:
    return {
        "id": f"{landmark.category}@{landmark.lat:.5f},{landmark.lon:.5f}",
        "category": landmark.category,
        "name": landmark.name or KIND_NAMES.get(landmark.category, landmark.category),
        "lat": landmark.lat,
        "lon": landmark.lon,
        "along_track_nm": round(landmark.extras["along_track_nm"], 3),
        "predicted_score": round(predicted if predicted is not None else landmark.score, 4),
    }


def score(dep: str, dest: str) -> list:
    """Every detection within HALF_WIDTH_NM of the course, scored, in
    along-track order. A failed read of the chart is a 502, as
    model-service not answering was."""
    cycle = charts.serving_cycle()
    key = (cycle, charts.tiles_revision(cycle), _mtime_or_none(model_registry.CHART_CURRENT_DIR / "metrics.json"))
    with _SCORE_CACHE_LOCK:
        cached = _SCORE_CACHE.get((dep, dest))
        if cached is not None and cached["key"] == key:
            # Copies, not the cached dicts themselves -- /api/checkpoints
            # writes a "selected" flag onto every entry it returns, and
            # two requests doing that to one shared list is a data race.
            return [dict(c) for c in cached["checkpoints"]]

    try:
        landmarks = chart_model.corridor(chartlabels.route_key(dep, dest), wait=True)
    except RuntimeError as err:
        raise HTTPException(502, str(err)) from err
    # Scored over the whole read, as each detection's features count its
    # neighbours either side; only then cut to the planner's corridor.
    predicted = chart_model.predicted_scores(landmarks)
    checkpoints = sorted(
        (_checkpoint(landmark, p) for landmark, p in zip(landmarks, predicted)
         if abs(landmark.extras["cross_track_nm"]) <= HALF_WIDTH_NM),
        key=lambda c: c["along_track_nm"],
    )
    with _SCORE_CACHE_LOCK:
        _SCORE_CACHE[(dep, dest)] = {"key": key, "checkpoints": [dict(c) for c in checkpoints]}
    return checkpoints


def scored_and_selected(dep: str, dest: str) -> tuple:
    """Every scored candidate, each flagged "selected" or not, and the
    subset worth flying, in along-track order. Each named as the chart
    labels the place where the place names know it (vfr.places
    checkpoint_name: "Lake Zurich", "River near Springfield") -- here, not
    in the cached scores, as the names load after the service starts."""
    scored = score(dep, dest)
    for c in scored:
        c["name"] = places.checkpoint_name(c["category"], c["lat"], c["lon"]) or c["name"]
    selected = checkpoint_selection.select_checkpoints(scored)
    keys = {c["id"] for c in selected}
    for c in scored:
        c["selected"] = c["id"] in keys
    return scored, selected


#: How near a stop a hop's checkpoint is no use: the field itself is the
#: fix there, landed at or just taken off from.
NEAR_A_STOP_NM = 3.0


def route_checkpoints(r) -> tuple[list, list, list]:
    """The scored candidates and the selected checkpoints of a route with
    any number of stops (app.common.Route), along the whole of it, and
    the selected ones hop by hop -- each hop's own, for its nav log's
    fixes. A hop is a route of its own here: its own chart read, kept and
    shared with anyone flying it alone, and its own selection, cut to the
    hop itself so a checkpoint past a stop is not counted on both sides
    of it. Along-track distances run on through each stop."""
    hops = r.hops
    if len(hops) == 1:
        scored, selected = scored_and_selected(r.dep_ident, r.dest_ident)
        return scored, selected, [selected]
    # Every hop's chart asked for at once: each read is a job of its own
    # (app.detection), and one after another they would add up.
    for hop in hops:
        chart_model.corridor(chartlabels.route_key(hop.dep_ident, hop.dest_ident), wait=False)
    scored_all: list = []
    selected_all: list = []
    by_hop: list = []
    offset = 0.0
    # A point beside a stop can project onto both hops: it is the first's.
    seen: set = set()
    for index, hop in enumerate(hops):
        length = hop.length_nm
        scored, selected = scored_and_selected(hop.dep_ident, hop.dest_ident)
        earlier = set(seen)

        def on_hop(c, length=length, earlier=earlier):
            return 0.0 <= c["along_track_nm"] <= length and c["id"] not in earlier

        mine = [c for c in selected if on_hop(c) and NEAR_A_STOP_NM <= c["along_track_nm"] <= length - NEAR_A_STOP_NM]
        chosen = {c["id"] for c in mine}

        def along(c, offset=offset, index=index, chosen=chosen):
            return {**c, "along_track_nm": round(c["along_track_nm"] + offset, 3), "hop": index,
                    "selected": c["id"] in chosen}

        kept = [c for c in scored if on_hop(c)]
        seen |= {c["id"] for c in kept}
        scored_all += [along(c) for c in kept]
        selected_all += [along(c) for c in mine]
        by_hop.append(mine)
        offset += length
    return scored_all, selected_all, by_hop
