"""Named fixes from the FAA's NASR (FIX_BASE.csv): the RNAV waypoints a
GPS flies to, the reporting points, and the VFR waypoints charted on the
sectionals in magenta (VPBNG) -- what a route may fly through on the way,
where a stop at an airport is landed at. And the navaids (NAV_BASE.csv),
VORs, DMEs and NDBs: a pilot flies over RFD as over any waypoint.

The table is read once, on first use, and held: seventy thousand rows,
asked for by ident."""
from __future__ import annotations

import bisect
import csv
import math
import threading
from pathlib import Path

from . import faa_data, geo
from .config import DATA_DIR

FAA_CACHE_DIR = DATA_DIR / "raw" / "faa_nasr"

#: What a fix is to a pilot, by NASR's FIX_USE_CODE.
KINDS = {
    "VFR": "VFR waypoint",
    "WP": "GPS waypoint",
    "RP": "Reporting point",
    "CN": "Computer navigation fix",
    "MR": "Military reporting point",
    "MW": "Military waypoint",
    "NRS": "Navigation reference system waypoint",
    "RADAR": "Radar fix",
}

#: The charts a VFR waypoint must be on to be one a pilot can see:
#: NASR's CHARTS column.
VFR_CHARTS = {"SECTIONAL", "VFR TERMINAL AREA"}

#: The navaids a route may fly over, by NAV_BASE's NAV_TYPE, in the order
#: one is kept over another of the same ident: not the VOR test facilities
#: (VOT), the fan markers or a marine beacon, which no route flies to.
NAVAID_KINDS = ("VORTAC", "VOR/DME", "VOR", "DME", "TACAN", "NDB/DME", "NDB")

_TABLE: "_Table | None" = None
_LOCK = threading.Lock()


def _read(path: Path) -> dict[str, dict]:
    table = {}
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            ident = (row.get("FIX_ID") or "").strip().upper()
            try:
                lat, lon = float(row["LAT_DECIMAL"]), float(row["LONG_DECIMAL"])
            except (KeyError, TypeError, ValueError):
                continue
            if not ident:
                continue
            use = (row.get("FIX_USE_CODE") or "").strip()
            charts = {c.strip() for c in (row.get("CHARTS") or "").split(",") if c.strip()}
            # A VFR waypoint a fixed-wing pilot has on a chart: on the
            # sectional or the terminal area chart. NASR files the
            # helicopter routes' waypoints as VFR too -- the line of
            # them across O'Hare (VPDVA to VPDVI) -- and a few no chart
            # carries.
            vfr = use == "VFR" and bool(charts & VFR_CHARTS)
            kind = KINDS.get(use, "Fix")
            if use == "VFR" and not vfr:
                kind = "Helicopter route waypoint" if "HELICOPTER ROUTE" in charts else "Uncharted VFR waypoint"
            table[ident] = {
                "ident": ident, "lat": lat, "lon": lon, "kind": kind,
                "vfr": vfr, "state": (row.get("STATE_CODE") or "").strip() or None,
            }
    return table


def _read_navaids(path: Path) -> dict[str, list[dict]]:
    """NAV_BASE's navaids in service, as fixes: "RFD", the Rockford DME,
    named and with its frequency. Every one by each ident, the likelier
    to fly to first (NAVAID_KINDS): 33 idents name navaids in two or more
    places -- "AA" a beacon in North Dakota and another in Georgia -- and
    which is meant is the one by the route (find_navaid). One facility
    filed as two kinds at one place (a VOR/DME and a TACAN) is one."""
    table: dict[str, list[dict]] = {}
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            ident = (row.get("NAV_ID") or "").strip().upper()
            kind = (row.get("NAV_TYPE") or "").strip()
            if not ident or kind not in NAVAID_KINDS or (row.get("NAV_STATUS") or "").strip() == "SHUTDOWN":
                continue
            try:
                lat, lon = float(row["LAT_DECIMAL"]), float(row["LONG_DECIMAL"])
            except (KeyError, TypeError, ValueError):
                continue
            navaid = {
                "ident": ident, "lat": lat, "lon": lon, "kind": kind, "vfr": False, "navaid": True,
                "name": (row.get("NAME") or "").strip().title() or None, "freq": (row.get("FREQ") or "").strip() or None,
                "state": (row.get("STATE_CODE") or "").strip() or None,
            }
            held = table.setdefault(ident, [])
            here = next(
                (i for i, other in enumerate(held) if geo.distance_nm(lat, lon, other["lat"], other["lon"]) < SAME_FACILITY_NM),
                None,
            )
            if here is None:
                held.append(navaid)
            elif NAVAID_KINDS.index(kind) < NAVAID_KINDS.index(held[here]["kind"]):
                held[here] = navaid
    for held in table.values():
        held.sort(key=lambda navaid: NAVAID_KINDS.index(navaid["kind"]))
    return table


#: How close two navaids by one ident are to be one facility filed twice.
SAME_FACILITY_NM = 1.0

#: The size of the cells `within` looks a box up by, in degrees.
_CELL_DEG = 1.0


def _cell(lat: float, lon: float) -> tuple[int, int]:
    return math.floor(lat / _CELL_DEG), math.floor(lon / _CELL_DEG)


class _Table:
    """The fixes and navaids, and the two indexes asked of them: the
    idents in order, for a prefix found by bisection rather than a scan
    of seventy thousand at every keystroke (8 ms a search, measured
    2026-10-07), and a degree's cells, for a box's fixes without a scan
    of them all at every pan of the map (13 ms)."""

    def __init__(self, fixes: dict[str, dict], navaids: dict[str, list[dict]]):
        self.by_ident = dict(fixes)
        # A navaid's two or three letters never are a fix's five.
        for ident, found in navaids.items():
            self.by_ident.setdefault(ident, found[0])
        self.navaids = navaids
        self.idents = sorted(self.by_ident)
        self.cells: dict[tuple[int, int], list[dict]] = {}
        everything = [*fixes.values(), *(navaid for found in navaids.values() for navaid in found)]
        for fix in everything:
            self.cells.setdefault(_cell(fix["lat"], fix["lon"]), []).append(fix)


def _table(cache_dir=FAA_CACHE_DIR) -> _Table:
    global _TABLE
    with _LOCK:
        if _TABLE is None:
            _TABLE = _Table(
                _read(faa_data.ensure_nasr_file("FIX_BASE.csv", cache_dir)),
                _read_navaids(faa_data.ensure_nasr_file("NAV_BASE.csv", cache_dir)),
            )
        return _TABLE


def _fixes(cache_dir=FAA_CACHE_DIR) -> dict[str, dict]:
    return _table(cache_dir).by_ident


def find_fix(ident: str) -> dict | None:
    """The fix by its ident ("VPBNG", "BAEBE"), or None where NASR has
    none by that name."""
    return _fixes().get(ident.strip().upper())


def find_navaid(ident: str, near: tuple = ()) -> dict | None:
    """The navaid by its ident ("RFD"), or None where it is no navaid.
    Where one ident names navaids in more than one place, the one the
    route bends least to fly over -- `near` its other points, (lat, lon)
    each -- else the likelier kind."""
    found = _table().navaids.get(ident.strip().upper())
    if not found:
        return None
    if len(found) == 1 or not near:
        return found[0]
    return min(found, key=lambda navaid: sum(geo.distance_nm(navaid["lat"], navaid["lon"], lat, lon) for lat, lon in near))


def title(fix: dict) -> str:
    """What a fix is called to a pilot: a navaid by its name, kind and
    frequency -- "Rockford DME 110.8" -- the rest by their kind."""
    if not fix.get("navaid"):
        return fix["kind"]
    return " ".join(part for part in (fix.get("name"), fix["kind"], fix.get("freq")) if part)


def search_fixes(query: str, limit: int = 5) -> list[dict]:
    """Fixes whose ident starts with `query`, the VFR waypoints first --
    a VFR pilot's -- then by ident."""
    query = query.strip().upper()
    if len(query) < 2:
        return []
    table = _table()
    hits = []
    for ident in table.idents[bisect.bisect_left(table.idents, query):]:
        if not ident.startswith(query):
            break
        hits.append(table.by_ident[ident])
    return sorted(hits, key=lambda fix: (fix["ident"] != query, not fix["vfr"], fix["ident"]))[:limit]


def within(south: float, west: float, north: float, east: float) -> list[dict]:
    """Every fix inside the box, for a route to be bent through one
    (vfr.airspace.detour_waypoint) and the map's VFR waypoints -- every
    navaid of an ident too, wherever each is."""
    cells = _table().cells
    (bottom, left), (top, right) = _cell(south, west), _cell(north, east)
    return [
        fix
        for lat_cell in range(bottom, top + 1) for lon_cell in range(left, right + 1)
        for fix in cells.get((lat_cell, lon_cell), ())
        if south <= fix["lat"] <= north and west <= fix["lon"] <= east
    ]


def preload() -> None:
    """Read the table now, at a service's start, rather than on the
    first route through a fix."""
    _fixes()
