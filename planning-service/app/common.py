"""What every router starts from: the two idents, the airports behind
them, and the on-disk paths a corridor's data lives at."""
from dataclasses import dataclass

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from vfr import airports
from vfr.config import DATA_DIR

PROCESSED_DIR = DATA_DIR / "processed"
DEFAULT_AIRCRAFT = "c172"


def route_key(dep: str, dest: str) -> tuple:
    return dep.strip().upper(), dest.strip().upper()


def paths(dep: str, dest: str) -> tuple:
    slug = f"{dep.lower()}_{dest.lower()}"
    return (
        PROCESSED_DIR / f"candidates_{slug}.csv",
        PROCESSED_DIR / f"features_{slug}.parquet",
    )


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


def ndjson(lines) -> StreamingResponse:
    """One JSON object per line, sent as each is produced. The headers keep
    any proxy in between (nginx, the Spring webapp) from buffering lines
    until the stream ends, which would defeat streaming entirely."""
    return StreamingResponse(
        lines, media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
