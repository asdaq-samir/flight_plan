"""vfr.holds: a hold the pilot puts anywhere -- how it is written, the
entry from the course flown to it, and the racetrack and time it takes."""
import pytest
from vfr import geo, holds


def test_a_hold_is_written_as_the_address_has_it():
    hold = holds.parse("vpbng/090/30:270:R:1M:2T")
    assert hold == holds.Hold("VPBNG/090/30", 270, True, 1.0, None, 2, None)
    assert holds.parse("KMSN:360:L:4N:10M") == holds.Hold("KMSN", 0, False, None, 4.0, None, 10.0)
    assert holds.parse("KMSN:400:L:4N:10M") is None
    assert holds.parse("KMSN:090:X:1M:2T") is None
    assert holds.parse("KMSN") is None


@pytest.mark.parametrize("arrival, inbound, right, made", [
    # Inbound 270 with right turns: the pattern north of the inbound leg,
    # east of the fix. Flying the inbound course to it, direct.
    (270, 270, True, "direct"),
    # Northbound, from the side away from the pattern: a right turn of 90
    # onto the outbound leg, direct.
    (0, 270, True, "direct"),
    # North-east, 135 right of inbound: out 30 into the holding side, a
    # teardrop.
    (45, 270, True, "teardrop"),
    # Southbound, from the pattern's side: out along the inbound course on
    # the other side, and back round to it, parallel.
    (180, 270, True, "parallel"),
    # Left turns, the mirror.
    (180, 270, False, "direct"),
    (0, 270, False, "parallel"),
    (135, 270, False, "teardrop"),
])
def test_the_entry_is_the_one_aim_5_3_8_gives_for_the_course_flown_to_the_fix(arrival, inbound, right, made):
    assert holds.entry(arrival, inbound, right) == made


def test_a_timed_lap_is_its_two_legs_and_two_minutes_of_turns():
    hold = holds.parse("KMSN:270:R:1M:2T")
    assert holds.lap_minutes(hold, 110) == pytest.approx(4.0)
    assert holds.held_minutes(hold, 110) == pytest.approx(8.0)
    by_distance = holds.parse("KMSN:270:R:4N:2T")
    assert holds.lap_minutes(by_distance, 120) == pytest.approx(2 * 2 + 2)
    assert holds.held_minutes(holds.parse("KMSN:270:R:1M:15M"), 110) == 15
    # A minute and a half over 14,000 ft (AIM 5-3-8).
    assert holds.default_leg_min(14_500) == 1.5 and holds.default_leg_min(9_500) == 1.0


def test_the_racetrack_turns_to_the_holding_side_and_closes_at_the_fix():
    fix = (43.0, -89.0)
    track = holds.racetrack(fix, 270.0, True, 120, 2.0)
    assert track[0] == track[-1] == [43.0, -89.0]
    # Right turns from a westbound inbound leg: the pattern lies north of
    # it and east of the fix, two turn radii wide.
    far = max(track, key=lambda p: p[0])
    assert far[0] > fix[0]
    assert geo.distance_nm(fix[0], fix[1], far[0], fix[1]) == pytest.approx(2 * holds.turn_radius_nm(120), abs=0.05)
    assert max(p[1] for p in track) > fix[1] + 0.03
    left = holds.racetrack(fix, 270.0, False, 120, 2.0)
    assert min(p[0] for p in left) < fix[0]
