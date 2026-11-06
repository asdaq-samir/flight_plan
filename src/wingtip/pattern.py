"""An airport's traffic pattern as the FAA publishes it: how high it is
flown, and which way round at each runway end.

How high is APT_BASE's TPA where the FAA publishes one, and AC 90-66C's
1,000 ft above the field for a propeller aeroplane where not
(wingtip.faa_data.pattern_agl_ft). Which way is NASR's own flag on each
runway end, APT_RWY_END's RIGHT_HAND_TRAFFIC_PAT_FLAG: the "RP 23" the
sectional prints by a field. Every turn is to the left unless the FAA
says right (14 CFR 91.126(b)(1)), so an end not flagged is left traffic;
at a towered field the tower says which.

UGN, Waukegan, for one: runway 23 is right traffic, and 5, 14 and 32
left.

The rules -- which way an end is flown, how high, and the pattern's
corners and legs -- are the shared engine's (wingtip_engine::runway, through
wingtip_native.call), the very code the web app's map (lib/trafficPattern,
lib/pattern) and the phones (wt_call) ask; this reads the FAA's files they
are fed from and carries the dicts across.
"""
from __future__ import annotations

import csv
import json
import threading
from pathlib import Path

import wingtip_native

from . import faa_data
from .config import DATA_DIR
from .magnetic import magnetic_variation_deg
from .once import once

FAA_CACHE_DIR = DATA_DIR / "raw" / "faa_nasr"

_LOCK = threading.Lock()


def _ask(name: str, **given):
    """The engine's rule `name` on the input given, its answer parsed."""
    return json.loads(wingtip_native.call(name, json.dumps(given)))


def end_key(ident: str | None) -> str:
    """A runway end as both tables can be matched on: NASR writes "09"
    where OurAirports may write "9", and either may write "09L"."""
    return _ask("runway_end_key", ident=ident)


def faa_ids(ident: str) -> list[str]:
    """The FAA identifiers an airport may go by in NASR, which keys its
    runways by its own (RFD, not KRFD): a K or P ICAO ident's last three
    letters first, then the ident as given."""
    return _ask("faa_ids", ident=ident)


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
    """wingtip.airports.get_runways' runways at a field at (lat, lon), each
    with its `runway_ends`: each end's ident, its true heading
    (wingtip.runway_wind; None for a helipad), which way its pattern is flown,
    and where it is -- NASR's surveyed threshold, else OurAirports' (its
    `end_positions`), else None -- for the card's sketch of the field."""
    variation = magnetic_variation_deg(lat, lon)
    right = sorted(right_traffic_ends(ident, cache_dir))
    at = end_positions(ident, cache_dir)

    def position(runway: dict, end: dict) -> tuple:
        found = at.get(end_key(end["ident"])) or (runway.get("end_positions") or {}).get(end["ident"])
        return (round(found[0], 6), round(found[1], 6)) if found else (None, None)

    out = []
    for r in runways:
        headings = [[end, None if heading is None or heading != heading else heading] for end, heading in r.get("end_headings", [])]
        ends = _ask("runway_ends_traffic", end_headings=headings, variation_deg=variation, right=right)
        out.append({**r, "runway_ends": [{**e, **dict(zip(("lat", "lon"), position(r, e)))} for e in ends]})
    return out


def pattern_at(ident: str, elevation_ft: float | None, cache_dir=FAA_CACHE_DIR) -> dict:
    """How high the pattern is flown: `agl_ft` above the field, the FAA's
    own where `published`, else AC 90-66C's 1,000 ft; and `altitude_ft`,
    above sea level, where the field's elevation is known."""
    published = None
    for faa_id in faa_ids(ident):
        published = faa_data.published_pattern_agl_ft(faa_id, cache_dir)
        if published is not None:
            break
    return _ask("pattern_altitude", elevation_ft=elevation_ft, published_agl_ft=published)


def _circuit_runway(runway: dict) -> dict:
    """A runway as the engine draws its pattern: its length and its ends."""
    return {"length_ft": runway.get("length_ft"), "runway_ends": [
        {k: e.get(k) for k in ("ident", "heading_true_deg", "traffic", "lat", "lon")} for e in runway.get("runway_ends") or []]}


def _points(points: list) -> list:
    return [tuple(p) for p in points]


def arrival_circuit(runway: dict, end_ident: str, tpa_ft: float | None, field_ft: float | None) -> dict | None:
    """The pattern flown to land on `end_ident`, as a piece of a leg
    (wingtip.procedure_paths.flown): in at 45° to the downwind abeam midfield
    (AIM 4-3-3, AC 90-66C 11.3), along the downwind at the pattern's
    altitude, then base and final down to the threshold -- the corners the
    map draws (web lib/trafficPattern). The heights are the pattern
    altitude on the entry and the downwind, the field's at the threshold
    (None where either is not known). None where the end cannot be drawn:
    its threshold or heading not known."""
    flown = _ask("arrival_circuit", runway=_circuit_runway(runway), end_ident=end_ident)
    if flown is None:
        return None
    return {"points": _points(flown["points"]), "ft": [tpa_ft, tpa_ft, tpa_ft, None, field_ft], "holds": []}


def departure_circuit(runway: dict, end_ident: str, toward: tuple) -> dict | None:
    """The way out of a field leaving from `end_ident`, as a piece of a
    leg (wingtip.procedure_paths.flown): the takeoff along the runway and the
    upwind past its end, then out of the pattern straight on or with a 45°
    turn to the pattern's side, the two AIM 4-3-3 gives, whichever is the
    nearer the way on to `toward`. None where the end cannot be drawn."""
    flown = _ask("departure_circuit", runway=_circuit_runway(runway), end_ident=end_ident, toward=list(toward))
    if flown is None:
        return None
    points = _points(flown["points"])
    return {"points": points, "ft": [None] * len(points), "holds": [], "exit_deg": round(flown["exit_deg"], 1)}
