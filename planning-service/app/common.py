"""What every router starts from: the two idents, the airports behind
them, and the on-disk paths a corridor's data lives at."""
import logging
from dataclasses import dataclass

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from vfr import airports, weather
from vfr.config import PROCESSED_DIR  # noqa: F401  (re-exported for the routers)
from vfr.config import corridor_paths as paths  # noqa: F401  (the routers' name for it)

from .planning import StillComputing

log = logging.getLogger(__name__)

DEFAULT_AIRCRAFT = "c172"


def route_key(dep: str, dest: str) -> tuple:
    return dep.strip().upper(), dest.strip().upper()


def resolve(dep: str, dest: str) -> tuple:
    """Both airports, or a 404 naming the one that failed.

    Done before anything else so a typo'd ident says so, rather than
    surfacing later as "this corridor has not been collected" -- advice
    whose next step would fail for a different reason.
    """
    try:
        return airports.get_airport(dep), airports.get_airport(dest)
    except ValueError as err:
        raise HTTPException(404, str(err)) from err


@dataclass(frozen=True)
class Route:
    """A resolved dep/dest pair: normalised idents, both airport records,
    and the (lat, lon) ends every geometry call takes."""

    dep_ident: str
    dest_ident: str
    dep_airport: dict
    dest_airport: dict

    @property
    def start(self) -> tuple:
        return (self.dep_airport["lat"], self.dep_airport["lon"])

    @property
    def end(self) -> tuple:
        return (self.dest_airport["lat"], self.dest_airport["lon"])

    @property
    def departure(self) -> dict:
        return _endpoint(self.dep_ident, self.dep_airport)

    @property
    def destination(self) -> dict:
        return _endpoint(self.dest_ident, self.dest_airport)


def _endpoint(ident: str, airport: dict) -> dict:
    return {
        "ident": ident, "name": airport["name"], "lat": airport["lat"], "lon": airport["lon"],
        "elevation_ft": airport.get("elevation_ft"),
    }


def load_route(dep: str, dest: str) -> Route:
    dep_ident, dest_ident = route_key(dep, dest)
    dep_airport, dest_airport = resolve(dep_ident, dest_ident)
    return Route(dep_ident, dest_ident, dep_airport, dest_airport)


def line(message: BaseModel) -> str:
    """One NDJSON line, serialised through the message's own model so
    the stream can only ever carry the shapes app.schemas declares."""
    return message.model_dump_json(by_alias=True) + "\n"


def ndjson(lines, on_error) -> StreamingResponse:
    """One JSON object per line, sent as each is produced. The headers keep
    any proxy in between (nginx, the Spring webapp) from buffering lines
    until the stream ends, which would defeat streaming entirely.

    `on_error` builds the stream's "error" message. Once the first line
    is out the status is fixed at 200, so a failure after that -- a
    weather fetch, model-service, the corridor read -- cannot become a
    502 any more; left alone it would simply truncate the body, which a
    browser cannot tell from a stream still loading. It becomes the last
    line instead, and the page ends with a message rather than a spinner.
    """
    return StreamingResponse(
        _ending_in_an_error_line(lines, on_error), media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _ending_in_an_error_line(lines, on_error):
    try:
        yield from lines
    except HTTPException as err:
        yield line(on_error(detail=str(err.detail)))
    except (weather.WeatherServiceError, StillComputing) as err:
        yield line(on_error(detail=str(err)))
    except Exception as err:  # noqa: BLE001 -- the stream is committed; the client gets the line, the log gets the trace
        log.exception("stream failed after the response had started")
        yield line(on_error(detail=f"{type(err).__name__}: {err}"))
