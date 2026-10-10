"""An airport's instrument procedures -- its approaches, its arrivals
(STARs) and its departures (SIDs) -- from the FAA's Coded Instrument
Flight Procedures (CIFP): the file a GPS's database is built from, in
ARINC 424-18's 132-column records, published with each 28-day AIRAC
cycle (FAA Aeronautical Information Services, "CIFP Readme").

Each procedure is drawn as its chart draws it, for the map: its fixes in
order, a line along its legs, its holds, and the altitude and speed each
fix is to be crossed at. A sketch from the coded legs, not the chart: the
legs that end at no fix (a climb on a course to an altitude, a heading to
intercept) end where a turn would, and a hold is drawn the size a light
airplane flies it.

The national file (53 MB) is downloaded once a cycle and read once: an
index of where each airport's records lie, and the fixes, navaids and
NDBs that are not an airport's own. An airport's procedures are read
from its own run of records when asked for.
"""
from __future__ import annotations

import logging
import math
import re
import threading
from dataclasses import dataclass, field
from datetime import date
from functools import lru_cache
from pathlib import Path

from . import geo
from .config import DATA_DIR
from .faa_data import download_and_extract
from .publications import AIRAC_DAYS, AIRAC_EPOCH, _cycle_start

log = logging.getLogger(__name__)

CIFP_DIR = DATA_DIR / "raw" / "faa_cifp"
#: The cycle's zip, by the date it takes effect ("CIFP_261001.zip"), as
#: the FAA's CIFP download page links it.
CIFP_URL = "https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_{start:%y%m%d}.zip"
CIFP_FILE = "FAACIFP18"

#: What a procedure is, by its record's subsection (ARINC 424-18 5.5).
KINDS = {"D": "departure", "E": "arrival", "F": "approach"}

#: An approach's kind by its identifier's first letter (ARINC 424-18
#: 5.10, as the FAA codes them: "I08-Y" is the ILS Y to runway 08).
APPROACH_TYPES = {
    "B": "LOC/BC", "D": "VOR/DME", "G": "IGS", "H": "RNAV (RNP)", "I": "ILS", "J": "GLS", "L": "LOC", "N": "NDB",
    "P": "GPS", "Q": "NDB/DME", "R": "RNAV (GPS)", "S": "VOR", "T": "TACAN", "U": "SDF", "V": "VOR", "X": "LDA",
}
#: A circling approach's, by its first three ("VDM-A" is the VOR/DME-A).
CIRCLING_TYPES = {
    "VOR": "VOR", "VDM": "VOR/DME", "RNV": "RNAV (GPS)", "NDB": "NDB", "NDM": "NDB/DME", "LOC": "LOC", "LBC": "LOC/BC",
    "LDA": "LDA", "GPS": "GPS", "TAC": "TACAN", "SDF": "SDF",
}

#: Legs that end at their fix, and the ones that hold at it (ARINC 424-18
#: 5.21, Attachment 5).
TO_FIX = {"IF", "TF", "CF", "DF", "RF", "AF"}
HOLDS = {"HA", "HF", "HM"}
#: Legs flown from their fix along a course; and on a course or heading
#: from wherever the last one ended, to an altitude, a distance, a radial,
#: an intercept or until vectored: none has a place to end at.
FROM_FIX = {"FA", "FC", "FD", "FM"}
OPEN = {"CA", "CD", "CI", "CR", "VA", "VD", "VI", "VM", "VR"}

#: How long a leg with no end is drawn: about a turn's worth at a light
#: airplane's speed, enough to show which way it goes.
OPEN_LEG_NM = 2.0
#: A hold drawn at a light airplane's speed: a one-minute leg (AIM 5-3-8,
#: at or below 14,000 ft MSL) and standard-rate turns (3° a second) at
#: 120 knots -- two miles on each leg, and turns 0.64 nm round. Charts
#: draw holds to no scale; this is one a light airplane would fly, not a
#: jet's at the 200 KIAS a hold below 6,000 ft MSL may be flown at (AIM
#: 5-3-8, table 5-3-1).
HOLD_SPEED_KT = 120.0
HOLD_TURN_NM = HOLD_SPEED_KT * (120 / 3600) / (2 * math.pi)

_LOCK = threading.Lock()


def cifp_start(on: date | None = None) -> date:
    """The date the AIRAC cycle in force on `on` (today) took effect."""
    return _cycle_start(on or date.today(), AIRAC_EPOCH, AIRAC_DAYS)


def cifp_path(on: date | None = None) -> Path:
    """The cycle's FAACIFP18, downloaded the first time it is asked for.
    The newest one on disk while the cycle's own cannot be had: the FAA
    posts it a few weeks ahead, so that is rare and short."""
    start = cifp_start(on)
    folder = CIFP_DIR / f"{start:%y%m%d}"
    path = folder / CIFP_FILE
    if path.exists():
        return path
    with _LOCK:
        if not path.exists():
            try:
                download_and_extract(CIFP_URL.format(start=start), folder, only={CIFP_FILE})
            except RuntimeError:
                held = sorted(CIFP_DIR.glob(f"*/{CIFP_FILE}"))
                if not held:
                    raise
                log.warning("The CIFP for %s could not be had; using %s", start, held[-1].parent.name)
                return held[-1]
    return path


# --- the records -----------------------------------------------------------

def _col(rec: str, first: int, last: int) -> str:
    """Columns `first` to `last` of a record, as ARINC 424 numbers them
    (from 1, both ends in)."""
    return rec[first - 1:last]


def _angle(text: str, degrees: int) -> float | None:
    """A latitude ("N34120381") or longitude ("W118364189"): hemisphere,
    degrees, minutes, seconds to hundredths (ARINC 424-18 5.36, 5.37)."""
    text = text.strip()
    if len(text) != 1 + degrees + 6 or text[0] not in "NSEW":
        return None
    d, m, s = int(text[1:1 + degrees]), int(text[1 + degrees:3 + degrees]), int(text[3 + degrees:]) / 100
    value = d + m / 60 + s / 3600
    return -value if text[0] in "SW" else value


def _position(rec: str) -> tuple[float, float] | None:
    """A waypoint's, a navaid's, a runway's or an airport's place: its
    latitude in columns 33-41 and its longitude in 42-51."""
    lat, lon = _angle(_col(rec, 33, 41), 2), _angle(_col(rec, 42, 51), 3)
    return None if lat is None or lon is None else (lat, lon)


def _variation(text: str) -> float | None:
    """A magnetic variation, east positive: "E0120" is 12.0° east (5.39)."""
    text = text.strip()
    if len(text) != 5 or text[0] not in "EW" or not text[1:].isdigit():
        return None
    value = int(text[1:]) / 10
    return value if text[0] == "E" else -value


def _tenths(text: str) -> float | None:
    text = text.strip()
    return int(text) / 10 if text.isdigit() else None


def _feet(text: str) -> int | None:
    """An altitude field: feet ("04600"), or a flight level ("FL180")."""
    text = text.strip()
    if text.startswith("FL") and text[2:].isdigit():
        return int(text[2:]) * 100
    return int(text) if text.isdigit() else None


@dataclass
class Leg:
    """One leg of a procedure, as its primary record codes it (ARINC
    424-18 4.1.9.1)."""
    route: str
    transition: str
    seq: int
    fix: str
    fix_icao: str
    fix_section: str
    description: str
    turn: str
    path: str
    navaid: str
    arc_nm: float | None
    theta: float | None
    rho: float | None
    #: The course or heading flown, degrees magnetic unless `course_true`.
    course: float | None
    course_true: bool
    distance_nm: float | None
    minutes: float | None
    altitude_code: str
    altitude1: int | None
    altitude2: int | None
    speed_kt: int | None
    speed_code: str
    center: str
    center_icao: str
    center_section: str

    @classmethod
    def read(cls, rec: str) -> Leg:
        course = _col(rec, 71, 74).strip()
        held = _col(rec, 75, 78).strip()
        return cls(
            route=_col(rec, 20, 20), transition=_col(rec, 21, 25).strip(), seq=int(_col(rec, 27, 29) or 0),
            fix=_col(rec, 30, 34).strip(), fix_icao=_col(rec, 35, 36), fix_section=_col(rec, 37, 38),
            description=_col(rec, 40, 43), turn=_col(rec, 44, 44).strip(), path=_col(rec, 48, 49),
            navaid=_col(rec, 51, 54).strip(),
            arc_nm=int(_col(rec, 57, 62)) / 1000 if _col(rec, 57, 62).strip().isdigit() else None,
            theta=_tenths(_col(rec, 63, 66)), rho=_tenths(_col(rec, 67, 70)),
            # "0789" is 078.9° magnetic; "264T" 264° true (5.26).
            course=(int(course[:3]) if course.endswith("T") and course[:3].isdigit() else _tenths(course)),
            course_true=course.endswith("T"),
            # A hold's leg: "0050" five miles, "T010" one minute (5.27).
            distance_nm=_tenths(held), minutes=_tenths(held[1:]) if held.startswith("T") else None,
            altitude_code=_col(rec, 83, 83), altitude1=_feet(_col(rec, 85, 89)), altitude2=_feet(_col(rec, 90, 94)),
            speed_kt=int(_col(rec, 100, 102)) if _col(rec, 100, 102).strip().isdigit() else None,
            speed_code=_col(rec, 118, 118).strip(),
            center=_col(rec, 107, 111).strip(), center_icao=_col(rec, 113, 114), center_section=_col(rec, 115, 116),
        )

    @property
    def missed_approach_point(self) -> bool:
        """The approach's missed approach point: its waypoint
        description's fourth character "M" (5.17)."""
        return self.description[3:4] == "M"


def altitude_limits(leg: Leg) -> tuple[int | None, int | None]:
    """The lowest and highest altitude a fix is to be crossed at, by its
    altitude description (ARINC 424-18 5.29): "+" at or above the first
    altitude, "-" at or below it, blank at it, "B" between the second
    (at or above) and the first (at or below). On an approach, "G" and
    "I" are at the first altitude and "H", "J" and "V" at or above it,
    the second being the glide slope's or the vertical path's altitude
    there; "X" is at it and "Y" at or below it. (None, None) where there
    is no limit."""
    code, first, second = leg.altitude_code, leg.altitude1, leg.altitude2
    if first is None:
        return None, None
    if code in "+HJV":
        return first, None
    if code in "-Y":
        return None, first
    if code == "B":
        return second, first
    if code == "C":
        return second, None
    return first, first


# --- the file's index ------------------------------------------------------

@dataclass
class _Index:
    path: Path
    #: Each airport's run of records: where it starts and how long it is.
    airports: dict[str, tuple[int, int]] = field(default_factory=dict)
    #: Enroute waypoints, VHF navaids and NDBs, by ident: (ICAO code,
    #: section, place) for each of that name.
    fixes: dict[str, list[tuple[str, str, tuple[float, float]]]] = field(default_factory=dict)


@lru_cache(maxsize=2)
def _index(path: Path) -> _Index:
    """One read of the national file: each airport's run of records, and
    the fixes no airport owns (measured at about 1.5 s)."""
    index = _Index(path)
    offset = 0
    with path.open("rb") as f:
        for raw in f:
            length = len(raw)
            if raw[:1] == b"S":
                rec = raw.decode("latin-1")
                section = rec[4:6]
                if section[0] == "P":
                    ident = _col(rec, 7, 10).strip()
                    start, size = index.airports.get(ident, (offset, 0))
                    index.airports[ident] = (start, offset + length - start)
                elif section in ("EA", "D ", "DB") and _continuation(rec, 22) and (place := _navaid_place(rec)):
                    ident = _col(rec, 14, 18).strip()
                    index.fixes.setdefault(ident, []).append((_col(rec, 20, 21), section, place))
            offset += length
    return index


def _continuation(rec: str, column: int) -> bool:
    """A primary record (continuation number 0 or 1), not a continuation."""
    return _col(rec, column, column) in ("0", "1")


def _navaid_place(rec: str) -> tuple[float, float] | None:
    """A navaid's place: its VOR's (or NDB's), or a DME's alone where
    there is no VOR (columns 56-64 and 65-74, ARINC 424-18 4.1.2.1)."""
    place = _position(rec)
    if place:
        return place
    lat, lon = _angle(_col(rec, 56, 64), 2), _angle(_col(rec, 65, 74), 3)
    return None if lat is None or lon is None else (lat, lon)


def _records(ident: str, path: Path) -> tuple[str, list[str]] | None:
    """An airport's run of records, by its ident as the planner has it
    (KBUR) or the FAA's own (BUR, 1C5): the CIFP names a field by its ICAO
    ident, and by the FAA's where it has none (the Readme)."""
    index = _index(path)
    ident = ident.strip().upper()
    for name in (ident, ident[1:] if len(ident) == 4 and ident.startswith("K") else f"K{ident}"):
        if name in index.airports:
            start, size = index.airports[name]
            with path.open("rb") as f:
                f.seek(start)
                return name, f.read(size).decode("latin-1").splitlines()
    return None


@dataclass
class _Airport:
    """An airport's own records: its place and variation, its terminal
    waypoints, NDBs and runways, and its procedures' legs."""
    ident: str
    place: tuple[float, float] | None
    variation: float
    waypoints: dict[str, tuple[float, float]]
    runways: dict[str, tuple[float, float]]
    legs: dict[tuple[str, str], list[Leg]]


@lru_cache(maxsize=64)
def _airport(ident: str, path: Path) -> _Airport | None:
    found = _records(ident, path)
    if not found:
        return None
    name, records = found
    airport = _Airport(name, None, 0.0, {}, {}, {})
    for rec in records:
        sub = _col(rec, 13, 13)
        if sub == "A" and _continuation(rec, 22):
            airport.place = _position(rec)
            airport.variation = _variation(_col(rec, 52, 56)) or 0.0
        elif sub in ("C", "N") and _continuation(rec, 22) and (place := _position(rec)):
            airport.waypoints[_col(rec, 14, 18).strip()] = place
        elif sub == "G" and _continuation(rec, 22) and (place := _position(rec)):
            airport.runways[_col(rec, 14, 18).strip()] = place
        elif sub in KINDS and _continuation(rec, 39):
            airport.legs.setdefault((sub, _col(rec, 14, 19).strip()), []).append(Leg.read(rec))
    return airport


def _fix_place(airport: _Airport, ident: str, icao: str, section: str, index: _Index) -> tuple[float, float] | None:
    """Where a leg's fix is: the airport's own terminal waypoint, NDB or
    runway threshold, else the enroute waypoint or navaid of that name in
    that ICAO region."""
    if not ident:
        return None
    if section in ("PC", "PN") and ident in airport.waypoints:
        return airport.waypoints[ident]
    if section == "PG" and ident in airport.runways:
        return airport.runways[ident]
    named = index.fixes.get(ident, [])
    for want in (lambda f: f[0] == icao and f[1] == section, lambda f: f[0] == icao, lambda f: True):
        for found in named:
            if want(found):
                return found[2]
    return airport.waypoints.get(ident) or airport.runways.get(ident)


# --- what a procedure is called ---------------------------------------------

def procedure_name(kind: str, ident: str) -> str:
    """A procedure's name as its chart is titled: "I08-Y" is "ILS Y RWY
    08", "VDM-A" "VOR/DME-A"; an arrival or departure is its own
    ("JANNY5")."""
    if kind != "approach":
        return ident
    straight = re.fullmatch(r"([A-Z])(\d\d[LRC]?)-?([A-Z])?", ident)
    if straight and straight.group(1) in APPROACH_TYPES:
        kind_, runway, letter = straight.groups()
        return f"{APPROACH_TYPES[kind_]}{f' {letter}' if letter else ''} RWY {runway}"
    circling = re.fullmatch(r"([A-Z]{3})-?([A-Z])", ident)
    if circling and circling.group(1) in CIRCLING_TYPES:
        return f"{CIRCLING_TYPES[circling.group(1)]}-{circling.group(2)}"
    return ident


def _runway_of(kind: str, ident: str) -> str | None:
    straight = re.fullmatch(r"[A-Z](\d\d[LRC]?)-?[A-Z]?", ident)
    return straight.group(1) if kind == "approach" and straight else None


def _transition_role(kind: str, leg: Leg) -> str:
    """Which part of its procedure a run of legs is: an approach's
    transition (route type "A") or its final; an arrival's or departure's
    runway transition ("RW08", "RW26B", "ALL"), its common route (no
    name), or an enroute transition (the rest)."""
    if kind == "approach":
        return "transition" if leg.route == "A" else "final"
    name = leg.transition
    if not name:
        return "common"
    return "runway" if name.startswith("RW") or name == "ALL" else "transition"


def procedures_at(ident: str, on: date | None = None) -> dict | None:
    """The airport's procedures, for the planner's list: each one's kind,
    identifier, name, runway (an approach's) and the transitions a pilot
    picks from -- an approach's, an arrival's or departure's enroute ones.
    None where the CIFP has no such airport."""
    path = cifp_path(on)
    airport = _airport(ident, path)
    if airport is None:
        return None
    found = []
    for (sub, proc), legs in airport.legs.items():
        kind = KINDS[sub]
        transitions = sorted({leg.transition for leg in legs if leg.transition and _transition_role(kind, leg) == "transition"})
        runways = sorted({leg.transition for leg in legs if _transition_role(kind, leg) == "runway"})
        found.append({
            "kind": kind, "id": proc, "name": procedure_name(kind, proc), "runway": _runway_of(kind, proc),
            "transitions": transitions, "runway_transitions": runways,
        })
    order = {"approach": 0, "arrival": 1, "departure": 2}
    found.sort(key=lambda p: (order[p["kind"]], p["runway"] or "", p["name"]))
    return {"airport": airport.ident, "cycle": f"{cifp_start(on):%y%m%d}", "procedures": found}


# --- drawing it -------------------------------------------------------------

def _arc(center: tuple[float, float], start: tuple[float, float], end: tuple[float, float], turn: str) -> list:
    """Points along an arc round `center` from `start` to `end`, turning
    right (clockwise) or left, a point every five degrees."""
    radius = geo.distance_nm(*center, *end)
    a = geo.bearing_deg(*center, *start)
    b = geo.bearing_deg(*center, *end)
    sweep = (b - a) % 360 if turn == "R" else -((a - b) % 360)
    steps = max(2, int(abs(sweep) / 5) + 1)
    return [geo.destination_point(*center, (a + sweep * i / steps) % 360, radius) for i in range(1, steps + 1)]


def _hold(fix: tuple[float, float], inbound: float, turn: str, leg_nm: float) -> list:
    """A holding pattern's racetrack at `fix`, its inbound leg on the
    true course `inbound` ending at the fix and its turns to the right or
    the left (AIM 5-3-8): the fix, the turn out, the outbound leg, the
    turn in, and back to the fix."""
    side = 90 if turn != "L" else -90
    sweep = 180 if side > 0 else -180
    r = HOLD_TURN_NM
    entry = geo.destination_point(*fix, (inbound + 180) % 360, leg_nm)
    first = geo.destination_point(*fix, (inbound + side) % 360, r)
    second = geo.destination_point(*entry, (inbound + side) % 360, r)
    out_start = geo.destination_point(*fix, (inbound + side) % 360, 2 * r)
    out_end = geo.destination_point(*out_start, (inbound + 180) % 360, leg_nm)
    turn_out = [geo.destination_point(*first, (inbound - side + sweep * i / 36) % 360, r) for i in range(37)]
    turn_in = [geo.destination_point(*second, (inbound + side + sweep * i / 36) % 360, r) for i in range(37)]
    return [fix, *turn_out, out_start, out_end, *turn_in, entry, fix]


def _course(leg: Leg, variation: float) -> float | None:
    """A leg's course or heading, true."""
    if leg.course is None:
        return None
    return leg.course % 360 if leg.course_true else (leg.course + variation) % 360


def _opposite_end(runway: str) -> str:
    """The far end of a runway, where a departure from it leaves the
    ground: RW08's is RW26, RW17L's RW35R."""
    m = re.fullmatch(r"RW(\d\d)([LRC]?)B?", runway)
    if not m:
        return runway
    number = (int(m.group(1)) + 18 - 1) % 36 + 1
    side = {"L": "R", "R": "L"}.get(m.group(2), m.group(2))
    return f"RW{number:02d}{side}"


def procedure_drawing(ident: str, procedure: str, transition: str | None = None, on: date | None = None) -> dict | None:
    """One procedure drawn, with the transition picked: its lines, its
    holds and its fixes, each fix with its role and the altitudes and
    speed it is crossed at. An approach is its transition, then its final
    to the missed approach point, then the missed approach (`missed`); an
    arrival its enroute transition, its common route and every runway
    transition; a departure every runway transition, its common route and
    its enroute transition. None where there is no such procedure."""
    path = cifp_path(on)
    airport = _airport(ident, path)
    if airport is None:
        return None
    found = next(((sub, legs) for (sub, proc), legs in airport.legs.items() if proc == procedure.upper()), None)
    if found is None:
        return None
    sub, legs = found
    kind = KINDS[sub]
    index = _index(path)
    runs: dict[tuple[str, str], list[Leg]] = {}
    for leg in sorted(legs, key=lambda leg: (leg.route, leg.transition, leg.seq)):
        runs.setdefault((leg.route, leg.transition), []).append(leg)
    roles = {key: _transition_role(kind, run[0]) for key, run in runs.items()}
    wanted = (transition or "").upper()
    order = {"approach": ("transition", "final"), "arrival": ("transition", "common", "runway"),
             "departure": ("runway", "common", "transition")}[kind]
    chosen = [key for role in order for key, r in roles.items() if r == role and (r != "transition" or key[1] == wanted)]

    lines, holds, fixes = [], [], {}
    for key in chosen:
        role = roles[key]
        missed = False
        points: list = []

        def flush() -> None:
            if len(points) > 1:
                lines.append({"role": "missed" if missed else role, "name": key[1] or None, "points": list(points)})

        # A departure's runway transition leaves from its runway's far end.
        pos = None
        if kind == "departure" and role == "runway":
            pos = airport.runways.get(_opposite_end(key[1])) or airport.runways.get(key[1]) or airport.place
        for leg in runs[key]:
            place = _fix_place(airport, leg.fix, leg.fix_icao, leg.fix_section, index)
            course = _course(leg, airport.variation)
            if leg.path == "IF" and place:
                flush()
                points = [place]
            elif leg.path in TO_FIX and place:
                start = points[-1] if points else pos
                if not points:
                    points = [start] if start else []
                if leg.path in ("RF", "AF") and start:
                    # Round the arc's centre fix (RF), or the DME's navaid (AF).
                    rf = leg.path == "RF"
                    center = _fix_place(
                        airport, leg.center if rf else leg.navaid, leg.center_icao if rf else "", leg.center_section if rf else "", index,
                    )
                    points.extend(_arc(center, start, place, leg.turn) if center else [place])
                else:
                    points.append(place)
            elif leg.path in HOLDS and place and course is not None:
                minutes = leg.minutes if leg.minutes is not None else (None if leg.distance_nm else 1.0)
                holds.append({
                    "fix": leg.fix, "turn": leg.turn or "R", "inbound_deg": round(course), "missed": missed,
                    "points": _hold(place, course, leg.turn, HOLD_SPEED_KT * minutes / 60 if minutes is not None else leg.distance_nm),
                })
                if not points:
                    points = [place]
            elif leg.path in FROM_FIX and place and course is not None:
                if not points or points[-1] != place:
                    points.append(place)
                length = leg.distance_nm if leg.path == "FC" and leg.distance_nm else OPEN_LEG_NM
                points.append(geo.destination_point(*place, course, length))
            elif leg.path in OPEN and course is not None and (points or pos):
                start = points[-1] if points else pos
                if not points:
                    points = [start]
                points.append(geo.destination_point(*start, course, OPEN_LEG_NM))
            pos = points[-1] if points else (place or pos)
            if place and leg.fix:
                _note_fix(fixes, leg, place, missed)
            if kind == "approach" and leg.missed_approach_point:
                # The rest is the missed approach, drawn dashed from here.
                flush()
                missed = True
                points = points[-1:]
        flush()

    return {
        "airport": airport.ident, "kind": kind, "id": procedure.upper(), "name": procedure_name(kind, procedure.upper()),
        "transition": wanted or None, "cycle": f"{cifp_start(on):%y%m%d}",
        "lines": [{**ln, "points": [[round(p[0], 6), round(p[1], 6)] for p in ln["points"]]} for ln in lines],
        "holds": [{**h, "points": [[round(p[0], 6), round(p[1], 6)] for p in h["points"]]} for h in holds],
        "fixes": list(fixes.values()),
    }


def _note_fix(fixes: dict, leg: Leg, place: tuple[float, float], missed: bool) -> None:
    """A fix of the drawing, once however often it is crossed: its roles,
    and the limits it is crossed at last -- a transition's fix where the
    final starts is labelled with the final's -- and its speed limit."""
    low, high = altitude_limits(leg)
    at = fixes.setdefault(leg.fix, {
        "ident": leg.fix, "lat": round(place[0], 6), "lon": round(place[1], 6), "roles": [],
        "min_ft": None, "max_ft": None, "speed_kt": None, "missed": missed,
    })
    for role in _fix_roles(leg):
        if role not in at["roles"]:
            at["roles"].append(role)
    # Not at the missed approach point: its coded altitude is the
    # threshold's crossing height or the minimums', which the chart gives
    # in its minimums, not at the fix.
    if (low is not None or high is not None) and not leg.missed_approach_point:
        at["min_ft"], at["max_ft"] = low, high
    if leg.speed_kt:
        at["speed_kt"] = leg.speed_kt
    at["missed"] = at["missed"] and missed


def _fix_roles(leg: Leg) -> list[str]:
    """What a fix is on its approach, by its waypoint description's
    fourth character (ARINC 424-18 5.17): an initial approach fix, an
    intermediate fix, the final approach fix, the missed approach point;
    and a hold where its leg holds."""
    roles = {"A": ["IAF"], "B": ["IF"], "C": ["IAF"], "D": ["IAF"], "I": ["IF"], "F": ["FAF"], "M": ["MAP"]}.get(leg.description[3:4], [])
    return [*roles, "hold"] if leg.path in HOLDS else roles
