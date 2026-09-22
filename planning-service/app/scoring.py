"""Scored checkpoints for a route, from model-service, remembered per
route until the features or the promoted model change."""
import threading

from cachetools import LRUCache

from fastapi import HTTPException
from vfr import checkpoints as checkpoint_selection
from vfr import model_client, model_registry

from .common import paths

# Keyed by what actually changes the result: the features file and the
# promoted model. /api/checkpoints and /api/navlog each score the same
# route on every single page load -- two full model-service round trips
# (features parquet read + inference) for one screen, and the second one
# always returned exactly what the first just had.
# Bounded rather than a plain dict: this one is keyed by route alone and
# invalidated by the feature file's and the model's mtimes, so it does
# not need a TTL -- only a ceiling, so a long-lived process that has
# served a thousand corridors is not still holding all of them.
_SCORE_CACHE: LRUCache = LRUCache(maxsize=256)
_SCORE_CACHE_LOCK = threading.Lock()


def invoke_model(dep: str, dest: str) -> dict:
    """model-service's answer, with its failures as the HTTP statuses a
    browser caller expects: 404 for a corridor nobody has collected, 502
    when the service is unreachable, otherwise whatever it said."""
    try:
        return model_client.invoke(dep, dest)
    except model_client.ModelServiceError as err:
        raise HTTPException(err.status, str(err)) from err


def _mtime_or_none(path) -> float | None:
    try:
        return path.stat().st_mtime
    except OSError:
        return None


def score(dep: str, dest: str) -> list:
    _, features_path = paths(dep, dest)
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

    checkpoints = invoke_model(dep, dest)["checkpoints"]
    with _SCORE_CACHE_LOCK:
        _SCORE_CACHE[(dep, dest)] = {"key": key, "checkpoints": [dict(c) for c in checkpoints]}
    return checkpoints


def scored_and_selected(dep: str, dest: str) -> tuple:
    """Every scored candidate, each flagged "selected" or not, and the
    subset worth flying, in along-track order."""
    scored = score(dep, dest)
    selected = checkpoint_selection.select_checkpoints(scored)
    keys = {(c["osm_id"], c["category"]) for c in selected}
    for c in scored:
        c["selected"] = (c["osm_id"], c["category"]) in keys
    return scored, selected
