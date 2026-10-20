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

    holds = [[tuple(p) for p in h["points"]] for h in drawing.get("holds", []) if not h["missed"]]
    return {"points": points, "ft": [ft(p) for p in points], "holds": holds}


def _of(drawing: dict, *roles: str) -> list:
    return [ln["points"] for role in roles for ln in drawing.get("lines", []) if ln["role"] == role]


def approach_path(drawing: dict) -> dict | None:
    """An approach as it is flown: its transition, then its final to the
    missed approach point -- not the missed approach -- the final joined
    where the transition ends on it (Duluth's ILS RWY 27 via DLH ends at
    ANDOE, the final's second fix, and would have gone back out to WIRSA,
    the final's first, before turning in). None where nothing is drawn."""
    return _crossings(drawing, joined_lines([ln["points"] for ln in drawing.get("lines", []) if ln["role"] in ("transition", "final")]))


def procedure_path(drawing: dict, toward: tuple | None = None) -> dict | None:
    """An arrival or a departure as it is flown: a departure's runway
    transition, its common route and its enroute transition; an arrival's
    enroute transition and common route, then of its runway transitions
    the one that ends nearest `toward`, the approach's first fix, where
    one is picked. vfr.procedures draws every runway transition of either:
    the runway in use is not known to the plan, so a departure leaves by
    the first coded. None where nothing is drawn."""
    runways = _of(drawing, "runway")
    if drawing["kind"] == "departure":
        return _crossings(drawing, joined_lines(runways[:1] + _of(drawing, "common", "transition")))
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
        if i == 1:
            continue
        cin, cout = _bearing(path[i - 1], fix), _bearing(fix, path[i + 1])
        if abs(((cout - cin + 540) % 360) - 180) <= REVERSAL_DEG:
            continue
        hold = next((h for h in holds if len(h) > 2 and _nm(h[0], fix) < SAME_PLACE_NM), None)
        round_ = hold[1:] if hold else _teardrop(fix, cin, cout)
        out.extend(round_)
        out_ft.extend(ft[i] if k == len(round_) - 1 else None for k in range(len(round_)))
    return out, out_ft


def flown(start: tuple, end: tuple, departure: dict | None = None, arrival: dict | None = None,
          approach: dict | None = None) -> dict | None:
    """A leg flown by the procedures picked, from its `start` to its `end`:
    out of the field it leaves by its departure, into the one it lands at
    by its arrival and its approach, each to its runway, a course reversal
    where the path doubles back. Out on a departure alone, on to `end` as
    the route goes. The path, the altitude the chart sets at each point
    (None where it sets none), its length, whether it comes down to a
    runway (`landing`), where the final starts (`final_at`, the index of
    the final approach fix the last time the path is there, after a course
    reversal round it), and the approach's missed approach. None where
    nothing of them is drawn."""
    app = approach_path(approach) if approach else None
    star = procedure_path(arrival, app["points"][0] if app else None) if arrival else None
    sid = procedure_path(departure) if departure else None
    pieces = [p for p in (sid, star, app) if p]
    if not pieces:
        return None
    raw, raw_ft = [tuple(start)], [None]
    for piece in pieces:
        # From vectors, onto the final at a 30° intercept (vectors_join).
        if piece is app and not approach.get("transition"):
            for p in vectors_join(piece["points"], raw[-1]):
                raw.append(p)
                raw_ft.append(None)
        for p, ft in zip(piece["points"], piece["ft"]):
            # A point where the last piece ended is the one place.
            if _nm(p, raw[-1]) < SAME_PLACE_NM:
                continue
            raw.append(p)
            raw_ft.append(ft)
    if not star and not app:
        raw.append(tuple(end))
        raw_ft.append(None)
    path, ft = with_reversals(raw, raw_ft, [h for piece in pieces for h in piece["holds"]])
    final_at = None
    missed = None
    if app:
        faf = next((f for f in approach.get("fixes", []) if not f["missed"] and "FAF" in f["roles"]), None)
        if faf:
            hits = [i for i, p in enumerate(path) if _nm(p, (faf["lat"], faf["lon"])) < SAME_PLACE_NM]
            final_at = hits[-1] if hits else None
        missed = missed_path(approach, app["points"][-1])
    return {
        "path": [[round(p[0], 6), round(p[1], 6)] for p in path], "ft": ft, "nm": length_nm(path),
        "landing": bool(star or app), "final_at": final_at,
        "missed": None if missed is None else {
            "path": [[round(p[0], 6), round(p[1], 6)] for p in missed["points"]], "ft": missed["ft"],
        },
    }
