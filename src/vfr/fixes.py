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
import re
import threading
from pathlib import Path

from . import faa_data, geo, magnetic
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

#: NASR's CHARTS name for the IFR Enroute Low Altitude chart.
ENROUTE_LOW_CHART = "ENROUTE LOW"

#: The navaids the sectional draws as a VOR, by NAV_BASE's NAV_TYPE:
#: the VOR's hexagon, the VOR/DME's in its box and the VORTAC's (FAA
#: Aeronautical Chart User's Guide, VFR Terms and Symbols, Radio Aids to
#: Navigation).
VOR_KINDS = ("VORTAC", "VOR/DME", "VOR")

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
                # On the IFR low-altitude enroute chart: the intersections
                # of the airways below 18,000 ft that the map shows close
                # in (enroute_fixes_within), not the approaches' and
                # procedures' thousands no pilot sees on a route chart.
                "enroute_low": ENROUTE_LOW_CHART in charts,
            }
    return table


def _station_variation(row: dict) -> float | None:
    """A navaid's own magnetic variation as NASR files it (NAV_BASE's
    MAG_VARN and MAG_VARN_HEMIS, "5" and "E" for Duluth's VORTAC): the
    declination its radials are aligned to, set when it was last flight
    checked, east positive as vfr.magnetic's; None where it has none."""
    try:
        degrees = float((row.get("MAG_VARN") or "").strip())
    except ValueError:
        return None
    return -degrees if (row.get("MAG_VARN_HEMIS") or "").strip().upper() == "W" else degrees


def _number(text: str | None) -> float | None:
    try:
        return float((text or "").strip())
    except ValueError:
        return None


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
                "mag_var": _station_variation(row),
                # For its card: the station's height (ELEV, ft MSL), its
                # TACAN or DME channel (CHAN, "70X"), its standard service
                # volume's class (ALT_CODE: T, L, H, VL or VH, AIM 1-1-8),
                # its hours (OPER_HOURS, "24") and whether it is in
                # service with restrictions (NAV_STATUS's "RESTRICTED").
                "elevation_ft": _number(row.get("ELEV")),
                "channel": (row.get("CHAN") or "").strip() or None,
                "service_volume": (row.get("ALT_CODE") or "").strip() or None,
                "hours": (row.get("OPER_HOURS") or "").strip() or None,
                "restricted": "RESTRICTED" in (row.get("NAV_STATUS") or "").upper(),
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

    def __init__(self, fixes: dict[str, dict], navaids: dict[str, list[dict]], source: tuple = ()):
        # The files read and their mtimes: a new FAA edition (vfr.faa_data.
        # refresh_editions) is read again where it is next asked for.
        self.source = source
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


def _current(table: _Table | None) -> bool:
    try:
        return table is not None and all(path.stat().st_mtime == mtime for path, mtime in table.source)
    except OSError:
        return False


def _table(cache_dir=FAA_CACHE_DIR) -> _Table:
    global _TABLE
    with _LOCK:
        if not _current(_TABLE):
            fix_path = faa_data.ensure_nasr_file("FIX_BASE.csv", cache_dir)
            nav_path = faa_data.ensure_nasr_file("NAV_BASE.csv", cache_dir)
            _TABLE = _Table(
                _read(fix_path), _read_navaids(nav_path),
                source=tuple((path, path.stat().st_mtime) for path in (fix_path, nav_path)),
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


def vors_within(south: float, west: float, north: float, east: float) -> list[dict]:
    """The VORs, VOR/DMEs and VORTACs in service inside the box, by
    ident, for the map's VOR marks."""
    return sorted(
        (f for f in within(south, west, north, east) if f.get("navaid") and f["kind"] in VOR_KINDS),
        key=lambda f: f["ident"],
    )


def enroute_fixes_within(south: float, west: float, north: float, east: float) -> list[dict]:
    """The fixes on the low-altitude enroute chart inside the box, by
    ident, for the map's fix marks. Not the VFR waypoints, which the map
    draws as the sectional's diamonds of their own."""
    return sorted(
        (f for f in within(south, west, north, east) if f.get("enroute_low") and not f["vfr"]),
        key=lambda f: f["ident"],
    )


_REMARKS: tuple[float, dict[tuple[str, str], list[str]]] | None = None


def navaid_remarks(ident: str, kind: str, cache_dir=FAA_CACHE_DIR) -> list[str]:
    """A navaid's own remarks from NASR's NAV_RMK.csv, in plain English
    (vfr.remarks.plain): where its signal is unusable ("VOR unusable
    072-090 beyond 34 nm below 3000 ft"), the Chart Supplement's service
    volume restrictions (AIM 1-1-8). Not its receiver checkpoints'. None
    where the file cannot be had: a card without them."""
    from . import remarks

    global _REMARKS
    try:
        path = faa_data.ensure_nasr_file("NAV_RMK.csv", cache_dir)
        mtime = path.stat().st_mtime
    except (OSError, RuntimeError):
        return []
    with _LOCK:
        if _REMARKS is None or _REMARKS[0] != mtime:
            table: dict[tuple[str, str], list[str]] = {}
            with open(path, newline="", encoding="utf-8", errors="replace") as f:
                for row in csv.DictReader(f):
                    if (row.get("TAB_NAME") or "").strip() != "NAVIGATION_AID":
                        continue
                    key = ((row.get("NAV_ID") or "").strip().upper(), (row.get("NAV_TYPE") or "").strip())
                    text = (row.get("REMARK") or "").strip()
                    if text:
                        table.setdefault(key, []).append(remarks.plain(text))
            _REMARKS = (mtime, table)
        return list(_REMARKS[1].get((ident.upper(), kind), []))


def preload() -> None:
    """Read the table now, at a service's start, rather than on the
    first route through a fix."""
    _fixes()


#: A point off a fix, as a flight plan writes one -- its fix, the
#: magnetic course or radial from it and the distance, nm: "VPBNG/090/30"
#: as ForeFlight's route takes it, or packed, "DLH090030", the FAA flight
#: plan's fix/radial/distance (FAA Form 7233-4, item 15, route; AIM 5-1-6). The
#: pilot's own point, at the owner's ask ("30 miles 090 radial of vpbng").
_FRD = re.compile(r"^([A-Z0-9]{2,5})/(\d{3})/(\d{1,3}(?:\.\d)?)$")
_FRD_PACKED = re.compile(r"^([A-Z]{2,5})(\d{3})(\d{3})$")

#: The navaids whose bearings are radials, set to the station's own
#: variation: the VORs and the military's TACANs.
RADIAL_KINDS = ("VORTAC", "VOR/DME", "VOR", "TACAN")


def parse_frd(ident: str) -> tuple[str, int, float] | None:
    """A fix/radial/distance's parts -- the fix, the course, the nm -- or
    None where `ident` is not one, or its course or distance cannot be."""
    ident = ident.strip().upper()
    match = _FRD.match(ident) or _FRD_PACKED.match(ident)
    if match is None:
        return None
    course, distance = int(match[2]), float(match[3])
    if not 0 <= course <= 360 or not 0 < distance <= 999:
        return None
    return match[1], course % 360, distance


def frd_ident(base: str, course: int, distance_nm: float) -> str:
    """The point's ident as the route writes it: "VPBNG/090/30"."""
    return f"{base.upper()}/{round(course) % 360:03d}/{distance_nm:g}"


def frd_point(ident: str, near: tuple = (), locate=None) -> dict | None:
    """The pilot's own point (parse_frd), where it is: its fix's, moved
    the distance along the course. A VOR's radial is turned to true by the
    station's own variation (NAV_BASE's, _station_variation), as its
    radials are set; any other fix's course by the variation there now
    (the World Magnetic Model, vfr.magnetic), as a GPS turns a user
    waypoint's. True = magnetic + variation, east positive. Off a point
    that is no fix -- an airport, "KMSN/090/30" -- where `locate` finds
    it, (lat, lon) or None. None where it is no fix/radial/distance, or
    its fix is nowhere to be found."""
    parts = parse_frd(ident)
    if parts is None:
        return None
    base, course, distance = parts
    navaid = find_navaid(base, near)
    fix = navaid or find_fix(base)
    if fix is None and locate is not None:
        at = locate(base)
        fix = {"lat": at[0], "lon": at[1]} if at else None
    if fix is None:
        return None
    radial = bool(navaid) and navaid["kind"] in RADIAL_KINDS and navaid.get("mag_var") is not None
    variation = navaid["mag_var"] if radial else magnetic.magnetic_variation_deg(fix["lat"], fix["lon"])
    lat, lon = geo.destination_point(fix["lat"], fix["lon"], (course + variation) % 360, distance)
    return {
        "ident": frd_ident(base, course, distance), "lat": lat, "lon": lon, "kind": "Your point", "vfr": False,
        "base": base, "course_deg": course, "distance_nm": distance, "radial": radial,
    }


def frd_title(point: dict) -> str:
    """What the pilot's point is called: "30 nm on the 090 radial of DLH",
    "30 nm on 090° from VPBNG"."""
    nm = f"{point['distance_nm']:g} nm"
    if point["radial"]:
        return f"{nm} on the {point['course_deg']:03d} radial of {point['base']}"
    return f"{nm} on {point['course_deg']:03d}° from {point['base']}"


#: How far a dropped point is named from a fix, nm: further, it is named
#: from the nearest of any kind.
NEAR_NM = 40.0


def frd_near(lat: float, lon: float, max_nm: float = NEAR_NM) -> dict | None:
    """A point the pilot dropped on the map named as their own point
    (frd_point) off the nearest fix a pilot knows -- a navaid or a VFR
    waypoint charted on the sectional -- within `max_nm`, else the nearest
    fix of any kind there: "VPBNG/095/14.2". Its course magnetic as
    frd_point turns it back (a VOR's own variation, the model's for any
    other), to the degree, and its distance to a tenth of a mile; so it
    comes back to within a few hundredths of a mile of where it was
    dropped. None with no fix within `max_nm`."""
    dlat = max_nm / 60
    dlon = max_nm / (60 * max(0.1, math.cos(math.radians(lat))))
    around = [
        (geo.distance_nm(fix["lat"], fix["lon"], lat, lon), fix)
        for fix in within(lat - dlat, lon - dlon, lat + dlat, lon + dlon)
        if re.fullmatch(r"[A-Z0-9]{2,5}", fix["ident"])
    ]
    around = [(nm, fix) for nm, fix in around if 0.05 <= nm <= max_nm]
    if not around:
        return None
    known = [(nm, fix) for nm, fix in around if fix.get("navaid") or fix.get("vfr")]
    nm, fix = min(known or around, key=lambda pair: pair[0])
    radial = bool(fix.get("navaid")) and fix["kind"] in RADIAL_KINDS and fix.get("mag_var") is not None
    variation = fix["mag_var"] if radial else magnetic.magnetic_variation_deg(fix["lat"], fix["lon"])
    course = round((geo.bearing_deg(fix["lat"], fix["lon"], lat, lon) - variation) % 360) % 360
    distance = round(float(nm), 1)
    point = {"base": fix["ident"], "course_deg": course, "distance_nm": distance, "radial": radial}
    return {**point, "ident": frd_ident(fix["ident"], course, distance), "name": frd_title(point)}
