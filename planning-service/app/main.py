"""The route planner: two airport idents in, a chart with the course and
its checkpoints out, plus the dead-reckoning nav log for the legs between
them.

This is the human-facing surface of everything else in the project. The
chart reader finds what the sectional draws along the course, the chart
model scores it (vfr.chartmodel, served by model-service),
vfr.checkpoints narrows them to the handful worth flying, and vfr.navlog turns those into legs
with real wind and magnetic variation -- but none of that is inspectable
from a JSON response. Seeing the checkpoints on the sectional is the only
way to judge whether they are findable in the air, which is the question
the whole model exists to answer.

Split of responsibility, and why it falls this way:

- model-service owns the chart model's artifact and its pinned
  scikit-learn, and scores the detections this service sends it
  (/score-detections). This service never loads a model.
- This service owns everything route-shaped: reading the chart along
  it, computing the nav log, and drawing it.

The endpoints live in app.routers, one module per concern; the work they
share -- resolving a route, scoring it, the nav-log arithmetic, the
corridor read -- is in the modules next to this one, and every shape
they send is a model in app.schemas.
"""
import csv
import logging
import os
import threading
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
from pydantic import TypeAdapter
from vfr import airspace, altitude, charts, faa_data, fixes, places, publications, remarks, weather
from vfr import airports as airport_table

from . import chart_model, chart_refresh, errors, tracing
from .common import PROCESSED_DIR
from .planning import StillComputing
from .routers import airports, airspace as airspace_router, briefing, chart, classb, devml, devservices, notes, oral, plan, system
from .schemas import STREAM_MESSAGES, Index

# Nothing else in the process configured logging, so every log.info() in
# this codebase -- this file's own, and every one already written in
# vfr/weather.py and vfr/charts.py before this -- was going nowhere:
# Python's root logger defaults to WARNING, and uvicorn's own
# --log-level only reaches its own uvicorn.access/uvicorn.error
# loggers, not a plain logging.getLogger(__name__) anywhere else in the
# process. Found while adding the timing lines in vfr.altitude and
# app.routers.classb (2026-09-23) and running one
# live to see it -- nothing appeared. LOG_LEVEL, not a hardcoded INFO,
# so a noisy deploy can be turned back down without a code change.
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))

log = logging.getLogger(__name__)

# Inside the datasets' own five-minute time-to-live, so a held copy is
# replaced before a request could find it stale.
WEATHER_REFRESH_S = 240
# How often the FAA's files are checked for a new edition.
EDITIONS_CHECK_EVERY_S = 6 * 3600
# Set once the reference data below is loaded: the health probe reports
# it, so a test run against a fresh stack can wait for a planner that
# answers at full speed rather than one still parsing airspace under
# its first requests.
WARM = threading.Event()
def _prepare_corridor_charts() -> None:
    """The FAA charts under every corridor already built here -- a
    sectional is a 70 MB download and a minute of preparation the first
    time, which should happen now rather than under the first pilot's
    map. The corridor's candidate file gives its extent."""
    for path in sorted(PROCESSED_DIR.glob("candidates_*.csv")):
        lats, lons = [], []
        with path.open() as f:
            for row in csv.DictReader(f):
                try:
                    lats.append(float(row["lat"]))
                    lons.append(float(row["lon"]))
                except (KeyError, ValueError):
                    continue
        if lats:
            # Every kind the map can draw over the corridor: the base
            # charts (sectional, IFR low) and the two a Class B card
            # pins over them (TAC, IFR area). It was the VFR pair only,
            # the daily refresh fetching the rest -- and a stack started
            # from nothing with that refresh off, CI's, had no IFR chart
            # for the tests that switch to one.
            charts.prepare_for_bbox((min(lons), min(lats), max(lons), max(lats)),
                                    kinds=("sec", "tac", "ifr_low", "ifr_area"))


def _warm_reference_data() -> None:
    """Every altitude selection needs the controlled-airspace polygons
    and the obstacle table, and both are slow to load cold (about thirty
    and nine seconds from the FAA files, well under a second from the
    caches vfr keeps beside them); every briefing needs the current
    METAR/TAF/SIGMET datasets, a few downloads; every map needs the
    charts under it. All are loaded here rather than on the first
    pilot's request after a restart. A request arriving mid-load waits
    on the same parse instead of starting another."""
    for name, load in (
        ("airspace", lambda: airspace.preload(altitude.DEFAULT_FAA_CACHE_DIR)),
        ("obstacles", lambda: faa_data.preload_obstacles(altitude.DEFAULT_FAA_CACHE_DIR)),
        ("weather", weather.preload),
        ("remarks", remarks.preload),
        # The airport search's table and index (vfr.airports): the first
        # search after a restart built them, three seconds before the
        # first suggestion.
        ("airport search", lambda: airport_table.search_airports("K")),
        ("fixes", fixes.preload),
        ("charts", _prepare_corridor_charts),
    ):
        try:
            load()
        except Exception:  # noqa: BLE001 -- the first altitude selection will load it, and report its own error
            log.exception("%s warm-up failed", name)
    WARM.set()

    # After warm, not before it: the first start downloads the USGS's
    # place names (vfr.places), and nothing waits on them -- a waypoint
    # is only left undescribed until they are in.
    try:
        places.preload()
    except Exception:  # noqa: BLE001
        log.exception("places warm-up failed")
    # The same for the airport diagrams' and Chart Supplement's indexes
    # (vfr.publications), once per edition: a card only links them.
    try:
        publications.preload()
    except Exception:  # noqa: BLE001
        log.exception("publications warm-up failed")

    if chart_refresh.AUTO_REFRESH:
        chart_refresh.maybe_refresh()

    # Then keep the weather warm: the METAR/TAF/SIGMET files and the
    # winds product are fetched again every few minutes, inside their
    # own time-to-live, so no pilot's request ever pays for a download
    # -- on a slow aviationweather.gov day the first plan after an
    # expiry was observed waiting close to a minute. While the planner is
    # in use (weather.in_use: asked in the last quarter of an hour), and
    # each only if it has changed: it downloaded all eight every four
    # minutes round the clock, nobody planning. A refresh that fails is
    # logged and the held copies go on being served. Once an hour, the
    # chart cycle is checked (app.chart_refresh decides what that starts).
    last_cycle_check = time.time()
    # The FAA's files a new edition at a time (vfr.faa_data.refresh_editions):
    # checked now, and four times a day -- a cycle starts on a known day,
    # and a check is three page reads. Off with the charts' own refresh
    # (CHARTS_AUTO_REFRESH=0: a test stack).
    last_editions_check = 0.0
    while True:
        if chart_refresh.AUTO_REFRESH and time.time() - last_editions_check >= EDITIONS_CHECK_EVERY_S:
            last_editions_check = time.time()
            try:
                refreshed = faa_data.refresh_editions(altitude.DEFAULT_FAA_CACHE_DIR)
                if refreshed:
                    log.info("FAA files refreshed: %s", ", ".join(refreshed))
                    # Read again here rather than under a pilot's request:
                    # the airspace's shapes alone are half a minute.
                    airspace.preload(altitude.DEFAULT_FAA_CACHE_DIR)
                    faa_data.preload_obstacles(altitude.DEFAULT_FAA_CACHE_DIR)
                    remarks.preload()
                    fixes.preload()
            except Exception:  # noqa: BLE001 -- the FAA's index out of reach: the next check tries again
                log.warning("FAA editions not checked", exc_info=True)
        time.sleep(WEATHER_REFRESH_S)
        try:
            if weather.in_use():
                weather.refresh()
                log.info("weather refreshed")
        except Exception:  # noqa: BLE001 -- the next tick tries again; requests serve what is held
            log.warning("weather refresh failed", exc_info=True)
        if chart_refresh.AUTO_REFRESH and time.time() - last_cycle_check >= chart_refresh.CHECK_EVERY_S:
            last_cycle_check = time.time()
            chart_refresh.maybe_refresh()
        # The chart reader's processes let go once nobody has read a chart
        # for a while (app.chart_model.IDLE_S).
        if chart_model.release_idle():
            log.info("chart reader's processes let go, idle")


@asynccontextmanager
async def _lifespan(app: FastAPI):
    threading.Thread(target=_warm_reference_data, name="reference-data-warm-up", daemon=True).start()
    yield


app = FastAPI(title="Wingtip Maps planner", lifespan=_lifespan)
# What failed lately, for the Dev console (app.errors).
app.add_middleware(errors.RecordFailures)
# Traces, where an OTLP endpoint is set (app.tracing).
tracing.instrument(app)


@app.exception_handler(weather.WeatherServiceError)
async def _weather_service_error(request: Request, exc: weather.WeatherServiceError):
    # One place, not one try/except per call site -- weather.py's
    # functions are called from /api/plan, /api/navlog and /api/briefing
    # alike, and a down or slow
    # aviationweather.gov should read as "the weather source is
    # unavailable" everywhere, not a raw 500.
    errors.record_for(request, 502, str(exc))
    return JSONResponse(status_code=502, content={"detail": str(exc)})


@app.exception_handler(StillComputing)
async def _still_computing(request: Request, exc: StillComputing):
    # A computation for this route has run past its limit (app.planning):
    # a 504 that says what it is still waiting on, and that asking again
    # in a minute gets the answer it goes on to cache.
    errors.record_for(request, 504, str(exc))
    return JSONResponse(status_code=504, content={"detail": str(exc)})


@app.get("/")
def index() -> Index:
    """This service has no pages. The front end is built into the Spring
    Boot gateway's jar and served from there, which is also the only
    thing that calls this -- so this answers a health probe and says
    where the UI went."""
    return Index(service="planner", ui="served by the gateway at /app", warm=WARM.is_set())


for module in (plan, chart, briefing, notes, devml, system, classb, devservices, airports, airspace_router, oral):
    app.include_router(module.router)


def _openapi() -> dict:
    """FastAPI's own document, plus the NDJSON stream message unions. No
    route returns those, so FastAPI would never publish them, and web/
    needs them typed as much as any JSON response."""
    if app.openapi_schema:
        return app.openapi_schema
    document = get_openapi(title=app.title, version=app.version, routes=app.routes)
    components = document.setdefault("components", {}).setdefault("schemas", {})
    for name, union in STREAM_MESSAGES.items():
        piece = TypeAdapter(union).json_schema(
            mode="serialization", ref_template="#/components/schemas/{model}",
        )
        components.update(piece.pop("$defs", {}))
        components[name] = piece
    app.openapi_schema = document
    return document


app.openapi = _openapi
