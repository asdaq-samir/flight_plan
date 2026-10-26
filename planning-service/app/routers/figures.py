"""The figures four of the web app's pages work out in the browser, worked
out here for the native app so the phone computes no aviation figure
(docs/NATIVE.md; app.figures): the debrief of a flown track, the
diversion drill, a hold's entry and wind, and lost communications'
altitudes. The web app keeps its own (lib/debrief, lib/diversion,
lib/holding, lib/lostComms), and the two change together."""
import logging
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query
from vfr import airports, navlog, pattern
from vfr.weather import WeatherServiceError

from ..common import DEFAULT_AIRCRAFT
from ..figures import debrief as debrief_rules
from ..figures import diversion as diversion_rules
from ..figures import holding as holding_rules
from ..figures import lost_comms as lost_rules
from ..figures.schemas import (
    Debrief, DebriefAnswer, DebriefAsk, DebriefTolerances, Diversion, Holding, LostComms, LostCommsAsk,
)
from ..gonogo.words import js_round, to_fixed
from ..planning import aircraft_profile, forecast_hour_for
from .plan import CruisePower, CruiseTas

router = APIRouter()
log = logging.getLogger(__name__)

#: The fields a flight takes off from and lands at, among its checkpoints.
FIELD_CATEGORIES = ("departure", "stop", "destination")


def _pattern_altitudes(idents: list[str]) -> dict[str, float]:
    """Each field's pattern altitude, ft MSL, as its card gives it
    (vfr.pattern.pattern_at: the FAA's published one, else AC 90-66C's
    1,000 ft above the field), by the ident the flight saved; a field not
    found, or with no elevation, has none and is not graded."""
    out = {}
    for ident in dict.fromkeys(idents):
        try:
            place = airports.find_place(ident)
            if place is None:
                continue
            altitude = pattern.pattern_at(place["ident"], place["elevation_ft"])["altitude_ft"]
        except Exception:   # noqa: BLE001 -- one field's data missing leaves that field ungraded, not the debrief
            log.exception("pattern altitude for %s", ident)
            continue
        if altitude is not None:
            out[ident] = altitude
    return out


@router.post("/api/debrief")
def debrief(ask: DebriefAsk) -> DebriefAnswer:
    """A saved flight debriefed against its flown track (web/src/lib/debrief,
    ACS PA.VI.A): leg by leg the altitude and the course held, each
    checkpoint's time against its estimate, and the altitude entering
    each field's pattern -- each with its mark against the tolerance --
    the profile, the line for the map and notes on what does not fit.
    `debrief` is null where the track never flew faster than taxiing.
    The fields' pattern altitudes are the planner's own (the card's)."""
    checkpoints = [c.model_dump() for c in ask.checkpoints]
    points = sorted((p.model_dump() for p in ask.points), key=lambda p: p["t"])
    patterns = _pattern_altitudes([c["name"] for c in checkpoints if c["category"] in FIELD_CATEGORIES])
    found = debrief_rules.debrief(checkpoints, points, patterns)
    return DebriefAnswer(
        debrief=Debrief(**debrief_rules.marked(found)) if found else None,
        tolerances=DebriefTolerances(
            altitude_ft=debrief_rules.ALTITUDE_FT, course_deg=debrief_rules.COURSE_DEG, off_route_nm=debrief_rules.OFF_ROUTE_NM,
            eta_min=debrief_rules.ETA_MIN, pattern_nm=debrief_rules.PATTERN_NM, pattern_ft=debrief_rules.PATTERN_FT,
        ),
    )


def _written(key: str, value: float) -> str:
    """A figure as the student would write it (DiversionDrill written)."""
    if key == "mh":
        return holding_rules.bearing(value)
    if key == "fuel":
        return f"{to_fixed(value, 1)} gal"
    return f"{js_round(value)} {'kt' if key == 'gs' else 'min'}"


@router.get("/api/diversion")
def diversion(
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    to: Annotated[str, Query(min_length=2, max_length=8)],
    altitude_ft: Annotated[float, Query(gt=0, le=17_999)],
    aircraft: str = DEFAULT_AIRCRAFT,
    cruise_tas_kt: CruiseTas = None,
    fuel_burn_gph: Annotated[float | None, Query(gt=0, le=100)] = None,
    cruise_power_pct: CruisePower = None,
    depart: datetime | None = None,
    mh: float | None = None,
    gs: float | None = None,
    ete: float | None = None,
    fuel: float | None = None,
) -> Diversion:
    """The diversion drill (web/src/lib/diversion, ACS PA.VI.C): from a point
    to a field, in the planner's air on the way there at `altitude_ft` --
    the winds and temperature aloft for the hour (vfr.weather, the FD
    period for `depart`, now by default), the airplane's true airspeed and
    burn in that air (vfr.performance) and the variation (vfr.magnetic,
    the WMM) -- the true course and distance, the wind triangle, the
    magnetic heading, ground speed, time and fuel, each step in words;
    and the student's estimates (`mh`, `gs`, `ete`, `fuel`) checked
    against it, each within the drill's allowance or not."""
    place = airports.find_place(to)
    if place is None:
        raise HTTPException(404, f"No US airport goes by {to.strip().upper()!r}.")
    profile = aircraft_profile(aircraft, cruise_tas_kt, fuel_burn_gph, None, None, None, cruise_power_pct, None)
    try:
        leg = navlog.assemble_leg((lat, lon), (place["lat"], place["lon"]), altitude_ft, profile, forecast_hour_for(depart))
    except WeatherServiceError as err:
        raise HTTPException(503, "The winds aloft could not be fetched for the diversion.") from err
    solved = diversion_rules.divert(leg, leg["true_course_deg"], leg["distance_nm"])
    steps = []
    if solved:
        steps = [
            {"name": "True course", "value": f"{holding_rules.bearing(solved['tc'])}, {to_fixed(solved['distance_nm'], 1)} nm"},
            {"name": "Wind correction", "value": holding_rules.wind_correction(solved["wca"])},
            {"name": "True heading", "value": holding_rules.bearing(solved["th"])},
            {"name": "Magnetic heading", "value": holding_rules.bearing(solved["mh"])},
            {"name": "Ground speed", "value": f"{js_round(solved['gs'])} kt"},
            {"name": "Time", "value": f"{js_round(solved['ete'])} min"},
            {"name": "Fuel", "value": f"{to_fixed(solved['fuel'], 1)} gal"},
        ]
    typed = {"mh": mh, "gs": gs, "ete": ete, "fuel": fuel}
    checks = []
    for a in diversion_rules.ALLOWANCES:
        value, exact = typed[a["key"]], solved[a["key"]] if solved else None
        checks.append({
            **a, "typed": value, "exact": exact, "written": _written(a["key"], exact) if exact is not None else None,
            "reasonable": diversion_rules.reasonable(a["key"], value, exact) if value is not None and exact is not None else None,
        })
    return Diversion(
        to=place["ident"], name=place.get("name") or place["ident"], altitude_ft=altitude_ft,
        tas_kt=leg["tas_kt"], fuel_burn_gph=leg["fuel_burn_gph"], magnetic_variation_deg=leg["magnetic_variation_deg"],
        wind=leg["wind"] and {"wind_dir_true_deg": leg["wind"]["wind_dir_true_deg"], "wind_speed_kt": leg["wind"]["wind_speed_kt"]},
        solved=solved, steps=steps,
        problem=None if solved else f"The wind is too strong for a heading to {place['ident']} to hold.",
        checks=checks,
    )


@router.get("/api/holding")
def holding(
    inbound: Annotated[float, Query(ge=0, le=360)],
    heading: Annotated[float, Query(ge=0, le=360)],
    turns: Literal["right", "left"] = "right",
    tas_kt: Annotated[float | None, Query(gt=0, le=1000)] = None,
    wind_from: Annotated[float | None, Query(ge=0, le=360)] = None,
    wind_kt: Annotated[float | None, Query(ge=0, le=300)] = None,
    altitude_ft: Annotated[float | None, Query(ge=0, le=60_000)] = None,
) -> Holding:
    """A hold's entry (web/src/lib/holding, AIM 5-3-8): for an airplane
    heading `heading` to the fix of a hold on the inbound course `inbound`
    with `turns`, the entry by the AIM's sectors and its steps in words,
    and the other entry where the heading is within 5 degrees of a
    sector's edge; given a true airspeed, a wind (both the course's
    reference, magnetic as a clearance gives it) and the altitude, the
    inbound and outbound headings and the outbound time that make the
    inbound leg a minute (a minute and a half above 14,000 ft MSL)."""
    found = holding_rules.holding_entry(inbound, heading, turns)
    # No altitude is taken as at or below 14,000 ft MSL, as the web's page
    # does with its field blank: a minute's leg.
    at = altitude_ft if altitude_ft is not None else 0
    wind, problem = None, None
    if tas_kt is not None and wind_from is not None and wind_kt is not None and altitude_ft is not None:
        worked = holding_rules.holding_wind(inbound, tas_kt, wind_from, wind_kt, altitude_ft)
        if worked:
            words = holding_rules.wind_words(worked)
            wind = {**worked, "inbound_words": words["inbound"], "outbound_words": words["outbound"], "time_words": words["time"]}
        else:
            problem = "A wind stronger than the airplane holds no heading."
    return Holding(
        entry=found["entry"], entry_name=holding_rules.ENTRY_NAME[found["entry"]],
        steps=holding_rules.entry_steps(found["entry"], inbound, turns, at),
        either=found["either"], either_name=holding_rules.ENTRY_NAME[found["either"]] if found["either"] else None,
        approach_relative=holding_rules.approach_relative(inbound, heading),
        wind=wind, wind_problem=problem,
    )


@router.post("/api/lost-comms")
def lost_comms(ask: LostCommsAsk) -> LostComms:
    """Two-way radio failure under IFR (web/src/lib/lostComms, 14 CFR
    91.185): the routes in the rule's order, the altitude on each segment
    -- the highest of assigned, the minimum for IFR operations and
    expected, expected only from the segment it applies from -- and when
    to leave the clearance limit. A POST for the segments' list; it
    changes nothing."""
    segments = [{"name": s.name or "Segment", "minimum_ft": s.minimum_ft} for s in ask.segments]
    flown = lost_rules.segment_altitudes(segments, ask.assigned_ft, ask.expected_ft, ask.expected_from)
    return LostComms(
        vfr=lost_rules.VFR_WORDS,
        routes=lost_rules.ROUTES,
        segments=[{**f, "words": lost_rules.fly_words(f)} for f in flown],
        leave=lost_rules.leave_limit(ask.approach_fix, ask.efc.strip(), ask.eta.strip()),
    )
