"""The nav log's own arithmetic: the cruise altitude (remembered per
route), the course line, and the legs between the fixes."""
import math
import threading
import time
from itertools import pairwise

from vfr import altitude as altitude_module
from vfr import geo, navlog

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


def cruise_altitude(start: tuple, end: tuple, profile: dict, aircraft: str) -> dict:
    key = (round(start[0], 4), round(start[1], 4), round(end[0], 4), round(end[1], 4), aircraft)
    with _ALTITUDE_CACHE_LOCK:
        hit = _ALTITUDE_CACHE.get(key)
        if hit is not None and time.time() - hit[0] < _ALTITUDE_TTL_S:
            return hit[1]
    selection = altitude_module.select_cruise_altitude(start, end, profile)
    with _ALTITUDE_CACHE_LOCK:
        _ALTITUDE_CACHE[key] = (time.time(), selection)
    return selection


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


def fixes(dep_ident: str, dest_ident: str, start: tuple, end: tuple, selected: list) -> list:
    """The nav log flies departure -> checkpoints -> destination. The
    airports are the ends of the flight, so they bound the legs even
    though neither is a checkpoint candidate."""
    return (
        [{"name": dep_ident, "category": "departure", "lat": start[0], "lon": start[1]}]
        + selected
        + [{"name": dest_ident, "category": "destination", "lat": end[0], "lon": end[1]}]
    )


def assemble_leg(a: dict, b: dict, altitude_ft: float, profile: dict) -> dict:
    leg = navlog.assemble_leg((a["lat"], a["lon"]), (b["lat"], b["lon"]), altitude_ft, profile)
    leg["from"] = a["name"] or a["category"]
    leg["to"] = b["name"] or b["category"]
    # assemble_leg returns inf for ETE when groundspeed is zero or
    # negative -- a headwind at or above cruise TAS. Python's json
    # emits that as a bare Infinity, which is not valid JSON and
    # makes JSON.parse throw in the browser, so the whole plan would
    # fail to render because of one unflyable leg. None says
    # "unflyable" honestly and the page shows it as such.
    for field in ("ete_min", "fuel_gal", "groundspeed_kt"):
        if not math.isfinite(leg[field]):
            leg[field] = None
    return leg


def legs(fix_list: list, altitude_ft: float, profile: dict) -> list:
    return [assemble_leg(a, b, altitude_ft, profile) for a, b in pairwise(fix_list)]


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
