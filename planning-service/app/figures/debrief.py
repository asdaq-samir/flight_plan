"""A flight debriefed from its flown track (the roadmap's debrief, against
ACS PA.VI.A's tolerances): leg by leg the altitude and the course held and
how far off the line it went, each checkpoint's time against its estimate,
and the altitude entering each field's pattern -- worked out by the engine
(wingtip_engine::figures::debrief, through wingtip_native), the one copy the
planner and the phones share. Only the dicts cross here.

web/src/lib/debrief.ts asks the same engine (its WebAssembly, by the
rule's name).
Its checkpoints are the saved flight's (the gateway's FlightCheckpointDto,
as `sequence_no` and so on) and its points the track's (TrackDto: `t` in ms
since 1970, GPS altitude in feet)."""
import json

import wingtip_native

#: PA.VI.A's tolerances (S7's altitude, its heading applied to the ground
#: track, S5's distance off the route, S6's time at each checkpoint) and
#: the pattern's (PA.III.B.S5), the engine's.
_TOLERANCES = json.loads(wingtip_native.debrief_tolerances_json())
ALTITUDE_FT = _TOLERANCES["altitude_ft"]
COURSE_DEG = _TOLERANCES["course_deg"]
OFF_ROUTE_NM = _TOLERANCES["off_route_nm"]
ETA_MIN = _TOLERANCES["eta_min"]
PATTERN_NM = _TOLERANCES["pattern_nm"]
PATTERN_FT = _TOLERANCES["pattern_ft"]


def _track(points: list[dict]) -> list[tuple]:
    return [(p["t"], p["lat"], p["lon"], p.get("alt_ft")) for p in points]


def airborne(points: list[dict]) -> list[list[int]]:
    """The track's flights: each run of points over 40 kt as [first, last]
    indices, a minute's dip kept in and a run of under a minute dropped."""
    return [list(run) for run in wingtip_native.debrief_airborne(_track(points))]


def debrief(checkpoints: list[dict], points: list[dict], patterns: dict[str, float] | None = None) -> dict | None:
    """A flight debriefed against its track (points in time order); None
    where the track never flew. `patterns` are the fields' pattern
    altitudes, ft MSL, by ident."""
    cps = [(c["sequence_no"], c["name"], c["category"], c["lat"], c["lon"], c["along_track_nm"],
            c.get("true_course_deg"), c.get("ete_min"), c.get("altitude_ft")) for c in checkpoints]
    found = wingtip_native.debrief_json(cps, _track(points), list((patterns or {}).items()))
    return None if found is None else json.loads(found)


def marked(d: dict) -> dict:
    """The debrief with each finding's mark as the web's FlightPage gives
    it beside the finding (a leg within both tolerances, a checkpoint
    within ETA_MIN of its estimate, a pattern within PATTERN_FT), so the
    native app shows the marks and states no tolerance of its own."""
    legs_ok, pass_marks, pattern_marks = wingtip_native.debrief_marks(
        [(leg["worst_alt_ft"], leg["worst_off_nm"]) for leg in d["legs"]],
        [(p["category"], p["due_min"], p["passed_min"]) for p in d["passes"]],
        [(e["alt_ft"], e["pattern_ft"]) for e in d["patterns"]],
    )
    legs = [{**leg, "ok": ok} for leg, ok in zip(d["legs"], legs_ok)]
    passes = [{**p, "landed": landed, "late_min": late, "ok": ok} for p, (landed, late, ok) in zip(d["passes"], pass_marks)]
    patterns = [{**e, "off_ft": off, "ok": ok} for e, (off, ok) in zip(d["patterns"], pattern_marks)]
    return {**d, "legs": legs, "passes": passes, "patterns": patterns}
