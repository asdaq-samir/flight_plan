"""The Class B airports, as points on a map.

A Class B is the busiest kind of airspace the United States has, and
the thing a VFR pilot most wants to know about one is whether they can
get in today and what the terminal chart looks like. The FAA's Class
Airspace shapefile carries every Class B as a stack of shelves -- 369
polygons for 30 airports, one per altitude tier -- each tagged with the
primary airport's own identifier. This collapses that stack back into
one entry per airport.

It deliberately stops at the geography. Weather is the planner's to
attach (planning-service/app/routers/classb.py), because it is live and
this is not: the shapefile changes every 28 days, a METAR every hour.
"""
from __future__ import annotations

from . import airports as airports_module
from . import airspace


def _lowest(values: list) -> float | None:
    real = [v for v in values if v is not None]
    return min(real) if real else None


def class_b_airports(shp_path, cache_path=airports_module.DEFAULT_CACHE_PATH) -> list[dict]:
    """One entry per Class B airport, in identifier order.

    Each carries the identifier the shelves are tagged with, the
    airspace's own name ("NEW ORLEANS CLASS B"), the airport's position,
    and the lowest shelf floor -- the altitude below which a pilot is
    underneath the airspace rather than in it, which is the number that
    decides whether a clearance is needed to overfly.

    An identifier the airport table cannot place *inside its own
    airspace* is skipped rather than guessed at: a marker in the wrong
    place is worse than no marker. The shapefile uses the three-letter
    identifier (MSY) where the airport table is keyed by ICAO, which is
    K in the lower 48 and P in the Pacific, so the prefixes are tried
    before the bare form -- and the bare form is exactly the trap.
    Looking up "HNL" with no prefix returns a Mexican airport, and
    without the containment check Honolulu's Class B marker landed in
    Mexico.
    """
    shelves: dict[str, list[dict]] = {}
    for polygon in airspace._load_all_controlled_airspace(shp_path):
        if polygon.get("class") != "B":
            continue
        ident = (polygon.get("ident") or "").strip().upper()
        if ident:
            shelves.setdefault(ident, []).append(polygon)

    found = []
    for ident, group in sorted(shelves.items()):
        airport = _airport_for(ident, group, cache_path)
        if airport is None:
            continue
        found.append(
            {
                "ident": airport["ident"],
                "name": airport.get("name") or group[0]["name"],
                "airspace_name": group[0]["name"],
                "lat": airport["lat"],
                "lon": airport["lon"],
                "shelves": len(group),
                "floor_ft_msl": _lowest([p.get("floor_ft_msl") for p in group]),
            }
        )
    return found


def _envelope(group: list) -> tuple:
    """(min_lon, min_lat, max_lon, max_lat) around every shelf."""
    boxes = [p["bbox"] for p in group]
    return (min(b[0] for b in boxes), min(b[1] for b in boxes),
            max(b[2] for b in boxes), max(b[3] for b in boxes))


def _airport_for(ident: str, group: list, cache_path) -> dict | None:
    """The airport a Class B is named for, and demonstrably inside it.

    Tried as ICAO first -- K in the lower 48, P in the Pacific -- then
    bare. Whatever comes back has to sit within the airspace's own
    envelope, which is what catches a three-letter code that means one
    airport to the FAA and a different one to an international table.
    """
    min_lon, min_lat, max_lon, max_lat = _envelope(group)
    for candidate in (f"K{ident}", f"P{ident}", ident):
        try:
            airport = airports_module.get_airport(candidate, cache_path=cache_path)
        except ValueError:
            continue
        if min_lat <= airport["lat"] <= max_lat and min_lon <= airport["lon"] <= max_lon:
            return airport
    return None
