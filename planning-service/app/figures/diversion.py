"""A diversion worked out exactly (the roadmap's diversion drill, ACS
PA.VI.C): from a point on the route to the field a student picks, in the
leg's own air, the wind triangle, the magnetic heading, the ground speed,
the time and the fuel; and a student's estimates checked against the
drill's allowances. Each is worked out by the engine
(wingtip_engine::figures::diversion, through wingtip_native), the one copy the
planner and the phones share.

web/src/lib/diversion.ts asks the same engine (its WebAssembly, by the
rule's name)."""
import json

import wingtip_native

#: The figures a student estimates, and how far off is still reasonable
#: (the drill's own: PA.VI.C.S2 gives no figures).
ALLOWANCES = [{"key": key, "label": label, "unit": unit, "allowance": allowance}
              for key, label, unit, allowance in wingtip_native.diversion_allowances()]

_SOLVED = ("tc", "distance_nm", "wca", "th", "mh", "gs", "ete", "fuel")


def wind_triangle(tc: float, tas: float, wind_from_deg: float, wind_kt: float) -> dict | None:
    """The wind triangle for a true course: the correction (+ right), the
    true heading and the ground speed; None where no heading holds the
    course (the nav log's own correction and ground speed)."""
    solved = wingtip_native.diversion_wind_triangle(tc, tas, wind_from_deg, wind_kt)
    return None if solved is None else dict(zip(("wca", "th", "gs"), solved))


def divert(leg: dict, tc_deg: float, distance_nm: float) -> dict | None:
    """The diversion from a point on `leg` to a field `distance_nm` away on
    a true course of `tc_deg`, flown in the leg's air at its cruise burn.
    `leg` carries `tas_kt`, `fuel_burn_gph`, `magnetic_variation_deg` and
    `wind` (`wind_dir_true_deg`, `wind_speed_kt`, or None: no wind)."""
    wind = leg.get("wind") or {}
    solved = wingtip_native.diversion_divert(tc_deg, distance_nm, leg["tas_kt"], leg["fuel_burn_gph"], leg["magnetic_variation_deg"],
                                         wind.get("wind_dir_true_deg") or 0, wind.get("wind_speed_kt") or 0)
    return None if solved is None else dict(zip(_SOLVED, solved))


def drill(leg: dict, to: str, typed: dict) -> dict:
    """The drill as the page shows it, from a point on `leg` to the field
    `to` on the leg's own true course and distance: the solution (None
    where no heading holds), its steps in words, the problem where there
    is none, and each of the student's `typed` estimates (by key, None
    where not given) checked and written as the drill writes it."""
    wind = leg.get("wind") or {}
    return json.loads(wingtip_native.diversion_json(
        leg["true_course_deg"], leg["distance_nm"], leg["tas_kt"], leg["fuel_burn_gph"], leg["magnetic_variation_deg"],
        wind.get("wind_dir_true_deg") or 0, wind.get("wind_speed_kt") or 0, to,
        typed.get("mh"), typed.get("gs"), typed.get("ete"), typed.get("fuel")))


def reasonable(key: str, typed: float, exact: float) -> bool:
    """Whether an estimate is within its allowance, a heading round the
    compass (358 is 4 from 002)."""
    return wingtip_native.diversion_reasonable(key, typed, exact)
