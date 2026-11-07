"""Holding-pattern entries and wind (the roadmap's holding visualiser, ACS
IR.III.B) by AIM 5-3-8: the entry from the airplane's heading against the
holding course, the other entry within 5 degrees of a sector's edge, and
the legs in the wind -- each worked out by the engine
(wingtip_engine::figures::holding, through wingtip_native), the one copy the
planner and the phones share. Only the dicts the router reads are made
here.

web/src/lib/holding.ts asks the same engine (its WebAssembly, by the
rule's name); the words of features/pilot/HoldingPage.tsx change with the
engine's."""
import json

import wingtip_native

ENTRY_NAME = {key: wingtip_native.holding_entry_name(key) for key in ("direct", "teardrop", "parallel")}


def leg_minutes(altitude_ft: float | None) -> float:
    """The inbound leg's minutes: a minute at or below 14,000 ft MSL, a
    minute and a half above (AIM 5-3-8 j.4(a))."""
    return wingtip_native.holding_leg_minutes(altitude_ft)


def bearing(deg: float) -> str:
    """A direction as a pilot writes it, "005°", north "360°" (lib/units
    bearing)."""
    return wingtip_native.figures_bearing(deg)


def holding_entry(inbound_deg: float, heading_deg: float, turns: str) -> dict:
    """The entry for an airplane heading `heading_deg` to the fix of a hold
    on `inbound_deg` with `turns` by AIM 5-3-8's sectors, and `either`, the
    other one, within 5 degrees of a sector's edge (AIM 5-3-8 j.8(d))."""
    entry, either = wingtip_native.holding_entry(inbound_deg, heading_deg, turns == "right")
    return {"entry": entry, "either": either}


def approach_relative(inbound_deg: float, heading_deg: float) -> float:
    """The bearing from the fix the airplane comes from, against the
    inbound course, for drawing."""
    return wingtip_native.holding_approach_relative(inbound_deg, heading_deg)


def holding_wind(inbound_deg: float, tas_kt: float, wind_from_deg: float, wind_kt: float, altitude_ft: float) -> dict | None:
    """The legs flown in the wind -- the inbound leg's minutes, each leg's
    heading, correction and ground speed, the outbound time by the speeds
    and by the rule of a second a knot -- or None where the wind is
    stronger than the airplane (AIM 5-3-8 j.4(a), j.8(c))."""
    worked = wingtip_native.holding_wind_json(inbound_deg, tas_kt, wind_from_deg, wind_kt, altitude_ft)
    if worked is None:
        return None
    w = json.loads(worked)
    for words in ("inbound_words", "outbound_words", "time_words"):
        del w[words]
    return w


def entry_steps(entry: str, inbound: float, turns: str, altitude_ft: float) -> str:
    """AIM 5-3-8's words for each entry, for the turns given."""
    return wingtip_native.holding_entry_steps(entry, inbound, turns == "right", altitude_ft)


def wind_words(w: dict) -> dict:
    """The rows' lines under the legs' figures, as HoldingPage writes them."""
    inbound, outbound, time = wingtip_native.holding_wind_words(
        w["leg_min"], w["inbound"]["wca"], w["inbound"]["gs"], w["outbound"]["wca"], w["rule_sec"])
    return {"inbound": inbound, "outbound": outbound, "time": time}
