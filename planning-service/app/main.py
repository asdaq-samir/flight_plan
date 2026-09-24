"""The route planner: two airport idents in, a chart with the course and
its checkpoints out, plus the dead-reckoning nav log for the legs between
them.

This is the human-facing surface of everything else in the project. The
model scores candidate landmarks (model-service), vfr.checkpoints narrows
them to the handful worth flying, and vfr.navlog turns those into legs
with real wind and magnetic variation -- but none of that is inspectable
from a JSON response. Seeing the checkpoints on the sectional is the only
way to judge whether they are findable in the air, which is the question
the whole model exists to answer.

Split of responsibility, and why it falls this way:

- model-service owns the model artifact and its pinned scikit-learn, and
  stays /ping + /invocations + /routes, mirroring a SageMaker inference
  container. This service never loads a model.
- This service owns everything route-shaped: collecting a corridor,
  building its features, computing the nav log, and drawing it.

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
from vfr import airspace, altitude, charts, faa_data, weather

from . import chart_refresh
from .common import PROCESSED_DIR
from .planning import StillComputing
from .routers import briefing, build, chart, classb, devml, devservices, notes, plan, system
from .schemas import STREAM_MESSAGES, Index

# Nothing else in the process configured logging, so every log.info() in
# this codebase -- this file's own, and every one already written in
# vfr/weather.py and vfr/charts.py before this -- was going nowhere:
# Python's root logger defaults to WARNING, and uvicorn's own
# --log-level only reaches its own uvicorn.access/uvicorn.error
# loggers, not a plain logging.getLogger(__name__) anywhere else in the
# process. Found while adding the timing lines in vfr.altitude,
# vfr.model_client and app.routers.classb (2026-09-23) and running one
# live to see it -- nothing appeared. LOG_LEVEL, not a hardcoded INFO,
# so a noisy deploy can be turned back down without a code change.
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))

log = logging.getLogger(__name__)

# Inside the datasets' own five-minute time-to-live, so a held copy is
# replaced before a request could find it stale.
WEATHER_REFRESH_S = 240
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
            # The VFR charts only: the IFR sheets are an optional
            # layer, and the daily refresh fetches every kind anyway.
            charts.prepare_for_bbox((min(lons), min(lats), max(lons), max(lats)), kinds=("sec", "tac"))


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
        ("charts", _prepare_corridor_charts),
    ):
        try:
            load()
        except Exception:  # noqa: BLE001 -- the first altitude selection will load it, and report its own error
            log.exception("%s warm-up failed", name)

    if chart_refresh.AUTO_REFRESH:
        chart_refresh.maybe_refresh()

    # Then keep the weather warm: the METAR/TAF/SIGMET files and the
    # winds product are fetched again every few minutes, inside their
    # own time-to-live, so no pilot's request ever pays for a download
    # -- on a slow aviationweather.gov day the first plan after an
    # expiry was observed waiting close to a minute. A refresh that
    # fails is logged and the held copies go on being served. Once an
    # hour, the chart cycle is checked (app.chart_refresh decides what
    # that starts).
    last_cycle_check = time.time()
    while True:
        time.sleep(WEATHER_REFRESH_S)
        try:
            weather.refresh()
            log.info("weather refreshed")
        except Exception:  # noqa: BLE001 -- the next tick tries again; requests serve what is held
            log.warning("weather refresh failed", exc_info=True)
        if chart_refresh.AUTO_REFRESH and time.time() - last_cycle_check >= chart_refresh.CHECK_EVERY_S:
            last_cycle_check = time.time()
            chart_refresh.maybe_refresh()


@asynccontextmanager
async def _lifespan(app: FastAPI):
    threading.Thread(target=_warm_reference_data, name="reference-data-warm-up", daemon=True).start()
    yield


app = FastAPI(title="vfr-route planner", lifespan=_lifespan)


@app.exception_handler(weather.WeatherServiceError)
async def _weather_service_error(request: Request, exc: weather.WeatherServiceError):
    # One place, not one try/except per call site -- weather.py's
    # functions are called from /api/plan, /api/navlog, /api/briefing
    # and /api/altitude-breakdown alike, and a down or slow
    # aviationweather.gov should read as "the weather source is
    # unavailable" everywhere, not a raw 500.
    return JSONResponse(status_code=502, content={"detail": str(exc)})


@app.exception_handler(StillComputing)
async def _still_computing(request: Request, exc: StillComputing):
    # A computation for this route has run past its limit (app.planning):
    # a 504 that says what it is still waiting on, and that asking again
    # in a minute gets the answer it goes on to cache.
    return JSONResponse(status_code=504, content={"detail": str(exc)})


@app.get("/")
def index() -> Index:
    """This service has no pages. The front end is built into the Spring
    Boot gateway's jar and served from there, which is also the only
    thing that calls this -- so this answers a health probe and says
    where the UI went."""
    return Index(service="planner", ui="served by the gateway at /app")


for module in (plan, chart, build, briefing, notes, devml, system, classb, devservices):
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
