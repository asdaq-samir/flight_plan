"""The ways to fly a route, for FPL's Routes (vfr.route_options): the
fastest, the best weather's and the fewest stops', each clear of
thunderstorms, weather under the pilot's minimums, prohibited areas, TFRs
and high ground."""
import threading
from datetime import datetime
from typing import Annotated

from cachetools import TTLCache
from fastapi import APIRouter, HTTPException, Query
from vfr import route_options as vfr_route_options

from ..common import DEFAULT_AIRCRAFT, load_route, resolve
from ..planning import aircraft_profile, forecast_hour_for
from ..schemas import RouteOptions
from .plan import CruiseTas, ServiceCeiling

router = APIRouter()

#: An answer kept ten minutes: the TAFs and METARs it reads change by the
#: hour, and FPL asks again as the page draws.
_KEPT: TTLCache = TTLCache(maxsize=128, ttl=600)
_LOCK = threading.Lock()


@router.get("/api/route-options")
def route_options(
    dep: str, dest: str,
    #: The pilot's own route's stops, "KDSM,VPBNG": what it meets is said.
    stops: str = "",
    aircraft: str = DEFAULT_AIRCRAFT,
    cruise_tas_kt: CruiseTas = None,
    fuel_burn_gph: Annotated[float | None, Query(gt=0, le=200)] = None,
    usable_fuel_gal: Annotated[float | None, Query(gt=0, le=2000)] = None,
    service_ceiling_ft: ServiceCeiling = None,
    depart: datetime | None = None,
    #: The pilot's own minimums (Settings), never under 14 CFR 91.155's:
    #: none given, the rules' alone.
    min_ceiling_ft: Annotated[float | None, Query(ge=0, le=20000)] = None,
    min_visibility_sm: Annotated[float | None, Query(ge=0, le=50)] = None,
) -> RouteOptions:
    """The ways to fly from `dep` to `dest` in the airplane, at the owner's
    ask ("smart to reroute for fastest time along safe weather, over
    terrain, best tailwinds, refueling", 2026-10-23): each its points in
    order for the address's `stops`, its fuel stops, and its distance,
    minutes and fuel, from a coarse read the plan then checks leg by leg.
    It only suggests."""
    key = (dep.upper(), dest.upper(), stops.upper(), aircraft, cruise_tas_kt, fuel_burn_gph, usable_fuel_gal, service_ceiling_ft,
           depart.isoformat() if depart else None, min_ceiling_ft, min_visibility_sm)
    with _LOCK:
        kept = _KEPT.get(key)
    if kept is not None:
        return kept
    start, end = resolve(dep, dest)
    profile = aircraft_profile(aircraft, cruise_tas_kt=cruise_tas_kt, fuel_burn_gph=fuel_burn_gph,
                               usable_fuel_gal=usable_fuel_gal, service_ceiling_ft=service_ceiling_ft)
    # The pilot's own route, its points by ident: what it meets, and it with
    # the fuel stops it needs put in (`own`).
    # A route the plan refuses (too many stops, a stop twice over) still
    # gets its ways: the straight line's, nothing of its own.
    try:
        route = load_route(dep, dest, stops)
    except HTTPException:
        route = None
    current = [(a["lat"], a["lon"]) for a in route.airports] if route else None
    current_idents = list(route.idents[1:-1]) if route else []
    # Which of its points are fields landed at, not fixes flown over.
    current_landed = [not a.get("fix") for a in route.airports[1:-1]] if route else []
    found = vfr_route_options.options(
        {"ident": dep.upper(), "lat": start["lat"], "lon": start["lon"]},
        {"ident": dest.upper(), "lat": end["lat"], "lon": end["lon"]},
        profile, depart=depart, fcst_hr=forecast_hour_for(depart),
        min_ceiling_ft=min_ceiling_ft, min_visibility_sm=min_visibility_sm, current=current if stops.strip() else None,
        current_idents=current_idents, current_landed=current_landed,
    )
    answer = RouteOptions(**found)
    with _LOCK:
        _KEPT[key] = answer
    return answer
