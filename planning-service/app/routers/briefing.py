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
from vfr import airports, weather

from ..common import load_route
from ..schemas import Briefing

#: How long past the arrival the forecast is read over, and the flight
#: assumed when the caller does not say how long it is.
MARGIN_S = 3600
DEFAULT_ETE_MIN = 120

router = APIRouter()


@router.get("/api/briefing")
def briefing(dep: str, dest: str, depart: datetime | None = None, ete_min: float | None = None) -> Briefing:
    """Everything the nav log's own leg math doesn't cover: adverse
    conditions (SIGMET/AIRMET), current conditions (METAR) and
    forecast (TAF-derived ceiling/visibility) along the route, and
    each airport's runways and radio frequencies.

    The forecast is for the flight: from `depart` (now when not given;
    UTC when naive) to an hour past arrival, `ete_min` after it (two
    hours when not given). It used to be read at the moment of asking,
    whatever time the pilot was planning to go.
    """
    r = load_route(dep, dest)
    idents = (r.dep_ident, r.dest_ident)
    start = time.time() if depart is None else (depart if depart.tzinfo else depart.replace(tzinfo=timezone.utc)).timestamp()
    window = (start, start + (ete_min if ete_min is not None else DEFAULT_ETE_MIN) * 60 + MARGIN_S)

    # Runways/frequencies are in this pool too, not just the three
    # weather calls -- on a freshly started container (an empty
    # in-memory table cache, see vfr.airports._TABLE_CACHE) those are
    # each a multi-megabyte CSV parse, the same order of cost as a
    # weather round trip, and were previously paying that cost after
    # the weather pool had already finished instead of alongside it.
    with ThreadPoolExecutor(max_workers=7) as pool:
        hazards_future = pool.submit(weather.hazards_along_route, r.start, r.end)
        forecast_future = pool.submit(weather.ceiling_visibility_along_route, r.start, r.end, window=window)
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
            hazards = hazards_future.result()
        except weather.WeatherServiceError:
            hazards = []
            weather_unavailable.append("hazards")
        try:
            forecast = forecast_future.result()
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
            ident: {"runways": runways[ident], "frequencies": frequencies[ident]}
            for ident in idents
        },
    }
