"""The plan, in the three pieces it naturally falls into. A page asks
for these in order: the course draws immediately, the checkpoints land
a tenth of a second later, and the nav log -- which needs terrain,
obstacles, airspace and weather -- arrives when it can without holding
up the map. /api/plan returns all of it at once, and is what both
agents (nav-log-agent, crewai-agent) fetch their nav log from, so the
nav log an agent briefs is the one a pilot sees.

A route may land at stops on the way (`stops`, "KDSM,KLNK"): each flight
between two landings -- a hop -- is planned as a route of its own, with
its own chart read, altitude plan, climb from the field and fuel check,
the hops planned at once, and the nav log runs on through each stop."""
import re
import time
from concurrent.futures import Future, ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from vfr import airspace, altitude, chartlabels, charts, elevation, faa_data, fixes, geo, navlog, places, sun
from vfr.profile import route_profile as side_view
from vfr.terrain import M_TO_FT
from vfr.config import DATA_DIR, VFR_SECTIONAL_MAX_ZOOM, VFR_SECTIONAL_MIN_ZOOM
from vfr.weather import WeatherServiceError

from .. import chart_model, foreflight, prefetch
from ..common import DEFAULT_AIRCRAFT, Route, line, load_route, ndjson
from ..planning import (
    COMPUTE_LIMIT_S, StillComputing, aircraft_profile, altitude_plans, altitude_waiting_on, class_b_detours,
    cruise_altitude, flight_totals, flight_window, forecast_hour_for, join_selections, no_altitude, no_altitude_detail,
    own_altitude_caution, route_line, route_totals,
)
from ..schemas import (
    AltitudeChoice,
    AltitudeOption,
    ChartLayer,
    ChartSheet,
    Checkpoints,
    ChartInfo,
    Course,
    NavLogAltitude,
    NavLogDone,
    NavLogError,
    NavLogLeg,
    NavLogStage,
    Plan,
    RouteProfile,
    Totals,
)
from ..scoring import route_checkpoints

router = APIRouter()

# A pilot's own cruise speed: above zero, since every leg's time divides
# by it -- zero was a ZeroDivisionError and a 500 rather than a 422.
CruiseTas = Annotated[float | None, Query(gt=0, le=1000)]
# The power a pilot's own cruise figures are at, in percent: from the
# lowest a handbook's cruise table goes, about 40, to full power.
CruisePower = Annotated[float | None, Query(ge=40, le=100)]


@dataclass
class PlanQuery:
    """What /api/plan and /api/navlog are asked, read from the query by
    FastAPI (`Depends()`): the route, a pilot's own altitude or the plan
    chosen, the aeroplane -- a stock profile, a pilot's own figures laid
    over it -- and the departure time. One list where the two routes each
    spelled out all twelve, and one `profile()` built from it."""

    dep: str
    dest: str
    #: The stops landed at on the way, in order: "KDSM,KLNK".
    stops: str = ""
    altitude_ft: float | None = None
    altitude_choice: AltitudeChoice = "fastest"
    aircraft: str = DEFAULT_AIRCRAFT
    cruise_tas_kt: CruiseTas = None
    fuel_burn_gph: float | None = None
    usable_fuel_gal: float | None = None
    climb_tas_kt: CruiseTas = None
    climb_fuel_burn_gph: float | None = None
    cruise_power_pct: CruisePower = None
    depart: datetime | None = None
    #: The pilot will have a Class B clearance: its shelves are no
    #: ceiling, and the route is planned through it (vfr.altitude).
    class_b_clearance: bool = False
    #: Points' own altitudes, feet above sea level: "VPBNG:4500,KMSN:1900".
    #: A waypoint's is flown to it, the hop into it at that altitude (where
    #: a pilot crosses it); an airport's is its pattern, which a flight
    #: landing there comes down to. The rest of the route as planned.
    altitudes: str = ""
    #: Checkpoints between the route's own points, as the planner picks
    #: them off the chart. False, the legs run from point to point alone
    #: -- the departure, the stops, the destination -- as a pilot whose
    #: map shows no waypoints flies it; and nothing is scored for them.
    checkpoints: bool = True

    def profile(self) -> dict:
        return aircraft_profile(
            self.aircraft, self.cruise_tas_kt, self.fuel_burn_gph, self.usable_fuel_gal,
            self.climb_tas_kt, self.climb_fuel_burn_gph, self.cruise_power_pct,
        )

    def own_altitudes(self) -> dict[str, float]:
        """`altitudes` by ident; a 422 for one that is not "IDENT:FEET",
        or not a VFR altitude: under 18,000 ft MSL, the floor of Class A
        (14 CFR 71.33), where no flight is VFR (14 CFR 91.135)."""
        out = {}
        for part in filter(None, (p.strip() for p in self.altitudes.split(","))):
            ident, _, feet = part.partition(":")
            if not POINT_ALTITUDE.fullmatch(part) or not 0 < float(feet) < 18_000:
                raise HTTPException(422, f"{part!r} is not a point's altitude: an ident and feet, as VPBNG:4500.")
            out[ident.upper()] = float(feet)
        return out


POINT_ALTITUDE = re.compile(r"[A-Za-z0-9]{2,5}:\d{1,5}")

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
    it; a present position's own altitude, the GPS's, where it has one --
    a Direct-To in the air climbs from where the airplane is, not from the
    ground or level at the first leg's altitude; None starts the log level
    at the first leg's altitude -- as a hop out of a waypoint does, flown
    through at cruise.

    Never under the ground at the position (USGS 3DEP, vfr.elevation: the
    first of the route's terrain samples, read already for its floor): a
    phone indoors gave its GPS altitude as 0 ft MSL where the ground is
    730 ft, and the log climbed from under it. Where the ground cannot be
    read, the GPS's altitude as it is."""
    if r.takes_off:
        return r.departure.get("elevation_ft")
    altitude_ft = r.dep_airport.get("altitude_ft")
    if altitude_ft is None:
        return None
    point = (r.dep_airport["lat"], r.dep_airport["lon"])
    try:
        ground_ft = elevation.get_elevations_m([point])[point] * M_TO_FT
    except Exception:  # noqa: BLE001 -- the ground unread is the GPS's word alone, not a failed plan
        return altitude_ft
    return max(altitude_ft, round(ground_ft))


@dataclass(frozen=True)
class Flown:
    """Legs to fly: the chosen plan's (`choice`), or at a pilot's own
    altitude (`choice` None), with the selection and the four plans
    beside them either way. `legs` of a plan is the planner's cached
    list: read it, never change it. `by_hop`, a route with stops' legs
    hop by hop (one list for a route without), for each hop's totals."""
    selection: dict
    options: list[AltitudeOption]
    choice: AltitudeChoice | None
    altitude_ft: float
    legs: list
    by_hop: tuple = ()
    #: For each hop flown at a pilot's own altitude, what is wrong with it
    #: (own_altitude_caution).
    cautions: tuple = ()

    @property
    def hop_legs(self) -> list:
        return list(self.by_hop) or [self.legs]


@dataclass(frozen=True)
class Unflyable:
    """Some leg has no legal cruising altitude; the selection says why.
    `between`, the hop of a route with stops it is on."""
    selection: dict
    between: tuple[str, str] | None = None


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
    fcst_hr: str = "06", window: tuple | None = None, class_b_cleared: bool = False,
) -> Flown | Unflyable | NoWinds:
    """What the log flies, decided once for /api/plan and /api/navlog
    alike. It used to be a 4-tuple (selection, options, plan, failure)
    each endpoint decoded with its own order-dependent ladder, and the
    stream then worked out a pilot's own altitude's legs after its
    heartbeat had stopped -- a winds outage there was a silent retry
    cycle. `fcst_hr` is the winds forecast period for the departure (see
    forecast_hour_for), `window` the flight's own hours the go/no-go
    forecast is read over (see flight_window).

    The four plans are made beside a pilot's own altitude as well, as
    what the planner would have flown."""
    selection = cruise_altitude(r.start, r.end, profile, aircraft, fixes=_fixes(fix_list), fcst_hr=fcst_hr, window=window,
                                class_b_cleared=class_b_cleared)
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
        caution = own_altitude_caution(selection, legs, (r.dep_ident, r.dest_ident))
        return Flown(selection, options, None, altitude_ft, legs, cautions=(caution,) if caution else ())
    if failure is not None:
        return NoWinds(selection, options, failure)
    if not plans:
        return Unflyable(selection)
    legs = plans[choice]["legs"]
    return Flown(selection, options, choice, legs[0]["altitude_ft"], legs)


def _fixes(fix_list: list) -> list:
    return [(f["lat"], f["lon"]) for f in fix_list]


@dataclass(frozen=True)
class HopRun:
    """One hop's planning, as a route without stops is planned: its fixes,
    the winds forecast period and go/no-go window it is flown in, and the
    departure time its fuel reserve is judged by (None, as the route's,
    when none was given)."""
    hop: Route
    fixes: list
    fcst_hr: str
    window: tuple
    depart: datetime | None


def hop_runs(r: Route, by_hop: list, depart: datetime | None, profile: dict) -> list[HopRun]:
    """Each hop of `r` ready to plan, `by_hop` its selected checkpoints.
    A hop after the first is flown when the ones before it are done, at
    cruise speed with no time on the ground -- an estimate, to the hour
    its winds and forecast are read for. The first is the route's own:
    a route without stops is planned exactly as it always was."""
    runs, elapsed_h = [], 0.0
    tas = max(profile["cruise_tas_kt"], 1.0)
    for i, (hop, selected) in enumerate(zip(r.hops, by_hop)):
        if i == 0:
            when = depart
        else:
            start = datetime.now(timezone.utc) if depart is None else (
                depart if depart.tzinfo else depart.replace(tzinfo=timezone.utc))
            when = start + timedelta(hours=elapsed_h)
        runs.append(HopRun(
            hop, navlog.fixes(hop.dep_ident, hop.dest_ident, hop.start, hop.end, selected),
            forecast_hour_for(when), flight_window(when, hop.length_nm, tas),
            when if depart is not None else None,
        ))
        elapsed_h += hop.length_nm / tas
    return runs


def resolve_run(run: HopRun, profile: dict, q: "PlanQuery") -> "Flown | Unflyable | NoWinds":
    # The hop into a waypoint with an altitude of its own is flown at it.
    own = None if run.hop.lands else q.own_altitudes().get(run.hop.dest_ident)
    return resolve_altitude(
        run.hop, run.fixes, profile, q.aircraft, q.altitude_ft if own is None else own, q.altitude_choice,
        run.fcst_hr, run.window, q.class_b_clearance,
    )


def join_options(options_by_hop: list[list[AltitudeOption]], lengths: list[float]) -> list[AltitudeOption]:
    """The four plans of a route with stops: each the same plan flown on
    every hop, its steps in turn and its costs summed -- the tailwind
    weighted by each hop's length. None where a hop's plans could not be
    made."""
    if len(options_by_hop) == 1:
        return options_by_hop[0]
    if any(not options for options in options_by_hop):
        return []
    joined = []
    for kind in navlog.PLAN_KINDS:
        mine = [next(o for o in options if o.kind == kind) for options in options_by_hop]

        def total(attr, mine=mine):
            values = [getattr(o, attr) for o in mine]
            return None if any(v is None for v in values) else round(sum(values), 1)

        winds = [(o.tailwind_kt, n) for o, n in zip(mine, lengths) if o.tailwind_kt is not None]
        weight = sum(n for _, n in winds)
        joined.append(AltitudeOption(
            kind=kind, steps=[step for o in mine for step in o.steps],
            ete_min=total("ete_min"), fuel_gal=total("fuel_gal"),
            climb_penalty_min=round(sum(o.climb_penalty_min for o in mine), 1),
            tailwind_kt=round(sum(t * n for t, n in winds) / weight, 1) if weight else None,
            unflyable_legs=sum(o.unflyable_legs for o in mine),
            legs_without_wind=sum(o.legs_without_wind for o in mine),
            needs_oxygen=any(o.needs_oxygen for o in mine),
        ))
    return joined


def join_outcomes(runs: list[HopRun], outcomes: list) -> "Flown | Unflyable | NoWinds":
    """What a route with stops flies, from each hop's own outcome: the
    first hop with no legal altitude makes the route unflyable, and says
    which hop; a winds outage on any hop stops the legs, the selection
    standing; otherwise the legs run on through each stop."""
    if len(outcomes) == 1:
        return outcomes[0]
    for run, outcome in zip(runs, outcomes):
        if isinstance(outcome, Unflyable):
            return Unflyable(outcome.selection, between=(run.hop.dep_ident, run.hop.dest_ident))
    lengths = [run.hop.length_nm for run in runs]
    offsets = [sum(lengths[:i]) for i in range(len(lengths))]
    selection = join_selections([o.selection for o in outcomes], offsets)
    options = join_options([o.options for o in outcomes], lengths)
    for outcome in outcomes:
        if isinstance(outcome, NoWinds):
            return NoWinds(selection, options, outcome.error)
    # The plan the route flies is the one its hops are flown on, a hop
    # into a waypoint at its own altitude (resolve_run) or not.
    planned = next((o for o in outcomes if o.choice is not None), outcomes[0])
    return Flown(
        selection, options, planned.choice, planned.altitude_ft,
        [leg for o in outcomes for leg in o.legs], tuple(o.legs for o in outcomes),
        tuple(c for o in outcomes for c in o.cautions),
    )


def unflyable_parts(outcome: Unflyable, runs: list[HopRun]) -> tuple[dict, list[dict]]:
    """no_altitude's words for a route with no legal altitude, and the
    waypoints round the Class B airspace that stops it, best first
    (class_b_detours), each with its place in the stops: on the hop it
    fails on."""
    at = next((i for i, run in enumerate(runs) if (run.hop.dep_ident, run.hop.dest_ident) == outcome.between), 0)
    hop = runs[at].hop
    ways = class_b_detours(outcome.selection, hop.start, hop.end)
    why = no_altitude(outcome.selection, outcome.between, ways[0] if ways else None, _stuck_where(outcome.selection, hop))
    return why, [{**way, "stop_index": at, "description": _where(way["ident"])} for way in ways]


def _stuck_where(selection: dict, hop: Route) -> str | None:
    """Where on the hop the altitude runs out, by the route's own points
    as the pilot entered them, at the pilot's ask: the middle of the first
    stretch with no legal altitude, from the nearer of the hop's ends --
    "540 nm past KDLH", "120 nm before KBUR" -- for the one line that says
    what stops the plan."""
    stuck = next((s for s in selection.get("segments", []) if not s.get("candidates_ft")), None)
    if stuck is None or stuck.get("from_nm") is None or stuck.get("to_nm") is None:
        return None
    middle = (stuck["from_nm"] + stuck["to_nm"]) / 2
    left = max(0.0, hop.length_nm - middle)
    return f"{middle:,.0f} nm past {hop.dep_ident}" if middle <= left else f"{left:,.0f} nm before {hop.dest_ident}"


def field_pattern_ft(ident: str, airport: dict) -> float | None:
    """A field's traffic pattern altitude above sea level
    (vfr.faa_data.pattern_agl_ft), to the nearest hundred feet, as a pilot
    flies it; None where its elevation is not known."""
    elevation = airport.get("elevation_ft")
    if elevation is None:
        return None
    return round((elevation + faa_data.pattern_agl_ft(ident, DATA_DIR / "raw" / "faa_nasr")) / 100) * 100


def pattern_altitude(flight: Route, own: dict[str, float] | None = None) -> float | None:
    """The altitude a flight comes down to: the traffic pattern's at the
    field it lands at -- the pilot's own for it (PlanQuery.altitudes), else
    field_pattern_ft. None where it ends in the air, or the field's
    elevation is not known."""
    if not flight.lands:
        return None
    if own and flight.dest_ident in own:
        return own[flight.dest_ident]
    return field_pattern_ft(flight.dest_ident, flight.dest_airport)


def flown_legs(r: Route, runs: list[HopRun], outcome: Flown, own: dict[str, float] | None = None) -> list:
    """The legs a pilot flies, with each flight's tops of climb and
    descent placed (navlog.with_descents): from one landing to the next,
    through any waypoints, down to the pattern at the end of each --
    `own`, a pilot's own patterns by ident."""
    out, at = [], 0
    for flight in r.flights:
        hops = len(flight.idents) - 1
        legs = [leg for legs in outcome.hop_legs[at:at + hops] for leg in legs]
        fix_list = [fix for k, run in enumerate(runs[at:at + hops]) for fix in (run.fixes if k == 0 else run.fixes[1:])]
        out.extend(navlog.with_descents(legs, fix_list, pattern_altitude(flight, own)))
        at += hops
    return out


def _where(ident: str) -> str | None:
    fix = fixes.find_fix(ident)
    return places.describe(fix["lat"], fix["lon"]) if fix else None


def totals_of(r: Route, runs: list[HopRun], outcome: "Flown", profile: dict) -> dict:
    """The trip's totals: each flight's own, from one landing to the next
    through any waypoints (Route.flights), with its fuel check, joined
    (app.planning.route_totals)."""
    per_flight, at = [], 0
    for flight in r.flights:
        hops = len(flight.idents) - 1
        legs = [leg for legs in outcome.hop_legs[at:at + hops] for leg in legs]
        per_flight.append(flight_totals(legs, profile, flight, runs[at].depart))
        at += hops
    return route_totals(per_flight, r.flights)


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


def _running_stages(run: HopRun, q: "PlanQuery") -> list:
    running = _waiting_on(run, q)
    return [running] if running else []


def _waiting_on(run: HopRun, q: "PlanQuery") -> str:
    return altitude_waiting_on(
        run.hop.start, run.hop.end, q.aircraft, _fixes(run.fixes), run.fcst_hr, run.window, q.class_b_clearance)


def _chart_info() -> dict:
    cycle = charts.serving_cycle()
    return {
        "max_zoom": VFR_SECTIONAL_MAX_ZOOM, "min_zoom": VFR_SECTIONAL_MIN_ZOOM, "chart_cycle": cycle,
        "chart_revision": charts.tiles_revision(cycle), "chart_tiles_base": charts.tiles_base_url(),
        "chart_layers": chart_layers(),
    }


@router.get("/api/chart")
def chart_info() -> ChartInfo:
    """The chart the map draws, for a map with no route on it yet: the
    planner's page opens on a search bar over the chart, as Maps does."""
    return ChartInfo(**_chart_info())


@router.get("/api/route-profile")
def route_profile(dep: str, dest: str, stops: str = "") -> RouteProfile:
    """The route's side view: the ground under it every 2 nm and the
    Class B, C and D airspace it passes through, floor and ceiling, along
    the whole route through its stops (vfr.profile) -- for the page to
    draw the plan's altitudes, climbs and descents over."""
    r = load_route(dep, dest, stops)
    shp_path = airspace.ensure_class_airspace_shapefile(altitude.DEFAULT_FAA_CACHE_DIR)
    return side_view([(a["lat"], a["lon"]) for a in r.airports], shp_path)


@router.get("/api/course")
def course(dep: str, dest: str, stops: str = "") -> Course:
    """Just the course line and its endpoints, through any stops.

    Separate from detection so the chart can draw a line the instant two
    idents are entered. Reading tiles takes seconds even on the fast
    path, and there is no reason a pilot should watch an empty map for
    them.

    And the route's slow parts are started here, the first thing the web
    app asks for a route: the chart's read and the ground under it, on
    threads of their own (app.prefetch), so the nav log asked for beside
    this finds them under way or done.
    """
    r = load_route(dep, dest, stops)
    # Asked before the reads below start: read is read, not under way.
    ready = all(chart_model.corridor_kept(chartlabels.route_key(hop.dep_ident, hop.dest_ident)) for hop in r.hops)
    prefetch.route(dep, dest, stops)
    first = r.hops[0]
    shp = airspace.ensure_class_airspace_shapefile(altitude.DEFAULT_FAA_CACHE_DIR)

    def classed(end: dict) -> dict:
        if end.get("kind", "airport") != "airport":
            return end
        return {**end, "airspace_class": airspace.surface_class_at(end["lat"], end["lon"], shp),
                "pattern_altitude_ft": field_pattern_ft(end["ident"], end)}

    return Course(
        departure=classed(r.departure),
        destination=classed(r.destination),
        stops=[classed(s) for s in r.stops],
        distance_nm=round(r.distance_nm, 1),
        bearing_deg=round(geo.bearing_deg(*first.start, *first.end)),
        course_line=route_line(r),
        checkpoints_ready=ready,
        **_chart_info(),
    )


def _name_waypoints(r: Route, selected: list) -> None:
    """Each selected checkpoint's name in the route's ForeFlight pack, the
    pack's own naming (app.foreflight), for the web app's flight plan link
    to name them by (CONTPACK@LAKE_ZURICH)."""
    names = foreflight.waypoint_names(r.dep_ident, r.dest_ident, foreflight.from_candidates(selected))
    for c, name in zip(selected, names):
        c["waypoint"] = name


@router.get("/api/checkpoints")
def checkpoints(dep: str, dest: str, stops: str = "") -> Checkpoints:
    """Scored candidates and the subset worth flying, hop by hop along
    the whole route: fast once each hop's chart has been read, a few
    seconds for its first time."""
    r = load_route(dep, dest, stops)
    scored, selected, _ = route_checkpoints(r)
    _name_waypoints(r, selected)
    return Checkpoints(
        departure=r.departure, destination=r.destination, stops=r.stops, candidates=scored, selected=selected,
    )


@router.get(
    "/api/foreflight-pack/{route}/{file}",
    response_class=Response,
    responses={200: {"content": {"application/zip": {}}, "description": "The pack, a ZIP"}},
)
def foreflight_pack(route: str, file: str, request: Request) -> Response:
    """The route's checkpoints as a ForeFlight content pack (app.foreflight),
    for ForeFlight's own link to the pack, or to download. `route` is its
    idents dash-joined, KORD-KDLH or C81-KRYV-KDLH, and the checkpoints
    are the planner's own selection for it; `file`, the pack's name, which
    ForeFlight takes from the end of the address. A 422 for a route it
    cannot read.

    ForeFlight's downloader asks for the file several times over and
    wants its size: so the same address is always the same bytes, a Range
    is answered with a 206 of just those bytes, and the size goes with
    every answer (a 416 for a range past the end)."""
    try:
        idents = foreflight.route_idents(route)
    except ValueError as e:
        raise HTTPException(422, f"The pack's address: {e}") from None
    r = load_route(idents[0], idents[-1], ",".join(idents[1:-1]))
    _, selected, _ = route_checkpoints(r)
    version = foreflight.version_at(datetime.now(timezone.utc))
    body = foreflight.pack_zip(foreflight.pack_files(list(r.idents), route_line(r), foreflight.from_candidates(selected), version))
    headers = {
        "Content-Disposition": f'attachment; filename="{foreflight.file_name(list(r.idents))}"',
        "Accept-Ranges": "bytes",
    }
    try:
        wanted = foreflight.byte_range(request.headers.get("range"), len(body))
    except ValueError:
        return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{len(body)}"})
    if wanted is None:
        return Response(body, media_type="application/zip", headers=headers)
    start, end = wanted
    return Response(
        body[start:end + 1], status_code=206, media_type="application/zip",
        headers={**headers, "Content-Range": f"bytes {start}-{end}/{len(body)}"},
    )


@router.get("/api/plan")
def plan(q: Annotated[PlanQuery, Depends()]) -> Plan:
    """The whole plan: course line, every scored candidate, the selected
    checkpoints, and a nav log leg between each consecutive pair.

    altitude_ft is optional. Omitted, vfr.altitude works out each leg's
    own legal altitudes -- clear of terrain and obstacles, under the
    Class B shelf over that leg alone and the aircraft's service
    ceiling, on the hemispheric rule for that leg's own course
    -- and vfr.navlog makes four plans of them: the lowest, the
    highest, the fastest for the winds aloft, and the one that burns the
    least fuel, climb and cruise. altitude_choice picks
    which one the legs fly -- the fastest unless asked otherwise, the
    plan a pilot with the winds in hand picks (it was the lowest, as the
    predictable one) -- and the reasoning comes back with it, since
    "why am I at 6,500" is a question a pilot will actually ask.

    aircraft names a stock profile; cruise_tas_kt, fuel_burn_gph,
    usable_fuel_gal, climb_tas_kt, climb_fuel_burn_gph and
    cruise_power_pct (the power the cruise figures are at), when given,
    are a pilot's own aeroplane's numbers laid over it. Each leg flies
    them in its own air: the cruise figures are the aeroplane's at a
    reference altitude on a standard day, and the forecast temperature
    at the leg's altitude gives the density altitude they are flown at
    (vfr.performance). depart, an ISO time (UTC when naive), picks the
    winds-aloft forecast period the legs are flown on -- the 6-, 12- or
    24-hour product, whichever is valid closest to the departure;
    without it, the 6-hour product, i.e. about now -- and whether the
    fuel reserve is the day or the night one.
    """
    r = load_route(q.dep, q.dest, q.stops)
    own = q.own_altitudes()
    profile = q.profile()

    # Everything slow inside the one bound, scoring included: the agents'
    # client waits exactly that long (vfr.planner_client).
    runs: list[HopRun] = []

    def work():
        scored, selected, by_hop = route_checkpoints(r) if q.checkpoints else ([], [], [[] for _ in r.hops])
        _name_waypoints(r, selected)
        runs.extend(hop_runs(r, by_hop, q.depart, profile))
        return scored, selected, join_outcomes(runs, [resolve_run(run, profile, q) for run in runs])

    pool = ThreadPoolExecutor(max_workers=1)
    try:
        scored, selected, outcome = _result(_waited(
            pool.submit(work), COMPUTE_LIMIT_S,
            lambda: [stage for run in runs for stage in _running_stages(run, q)] if runs else ["chart"],
        ))
    finally:
        pool.shutdown(wait=False)
    if isinstance(outcome, NoWinds):
        raise outcome.error
    if isinstance(outcome, Unflyable):
        _, ways = unflyable_parts(outcome, runs)
        raise HTTPException(422, no_altitude_detail(outcome.selection, outcome.between, ways[0] if ways else None))
    leg_list = flown_legs(r, runs, outcome, own)

    return Plan(
        departure=r.departure,
        destination=r.destination,
        stops=r.stops,
        distance_nm=round(r.distance_nm, 1),
        course_line=route_line(r),
        candidates=scored,
        selected=selected,
        legs=leg_list,
        totals=totals_of(r, runs, outcome, profile),
        altitude_ft=outcome.altitude_ft,
        altitude_selection=outcome.selection,
        altitude_options=outcome.options,
        altitude_choice=outcome.choice,
        altitude_cautions=list(outcome.cautions),
        aircraft={"name": q.aircraft, **profile},
        **_chart_info(),
    )


#: The longest local flight planned: a day's flying.
LocalMinutes = Annotated[float, Query(gt=0, le=12 * 60)]


@router.get("/api/local-flight")
def local_flight(q: Annotated[PlanQuery, Depends()], duration_min: LocalMinutes = 60.0) -> Totals:
    """A flight that leaves and lands at the same airport -- the pattern,
    practice approaches, an hour's sightseeing: no course and no legs to
    plan, so its totals are the time aloft at the aeroplane's cruise burn,
    with the fuel check a route's has (the start and taxi allowance, the
    VFR reserve by day or by night, the usable fuel). Night is judged at
    the field at both ends of the time aloft. A 422 for a route that is
    not one airport to itself."""
    r = load_route(q.dep, q.dest, q.stops)
    if r.dep_ident != r.dest_ident or len(r.idents) != 2:
        raise HTTPException(422, "A local flight leaves and lands at the same airport, with no stops.")
    profile = q.profile()
    fuel = round(profile["fuel_burn_gph"] * duration_min / 60, 1)
    night = None
    if q.depart is not None:
        depart = q.depart if q.depart.tzinfo else q.depart.replace(tzinfo=timezone.utc)
        night = sun.is_night(*r.start, depart) or sun.is_night(*r.start, depart + timedelta(minutes=duration_min))
    return Totals(
        distance_nm=0.0, ete_min=duration_min, fuel_gal=fuel, unflyable_legs=0, legs_without_wind=0,
        **navlog.fuel_plan(fuel, profile, night),
    )


@router.get("/api/navlog")
def navlog_stream(q: Annotated[PlanQuery, Depends()]) -> StreamingResponse:
    """Altitude and the dead-reckoning legs, as newline-delimited JSON --
    the slow half, because it reads terrain, the obstacle file, the
    airspace shapefile and live winds; asked for separately so none of
    that delays the chart. Each line is one app.schemas.NavLogMessage.

    Streamed rather than a single blocking response so a pilot sees the
    table fill in as it goes rather than a blank screen: a "stage" line
    before each real piece of work (scoring, the altitude plans), an
    "altitude" line the moment those are decided -- the four plans and
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
    r = load_route(q.dep, q.dest, q.stops)
    own = q.own_altitudes()

    def lines():
        if q.checkpoints:
            yield line(NavLogStage(detail="Choosing checkpoints…"))
            _, _, by_hop = route_checkpoints(r)
        else:
            by_hop = [[] for _ in r.hops]

        profile = q.profile()
        runs = hop_runs(r, by_hop, q.depart, profile)

        # Each stage's words short enough for the one line the panel gives
        # them, at the pilot's ask: what is being worked on first.
        yield line(NavLogStage(detail="Planning altitudes…"))
        # On side threads with a heartbeat, not inline: an uncached
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
        # would wait on a stuck thread on the way out. Every hop of a
        # route with stops at once, each waited on in turn.
        altitude_pool = ThreadPoolExecutor(max_workers=len(runs))
        outcomes = []
        try:
            futures = [altitude_pool.submit(resolve_run, run, profile, q) for run in runs]
            for run, future in zip(runs, futures):
                where = f" {run.hop.dep_ident} → {run.hop.dest_ident}" if len(runs) > 1 else ""
                waiting = _waited(future, HEARTBEAT_S, lambda run=run: _running_stages(run, q))
                while True:
                    try:
                        elapsed = next(waiting)
                    except StopIteration as done:
                        outcomes.append(done.value)
                        break
                    named = _waiting_on(run, q)
                    yield line(NavLogStage(detail=(
                        f"Altitudes{where}, {elapsed:.0f} s, waiting on {named}…" if named
                        else f"Altitudes{where}, {elapsed:.0f} s, winds for each plan…"
                    )))
        finally:
            altitude_pool.shutdown(wait=False)
        outcome = join_outcomes(runs, outcomes)

        aircraft_line = {"name": q.aircraft, **profile}
        if isinstance(outcome, Unflyable):
            why, detours = unflyable_parts(outcome, runs)
            yield line(NavLogError(detail=why["title"], brief=why["brief"], reasons=why["reasons"],
                                   advice=why["advice"], retry=False,
                                   class_b=why["class_b"], detours=detours))
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
            aircraft=aircraft_line,
            cautions=list(outcome.cautions),
        ))
        for leg in flown_legs(r, runs, outcome, own):
            yield line(NavLogLeg.model_validate(leg))

        yield line(NavLogDone(totals=totals_of(r, runs, outcome, profile)))

    return ndjson(lines(), NavLogError)
