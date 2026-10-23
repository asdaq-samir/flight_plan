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
import logging
import re
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from typing import Annotated

from cachetools import TTLCache
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from vfr import (
    airports, airspace, altitude, chartlabels, charts, elevation, faa_data, fixes, fuelstops, geo, magnetic, navlog, nearby, places,
    procedure_paths, procedures, sun, terrain_detour,
)
# As vfr_holds: PlanQuery's own `holds` is the address's.
from vfr import holds as vfr_holds
from vfr.profile import route_profile as side_view
from vfr.terrain import M_TO_FT
from vfr.config import DATA_DIR, VFR_SECTIONAL_MAX_ZOOM, VFR_SECTIONAL_MIN_ZOOM
from vfr.weather import WeatherServiceError

from .. import chart_model, foreflight, prefetch
from ..common import CHART_CACHE, DEFAULT_AIRCRAFT, Route, line, load_route, ndjson
from ..planning import (
    alternate_leg,
    COMPUTE_LIMIT_S, StillComputing, aircraft_profile, altitude_plans, altitude_waiting_on, class_b_detours, class_b_ways,
    cruise_altitude, flight_totals, flight_window, forecast_hour_for, join_selections, no_altitude, no_altitude_detail,
    own_altitude_caution, route_line, route_totals,
)
from .. import planning as planning_module
from ..schemas import (
    AltitudeChoice,
    FlightRules,
    AltitudeFigure, AltitudeOption,
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
    RouteStops,
    Totals,
)
from ..scoring import route_checkpoints

router = APIRouter()
log = logging.getLogger(__name__)

# A pilot's own cruise speed: above zero, since every leg's time divides
# by it -- zero was a ZeroDivisionError and a 500 rather than a 422.
CruiseTas = Annotated[float | None, Query(gt=0, le=1000)]
# The power a pilot's own cruise figures are at, in percent: from the
# lowest a handbook's cruise table goes, about 40, to full power.
CruisePower = Annotated[float | None, Query(ge=40, le=100)]
#: An airplane's own service ceiling, ft, as the pilot sets it for their
#: N-number: from a powered glider's to past a piston single's highest.
ServiceCeiling = Annotated[float | None, Query(ge=1000, le=30000)]


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
    #: `altitude_ft` was picked on the altitude wheel: flown on each leg
    #: where that leg may fly it, else at the leg's own legal altitude
    #: nearest it (14 CFR 91.159, 91.119), as the wheel's figures were
    #: worked out -- where a typed altitude is flown on every leg, legal or
    #: not, with its cautions.
    altitude_nearest: bool = False
    altitude_choice: AltitudeChoice = "fastest"
    aircraft: str = DEFAULT_AIRCRAFT
    cruise_tas_kt: CruiseTas = None
    fuel_burn_gph: float | None = None
    usable_fuel_gal: float | None = None
    climb_tas_kt: CruiseTas = None
    climb_fuel_burn_gph: float | None = None
    cruise_power_pct: CruisePower = None
    #: The airplane's own ceiling over its profile's, where the pilot has
    #: set one for their N-number (the owner's "give users a way to change
    #: these specs for their n-number").
    service_ceiling_ft: ServiceCeiling = None
    depart: datetime | None = None
    #: The pilot will have a Class B clearance: its shelves are no
    #: ceiling, and the route is planned through it (vfr.altitude).
    class_b_clearance: bool = False
    #: The flight rules: "ifr" plans it under IFR -- 14 CFR 91.177's
    #: minimum altitudes, 91.179's by direction of flight, 91.167's
    #: reserve (vfr.ifr) -- where "vfr", the default, plans it as before.
    rules: FlightRules = "vfr"
    #: Under IFR, the alternate filed: the fuel on to it after the
    #: destination (14 CFR 91.167(a)(2)), in the totals.
    alternate: str = ""
    #: Points' own altitudes, feet above sea level: "VPBNG:4500,KMSN:1900".
    #: A waypoint's is flown to it, the hop into it at that altitude (where
    #: a pilot crosses it); an airport's is its pattern, which a flight
    #: landing there comes down to. The rest of the route as planned.
    altitudes: str = ""
    #: The instrument procedures picked at the route's fields, as the
    #: address has them: "KDLH:I09:ANDOE,KORD:BENKY6:BYLAW", the field, the
    #: procedure and any transition -- approaches, arrivals and
    #: departures alike -- and a fix ATC sent the airplane direct to, after
    #: a fourth colon ("KELD:I22::BXCMB"), the procedure flown from there. A leg flown by them is the longer by their path
    #: (with_procedures), and a flight landing by an approach comes down
    #: to the altitude of its first fix rather than to the pattern
    #: (approach_end).
    procedures: str = ""
    #: The runway each field is left from, where the pilot picked one, as
    #: "KSTL:30R,KMSN:36": a departure picked there flown by its runway
    #: transition for it (vfr.procedure_paths.procedure_path).
    runways: str = ""
    #: Altitudes ATC gave the pilot to cross the procedures' fixes at,
    #: feet above sea level: "BXCMB:3000". Each stands for the chart's at
    #: that fix wherever a procedure picked passes it -- the descent planned
    #: to it and the path's heights (drawn_procedures).
    crossings: str = ""
    #: Holds the pilot put on the route's points (vfr.holds): the point,
    #: its inbound course, R or L, its legs and how long, as
    #: "VPBNG/090/30:270:R:1M:2T"; several joined by commas.
    holds: str = ""
    #: Minutes on the ground at the route's stops: "KJVL:45". A stop not
    #: named turns around in TURNAROUND_MIN, at the owner's pick (2026-10-20):
    #: the flights after it leave that much later, for their winds, their
    #: night and their times.
    ground: str = ""
    #: Checkpoints between the route's own points, as the planner picks
    #: them off the chart. False, the legs run from point to point alone
    #: -- the departure, the stops, the destination -- as a pilot whose
    #: map shows no waypoints flies it; and nothing is scored for them.
    checkpoints: bool = True

    def profile(self) -> dict:
        return aircraft_profile(
            self.aircraft, self.cruise_tas_kt, self.fuel_burn_gph, self.usable_fuel_gal,
            self.climb_tas_kt, self.climb_fuel_burn_gph, self.cruise_power_pct, self.service_ceiling_ft,
        )

    @property
    def aircraft_key(self) -> str:
        """The profile's name, and its own ceiling where one is set: what the
        altitude selection is cached by, as the ceiling decides it."""
        return self.aircraft if self.service_ceiling_ft is None else f"{self.aircraft}@{self.service_ceiling_ft:.0f}"

    def own_altitudes(self) -> dict[str, float]:
        """`altitudes` by ident; a 422 for one that is not "IDENT:FEET",
        or not a VFR altitude: under 18,000 ft MSL, the floor of Class A
        (14 CFR 71.33), where no flight is VFR (14 CFR 91.135). Under IFR,
        up to FL410, the highest 91.179(b)(4) names."""
        top = 41_000 if self.rules == "ifr" else 17_999
        out = {}
        for part in filter(None, (p.strip() for p in self.altitudes.split(","))):
            ident, _, feet = part.partition(":")
            if not POINT_ALTITUDE.fullmatch(part) or not 0 < float(feet) <= top:
                raise HTTPException(422, f"{part!r} is not a point's altitude: an ident and feet, as VPBNG:4500.")
            out[point_key(ident)] = float(feet)
        return out


    def procedure_picks(self) -> list[tuple[str, str, str | None, str | None]]:
        """`procedures`, each the field, the procedure, its transition
        (None, an approach from vectors) and the fix flown direct to (None,
        as charted); a 422 for one that is not
        "FIELD:PROCEDURE[:TRANSITION[:DIRECT]]"."""
        out = []
        for part in filter(None, (p.strip() for p in self.procedures.split(","))):
            if not PROCEDURE_PICK.fullmatch(part):
                raise HTTPException(422, f"{part!r} is not a procedure: a field, a procedure and a transition, as KDLH:I09:ANDOE.")
            ident, procedure, *rest = part.upper().split(":")
            transition = rest[0] if rest and rest[0] else None
            direct = rest[1] if len(rest) > 1 else None
            out.append((ident, procedure, transition, direct))
        return out

    def own_crossings(self) -> dict[str, float]:
        """`crossings` by fix; a 422 for one that is not "FIX:FEET", or
        over the altitudes' top (own_altitudes)."""
        top = 41_000 if self.rules == "ifr" else 17_999
        out = {}
        for part in filter(None, (p.strip() for p in self.crossings.split(","))):
            ident, _, feet = part.partition(":")
            if not POINT_ALTITUDE.fullmatch(part) or not 0 < float(feet) <= top:
                raise HTTPException(422, f"{part!r} is not a fix's crossing altitude: a fix and feet, as BXCMB:3000.")
            out[ident.upper()] = float(feet)
        return out

    def own_holds(self) -> list[vfr_holds.Hold]:
        """`holds`, each as vfr.holds.parse reads it; a 422 for one that is
        not a hold."""
        out = []
        for part in filter(None, (p.strip() for p in self.holds.split(","))):
            hold = vfr_holds.parse(part)
            if hold is None:
                raise HTTPException(422, f"{part!r} is not a hold: a point, its inbound course, R or L, its legs and how long, "
                                         "as VPBNG:270:R:1M:2T.")
            out.append(hold)
        return out

    def own_ground(self) -> dict[str, float]:
        """`ground` by ident; a 422 for one that is not "IDENT:MINUTES", or
        a stop of more than a day."""
        out = {}
        for part in filter(None, (p.strip() for p in self.ground.split(","))):
            ident, _, minutes = part.partition(":")
            if not POINT_ALTITUDE.fullmatch(part) or not 0 <= float(minutes) <= 24 * 60:
                raise HTTPException(422, f"{part!r} is not a stop's time on the ground: an ident and minutes, as KJVL:45.")
            out[point_key(ident)] = float(minutes)
        return out

    def departure_runways(self) -> dict[str, str]:
        """The runway each field is left from (`runways`), by its ident."""
        out = {}
        for part in filter(None, (p.strip() for p in self.runways.split(","))):
            ident, _, runway = part.partition(":")
            if not re.fullmatch(r"[A-Za-z0-9]{2,5}", ident) or not re.fullmatch(r"\d{1,2}[LRC]?", runway.upper()):
                raise HTTPException(422, f"{part!r} is not a runway left from: an ident and a runway, as KSTL:30R.")
            out[_bare_field(ident.upper())] = runway.upper()
        return out

    def drawn_procedures(self) -> list[tuple[str, dict]]:
        """The procedures picked (procedure_picks), each its field and its
        drawing (vfr.procedures.procedure_drawing), read once for the
        request; one the CIFP does not have, or cannot be had, left out:
        its leg is flown as the route goes. A fix the pilot was given an
        altitude to cross at (own_crossings) is crossed at it, in place of
        the chart's window, for the descent and the path alike."""
        own = self.own_crossings()
        out = []
        for ident, procedure, transition, direct in self.procedure_picks():
            try:
                drawn = procedures.procedure_drawing(ident, procedure, transition)
            except RuntimeError:
                continue
            if drawn:
                fixes_ = [{**f, "min_ft": own[f["ident"]], "max_ft": own[f["ident"]]}
                          if f["ident"] in own and not f["missed"] else f for f in drawn.get("fixes", [])]
                drawn = {**drawn, "fixes": fixes_, **({"direct": direct} if direct else {})}
                out.append((ident, drawn))
        return out


#: A point of the route as the address names it: an ident, or the pilot's
#: own point off a fix, "VPBNG/090/30" or packed "DLH090030" (vfr.fixes
#: parse_frd) -- as the saved flight's SaveFlightRequest.POINT takes it,
#: where an altitude set on such a point was a 422 for the whole log.
POINT = r"(?:[A-Za-z0-9]{2,5}(?:/\d{3}/\d{1,3}(?:\.\d)?)?|[A-Za-z]{2,5}\d{6})"
POINT_ALTITUDE = re.compile(POINT + r":\d{1,5}")


def point_key(ident: str) -> str:
    """A point's ident as the route has it (Route.idents): a point off a
    fix in its one written form (vfr.fixes.frd_ident), packed or not."""
    parts = fixes.parse_frd(ident)
    return fixes.frd_ident(*parts) if parts else ident.upper()
# As lib/procedures' proceduresOf reads them from the address.
PROCEDURE_PICK = re.compile(r"[A-Za-z0-9]{2,5}:[A-Za-z0-9-]{1,6}(:[A-Za-z0-9]{1,5}|:[A-Za-z0-9]{0,5}:[A-Za-z0-9]{2,5})?")

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
    #: The route flown at each altitude the wheel offers (AltitudeFigure).
    figures: tuple = ()

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
    figures: tuple = ()


def resolve_altitude(
    r, fix_list: list, profile: dict, aircraft: str, altitude_ft: float | None, choice: AltitudeChoice,
    fcst_hr: str = "06", window: tuple | None = None, class_b_cleared: bool = False, rules: str = "vfr",
    nearest: bool = False,
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
    what the planner would have flown. With `nearest` (the wheel's pick)
    the altitude is flown where each leg may fly it, else at that leg's
    nearest legal one: the figures the wheel showed for it, and no leg
    under its floor or on the wrong thousands for its course."""
    selection = cruise_altitude(r.start, r.end, profile, aircraft, fixes=_fixes(fix_list), fcst_hr=fcst_hr, window=window,
                                class_b_cleared=class_b_cleared, rules=rules, airway=r.dest_airport.get("airway"))
    try:
        plans = altitude_plans(fix_list, selection, profile, aircraft, fcst_hr, departure_elevation(r))
        failure = None
    except WeatherServiceError as err:
        plans, failure = {}, err
    options = [AltitudeOption(kind=kind, **{k: v for k, v in plans[kind].items() if k not in ("legs", "totals")})
               for kind in navlog.PLAN_KINDS] if plans else []
    figures = tuple(AltitudeFigure(**f) for f in getattr(plans, "by_altitude", []))
    if altitude_ft is not None and nearest and plans:
        return Flown(selection, options, None, altitude_ft, plans.legs_at(altitude_ft), figures=figures)
    if altitude_ft is not None:
        try:
            legs = navlog.with_climbs(navlog.legs(fix_list, altitude_ft, profile, fcst_hr), departure_elevation(r), profile)
        except WeatherServiceError as err:
            return NoWinds(selection, options, err, figures)
        caution = own_altitude_caution(selection, legs, (r.dep_ident, r.dest_ident))
        return Flown(selection, options, None, altitude_ft, legs, cautions=(caution,) if caution else (), figures=figures)
    if failure is not None:
        return NoWinds(selection, options, failure, figures)
    if not plans:
        return Unflyable(selection)
    legs = plans[choice]["legs"]
    return Flown(selection, options, choice, legs[0]["altitude_ft"], legs, figures=figures)


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


#: The time on the ground at a stop where the pilot gave none, min: a
#: turnaround -- taxi in, fuel, a break, taxi out -- at the owner's pick of
#: the audit's choices (2026-10-20), where none was counted. The web app
#: mirrors it (navlog/rows.ts TURNAROUND_MIN) only for the rows it draws
#: before the nav log's legs arrive; once they do, it reads each stop's
#: minutes off them (Leg.ground_min).
TURNAROUND_MIN = 30.0


def ground_min_at(ground: dict[str, float] | None, ident: str) -> float:
    """The minutes on the ground at the stop `ident`: the pilot's own
    (PlanQuery.ground), else TURNAROUND_MIN. The one rule the hops' start
    times, the legs and the totals all go by."""
    return (ground or {}).get(ident.upper(), TURNAROUND_MIN)


def hop_runs(r: Route, by_hop: list, depart: datetime | None, profile: dict,
             ground: dict[str, float] | None = None, held: list[vfr_holds.Hold] | None = None) -> list[HopRun]:
    """Each hop of `r` ready to plan, `by_hop` its selected checkpoints.
    A hop after the first is flown when the ones before it are done, at
    cruise speed, and after the time on the ground at each stop it lands
    at (`ground`, by ident, else TURNAROUND_MIN) -- an estimate, to the
    hour its winds and forecast are read for. The first is the route's
    own: a route without stops is planned exactly as it always was. A
    hold (`held`) is flown on the hop leaving its point, so the hops after
    it leave the later by its minutes (as with_holds puts them there); a
    round trip's field is held at on arrival, after the last hop."""
    ground = ground or {}
    runs, elapsed_h = [], 0.0
    tas = max(profile["cruise_tas_kt"], 1.0)
    idents = [ident.upper() for ident in r.idents]
    holding = {}
    for hold in held or ():
        if hold.fix in idents[:-1] and not (hold.fix == idents[0] == idents[-1] and hold.fix not in idents[1:-1]):
            holding[hold.fix] = holding.get(hold.fix, 0.0) + vfr_holds.held_minutes(hold, tas)
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
            # A later flight's own time, now's flights' too: its night was
            # judged at now, as the first's is.
            when if depart is not None or i > 0 else None,
        ))
        elapsed_h += hop.length_nm / tas + holding.get(hop.dep_ident.upper(), 0.0) / 60
        if hop.lands and i < len(r.hops) - 1:
            elapsed_h += ground_min_at(ground, hop.dest_ident) / 60
    return runs


def resolve_run(run: HopRun, profile: dict, q: "PlanQuery") -> "Flown | Unflyable | NoWinds":
    # The hop into a waypoint with an altitude of its own is flown at it.
    own = None if run.hop.lands else q.own_altitudes().get(run.hop.dest_ident)
    return resolve_altitude(
        run.hop, run.fixes, profile, q.aircraft_key, q.altitude_ft if own is None else own, q.altitude_choice,
        run.fcst_hr, run.window, q.class_b_clearance, q.rules, nearest=q.altitude_nearest and own is None,
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


def join_figures(figures_by_hop: list[tuple], lengths: list[float]) -> tuple:
    """A route with stops' figures at each altitude (AltitudeFigure), from
    each hop's: every altitude any hop offers, each hop at it or, where it
    does not offer it, at its own nearest (the lower on a tie), as a pilot
    who picks it flies that hop; times and fuel summed, the wind weighed
    by each hop's length. One hop's as they are.

    A hop with no legal altitude to offer (a pilot's own altitude flown
    on it, legal or not, with its cautions) leaves the others' altitudes
    on the profile's ruler, which went blank for the whole route (the
    owner's C81 - KEVU - KGCK - KABQ at 6,000 ft, its last hop with none
    over the Sangre de Cristos); their times and fuel unknown, as that
    hop's are, and none of them flown everywhere."""
    if len(figures_by_hop) == 1:
        return figures_by_hop[0]
    if all(not figures for figures in figures_by_hop):
        return ()
    gap = any(not figures for figures in figures_by_hop)
    offered = [figures for figures in figures_by_hop if figures]
    offered_nm = [n for figures, n in zip(figures_by_hop, lengths) if figures]
    joined = []
    for target in sorted({f.altitude_ft for figures in offered for f in figures}):
        mine = [min(figures, key=lambda f: (abs(f.altitude_ft - target), f.altitude_ft)) for figures in offered]

        def total(attr, mine=mine):
            values = [getattr(f, attr) for f in mine]
            return None if gap or any(v is None for v in values) else round(sum(values), 1)

        winds = [(f.tailwind_kt, n) for f, n in zip(mine, offered_nm) if f.tailwind_kt is not None]
        weight = sum(n for _, n in winds)
        joined.append(AltitudeFigure(
            altitude_ft=target, ete_min=total("ete_min"), fuel_gal=total("fuel_gal"),
            tailwind_kt=round(sum(t * n for t, n in winds) / weight, 1) if weight else None,
            everywhere=not gap and all(f.everywhere and f.altitude_ft == target for f in mine),
        ))
    return tuple(joined)


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
    figures = join_figures([o.figures for o in outcomes], lengths)
    for outcome in outcomes:
        if isinstance(outcome, NoWinds):
            return NoWinds(selection, options, outcome.error, figures)
    # The plan the route flies is the one its hops are flown on, a hop
    # into a waypoint at its own altitude (resolve_run) or not.
    planned = next((o for o in outcomes if o.choice is not None), outcomes[0])
    return Flown(
        selection, options, planned.choice, planned.altitude_ft,
        [leg for o in outcomes for leg in o.legs], tuple(o.legs for o in outcomes),
        tuple(c for o in outcomes for c in o.cautions), figures,
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
    out = [{**way, "stop_index": at, "description": _where(way["ident"])} for way in ways]
    if not ways:
        round_way = terrain_way(outcome.selection, hop)
        if round_way:
            out.append({**round_way, "stop_index": at})
            why = {**why, "advice": "Go round the high ground by the way suggested, "
                                    "or set a cruise altitude of your own to plan it anyway."}
    return why, out


def terrain_way(selection: dict, hop: Route) -> dict | None:
    """Where the airplane's service ceiling is what stops the route over
    high ground, the way round it (vfr.terrain_detour): the points to fly
    by, as a detour of its own, with how much longer it makes the hop.
    None where something else stops it (clouds, Class B) or there is no
    way round in reach. At the owner's ask ("Suggest a way around the
    terrain ... Yes build it", 2026-10-23)."""
    stuck = next((s for s in selection.get("segments", []) if not s.get("candidates_ft")), None)
    ceiling = (stuck or {}).get("service_ceiling_ft")
    if not ceiling:
        return None
    try:
        points = terrain_detour.way_round(hop.start, hop.end, ceiling)
    except Exception:  # noqa: BLE001 -- the tiles out of reach: no suggestion, the problem said as before
        return None
    if not points:
        return None
    path = [hop.start, *((p["lat"], p["lon"]) for p in points), hop.end]
    flown = sum(geo.distance_nm(a[0], a[1], b[0], b[1]) for a, b in zip(path, path[1:]))
    return {
        "ident": points[0]["ident"], "kind": "Around the high ground",
        "added_nm": round(float(flown - hop.length_nm), 1),
        "description": " · ".join(p["ident"] for p in points),
        "via": [p["ident"] for p in points],
    }


def class_b_detours_of(runs: list[HopRun], outcome: Flown, q: "PlanQuery") -> list[dict]:
    """With the Class B clearance, the waypoints that keep each hop out of
    the Class B it enters at its highest cruise altitude (class_b_ways),
    each with its place in the stops as unflyable_parts gives them: what
    "Avoid Class B" adds. None without the clearance -- the route is then
    planned under or round it already -- or with no Class B on the way."""
    if not q.class_b_clearance or not any(t.get("class") == "B" for t in outcome.selection.get("airspace_transits", [])):
        return []
    out = []
    for at, (run, legs) in enumerate(zip(runs, outcome.hop_legs)):
        heights = [leg["altitude_ft"] for leg in legs if leg.get("altitude_ft") is not None]
        if not heights:
            continue
        ways = class_b_ways(run.hop.start, run.hop.end, max(heights))
        out.extend({**way, "stop_index": at, "description": _where(way["ident"])} for way in ways)
    return out


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


def approach_end(flight: Route, drawn: list[tuple[str, dict]],
                 cruise_ft: float | None = None) -> tuple[float, float, str] | None:
    """Where a flight landing by the instrument approach picked for its
    field comes down to: the altitude its first fix with one under the
    cruise (`cruise_ft`) is crossed at, the fix, and the fix's distance
    from the field. The first fix is the transition's initial approach
    fix, or from vectors the intermediate fix; a plan cruising at or under
    its altitude comes down to the next fix lower, the final approach
    fix's, say, as the approach steps down. The altitude is the chart's
    lowest for the fix, coded in the FAA's CIFP
    (vfr.procedures.altitude_limits, ARINC 424-18 5.29) as the plate
    prints it (AIM 5-4-5), or its highest where it is crossed at or below
    one. The route runs to the field, not to the fix: the descent ends
    where the route is the fix's own distance out, and the approach is
    flown from there as charted. None where no approach is picked there
    (`drawn`, PlanQuery.drawn_procedures), no fix is under the cruise, or
    the CIFP cannot be had: down to the pattern."""
    if not flight.lands:
        return None
    approach = _picked(drawn, "approach", flight.dest_ident)
    if approach is None:
        return None
    crossed = [(f, f["min_ft"] if f["min_ft"] is not None else f["max_ft"]) for f in approach["fixes"] if not f["missed"]]
    fix, at_ft = next(((f, ft) for f, ft in crossed if ft and (cruise_ft is None or ft < cruise_ft)), (None, None))
    if fix is None:
        return None
    field = flight.dest_airport
    return float(at_ft), geo.distance_nm(fix["lat"], fix["lon"], field["lat"], field["lon"]), fix["ident"]


def _bare_field(ident: str) -> str:
    """A field's FAA ident: the CIFP names it by its ICAO ident (KDLH)
    where the route may have the FAA's (DLH), as lib/procedures' sameField."""
    return ident[1:] if len(ident) == 4 and ident.startswith("K") else ident


def _picked(drawn: list[tuple[str, dict]], kind: str, field: str) -> dict | None:
    """The procedure of `kind` picked at `field`, drawn, if one is."""
    return next((d for ident, d in drawn if d.get("kind") == kind and _bare_field(ident) == _bare_field(field.upper())), None)


def with_procedures(r: Route, runs: list[HopRun], outcome: Flown, drawn: list[tuple[str, dict]],
                    runways: dict[str, str] | None = None) -> Flown:
    """The legs with the procedures picked flown (`drawn`,
    PlanQuery.drawn_procedures): a flight's first leg out of its field by
    the departure picked there, its last into the field it lands at by the
    arrival and the approach picked there, each along their path from the
    leg's start (vfr.procedure_paths.flown), a departure by its transition
    for the runway the pilot leaves from (`runways`) -- an arrival flown out to its
    first fix and round to the runway can be a hundred miles more than the
    leg it is flown in place of (C81 to O'Hare by BENKY6, 2026-10-19). The
    miles more are flown at the leg's ground speed and cruise burn, added
    to its time and fuel, so the totals, the fuel required (14 CFR 91.151,
    91.167) and the times at each point after are those of the flight
    flown. The leg keeps the route's own distance, which the chart, the
    side view and the tops of climb and descent are laid along, and says
    its path and the miles more (`procedure`) for the dry run to fly. New
    legs: the plan's own are the planner's cache's (Flown)."""
    if not drawn:
        return outcome
    hops = [[dict(leg) for leg in legs] for legs in outcome.hop_legs]
    at = 0
    for flight in r.flights:
        n = len(flight.idents) - 1
        # Each leg flown by procedures, and by which: out by a departure,
        # in by an arrival and an approach; one leg can be all three.
        by: dict[tuple[int, int], list] = {}
        departure = _picked(drawn, "departure", flight.dep_ident) if flight.takes_off else None
        if departure and hops[at]:
            by.setdefault((at, 0), [None, None, None])[0] = departure
        arrival = _picked(drawn, "arrival", flight.dest_ident) if flight.lands else None
        approach = _picked(drawn, "approach", flight.dest_ident) if flight.lands else None
        if (arrival or approach) and hops[at + n - 1]:
            by.setdefault((at + n - 1, len(hops[at + n - 1]) - 1), [None, None, None])[1:] = [arrival, approach]
        for (hop, i), picks in by.items():
            leg, fixes_ = hops[hop][i], runs[hop].fixes
            start, end = fixes_[i], fixes_[i + 1]
            path = procedure_paths.flown((start["lat"], start["lon"]), (end["lat"], end["lon"]), *picks,
                                         runway=(runways or {}).get(_bare_field(flight.dep_ident.upper())) if picks[0] else None)
            if path is None or not leg["groundspeed_kt"] or leg["ete_min"] is None:
                continue
            # Never fewer miles than the leg: a path that cuts a corner of
            # the route is planned as the route.
            more_nm = max(0.0, path["nm"] - leg["distance_nm"])
            more_min = more_nm / leg["groundspeed_kt"] * 60
            more_gal = more_min / 60 * leg["fuel_burn_gph"]
            leg["ete_min"] = round(leg["ete_min"] + more_min, 1)
            if leg["fuel_gal"] is not None:
                leg["fuel_gal"] = round(leg["fuel_gal"] + more_gal, 2)
            leg["procedure"] = {**path, "nm": round(path["nm"], 1), "more_nm": round(more_nm, 1),
                                "more_min": round(more_min, 1), "more_gal": round(more_gal, 2)}
        at += n
    return replace(outcome, legs=[leg for legs in hops for leg in legs], by_hop=tuple(hops) if outcome.by_hop else ())


def with_holds(r: Route, runs: list[HopRun], outcome: Flown, held: list[vfr_holds.Hold]) -> Flown:
    """The legs with the pilot's holds flown (PlanQuery.own_holds): each at
    its point, on the leg that leaves it -- at the destination, the leg into
    it -- its minutes (vfr.holds.held_minutes) at the leg's true airspeed
    and cruise burn added to the leg's time and fuel, so the totals and the
    fuel required (14 CFR 91.151, 91.167) are the flight's with the hold.
    The leg says its hold for the map and the dry run: the entry from the
    course flown to the point (AIM 5-3-8), one turn round the racetrack in
    true degrees, and the minutes and fuel. New legs, as with_procedures'."""
    if not held:
        return outcome
    hops = [[dict(leg) for leg in legs] for legs in outcome.hop_legs]
    idents = [ident.upper() for ident in r.idents]
    for hold in held:
        # A stop's first, then the destination's, then the departure's: a
        # round trip's field is both ends, and a hold set at it is the
        # arrival's -- matched as the departure, its minutes and fuel went
        # on the first flight out and the last flight's fuel came up short.
        at = next((k for k, ident in enumerate(idents[:-1]) if k > 0 and ident == hold.fix and hops[k]), None)
        if at is None and idents[0] == hold.fix and idents[-1] != hold.fix and hops[0]:
            at = 0
        if at is not None:
            leg, fix = hops[at][0], runs[at].fixes[0]
            before = hops[at - 1][-1] if at > 0 and hops[at - 1] else leg
        elif idents[-1] == hold.fix and hops[-1]:
            leg = before = hops[-1][-1]
            fix = runs[-1].fixes[-1]
        else:
            continue
        if leg["ete_min"] is None:
            continue
        tas = leg["tas_kt"]
        # Magnetic = true - variation, east positive (vfr.magnetic): the
        # course flown to the point, and the hold's inbound course in true.
        arrival = (before["true_course_deg"] - before["magnetic_variation_deg"]) % 360
        inbound_true = (hold.inbound_deg + magnetic.magnetic_variation_deg(fix["lat"], fix["lon"])) % 360
        leg_nm = hold.leg_nm if hold.leg_nm is not None else (hold.leg_min or 1.0) * tas / 60
        minutes = vfr_holds.held_minutes(hold, tas)
        gal = minutes / 60 * leg["fuel_burn_gph"]
        leg["ete_min"] = round(leg["ete_min"] + minutes, 1)
        if leg["fuel_gal"] is not None:
            leg["fuel_gal"] = round(leg["fuel_gal"] + gal, 2)
        leg["hold"] = {
            "fix": hold.fix, "inbound_deg": hold.inbound_deg, "right": hold.right,
            "leg_min": hold.leg_min, "leg_nm": hold.leg_nm, "turns": hold.turns, "minutes": round(minutes, 1),
            "lap_min": round(vfr_holds.lap_minutes(hold, tas), 2), "gal": round(gal, 2),
            "entry": vfr_holds.entry(arrival, hold.inbound_deg, hold.right),
            "path": vfr_holds.racetrack((fix["lat"], fix["lon"]), inbound_true, hold.right, tas, leg_nm),
            "at_end": at is None,
        }
    return replace(outcome, legs=[leg for legs in hops for leg in legs], by_hop=tuple(hops) if outcome.by_hop else ())


def flown_legs(r: Route, runs: list[HopRun], outcome: Flown, own: dict[str, float] | None = None,
               drawn: list[tuple[str, dict]] | None = None, ground: dict[str, float] | None = None) -> list:
    """The legs a pilot flies, with each flight's tops of climb and
    descent placed (navlog.with_descents): from one landing to the next,
    through any waypoints, down to the pattern at the end of each --
    `own`, a pilot's own patterns by ident -- or to an approach's first
    fix, where one is picked for the field (`drawn`, approach_end). The
    last leg of each flight but the route's last carries the minutes on
    the ground at the stop it lands at (`ground_min`, ground_min_at), the
    figure the web times the rows after it by."""
    out, at = [], 0
    flights = r.flights
    for k, flight in enumerate(flights):
        hops = len(flight.idents) - 1
        legs = [leg for i, legs in enumerate(outcome.hop_legs[at:at + hops], start=at) for leg in on_airway(legs, r.airports[i + 1])]
        fix_list = [fix for k, run in enumerate(runs[at:at + hops]) for fix in (run.fixes if k == 0 else run.fixes[1:])]
        approach = approach_end(flight, drawn or [], legs[-1]["altitude_ft"] if legs else None)
        if approach:
            to_ft, before_nm, fix = approach
            out.extend(navlog.with_descents(legs, fix_list, to_ft, before_nm, fix))
        else:
            out.extend(navlog.with_descents(legs, fix_list, pattern_altitude(flight, own)))
        if out and k < len(flights) - 1:
            out[-1] = {**out[-1], "ground_min": ground_min_at(ground, flight.dest_ident)}
        at += hops
    return out


def on_airway(legs: list[dict], end: dict) -> list[dict]:
    """A hop's legs, each carrying the airway segment the hop flies, where
    it is one: the route's point it ends at holds the segment flown into it
    (common.with_airways), and every leg of the hop is along it."""
    segment = end.get("airway")
    return [{**leg, "airway": segment} for leg in legs] if segment else legs


def _where(ident: str) -> str | None:
    fix = fixes.find_fix(ident)
    return places.describe(fix["lat"], fix["lon"]) if fix else None


def totals_of(r: Route, runs: list[HopRun], outcome: "Flown", profile: dict, rules: str = "vfr",
              alternate: str = "", ground: dict[str, float] | None = None) -> dict:
    """The trip's totals: each flight's own, from one landing to the next
    through any waypoints (Route.flights), with its fuel check, joined
    (app.planning.route_totals). Under IFR with an `alternate` filed, the
    last flight's check carries the leg on to it (alternate_leg)."""
    per_flight, at = [], 0
    for i, flight in enumerate(r.flights):
        hops = len(flight.idents) - 1
        legs = [leg for legs in outcome.hop_legs[at:at + hops] for leg in legs]
        leg_on = None
        if rules == "ifr" and alternate.strip() and i == len(r.flights) - 1 and legs:
            try:
                alt = airports.get_airport(alternate)
            except ValueError as err:
                raise HTTPException(404, f"No airport goes by {alternate!r}.") from err
            dest = {"ident": r.dest_ident, "lat": r.end[0], "lon": r.end[1]}
            leg_on = alternate_leg(dest, {**alt, "ident": alternate.strip().upper()}, legs[-1]["altitude_ft"], profile,
                                   runs[-1].fcst_hr)
        per_flight.append(flight_totals(legs, profile, flight, runs[at].depart, rules, leg_on))
        at += hops
    totals = route_totals(per_flight, r.flights)
    totals["fuel_stops"] = fuel_stops_of(r, per_flight)
    # The time on the ground at the stops (hop_runs), for the arrival.
    totals["ground_min"] = sum(ground_min_at(ground, f.dest_ident) for f in r.flights[:-1])
    return totals


def fuel_stops_of(r: Route, per_flight: list[dict]) -> list[dict]:
    """Where each flight the tanks do not hold could land for fuel
    (vfr.fuelstops.suggest), at the owner's ask ("suggest fuel stops just
    like Tesla suggests"): the stops that make it, and other fields for the
    first, by the flight's own burn and minutes per mile and the reserve it
    is held to. Fuel alone, at the owner's ask ("only suggest fuel stops in
    the plan, not food etc. That can be done by the pilot by tapping the
    button along the route", 2026-10-23): the map's Stops is where a meal
    or a rest is picked. None where every flight's fuel check passes, or
    where the usable fuel or the flight's figures are not known."""
    out = []
    for flight, t in zip(r.flights, per_flight):
        margin, usable, distance = t.get("fuel_margin_gal"), t.get("usable_fuel_gal"), t.get("distance_nm")
        if margin is None or margin >= 0 or not usable or not distance or t.get("fuel_gal") is None or t.get("ete_min") is None:
            continue
        try:
            stops, choices = fuelstops.suggest(
                flight.start, flight.end, fuel_per_nm=t["fuel_gal"] / distance, min_per_nm=t["ete_min"] / distance,
                usable_gal=usable, taxi_gal=t.get("taxi_gal") or 0.0, reserve_gal=t.get("reserve_gal") or 0.0,
                skip=set(r.idents),
            )
        except (OSError, ValueError, KeyError):
            # The airport tables missing or unreadable: the fuel check
            # still says the flight is short, with no stop offered.
            log.warning("No fuel stops for %s-%s", flight.dep_ident, flight.dest_ident, exc_info=True)
            continue
        if stops:
            out.append({"departure": flight.dep_ident, "destination": flight.dest_ident, "usable_gal": usable,
                        "reason": "fuel", "stops": [s.as_dict() for s in stops], "choices": [c.as_dict() for c in choices]})
    return out


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
        run.hop.start, run.hop.end, q.aircraft_key, _fixes(run.fixes), run.fcst_hr, run.window, q.class_b_clearance,
        q.rules, run.hop.dest_airport.get("airway"))


def _chart_info() -> dict:
    cycle = charts.serving_cycle()
    return {
        "max_zoom": VFR_SECTIONAL_MAX_ZOOM, "min_zoom": VFR_SECTIONAL_MIN_ZOOM, "chart_cycle": cycle,
        "chart_revision": charts.tiles_revision(cycle), "chart_tiles_base": charts.tiles_base_url(),
        "chart_layers": chart_layers(),
    }


@router.get("/api/chart")
def chart_info(response: Response) -> ChartInfo:
    """The chart the map draws, for a map with no route on it yet: the
    planner's page opens on a search bar over the chart, as Maps does.
    The map asks for no tile before this answers, so it may be kept
    (CHART_CACHE) and served from the CDN's edge."""
    response.headers["Cache-Control"] = CHART_CACHE
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


#: The map's Stops answered for a route, kept an hour once complete.
_STOPS_KEPT: TTLCache = TTLCache(maxsize=256, ttl=3600)
_STOPS_LOCK = threading.Lock()


@router.get("/api/route-stops")
def route_stops(dep: str, dest: str, stops: str = "") -> RouteStops:
    """The fields along the route to stop at, for the map's Stops, at the
    owner's ask ("a button to show food, fuel, rest options along the
    route they can pick from", 2026-10-23): every public field near each
    flight's line (vfr.fuelstops.along), each with its courtesy car (the
    FAA's remarks) and the nearest food, bed and car to hire where its
    places have been read (vfr.nearby.kept). Those not yet read are read
    on the planner's pool and counted in `pending`; the page asks again
    until none is. The times and the fuel at each are the page's, from
    the plan's own figures per mile."""
    key = (dep.strip().upper(), dest.strip().upper(), stops.strip().upper())
    with _STOPS_LOCK:
        kept = _STOPS_KEPT.get(key)
    if kept is not None:
        return kept
    r = load_route(dep, dest, stops)
    found = fuelstops.along([(f.dep_ident, f.start, f.end) for f in r.flights], skip=set(r.idents))
    out, pending = [], 0
    for field in found:
        places = nearby.kept(field["ident"])
        if places is None:
            pending += 1
            nearby.read_later(field["ident"], field["lat"], field["lon"])
        else:
            for kind, one in (("food", "food"), ("lodging", "lodging"), ("cars", "car")):
                field[one] = (places.get(kind) or [None])[0]
        out.append({**field, "nearby_known": places is not None, "courtesy_car": nearby.courtesy_car(field["ident"])})
    answer = RouteStops(fields=out, pending=pending)
    # Kept once every field's places are in: asked again, the route's
    # stops were 1 to 3.4 s each time, warm (the 23 Oct audit), the
    # corridor and 40 fields' remarks and places read afresh.
    if not pending:
        with _STOPS_LOCK:
            _STOPS_KEPT[key] = answer
    return answer


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
    drawn = q.drawn_procedures()
    profile = q.profile()

    # Everything slow inside the one bound, scoring included: the agents'
    # client waits exactly that long (vfr.planner_client).
    runs: list[HopRun] = []

    def work():
        scored, selected, by_hop = route_checkpoints(r) if q.checkpoints else ([], [], [[] for _ in r.hops])
        _name_waypoints(r, selected)
        runs.extend(hop_runs(r, by_hop, q.depart, profile, q.own_ground(), q.own_holds()))
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
    outcome = with_holds(r, runs, with_procedures(r, runs, outcome, drawn, q.departure_runways()), q.own_holds())
    leg_list = flown_legs(r, runs, outcome, own, drawn, q.own_ground())

    return Plan(
        departure=r.departure,
        destination=r.destination,
        stops=r.stops,
        distance_nm=round(r.distance_nm, 1),
        course_line=route_line(r),
        candidates=scored,
        selected=selected,
        legs=leg_list,
        totals=totals_of(r, runs, outcome, profile, q.rules, q.alternate, q.own_ground()),
        altitude_ft=outcome.altitude_ft,
        altitude_selection=outcome.selection,
        altitude_options=outcome.options,
        altitude_choice=outcome.choice,
        altitude_cautions=list(outcome.cautions),
        class_b_detours=class_b_detours_of(runs, outcome, q),
        altitude_figures=list(outcome.figures),
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
    the field at both ends of the time aloft, from now where no
    departure time is given (planning.flight_totals). A 422 for a route
    that is not one airport to itself."""
    r = load_route(q.dep, q.dest, q.stops)
    if r.dep_ident != r.dest_ident or len(r.idents) != 2:
        raise HTTPException(422, "A local flight leaves and lands at the same airport, with no stops.")
    profile = q.profile()
    fuel = round(profile["fuel_burn_gph"] * duration_min / 60, 1)
    depart = planning_module.now() if q.depart is None else q.depart if q.depart.tzinfo else q.depart.replace(tzinfo=timezone.utc)
    night = sun.is_night(*r.start, depart) or sun.is_night(*r.start, depart + timedelta(minutes=duration_min))
    return Totals(
        distance_nm=0.0, ete_min=duration_min, fuel_gal=fuel, unflyable_legs=0, legs_without_wind=0,
        **navlog.fuel_plan(fuel, profile, night, q.rules),
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
    drawn = q.drawn_procedures()

    def lines():
        if q.checkpoints:
            yield line(NavLogStage(detail="Choosing checkpoints…"))
            _, _, by_hop = route_checkpoints(r)
        else:
            by_hop = [[] for _ in r.hops]

        profile = q.profile()
        runs = hop_runs(r, by_hop, q.depart, profile, q.own_ground(), q.own_holds())

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
                altitude_figures=list(outcome.figures),
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
            class_b_detours=class_b_detours_of(runs, outcome, q),
            altitude_figures=list(outcome.figures),
        ))
        outcome = with_holds(r, runs, with_procedures(r, runs, outcome, drawn, q.departure_runways()), q.own_holds())
        for leg in flown_legs(r, runs, outcome, own, drawn, q.own_ground()):
            yield line(NavLogLeg.model_validate(leg))

        yield line(NavLogDone(totals=totals_of(r, runs, outcome, profile, q.rules, q.alternate, q.own_ground())))

    return ndjson(lines(), NavLogError)
