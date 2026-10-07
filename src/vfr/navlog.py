"""Dead-reckoning leg math -- true course/heading, wind correction angle,
magnetic heading, groundspeed, ETE, and fuel burn for one leg of a nav log.
Building blocks (bearing/distance, winds and temperatures aloft, magnetic
variation, the aeroplane's performance in the day's air) already exist in
vfr.geo / vfr.weather / vfr.magnetic / vfr.performance; this module is
where they get combined per FAA-standard E6B formulas.

Compass heading (correcting magnetic for the specific aircraft's compass
deviation) is deliberately not computed here -- that needs a per-aircraft
deviation card, which isn't data this project has (vfr.aircraft profiles
don't carry one). Magnetic heading is as far as this goes for now.
"""
import math
from itertools import accumulate, pairwise

from . import performance
from .geo import bearing_deg, destination_point, distance_nm
from .magnetic import magnetic_variation_deg
from .weather import temperature_at_altitude, wind_at_altitude


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
    (vfr.geo), wind and temperature at altitude_ft along the way
    (vfr.weather -- sampled at the leg's midpoint), magnetic variation
    (vfr.magnetic), and the resulting WCA/heading/groundspeed/ETE/fuel
    burn. aircraft_profile is a vfr.aircraft.load_aircraft_profile()
    dict, which has already refused a profile without "cruise_tas_kt"
    and "fuel_burn_gph".

    The true airspeed and fuel flow are the profile's in the leg's own
    air (vfr.performance.cruise): its cruise figures are at a reference
    altitude on a standard day, and the forecast temperature at this
    altitude makes the density altitude they are flown at. The leg says
    which (`tas_kt`, `fuel_burn_gph`, `power_pct`, `density_altitude_ft`,
    and `oat_c`, None where no forecast temperature was near, when a
    standard day is assumed).

    If no wind data is available for this leg (vfr.weather.wind_at_altitude
    returned None -- no nearby FD station), WCA is 0 and groundspeed is
    just TAS -- a deliberate "no wind correction, not calm" fallback,
    flagged in the returned dict via "wind": None so callers/humans can see
    the leg is a no-wind-data estimate, not a real zero-wind calculation.
    """
    true_course_deg = bearing_deg(*start, *end)
    leg_distance_nm = distance_nm(*start, *end)
    mid_lat, mid_lon = (start[0] + end[0]) / 2, (start[1] + end[1]) / 2

    oat_c = temperature_at_altitude(mid_lat, mid_lon, altitude_ft, fcst_hr)
    cruise = performance.cruise(aircraft_profile, altitude_ft, oat_c)
    tas_kt = cruise.tas_kt
    wind = wind_at_altitude(mid_lat, mid_lon, altitude_ft, fcst_hr)
    if wind is None:
        wca_deg = 0.0
        gs_kt = tas_kt
    else:
        wca_deg = wind_correction_angle_deg(true_course_deg, wind["wind_dir_true_deg"], wind["wind_speed_kt"], tas_kt)
        gs_kt = groundspeed_kt(true_course_deg, wind["wind_dir_true_deg"], wind["wind_speed_kt"], tas_kt, wca_deg)
        # A crosswind stronger than TAS: no heading holds the course.
        # The correction angle clamps at 90 degrees and the arithmetic
        # can still give a positive ground speed from the wind's along-
        # course part, which made an impossible leg look flyable.
        crosswind_kt = wind["wind_speed_kt"] * math.sin(math.radians(wind["wind_dir_true_deg"] - true_course_deg))
        if abs(crosswind_kt) > tas_kt:
            gs_kt = 0.0

    true_heading_deg = (true_course_deg + wca_deg) % 360
    variation_deg = magnetic_variation_deg(mid_lat, mid_lon)
    magnetic_heading_deg = (true_heading_deg - variation_deg) % 360

    ete_min = (leg_distance_nm / gs_kt) * 60 if gs_kt > 0 else float("inf")
    fuel_gal = (ete_min / 60) * cruise.fuel_burn_gph

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
        "tas_kt": tas_kt,
        "fuel_burn_gph": cruise.fuel_burn_gph,
        "power_pct": cruise.power_pct,
        "oat_c": oat_c,
        "density_altitude_ft": round(cruise.density_altitude_ft),
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
    # Flyable or not, decided once: an unflyable leg has no ground speed,
    # ETE or fuel at all, rather than a zero or negative ground speed
    # beside an ETE of None.
    if leg["ete_min"] is None:
        leg["groundspeed_kt"] = None
        leg["fuel_gal"] = None
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


#: Fuel for engine start, taxi and takeoff, where a profile has no figure
#: of its own: the Cessna 172S handbook's allowance, 1.4 gal.
DEFAULT_TAXI_FUEL_GAL = 1.4


def fuel_plan(total_fuel_gal: float | None, aircraft_profile: dict, night: bool | None) -> dict:
    """The fuel the flight needs -- the start, taxi and takeoff allowance,
    the legs' own total, and the VFR reserve at the profile's cruise burn
    -- against the profile's usable fuel when it has one. `night` None
    means no departure time was given, so the day reserve is assumed and
    said so. Every figure None that cannot be known: no total while a leg
    is unflyable, no margin without a usable-fuel figure."""
    reserve_min = NIGHT_RESERVE_MIN if night else DAY_RESERVE_MIN
    reserve_gal = round(reserve_min / 60 * aircraft_profile["fuel_burn_gph"], 2)
    taxi_gal = aircraft_profile.get("taxi_fuel_gal", DEFAULT_TAXI_FUEL_GAL)
    required = None if total_fuel_gal is None else round(total_fuel_gal + taxi_gal + reserve_gal, 1)
    usable = aircraft_profile.get("usable_fuel_gal")
    margin = None if required is None or usable is None else round(usable - required, 1)
    return {
        "reserve_min": reserve_min,
        "reserve_gal": reserve_gal,
        "taxi_gal": taxi_gal,
        "fuel_required_gal": required,
        "usable_fuel_gal": usable,
        "fuel_margin_gal": margin,
        "night": night,
    }


# --- Four plans: lowest, highest, fastest, economical ---------------------

# What a step costs the lowest/highest plans, in feet times miles: an
# altitude change is only worth it when it lowers (or raises) the
# profile by more than 1,000 ft over 10 nm, so neither plan zig-zags
# for a leg's worth of slightly lower floor.
STEP_PENALTY_FT_NM = 10_000.0
PLAN_KINDS = ("lowest", "highest", "fastest", "economical")
# Above 12,500 ft, more than 30 minutes needs supplemental oxygen
# (14 CFR 91.211): no plan goes there unless the profile says the
# aeroplane carries it or is pressurised. The lowest plan cannot reach
# it anyway; the other three are held under it.
OXYGEN_CAP_FT = 12500.0


def _isa_dev_c(leg: dict | None) -> float:
    """How much warmer than a standard day a leg's air is, at its own
    altitude: what its climb is flown in. Nothing without a leg, or
    where no forecast temperature was near it."""
    if leg is None or leg.get("oat_c") is None:
        return 0.0
    return leg["oat_c"] - performance.isa_temp_c(leg["altitude_ft"])


def with_climbs(leg_list: list, start_altitude_ft: float | None, aircraft_profile: dict) -> list:
    """The legs with their climbs flown: from `start_altitude_ft` (the
    departure field, or None to start level at the first leg's own
    altitude) up to each leg's altitude, and up again wherever a plan
    steps up -- at the best rate, slower the thinner the air, and at
    the climb's fuel flow, less as full throttle makes less, in the air
    of the leg flown at the top (vfr.performance.climb), at the climb
    speed. A climb's minutes are flown over the ground at the climb
    speed scaled by the leg's own wind, the rest of the leg at the
    leg's cruise, and a climb longer than the leg carries into the next
    one. Each leg says how much of its time is climb (`climb_min`), and
    the leg a climb tops out on says where (`toc`: the miles, minutes and
    gallons into the leg, the altitude, and the climb's true airspeed and
    ground speed); a descent costs nothing
    here, since at cruise power it is if anything faster (with_descents
    places it). The cruise-only legs are not changed in place."""
    climb_tas = performance.climb_tas_kt(aircraft_profile)
    level_ft = start_altitude_ft
    climb_left_min = 0.0
    # The fuel flow of the climb in hand, over all its minutes: one that
    # carries into the next leg burns there what it burned on average.
    climb_burn_gph = 0.0
    out = []
    for leg in leg_list:
        leg = dict(leg)
        target_ft = leg["altitude_ft"]
        if level_ft is not None and target_ft > level_ft:
            climb = performance.climb(aircraft_profile, level_ft, target_ft, _isa_dev_c(leg))
            climb_burn_gph = (climb_left_min * climb_burn_gph + climb.gallons * 60) / (climb_left_min + climb.minutes)
            climb_left_min += climb.minutes
        level_ft = target_ft if level_ft is None else max(level_ft, target_ft)
        leg["climb_min"] = 0.0
        leg["toc"] = None
        if climb_left_min > 0 and leg["groundspeed_kt"] and leg["ete_min"] is not None:
            climb_gs = max(1.0, leg["groundspeed_kt"] * climb_tas / leg["tas_kt"])
            climb_nm = climb_gs * climb_left_min / 60
            if climb_nm >= leg["distance_nm"]:
                climb_min = leg["distance_nm"] / climb_gs * 60
                cruise_min = 0.0
                climb_left_min -= climb_min
            else:
                climb_min = climb_left_min
                cruise_min = (leg["distance_nm"] - climb_nm) / leg["groundspeed_kt"] * 60
                climb_left_min = 0.0
                leg["toc"] = {
                    "along_nm": round(climb_nm, 1), "ete_min": round(climb_min, 1),
                    "fuel_gal": round(climb_min / 60 * climb_burn_gph, 2), "altitude_ft": level_ft,
                    "tas_kt": climb_tas, "groundspeed_kt": climb_gs,
                }
            leg["climb_min"] = round(climb_min, 1)
            leg["ete_min"] = climb_min + cruise_min
            leg["fuel_gal"] = (climb_min / 60) * climb_burn_gph + (cruise_min / 60) * leg["fuel_burn_gph"]
        out.append(leg)
    return out


#: The descent: 1,000 ft for every 3 nm -- "three to one", a path of
#: about 3 degrees, an ILS glideslope's -- at whatever the ground speed,
#: which makes the rate about five times it (600 fpm at 110 kt).
DESCENT_NM_PER_1000_FT = 3.0


def with_descents(leg_list: list, fix_list: list, end_altitude_ft: float | None) -> list:
    """The legs with their tops of descent: where to leave each level to
    be down, at three to one, at `end_altitude_ft` where the legs end --
    the pattern altitude of the field they land at, None for legs that
    end in the air -- and at a lower leg's altitude by the fix it starts
    at, where a plan steps down. A descent that would start before the
    climb ahead of it has topped out starts at the top instead, steeper.
    The leg a descent starts on says where (`tod`: the miles, minutes and
    gallons into the leg, the altitude left and the one descended to,
    whether that is the pattern's, and the rate), and its top of climb (`toc`, with_climbs) is placed too:
    `fix_list`, the fixes the legs run between, gives both a latitude and
    longitude.

    The times and fuel are not changed: the descent is flown at the
    cruise's ground speed and burn, and what a pilot saves by taking
    power off stays in the tanks. The cruise legs are not changed in
    place."""
    out = [dict(leg, toc=leg.get("toc"), tod=None) for leg in leg_list]
    if not out:
        return out
    ends = list(accumulate(leg["distance_nm"] for leg in out))
    starts = [end - leg["distance_nm"] for end, leg in zip(ends, out)]
    ft_per_nm = 1000 / DESCENT_NM_PER_1000_FT

    # Backward from the end: the highest each leg's end can be and still
    # make every level-off after it, and the level-off that binds -- its
    # altitude, where along the legs it is, and whether it is the
    # pattern's.
    limit_ft, binds = (math.inf, None) if end_altitude_ft is None else (end_altitude_ft, (end_altitude_ft, ends[-1], True))
    tods = []
    for i in range(len(out) - 1, -1, -1):
        altitude, distance = out[i]["altitude_ft"], out[i]["distance_nm"]
        if altitude > limit_ft:
            # On this leg, or at its start where it cannot have started
            # sooner: the first leg, or one climbed to.
            down_nm = (altitude - limit_ft) / ft_per_nm
            if down_nm < distance or i == 0 or out[i - 1]["altitude_ft"] < altitude:
                tods.append((max(starts[i], ends[i] - down_nm), i, binds))
        limit_ft += distance * ft_per_nm
        if altitude <= limit_ft:
            limit_ft, binds = altitude, (altitude, starts[i], False)

    # Each climb's ground, from the start of a leg it climbs on to its
    # top, and the tops in order.
    climbs = [(starts[i], starts[i] + (leg["toc"]["along_nm"] if leg["toc"] else leg["distance_nm"]))
              for i, leg in enumerate(out) if leg.get("climb_min")]
    tops = [(starts[i] + leg["toc"]["along_nm"], i) for i, leg in enumerate(out) if leg["toc"]]
    for at, i, (to_ft, level_at, pattern) in reversed(tods):
        if any(a <= at < b for a, b in climbs):
            at, i = next(((t, j) for t, j in tops if t >= at), (None, None))
            if at is None:
                continue
        leg = out[i]
        from_ft = leg["altitude_ft"]
        gs = leg["groundspeed_kt"]
        if leg["tod"] or not gs or leg["ete_min"] is None or from_ft <= to_ft or level_at - at < 0.05:
            continue
        rest_min = (ends[i] - at) / gs * 60
        lat, lon = destination_point(fix_list[i]["lat"], fix_list[i]["lon"], leg["true_course_deg"], at - starts[i])
        leg["tod"] = {
            "along_nm": round(at - starts[i], 1),
            "ete_min": round(max(0.0, leg["ete_min"] - rest_min), 1),
            "fuel_gal": None if leg["fuel_gal"] is None else round(max(0.0, leg["fuel_gal"] - rest_min / 60 * leg["fuel_burn_gph"]), 2),
            "altitude_ft": from_ft, "to_ft": to_ft, "pattern": pattern,
            # The ground speed's share of three to one, or what is left
            # where the descent starts late, to the nearest 50 fpm.
            "fpm": round((from_ft - to_ft) / ((level_at - at) / gs * 60) / 50) * 50,
            "lat": lat, "lon": lon,
        }
    for i, leg in enumerate(out):
        if leg["toc"]:
            lat, lon = destination_point(fix_list[i]["lat"], fix_list[i]["lon"], leg["true_course_deg"], leg["toc"]["along_nm"])
            leg["toc"] = {**leg["toc"], "lat": lat, "lon": lon}
    return out


def climb_penalty_min(from_ft: float, to_ft: float, aircraft_profile: dict, leg: dict | None = None) -> float:
    """Minutes a climb from from_ft to to_ft costs over cruising level:
    the climb's minutes (vfr.performance.climb, in the air of `leg`, the
    leg flown at to_ft, where given), flown at climb speed rather than
    the leg's cruise, and the difference is ground not covered. A
    descent costs nothing here -- at cruise power it is, if anything,
    faster. Never below nothing: a pilot's climb speed typed above their
    cruise does not make climbing pay.
    """
    if to_ft <= from_ft:
        return 0.0
    minutes = performance.climb(aircraft_profile, from_ft, to_ft, _isa_dev_c(leg)).minutes
    cruise_tas = leg["tas_kt"] if leg else aircraft_profile["cruise_tas_kt"]
    return max(0.0, minutes * (1 - performance.climb_tas_kt(aircraft_profile) / cruise_tas))


def climb_fuel_penalty_gal(from_ft: float, to_ft: float, aircraft_profile: dict, leg: dict | None = None) -> float:
    """Gallons a climb from from_ft to to_ft burns over cruising the
    same ground: its gallons (vfr.performance.climb, in the air of
    `leg` as for climb_penalty_min), less what the leg's cruise would
    have burned over the ground the climb covers at climb speed. More
    than climb_penalty_min charges in time, for a light single: the
    climb is slower and burns more. A descent saves nothing here, as it
    costs nothing there, and neither does a climb: never below nothing.
    """
    if to_ft <= from_ft:
        return 0.0
    climb = performance.climb(aircraft_profile, from_ft, to_ft, _isa_dev_c(leg))
    cruise_tas = leg["tas_kt"] if leg else aircraft_profile["cruise_tas_kt"]
    cruise_burn_gph = leg["fuel_burn_gph"] if leg else aircraft_profile["fuel_burn_gph"]
    cruise_gal = climb.minutes / 60 * cruise_burn_gph * performance.climb_tas_kt(aircraft_profile) / cruise_tas
    return max(0.0, climb.gallons - cruise_gal)


def _best_path(candidates: list, leg_cost, step_cost) -> list:
    """The altitude for each leg that minimises the summed leg and step
    costs -- dynamic programming over legs, one state per legal
    altitude of the leg. A step's cost is the leg's own, since a climb
    is flown in the air of the leg it climbs to. Ties go to the lower
    altitude."""
    best = []  # per leg: {altitude: (cost so far, previous altitude)}
    for i, options in enumerate(candidates):
        layer = {}
        for a in options:
            if i == 0:
                layer[a] = (leg_cost(i, a) + step_cost(i, None, a), None)
            else:
                cost, prev = min(
                    ((c + leg_cost(i, a) + step_cost(i, p, a), p) for p, (c, _) in best[i - 1].items()),
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
    """The lowest, highest, fastest and most economical ways to fly the
    fixes, each as a per-leg altitude plan: {"lowest"|"highest"|
    "fastest"|"economical": {"legs", "totals", "steps",
    "climb_penalty_min", "tailwind_kt", ...}}. `segments` is
    vfr.altitude.select_cruise_altitude's own `segments`, one per leg,
    with each leg's legal altitudes.

    Lowest and highest are the lowest (highest) profile overall, allowed
    to step only where the change is worth STEP_PENALTY_FT_NM -- under a
    Class B shelf near the departure and up again past it, say, not
    for a single leg's slightly different floor. Fastest is the plan
    with the least time, the winds aloft at every legal altitude of
    every leg tried and each climb charged at climb_penalty_min.
    Economical is the plan that burns the least fuel, climb and cruise:
    the same winds, each climb charged at climb_fuel_penalty_gal. Every
    leg is flown at its altitude's own true airspeed and fuel flow
    (assemble_leg): faster in thinner air at the same power, and burning
    less where full throttle no longer makes the cruise power -- so the
    economical plan weighs the climb's fuel against what the thinner air
    and the winds give back, and the fastest counts the speed as well as
    the wind. All four pay for the initial climb from the departure
    field -- from the lowest altitude anyone could fly, without one -- so
    their totals compare like for like. Empty when some leg has no legal
    altitude at all: then no plan can fly the route.
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
    # Where every plan's first climb starts. The field's elevation when
    # it is known: the climb from it is flown in the air, and at the
    # cruise, of the altitude climbed to, and so costs a higher plan more
    # than a lower one below the lowest altitude too.
    start_ft = min(a for options in candidates for a in options) if departure_elevation_ft is None else departure_elevation_ft

    cache = {}

    def leg_at(i: int, altitude_ft: float) -> dict:
        if (i, altitude_ft) not in cache:
            cache[(i, altitude_ft)] = leg_between(fix_list[i], fix_list[i + 1], altitude_ft, aircraft_profile, fcst_hr)
        return cache[(i, altitude_ft)]

    def climb_step(i, prev, a):
        return climb_penalty_min(start_ft if prev is None else prev, a, aircraft_profile, leg_at(i, a))

    def fixed_step(i, prev, a):
        return STEP_PENALTY_FT_NM if prev is not None and a != prev else 0.0

    def minutes(i, a):
        ete = leg_at(i, a)["ete_min"]
        return math.inf if ete is None else ete

    def fuel_step(i, prev, a):
        return climb_fuel_penalty_gal(start_ft if prev is None else prev, a, aircraft_profile, leg_at(i, a))

    def gallons(i, a):
        fuel = leg_at(i, a)["fuel_gal"]
        return math.inf if fuel is None else fuel

    paths = {
        "lowest": _best_path(candidates, lambda i, a: a * leg_at(i, a)["distance_nm"], fixed_step),
        "highest": _best_path(candidates, lambda i, a: -a * leg_at(i, a)["distance_nm"], fixed_step),
        "fastest": _best_path(candidates, minutes, climb_step),
        "economical": _best_path(candidates, gallons, fuel_step),
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
        # Weighed by distance, so none where the legs with a wind have
        # none: a hop of no length had nothing to divide by.
        wind_nm = sum(leg["distance_nm"] for leg in with_wind)
        tailwind = (
            sum((leg["groundspeed_kt"] - leg["tas_kt"]) * leg["distance_nm"] for leg in with_wind) / wind_nm
        ) if wind_nm > 0 else None
        plans[kind] = {
            "legs": leg_list,
            "totals": plan_totals,
            "steps": _steps(fix_list, altitudes, leg_list),
            # Only where a leg had no legal altitude under the cap, or
            # the profile says oxygen or a pressurised cabin.
            "needs_oxygen": any(a > OXYGEN_CAP_FT for a in altitudes),
            "ete_min": plan_totals["ete_min"],
            "fuel_gal": plan_totals["fuel_gal"],
            "climb_penalty_min": climb_min,
            "tailwind_kt": None if tailwind is None else round(tailwind, 1),
            "unflyable_legs": plan_totals["unflyable_legs"],
            "legs_without_wind": plan_totals["legs_without_wind"],
        }
    return plans
