"""A diversion worked out exactly (the roadmap's diversion drill, ACS
PA.VI.C): from a point on the route, to the field a student picks, in the
leg's own air -- its altitude, wind, true airspeed, burn and variation --
the true course and distance there, the wind triangle, the magnetic
heading, the ground speed, the time and the fuel. And a student's own
estimates checked against it.

The ACS asks for "a reasonable estimate of heading, groundspeed, arrival
time, and fuel required" (PA.VI.C.S2) and gives no figures; ALLOWANCES are
this drill's own, about what a pilot works out in their head and off the
chart while flying the airplane.

web/src/lib/diversion.ts ported line for line: the two hold the same rules
and change together."""
import math

from vfr import navlog
from vfr.geo import angle_between

#: The figures a student estimates, and how far off is still reasonable.
ALLOWANCES = [
    {"key": "mh", "label": "Magnetic heading", "unit": "°", "allowance": 10},
    {"key": "gs", "label": "Ground speed", "unit": "kt", "allowance": 10},
    {"key": "ete", "label": "Time", "unit": "min", "allowance": 3},
    {"key": "fuel", "label": "Fuel", "unit": "gal", "allowance": 1},
]


def _round360(d: float) -> float:
    return (d % 360 + 360) % 360


def wind_triangle(tc: float, tas: float, wind_from_deg: float, wind_kt: float) -> dict | None:
    """The wind triangle for a true course: the correction (+ right), the
    true heading and the ground speed; None where the crosswind is more
    than the airplane's speed and no heading holds the course."""
    if abs(wind_kt * math.sin(math.radians(wind_from_deg - tc))) > tas:
        return None
    # The nav log's own wind triangle (vfr.navlog). `+ 0.0`: a calm
    # wind's correction is none, not -0.
    wca = navlog.wind_correction_angle_deg(tc, wind_from_deg, wind_kt, tas) + 0.0
    gs = navlog.groundspeed_kt(tc, wind_from_deg, wind_kt, tas, wca)
    return {"wca": wca, "th": _round360(tc + wca), "gs": gs} if gs > 0 else None


def divert(leg: dict, tc_deg: float, distance_nm: float) -> dict | None:
    """The diversion from a point on `leg` to a field `distance_nm` away on
    a true course of `tc_deg`, flown in the leg's air at its cruise burn.
    `leg` carries `tas_kt`, `fuel_burn_gph`, `magnetic_variation_deg` and
    `wind` (`wind_dir_true_deg`, `wind_speed_kt`, or None: no wind)."""
    wind = leg.get("wind") or {}
    solved = wind_triangle(tc_deg, leg["tas_kt"], wind.get("wind_dir_true_deg") or 0, wind.get("wind_speed_kt") or 0)
    if not solved:
        return None
    ete = (distance_nm / solved["gs"]) * 60
    return {
        "tc": tc_deg, "distance_nm": distance_nm, **solved,
        # East is least: a variation east (positive) comes off.
        "mh": _round360(solved["th"] - leg["magnetic_variation_deg"]),
        "ete": ete, "fuel": (ete / 60) * leg["fuel_burn_gph"],
    }


def reasonable(key: str, typed: float, exact: float) -> bool:
    """Whether an estimate is reasonable: within its allowance, a heading
    round the compass (358 is 4 from 002)."""
    allowance = next(a["allowance"] for a in ALLOWANCES if a["key"] == key)
    off = angle_between(typed, exact) if key == "mh" else abs(typed - exact)
    return off <= allowance + 1e-9
