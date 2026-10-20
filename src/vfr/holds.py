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

import math
import re
from dataclasses import dataclass

from . import geo

#: A standard-rate turn, degrees a second: a 180 degree turn at either end
#: of the racetrack is a minute (FAA-H-8083-15B, Instrument Flying
#: Handbook, ch. 7, "Standard Rate Turns").
STANDARD_RATE_DEG_S = 3.0
#: The inbound leg's time with none given, min: a minute at or below
#: 14,000 ft MSL, a minute and a half above (AIM 5-3-8 j.4(a)).
LEG_MIN_LOW = 1.0
LEG_MIN_HIGH = 1.5
LEG_MIN_CEILING_FT = 14_000

#: "VPBNG/090/30:270:R:1M:2T": the point, the inbound course (magnetic),
#: R or L, the legs (minutes "1M" or nm "4N"), and for how long (turns
#: "2T" or minutes "10M").
_HOLD = re.compile(r"^([A-Z0-9/.]+):(\d{1,3}):([RL]):(\d{1,2}(?:\.\d)?)([MN]):(\d{1,3})([TM])$")


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
    """One hold as the address writes it, or None where it is not one."""
    match = _HOLD.match(text.strip().upper())
    if match is None:
        return None
    inbound = int(match[2])
    leg, length = float(match[4]), int(match[6])
    if inbound > 360 or leg <= 0 or length <= 0:
        return None
    timed, by_turns = match[5] == "M", match[7] == "T"
    return Hold(
        fix=match[1], inbound_deg=inbound % 360, right=match[3] == "R",
        leg_min=leg if timed else None, leg_nm=None if timed else leg,
        turns=length if by_turns else None, minutes=None if by_turns else float(length),
    )


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
    mirror."""
    rel = (arrival_deg - inbound_deg) % 360
    if not right:
        rel = (360 - rel) % 360
    if rel <= 110 or rel >= 290:
        return "direct"
    return "teardrop" if rel <= 180 else "parallel"


def default_leg_min(altitude_ft: float | None) -> float:
    """The inbound leg's minutes where the pilot gave none (AIM 5-3-8 j.4(a))."""
    return LEG_MIN_HIGH if altitude_ft is not None and altitude_ft > LEG_MIN_CEILING_FT else LEG_MIN_LOW


def turn_radius_nm(tas_kt: float) -> float:
    """A standard-rate turn's radius at `tas_kt`: half a circle in a minute
    flies TAS/60 nm, so the radius is TAS/(60 pi) -- 0.64 nm at 120 kt."""
    return tas_kt / (60 * math.pi) * (3.0 / STANDARD_RATE_DEG_S)


def lap_minutes(hold: Hold, tas_kt: float) -> float:
    """One turn round the racetrack, min: its two legs and its two 180
    degree turns at standard rate (a minute each). A distance leg is flown
    at `tas_kt`."""
    turns = 2 * 180 / STANDARD_RATE_DEG_S / 60
    leg = hold.leg_min if hold.leg_min is not None else (hold.leg_nm or 0) / max(tas_kt, 1) * 60
    return 2 * leg + turns


def held_minutes(hold: Hold, tas_kt: float) -> float:
    """How long the hold is flown, min: its turns round the racetrack, or
    the minutes given."""
    if hold.minutes is not None:
        return hold.minutes
    return (hold.turns or 1) * lap_minutes(hold, tas_kt)


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
