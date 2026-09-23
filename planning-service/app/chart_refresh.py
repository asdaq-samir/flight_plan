"""When the planner fetches and renders a new FAA chart cycle: the one
place that decides it, for both the hourly check (app.main's warm-up
loop) and the Dev console's "refresh now" (app.routers.system).
vfr.charts does the work -- the download, the render, the publish --
and answers what is on disk; this is only the policy of when, and with
how much of the machine.

Rendering a cycle is every sheet of the country, hours of every core it
is given, and on a machine that is also somebody's desk that was felt
as a map that stuttered under the pilot's own finger. So a new cycle's
render starts only inside CHARTS_REFRESH_WINDOW -- "HH:MM-HH:MM" on the
container's own clock (set TZ for a local one), 01:00-06:00 by default,
blank for any time -- with CHARTS_REFRESH_WORKERS processes (one by
default: slower, and out of the way), and the check runs hourly so as
to land in the window. The one exception is a stack with no complete
pyramid on disk at all, which renders at once: until it does, every
tile is drawn on request. A request from the Dev console starts at
once, with ON_REQUEST_WORKERS. CHARTS_AUTO_REFRESH=0 turns the hourly
check off -- a test stack, or a deployment that renders its pyramid
elsewhere.
"""
import logging
import os
import time

from vfr import charts

from .settings import CHARTS_REFRESH_WINDOW, CHARTS_REFRESH_WORKERS

log = logging.getLogger(__name__)

# How often to ask whether the FAA has moved to a new chart cycle
# (every 56 days).
CHECK_EVERY_S = 3600
AUTO_REFRESH = os.environ.get("CHARTS_AUTO_REFRESH", "1") != "0"
# Someone asked, so it should not wait on the one-worker night pace.
ON_REQUEST_WORKERS = 2


def in_window(now: time.struct_time | None = None, window: str = CHARTS_REFRESH_WINDOW) -> bool:
    """Whether the clock is inside `window` ("HH:MM-HH:MM", which may
    run past midnight: "22:00-05:00"); always, for a blank window."""
    if not window:
        return True
    start, _, end = window.partition("-")
    now = now or time.localtime()
    minute = now.tm_hour * 60 + now.tm_min
    to_minutes = lambda hhmm: int(hhmm[:2]) * 60 + int(hhmm[3:5])  # noqa: E731
    lo, hi = to_minutes(start), to_minutes(end)
    return lo <= minute < hi if lo <= hi else minute >= lo or minute < hi


def maybe_refresh() -> None:
    """The scheduled check: start the current cycle's render if it is
    due and either the window is open or nothing complete is on disk to
    serve meanwhile. Never raises -- the next check tries again, and the
    map keeps serving what it has."""
    try:
        if not charts.refresh_due():
            return
        served = charts.serving_cycle()
        if charts.pyramid_complete(served) and not in_window():
            log.info("chart cycle %s is due; rendering it in the %s window (serving %s until then)",
                     charts.current_cycle(), CHARTS_REFRESH_WINDOW, served)
            return
        if charts.refresh_in_background(workers=CHARTS_REFRESH_WORKERS):
            log.info("chart cycle %s is not complete on disk; fetching and rendering it", charts.current_cycle())
    except Exception:  # noqa: BLE001 -- the next hourly check tries again; the map keeps serving what it has
        log.warning("chart cycle check failed", exc_info=True)


def refresh_now() -> bool:
    """The Dev console's "refresh now": at once, whatever the window
    says. False when a refresh is already running."""
    return charts.refresh_in_background(workers=ON_REQUEST_WORKERS)
