"""Dead-reckoning leg math -- true course/heading, wind correction angle,
magnetic heading, groundspeed, ETE, and fuel burn for one leg of a nav log.
Building blocks (bearing/distance, wind aloft, magnetic variation) already
exist in vfr.geo / vfr.weather / vfr.magnetic; this module is where they get
combined per FAA-standard E6B formulas.

Compass heading (correcting magnetic for the specific aircraft's compass
deviation) is deliberately not computed here -- that needs a per-aircraft
deviation card, which isn't data this project has (vfr.aircraft profiles
don't carry one). Magnetic heading is as far as this goes for now.
"""
import math
from itertools import pairwise

from .geo import bearing_deg, distance_nm
from .magnetic import magnetic_variation_deg
from .weather import wind_at_altitude


def wind_correction_angle_deg(true_course_deg: float, wind_dir_true_deg: float, wind_speed_kt: float, tas_kt: float) -> float:
    """Standard E6B wind-triangle formula. wind_dir_true_deg is the
    direction the wind is FROM (meteorological convention), same as
    vfr.weather.wind_at_altitude returns. Positive WCA means correct to
    the right of true course (add to get true heading); negative, left.
    """
    relative_wind_deg = wind_dir_true_deg - true_course_deg
    ratio = (wind_speed_kt / tas_kt) * math.sin(math.radians(relative_wind_deg))
    ratio = max(-1.0, min(1.0, ratio))  # guard float noise at the asin domain edge
    return math.degrees(math.asin(ratio))


def groundspeed_kt(true_course_deg: float, wind_dir_true_deg: float, wind_speed_kt: float, tas_kt: float, wca_deg: float) -> float:
    """True airspeed minus the wind's component along the course, once
    wca_deg (the wind correction angle) has already pointed the aircraft's
    nose to hold that course -- standard wind-triangle groundspeed."""
    relative_wind_deg = wind_dir_true_deg - true_course_deg
    return tas_kt * math.cos(math.radians(wca_deg)) - wind_speed_kt * math.cos(math.radians(relative_wind_deg))


def assemble_leg(
    start: tuple,
    end: tuple,
    altitude_ft: float,
    aircraft_profile: dict,
    fcst_hr: str = "06",
) -> dict:
    """One nav-log leg between two (lat, lon) points: true course/distance
    (vfr.geo), wind at altitude_ft along the way (vfr.weather -- sampled at
    the leg's midpoint), magnetic variation (vfr.magnetic), and the
    resulting WCA/heading/groundspeed/ETE/fuel burn. aircraft_profile is a
    vfr.aircraft.load_aircraft_profile() dict; must include "cruise_tas_kt"
    and "fuel_burn_gph" (c172.json has both).

    If no wind data is available for this leg (vfr.weather.wind_at_altitude
    returned None -- no nearby FD station), WCA is 0 and groundspeed is
    just TAS -- a deliberate "no wind correction, not calm" fallback,
    flagged in the returned dict via "wind": None so callers/humans can see
    the leg is a no-wind-data estimate, not a real zero-wind calculation.
    """
    for field in ("cruise_tas_kt", "fuel_burn_gph"):
        if field not in aircraft_profile:
            raise ValueError(f"aircraft_profile is missing '{field}', needed for dead-reckoning leg math")
    tas_kt = aircraft_profile["cruise_tas_kt"]

    true_course_deg = bearing_deg(*start, *end)
    leg_distance_nm = distance_nm(*start, *end)
    mid_lat, mid_lon = (start[0] + end[0]) / 2, (start[1] + end[1]) / 2

    wind = wind_at_altitude(mid_lat, mid_lon, altitude_ft, fcst_hr)
    if wind is None:
        wca_deg = 0.0
        gs_kt = tas_kt
    else:
        wca_deg = wind_correction_angle_deg(true_course_deg, wind["wind_dir_true_deg"], wind["wind_speed_kt"], tas_kt)
        gs_kt = groundspeed_kt(true_course_deg, wind["wind_dir_true_deg"], wind["wind_speed_kt"], tas_kt, wca_deg)

    true_heading_deg = (true_course_deg + wca_deg) % 360
    variation_deg = magnetic_variation_deg(mid_lat, mid_lon)
    magnetic_heading_deg = (true_heading_deg - variation_deg) % 360

    ete_min = (leg_distance_nm / gs_kt) * 60 if gs_kt > 0 else float("inf")
    fuel_gal = (ete_min / 60) * aircraft_profile["fuel_burn_gph"]

    return {
        "true_course_deg": true_course_deg,
        "distance_nm": leg_distance_nm,
        "altitude_ft": altitude_ft,
        "wind": wind,
        "wca_deg": wca_deg,
        "true_heading_deg": true_heading_deg,
        "magnetic_variation_deg": variation_deg,
        "magnetic_heading_deg": magnetic_heading_deg,
        "groundspeed_kt": gs_kt,
        "ete_min": ete_min,
        "fuel_gal": fuel_gal,
    }


def fixes(dep_ident: str, dest_ident: str, start: tuple, end: tuple, selected: list) -> list:
    """The nav log flies departure -> checkpoints -> destination. The
    airports are the ends of the flight, so they bound the legs even
    though neither is a checkpoint candidate."""
    return (
        [{"name": dep_ident, "category": "departure", "lat": start[0], "lon": start[1]}]
        + selected
        + [{"name": dest_ident, "category": "destination", "lat": end[0], "lon": end[1]}]
    )


def leg_between(a: dict, b: dict, altitude_ft: float, profile: dict) -> dict:
    """assemble_leg between two fixes -- dicts with lat, lon and a name
    (or a category to fall back on) -- named after them on "from"/"to".

    assemble_leg returns inf for ETE when groundspeed is zero or negative
    (a headwind at or above cruise TAS). Python's json emits that as a
    bare Infinity, which is not valid JSON and makes JSON.parse throw in
    the browser, so a whole plan would fail to render because of one
    unflyable leg. None says "unflyable" honestly and the page shows it
    as such.
    """
    leg = assemble_leg((a["lat"], a["lon"]), (b["lat"], b["lon"]), altitude_ft, profile)
    leg["from"] = a["name"] or a["category"]
    leg["to"] = b["name"] or b["category"]
    for field in ("ete_min", "fuel_gal", "groundspeed_kt"):
        if not math.isfinite(leg[field]):
            leg[field] = None
    return leg


def legs(fix_list: list, altitude_ft: float, profile: dict) -> list:
    """One leg between each consecutive pair of fixes, in the given order."""
    return [leg_between(a, b, altitude_ft, profile) for a, b in pairwise(fix_list)]


def totals(leg_list: list) -> dict:
    def _total(field: str):
        values = [leg[field] for leg in leg_list if leg[field] is not None]
        return round(sum(values), 1) if len(values) == len(leg_list) else None

    return {
        "distance_nm": round(sum(leg["distance_nm"] for leg in leg_list), 1),
        # None rather than a wrong number if any leg is unflyable:
        # silently summing the flyable ones would understate the trip.
        "ete_min": _total("ete_min"),
        "fuel_gal": _total("fuel_gal"),
        "unflyable_legs": sum(1 for leg in leg_list if leg["ete_min"] is None),
        # Surfaced rather than averaged away: a leg with no nearby
        # winds-aloft station is a no-wind-data estimate, not a calm
        # one, and a pilot should know which legs those are.
        "legs_without_wind": sum(1 for leg in leg_list if leg.get("wind") is None),
    }
