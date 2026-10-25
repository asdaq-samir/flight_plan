"""POST /api/go-no-go: the Brief's Go / No-Go for the native app, worked
out here so the phone computes no rule (docs/NATIVE.md). The planner
plans the route and briefs it as /api/navlog and /api/briefing do --
their caches make a second ask after the nav log quick -- and feeds the
findings from them and from what only the pilot knows, as the web app's
FlightBriefingView feeds lib/verdict (app.gonogo)."""
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import planning as planning_module
from ..common import load_route
from ..gonogo.frat import HIGH_FROM, LEVEL_WORDS, SELF_CHECKS, assess, risk_line
from ..gonogo.icing import icing_at_altitude, icing_line
from ..gonogo.minimums import under_minimums
from ..gonogo.pass_times import pass_time, sua_when, tfr_when
from ..gonogo.runways import runway_checks
from ..gonogo.schemas import GoNoGo, GoNoGoAsk
from ..gonogo.verdict import alternate_finding, verdict_items, verdict_line, with_alternate
from ..gonogo.weight_balance import balance, default_load
from ..gonogo.words import (
    PLAN_NAME, WEATHER_SOURCE_LABEL, alt_ft, ceiling_and_visibility, flight_level, gairmet_title, grouped, sigmet_hazard, to_fixed,
)
from ..planning import COMPUTE_LIMIT_S
from ..scoring import route_checkpoints
from . import briefing as briefing_router
from .plan import (
    NoWinds, PlanQuery, Unflyable, _result, _running_stages, _waited, flown_legs, hop_runs, join_outcomes, resolve_run,
    totals_of, unflyable_parts, with_holds, with_procedures,
)

router = APIRouter()
log = logging.getLogger(__name__)

#: PlanQuery's fields, which the ask carries first.
ROUTE_FIELDS = (
    "dep", "dest", "stops", "altitude_ft", "altitude_nearest", "altitude_choice", "aircraft", "cruise_tas_kt",
    "fuel_burn_gph", "usable_fuel_gal", "climb_tas_kt", "climb_fuel_burn_gph", "cruise_power_pct", "service_ceiling_ft",
    "depart", "class_b_clearance", "rules", "alternate", "altitudes", "procedures", "runways", "crossings", "holds",
    "ground", "checkpoints",
)


@dataclass
class Planned:
    """What the nav log says of the route: its altitude line (`nav`: the
    plan flown, its altitude, the four plans, the selection, the airplane
    and a pilot's own altitude's cautions), its legs and its totals; or,
    for a route with no legal altitude, the planner's line why
    (`problem`), as the web's usePlan has them."""

    nav: dict | None
    legs: list[dict]
    totals: dict | None
    problem: str | None = None


def _as_dict(value) -> dict:
    return value.model_dump() if isinstance(value, BaseModel) else value


def plan_for(q: PlanQuery, r) -> Planned:
    """The route planned as /api/plan plans it, bounded the same way."""
    own = q.own_altitudes()
    drawn = q.drawn_procedures()
    profile = q.profile()
    runs: list = []

    def work():
        _, _, by_hop = route_checkpoints(r) if q.checkpoints else ([], [], [[] for _ in r.hops])
        runs.extend(hop_runs(r, by_hop, q.depart, profile, q.own_ground(), q.own_holds()))
        return join_outcomes(runs, [resolve_run(run, profile, q) for run in runs])

    pool = ThreadPoolExecutor(max_workers=1)
    try:
        outcome = _result(_waited(
            pool.submit(work), COMPUTE_LIMIT_S,
            lambda: [stage for run in runs for stage in _running_stages(run, q)] if runs else ["chart"],
        ))
    finally:
        pool.shutdown(wait=False)
    aircraft = {"name": q.aircraft, **profile}
    if isinstance(outcome, Unflyable):
        why, _ = unflyable_parts(outcome, runs)
        return Planned(nav=None, legs=[], totals=None, problem=why["brief"])
    options = [_as_dict(o) for o in outcome.options]
    if isinstance(outcome, NoWinds):
        # The altitude line came, then the winds failed: no legs, no totals.
        return Planned(nav={"flown": None, "altitude_ft": None, "options": options, "selection": outcome.selection,
                            "aircraft": aircraft, "cautions": []}, legs=[], totals=None)
    nav = {"flown": outcome.choice or "custom", "altitude_ft": outcome.altitude_ft, "options": options,
           "selection": outcome.selection, "aircraft": aircraft, "cautions": [_as_dict(c) for c in outcome.cautions]}
    outcome = with_holds(r, runs, with_procedures(r, runs, outcome, drawn, q.departure_runways()), q.own_holds())
    legs = [_as_dict(leg) for leg in flown_legs(r, runs, outcome, own, drawn, q.own_ground())]
    totals = totals_of(r, runs, outcome, profile, q.rules, q.alternate, q.own_ground())
    return Planned(nav=nav, legs=legs, totals=totals)


def brief_for(q: PlanQuery, ete_min: float | None) -> dict:
    """The route's briefing for the flight's hours, as /api/briefing."""
    return _as_dict(briefing_router.briefing(q.dep, q.dest, q.stops, q.depart, ete_min))


def alternate_for(dest: str, eta: datetime, tas_kt: float, filed: str) -> dict | None:
    """The IFR alternate's check (/api/alternate); None where it could not
    be made, as the web's query that failed."""
    try:
        return _as_dict(briefing_router.alternate(dest, eta, tas_kt, filed))
    except HTTPException:
        return None


def _marked(factor: dict) -> dict:
    """A risk factor with its mark (RiskAssessment.tsx): a stop where it
    makes the flight unlawful or is high on its own, else a caution."""
    stop = factor.get("stop", False)
    return {**factor, "stop": stop, "finding": "stop" if stop or factor["points"] >= HIGH_FROM else "caution"}


def _altitude_range(nav: dict) -> str:
    """The altitudes a plan flies as the nav log's header gives them: one
    figure, or its lowest and highest (FlightBriefingView altitudeRange)."""
    chosen = next((o for o in nav["options"] if o["kind"] == nav["flown"]), None)
    alts = [s["altitude_ft"] for s in chosen["steps"]] if chosen else [nav["altitude_ft"]] if nav["altitude_ft"] is not None else []
    if not alts:
        return "No altitude"
    low, high = min(alts), max(alts)
    return f"{alt_ft(low)} ft" if low == high else f"{alt_ft(low)}–{alt_ft(high)} ft"


def _flown_words(nav: dict) -> str:
    if nav["flown"] == "custom":
        return f"{flight_level(nav['altitude_ft'])}, your own"
    chosen = next((o for o in nav["options"] if o["kind"] == nav["flown"]), None)
    plan = f" · {PLAN_NAME[chosen['kind']]} plan" if chosen else ""
    return f"{_altitude_range(nav)}{plan}"


@router.post("/api/go-no-go")
def go_no_go(ask: GoNoGoAsk) -> GoNoGo:
    """The Go / No-Go for a route: each finding -- the weather, the TFRs and
    special-use airspace, the altitude, the fuel, the runways, the weight
    and balance and the risk -- with where it is said in full, and the
    line over them; the risk assessment and the weight and balance it
    counted, for the Brief's own pages. The rules are web/src/lib/verdict's
    and the modules it is fed from, ported to app.gonogo; the pilot's
    minimums, loading, ticks, currency and own airplane's records come in
    the ask."""
    q = PlanQuery(**{k: getattr(ask, k) for k in ROUTE_FIELDS})
    r = load_route(q.dep, q.dest, q.stops)
    planned = plan_for(q, r)
    nav, legs, totals = planned.nav, planned.legs, planned.totals
    failed = None
    try:
        briefing = brief_for(q, (totals or {}).get("ete_min"))
    except HTTPException as err:
        briefing, failed = None, str(err.detail)
    except Exception:   # noqa: BLE001 -- the web says a briefing that failed, whatever failed it
        log.exception("briefing for the Go / No-Go")
        briefing, failed = None, "the briefing could not be fetched"

    depart = q.depart if q.depart is None or q.depart.tzinfo else q.depart.replace(tzinfo=timezone.utc)
    depart = depart or planning_module.now()
    day = ask.day or depart.astimezone(timezone.utc).strftime("%Y-%m-%d")
    ifr = q.rules == "ifr"
    # Every airport the flight lands at, each once; a waypoint flown
    # through has no weather of its own.
    fields = [{"ident": i, "elevation_ft": a.get("elevation_ft")} for i, a in zip(r.idents, r.airports) if not a.get("fix")]
    landings = list(dict.fromkeys(f["ident"] for f in fields))
    dest = r.idents[-1]
    selection = (nav or {}).get("selection") or {}

    def unchecked(source: str) -> bool:
        return bool(briefing) and source in (briefing.get("weather_unavailable") or [])

    # Under IFR "VFR flight not recommended" is no reason not to go: its
    # weather check is the destination's and the alternate's (14 CFR
    # 91.169), not VFR's minimums.
    vnr = [] if ifr else list((briefing or {}).get("vfr_not_recommended") or [])
    under_mine = under_minimums(ask.minimums.model_dump(), briefing, landings, dest) if briefing else []

    def pass_at(along_nm: float):
        return pass_time(legs, depart, along_nm)

    # The TFRs the route goes through while they are in force: when the
    # flight gets there (half an hour either way), or at some time during
    # the flight where that time is not known.
    tfrs_crossed = []
    for t in (briefing or {}).get("tfrs") or []:
        if t.get("crosses"):
            at = pass_at(t["along_track_nm"])
            if not at or tfr_when(t, at) == "in-force":
                tfrs_crossed.append(t)
    special_use = []
    for area in selection.get("special_use") or []:
        at = pass_at(area["along_track_nm"])
        special_use.append({"name": area["name"],
                            "when": sua_when(area.get("times_of_use"), at, area.get("time_zone")) if at else "unknown"})

    hops = (totals or {}).get("hops") or []
    margins = [m for m in [(totals or {}).get("fuel_margin_gal"), *(h["totals"].get("fuel_margin_gal") for h in hops)] if m is not None]
    icing = (icing_at_altitude(selection, [leg["altitude_ft"] for leg in legs], briefing.get("pireps") or [])
             if ifr and nav and briefing else None)
    hazard_names = ([sigmet_hazard(h.get("hazard"), h.get("type") or "SIGMET") for h in briefing.get("hazards") or []]
                    + [gairmet_title(g) for g in briefing.get("gairmets") or []]) if briefing else []

    assessment = None
    if briefing:
        risk_in = {
            "vfr_not_recommended": bool(vnr), "under_minimums": under_mine, "tfr_on_route": bool(tfrs_crossed),
            "hazards": 0 if unchecked("hazards") and unchecked("gairmets") else len(hazard_names),
            "night": (totals or {}).get("night") is True,
            "fuel_margin_gal": min(margins) if margins else None,
            "ifr": ifr, "currency": ask.currency.model_dump() if ask.currency else None,
            "day": day, "ticked": {key: True for key in ask.ticked},
        }
        if ask.own_airplane:
            own = ask.own_airplane
            risk_in["vor_check"] = own.vor_check.model_dump() if own.vor_check else None
            risk_in["inspections"] = own.inspections.model_dump() if own.inspections else None
            risk_in["squawks"] = [s.model_dump() for s in own.squawks]
        assessment = assess(risk_in)

    # The loading (lib/weightBalance): the pilot's, else the POH's sample
    # airplane with the usable fuel aboard.
    profile = (nav or {}).get("aircraft") or {"name": q.aircraft, **q.profile()}
    loading = profile.get("loading")
    usable = profile.get("usable_fuel_gal")
    load = ask.load.model_dump() if ask.load else (
        default_load(loading, usable if usable is not None else loading["fuel_max_gal"]) if loading else None)
    loaded = balance(loading, load, (totals or {}).get("fuel_gal")) if loading and load else None
    # The verdict's balance and runways as the web's, which wait on the nav log.
    nav_loaded = loaded if nav else None
    checks = runway_checks(nav and nav["aircraft"], briefing, fields,
                           nav_loaded["takeoff"]["weight_lb"] if nav_loaded else None,
                           nav_loaded["landing"]["weight_lb"] if nav_loaded else None,
                           ask.runway_picks.model_dump() if ask.runway_picks else None)

    items = verdict_items({
        "weather": {
            "pending": not briefing and not failed, "failed": failed,
            "vfr_not_recommended": vnr, "under_minimums": under_mine, "icing": icing and icing_line(icing),
            "hazards": hazard_names,
            "unchecked": [WEATHER_SOURCE_LABEL[w] for w in (briefing or {}).get("weather_unavailable") or [] if w != "tfrs"],
            "worst": ceiling_and_visibility(briefing["forecast"].get("min_ceiling_ft"), briefing["forecast"].get("min_visibility_sm"))
            if briefing and (briefing["forecast"].get("min_ceiling_ft") is not None
                             or briefing["forecast"].get("min_visibility_sm") is not None) else None,
        },
        "airspace": {
            "pending": not briefing and not failed, "unchecked": bool(failed) or unchecked("tfrs"),
            "in_force": [t["notam_id"] for t in tfrs_crossed],
            "near": len((briefing or {}).get("tfrs") or []) - len(tfrs_crossed),
            "special_use": special_use,
        },
        "altitude": {
            "pending": not nav, "problem": planned.problem,
            "cautions": [reason for c in (nav or {}).get("cautions") or [] for reason in c["reasons"]],
            "flown": _flown_words(nav) if nav else None,
        },
        "fuel": {
            "pending": not totals,
            "margin_gal": min(margins) if margins else None,
            "required_gal": (totals or {}).get("fuel_required_gal") if (totals or {}).get("fuel_required_gal") is not None
            else (max(h["totals"].get("fuel_required_gal") or 0 for h in hops) if hops else None),
            "reserve_min": (totals or {}).get("reserve_min") if (totals or {}).get("reserve_min") is not None
            else (hops[0]["totals"].get("reserve_min") if hops else None),
            "ifr": ifr,
        },
        "runways": {
            "pending": not nav or not briefing,
            "worked": not nav or (bool(nav["aircraft"].get("takeoff")) and bool(nav["aircraft"].get("landing"))),
            "short": list(dict.fromkeys(c["field"]["ident"] for c in checks if any(d["over"] for d in c["distances"]))),
            "crosswind": list(dict.fromkeys(c["field"]["ident"] for c in checks if c["crosswind_over"])),
        },
        "balance": {
            "pending": not nav, "worked": bool(nav_loaded),
            "problems": nav_loaded["problems"] if nav_loaded else [],
            "takeoff": f"{grouped(nav_loaded['takeoff']['weight_lb'])} lb at {to_fixed(nav_loaded['takeoff']['arm_in'])} in"
            if nav_loaded else None,
        },
        "risk": {"level": assessment["level"], "line": risk_line(assessment)} if assessment else None,
    })
    # Under IFR, the alternate (14 CFR 91.169), its ETA the nav log's.
    if ifr and totals and totals.get("ete_min") is not None:
        eta = depart + timedelta(minutes=totals["ete_min"])
        tas = (nav or {}).get("aircraft", {}).get("cruise_tas_kt") or 110
        items = with_alternate(items, alternate_finding(alternate_for(dest, eta, tas, q.alternate)))

    return GoNoGo(
        line=verdict_line(items),
        items=items,
        risk={**assessment, "factors": [_marked(f) for f in assessment["factors"]], "line": risk_line(assessment),
              "words": LEVEL_WORDS[assessment["level"]]} if assessment else None,
        self_checks=[_marked(c) for c in SELF_CHECKS],
        loading=loading,
        balance={**loaded, "load": load} if loaded else None,
    )

