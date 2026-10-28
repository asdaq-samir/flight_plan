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
from pathlib import Path

from . import faa_data, geo
from .config import DATA_DIR
from .magnetic import magnetic_variation_deg
from .runway_wind import end_heading_true_deg
from .once import once

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


@once(maxsize=2)
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


#: The downwind's distance out from the runway, three-quarters of a
#: statute mile in nm: the middle of the Airplane Flying Handbook's "1/2
#: to 1 mile" (FAA-H-8083-3, "Airport Traffic Patterns"), as the map draws
#: it (web lib/trafficPattern's DOWNWIND_NM).
CIRCUIT_DOWNWIND_NM = 0.75 * 0.868976
#: How far out the 45° entry starts, and the departure's exit runs, from
#: the downwind or the upwind's end, nm: the map's ENTRY_NM.
CIRCUIT_ENTRY_NM = 1.2


def _turn(frm: float, to: float) -> float:
    """The signed turn from one bearing to another, -180 to 180."""
    return ((to - frm) % 360 + 540) % 360 - 180


def _circuit_corners(runway: dict, end_ident: str) -> dict | None:
    """The corners of the pattern for landing on (or leaving from)
    `end_ident` of a runway as with_traffic gives it, as the map draws
    them (web lib/trafficPattern): the threshold, the far end, where the
    upwind ends, the downwind abeam midfield and abeam the final's start,
    and the final's start; and the pattern's side. None where the end's
    threshold or heading is not known."""
    ends = runway.get("runway_ends") or []
    key = end_key(end_ident)
    end = next((e for e in ends if end_key(e.get("ident")) == key), None)
    if not end or end.get("lat") is None or end.get("lon") is None or end.get("heading_true_deg") is None:
        return None
    threshold = (end["lat"], end["lon"])
    other = next((e for e in ends if e is not end and e.get("lat") is not None and e.get("lon") is not None), None)
    if other:
        far = (other["lat"], other["lon"])
        along = float(geo.bearing_deg(*threshold, *far))
    elif runway.get("length_ft"):
        along = float(end["heading_true_deg"])
        far = geo.destination_point(*threshold, along, runway["length_ft"] / 6076.12)
    else:
        return None
    back = (along + 180) % 360
    # Every turn to the left unless the FAA says right (14 CFR
    # 91.126(b)(1)): the downwind on that side of the runway.
    side = (along + (90 if end.get("traffic") == "right" else -90)) % 360
    out = CIRCUIT_DOWNWIND_NM
    final_start = geo.destination_point(*threshold, back, out)
    upwind_end = geo.destination_point(*far, along, out)
    length = float(geo.distance_nm(*threshold, *far))
    midfield = geo.destination_point(*geo.destination_point(*threshold, along, length / 2), side, out)
    return {
        "threshold": threshold, "far": far, "upwind_end": upwind_end,
        "midfield": midfield, "downwind_end": geo.destination_point(*final_start, side, out),
        "final_start": final_start, "along": along, "side": side,
    }


def arrival_circuit(runway: dict, end_ident: str, tpa_ft: float | None, field_ft: float | None) -> dict | None:
    """The pattern flown to land on `end_ident`, as a piece of a leg
    (vfr.procedure_paths.flown): in at 45° to the downwind abeam midfield
    (AIM 4-3-3, AC 90-66C 11.3), along the downwind at the pattern's
    altitude, then base and final down to the threshold. The heights are
    the pattern altitude on the entry and the downwind, the field's at
    the threshold (None where either is not known). None where the end
    cannot be drawn."""
    c = _circuit_corners(runway, end_ident)
    if c is None:
        return None
    # From out on the pattern's side, behind the downwind's direction: the
    # bisector of the landing direction and the pattern's side.
    entry = geo.destination_point(*c["midfield"], (c["along"] + _turn(c["along"], c["side"]) / 2) % 360, CIRCUIT_ENTRY_NM)
    points = [entry, c["midfield"], c["downwind_end"], c["final_start"], c["threshold"]]
    return {"points": points, "ft": [tpa_ft, tpa_ft, tpa_ft, None, field_ft], "holds": []}


def departure_circuit(runway: dict, end_ident: str, toward: tuple) -> dict | None:
    """The way out of a field leaving from `end_ident`, as a piece of a
    leg (vfr.procedure_paths.flown): the takeoff along the runway and the
    upwind past its end, then out of the pattern straight on or with a 45°
    turn to the pattern's side, the two AIM 4-3-3 gives, whichever is the
    nearer the way on to `toward`. None where the end cannot be drawn."""
    c = _circuit_corners(runway, end_ident)
    if c is None:
        return None
    on = float(geo.bearing_deg(*c["upwind_end"], *toward))
    exits = [c["along"], (c["along"] + _turn(c["along"], c["side"]) / 2) % 360]
    out = min(exits, key=lambda b: abs(_turn(b, on)))
    exit_at = geo.destination_point(*c["upwind_end"], out, CIRCUIT_ENTRY_NM)
    points = [c["threshold"], c["far"], c["upwind_end"], exit_at]
    return {"points": points, "ft": [None] * len(points), "holds": [], "exit_deg": round(out, 1)}
