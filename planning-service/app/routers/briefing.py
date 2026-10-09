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

from fastapi import APIRouter, HTTPException
from vfr import airports, airspace, altitude, geo, pattern, publications, runway_wind, tfr, weather

from ..common import load_route
from ..schemas import Briefing, Tfrs

#: How long past the arrival the forecast is read over, and the flight
#: assumed when the caller does not say how long it is.
MARGIN_S = 3600
DEFAULT_ETE_MIN = 120
#: How far either side of the time the flight gets to a TAF station its
#: forecast for that place is read over: a TAF's periods start on the
#: hour, and an estimate of when a place is reached is no closer than
#: that. The planner's own choice, as MARGIN_S is, not a rule's.
ETA_MARGIN_S = 3600

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


def _at_each_place(forecast: dict, path: list, start: float, ete_s: float) -> dict:
    """The route's forecast with each station placed along it: how far
    along (`along_track_nm`), when the flight gets there (`eta`, ISO
    UTC), and its TAF read for then (`eta_ceiling_ft`,
    `eta_visibility_sm`) with the forecast as issued (`raw`) -- for the
    Weather tab, which lays the route out place by place. The time is
    the flight's share of its ETE at that distance: the briefing is
    asked with the whole flight's time, not each leg's, and an hour
    either side (ETA_MARGIN_S) is wider than a climb's difference."""
    total = sum(geo.distance_nm(*a, *b) for a, b in zip(path, path[1:]))
    stations = []
    for station in forecast["stations"]:
        along = geo.along_path_nm(station["lat"], station["lon"], path) if len(path) > 1 else 0.0
        eta = start + (ete_s * along / total if total else 0.0)
        stations.append({**station, "along_track_nm": round(along, 1), "eta_s": eta})
    read = weather.tafs_over({s["icaoId"]: (s["eta_s"] - ETA_MARGIN_S, s["eta_s"] + ETA_MARGIN_S) for s in stations})
    placed = []
    for station in sorted(stations, key=lambda s: s["along_track_nm"]):
        at = read.get(station["icaoId"]) or {}
        placed.append({
            **{k: v for k, v in station.items() if k != "eta_s"},
            "eta": datetime.fromtimestamp(round(station["eta_s"]), timezone.utc).isoformat().replace("+00:00", "Z"),
            "eta_ceiling_ft": at.get("ceiling_ft"), "eta_visibility_sm": at.get("visibility_sm"), "raw": at.get("raw"),
        })
    return {**forecast, "stations": placed}


def _metars_by_route_ident(idents: tuple, source: dict) -> dict:
    """Each airport's METAR by the ident the route names it by, looked up
    by its station's (the airports table's, KC81 for C81) or that one."""
    found = weather.metar_for_idents(list(dict.fromkeys([*(source[i] for i in idents), *idents])))
    return {i: found.get(source[i]) or found.get(i) for i in idents}


@router.get("/api/tfrs")
def tfrs() -> Tfrs:
    """Every temporary flight restriction in force or to come, for the
    map: each NOTAM's areas, when, how high and why (vfr.tfr). A 502 when
    tfr.faa.gov does not answer, for the map to say so rather than draw
    a sky with none."""
    try:
        return {"tfrs": tfr.all_tfrs()}
    except tfr.TfrUnavailable as err:
        raise HTTPException(502, "tfr.faa.gov did not answer, so the map has no TFRs on it.") from err


@router.get("/api/briefing")
def briefing(dep: str, dest: str, stops: str = "", depart: datetime | None = None, ete_min: float | None = None) -> Briefing:
    """Everything the nav log's own leg math doesn't cover: adverse
    conditions (SIGMET/AIRMET), current conditions (METAR) and
    forecast (TAF-derived ceiling/visibility) along the route, and
    each airport's runways and radio frequencies, its traffic pattern
    (vfr.pattern) and the class of the airspace over it, for its
    pattern card and the radio calls.

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
    # Each one's own identifier in the airports table, which its runways,
    # radio and weather station go by: C81's is KC81, and asked as C81
    # it had no runways or frequencies.
    source = {i: a.get("ident") or i for i, a in zip(r.idents, r.airports)}
    start = time.time() if depart is None else (depart if depart.tzinfo else depart.replace(tzinfo=timezone.utc)).timestamp()
    ete_s = (ete_min if ete_min is not None else DEFAULT_ETE_MIN) * 60
    window = (start, start + ete_s + MARGIN_S)

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
        metars_future = pool.submit(_metars_by_route_ident, idents, source)
        path = [(a["lat"], a["lon"]) for a in r.airports]
        tfrs_future = pool.submit(
            tfr.along_route, path,
            datetime.fromtimestamp(window[0], timezone.utc), datetime.fromtimestamp(window[1], timezone.utc))
        pireps_future = pool.submit(weather.pireps_along_route, path)
        gairmets_future = pool.submit(weather.gairmets_along_route, path, window)
        runways = {ident: pool.submit(airports.get_runways, source[ident]) for ident in idents}
        frequencies = {ident: pool.submit(airports.get_frequencies, source[ident]) for ident in idents}

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
            forecast = _at_each_place(_joined_forecast(forecast_future.result()), path, start, ete_s)
        except weather.WeatherServiceError:
            forecast = {"min_ceiling_ft": None, "min_visibility_sm": None, "stations": []}
            weather_unavailable.append("forecast")
        try:
            metars = metars_future.result()
        except weather.WeatherServiceError:
            metars = {ident: None for ident in idents}
            weather_unavailable.append("metars")
        try:
            tfrs = tfrs_future.result()
        except tfr.TfrUnavailable:
            tfrs = []
            weather_unavailable.append("tfrs")
        try:
            pireps = pireps_future.result()
        except weather.WeatherServiceError:
            pireps = []
            weather_unavailable.append("pireps")
        try:
            gairmets = gairmets_future.result()
        except weather.WeatherServiceError:
            gairmets = []
            weather_unavailable.append("gairmets")
        runways = {ident: f.result() for ident, f in runways.items()}
        frequencies = {ident: f.result() for ident, f in frequencies.items()}

    shp_path = airspace.ensure_class_airspace_shapefile(altitude.DEFAULT_FAA_CACHE_DIR)
    airport_of = dict(zip(r.idents, r.airports))
    return {
        "hazards": hazards,
        "forecast": forecast,
        "metars": metars,
        "weather_unavailable": weather_unavailable,
        "tfrs": tfrs,
        "pireps": pireps,
        "gairmets": gairmets,
        "vfr_not_recommended": weather.vfr_not_recommended_reasons(list(idents), metars, forecast),
        "airports": {
            ident: {"name": airport_of[ident].get("name"),
                    "elevation_ft": airport_of[ident].get("elevation_ft"),
                    "airspace_class": airspace.surface_class_at(*where[ident], shp_path),
                    "pattern": pattern.pattern_at(ident, airport_of[ident].get("elevation_ft")),
                    "runways": pattern.with_traffic(
                        runway_wind.with_winds(runways[ident], metars.get(ident), *where[ident]), ident, *where[ident]),
                    "frequencies": frequencies[ident],
                    "airport_diagram_url": publications.airport_diagram_url(ident),
                    "airport_diagram_cycle": publications.airport_diagram_cycle(ident),
                    "chart_supplement_url": publications.chart_supplement_url(ident)}
            for ident in idents
        },
    }
