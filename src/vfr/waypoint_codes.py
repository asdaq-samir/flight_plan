"""What a panel GPS needs to find a route's point in its own database: the
point's Garmin type (AIRPORT, VOR, NDB, INT, INT-VRP) and its ICAO region
code ("K3"), as a Garmin flight plan (.fpl) writes them in `type` and
`country-code` (Garmin FlightPlan v1 schema,
www8.garmin.com/xmlschemas/FlightPlanv1.xsd). An identifier is not unique
in the world -- "AA" is an NDB in North Dakota and another in Georgia --
and the region is what tells a navigator which one is meant.

The regions are the FAA's CIFP (ARINC 424-18): the airport record's ICAO
code (columns 11-12, section P, subsection A), a navaid's (columns 20-21,
section D), an enroute or terminal waypoint's (columns 20-21, sections EA
and PC). The VFR waypoints, which the CIFP does not carry, come from
NASR's FIX_BASE.csv ICAO_REGION_CODE.
"""
from __future__ import annotations

import csv
from pathlib import Path

from . import faa_data, geo
from .config import DATA_DIR
from .once import once
from .procedures import cifp_path

FAA_CACHE_DIR = DATA_DIR / "raw" / "faa_nasr"

#: How far a point the route names may be from the one found by its
#: identifier and still be it, nm: the same identifier elsewhere is
#: hundreds of miles away; the route's own position of a point is the
#: database's to well under a mile.
SAME_POINT_NM = 5.0

#: A Garmin flight plan's waypoint types (FlightPlanv1.xsd's
#: waypoint-type), by what the CIFP says the point is.
AIRPORT, VOR, NDB, INT, VRP = "AIRPORT", "VOR", "NDB", "INT", "INT-VRP"


def _coordinate(text: str) -> float | None:
    """An ARINC 424 latitude (N46480779: degrees, minutes, seconds to a
    hundredth) or longitude (W092121033), in signed degrees."""
    text = text.strip()
    if len(text) not in (9, 10) or text[0] not in "NSEW":
        return None
    width = 2 if text[0] in "NS" else 3
    try:
        degrees, minutes = int(text[1:1 + width]), int(text[1 + width:3 + width])
        seconds = int(text[3 + width:]) / 100
    except ValueError:
        return None
    value = degrees + minutes / 60 + seconds / 3600
    return -value if text[0] in "SW" else value


def _position(line: str, at: int) -> tuple[float, float] | None:
    lat, lon = _coordinate(line[at:at + 9]), _coordinate(line[at + 9:at + 19])
    return (lat, lon) if lat is not None and lon is not None else None


@once(maxsize=2)
def _cifp_points(path: str) -> dict[str, list[dict]]:
    """Every airport, navaid and named waypoint in the CIFP, by identifier:
    its Garmin type, ICAO region and place."""
    found: dict[str, list[dict]] = {}

    def add(ident: str, kind: str, region: str, place: tuple[float, float] | None) -> None:
        ident, region = ident.strip(), region.strip()
        if ident and region and place:
            found.setdefault(ident, []).append({"type": kind, "region": region, "lat": place[0], "lon": place[1]})

    with open(path, encoding="ascii", errors="replace") as f:
        for line in f:
            # Standard records only (column 1 "S"), continuation number 0 or 1.
            if len(line) < 60 or line[0] != "S":
                continue
            section = line[4]
            if section == "P" and line[12] == "A":
                add(line[6:10], AIRPORT, line[10:12], _position(line, 32))
            elif section == "P" and line[12] == "C":
                add(line[13:18], INT, line[19:21], _position(line, 32))
            elif section == "E" and line[5] == "A":
                add(line[13:18], INT, line[19:21], _position(line, 32))
            elif section == "D" and line[5] in " B":
                # A DME alone has no VOR position: its DME's (column 56).
                place = _position(line, 32) or _position(line, 55)
                add(line[13:17], NDB if line[5] == "B" else VOR, line[19:21], place)
    return found


@once(maxsize=2)
def _vfr_waypoints(path: str, _mtime: float) -> dict[str, list[dict]]:
    """NASR's VFR waypoints (FIX_USE_CODE VFR), which the CIFP leaves out."""
    found: dict[str, list[dict]] = {}
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            ident = (row.get("FIX_ID") or "").strip().upper()
            region = (row.get("ICAO_REGION_CODE") or "").strip()
            try:
                lat, lon = float(row["LAT_DECIMAL"]), float(row["LONG_DECIMAL"])
            except (KeyError, TypeError, ValueError):
                continue
            if ident and region:
                kind = VRP if (row.get("FIX_USE_CODE") or "").strip() == "VFR" else INT
                found.setdefault(ident, []).append({"type": kind, "region": region, "lat": lat, "lon": lon})
    return found


def _nearest(candidates: list[dict], lat: float, lon: float) -> dict | None:
    if not candidates:
        return None
    best = min(candidates, key=lambda c: geo.distance_nm(c["lat"], c["lon"], lat, lon))
    return best if geo.distance_nm(best["lat"], best["lon"], lat, lon) <= SAME_POINT_NM else None


def code_of(ident: str, airport: bool, lat: float, lon: float, cifp: Path | None = None, fix_base: Path | None = None) -> dict:
    """A route's point's Garmin type and ICAO region: an airport as the
    CIFP files it, any other point as the navaid, waypoint or VFR waypoint
    of its identifier nearest where the route has it. Both None where none
    is within SAME_POINT_NM: a panel then looks it up by identifier alone."""
    ident = ident.strip().upper()
    cifp = cifp or cifp_path()
    points = _cifp_points(str(cifp)).get(ident, [])
    if airport:
        hit = _nearest([p for p in points if p["type"] == AIRPORT], lat, lon)
    else:
        hit = _nearest([p for p in points if p["type"] != AIRPORT], lat, lon)
        if hit is None:
            fix_base = fix_base or faa_data.ensure_nasr_file("FIX_BASE.csv", FAA_CACHE_DIR)
            hit = _nearest(_vfr_waypoints(str(fix_base), fix_base.stat().st_mtime).get(ident, []), lat, lon)
    return {"ident": ident, "type": hit["type"] if hit else None, "region": hit["region"] if hit else None}
