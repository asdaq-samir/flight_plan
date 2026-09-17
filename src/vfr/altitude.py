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
"""
from concurrent.futures import ThreadPoolExecutor

from . import airspace, terrain, weather
from .geo import bearing_deg
from .terrain import DEFAULT_FAA_CACHE_DIR


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
    higher -- smoother air, glide range, a tailwind aloft -- can say so.
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


def select_cruise_altitude(
    route_start: tuple,
    route_end: tuple,
    aircraft_profile: dict,
    faa_cache_dir=DEFAULT_FAA_CACHE_DIR,
) -> dict:
    """Returns a dict with the recommended altitude (None if no legal VFR
    altitude exists for this route/aircraft) plus the floor/ceiling
    components and weather go/no-go flags that produced it.
    """
    route_bearing_deg = bearing_deg(*route_start, *route_end)

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
        floor_future = pool.submit(terrain.min_safe_altitude_msl, route_start, route_end, faa_cache_dir=faa_cache_dir)
        airspace_ceiling_future = pool.submit(airspace.max_airspace_altitude_msl, route_start, route_end, shp_path)
        # Class C/D along the way are not a ceiling -- two-way comms is
        # all they take -- but a pilot still wants to know they are coming.
        transits_future = pool.submit(airspace.airspace_transits, route_start, route_end, shp_path)
        freezing_future = pool.submit(weather.freezing_level_ft, mid_lat, mid_lon)
        cv_future = pool.submit(weather.ceiling_visibility_along_route, route_start, route_end)
        hazards_future = pool.submit(weather.hazards_along_route, route_start, route_end)

        floor_ft = floor_future.result()
        airspace_ceiling_ft = airspace_ceiling_future.result()
        transits = transits_future.result()
        freezing_level_ft = freezing_future.result()
        cv = cv_future.result()
        hazards = hazards_future.result()

    ceilings = [c for c in [airspace_ceiling_ft, freezing_level_ft, aircraft_profile["service_ceiling_ft"]] if c is not None]
    band_ceiling_ft = min(ceilings) if ceilings else None

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
    recommended_ft = None
    if band_ceiling_ft is None or floor_ft <= band_ceiling_ft:
        candidate_ft = lowest_vfr_cruising_altitude(floor_ft, route_bearing_deg)
        if band_ceiling_ft is None or candidate_ft <= band_ceiling_ft:
            recommended_ft = candidate_ft

    low_ceiling_vis = (cv["min_ceiling_ft"] is not None and cv["min_ceiling_ft"] < 1000) or (
        cv["min_visibility_sm"] is not None and cv["min_visibility_sm"] < 3
    )

    return {
        "recommended_ft": recommended_ft,
        "floor_ft": floor_ft,
        "airspace_ceiling_ft": airspace_ceiling_ft,
        "airspace_transits": transits,
        "freezing_level_ft": freezing_level_ft,
        "band_ceiling_ft": band_ceiling_ft,
        "min_ceiling_ft": cv["min_ceiling_ft"],
        "min_visibility_sm": cv["min_visibility_sm"],
        "hazards": hazards,
        "low_ceiling_or_visibility": low_ceiling_vis,
    }
