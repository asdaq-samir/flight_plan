"""The plan, in the three pieces it naturally falls into. A page asks
for these in order: the course draws immediately, the checkpoints land
a tenth of a second later, and the nav log -- which needs terrain,
obstacles, airspace and weather -- arrives when it can without holding
up the map. /api/plan returns all of it at once, and is what both
agents (nav-log-agent, crewai-agent) fetch their nav log from, so the
nav log an agent briefs is the one a pilot sees."""
import time
from concurrent.futures import Future, ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError
from dataclasses import dataclass
from datetime import datetime

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from vfr import charts, geo, navlog
from vfr.config import VFR_SECTIONAL_MAX_ZOOM, VFR_SECTIONAL_MIN_ZOOM
from vfr.weather import WeatherServiceError

from ..common import DEFAULT_AIRCRAFT, line, load_route, ndjson
from ..planning import (
    COMPUTE_LIMIT_S, StillComputing, aircraft_profile, altitude_plans, altitude_waiting_on, course_line,
    cruise_altitude, flight_totals, flight_window, forecast_hour_for, no_altitude_detail,
)
from ..schemas import (
    AltitudeBreakdown,
    AltitudeChoice,
    AltitudeOption,
    ChartLayer,
    ChartSheet,
    Checkpoints,
    Course,
    NavLogAltitude,
    NavLogDone,
    NavLogError,
    NavLogLeg,
    NavLogStage,
    Plan,
)
from ..scoring import scored_and_selected

router = APIRouter()

# How often the nav log stream says it is still working while the
# altitude plans are being made.
HEARTBEAT_S = 8


def chart_layers() -> list[ChartLayer]:
    """Every chart kind the map may draw, with its zoom range -- and,
    for an overlay, its sheets and where they are, which is how the
    map knows to offer the Chicago TAC over Chicago."""
    return [
        ChartLayer(
            kind=k.key, label=k.label, min_zoom=k.min_zoom, max_zoom=k.max_zoom, base=k.base, over=list(k.over),
            sheets=[] if k.base else [
                ChartSheet(name=name, label=charts.sheet_label(k, name), west=w, south=s, east=e, north=n)
                for name, (w, s, e, n) in charts.sheets(k)
            ],
        )
        for k in charts.KINDS.values()
    ]


def departure_elevation(r) -> float | None:
    """The field the climb starts from, when the airports table knows
    it; None starts the log level at the first leg's altitude."""
    return r.departure.get("elevation_ft")


@dataclass(frozen=True)
class Flown:
    """Legs to fly: the chosen plan's (`choice`), or at a pilot's own
    altitude (`choice` None), with the selection and the three plans
    beside them either way. `legs` of a plan is the planner's cached
    list: read it, never change it."""
    selection: dict
    options: list[AltitudeOption]
    choice: AltitudeChoice | None
    altitude_ft: float
    legs: list


@dataclass(frozen=True)
class Unflyable:
    """Some leg has no legal cruising altitude; the selection says why."""
    selection: dict


@dataclass(frozen=True)
class NoWinds:
    """The winds the legs need could not be read. The selection -- and
    the plans, when it was only a pilot's own altitude that failed --
    still stand, and a caller can report them before the failure."""
    selection: dict
    options: list[AltitudeOption]
    error: WeatherServiceError


def resolve_altitude(
    r, fix_list: list, profile: dict, aircraft: str, altitude_ft: float | None, choice: AltitudeChoice,
    fcst_hr: str = "06", window: tuple | None = None,
) -> Flown | Unflyable | NoWinds:
    """What the log flies, decided once for /api/plan and /api/navlog
    alike. It used to be a 4-tuple (selection, options, plan, failure)
    each endpoint decoded with its own order-dependent ladder, and the
    stream then worked out a pilot's own altitude's legs after its
    heartbeat had stopped -- a winds outage there was a silent retry
    cycle. `fcst_hr` is the winds forecast period for the departure (see
    forecast_hour_for), `window` the flight's own hours the go/no-go
    forecast is read over (see flight_window).

    The three plans are made beside a pilot's own altitude as well, as
    what the planner would have flown."""
    selection = cruise_altitude(r.start, r.end, profile, aircraft, fixes=_fixes(fix_list), fcst_hr=fcst_hr, window=window)
    try:
        plans = altitude_plans(fix_list, selection, profile, aircraft, fcst_hr, departure_elevation(r))
        failure = None
    except WeatherServiceError as err:
        plans, failure = {}, err
    options = [AltitudeOption(kind=kind, **{k: v for k, v in plans[kind].items() if k not in ("legs", "totals")})
               for kind in navlog.PLAN_KINDS] if plans else []
    if altitude_ft is not None:
        try:
            legs = navlog.with_climbs(navlog.legs(fix_list, altitude_ft, profile, fcst_hr), departure_elevation(r), profile)
        except WeatherServiceError as err:
            return NoWinds(selection, options, err)
        return Flown(selection, options, None, altitude_ft, legs)
    if failure is not None:
        return NoWinds(selection, options, failure)
    if not plans:
        return Unflyable(selection)
    legs = plans[choice]["legs"]
    return Flown(selection, options, choice, legs[0]["altitude_ft"], legs)


def _fixes(fix_list: list) -> list:
    return [(f["lat"], f["lon"]) for f in fix_list]


def _waited(future: Future, tick_s: float, stages):
    """Waits on `future` for at most COMPUTE_LIMIT_S, yielding the seconds
    waited every `tick_s`; returns its result, or raises StillComputing
    naming `stages()`. The one bounded wait, which /api/plan runs quietly
    and the stream turns into heartbeats; the work goes on in the
    background past the limit and its answer is cached, so asking again
    gets it."""
    started = time.monotonic()
    while True:
        try:
            return future.result(timeout=tick_s)
        except FuturesTimeoutError:
            elapsed = time.monotonic() - started
            if elapsed >= COMPUTE_LIMIT_S:
                raise StillComputing(elapsed, stages()) from None
            yield elapsed


def _result(waiting):
    """A _waited run to its end, reporting nothing."""
    while True:
        try:
            next(waiting)
        except StopIteration as done:
            return done.value


def _running_stages(r, fix_list: list, aircraft: str, fcst_hr: str, window: tuple | None = None) -> list:
    running = altitude_waiting_on(r.start, r.end, aircraft, _fixes(fix_list), fcst_hr, window)
    return [running] if running else []


@router.get("/api/course")
def course(dep: str, dest: str) -> Course:
    """Just the course line and its endpoints.

    Separate from detection so the chart can draw a line the instant two
    idents are entered. Reading tiles takes seconds even on the fast
    path, and there is no reason a pilot should watch an empty map for
    them.
    """
    r = load_route(dep, dest)
    return Course(
        departure=r.departure,
        destination=r.destination,
        distance_nm=round(geo.distance_nm(*r.start, *r.end), 1),
        bearing_deg=round(geo.bearing_deg(*r.start, *r.end)),
        course_line=course_line(r.start, r.end),
        max_zoom=VFR_SECTIONAL_MAX_ZOOM,
        min_zoom=VFR_SECTIONAL_MIN_ZOOM,
        chart_cycle=charts.serving_cycle(),
        chart_revision=charts.tiles_revision(charts.serving_cycle()),
        chart_tiles_base=charts.tiles_base_url(),
        chart_layers=chart_layers(),
    )


@router.get("/api/checkpoints")
def checkpoints(dep: str, dest: str) -> Checkpoints:
    """Scored candidates and the subset worth flying. Fast: the model is
    already loaded and the features are already built."""
    r = load_route(dep, dest)
    scored, selected = scored_and_selected(r.dep_ident, r.dest_ident)
    return Checkpoints(departure=r.departure, destination=r.destination, candidates=scored, selected=selected)


@router.get("/api/altitude-breakdown")
def altitude_breakdown(dep: str, dest: str, aircraft: str = DEFAULT_AIRCRAFT) -> AltitudeBreakdown:
    """The full select_cruise_altitude() breakdown for any route -- floor,
    ceiling band and each of its own components (airspace, aircraft
    service ceiling), and the weather go/no-go flags, icing among them.
    /api/navlog's "altitude" line carries the same dict for the route a
    pilot has open; this is a standalone read of it for any pair."""
    r = load_route(dep, dest)
    return cruise_altitude(r.start, r.end, aircraft_profile(aircraft), aircraft)


@router.get("/api/plan")
def plan(
    dep: str,
    dest: str,
    altitude_ft: float | None = None,
    altitude_choice: AltitudeChoice = "lowest",
    aircraft: str = DEFAULT_AIRCRAFT,
    cruise_tas_kt: float | None = None,
    fuel_burn_gph: float | None = None,
    usable_fuel_gal: float | None = None,
    depart: datetime | None = None,
) -> Plan:
    """The whole plan: course line, every scored candidate, the selected
    checkpoints, and a nav log leg between each consecutive pair.

    altitude_ft is optional. Omitted, vfr.altitude works out each leg's
    own legal altitudes -- clear of terrain and obstacles, under the
    Class B shelf over that leg alone and the aircraft's service
    ceiling, on the hemispheric rule for that leg's own course
    -- and vfr.navlog makes three plans of them: the lowest, the
    highest, and the fastest for the winds aloft. altitude_choice picks
    which one the legs fly, and the reasoning comes back with it, since
    "why am I at 6,500" is a question a pilot will actually ask.

    aircraft names a stock profile; cruise_tas_kt, fuel_burn_gph and
    usable_fuel_gal, when given, are a pilot's own aeroplane's numbers
    laid over it. depart, an ISO time (UTC when naive), picks the
    winds-aloft forecast period the legs are flown on -- the 6-, 12- or
    24-hour product, whichever is valid closest to the departure;
    without it, the 6-hour product, i.e. about now -- and whether the
    fuel reserve is the day or the night one.
    """
    r = load_route(dep, dest)
    profile = aircraft_profile(aircraft, cruise_tas_kt, fuel_burn_gph, usable_fuel_gal)
    fcst_hr = forecast_hour_for(depart)
    window = flight_window(depart, geo.distance_nm(*r.start, *r.end), profile["cruise_tas_kt"])

    # Everything slow inside the one bound, scoring included: the agents'
    # client waits exactly that long (vfr.planner_client).
    fixes: list = []

    def work():
        scored, selected = scored_and_selected(r.dep_ident, r.dest_ident)
        fixes.append(navlog.fixes(r.dep_ident, r.dest_ident, r.start, r.end, selected))
        return scored, selected, resolve_altitude(
            r, fixes[0], profile, aircraft, altitude_ft, altitude_choice, fcst_hr, window,
        )

    pool = ThreadPoolExecutor(max_workers=1)
    try:
        scored, selected, outcome = _result(_waited(
            pool.submit(work), COMPUTE_LIMIT_S,
            lambda: _running_stages(r, fixes[0], aircraft, fcst_hr, window) if fixes else ["model-service"],
        ))
    finally:
        pool.shutdown(wait=False)
    if isinstance(outcome, NoWinds):
        raise outcome.error
    if isinstance(outcome, Unflyable):
        raise HTTPException(422, no_altitude_detail(outcome.selection))
    leg_list = outcome.legs

    return Plan(
        departure=r.departure,
        destination=r.destination,
        distance_nm=round(geo.distance_nm(*r.start, *r.end), 1),
        course_line=course_line(r.start, r.end),
        candidates=scored,
        selected=selected,
        legs=leg_list,
        totals=flight_totals(leg_list, profile, r, depart),
        altitude_ft=outcome.altitude_ft,
        altitude_selection=outcome.selection,
        altitude_options=outcome.options,
        altitude_choice=outcome.choice,
        winds_forecast_hr=fcst_hr,
        aircraft={"name": aircraft, **profile},
        max_zoom=VFR_SECTIONAL_MAX_ZOOM,
        min_zoom=VFR_SECTIONAL_MIN_ZOOM,
        chart_cycle=charts.serving_cycle(),
        chart_revision=charts.tiles_revision(charts.serving_cycle()),
        chart_tiles_base=charts.tiles_base_url(),
        chart_layers=chart_layers(),
    )


@router.get("/api/navlog")
def navlog_stream(
    dep: str,
    dest: str,
    altitude_ft: float | None = None,
    altitude_choice: AltitudeChoice = "lowest",
    aircraft: str = DEFAULT_AIRCRAFT,
    cruise_tas_kt: float | None = None,
    fuel_burn_gph: float | None = None,
    usable_fuel_gal: float | None = None,
    depart: datetime | None = None,
) -> StreamingResponse:
    """Altitude and the dead-reckoning legs, as newline-delimited JSON --
    the slow half, because it reads terrain, the obstacle file, the
    airspace shapefile and live winds; asked for separately so none of
    that delays the chart. Each line is one app.schemas.NavLogMessage.

    Streamed rather than a single blocking response so a pilot sees the
    table fill in as it goes rather than a blank screen: a "stage" line
    before each real piece of work (scoring, the altitude plans), an
    "altitude" line the moment those are decided -- the three plans and
    the one chosen (altitude_choice, see /api/plan) with it -- one "leg"
    line per leg, then one "done" line with the totals, which need
    every leg in before they mean anything. Its own implementation, not
    a wrapper over /api/plan: that one commits to a single synchronous
    JSON response, and mixing a streaming and a non-streaming contract
    into one function would compromise both. The overlap is the same
    handful of calls into app.planning and vfr.navlog either way.

    An unflyable route (some leg with no legal cruising altitude at all)
    is reported as an "error" line, not an HTTP error status -- by the
    time that's known, a 200 and a stream of NDJSON have already gone
    out, and an HTTP status can't change after that.
    """
    r = load_route(dep, dest)

    def lines():
        yield line(NavLogStage(detail="Scoring checkpoints…"))
        _, selected = scored_and_selected(r.dep_ident, r.dest_ident)

        profile = aircraft_profile(aircraft, cruise_tas_kt, fuel_burn_gph, usable_fuel_gal)
        fix_list = navlog.fixes(r.dep_ident, r.dest_ident, r.start, r.end, selected)
        fcst_hr = forecast_hour_for(depart)
        window = flight_window(depart, geo.distance_nm(*r.start, *r.end), profile["cruise_tas_kt"])

        yield line(NavLogStage(detail="Planning cruise altitudes (airspace, obstacles, aircraft performance and winds)…"))
        # On a side thread with a heartbeat, not inline: an uncached
        # selection on a bad aviationweather.gov day was observed
        # taking over two minutes, all of it silent -- and the webapp
        # proxy cuts a stream that has been silent that long, so the
        # browser saw the nav log simply end with no legs and no error.
        # A stage line every few seconds keeps the connection visibly
        # alive (and tells the pilot what it's still waiting on) for
        # however long the fetch takes. The legs are worked out there
        # too, a pilot's own altitude's included, so none of the waiting
        # on winds happens after the heartbeat has stopped.
        # The heartbeat names what the selection is actually waiting on --
        # it used to say "aviationweather.gov" whatever the cause -- and
        # the wait ends at COMPUTE_LIMIT_S with an error line saying so,
        # rather than a stream that never ends. Not a `with` block: that
        # would wait on a stuck thread on the way out.
        altitude_pool = ThreadPoolExecutor(max_workers=1)
        try:
            waiting = _waited(
                altitude_pool.submit(
                    resolve_altitude, r, fix_list, profile, aircraft, altitude_ft, altitude_choice, fcst_hr, window,
                ),
                HEARTBEAT_S, lambda: _running_stages(r, fix_list, aircraft, fcst_hr, window),
            )
            while True:
                try:
                    elapsed = next(waiting)
                except StopIteration as done:
                    outcome = done.value
                    break
                named = altitude_waiting_on(r.start, r.end, aircraft, _fixes(fix_list), fcst_hr, window)
                yield line(NavLogStage(detail=(
                    f"Planning cruise altitudes ({elapsed:.0f} s, waiting on {named})…" if named
                    else f"Planning cruise altitudes ({elapsed:.0f} s, working out the winds for each plan)…"
                )))
        finally:
            altitude_pool.shutdown(wait=False)

        aircraft_line = {"name": aircraft, **profile}
        if isinstance(outcome, Unflyable):
            yield line(NavLogError(detail=no_altitude_detail(outcome.selection)))
            return
        if isinstance(outcome, NoWinds):
            # The selection stands -- terrain, airspace, the legal
            # altitudes -- even though the winds did not come: say what
            # was decided, then what failed.
            yield line(NavLogAltitude(
                flown=None,
                altitude_ft=None,
                altitude_selection=outcome.selection,
                options=outcome.options,
                winds_forecast_hr=fcst_hr,
                aircraft=aircraft_line,
            ))
            yield line(NavLogError(detail=str(outcome.error)))
            return

        # Before any leg -- the checkpoints already on screen from
        # /api/checkpoints can show their own cruise altitude
        # immediately rather than waiting on the first leg to carry it.
        yield line(NavLogAltitude(
            flown=outcome.choice or "custom",
            altitude_ft=outcome.altitude_ft,
            altitude_selection=outcome.selection,
            options=outcome.options,
            winds_forecast_hr=fcst_hr,
            aircraft=aircraft_line,
        ))
        for leg in outcome.legs:
            yield line(NavLogLeg.model_validate(leg))

        yield line(NavLogDone(totals=flight_totals(outcome.legs, profile, r, depart)))

    return ndjson(lines(), NavLogError)
