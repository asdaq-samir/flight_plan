"""The nav log's own arithmetic: the cruise altitude (remembered per
route), the course line, and the aircraft it is all computed for. The
legs are vfr.navlog's."""
import threading
import time

from vfr import aircraft as aircraft_module
from vfr import altitude as altitude_module
from vfr import geo, navlog


def aircraft_profile(name: str, cruise_tas_kt: float | None = None, fuel_burn_gph: float | None = None) -> dict:
    """One of data/aircraft's profiles, with a pilot's own aeroplane's
    numbers on top when given: the profile still supplies the service
    ceiling the altitude selection needs, the overrides supply what the
    legs need."""
    profile = aircraft_module.load_aircraft_profile(name)
    if cruise_tas_kt is not None:
        profile["cruise_tas_kt"] = cruise_tas_kt
    if fuel_burn_gph is not None:
        profile["fuel_burn_gph"] = fuel_burn_gph
    return profile

# The altitude selection re-ran its whole stack -- terrain sampling
# (USGS EPQS, network), the airspace shapefile, and three separate
# aviationweather.gov calls -- on every single nav-log request, for a
# result that only moves when the weather does. The terrain and airspace
# halves are static per route outright; the weather half already runs on
# aviationweather.gov products reissued a few times a day, and
# vfr.weather's own winds cache uses this same 15-minute TTL. On a bad
# aviationweather.gov day (504s, retries) one uncached selection was
# observed taking over two minutes -- a price worth paying once per
# route per quarter hour, not on every page load.
_ALTITUDE_CACHE: dict = {}
_ALTITUDE_TTL_S = 900
_ALTITUDE_CACHE_LOCK = threading.Lock()


def cruise_altitude(start: tuple, end: tuple, profile: dict, aircraft: str, fixes: list | None = None) -> dict:
    """`fixes`, the nav log's own (lat, lon) fixes, add the leg-by-leg
    segments the stepped plans need; they are part of the key, since a
    different set of checkpoints is a different set of legs."""
    key = (
        round(start[0], 4), round(start[1], 4), round(end[0], 4), round(end[1], 4), aircraft,
        tuple((round(lat, 4), round(lon, 4)) for lat, lon in fixes) if fixes else None,
    )
    with _ALTITUDE_CACHE_LOCK:
        hit = _ALTITUDE_CACHE.get(key)
        if hit is not None and time.time() - hit[0] < _ALTITUDE_TTL_S:
            return hit[1]
    # The keyword only when there are fixes: the route-wide callers
    # (/api/altitude-breakdown, the agents) keep the original call.
    selection = altitude_module.select_cruise_altitude(start, end, profile, **({"fixes": fixes} if fixes else {}))
    with _ALTITUDE_CACHE_LOCK:
        _ALTITUDE_CACHE[key] = (time.time(), selection)
    return selection


# The three plans read the winds at every legal altitude of every leg,
# and the winds product is reissued a few times a day and held by
# vfr.weather for the same 15 minutes -- so the plans are held as long,
# per route, fixes and aeroplane, and switching between them is free.
_PLANS_CACHE: dict = {}
_PLANS_CACHE_LOCK = threading.Lock()


def altitude_plans(fix_list: list, selection: dict, profile: dict, aircraft: str) -> dict:
    key = (
        aircraft, profile.get("cruise_tas_kt"), profile.get("fuel_burn_gph"),
        tuple((round(f["lat"], 4), round(f["lon"], 4)) for f in fix_list),
        tuple(tuple(s["candidates_ft"]) for s in selection.get("segments", [])),
    )
    with _PLANS_CACHE_LOCK:
        hit = _PLANS_CACHE.get(key)
        if hit is not None and time.time() - hit[0] < _ALTITUDE_TTL_S:
            return hit[1]
    plans = navlog.altitude_profiles(fix_list, selection.get("segments", []), profile)
    with _PLANS_CACHE_LOCK:
        _PLANS_CACHE[key] = (time.time(), plans)
    return plans


def no_altitude_detail(selection: dict) -> str:
    return (
        "No legal VFR cruising altitude exists for this route and aircraft "
        f"(floor {selection.get('floor_ft')} ft, ceiling "
        f"{selection.get('band_ceiling_ft')} ft). Supply altitude_ft "
        "explicitly to plan anyway."
    )


def course_line(start: tuple, end: tuple, step_nm: float = 5.0) -> list:
    """The course line as [[lat, lon], ...], following the great circle.

    Stepped with the bearing recomputed toward the destination at every
    point, which is what makes it the actual great circle: hold the
    initial bearing constant instead and you trace a different path that
    sits a couple of miles off true course at the midpoint of a 300 nm
    leg. That matters because candidate positions come from great-circle
    cross-track distance, so a line drawn any other way would show
    on-course checkpoints as visibly off it.
    """
    total = geo.distance_nm(start[0], start[1], end[0], end[1])
    points, current, travelled = [list(start)], start, 0.0
    while travelled + step_nm < total:
        bearing = geo.bearing_deg(current[0], current[1], end[0], end[1])
        current = geo.destination_point(current[0], current[1], bearing, step_nm)
        travelled += step_nm
        points.append(list(current))
    points.append(list(end))
    return points
