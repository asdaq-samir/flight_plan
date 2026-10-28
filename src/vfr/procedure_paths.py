"""The way an airplane flies the instrument procedures picked for a route
-- out of a field by its departure (SID), into one by its arrival (STAR)
and its approach -- from their drawings (vfr.procedures.procedure_drawing):
the path flown, the altitude its chart sets at each point where it sets
one, and its missed approach. The planner lengthens a leg flown this way
by the path's extra miles, its time and fuel with them, so the plan's
figures are those of the flight a pilot flies (14 CFR 91.151 and 91.167
count the fuel to the field by the route flown); the web app's dry run
flies the same path (dryRun.ts).

A sketch, as the drawings are: a course reversal is a teardrop where the
chart puts no hold, and an approach from vectors is joined as a controller
turns an airplane onto it.
"""
from __future__ import annotations

import math

from . import geo
from . import holds as vfr_holds

#: How near two points of a drawing are to be one place, nm: a fix where
#: a transition ends and the same fix on the final, both rounded to six
#: decimals of a degree (vfr.procedures).
SAME_PLACE_NM = 0.05

#: Where vectors bring an airplane onto an approach's final: this far out
#: from the final's first fix, nm, on a heading 30° off its course -- the
#: most a controller turns one onto it, outside the approach gate (FAA
#: Order JO 7110.65, 5-9-2).
INTERCEPT_NM = 3.0
#: How far to the side of the final a downwind to it is flown, nm.
DOWNWIND_NM = 4.0
#: How far a path turns at a point to be a course reversal there, degrees.
REVERSAL_DEG = 120.0
#: How far a path turns at a fix the chart puts a course reversal at -- a
#: hold in lieu of a procedure turn, or a procedure turn -- for it to be
#: flown, degrees: come to from the far side, more than 90° off the course
#: it leaves the fix on. From the near side a pilot is lined up already, as
#: a TAA's straight-in area and a feeder marked NoPT are, and makes none
#: (AIM 5-4-5, 5-4-9; 14 CFR 91.175(j)).
CODED_REVERSAL_DEG = 90.0
#: A standard-rate turn's radius in a hold's entry, nm: at the 120 knots
#: the chart's holds are drawn at (vfr.procedures.HOLD_TURN_NM).
ENTRY_TURN_NM = 120 * (120 / 3600) / (2 * math.pi)


def _nm(a: tuple, b: tuple) -> float:
    return float(geo.distance_nm(a[0], a[1], b[0], b[1]))


def _bearing(a: tuple, b: tuple) -> float:
    return float(geo.bearing_deg(a[0], a[1], b[0], b[1]))


def _toward(a: tuple, bearing: float, nm: float) -> tuple:
    return geo.destination_point(a[0], a[1], bearing % 360, nm)


def length_nm(path: list) -> float:
    """The length of a path of (lat, lon) points, nm."""
    return sum(_nm(a, b) for a, b in zip(path, path[1:]))


def joined_lines(lines: list) -> list:
    """Lines of a procedure, in the order given, as one path: each joined
    where it passes the last one's end -- the final from where its
    transition ends on it -- not back out at its own first point."""
    points: list = []
    for line in lines:
        part = [tuple(p) for p in line]
        if points:
            joined = next((i for i, p in enumerate(part) if _nm(p, points[-1]) < SAME_PLACE_NM), None)
            part = part[joined + 1:] if joined is not None else part
        points.extend(part)
    return points


def _crossings(drawing: dict, points: list) -> dict | None:
    """A procedure's path with each point's crossing altitude, where its
    chart sets one -- the lower of a window -- and none at the missed
    approach point, whose coded altitude is not one to cross it at
    (vfr.procedures leaves it out); and its holds, the missed approach's
    left out."""
    if len(points) < 2:
        return None
    crossed = [f for f in drawing.get("fixes", []) if not f["missed"]]

    def ft(p):
        fix = next((f for f in crossed if _nm((f["lat"], f["lon"]), p) < SAME_PLACE_NM), None)
        return None if fix is None else fix["min_ft"] if fix["min_ft"] is not None else fix["max_ft"]

    holds = [h for h in drawing.get("holds", []) if not h["missed"]]
    return {"points": points, "ft": [ft(p) for p in points], "holds": holds}


def _of(drawing: dict, *roles: str) -> list:
    return [ln["points"] for role in roles for ln in drawing.get("lines", []) if ln["role"] == role]


def approach_path(drawing: dict) -> dict | None:
    """An approach as it is flown: its transition, then its final to the
    missed approach point -- not the missed approach -- the final joined
    where the transition ends on it (Duluth's ILS RWY 27 via DLH ends at
    ANDOE, the final's second fix, and would have gone back out to WIRSA,
    the final's first, before turning in). None where nothing is drawn."""
    path = _crossings(drawing, joined_lines([ln["points"] for ln in drawing.get("lines", []) if ln["role"] in ("transition", "final")]))
    # A transition that is its fix alone -- a procedure turn at a VOR on
    # the final, Duluth's VOR RWY 3 via DLH -- is flown from that fix, its
    # reversal round it: not from the final's first fix, out past the VOR
    # and back in a hairpin (the audit of 2026-10-21).
    if path and not _of(drawing, "transition") and drawing.get("transition"):
        path = _direct(path, {**drawing, "direct": drawing["transition"]})
    # On from a missed approach point short of the runway to its threshold,
    # where the airplane lands -- a VOR's or a LOC's MAP a mile out, where
    # the dry run touched down (the audit of 2026-10-21). `map_at` keeps
    # where the missed approach is flown from.
    if path:
        path["map_at"] = len(path["points"]) - 1
        end = drawing.get("threshold")
        if end and _nm(tuple(end), path["points"][-1]) >= SAME_PLACE_NM:
            path["points"].append(tuple(end))
            path["ft"].append(None)
    return path


def _runway_line(lines: list, runway: str | None) -> list:
    """Of a departure's runway transitions (their names "RW30R", "RW12B" for
    both 12L and 12R, "ALL"), the one for `runway` ("30R", "12L"); the
    first coded where none is picked or none fits."""
    if runway:
        want = runway.upper().removeprefix("RW")
        number = want.rstrip("LRC")
        for line in lines:
            name = (line.get("name") or "").upper().removeprefix("RW")
            if name == want or (name.endswith("B") and name[:-1] == number):
                return [line["points"]]
    return [lines[0]["points"]] if lines else []


def procedure_path(drawing: dict, toward: tuple | None = None, runway: str | None = None) -> dict | None:
    """An arrival or a departure as it is flown: a departure's runway
    transition, its common route and its enroute transition; an arrival's
    enroute transition and common route, then of its runway transitions
    the one that ends nearest `toward`, the approach's first fix, where
    one is picked. vfr.procedures draws every runway transition of either:
    a departure leaves by the one for the `runway` the pilot leaves from
    (St. Louis's BERYY6 flew its runway 11 transition off runway 30R, out
    the wrong way -- the audit of 2026-10-21), the first coded where none
    is known. None where nothing is drawn."""
    runways = _of(drawing, "runway")
    if drawing["kind"] == "departure":
        lines = [ln for ln in drawing.get("lines", []) if ln["role"] == "runway"]
        return _crossings(drawing, joined_lines(_runway_line(lines, runway) + _of(drawing, "common", "transition")))
    nearest = (min(runways, key=lambda ln: _nm(tuple(ln[-1]), toward))
               if toward is not None and runways else None)
    return _crossings(drawing, joined_lines(_of(drawing, "transition", "common") + ([nearest] if nearest else [])))


def missed_path(drawing: dict, start: tuple) -> dict | None:
    """An approach's missed approach as it is flown: from the missed
    approach point (`start`, where its final ends) along the missed
    approach, and round its hold once -- the racetrack from its fix and
    back to it -- where it ends at one (AIM 5-4-21: the published missed
    approach, flown at the missed approach point). With the altitude to
    climb to: the highest its fixes set, the hold's as a rule. None where
    the approach draws none."""
    path = joined_lines(_of(drawing, "missed"))
    at = next((i for i, p in enumerate(path) if _nm(p, start) < SAME_PLACE_NM), None)
    points = path[at + 1:] if at is not None else path
    hold = next(([tuple(p) for p in h["points"]] for h in drawing.get("holds", []) if h["missed"]), None)
    if hold and len(hold) > 2 and points and _nm(hold[0], points[-1]) < SAME_PLACE_NM:
        points = points + hold[1:]
    if not points:
        return None
    tops = [f["min_ft"] if f["min_ft"] is not None else f["max_ft"] for f in drawing.get("fixes", []) if f["missed"]]
    tops = [ft for ft in tops if ft is not None]
    return {"points": points, "ft": max(tops) if tops else None}


def vectors_join(final: list, start: tuple) -> list:
    """The way an approach flown from vectors (no transition picked) is
    joined, as a controller vectors an airplane onto it: from outside the
    final's first fix, straight to a point three miles back from it on the
    side the airplane comes from, 30° off the final's course, and onto the
    final there; from inside it -- the field between the airplane and the
    final's start -- first out to that side, then a downwind four miles
    off the final (or as far as the airplane already is, up to eight) to
    abeam its first fix and three miles on, and a base to that point.
    Empty where the final is too short to say which way it runs."""
    if len(final) < 2:
        return []
    first = final[0]
    course = _bearing(first, final[1])
    off = ((_bearing(first, start) - course + 540) % 360) - 180
    distance = _nm(first, start)
    side = 1 if off >= 0 else -1
    join = _toward(first, course + 180 - 30 * side, INTERCEPT_NM)
    # How far ahead of the first fix the airplane is, toward the runway or
    # past it, and how far to the side of the final.
    along = distance * math.cos(math.radians(off))
    if along <= 0:
        return [join]
    aside = min(2 * DOWNWIND_NM, max(DOWNWIND_NM, abs(distance * math.sin(math.radians(off)))))

    def at(along_nm: float) -> tuple:
        return _toward(_toward(first, course, along_nm), course + 90 * side, aside)

    return [at(along), at(0.0), at(-INTERCEPT_NM), join]


def _teardrop(fix: tuple, cin: float, cout: float) -> list:
    """A teardrop course reversal at `fix`, come to on `cin` and left on
    `cout`: out three miles 30° off `cin`, round past five miles, and in on
    `cout` from a mile and a half out, to the fix -- within the 10 NM of
    the fix a procedure turn is kept to unless the chart says otherwise."""
    out = _toward(fix, cin + 30, 3)
    tip = _toward(fix, cin + 15, 5)
    inbound = _toward(fix, cout + 180, 1.5)
    curve = []
    for k in range(1, 8):
        f = k / 8
        # A quadratic Bezier through the tip, near enough a turn over a few miles.
        curve.append(tuple((1 - f) ** 2 * o + 2 * (1 - f) * f * t + f ** 2 * i for o, t, i in zip(out, tip, inbound)))
    return [out, *curve, inbound, fix]


def _arc_from(p: tuple, heading: float, sweep: float, r: float = ENTRY_TURN_NM) -> list:
    """A turn from `p` on `heading` through `sweep` degrees -- to the right
    where positive -- at radius `r`: its points after `p`."""
    side = 1 if sweep > 0 else -1
    center = _toward(p, heading + 90 * side, r)
    start = heading - 90 * side
    steps = max(2, int(abs(sweep) / 15))
    return [_toward(center, start + sweep * k / steps, r) for k in range(1, steps + 1)]


def _entered(hold: dict, fix: tuple, arrival: float) -> list:
    """A course reversal the chart puts at `fix`, as it is flown from a
    course of `arrival` (true): a procedure turn as it is drawn; a hold in
    lieu of one by its entry (AIM 5-3-8 j.3, vfr.holds.entry) -- teardrop:
    out 30° to the holding side of the outbound course for a leg, and round
    in the hold's direction onto the inbound course; parallel: out on the
    outbound course, and round toward the holding side, more than 180°, to
    come back to the fix 30° off it; direct: once round the racetrack. Each
    ends at the fix inbound. Points after the fix."""
    points = [tuple(q) for q in hold["points"]]
    if hold.get("kind") == "procedure turn" or "inbound_deg" not in hold or not hold.get("leg_nm"):
        return points[1:]
    inbound, leg_nm = float(hold["inbound_deg"]), float(hold["leg_nm"])
    right = hold.get("turn", "R") != "L"
    side = 1 if right else -1
    out = (inbound + 180) % 360
    way = vfr_holds.entry(arrival, inbound, right)
    if way == "teardrop":
        heading = out - 30 * side
        start = _toward(fix, heading, leg_nm)
        sweep = side * (((inbound - heading) * side) % 360)
        return [start, *_arc_from(start, heading, sweep), fix]
    if way == "parallel":
        start = _toward(fix, out, leg_nm)
        return [start, *_arc_from(start, out, -side * 210), fix]
    return points[1:]


def with_reversals(path: list, ft: list, holds: list) -> tuple[list, list]:
    """Where the path doubles back at a point -- Duluth's ILS RWY 27 via DLH
    comes to ANDOE northeastbound and its final leaves it westbound -- the
    course reversal a pilot flies there (AIM 5-4-9): the hold the chart puts
    at the fix (a hold in lieu of a procedure turn), once round; or else a
    teardrop. Each point of it has no altitude of its own but the last,
    back at the fix inbound, crossed at its altitude again. Not at the
    procedure's first fix, come to from the route: a pilot turns there,
    however far, onto the procedure's first leg. A teardrop there flew El
    Dorado's ILS 22 via ELD five miles on past the VOR, over the field, and
    back (the owner's recording, 2026-10-19), and the plan with it."""
    out, out_ft = [path[0]], [ft[0]]
    for i in range(1, len(path)):
        fix = path[i]
        out.append(fix)
        out_ft.append(ft[i])
        if i == len(path) - 1:
            break
        cin, cout = _bearing(path[i - 1], fix), _bearing(fix, path[i + 1])
        turn = geo.angle_between(cout, cin)
        # The chart's own reversal at the fix, flown from its far side --
        # at the procedure's first fix as well, where a hold in lieu of a
        # procedure turn at an RNAV approach's IAF was never flown (the
        # audit of 2026-10-21: Rockford's ILS 01 via KENNY, and nine in ten
        # of the RNAV approaches checked); else, past its first fix, a
        # teardrop where the path doubles back.
        hold = next((h for h in holds if len(h["points"]) > 2 and _nm(tuple(h["points"][0]), fix) < SAME_PLACE_NM), None)
        if hold and turn > CODED_REVERSAL_DEG:
            round_ = _entered(hold, fix, cin)
        elif not hold and i > 1 and turn > REVERSAL_DEG:
            round_ = _teardrop(fix, cin, cout)
        else:
            continue
        out.extend(round_)
        out_ft.extend(ft[i] if k == len(round_) - 1 else None for k in range(len(round_)))
    return out, out_ft


def _direct(piece: dict | None, drawing: dict | None) -> dict | None:
    """A procedure's path from the fix ATC sent the airplane direct to
    (its drawing's `direct`), the rest of it before that fix left out; as
    it is where it has none, or the fix is not on this path."""
    ident = (drawing or {}).get("direct")
    if not piece or not ident:
        return piece
    fix = next((f for f in drawing.get("fixes", []) if f["ident"] == ident and not f["missed"]), None)
    if fix is None:
        return piece
    at = next((i for i, p in enumerate(piece["points"]) if _nm(p, (fix["lat"], fix["lon"])) < SAME_PLACE_NM), None)
    if at is None:
        return piece
    sent = {**piece, "points": piece["points"][at:], "ft": piece["ft"][at:]}
    if "map_at" in piece:
        sent["map_at"] = max(0, piece["map_at"] - at)
    return sent


def flown(start: tuple, end: tuple, departure: dict | None = None, arrival: dict | None = None,
          approach: dict | None = None, runway: str | None = None,
          takeoff_circuit: dict | None = None, landing_circuit: dict | None = None) -> dict | None:
    """A leg flown by the procedures picked, from its `start` to its `end`:
    out of the field it leaves by its departure, into the one it lands at
    by its arrival and its approach, each to its runway, a course reversal
    where the path doubles back. Out on a departure alone, on to `end` as
    the route goes. The path, the altitude the chart sets at each point
    (None where it sets none), its length, whether it comes down to a
    runway (`landing`), where the final starts (`final_at`, the index of
    the final approach fix the last time the path is there, after a course
    reversal round it), where its missed approach point is (`map_at`, the
    missed approach flown from there), and the approach's missed approach;
    a departure by the runway transition for the `runway` left from. A procedure ATC
    sent the airplane direct to a fix of (its drawing's `direct`) is flown
    from that fix, straight to it from where the leg is. With no
    departure, out by the runway left from and its upwind
    (`takeoff_circuit`, vfr.pattern.departure_circuit); with no approach,
    in by the traffic pattern to the runway landed on (`landing_circuit`,
    vfr.pattern.arrival_circuit), after the arrival where there is one.
    None where nothing of them is drawn."""
    app = approach_path(approach) if approach else None
    # Sent direct to one of the approach's fixes, the arrival is left for it.
    direct_in = bool(approach and approach.get("direct") and _direct(app, approach) is not app)
    app = _direct(app, approach)
    star = None if direct_in else _direct(procedure_path(arrival, app["points"][0] if app else None) if arrival else None, arrival)
    sid = _direct(procedure_path(departure, runway=runway) if departure else None, departure)
    out = sid or takeoff_circuit
    circuit_in = None if app else landing_circuit
    pieces = [p for p in (out, star, app or circuit_in) if p]
    if not pieces:
        return None
    # Out by the runway, from its threshold: the airplane on the runway, not
    # the middle of the field.
    raw, raw_ft = ([], []) if takeoff_circuit is not None and out is takeoff_circuit else ([tuple(start)], [None])
    for piece in pieces:
        # From vectors, onto the final at a 30° intercept (vectors_join);
        # sent direct to a fix, straight there.
        if piece is app and not approach.get("transition") and not direct_in:
            for p in vectors_join(piece["points"], raw[-1]):
                raw.append(p)
                raw_ft.append(None)
        for p, ft in zip(piece["points"], piece["ft"]):
            # A point where the last piece ended is the one place.
            if raw and _nm(p, raw[-1]) < SAME_PLACE_NM:
                continue
            raw.append(p)
            raw_ft.append(ft)
    # On to the leg's end where no approach brings it down: a departure out
    # onto the route, and an arrival on to its field from where it ends --
    # most end in vectors (FM, VM), Rockford's ALEXS1 29 miles out, where the
    # dry run came down to the field's elevation (the audit of 2026-10-21).
    if not app and not circuit_in and _nm(raw[-1], tuple(end)) >= SAME_PLACE_NM:
        raw.append(tuple(end))
        raw_ft.append(None)
    path, ft = with_reversals(raw, raw_ft, [h for piece in pieces for h in piece["holds"]])
    final_at = None
    map_at = None
    missed = None
    if app:
        faf = next((f for f in approach.get("fixes", []) if not f["missed"] and "FAF" in f["roles"]), None)
        if faf:
            hits = [i for i, p in enumerate(path) if _nm(p, (faf["lat"], faf["lon"])) < SAME_PLACE_NM]
            final_at = hits[-1] if hits else None
        map_point = app["points"][app.get("map_at", len(app["points"]) - 1)]
        hits = [i for i, p in enumerate(path) if _nm(p, map_point) < SAME_PLACE_NM]
        map_at = hits[-1] if hits else None
        missed = missed_path(approach, map_point)
    return {
        "path": [[round(p[0], 6), round(p[1], 6)] for p in path], "ft": ft, "nm": length_nm(path),
        "landing": bool(star or app or circuit_in), "final_at": final_at, "map_at": map_at,
        "missed": None if missed is None else {
            "path": [[round(p[0], 6), round(p[1], 6)] for p in missed["points"]], "ft": missed["ft"],
        },
    }
