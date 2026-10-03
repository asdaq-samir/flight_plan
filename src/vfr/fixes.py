"""Named fixes from the FAA's NASR (FIX_BASE.csv): the RNAV waypoints a
GPS flies to, the reporting points, and the VFR waypoints charted on the
sectionals in magenta (VPBNG) -- what a route may fly through on the way,
where a stop at an airport is landed at.

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
            table[ident] = {
                "ident": ident, "lat": lat, "lon": lon, "kind": KINDS.get(use, "Fix"),
                "vfr": use == "VFR", "state": (row.get("STATE_CODE") or "").strip() or None,
            }
    return table


def _fixes(cache_dir=FAA_CACHE_DIR) -> dict[str, dict]:
    global _TABLE
    with _LOCK:
        if _TABLE is None:
            _TABLE = _read(faa_data.ensure_nasr_file("FIX_BASE.csv", cache_dir))
        return _TABLE


def find_fix(ident: str) -> dict | None:
    """The fix by its ident ("VPBNG", "BAEBE"), or None where NASR has
    none by that name."""
    return _fixes().get(ident.strip().upper())


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
