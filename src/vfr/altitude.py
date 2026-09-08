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
from . import airspace, terrain, weather
from .geo import bearing_deg
from .terrain import DEFAULT_FAA_CACHE_DIR


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

    floor_ft = terrain.min_safe_altitude_msl(route_start, route_end, faa_cache_dir=faa_cache_dir)

    shp_path = airspace.ensure_class_airspace_shapefile(faa_cache_dir)
    airspace_ceiling_ft = airspace.max_airspace_altitude_msl(route_start, route_end, shp_path)

    mid_lat = (route_start[0] + route_end[0]) / 2
    mid_lon = (route_start[1] + route_end[1]) / 2
    freezing_level_ft = weather.freezing_level_ft(mid_lat, mid_lon)

    cv = weather.ceiling_visibility_along_route(route_start, route_end)
    hazards = weather.hazards_along_route(route_start, route_end)

    ceilings = [c for c in [airspace_ceiling_ft, freezing_level_ft, aircraft_profile["service_ceiling_ft"]] if c is not None]
    band_ceiling_ft = min(ceilings) if ceilings else None

    recommended_ft = None
    if band_ceiling_ft is None or floor_ft <= band_ceiling_ft:
        target_ft = band_ceiling_ft if band_ceiling_ft is not None else floor_ft
        is_eastbound = 0 <= route_bearing_deg < 180
        thousands = int(target_ft // 1000)
        if is_eastbound and thousands % 2 == 0:
            thousands -= 1
        elif not is_eastbound and thousands % 2 == 1:
            thousands -= 1
        candidate_ft = thousands * 1000 + 500
        while candidate_ft < floor_ft:
            candidate_ft += 2000  # next legal altitude in the same hemispheric band
        if candidate_ft <= target_ft:
            recommended_ft = candidate_ft

    low_ceiling_vis = (cv["min_ceiling_ft"] is not None and cv["min_ceiling_ft"] < 1000) or (
        cv["min_visibility_sm"] is not None and cv["min_visibility_sm"] < 3
    )

    return {
        "recommended_ft": recommended_ft,
        "floor_ft": floor_ft,
        "airspace_ceiling_ft": airspace_ceiling_ft,
        "freezing_level_ft": freezing_level_ft,
        "band_ceiling_ft": band_ceiling_ft,
        "min_ceiling_ft": cv["min_ceiling_ft"],
        "min_visibility_sm": cv["min_visibility_sm"],
        "hazards": hazards,
        "low_ceiling_or_visibility": low_ceiling_vis,
    }
