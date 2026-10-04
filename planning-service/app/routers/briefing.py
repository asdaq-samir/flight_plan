"""The Flight Briefing page: adverse conditions, current conditions,
forecast, and airport/frequency info around the nav log -- the FAA's own
standard-briefing sequence (AIM/FAA-H-8083-25), minus the two pieces this
service has no real source for: NOTAMs (the official FAA NOTAM API is
gated to certain commercial/public operators, emailed credentials only --
the page links out to a real briefing service instead of faking data) and
a synoptic narrative (needs real meteorological analysis, not a data
fetch).

One plain synchronous response, not a stream like /api/navlog: every
piece here is one quick independent call (hazards, forecast, METAR,
runways/frequencies), not the slow per-leg loop that justified streaming
there. "Independent" is also why they run concurrently, not one after
another -- three separate blocking round trips to aviationweather.gov,
summed instead of overlapped, was the whole reason this page felt slow to
open even though no single piece actually is."""
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from fastapi import APIRouter
from vfr import airports, runway_wind, weather

from ..common import load_route
from ..schemas import Briefing

#: How long past the arrival the forecast is read over, and the flight
#: assumed when the caller does not say how long it is.
MARGIN_S = 3600
DEFAULT_ETE_MIN = 120

router = APIRouter()


def _along_hops(r, read) -> list:
    """`read(start, end)` along each hop of the route, in turn: a route
    with stops is not the straight line from its departure to its
    destination."""
    return [read(hop.start, hop.end) for hop in r.hops]


def _least(values):
    known = [v for v in values if v is not None]
    return min(known) if known else None


def _joined_forecast(forecasts: list[dict]) -> dict:
    """The hops' forecasts as one: every station once, and the lowest
    ceiling and visibility any of them forecasts."""
    return {
        "min_ceiling_ft": _least(f["min_ceiling_ft"] for f in forecasts),
        "min_visibility_sm": _least(f["min_visibility_sm"] for f in forecasts),
        "stations": list({s["icaoId"]: s for f in forecasts for s in f["stations"]}.values()),
    }


@router.get("/api/briefing")
def briefing(dep: str, dest: str, stops: str = "", depart: datetime | None = None, ete_min: float | None = None) -> Briefing:
    """Everything the nav log's own leg math doesn't cover: adverse
    conditions (SIGMET/AIRMET), current conditions (METAR) and
    forecast (TAF-derived ceiling/visibility) along the route, and
    each airport's runways and radio frequencies.

    The forecast is for the flight: from `depart` (now when not given;
    UTC when naive) to an hour past arrival, `ete_min` after it (two
    hours when not given). It used to be read at the moment of asking,
    whatever time the pilot was planning to go. With stops (`stops`,
    "KDSM,KLNK"), along every hop and for every airport landed at.
    """
    r = load_route(dep, dest, stops)
    # Every airport landed at, once each -- a round trip lands where it
    # left -- not a waypoint flown through, which has no weather of its own.
    idents = tuple(dict.fromkeys(i for i, a in zip(r.idents, r.airports) if not a.get("fix")))
    where = {i: (a["lat"], a["lon"]) for i, a in zip(r.idents, r.airports)}
    start = time.time() if depart is None else (depart if depart.tzinfo else depart.replace(tzinfo=timezone.utc)).timestamp()
    window = (start, start + (ete_min if ete_min is not None else DEFAULT_ETE_MIN) * 60 + MARGIN_S)

    # Runways/frequencies are in this pool too, not just the three
    # weather calls -- on a freshly started container (an empty
    # in-memory table cache, see vfr.airports._TABLE_CACHE) those are
    # each a multi-megabyte CSV parse, the same order of cost as a
    # weather round trip, and were previously paying that cost after
    # the weather pool had already finished instead of alongside it.
    with ThreadPoolExecutor(max_workers=7) as pool:
        hazards_future = pool.submit(_along_hops, r, lambda a, b: weather.hazards_along_route(a, b))
        forecast_future = pool.submit(
            _along_hops, r, lambda a, b: weather.ceiling_visibility_along_route(a, b, window=window))
        metars_future = pool.submit(weather.metar_for_idents, list(idents))
        runways = {ident: pool.submit(airports.get_runways, ident) for ident in idents}
        frequencies = {ident: pool.submit(airports.get_frequencies, ident) for ident in idents}

        # Same reasoning as vfr.altitude.select_cruise_altitude: these are
        # three independent live aviationweather.gov calls, and a transient
        # failure on any one of them (a 504 on a slow bbox query) used to
        # take the whole briefing down even though the other two -- plus
        # runways/frequencies, unaffected local lookups -- had already
        # succeeded. Each is caught on its own and recorded in
        # weather_unavailable, so the page can say "hazards unavailable"
        # instead of failing to load at all.
        weather_unavailable = []
        try:
            hazards = list({h.get("raw") or repr(h): h for each in hazards_future.result() for h in each}.values())
        except weather.WeatherServiceError:
            hazards = []
            weather_unavailable.append("hazards")
        try:
            forecast = _joined_forecast(forecast_future.result())
        except weather.WeatherServiceError:
            forecast = {"min_ceiling_ft": None, "min_visibility_sm": None, "stations": []}
            weather_unavailable.append("forecast")
        try:
            metars = metars_future.result()
        except weather.WeatherServiceError:
            metars = {ident: None for ident in idents}
            weather_unavailable.append("metars")
        runways = {ident: f.result() for ident, f in runways.items()}
        frequencies = {ident: f.result() for ident, f in frequencies.items()}

    return {
        "hazards": hazards,
        "forecast": forecast,
        "metars": metars,
        "weather_unavailable": weather_unavailable,
        "vfr_not_recommended": weather.vfr_not_recommended_reasons(list(idents), metars, forecast),
        "airports": {
            ident: {"runways": runway_wind.with_winds(runways[ident], metars.get(ident), *where[ident]),
                    "frequencies": frequencies[ident]}
            for ident in idents
        },
    }
