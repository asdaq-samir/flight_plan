"""Recommended VFR cruising altitude for a route: terrain/obstacle floor,
airspace/service-ceiling/cloud-clearance band, FAR 91.159 hemispheric
rounding leg by leg -- above 3,000 ft over the ground, where the rule
applies, with every 500 ft legal below that -- and go/no-go weather
flags, icing among them.

Notebook 08 walks the same steps one at a time -- floor, ceiling, weather,
then the combined recommendation, with its explanation and printed output
between each -- calling this module's own pieces, and its last step is
legal_cruising_altitudes(...)[0] on the magnetic course, this module's own
choice, checked against select_cruise_altitude on the same route (2,200 ft
floor, 3,600 ft ceiling, 2,500 ft on C81->KDLH). It used to round down from
the ceiling on the true course and cap the band at the freezing level, the
algorithm this module dropped, while this docstring said the two matched.

Given the nav log's fixes, the same floor and ceiling are also worked out
leg by leg (`segments`), so a route can step down under a Class B shelf
and climb again past it rather than fly the whole way at the lowest
altitude the lowest shelf allows -- vfr.navlog.altitude_profiles turns
those per-leg bands into the lowest, highest, fastest and economical plans.
"""
import logging
import math
import time
from concurrent.futures import ThreadPoolExecutor
from itertools import pairwise

from . import airspace, performance, sua, terrain, weather
from .geo import along_track_distance_nm, bearing_deg, distance_nm, track_distances_nm
from .magnetic import magnetic_variation_deg
from .terrain import DEFAULT_FAA_CACHE_DIR

log = logging.getLogger(__name__)

# Class A begins at 18,000 ft: no VFR cruising above 17,500.
CLASS_A_FLOOR_FT = 18000.0

# 14 CFR 91.159's odd/even-thousands-plus-500 rule is for cruising more
# than 3,000 ft above the surface. Below that any altitude is legal, and
# the planner offers every 500 ft there as well as the rule's.
HEMISPHERIC_RULE_AGL_FT = 3000.0

# 14 CFR 91.155(a), VFR under a cloud layer: 500 ft below it under
# 10,000 ft MSL, 1,000 ft below it at 10,000 and above -- in Class E by
# day and by night, and in Class G more than 1,200 ft above the surface.
# Class G within 1,200 ft of the surface asks only "clear of clouds" by
# day; the planner cannot tell Class G from Class E there, so it keeps
# the 500 ft day and night, which is legal in both.
CLOUD_CLEARANCE_FT = 500.0
CLOUD_CLEARANCE_HIGH_FT = 1000.0
CLOUD_CLEARANCE_HIGH_FROM_FT = 10000.0
# A TAF speaks for the field it is issued for and a few miles around;
# a leg takes the forecasts of the stations this close to its own line.
CLOUD_STATION_RADIUS_NM = 25.0


def highest_under_clouds_ft(cloud_base_ft: float) -> float:
    """The highest altitude that keeps 91.155's distance below a cloud
    base (MSL): 500 ft under it, or 1,000 ft under it where that is at or
    above 10,000 ft -- and just under 10,000 ft where 500 ft below would
    be up there but 1,000 ft below would not."""
    high = cloud_base_ft - CLOUD_CLEARANCE_HIGH_FT
    if high >= CLOUD_CLEARANCE_HIGH_FROM_FT:
        return high
    return min(cloud_base_ft - CLOUD_CLEARANCE_FT, CLOUD_CLEARANCE_HIGH_FROM_FT - 1)


def _leg_cloud_bases(legs: list, stations: list) -> list:
    """Each leg's lowest forecast cloud base, MSL, and the station it is
    from: the ceiling (a broken or overcast layer, above the field) each
    TAF station within CLOUD_STATION_RADIUS_NM of the leg's own line
    forecasts for the flight, plus the field's elevation. (None, None)
    where no station near the leg forecasts one: nothing known, nothing
    capped. `legs` are ((lat, lon), (lat, lon)) pairs."""
    bases = []
    for a, b in legs:
        length = distance_nm(*a, *b)
        lowest = (None, None)
        for station in stations:
            if station.get("ceiling_ft") is None or station.get("elevation_ft") is None:
                continue
            cross, along = track_distances_nm(station["lat"], station["lon"], a, b)
            off = abs(cross) if 0.0 <= along <= length else min(
                distance_nm(station["lat"], station["lon"], *a), distance_nm(station["lat"], station["lon"], *b))
            base = station["ceiling_ft"] + station["elevation_ft"]
            if off <= CLOUD_STATION_RADIUS_NM and (lowest[0] is None or base < lowest[0]):
                lowest = (base, station["icaoId"])
        bases.append(lowest)
    return bases


def _timed(label: str, fn, pending: set | None = None):
    """Wraps one of select_cruise_altitude's concurrent calls so its own
    wall time is logged on completion.

    The seven calls below run in parallel, so timing a bare .result()
    call in the order this function happens to read them tells you how
    long the caller waited for whichever one it read first -- not which
    one was actually slow. This times each task against its own start,
    from inside the thread that ran it.

    Added after this codebase went looking for a request that was slow
    for real (2026-09-23, /api/class-b -- a different function, but the
    same class of problem: no per-stage timing anywhere meant twenty
    minutes of manual `docker exec` probing to find which single call
    accounted for it). Plain log lines, not a metrics backend: this
    project has neither Prometheus nor StatsD, and reaching for one
    before there is a single measurement to justify it would be the
    thing this project's own audits keep finding and undoing elsewhere.

    `pending`, when given, holds the labels of the calls still running,
    so a caller waiting on a slow selection can say which part it is
    waiting on rather than guess.
    """
    def wrapped(*args, **kwargs):
        started = time.time()
        if pending is not None:
            pending.add(label)
        try:
            return fn(*args, **kwargs)
        finally:
            if pending is not None:
                pending.discard(label)
            log.info("select_cruise_altitude: %s took %.2fs", label, time.time() - started)
    return wrapped


def is_eastbound(course_deg: float) -> bool:
    """Which half of 14 CFR 91.159's hemispheric rule a course is in:
    000-179 flies odd thousands plus 500, 180-359 even thousands plus
    500. Sent with the altitude breakdown, so the page names the rule it
    was given rather than working it out again."""
    return 0 <= course_deg % 360 < 180


def lowest_vfr_cruising_altitude(floor_ft: float, route_bearing_deg: float) -> float:
    """The lowest legal VFR cruising altitude at or above floor_ft for a
    course of route_bearing_deg.

    The hemispheric rule (14 CFR 91.159): magnetic course 0-179 flies odd
    thousands plus 500, 180-359 flies even thousands plus 500. The
    course passed in should be magnetic -- select_cruise_altitude takes
    the variation at mid-route off the true course before calling this,
    which only ever matters for a course within a few degrees of 000 or
    180, and falls back to true course when the variation service is
    unreachable.

    Lowest above the floor rather than highest under the ceiling. That
    distinction was invisible while every Class B/C/D shelf imposed a
    ceiling, because the ceiling was always low and close to the floor.
    Once only Class B did (see vfr.airspace), a route with no Bravo took
    its ceiling from the freezing level, and a 100 nm C172 leg across
    Iowa came back recommending 12,500 ft. The floor already carries
    terrain and obstacle clearance, so the first legal altitude above it
    is a real cruising altitude, and climbing past it costs time and fuel
    on a short leg for nothing the pilot asked for. Anyone wanting to be
    higher -- smoother air, glide range, a tailwind aloft -- can say so,
    or take the highest or fastest of the four plans the nav log offers.
    """
    eastbound = is_eastbound(route_bearing_deg)
    thousands = int(floor_ft // 1000)
    if eastbound and thousands % 2 == 0:
        thousands += 1
    elif not eastbound and thousands % 2 == 1:
        thousands += 1
    candidate_ft = thousands * 1000 + 500
    while candidate_ft < floor_ft:
        candidate_ft += 2000  # next legal altitude in the same hemispheric band
    return float(candidate_ft)


def _leg_course_magnetic_deg(a: tuple, b: tuple) -> float:
    """One leg's magnetic course: the great-circle bearing between its
    fixes less the variation at its midpoint."""
    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    return (bearing_deg(*a, *b) - magnetic_variation_deg(*mid)) % 360


def legal_cruising_altitudes(
    floor_ft: float, ceiling_ft: float | None, route_bearing_deg: float, rule_from_ft: float | None = None,
) -> list:
    """Every legal VFR cruising altitude for the course from the floor up
    to the ceiling, ascending -- the hemispheric altitudes 2,000 ft
    apart, capped under Class A when there is no ceiling, and, up to
    `rule_from_ft` (3,000 ft above the lowest ground, where 14 CFR 91.159
    begins to apply), every 500 ft besides. Empty when the first legal
    altitude above the floor is already above the ceiling.

    The rule used to be applied at every altitude, which on a low-ceiling
    day left out the altitudes under the clouds: a westbound leg with
    cloud at 2,600 ft kept nothing, its first even-thousand-plus-500
    being 2,500 -- too close to the cloud -- where 2,000 was legal.
    """
    top = CLASS_A_FLOOR_FT - 500
    if ceiling_ft is not None:
        top = min(top, ceiling_ft)
    altitudes = set()
    candidate_ft = lowest_vfr_cruising_altitude(floor_ft, route_bearing_deg)
    while candidate_ft <= top:
        altitudes.add(candidate_ft)
        candidate_ft += 2000
    if rule_from_ft is not None:
        candidate_ft = math.ceil(floor_ft / 500) * 500
        while candidate_ft <= min(top, rule_from_ft):
            altitudes.add(float(candidate_ft))
            candidate_ft += 500
    return sorted(altitudes)


#: Where no 500 ft step fits under a ceiling, the step a tight altitude is
#: found on.
TIGHT_STEP_FT = 100


def tight_cruising_altitude(floor_ft: float, ceiling_ft: float | None, rule_from_ft: float | None) -> float | None:
    """Where no 500 ft step fits between the floor and the ceiling (a
    1,800 ft floor under Chicago's 1,900 ft Class B shelf), the highest
    whole hundred under the ceiling that clears the floor: legal below
    3,000 ft above the ground, where 14 CFR 91.159's altitudes do not
    apply -- under it, not at it, as a shelf's floor is Class B -- but
    tight, and said so (the segment's `tight`). None where nothing fits,
    there is no ceiling, or it is above where the rule begins."""
    if ceiling_ft is None or rule_from_ft is None:
        return None
    altitude = (math.ceil(ceiling_ft / TIGHT_STEP_FT) - 1) * TIGHT_STEP_FT
    if altitude < floor_ft or altitude >= rule_from_ft:
        return None
    return float(altitude)


def _service_ceiling_ft(aircraft_profile: dict, a: tuple, b: tuple, fcst_hr: str, temperatures: bool) -> float:
    """The profile's service ceiling as an altitude over the leg from a
    to b: a density altitude -- the height where the best climb has
    fallen to 100 fpm on any day -- found in the forecast temperatures
    at the leg's midpoint (vfr.performance.altitude_at_density_altitude),
    to the nearest 100 ft. The book figure, a standard day's, where
    there are none: `temperatures` False (the forecast could not be
    read), or no station near."""
    book_ft = float(aircraft_profile["service_ceiling_ft"])
    if not temperatures:
        return book_ft
    try:
        profile = weather.temperatures_aloft((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, fcst_hr)
    except weather.WeatherServiceError:
        return book_ft
    if not profile:
        return book_ft
    return float(round(performance.altitude_at_density_altitude(book_ft, lambda h: weather.temperature_at(profile, h)), -2))


def select_cruise_altitude(
    route_start: tuple,
    route_end: tuple,
    aircraft_profile: dict,
    faa_cache_dir=DEFAULT_FAA_CACHE_DIR,
    fixes: list | None = None,
    fcst_hr: str = "06",
    pending: set | None = None,
    window: tuple | None = None,
    class_b_cleared: bool = False,
) -> dict:
    """Returns a dict with the recommended altitude (None if no legal VFR
    altitude exists for this route/aircraft) plus the floor/ceiling
    components and weather go/no-go flags that produced it.

    `fixes`, the nav log's (lat, lon) fixes from departure to destination,
    adds `segments`: the floor, ceiling and legal altitudes of each leg
    between them, for the stepped plans. Without them the route is one
    segment, as it always was. `fcst_hr` picks the winds/temperatures
    forecast period the freezing level is read from (see
    vfr.weather.forecast_hour). `pending`, when given, holds the stages
    still running while this works (see _timed). `window`, (start, end)
    in unix seconds, is the flight from departure to past arrival that
    the go/no-go forecast is read over; now when not given.
    `class_b_cleared`: the pilot will have a Class B clearance, so its
    shelves are no ceiling -- the route is planned through it, and its
    transits still say it takes a clearance.

    The freezing level no longer caps the band. Icing needs visible
    moisture as well as cold, so a hard ceiling at the freezing level
    was wrong both ways: it forbade clear winter air, and said nothing
    about cloud. It is reported instead, with `icing_possible` where a
    legal altitude reaches it and cloud or an icing AIRMET is forecast.

    So does the aeroplane's service ceiling, where it is in the forecast
    air: a service ceiling is a density altitude, so a warm day brings
    it down and a cold one lifts it (_service_ceiling_ft), leg by leg.

    The clouds do cap it: each leg keeps 14 CFR 91.155's distance below
    the lowest ceiling the TAFs near it forecast for the flight
    (highest_under_clouds_ft), where the forecast ceiling was only
    reported before. The whole route's band keeps under the lowest of
    them, as it does under the lowest shelf. Where the clouds leave a
    leg no altitude at all, the leg keeps its band without them and
    says so (`cloud_clearance_kept` False): a forecast is a reason to
    warn, and a nav log refused for it could not be looked at for a
    later departure either.
    """
    def timed(label, fn):
        return _timed(label, fn, pending)

    route_bearing_deg = bearing_deg(*route_start, *route_end)
    total_nm = distance_nm(*route_start, *route_end)
    # Along-track breakpoints for the floor: the fixes' own positions
    # projected onto the direct line, pinned to the route's ends.
    breaks_nm = [0.0, total_nm]
    if fixes and len(fixes) > 2:
        inner = [along_track_distance_nm(lat, lon, route_start, route_end) for lat, lon in fixes[1:-1]]
        breaks_nm = [0.0] + [min(max(b, 0.0), total_nm) for b in inner] + [total_nm]

    # ensure_class_airspace_shapefile runs first, on its own -- both
    # airspace calls below need its result, so there's nothing to gain
    # running it alongside them. Everything after it (terrain, the two
    # airspace queries, and three separate aviationweather.gov calls)
    # is independent of the others, and summing three external round
    # trips instead of overlapping them was the real reason this step
    # felt slow -- the same issue, and the same fix, as /api/briefing.
    request_started = time.time()
    shp_path = timed("airspace.ensure_class_airspace_shapefile", airspace.ensure_class_airspace_shapefile)(faa_cache_dir)
    mid_lat = (route_start[0] + route_end[0]) / 2
    mid_lon = (route_start[1] + route_end[1]) / 2

    with ThreadPoolExecutor(max_workers=5) as pool:
        floor_future = pool.submit(
            timed("terrain.floor_profile", terrain.floor_profile),
            route_start, route_end, breaks_nm, faa_cache_dir=faa_cache_dir,
        )
        # The legs flown, or the direct line as the one leg: one path
        # for the Class B rule, where two functions of different shapes
        # used to be chosen between and the answer coerced back.
        airspace_future = None if class_b_cleared else pool.submit(
            timed("airspace.airspace_ceiling_profile", airspace.airspace_ceiling_profile),
            route_start, route_end, fixes or [route_start, route_end], shp_path,
        )
        # Class C/D along the way are not a ceiling -- two-way comms is
        # all they take -- but a pilot still wants to know they are coming.
        transits_future = pool.submit(
            timed("airspace.airspace_transits", airspace.airspace_transits), route_start, route_end, shp_path,
            fixes=fixes,
        )
        # Special-use airspace (prohibited and restricted areas, MOAs):
        # not in the Class B/C/D shapefile, so asked of the FAA's own
        # feature service along the legs.
        sua_future = pool.submit(timed("sua.along_route", sua.along_route), route_start, route_end, fixes)
        variation_future = pool.submit(timed("magnetic_variation_deg", magnetic_variation_deg), mid_lat, mid_lon)
        freezing_future = pool.submit(
            timed("weather.freezing_level", weather.freezing_level), mid_lat, mid_lon, fcst_hr,
        )
        cv_future = pool.submit(
            timed("weather.ceiling_visibility_along_route", weather.ceiling_visibility_along_route),
            route_start, route_end, window=window,
        )
        hazards_future = pool.submit(
            timed("weather.hazards_along_route", weather.hazards_along_route), route_start, route_end,
        )

        # Terrain and airspace are structural safety inputs -- without
        # them there is no floor/ceiling to recommend an altitude from at
        # all, so those two still propagate a failure normally. The three
        # aviationweather.gov calls are live current-conditions context on
        # top of that: a slow bbox query there returning a 504 (observed
        # 2026-09-18, ~30s before the error surfaced) used to take the
        # whole recommendation down with it even though terrain/airspace
        # had already succeeded. Each is now caught on its own and
        # recorded in weather_unavailable instead -- callers get a real
        # recommendation with a note about what's missing, not a rewritten
        # icing/ceiling/hazard verdict pretending the missing source
        # means "no concern found."
        floors = floor_future.result()
        airspace_ceilings_ft = (
            airspace_future.result() if airspace_future else [None] * (len(fixes) - 1 if fixes else 1))
        transits = transits_future.result()
        # The hemispheric rule is written for magnetic course, and the
        # variation is the World Magnetic Model's (vfr.magnetic), worked
        # out here with no network call.
        variation_deg = variation_future.result()
        course_magnetic_deg = (route_bearing_deg - variation_deg) % 360

        weather_unavailable = []
        try:
            freezing = freezing_future.result()
        except weather.WeatherServiceError:
            freezing = None
            weather_unavailable.append("freezing_level")
        try:
            cv = cv_future.result()
        except weather.WeatherServiceError:
            cv = {"min_ceiling_ft": None, "min_visibility_sm": None, "stations": []}
            weather_unavailable.append("ceiling_visibility")
        try:
            hazards = hazards_future.result()
        except weather.WeatherServiceError:
            hazards = []
            weather_unavailable.append("hazards")
        try:
            special_use = sua_future.result()
        except sua.SpecialUseUnavailable:
            special_use = []
            weather_unavailable.append("special_use")

    freezing_level_ft = freezing["ft"] if freezing else None
    freezing_at_or_below = bool(freezing and freezing["at_or_below"])

    floors_ft = [segment.floor_ft for segment in floors]
    # Where the hemispheric rule begins, over each leg and over the whole
    # route: 3,000 ft above the lowest ground under it.
    rules_from_ft = [segment.lowest_ground_ft + HEMISPHERIC_RULE_AGL_FT for segment in floors]

    # Each leg's lowest forecast cloud base (MSL), from the TAFs near it:
    # the legs flown, or the direct line as the one leg.
    legs = list(pairwise(fixes)) if fixes else [(route_start, route_end)]
    cloud_bases = _leg_cloud_bases(legs, cv["stations"])
    known_bases = [b for b in cloud_bases if b[0] is not None]
    cloud_base_ft, cloud_station = min(known_bases) if known_bases else (None, None)

    # Each leg's service ceiling in the air over it -- the book figure
    # where the temperatures aloft could not be read with the freezing
    # level -- and the whole route's, the lowest of them.
    service_ceilings_ft = [
        _service_ceiling_ft(aircraft_profile, a, b, fcst_hr, "freezing_level" not in weather_unavailable)
        for a, b in legs
    ]
    service_ceiling_ft = min(service_ceilings_ft)

    def band_ceiling(airspace_ceiling_ft, service_ceiling, cloud_base=None):
        ceilings = [c for c in [
            airspace_ceiling_ft, service_ceiling,
            None if cloud_base is None else highest_under_clouds_ft(cloud_base),
        ] if c is not None]
        return min(ceilings) if ceilings else None

    def band(floor, airspace_ceiling, service_ceiling, cloud_base, course, areas, rule_from):
        """(ceiling, legal altitudes, cloud clearance kept, tight): the
        legal altitudes from the floor to the lowest ceiling, the
        clouds' included, none through a prohibited area -- or, where no
        500 ft step fits, the one tight altitude under the ceiling
        (tight_cruising_altitude), and True -- or, where the clouds leave
        none, the band without them, and False."""
        def legal(ceiling):
            found = [a for a in legal_cruising_altitudes(floor, ceiling, course, rule_from) if not sua.blocked(a, areas)]
            if found:
                return found, False
            tight = tight_cruising_altitude(floor, ceiling, rule_from)
            return ([tight], True) if tight is not None and not sua.blocked(tight, areas) else ([], False)
        ceiling = band_ceiling(airspace_ceiling, service_ceiling, cloud_base)
        altitudes, tight = legal(ceiling)
        if altitudes or cloud_base is None:
            return ceiling, altitudes, True, tight
        ceiling = band_ceiling(airspace_ceiling, service_ceiling)
        altitudes, tight = legal(ceiling)
        return ceiling, altitudes, False, tight

    # The whole route's own band: the highest floor and the lowest
    # shelf, cloud and service ceiling anywhere along it -- the altitude
    # that works everywhere.
    floor_ft = max(floors_ft)
    rule_from_ft = min(rules_from_ft)
    shelf_floors = [c for c in airspace_ceilings_ft if c is not None]
    airspace_ceiling_ft = min(shelf_floors) if shelf_floors else None
    band_ceiling_ft, candidates_ft, cloud_clearance_kept, _ = band(
        floor_ft, airspace_ceiling_ft, service_ceiling_ft, cloud_base_ft, course_magnetic_deg, special_use,
        rule_from_ft)

    # The lowest legal VFR cruising altitude at or above the floor, not
    # the highest one under the ceiling.
    #
    # This used to work down from the ceiling, which was invisible while
    # every Class B/C/D shelf imposed one -- the ceiling was always low
    # and close to the floor. Once only Class B did (2026-09-10), a route
    # with no Bravo had its ceiling set by the freezing level, and a
    # 100 nm C172 leg across Iowa came back recommending 12,500 ft.
    #
    # The floor already carries terrain and obstacle clearance
    # (terrain.min_safe_altitude_msl), so the first legal altitude above
    # it is a real cruising altitude rather than a minimum, and it is the
    # predictable choice: climbing higher costs time and fuel on a short
    # leg and buys nothing a pilot asked for. Anyone who wants to be
    # higher -- smoother air, better glide range, a tailwind aloft -- can
    # say so; the planner takes an explicit altitude.
    recommended_ft = candidates_ft[0] if candidates_ft else None

    # Leg by leg, for the stepped plans: each leg's own floor and the
    # shelf over it alone, so a leg past the Bravo is free of it.
    #
    # Each leg is rounded against its own magnetic course, not the whole
    # route's: 14 CFR 91.159 goes by the course being flown, and on a
    # route near north or south a dogleg to a checkpoint can put one leg
    # in the other half of the rule.
    segments = []
    if fixes:
        for i, (a, b) in enumerate(zip(breaks_nm, breaks_nm[1:])):
            leg_cloud_base_ft, leg_cloud_station = cloud_bases[i]
            leg_course = _leg_course_magnetic_deg(fixes[i], fixes[i + 1])
            segment_ceiling_ft, segment_candidates_ft, segment_clearance_kept, segment_tight = band(
                floors_ft[i], airspace_ceilings_ft[i], service_ceilings_ft[i], leg_cloud_base_ft, leg_course,
                [area for area in special_use if i in area["legs"]], rules_from_ft[i])
            segments.append({
                "from_nm": round(a, 1),
                "to_nm": round(b, 1),
                "floor_ft": floors_ft[i],
                "airspace_ceiling_ft": airspace_ceilings_ft[i],
                "service_ceiling_ft": service_ceilings_ft[i],
                "cloud_base_ft": leg_cloud_base_ft,
                "cloud_station": leg_cloud_station,
                "cloud_ceiling_ft": None if leg_cloud_base_ft is None else highest_under_clouds_ft(leg_cloud_base_ft),
                "cloud_clearance_kept": segment_clearance_kept,
                "band_ceiling_ft": segment_ceiling_ft,
                "course_magnetic_deg": round(leg_course, 1),
                "eastbound": is_eastbound(leg_course),
                "hemispheric_rule_from_ft": round(rules_from_ft[i]),
                "candidates_ft": segment_candidates_ft,
                "tight": segment_tight,
            })

    # Icing: an altitude this could recommend reaching the freezing level
    # (any, where the level is at or below the lowest reported one), with
    # the moisture icing needs -- a broken, overcast or obscured layer
    # forecast along the route, or an icing AIRMET or SIGMET over it.
    # None where the freezing level could not be checked.
    legal = candidates_ft + [a for seg in segments for a in seg["candidates_ft"]]
    reaches_freezing = freezing_level_ft is not None and (
        freezing_at_or_below or any(a >= freezing_level_ft for a in legal)
    )
    moisture = cv["min_ceiling_ft"] is not None or any(
        (h.get("hazard") or "").upper().startswith("ICE") for h in hazards
    )
    icing_possible = None if "freezing_level" in weather_unavailable else (reaches_freezing and moisture)

    # None (not False) when ceiling_visibility_along_route itself failed --
    # "unknown" must not read as "confirmed VFR-favorable" to a caller
    # deciding whether to flag the route.
    low_ceiling_vis = None if "ceiling_visibility" in weather_unavailable else (
        weather.below_vfr_minimums(cv["min_ceiling_ft"], cv["min_visibility_sm"])
    )

    log.info("select_cruise_altitude: %.2fs total", time.time() - request_started)

    return {
        "recommended_ft": recommended_ft,
        "candidates_ft": candidates_ft,
        "course_magnetic_deg": round(course_magnetic_deg, 1),
        "eastbound": is_eastbound(course_magnetic_deg),
        # The rule applies above this: 3,000 ft over the lowest ground on
        # the route. Below it, any altitude.
        "hemispheric_rule_from_ft": round(rule_from_ft),
        "floor_ft": floor_ft,
        "airspace_ceiling_ft": airspace_ceiling_ft,
        "class_b_cleared": class_b_cleared,
        # The aeroplane's service ceiling where it is in the forecast air
        # (the lowest over any leg); the book figure is the profile's.
        "service_ceiling_ft": service_ceiling_ft,
        # The lowest forecast cloud base (MSL) along the route and the
        # TAF station it is from; None where no station near a leg
        # forecasts a ceiling for the flight.
        "cloud_base_ft": cloud_base_ft,
        "cloud_station": cloud_station,
        "cloud_ceiling_ft": None if cloud_base_ft is None else highest_under_clouds_ft(cloud_base_ft),
        # False where the clouds leave the route, or a leg of it, no
        # altitude: those altitudes are the band's without them.
        "cloud_clearance_kept": cloud_clearance_kept and all(seg["cloud_clearance_kept"] for seg in segments),
        "airspace_transits": transits,
        "special_use": special_use,
        "freezing_level_ft": freezing_level_ft,
        "freezing_level_at_or_below": freezing_at_or_below,
        "icing_possible": icing_possible,
        "band_ceiling_ft": band_ceiling_ft,
        "min_ceiling_ft": cv["min_ceiling_ft"],
        "min_visibility_sm": cv["min_visibility_sm"],
        "hazards": hazards,
        "low_ceiling_or_visibility": low_ceiling_vis,
        "weather_unavailable": weather_unavailable,
        "segments": segments,
    }
