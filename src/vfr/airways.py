"""The airways a route under IFR may fly -- Victor airways (V100) between
VORs, and RNAV T routes (T254) -- from the FAA's NASR (AWY_SEG_ALT.csv):
each airway's points in order, and each segment's published altitudes,
which 14 CFR 91.177(a)(1) makes the minimum IFR altitude along it.

- The MEA, the minimum en route altitude: obstacle clearance and the
  navigation signal both. Some segments publish one for each direction
  ("NE BND" and "SW BND"): the one for the way flown is taken.
- The GNSS MEA, where a segment publishes one: the MEA for a GPS-equipped
  airplane; taken only where no MEA is (a T route's).
- The MOCA, the minimum obstruction clearance altitude: legal below the
  MEA within 22 nm of the VOR (91.177(a)(1)). Said, not flown: the planner
  keeps to the MEA.
- The MAA, the maximum authorized altitude: none of the airway above it.

A segment with a gap in the airway, or marked unusable, is refused.

The table is read once, on first use, and held: twenty thousand rows."""
from __future__ import annotations

import csv
import re
import threading
from dataclasses import dataclass
from pathlib import Path

from . import faa_data, fixes, geo
from .config import DATA_DIR

FAA_CACHE_DIR = DATA_DIR / "raw" / "faa_nasr"

#: An airway as a pilot writes one in a route: a Victor airway, a T, J or
#: Q route, the letters NASR files them by with the number.
AIRWAY = re.compile(r"^[VTJQ]\d{1,4}$")

#: "NE BND" and the like: a directional MEA's heading, in degrees.
BOUNDS = {"N": 0, "NE": 45, "E": 90, "SE": 135, "S": 180, "SW": 225, "W": 270, "NW": 315}


class AirwayError(ValueError):
    """A route's airway that cannot be flown as written, in a pilot's words."""


@dataclass(frozen=True)
class Segment:
    """One airway segment as flown, from one point to the next: its MEA
    for the way flown, and what else is published for it."""

    airway: str
    from_ident: str
    to_ident: str
    mea_ft: float | None
    gnss_mea_ft: float | None
    moca_ft: float | None
    maa_ft: float | None


@dataclass(frozen=True)
class _Row:
    from_ident: str
    to_ident: str
    mea_ft: float | None
    mea_bound: str
    mea_opposite_ft: float | None
    mea_opposite_bound: str
    gnss_mea_ft: float | None
    gnss_mea_opposite_ft: float | None
    moca_ft: float | None
    maa_ft: float | None
    unusable: bool


_TABLE: dict[str, list[_Row]] | None = None
_LOCK = threading.Lock()


def _feet(text: str | None) -> float | None:
    try:
        return float(text) if text and text.strip() else None
    except ValueError:
        return None


def _bound(text: str | None) -> str:
    """"NE BND" as "NE"; "" where the MEA is for both ways."""
    return (text or "").replace("BND", "").strip().upper()


def _read(path: Path) -> dict[str, list[_Row]]:
    """The contiguous United States', Alaska's and Hawaii's airways, each
    its segments in NASR's order (POINT_SEQ)."""
    table: dict[str, list[tuple[int, _Row]]] = {}
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            ident = (row.get("AWY_ID") or "").strip().upper()
            to = (row.get("TO_POINT") or "").strip().upper()
            if not ident or not to:
                continue
            try:
                seq = int(row.get("POINT_SEQ") or 0)
            except ValueError:
                continue
            table.setdefault(ident, []).append((seq, _Row(
                from_ident=(row.get("FROM_POINT") or "").strip().upper(), to_ident=to,
                mea_ft=_feet(row.get("MIN_ENROUTE_ALT")), mea_bound=_bound(row.get("MIN_ENROUTE_ALT_DIR")),
                mea_opposite_ft=_feet(row.get("MIN_ENROUTE_ALT_OPPOSITE")),
                mea_opposite_bound=_bound(row.get("MIN_ENROUTE_ALT_OPPOSITE_DIR")),
                gnss_mea_ft=_feet(row.get("GPS_MIN_ENROUTE_ALT")),
                gnss_mea_opposite_ft=_feet(row.get("GPS_MIN_ENROUTE_ALT_OPPOSITE")),
                moca_ft=_feet(row.get("MIN_OBSTN_CLNC_ALT")), maa_ft=_feet(row.get("MAX_AUTH_ALT")),
                unusable=(row.get("MEA_GAP") or "").strip() == "U" or (row.get("AWY_SEG_GAP_FLAG") or "").strip() == "Y",
            )))
    return {ident: [r for _, r in sorted(rows, key=lambda pair: pair[0])] for ident, rows in table.items()}


def _airways() -> dict[str, list[_Row]]:
    global _TABLE
    if _TABLE is None:
        with _LOCK:
            if _TABLE is None:
                _TABLE = _read(faa_data.ensure_nasr_file("AWY_SEG_ALT.csv", FAA_CACHE_DIR))
    return _TABLE


def is_airway(token: str) -> bool:
    """Whether a route's token is an airway ("V100", "T254") rather than a
    place: by its form, and that NASR has it."""
    token = token.strip().upper()
    return bool(AIRWAY.match(token)) and token in _airways()


def _where(ident: str, near: tuple = ()) -> tuple[float, float] | None:
    navaid = fixes.find_navaid(ident, near)
    if navaid is not None:
        return navaid["lat"], navaid["lon"]
    fix = fixes.find_fix(ident)
    return (fix["lat"], fix["lon"]) if fix else None


def _for_the_way(bearing: float, ft: float | None, bound: str, opposite_ft: float | None, opposite_bound: str) -> float | None:
    """A directional pair's figure for a course of `bearing` (true): the
    one whose bound is nearer it -- "NE BND" for a course of 040 --
    the higher where neither says (a pair with a bound missing)."""
    if not bound or not opposite_bound or bound not in BOUNDS or opposite_bound not in BOUNDS:
        return max((v for v in (ft, opposite_ft) if v is not None), default=None)

    off_bound = geo.angle_between(bearing, BOUNDS[bound])
    return ft if off_bound <= geo.angle_between(bearing, BOUNDS[opposite_bound]) else opposite_ft


def along(airway: str, from_ident: str, to_ident: str) -> list[Segment]:
    """The airway's segments from one of its points to another, in the
    order flown -- either way along it. An AirwayError where the airway
    is not NASR's, either point is not on it, or a segment between them
    is a gap or unusable."""
    airway, from_ident, to_ident = airway.strip().upper(), from_ident.strip().upper(), to_ident.strip().upper()
    rows = _airways().get(airway)
    if not rows:
        raise AirwayError(f"No airway {airway} is published.")
    points = [rows[0].from_ident] + [r.to_ident for r in rows]
    if from_ident not in points:
        raise AirwayError(f"{from_ident} is not on {airway}: an airway is joined at one of its own fixes.")
    if to_ident not in points:
        raise AirwayError(f"{to_ident} is not on {airway}: an airway is left at one of its own fixes.")
    i, j = points.index(from_ident), points.index(to_ident)
    if i == j:
        raise AirwayError(f"{airway} from {from_ident} to itself goes nowhere.")
    forward = i < j
    flown = rows[i:j] if forward else list(reversed(rows[j:i]))
    out = []
    for row in flown:
        a, b = (row.from_ident, row.to_ident) if forward else (row.to_ident, row.from_ident)
        if row.unusable:
            raise AirwayError(f"{airway} from {a} to {b} is not usable as published.")
        start, end = _where(a), _where(b)
        bearing = geo.bearing_deg(*start, *end) if start and end else None
        if bearing is None:
            mea = max((v for v in (row.mea_ft, row.mea_opposite_ft) if v is not None), default=None)
            gnss = max((v for v in (row.gnss_mea_ft, row.gnss_mea_opposite_ft) if v is not None), default=None)
        else:
            mea = _for_the_way(bearing, row.mea_ft, row.mea_bound, row.mea_opposite_ft, row.mea_opposite_bound)
            gnss = _for_the_way(bearing, row.gnss_mea_ft, row.mea_bound, row.gnss_mea_opposite_ft, row.mea_opposite_bound)
        out.append(Segment(airway, a, b, mea, gnss, row.moca_ft, row.maa_ft))
    return out
