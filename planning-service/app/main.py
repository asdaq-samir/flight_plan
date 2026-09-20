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
import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
from pydantic import TypeAdapter
from vfr import airspace, altitude, faa_data, weather

from .routers import briefing, build, chart, devml, notes, plan, system
from .schemas import STREAM_MESSAGES, Index

log = logging.getLogger(__name__)


def _warm_reference_data() -> None:
    """Every altitude selection needs the controlled-airspace polygons
    and the obstacle table, and both are slow to load cold (about thirty
    and nine seconds from the FAA files, well under a second from the
    caches vfr keeps beside them); every briefing needs the current
    METAR/TAF/SIGMET datasets, a few downloads. All are loaded here
    rather than on the first pilot's request after a restart. A request
    arriving mid-load waits on the same parse instead of starting
    another."""
    for name, load in (
        ("airspace", lambda: airspace.preload(altitude.DEFAULT_FAA_CACHE_DIR)),
        ("obstacles", lambda: faa_data.preload_obstacles(altitude.DEFAULT_FAA_CACHE_DIR)),
        ("weather", weather.preload),
    ):
        try:
            load()
        except Exception:  # noqa: BLE001 -- the first altitude selection will load it, and report its own error
            log.exception("%s warm-up failed", name)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    threading.Thread(target=_warm_reference_data, name="reference-data-warm-up", daemon=True).start()
    yield
    # uvicorn's graceful SIGTERM shutdown runs this before the process
    # exits.
    build.interrupt_running()


app = FastAPI(title="vfr-route planner", lifespan=_lifespan)


@app.exception_handler(weather.WeatherServiceError)
async def _weather_service_error(request: Request, exc: weather.WeatherServiceError):
    # One place, not one try/except per call site -- weather.py's
    # functions are called from /api/plan, /api/navlog, /api/briefing
    # and /api/altitude-breakdown alike, and a down or slow
    # aviationweather.gov should read as "the weather source is
    # unavailable" everywhere, not a raw 500.
    return JSONResponse(status_code=502, content={"detail": str(exc)})


@app.get("/")
def index() -> Index:
    """This service has no pages. The front end is built into the Spring
    Boot gateway's jar and served from there, which is also the only
    thing that calls this -- so this answers a health probe and says
    where the UI went."""
    return Index(service="planner", ui="served by the gateway at /app")


for module in (plan, chart, build, briefing, notes, devml, system):
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
