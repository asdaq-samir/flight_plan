"""An airport's traffic pattern as the FAA publishes it: how high it is
flown, and which way round at each runway end.

How high is APT_BASE's TPA where the FAA publishes one, and AC 90-66C's
1,000 ft above the field for a propeller aeroplane where not
(vfr.faa_data.pattern_agl_ft). Which way is NASR's own flag on each
runway end, APT_RWY_END's RIGHT_HAND_TRAFFIC_PAT_FLAG: the "RP 23" the
sectional prints by a field. Every turn is to the left unless the FAA
says right (14 CFR 91.126(b)(1)), so an end not flagged is left traffic;
at a towered field the tower says which.

UGN, Waukegan, for one: runway 23 is right traffic, and 5, 14 and 32
left.
"""
from __future__ import annotations

import csv
import re
import threading
from functools import lru_cache
from pathlib import Path

from . import faa_data
from .config import DATA_DIR
from .magnetic import magnetic_variation_deg
from .runway_wind import end_heading_true_deg

FAA_CACHE_DIR = DATA_DIR / "raw" / "faa_nasr"

_LOCK = threading.Lock()


def end_key(ident: str | None) -> str:
    """A runway end as both tables can be matched on: NASR writes "09"
    where OurAirports may write "9", and either may write "09L"."""
    return re.sub(r"^0+(?=\d)", "", (ident or "").strip().upper())


def faa_ids(ident: str) -> list[str]:
    """The FAA identifiers an airport may go by in NASR, which keys its
    runways by its own (RFD, not KRFD): a K or P ICAO ident's last three
    letters first, then the ident as given."""
    ident = ident.strip().upper()
    return [ident[1:], ident] if len(ident) == 4 and ident[0] in "KP" else [ident]


@lru_cache(maxsize=2)
def _ends_of(path: str, _mtime: float) -> tuple[dict, dict]:
    """Every airport's runway ends flown with right-hand traffic, and
    where each of its ends is (NASR's LAT_DECIMAL and LONG_DECIMAL, the
    threshold's surveyed position, where the FAA has one: three ends in
    five), by its FAA identifier."""
    right: dict[str, set[str]] = {}
    at: dict[str, dict[str, tuple[float, float]]] = {}
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            airport, end = row["ARPT_ID"].strip().upper(), end_key(row["RWY_END_ID"])
            if row["RIGHT_HAND_TRAFFIC_PAT_FLAG"].strip().upper() == "Y":
                right.setdefault(airport, set()).add(end)
            try:
                at.setdefault(airport, {})[end] = (float(row.get("LAT_DECIMAL") or ""), float(row.get("LONG_DECIMAL") or ""))
            except (TypeError, ValueError):
                pass
    return right, at


def _ends(ident: str, cache_dir) -> tuple[set[str], dict]:
    """This airport's ends flown with right traffic and where its ends
    are; none where the file cannot be had -- a card is no reason to
    fail."""
    try:
        with _LOCK:
            path = faa_data.ensure_nasr_file("APT_RWY_END.csv", cache_dir)
            right, at = _ends_of(str(path), Path(path).stat().st_mtime)
    except (OSError, RuntimeError):
        return set(), {}
    for faa_id in faa_ids(ident):
        if faa_id in right or faa_id in at:
            return right.get(faa_id, set()), at.get(faa_id, {})
    return set(), {}


def right_traffic_ends(ident: str, cache_dir=FAA_CACHE_DIR) -> set[str]:
    """The ends of this airport's runways the FAA has flown with right
    traffic (as end_key gives them); none where it has no such flag, and
    none where the file cannot be had -- a card is no reason to fail."""
    return _ends(ident, cache_dir)[0]


def end_positions(ident: str, cache_dir=FAA_CACHE_DIR) -> dict:
    """Where this airport's runway ends are, as end_key gives them, where
    the FAA surveyed them; none where it did not, or the file cannot be
    had."""
    return _ends(ident, cache_dir)[1]


def with_traffic(runways: list, ident: str, lat: float, lon: float, cache_dir=FAA_CACHE_DIR) -> list:
    """vfr.airports.get_runways' runways at a field at (lat, lon), each
    with its `runway_ends`: each end's ident, its true heading
    (vfr.runway_wind; None for a helipad), which way its pattern is flown,
    and where it is -- NASR's surveyed threshold, else OurAirports' (its
    `end_positions`), else None -- for the card's sketch of the field."""
    variation = magnetic_variation_deg(lat, lon)
    right = right_traffic_ends(ident, cache_dir)
    at = end_positions(ident, cache_dir)

    def position(runway: dict, end: str) -> tuple:
        found = at.get(end_key(end)) or (runway.get("end_positions") or {}).get(end)
        return (round(found[0], 6), round(found[1], 6)) if found else (None, None)

    return [
        {**r, "runway_ends": [
            {"ident": end, "heading_true_deg": end_heading_true_deg(end, heading, variation),
             "traffic": "right" if end_key(end) in right else "left",
             **dict(zip(("lat", "lon"), position(r, end)))}
            for end, heading in r.get("end_headings", [])
        ]}
        for r in runways
    ]


def pattern_at(ident: str, elevation_ft: float | None, cache_dir=FAA_CACHE_DIR) -> dict:
    """How high the pattern is flown: `agl_ft` above the field, the FAA's
    own where `published`, else AC 90-66C's 1,000 ft; and `altitude_ft`,
    above sea level, where the field's elevation is known."""
    published = None
    for faa_id in faa_ids(ident):
        published = faa_data.published_pattern_agl_ft(faa_id, cache_dir)
        if published is not None:
            break
    agl = faa_data.PATTERN_AGL_FT if published is None else published
    return {
        "agl_ft": agl,
        "altitude_ft": None if elevation_ft is None else round(elevation_ft + agl),
        "published": published is not None,
    }
