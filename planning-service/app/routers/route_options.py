"""The ways to fly a route, for FPL's Routes (vfr.route_options): the
fastest, the best weather's and the fewest stops', each clear of
thunderstorms, weather under the pilot's minimums, prohibited areas, TFRs
and high ground."""
import threading
from datetime import datetime
from typing import Annotated

from cachetools import TTLCache
from fastapi import APIRouter, HTTPException, Query
from vfr import filed_routes, nearby
from vfr import route_options as vfr_route_options

from .. import prefetch
from ..common import DEFAULT_AIRCRAFT, load_route, resolve
from ..planning import aircraft_profile, forecast_hour_for
from ..schemas import RouteOptions
from .plan import CruiseTas, ServiceCeiling

router = APIRouter()

#: An answer kept ten minutes: the TAFs and METARs it reads change by the
#: hour, and FPL asks again as the page draws.
_KEPT: TTLCache = TTLCache(maxsize=128, ttl=600)
#: One whose fuel stops' places to eat were not all read yet, a minute:
#: asked again once they have been (nearby.read_later), its stops may be
#: ones with a meal.
_KEPT_SHORT: TTLCache = TTLCache(maxsize=128, ttl=60)
_LOCK = threading.Lock()


#: The words on the route line's chip for each kind of way, and the order
#: they come in after "None" and "Your Route" (the owner's canvas,
#: 2026-10-26). The fewest stops' way is not offered (lib/routeWays).
CHIP_WORDS = {"weather": "Avoid Weather", "fastest": "Fastest", "land": "Over Land"}
#: The last chip's: the route pilots file most between the two fields
#: (vfr.filed_routes; the owner, 2026-10-27: "Most filed is how you get
#: most flown").
FILED_WORDS = "Most Filed"
def _same(ident: str) -> str:
    """An ident as the route's box may spell it: KUES and UES alike."""
    s = ident.strip().upper()
    return s[1:] if len(s) == 4 and s.startswith("K") and s.isalpha() else s


def _chips(found: dict, typed: list[str]) -> list[dict]:
    """FPL's route line: "None", the route as typed; "Your Route" with the
    fuel stops it needs; then the ways, each named by what it is alone --
    "Fastest", "Avoid Weather" -- not the stops it adds, at the owner's ask
    (2026-10-28: "for routes, don't include stops in its label"), its
    stops drawn on the map and put in the route's box as it is picked.
    One chip a set of stops; none at all where only the route itself is
    left."""
    chips = [{"key": "none", "label": "None", "stops": typed, "fuel": [],
              "crosses": found.get("current", []) if typed else found.get("direct", [])}]
    seen = [[_same(t) for t in typed]]

    def add(key: str, words: str, way: dict) -> None:
        same = [_same(s) for s in way["stops"]]
        if same in seen:
            return
        seen.append(same)
        chips.append({"key": key, "label": words,
                      "stops": way["stops"], "fuel": way["fuel"], "crosses": way.get("crosses", [])})

    own = found.get("own")
    if own and own.get("landings"):
        add("fuel", "Your Route", own)
    for kind in CHIP_WORDS:
        way = next((o for o in found.get("options", []) if kind in o["kinds"]), None)
        if way:
            add(kind, " & ".join(CHIP_WORDS[k] for k in CHIP_WORDS if k in way["kinds"]), way)
    filed = found.get("filed")
    if filed:
        add("filed", FILED_WORDS, filed)
    return chips if len(chips) > 1 else []


def _most_filed(dep: str, dest: str) -> tuple[tuple[list[tuple], list[str]] | None, list[str]]:
    """The route most filed between the fields that the planner can fly
    (load_route: every fix and airway found), its points and idents
    between the ends with each airway flown fix by fix, and its stops as
    filed; (None, []) where none is."""
    for way in filed_routes.most_filed(dep, dest):
        if not way["stops"]:
            continue
        try:
            route = load_route(dep, dest, ",".join(way["stops"]))
        except HTTPException:
            continue
        return ([(a["lat"], a["lon"]) for a in route.airports[1:-1]], list(route.idents[1:-1])), way["stops"]
    return None, []


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
        kept = _KEPT.get(key) or _KEPT_SHORT.get(key)
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
    filed, filed_as = _most_filed(dep, dest)
    # Where there is somewhere to eat at each fuel field the ways weigh
    # (vfr.nearby, the places kept for it), so a stop with a meal is
    # landed at among chains of as many stops; a field not read yet is
    # read on the side and taken as having none this time.
    unread: list[str] = []

    def food(ident: str, lat: float, lon: float) -> bool:
        has = nearby.food_at(ident)
        if has is None:
            unread.append(ident)
            nearby.read_later(ident, lat, lon)
        return bool(has)

    found = vfr_route_options.options(
        {"ident": dep.upper(), "lat": start["lat"], "lon": start["lon"]},
        {"ident": dest.upper(), "lat": end["lat"], "lon": end["lon"]},
        profile, depart=depart, fcst_hr=forecast_hour_for(depart),
        min_ceiling_ft=min_ceiling_ft, min_visibility_sm=min_visibility_sm, current=current if stops.strip() else None,
        current_idents=current_idents, current_landed=current_landed, filed=filed, food=food,
    )
    typed = [s.strip().upper() for s in stops.split(",") if s.strip()]
    chips = _chips(found, typed)
    # The most filed route kept as filed, its airways named, where it
    # needs no fuel stop: the route box shows "V4", not its every fix.
    if filed_as and found.get("filed") and not found["filed"]["fuel"]:
        for chip in chips:
            if chip["key"] == "filed":
                chip["stops"] = filed_as
    found.pop("filed", None)
    # Each chip's route read ahead, its chart and its ground, as a typed
    # route is (app.prefetch): a tap on one waited on every new hop's
    # chart read, 18 s for KPWK to KCOS by three fixes (2026-10-27). The
    # first chip last, as the reads ahead go newest first.
    for chip in reversed(chips):
        if chip["key"] != "none":
            prefetch.route(dep, dest, ",".join(chip["stops"]))
    answer = RouteOptions(**{**found, "chips": chips})
    with _LOCK:
        (_KEPT_SHORT if unread else _KEPT)[key] = answer
    return answer
