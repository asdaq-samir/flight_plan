"""Holding-pattern entries and wind (the roadmap's holding visualiser, ACS
IR.III.B), as AIM 5-3-8 gives them: the entry from the airplane's heading
to the fix against the holding course -- direct from the 180 degree
sector, teardrop from the 70 degree one on the non-holding side beyond the
fix, parallel from the 110 degree one on the holding side -- the 70 degree
line drawn on the holding side, for left turns mirrored; and the inbound
leg at a minute (a minute and a half above 14,000 ft MSL), the outbound
heading and time worked to make it so in the wind.

web/src/lib/holding.ts, and the words of features/pilot/HoldingPage.tsx,
ported line for line: the two hold the same rules and change together."""
import math

from ..gonogo.words import js_round
from .debrief import angle_between
from .diversion import wind_triangle

ENTRY_NAME = {"direct": "Direct", "teardrop": "Teardrop", "parallel": "Parallel"}


def _norm(deg: float) -> float:
    return (deg % 360 + 360) % 360


def bearing(deg: float) -> str:
    """A direction as a pilot writes it, "005°", north "360°" (lib/units
    bearing)."""
    whole = (js_round(deg) % 360 + 360) % 360
    return f"{360 if whole == 0 else whole:03d}°"


def wind_correction(deg: float) -> str:
    """A correction signed, "+8°", "−3°", none "0°" (lib/units windCorrection)."""
    shown = js_round(abs(deg))
    return f"{'' if shown == 0 else '+' if deg > 0 else '−'}{shown}°"


def leg_minutes(altitude_ft: float) -> float:
    """The inbound leg's time at an altitude, minutes: "At or below 14,000
    feet MSL: 1 minute. Above 14,000 feet MSL: 1 1/2 minutes" (AIM 5-3-8
    j.4(a)), as the planner's vfr.holds times a hold with none given."""
    return 1.5 if altitude_ft > 14_000 else 1


def holding_entry(inbound_deg: float, heading_deg: float, turns: str) -> dict:
    """The entry for an airplane heading `heading_deg` to the fix of a hold
    on `inbound_deg` with `turns`: by AIM 5-3-8's sectors, the heading
    against the inbound course -- for right turns, direct within 110 right
    to 70 left of it, teardrop beyond 110 right to the reciprocal, parallel
    beyond the reciprocal to 70 left; left turns their mirror. `either`
    where it is within 5 degrees of a sector's edge, where the AIM lets a
    pilot use either entry ("A maximum of 5 degrees in heading is
    considered to be within allowable good operating limits for
    determining entry", AIM 5-3-8 j.2)."""
    off = _norm(heading_deg - inbound_deg if turns == "right" else inbound_deg - heading_deg)
    entry = "direct" if off <= 110 or off >= 290 else "teardrop" if off <= 180 else "parallel"
    edges = [(110, "direct", "teardrop"), (180, "teardrop", "parallel"), (290, "parallel", "direct")]
    near = next((e for e in edges if angle_between(off, e[0]) <= 5), None)
    either = (near[2] if near[1] == entry else near[1]) if near else None
    return {"entry": entry, "either": either}


def approach_relative(inbound_deg: float, heading_deg: float) -> float:
    """The bearing from the fix the airplane comes from, against the
    inbound course, for drawing: where it is on the page round the fix."""
    return _norm(heading_deg + 180 - inbound_deg)


def headwind_kt(from_deg: float, kt: float, heading_deg: float) -> float:
    """The headwind of a wind on a heading, negative a tailwind (lib/wind
    headwindKt, vfr.runway_wind.components_kt)."""
    return kt * math.cos(math.radians(from_deg - heading_deg))


def holding_wind(inbound_deg: float, tas_kt: float, wind_from_deg: float, wind_kt: float, altitude_ft: float) -> dict | None:
    """The legs flown in a wind from `wind_from_deg` at `wind_kt` at
    `tas_kt`, the courses and the wind in the same reference (magnetic, as
    a clearance gives the course). None where the wind is stronger than
    the airplane. The outbound heading by the rule of three: three times
    the inbound correction, the other way ("When outbound, triple the
    inbound drift correction", AIM 5-3-8 j.2); the outbound time, seconds,
    for the inbound leg to take its minute at the legs' ground speeds, the
    turns left out; and the rule of thumb's, a second a knot of the wind
    along the course."""
    leg_min = leg_minutes(altitude_ft)
    outbound_deg = _norm(inbound_deg + 180)
    inbound = wind_triangle(inbound_deg, tas_kt, wind_from_deg, wind_kt)
    out_leg = wind_triangle(outbound_deg, tas_kt, wind_from_deg, wind_kt)
    if not inbound or not out_leg:
        return None
    out_wca = -3 * inbound["wca"]
    headwind_in = headwind_kt(wind_from_deg, wind_kt, inbound_deg)
    return {
        "leg_min": leg_min,
        "inbound": {"heading": _norm(inbound_deg + inbound["wca"]), "wca": inbound["wca"], "gs": inbound["gs"]},
        "outbound": {"heading": _norm(outbound_deg + out_wca), "wca": out_wca, "gs": out_leg["gs"]},
        "outbound_sec": (leg_min * 60 * inbound["gs"]) / out_leg["gs"],
        # A headwind inbound is a tailwind outbound: shorten the outbound leg.
        "rule_sec": leg_min * 60 - headwind_in,
    }


def entry_steps(entry: str, inbound: float, turns: str, altitude_ft: float) -> str:
    """AIM 5-3-8's words for each entry, for the turns given: the outbound
    minute is a minute and a half above 14,000 ft MSL (leg_minutes)."""
    leg = "one minute" if leg_minutes(altitude_ft) == 1 else "a minute and a half"
    outbound = (inbound + 180) % 360
    away = "left" if turns == "right" else "right"
    if entry == "direct":
        return f"Fly to the fix and turn {turns} to follow the pattern: outbound on {bearing(outbound)}."
    if entry == "teardrop":
        tear = outbound - 30 if turns == "right" else outbound + 30
        return (f"Fly to the fix, then turn to {bearing(tear)}, 30° into the holding side, for {leg}; "
                f"turn {turns} to intercept the inbound course, {bearing(inbound)}.")
    return (f"At the fix, turn to {bearing(outbound)}, parallel to the holding course on the non-holding side, for {leg}; "
            f"then turn {away}, toward the holding side, through more than 180° to intercept the inbound course or return to the fix.")


def wind_words(w: dict) -> dict:
    """The rows' lines under the legs' figures, as HoldingPage writes them."""
    minute = "a minute" if w["leg_min"] == 1 else "a minute and a half"
    gs_in = js_round(w["inbound"]["gs"])
    return {
        "inbound": f"{wind_correction(w['inbound']['wca'])} for the wind, {gs_in} kt over the ground",
        "outbound": f"Three times the inbound correction, {wind_correction(w['outbound']['wca'])}, the turns' drift taken up too",
        "time": f"So the inbound leg takes {minute} at {gs_in} kt; by the rule of a second a knot, {js_round(w['rule_sec'])} s",
    }
