"""Recommended VFR cruising altitude for a route: terrain/obstacle floor,
airspace/freezing-level/service-ceiling band, FAR 91.159 hemispheric
rounding, and go/no-go weather flags. Same computation as notebook 08's
Steps 1-5, extracted here so nav-log-agent can call it too.

Deliberately NOT wired back into notebook 08 to replace those cells --
unlike notebooks 01-03 (which pipeline.py already superseded as thin
orchestration with little content of their own), 08 has real step-by-step
pedagogical value (explanatory markdown + printed output between each
piece: floor, then ceiling, then weather, then the combined
recommendation) that collapsing into one function call would destroy. This
project's whole point is hands-on practice, so that structure is worth the
small amount of duplication against this module -- verified this module's
output matches the notebook's exactly (2200ft floor / 3600ft ceiling /
2500ft recommended on the live C81->KDLH route) rather than assuming it.

Given the nav log's fixes, the same floor and ceiling are also worked out
leg by leg (`segments`), so a route can step down under a Class B shelf
and climb again past it rather than fly the whole way at the lowest
altitude the lowest shelf allows -- vfr.navlog.altitude_profiles turns
those per-leg bands into the lowest, highest and fastest plans.
"""
from concurrent.futures import ThreadPoolExecutor

from . import airspace, terrain, weather
from .geo import along_track_distance_nm, bearing_deg, distance_nm
from .terrain import DEFAULT_FAA_CACHE_DIR

# Class A begins at 18,000 ft: no VFR cruising above 17,500.
CLASS_A_FLOOR_FT = 18000.0


def lowest_vfr_cruising_altitude(floor_ft: float, route_bearing_deg: float) -> float:
    """The lowest legal VFR cruising altitude at or above floor_ft for a
    course of route_bearing_deg.

    The hemispheric rule (14 CFR 91.159): magnetic course 0-179 flies odd
    thousands plus 500, 180-359 flies even thousands plus 500. Applied
    here to true course, which is what the rest of this module works in;
    the difference is magnetic variation, at most a couple of degrees
    across this project's routes and only mattering for a course sitting
    within that much of 000 or 180.

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
    or take the highest or fastest of the three plans the nav log offers.
    """
    is_eastbound = 0 <= route_bearing_deg % 360 < 180
    thousands = int(floor_ft // 1000)
    if is_eastbound and thousands % 2 == 0:
        thousands += 1
    elif not is_eastbound and thousands % 2 == 1:
        thousands += 1
    candidate_ft = thousands * 1000 + 500
    while candidate_ft < floor_ft:
        candidate_ft += 2000  # next legal altitude in the same hemispheric band
    return float(candidate_ft)


def legal_cruising_altitudes(floor_ft: float, ceiling_ft: float | None, route_bearing_deg: float) -> list:
    """Every legal VFR cruising altitude for the course from the floor up
    to the ceiling, ascending -- the hemispheric altitudes 2,000 ft
    apart, capped under Class A when there is no ceiling. Empty when the
    first legal altitude above the floor is already above the ceiling.
    """
    top = CLASS_A_FLOOR_FT - 500
    if ceiling_ft is not None:
        top = min(top, ceiling_ft)
    altitudes = []
    candidate_ft = lowest_vfr_cruising_altitude(floor_ft, route_bearing_deg)
    while candidate_ft <= top:
        altitudes.append(candidate_ft)
        candidate_ft += 2000
    return altitudes


def select_cruise_altitude(
    route_start: tuple,
    route_end: tuple,
    aircraft_profile: dict,
    faa_cache_dir=DEFAULT_FAA_CACHE_DIR,
    fixes: list | None = None,
) -> dict:
    """Returns a dict with the recommended altitude (None if no legal VFR
    altitude exists for this route/aircraft) plus the floor/ceiling
    components and weather go/no-go flags that produced it.

    `fixes`, the nav log's (lat, lon) fixes from departure to destination,
    adds `segments`: the floor, ceiling and legal altitudes of each leg
    between them, for the stepped plans. Without them the route is one
    segment, as it always was.
    """
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
    shp_path = airspace.ensure_class_airspace_shapefile(faa_cache_dir)
    mid_lat = (route_start[0] + route_end[0]) / 2
    mid_lon = (route_start[1] + route_end[1]) / 2

    with ThreadPoolExecutor(max_workers=5) as pool:
        floor_future = pool.submit(terrain.floor_profile, route_start, route_end, breaks_nm, faa_cache_dir=faa_cache_dir)
        if fixes:
            airspace_future = pool.submit(airspace.airspace_ceiling_profile, route_start, route_end, fixes, shp_path)
        else:
            airspace_future = pool.submit(airspace.max_airspace_altitude_msl, route_start, route_end, shp_path)
        # Class C/D along the way are not a ceiling -- two-way comms is
        # all they take -- but a pilot still wants to know they are coming.
        transits_future = pool.submit(airspace.airspace_transits, route_start, route_end, shp_path)
        freezing_future = pool.submit(weather.freezing_level_ft, mid_lat, mid_lon)
        cv_future = pool.submit(weather.ceiling_visibility_along_route, route_start, route_end)
        hazards_future = pool.submit(weather.hazards_along_route, route_start, route_end)

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
        floors_ft = floor_future.result()
        airspace_result = airspace_future.result()
        airspace_ceilings_ft = airspace_result if fixes else [airspace_result]
        transits = transits_future.result()

        weather_unavailable = []
        try:
            freezing_level_ft = freezing_future.result()
        except weather.WeatherServiceError:
            freezing_level_ft = None
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

    def band_ceiling(airspace_ceiling_ft):
        ceilings = [c for c in [airspace_ceiling_ft, freezing_level_ft, aircraft_profile["service_ceiling_ft"]] if c is not None]
        return min(ceilings) if ceilings else None

    # The whole route's own band: the highest floor and the lowest
    # shelf anywhere along it -- the altitude that works everywhere.
    floor_ft = max(floors_ft)
    shelf_floors = [c for c in airspace_ceilings_ft if c is not None]
    airspace_ceiling_ft = min(shelf_floors) if shelf_floors else None
    band_ceiling_ft = band_ceiling(airspace_ceiling_ft)
    candidates_ft = legal_cruising_altitudes(floor_ft, band_ceiling_ft, route_bearing_deg)

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
    segments = []
    if fixes:
        for i, (a, b) in enumerate(zip(breaks_nm, breaks_nm[1:])):
            segment_ceiling_ft = band_ceiling(airspace_ceilings_ft[i])
            segments.append({
                "from_nm": round(a, 1),
                "to_nm": round(b, 1),
                "floor_ft": floors_ft[i],
                "airspace_ceiling_ft": airspace_ceilings_ft[i],
                "band_ceiling_ft": segment_ceiling_ft,
                "candidates_ft": legal_cruising_altitudes(floors_ft[i], segment_ceiling_ft, route_bearing_deg),
            })

    # None (not False) when ceiling_visibility_along_route itself failed --
    # "unknown" must not read as "confirmed VFR-favorable" to a caller
    # deciding whether to flag the route.
    low_ceiling_vis = None if "ceiling_visibility" in weather_unavailable else (
        (cv["min_ceiling_ft"] is not None and cv["min_ceiling_ft"] < 1000) or (
            cv["min_visibility_sm"] is not None and cv["min_visibility_sm"] < 3
        )
    )

    return {
        "recommended_ft": recommended_ft,
        "candidates_ft": candidates_ft,
        "floor_ft": floor_ft,
        "airspace_ceiling_ft": airspace_ceiling_ft,
        "airspace_transits": transits,
        "freezing_level_ft": freezing_level_ft,
        "band_ceiling_ft": band_ceiling_ft,
        "min_ceiling_ft": cv["min_ceiling_ft"],
        "min_visibility_sm": cv["min_visibility_sm"],
        "hazards": hazards,
        "low_ceiling_or_visibility": low_ceiling_vis,
        "weather_unavailable": weather_unavailable,
        "segments": segments,
    }
