"""A hold the pilot puts anywhere on the route, as Garmin's and
ForeFlight's pilot-defined holds are, at the owner's ask ("create a
left/right hold"): at one of the route's points, its inbound course, its
turns, its legs by time or distance and how long it is held, written as
the address has it -- "VPBNG/090/30:270:R:1M:2T" -- and what flying it
takes: the entry the airplane makes from the course it arrives on, the
racetrack it flies, and the minutes it is held, which the planner adds to
the flight's time and fuel (plan.with_holds).

A no-wind racetrack, at the leg's true airspeed: a pilot corrects for the
wind as it is found there, and a timed hold's lap takes as long whatever
the wind (its inbound leg is the timed one, its outbound adjusted to it).
"""
from __future__ import annotations

import json
from dataclasses import dataclass

import vfr_native

from . import geo


@dataclass(frozen=True)
class Hold:
    fix: str
    #: The inbound course to the fix, magnetic degrees.
    inbound_deg: int
    right: bool
    #: The legs, timed (minutes) or by distance (nm): one or the other.
    leg_min: float | None
    leg_nm: float | None
    #: How long it is held: turns round the racetrack, or minutes.
    turns: int | None
    minutes: float | None


def parse(text: str) -> Hold | None:
    """One hold as the address writes it, or None where it is not one: the
    engine's reading (wingtip_engine::route::holds), the one the web app's
    lib/holds and the phones ask too."""
    read = json.loads(vfr_native.call("hold_read", json.dumps({"text": text})))
    return None if read is None else _hold(read)


def parse_all(text: str) -> list[tuple[str, Hold | None]]:
    """The address's `holds`, "A,B": each piece trimmed, the empty ones
    left out, with the hold it is, or None where it is not one."""
    read = json.loads(vfr_native.call("holds_read", json.dumps({"text": text})))
    return [(r["part"], None if r["hold"] is None else _hold(r["hold"])) for r in read]


def _hold(h: dict) -> Hold:
    return Hold(
        fix=h["fix"], inbound_deg=int(h["inbound"]), right=h["right"], leg_min=h["leg_min"], leg_nm=h["leg_nm"],
        turns=None if h["turns"] is None else int(h["turns"]), minutes=None if h["minutes"] is None else float(h["minutes"]),
    )


def _figures(hold: Hold | None, tas_kt: float) -> dict:
    """The engine's figures of a hold at `tas_kt` (holds::lap_minutes,
    held_minutes, turn_radius_nm)."""
    legs = {"leg_min": 1} if hold is None else {
        "leg_min": hold.leg_min, "leg_nm": None if hold.leg_min is not None else (hold.leg_nm or 0),
        "turns": hold.turns, "minutes": hold.minutes,
    }
    return json.loads(vfr_native.call("hold_figures", json.dumps({"hold": legs, "tas_kt": tas_kt})))


def entry(arrival_deg: float, inbound_deg: float, right: bool) -> str:
    """The entry an airplane arriving on `arrival_deg` (its magnetic course
    to the fix) makes into a hold whose inbound course is `inbound_deg`:
    direct, teardrop or parallel. AIM 5-3-8 j.3 (and its figure) places
    the sectors round the fix by where the airplane comes from, cut by a
    line 70 degrees to the holding course; arriving on a course is coming
    from its reciprocal, so the same sectors read by the course flown, the
    way an FMS reads them: for right turns, a course within 110 degrees
    right and 70 left of the inbound course direct, the next 70 round
    (110 to 180) teardrop, the 110 beyond parallel; left turns the
    mirror. The engine's (wingtip_engine::figures::holding), the one copy
    the hold's page and the phones use too."""
    return vfr_native.hold_entry(arrival_deg, inbound_deg, right)


def default_leg_min(altitude_ft: float | None) -> float:
    """The inbound leg's minutes where the pilot gave none: a minute at or
    below 14,000 ft MSL, a minute and a half above (AIM 5-3-8 j.4(a)), the
    engine's rule."""
    return vfr_native.holding_leg_minutes(altitude_ft)


def turn_radius_nm(tas_kt: float) -> float:
    """A standard-rate turn's radius at `tas_kt`: half a circle in a minute
    flies TAS/60 nm, so the radius is TAS/(60 pi) -- 0.64 nm at 120 kt.
    The engine's figure."""
    return _figures(None, tas_kt)["turn_radius_nm"]


def lap_minutes(hold: Hold, tas_kt: float) -> float:
    """One turn round the racetrack, min: its two legs and its two 180
    degree turns at standard rate (a minute each, FAA-H-8083-15B ch. 7). A
    distance leg is flown at `tas_kt`. The engine's figure."""
    return _figures(hold, tas_kt)["lap_min"]


def held_minutes(hold: Hold, tas_kt: float) -> float:
    """How long the hold is flown, min: its turns round the racetrack, or
    the minutes given. The engine's figure."""
    return _figures(hold, tas_kt)["held_min"]


def racetrack(fix: tuple[float, float], inbound_true_deg: float, right: bool, tas_kt: float, leg_nm: float,
              steps: int = 12) -> list[list[float]]:
    """One turn round the racetrack from the fix, [lat, lon] pairs: the
    turn at the fix toward the holding side, the outbound leg, the turn
    back, and the inbound leg to the fix again. True degrees."""
    side = 1 if right else -1
    r = turn_radius_nm(tas_kt)
    c1 = geo.destination_point(fix[0], fix[1], (inbound_true_deg + 90 * side) % 360, r)
    c2 = geo.destination_point(c1[0], c1[1], (inbound_true_deg + 180) % 360, leg_nm)

    def arc(center: tuple, start_deg: float) -> list[list[float]]:
        return [list(geo.destination_point(center[0], center[1], (start_deg + side * 180 * k / steps) % 360, r))
                for k in range(steps + 1)]

    first = arc(c1, inbound_true_deg - 90 * side)
    second = arc(c2, inbound_true_deg + 90 * side)
    return [[fix[0], fix[1]], *first[1:], *second, [fix[0], fix[1]]]
