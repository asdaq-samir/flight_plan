"""The plan, in the three pieces it naturally falls into. /api/plan still
returns all of it at once for anything that wants one call, but a page
should ask for these in order: the course draws immediately, the
checkpoints land a tenth of a second later, and the nav log -- which
needs terrain, obstacles, airspace and weather -- arrives when it can
without holding up the map."""
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError
from datetime import datetime

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from vfr import charts, geo, navlog
from vfr.config import VFR_SECTIONAL_MAX_ZOOM, VFR_SECTIONAL_MIN_ZOOM, VFR_TAC_MAX_ZOOM, VFR_TAC_MIN_ZOOM
from vfr.weather import WeatherServiceError

from ..common import DEFAULT_AIRCRAFT, line, load_route, ndjson
from ..planning import (
    aircraft_profile, altitude_plans, course_line, cruise_altitude, flight_totals, forecast_hour_for,
    no_altitude_detail,
)
from ..schemas import (
    AltitudeBreakdown,
    AltitudeChoice,
    AltitudeOption,
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


def departure_elevation(r) -> float | None:
    """The field the climb starts from, when the airports table knows
    it; None starts the log level at the first leg's altitude."""
    return r.departure.get("elevation_ft")


def planned_altitudes(
    r, fix_list: list, profile: dict, aircraft: str, choice: AltitudeChoice, fcst_hr: str = "06",
) -> tuple:
    """The altitude selection for the route's own fixes, the three plans
    it allows, and the one chosen: (selection, options, plan, failure).
    `plan` is None when no plan can fly the route -- some leg has no
    legal altitude at all, and the selection says why -- or when the
    winds the plans need could not be read, in which case `failure` is
    that WeatherServiceError: the selection itself still stands, and a
    caller can report it before the failure. `fcst_hr` is the winds
    forecast period for the departure (see forecast_hour_for)."""
    fixes = [(f["lat"], f["lon"]) for f in fix_list]
    selection = cruise_altitude(r.start, r.end, profile, aircraft, fixes=fixes, fcst_hr=fcst_hr)
    try:
        plans = altitude_plans(fix_list, selection, profile, aircraft, fcst_hr, departure_elevation(r))
    except WeatherServiceError as err:
        return selection, [], None, err
    if not plans:
        return selection, [], None, None
    options = [AltitudeOption(kind=kind, **{k: v for k, v in plans[kind].items() if k not in ("legs", "totals")})
               for kind in navlog.PLAN_KINDS]
    return selection, options, plans[choice], None


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
        tac_max_zoom=VFR_TAC_MAX_ZOOM,
        tac_min_zoom=VFR_TAC_MIN_ZOOM,
        chart_cycle=charts.serving_cycle(),
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
    ceiling band and each of its own components (airspace/freezing
    level/aircraft service ceiling), and the weather go/no-go flags.
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
    Class B shelf over that leg alone, the freezing level and the
    aircraft's service ceiling, on the hemispheric rule for the course
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
    scored, selected = scored_and_selected(r.dep_ident, r.dest_ident)
    profile = aircraft_profile(aircraft, cruise_tas_kt, fuel_burn_gph, usable_fuel_gal)
    fix_list = navlog.fixes(r.dep_ident, r.dest_ident, r.start, r.end, selected)
    fcst_hr = forecast_hour_for(depart)

    # The plans are worked out either way: beside a pilot's own altitude
    # they are what the planner would have flown, and the reasoning
    # still has its floor and ceiling to show.
    altitude_selection, options, chosen, failure = planned_altitudes(
        r, fix_list, profile, aircraft, altitude_choice, fcst_hr,
    )
    choice = None
    if altitude_ft is None:
        if failure is not None:
            raise failure
        if chosen is None:
            raise HTTPException(422, no_altitude_detail(altitude_selection))
        leg_list, choice = chosen["legs"], altitude_choice
        altitude_ft = leg_list[0]["altitude_ft"]
    else:
        leg_list = navlog.with_climbs(navlog.legs(fix_list, altitude_ft, profile, fcst_hr), departure_elevation(r), profile)

    return Plan(
        departure=r.departure,
        destination=r.destination,
        distance_nm=round(geo.distance_nm(*r.start, *r.end), 1),
        course_line=course_line(r.start, r.end),
        candidates=scored,
        selected=selected,
        legs=leg_list,
        totals=flight_totals(leg_list, profile, r, depart),
        altitude_ft=altitude_ft,
        altitude_selection=altitude_selection,
        altitude_options=options,
        altitude_choice=choice,
        winds_forecast_hr=fcst_hr,
        aircraft={"name": aircraft, **profile},
        max_zoom=VFR_SECTIONAL_MAX_ZOOM,
        min_zoom=VFR_SECTIONAL_MIN_ZOOM,
        tac_max_zoom=VFR_TAC_MAX_ZOOM,
        tac_min_zoom=VFR_TAC_MIN_ZOOM,
        chart_cycle=charts.serving_cycle(),
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

        yield line(NavLogStage(detail="Planning cruise altitudes (airspace, obstacles, aircraft performance and winds)…"))
        # On a side thread with a heartbeat, not inline: an uncached
        # selection on a bad aviationweather.gov day was observed
        # taking over two minutes, all of it silent -- and the webapp
        # proxy cuts a stream that has been silent that long, so the
        # browser saw the nav log simply end with no legs and no error.
        # A stage line every few seconds keeps the connection visibly
        # alive (and tells the pilot what it's still waiting on) for
        # however long the fetch takes. The three plans need the winds
        # at every legal altitude of every leg, so they are made here
        # too, before the altitude line, rather than leg by leg after
        # it -- and beside a pilot's own altitude as well, as what the
        # planner would have flown.
        with ThreadPoolExecutor(max_workers=1) as altitude_pool:
            future = altitude_pool.submit(planned_altitudes, r, fix_list, profile, aircraft, altitude_choice, fcst_hr)
            while True:
                try:
                    altitude_selection, options, chosen, failure = future.result(timeout=8)
                    break
                except FuturesTimeoutError:
                    yield line(NavLogStage(
                        detail="Planning cruise altitudes (still waiting on aviationweather.gov)…",
                    ))
        choice = None
        if altitude_ft is None:
            if failure is not None:
                # The selection stands -- terrain, airspace, the legal
                # altitudes -- even though the winds the plans need did
                # not come: say what was decided, then what failed.
                yield line(NavLogAltitude(
                    altitude_ft=altitude_selection.get("recommended_ft") or 0.0,
                    altitude_selection=altitude_selection,
                    winds_forecast_hr=fcst_hr,
                    aircraft={"name": aircraft, **profile},
                ))
                yield line(NavLogError(detail=str(failure)))
                return
            if chosen is None:
                yield line(NavLogError(detail=no_altitude_detail(altitude_selection)))
                return
            leg_list, choice = chosen["legs"], altitude_choice
        else:
            leg_list = None

        # Sent the moment it's decided, well before any leg -- the
        # checkpoints already on screen from /api/checkpoints can show
        # their own cruise altitude immediately rather than waiting on
        # the first leg to carry it.
        yield line(NavLogAltitude(
            altitude_ft=altitude_ft if leg_list is None else leg_list[0]["altitude_ft"],
            altitude_selection=altitude_selection,
            options=options,
            choice=choice,
            winds_forecast_hr=fcst_hr,
            aircraft={"name": aircraft, **profile},
        ))

        if leg_list is not None:
            for leg in leg_list:
                yield line(NavLogLeg.model_validate(leg))
        else:
            # A pilot's own altitude: the legs at it, the climb from the
            # field flown on the first of them. The winds were read for
            # the plans a moment ago, so this is quick.
            leg_list = navlog.with_climbs(navlog.legs(fix_list, altitude_ft, profile, fcst_hr), departure_elevation(r), profile)
            for leg in leg_list:
                yield line(NavLogLeg.model_validate(leg))

        yield line(NavLogDone(totals=flight_totals(leg_list, profile, r, depart)))

    return ndjson(lines(), NavLogError)
