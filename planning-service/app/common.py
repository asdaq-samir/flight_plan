"""What every router starts from: the route's idents, the airports
behind them, and the on-disk paths a corridor's data lives at."""
import logging
import re
from dataclasses import dataclass
from itertools import pairwise

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from vfr import airports, fixes, geo, places, weather
from vfr.config import PROCESSED_DIR  # noqa: F401  (re-exported for the routers)
from vfr.config import corridor_paths as paths  # noqa: F401  (the routers' name for it)

from .planning import StillComputing

log = logging.getLogger(__name__)

DEFAULT_AIRCRAFT = "c172"

#: How many stops a route may make between its ends: each is a flight of
#: its own to read the chart along and plan.
MAX_STOPS = 8

#: Two points of a route closer than this are one place: a tenth of a
#: mile, inside any airport's own boundary.
SAME_PLACE_NM = 0.1


def route_key(dep: str, dest: str) -> tuple:
    return dep.strip().upper(), dest.strip().upper()


def stops_of(stops: str | list | None) -> list[str]:
    """The stops as the address has them, "KDSM,KLNK", or a list: their
    idents in order, normalised."""
    items = stops.split(",") if isinstance(stops, str) else (stops or [])
    return [s.strip().upper() for s in items if s and s.strip()]


#: A present position as a route's point, "@42.3246,-88.0741": where the
#: pilot is, for Fly Here's Direct-To, which in the air goes from wherever
#: the airplane is, any time, not from a field near it (the pilot's ask).
#: With the GPS's altitude where it gives one, feet MSL: "...,-88.0741,3500".
_POSITION = re.compile(r"^@(-?\d{1,2}(?:\.\d{1,6})?),(-?\d{1,3}(?:\.\d{1,6})?)(?:,(\d{1,5}))?$")


def position_of(ident: str) -> dict | None:
    """A present position (_POSITION) in the shape a waypoint's is: flown
    from, not taken off from (Route.takes_off), so its hop has no climb
    from a field -- from the GPS's altitude where it has one; None for any
    other ident."""
    match = _POSITION.match(ident.strip())
    if match is None:
        return None
    lat, lon = float(match[1]), float(match[2])
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    # The altitude the airplane is at, for its climb or level start (app.
    # routers.plan's departure_elevation); none where the GPS gave none.
    altitude = float(match[3]) if match[3] else None
    return {"name": "Present position", "lat": lat, "lon": lon, "elevation_ft": None, "fix": True, "altitude_ft": altitude}


def resolve(*idents: str) -> tuple:
    """Every airport -- or a present position (position_of) -- or a 404
    naming the one that failed.

    Done before anything else so a typo'd ident says so, rather than
    surfacing later as "this corridor has not been collected" -- advice
    whose next step would fail for a different reason.
    """
    try:
        return tuple(position_of(ident) or airports.get_airport(ident) for ident in idents)
    except ValueError as err:
        raise HTTPException(404, str(err)) from err


def resolve_stop(ident: str, near: tuple = ()) -> dict:
    """A stop: an airport, landed at, or a named fix -- a VFR waypoint
    (VPBNG), a GPS waypoint, a navaid (RFD) -- flown through (vfr.fixes);
    a 404 where it is neither. A fix is in the shape an airport is, with
    no elevation, and `fix` set. A present position (position_of) too.
    `near`, the route's other points as (lat, lon): which of the navaids
    an ident names in more than one place is meant (fixes.find_navaid)."""
    position = position_of(ident)
    if position is not None:
        return position
    # A navaid before an airport of the same ident, as a flight plan reads
    # one: "RFD" is the Rockford DME, flown over, and the airport is KRFD,
    # written with its K. It was the airport, a hop of no length before
    # KRFD where the pilot meant the DME 4.9 nm out (2026-10-07).
    navaid = fixes.find_navaid(ident, near)
    if navaid is not None:
        return _fix_stop(navaid, fixes.title(navaid))
    try:
        return airports.get_airport(ident)
    except ValueError as err:
        fix = fixes.find_fix(ident)
        if fix is None:
            raise HTTPException(404, f"No airport or waypoint goes by {ident!r}.") from err
        # Its kind and where it is: "VFR waypoint by Bangs Lake" -- a
        # stand-alone waypoint has no name of its own (vfr.places).
        where = places.describe(fix["lat"], fix["lon"])
        return _fix_stop(fix, f"{fix['kind']} {where}" if where else fix["kind"])


def _at(point: dict) -> tuple[float, float]:
    return point["lat"], point["lon"]


def _fix_stop(fix: dict, name: str) -> dict:
    return {"name": name, "lat": fix["lat"], "lon": fix["lon"], "elevation_ft": None, "fix": True}


@dataclass(frozen=True)
class Route:
    """A resolved route: its idents in order -- the departure, any stops,
    the destination -- and their airport records. A route with stops is
    flown as `hops`, each a route of its own between two landings: its
    own chart read, altitude plan, climb and fuel check."""

    idents: tuple[str, ...]
    airports: tuple[dict, ...]

    @property
    def dep_ident(self) -> str:
        return self.idents[0]

    @property
    def dest_ident(self) -> str:
        return self.idents[-1]

    @property
    def dep_airport(self) -> dict:
        return self.airports[0]

    @property
    def dest_airport(self) -> dict:
        return self.airports[-1]

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

    @property
    def stops(self) -> list[dict]:
        return [_endpoint(i, a) for i, a in zip(self.idents[1:-1], self.airports[1:-1])]

    @property
    def takes_off(self) -> bool:
        """Whether this route (a hop) starts on the ground: at an airport,
        not a waypoint flown through."""
        return not self.dep_airport.get("fix")

    @property
    def lands(self) -> bool:
        """Whether this route (a hop) ends on the ground."""
        return not self.dest_airport.get("fix")

    @property
    def flights(self) -> list["Route"]:
        """The flights it is made of, each from one landing to the next,
        through any waypoints: what each fuel check is over."""
        out, start = [], 0
        for i, hop in enumerate(self.hops):
            if hop.lands or i == len(self.hops) - 1:
                out.append(Route(self.idents[start:i + 2], self.airports[start:i + 2]))
                start = i + 1
        return out

    @property
    def hops(self) -> list["Route"]:
        return [Route(self.idents[i:i + 2], self.airports[i:i + 2]) for i in range(len(self.idents) - 1)]

    @property
    def length_nm(self) -> float:
        """This route's own great circle, end to end: one hop's length."""
        return geo.distance_nm(*self.start, *self.end)

    @property
    def distance_nm(self) -> float:
        """The whole way, stop by stop."""
        return sum(hop.length_nm for hop in self.hops)


def _endpoint(ident: str, airport: dict) -> dict:
    return {
        "ident": ident, "name": airport["name"], "lat": airport["lat"], "lon": airport["lon"],
        "elevation_ft": airport.get("elevation_ft"), "kind": "fix" if airport.get("fix") else "airport",
    }


def load_hop(dep: str, dest: str) -> Route:
    """One hop of a route with stops, by its two ends -- either of which
    may be a waypoint flown through (resolve_stop): its chart is read as
    any route's is."""
    dep, dest = route_key(dep, dest)
    # Each end by the other: an ident that names navaids in two places is
    # the one by the hop's other end, as the route's choice is by its ends.
    start = resolve_stop(dep)
    end = resolve_stop(dest, near=(_at(start),))
    return Route((dep, dest), (resolve_stop(dep, near=(_at(end),)), end))


def load_route(dep: str, dest: str, stops: str | list | None = None) -> Route:
    """The route, its stops (stops_of) between its ends: airports landed
    at, or waypoints flown through (resolve_stop). A stop that is the
    point before it is a 422, and so are more than MAX_STOPS; the
    destination may be the departure once there is a stop between them,
    which is a round trip."""
    idents = [*route_key(dep, dest)]
    idents[1:1] = stops_of(stops)
    if len(idents) - 2 > MAX_STOPS:
        raise HTTPException(422, f"A route makes at most {MAX_STOPS} stops.")
    for a, b in pairwise(idents):
        if a == b and len(idents) > 2:
            raise HTTPException(422, f"{a} follows itself: a stop is a different airport from the one before it.")
    dep_airport, dest_airport = resolve(idents[0], idents[-1])
    ends = (_at(dep_airport), _at(dest_airport))
    points = (dep_airport, *(resolve_stop(s, near=ends) for s in idents[1:-1]), dest_airport)
    # And by where they are, not only by how they are written: RFD is
    # KRFD's own FAA identifier, and "KUGN, RFD, KRFD" was a hop of no
    # length, which the altitude plans divided by (2026-10-07).
    for (a, pa), (b, pb) in pairwise(zip(idents, points)):
        if len(idents) > 2 and geo.distance_nm(pa["lat"], pa["lon"], pb["lat"], pb["lon"]) < SAME_PLACE_NM:
            raise HTTPException(422, f"{a} and {b} are the same place: a stop is a different airport from the one before it.")
    return Route(tuple(idents), points)


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
