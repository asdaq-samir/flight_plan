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


def leg_between(a: dict, b: dict, altitude_ft: float, profile: dict, fcst_hr: str = "06") -> dict:
    """assemble_leg between two fixes -- dicts with lat, lon and a name
    (or a category to fall back on) -- named after them on "from"/"to".
    `fcst_hr` picks the winds-aloft forecast period (06, 12 or 24 hours
    out) -- see vfr.weather.forecast_hour for which fits a departure.

    assemble_leg returns inf for ETE when groundspeed is zero or negative
    (a headwind at or above cruise TAS). Python's json emits that as a
    bare Infinity, which is not valid JSON and makes JSON.parse throw in
    the browser, so a whole plan would fail to render because of one
    unflyable leg. None says "unflyable" honestly and the page shows it
    as such.
    """
    leg = assemble_leg((a["lat"], a["lon"]), (b["lat"], b["lon"]), altitude_ft, profile, fcst_hr)
    leg["from"] = a["name"] or a["category"]
    leg["to"] = b["name"] or b["category"]
    for field in ("ete_min", "fuel_gal", "groundspeed_kt"):
        if not math.isfinite(leg[field]):
            leg[field] = None
    return leg


def legs(fix_list: list, altitude_ft: float, profile: dict, fcst_hr: str = "06") -> list:
    """One leg between each consecutive pair of fixes, in the given order."""
    return [leg_between(a, b, altitude_ft, profile, fcst_hr) for a, b in pairwise(fix_list)]


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


# --- Fuel: the trip plus the reserve, against the tanks -----------------

# 14 CFR 91.151: VFR needs fuel to the destination plus 30 minutes at
# normal cruise by day, 45 at night.
DAY_RESERVE_MIN = 30.0
NIGHT_RESERVE_MIN = 45.0


def fuel_plan(total_fuel_gal: float | None, aircraft_profile: dict, night: bool | None) -> dict:
    """The fuel the flight needs -- the legs' own total plus the VFR
    reserve at the profile's cruise burn -- against the profile's usable
    fuel when it has one. `night` None means no departure time was
    given, so the day reserve is assumed and said so. Every figure None
    that cannot be known: no total while a leg is unflyable, no margin
    without a usable-fuel figure."""
    reserve_min = NIGHT_RESERVE_MIN if night else DAY_RESERVE_MIN
    reserve_gal = round(reserve_min / 60 * aircraft_profile["fuel_burn_gph"], 2)
    required = None if total_fuel_gal is None else round(total_fuel_gal + reserve_gal, 1)
    usable = aircraft_profile.get("usable_fuel_gal")
    margin = None if required is None or usable is None else round(usable - required, 1)
    return {
        "reserve_min": reserve_min,
        "reserve_gal": reserve_gal,
        "fuel_required_gal": required,
        "usable_fuel_gal": usable,
        "fuel_margin_gal": margin,
        "night": night,
    }


# --- Three plans: lowest, highest, fastest --------------------------------

DEFAULT_CLIMB_RATE_FPM = 500.0
# A sea-level book figure decays with altitude; three quarters of it is
# a fair average over a light aeroplane's climb to a few thousand feet.
CLIMB_RATE_FACTOR = 0.75
# Climb speed as a fraction of cruise TAS when the profile has none
# (Vy is around 70% of cruise on a C172 or an Archer).
DEFAULT_CLIMB_TAS_FRACTION = 0.7
# What a step costs the lowest/highest plans, in feet times miles: an
# altitude change is only worth it when it lowers (or raises) the
# profile by more than 1,000 ft over 10 nm, so neither plan zig-zags
# for a leg's worth of slightly lower floor.
STEP_PENALTY_FT_NM = 10_000.0
PLAN_KINDS = ("lowest", "highest", "fastest")
# Above 12,500 ft, more than 30 minutes needs supplemental oxygen
# (14 CFR 91.211): no plan goes there unless the profile says the
# aeroplane carries it or is pressurised. The lowest plan cannot reach
# it anyway; highest and fastest are held under it.
OXYGEN_CAP_FT = 12500.0


# A climb at full power burns more than cruise; the book figure for a
# light single is around a third more.
CLIMB_FUEL_FACTOR = 1.3


def _climb_performance(aircraft_profile: dict) -> tuple:
    rate_fpm = aircraft_profile.get("climb_rate_fpm_sea_level", DEFAULT_CLIMB_RATE_FPM) * CLIMB_RATE_FACTOR
    cruise_tas = aircraft_profile["cruise_tas_kt"]
    climb_tas = aircraft_profile.get("climb_tas_kt", DEFAULT_CLIMB_TAS_FRACTION * cruise_tas)
    return rate_fpm, cruise_tas, climb_tas


def with_climbs(leg_list: list, start_altitude_ft: float | None, aircraft_profile: dict) -> list:
    """The legs with their climbs flown: from `start_altitude_ft` (the
    departure field, or None to start level at the first leg's own
    altitude) up to each leg's altitude, and up again wherever a plan
    steps up, at the profile's climb rate and climb speed and at
    CLIMB_FUEL_FACTOR times the cruise burn. A climb's minutes are
    flown over the ground at the climb speed scaled by the leg's own
    wind, the rest of the leg at cruise, and a climb longer than the
    leg carries into the next one. Each leg says how much of its time
    is climb (`climb_min`); a descent costs nothing here, since at
    cruise power it is if anything faster. The cruise-only legs are not
    changed in place."""
    rate_fpm, cruise_tas, climb_tas = _climb_performance(aircraft_profile)
    burn_gph = aircraft_profile["fuel_burn_gph"]
    level_ft = start_altitude_ft
    climb_left_min = 0.0
    out = []
    for leg in leg_list:
        leg = dict(leg)
        target_ft = leg["altitude_ft"]
        if level_ft is not None and target_ft > level_ft:
            climb_left_min += (target_ft - level_ft) / rate_fpm
        level_ft = target_ft if level_ft is None else max(level_ft, target_ft)
        leg["climb_min"] = 0.0
        if climb_left_min > 0 and leg["groundspeed_kt"] and leg["ete_min"] is not None:
            climb_gs = max(1.0, leg["groundspeed_kt"] * climb_tas / cruise_tas)
            climb_nm = climb_gs * climb_left_min / 60
            if climb_nm >= leg["distance_nm"]:
                climb_min = leg["distance_nm"] / climb_gs * 60
                cruise_min = 0.0
                climb_left_min -= climb_min
            else:
                climb_min = climb_left_min
                cruise_min = (leg["distance_nm"] - climb_nm) / leg["groundspeed_kt"] * 60
                climb_left_min = 0.0
            leg["climb_min"] = round(climb_min, 1)
            leg["ete_min"] = climb_min + cruise_min
            leg["fuel_gal"] = (climb_min / 60) * burn_gph * CLIMB_FUEL_FACTOR + (cruise_min / 60) * burn_gph
        out.append(leg)
    return out


def climb_penalty_min(delta_ft: float, aircraft_profile: dict) -> float:
    """Minutes a climb of delta_ft costs over cruising level: the climb
    takes delta_ft / rate minutes, flown at climb speed rather than
    cruise, and the difference is ground not covered. A descent costs
    nothing here -- at cruise power it is, if anything, faster. The
    profile's `climb_rate_fpm_sea_level` (scaled by CLIMB_RATE_FACTOR)
    and `climb_tas_kt` when it has them, defaults otherwise.
    """
    if delta_ft <= 0:
        return 0.0
    rate_fpm, cruise_tas, climb_tas = _climb_performance(aircraft_profile)
    return (delta_ft / rate_fpm) * (1 - climb_tas / cruise_tas)


def _best_path(candidates: list, leg_cost, step_cost) -> list:
    """The altitude for each leg that minimises the summed leg and step
    costs -- dynamic programming over legs, one state per legal
    altitude of the leg. Ties go to the lower altitude."""
    best = []  # per leg: {altitude: (cost so far, previous altitude)}
    for i, options in enumerate(candidates):
        layer = {}
        for a in options:
            if i == 0:
                layer[a] = (leg_cost(i, a) + step_cost(None, a), None)
            else:
                cost, prev = min(
                    ((c + leg_cost(i, a) + step_cost(p, a), p) for p, (c, _) in best[i - 1].items()),
                    key=lambda t: (t[0], t[1]),
                )
                layer[a] = (cost, prev)
        best.append(layer)
    altitude = min(best[-1], key=lambda a: (best[-1][a][0], a))
    path = [altitude]
    for i in range(len(candidates) - 1, 0, -1):
        altitude = best[i][altitude][1]
        path.append(altitude)
    return path[::-1]


def _steps(fix_list: list, altitudes: list, leg_list: list) -> list:
    """Consecutive legs at one altitude, as one step each: where it
    starts, where it ends, how far it runs."""
    steps = []
    for i, (altitude, leg) in enumerate(zip(altitudes, leg_list)):
        if steps and steps[-1]["altitude_ft"] == altitude:
            steps[-1]["to"] = leg["to"]
            steps[-1]["distance_nm"] = round(steps[-1]["distance_nm"] + leg["distance_nm"], 1)
        else:
            steps.append({"from": leg["from"], "to": leg["to"], "altitude_ft": altitude, "distance_nm": round(leg["distance_nm"], 1)})
    return steps


def altitude_profiles(
    fix_list: list, segments: list, aircraft_profile: dict, fcst_hr: str = "06",
    departure_elevation_ft: float | None = None,
) -> dict:
    """The lowest, highest and fastest ways to fly the fixes, each as a
    per-leg altitude plan: {"lowest"|"highest"|"fastest": {"legs",
    "totals", "steps", "climb_penalty_min", "total_min", "tailwind_kt",
    ...}}. `segments` is vfr.altitude.select_cruise_altitude's own
    `segments`, one per leg, with each leg's legal altitudes.

    Lowest and highest are the lowest (highest) profile overall, allowed
    to step only where the change is worth STEP_PENALTY_FT_NM -- under a
    Class B shelf near the departure and up again past it, say, not
    for a single leg's slightly different floor. Fastest is the plan
    with the least time, the winds aloft at every legal altitude of
    every leg tried and each climb charged at climb_penalty_min. All
    three pay for the initial climb from the lowest altitude anyone
    could fly, so their totals compare like for like. Empty when some
    leg has no legal altitude at all: then no plan can fly the route.
    """
    leg_count = len(fix_list) - 1
    if len(segments) != leg_count or any(not s["candidates_ft"] for s in segments):
        return {}
    candidates = [list(s["candidates_ft"]) for s in segments]
    if not (aircraft_profile.get("supplemental_oxygen") or aircraft_profile.get("pressurized")):
        # Held under the oxygen altitude where a leg has a choice; a
        # leg whose only legal altitudes are above it keeps them, since
        # the alternative is no plan at all.
        candidates = [([a for a in options if a <= OXYGEN_CAP_FT] or options) for options in candidates]
    base_ft = min(a for options in candidates for a in options)
    cruise_tas = aircraft_profile["cruise_tas_kt"]

    cache = {}

    def leg_at(i: int, altitude_ft: float) -> dict:
        if (i, altitude_ft) not in cache:
            cache[(i, altitude_ft)] = leg_between(fix_list[i], fix_list[i + 1], altitude_ft, aircraft_profile, fcst_hr)
        return cache[(i, altitude_ft)]

    def climb_step(prev, a):
        return climb_penalty_min(a - (base_ft if prev is None else prev), aircraft_profile)

    def fixed_step(prev, a):
        return STEP_PENALTY_FT_NM if prev is not None and a != prev else 0.0

    def minutes(i, a):
        ete = leg_at(i, a)["ete_min"]
        return math.inf if ete is None else ete

    paths = {
        "lowest": _best_path(candidates, lambda i, a: a * leg_at(i, a)["distance_nm"], fixed_step),
        "highest": _best_path(candidates, lambda i, a: -a * leg_at(i, a)["distance_nm"], fixed_step),
        "fastest": _best_path(candidates, minutes, climb_step),
    }

    # The plans' own legs carry their climbs -- from the field to the
    # first altitude, and up again at every step -- so the times and
    # fuel compared, and then flown, are the climbs' included. The DP
    # above used the quicker penalty to choose; the legs are the truth.
    plans = {}
    for kind, altitudes in paths.items():
        leg_list = with_climbs([leg_at(i, a) for i, a in enumerate(altitudes)], departure_elevation_ft, aircraft_profile)
        plan_totals = totals(leg_list)
        climb_min = round(sum(leg["climb_min"] for leg in leg_list), 1)
        with_wind = [leg for leg in leg_list if leg.get("wind") is not None and leg["groundspeed_kt"] is not None]
        tailwind = (
            sum((leg["groundspeed_kt"] - cruise_tas) * leg["distance_nm"] for leg in with_wind)
            / sum(leg["distance_nm"] for leg in with_wind)
        ) if with_wind else None
        plans[kind] = {
            "legs": leg_list,
            "totals": plan_totals,
            "steps": _steps(fix_list, altitudes, leg_list),
            "ete_min": plan_totals["ete_min"],
            "fuel_gal": plan_totals["fuel_gal"],
            "climb_penalty_min": climb_min,
            "total_min": plan_totals["ete_min"],
            "tailwind_kt": None if tailwind is None else round(tailwind, 1),
            "unflyable_legs": plan_totals["unflyable_legs"],
            "legs_without_wind": plan_totals["legs_without_wind"],
        }
    return plans
