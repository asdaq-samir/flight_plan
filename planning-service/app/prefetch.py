"""A route's slow parts started as soon as the route is known, ahead of
the nav log that needs them: the chart's read along each hop, for its
checkpoints (app.chart_model), and the ground under it, from USGS's
point service (vfr.terrain) -- measured on a new route at 3 to 6 s and
9 s, one after the other, of the 15 s from the route to its nav log.

Asked for by /api/course, the first thing the web app asks for a route,
and so by the web app reading Fly Here's route ahead as an airport's card
opens. Each route once in a while, two at a time, on threads of their
own: a request never waits on it, and what it reads is kept where the
nav log's own reads find it (the chart's job, shared; the ground's disk
cache, read once for both callers)."""
import logging
import threading
from concurrent.futures import ThreadPoolExecutor

from cachetools import TTLCache
from vfr import chartlabels, terrain

from . import chart_model
from .common import load_route

log = logging.getLogger(__name__)

_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="prefetch")
# Hops longer than this are read when the nav log asks, not ahead: a
# course is asked for at every stop typed into a route, and a hop across
# the country (C81 to KGEG, seen 2026-10-07) is minutes of the chart
# reader's work for a route the next keystroke replaces.
MAX_HOP_NM = 300
# Routes started in the last ten minutes: the course is asked for again
# with every load of the same route, and its reads are kept longer.
_STARTED: TTLCache = TTLCache(maxsize=512, ttl=600)
_LOCK = threading.Lock()


def route(dep: str, dest: str, stops: str = "") -> None:
    """Starts the route's reads, once, and returns at once."""
    key = (dep.upper(), dest.upper(), stops.upper())
    with _LOCK:
        if key in _STARTED:
            return
        _STARTED[key] = True
    _POOL.submit(_read, dep, dest, stops)


def _read(dep: str, dest: str, stops: str) -> None:
    try:
        r = load_route(dep, dest, stops)
    except Exception:  # noqa: BLE001 -- the route's own requests say what is wrong with it
        return
    hops = [hop for hop in r.hops if hop.length_nm <= MAX_HOP_NM]
    for hop in hops:
        # The chart's read is a job of its own: started here, not waited on.
        try:
            chart_model.corridor(chartlabels.route_key(hop.dep_ident, hop.dest_ident), wait=False)
        except Exception:  # noqa: BLE001 -- the checkpoints' own request reports a failed read
            log.warning("prefetch: the chart along %s -> %s", hop.dep_ident, hop.dest_ident, exc_info=True)
    for hop in hops:
        # The same samples the altitude selection reads (vfr.terrain), so
        # its read finds them on disk.
        try:
            terrain.floor_profile(hop.start, hop.end, [0.0, hop.length_nm])
        except Exception:  # noqa: BLE001 -- the nav log's own read reports it
            log.warning("prefetch: the ground along %s -> %s", hop.dep_ident, hop.dest_ident, exc_info=True)
