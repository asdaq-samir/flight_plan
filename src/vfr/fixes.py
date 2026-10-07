"""Named fixes from the FAA's NASR (FIX_BASE.csv): the RNAV waypoints a
GPS flies to, the reporting points, and the VFR waypoints charted on the
sectionals in magenta (VPBNG) -- what a route may fly through on the way,
where a stop at an airport is landed at. And the navaids (NAV_BASE.csv),
VORs, DMEs and NDBs: a pilot flies over RFD as over any waypoint.

The table is read once, on first use, and held: seventy thousand rows,
asked for by ident."""
from __future__ import annotations

import csv
import threading
from pathlib import Path

from . import faa_data
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

_TABLE: dict[str, dict] | None = None
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


def _read_navaids(path: Path) -> dict[str, dict]:
    """NAV_BASE's navaids in service, as fixes: "RFD", the Rockford DME,
    named and with its frequency. One per ident -- a few are two things
    at one place, or two places -- the likelier one to fly to first
    (NAVAID_KINDS)."""
    table: dict[str, dict] = {}
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
            held = table.get(ident)
            if held is not None and NAVAID_KINDS.index(held["kind"]) <= NAVAID_KINDS.index(kind):
                continue
            table[ident] = {
                "ident": ident, "lat": lat, "lon": lon, "kind": kind, "vfr": False, "navaid": True,
                "name": (row.get("NAME") or "").strip().title() or None, "freq": (row.get("FREQ") or "").strip() or None,
                "state": (row.get("STATE_CODE") or "").strip() or None,
            }
    return table


def _fixes(cache_dir=FAA_CACHE_DIR) -> dict[str, dict]:
    global _TABLE
    with _LOCK:
        if _TABLE is None:
            table = _read(faa_data.ensure_nasr_file("FIX_BASE.csv", cache_dir))
            # A navaid's two or three letters never are a fix's five.
            for ident, navaid in _read_navaids(faa_data.ensure_nasr_file("NAV_BASE.csv", cache_dir)).items():
                table.setdefault(ident, navaid)
            _TABLE = table
        return _TABLE


def find_fix(ident: str) -> dict | None:
    """The fix by its ident ("VPBNG", "BAEBE"), or None where NASR has
    none by that name."""
    return _fixes().get(ident.strip().upper())


def find_navaid(ident: str) -> dict | None:
    """The navaid by its ident ("RFD"), or None where it is no navaid."""
    fix = find_fix(ident)
    return fix if fix is not None and fix.get("navaid") else None


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
    hits = [fix for ident, fix in _fixes().items() if ident.startswith(query)]
    return sorted(hits, key=lambda fix: (fix["ident"] != query, not fix["vfr"], fix["ident"]))[:limit]


def within(south: float, west: float, north: float, east: float) -> list[dict]:
    """Every fix inside the box, for a route to be bent through one
    (vfr.airspace.detour_waypoint)."""
    return [fix for fix in _fixes().values() if south <= fix["lat"] <= north and west <= fix["lon"] <= east]


def preload() -> None:
    """Read the table now, at a service's start, rather than on the
    first route through a fix."""
    _fixes()
