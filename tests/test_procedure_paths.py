"""The way the procedures picked are flown (vfr.procedure_paths): the path
the planner lengthens a leg by and the web app's dry run flies."""
import pytest

from vfr import geo
from vfr.procedure_paths import approach_path, flown, length_nm, missed_path, procedure_path, vectors_join


def fix(ident, lat, lon, roles=(), min_ft=None, missed=False):
    return {"ident": ident, "lat": lat, "lon": lon, "roles": list(roles), "min_ft": min_ft, "max_ft": None, "missed": missed}


def near(a, b, nm=0.05):
    return geo.distance_nm(a[0], a[1], b[0], b[1]) < nm


# Duluth's ILS RWY 27 via DLH, as vfr.procedures draws it (2026-10 cycle):
# the transition DLH to ANDOE, the final from WIRSA through ANDOE to the
# runway.
ILS27_DLH = {
    "airport": "KDLH", "kind": "approach", "id": "I27", "transition": "DLH", "holds": [],
    "lines": [
        {"role": "transition", "points": [[46.802164, -92.202869], [46.837742, -92.050569]]},
        {"role": "final", "points": [[46.831561, -91.841322], [46.837742, -92.050569], [46.841361, -92.180119]]},
    ],
    "fixes": [
        fix("DLH", 46.802164, -92.202869),
        fix("ANDOE", 46.837742, -92.050569, ["IAF", "FAF"], 3200),
        fix("WIRSA", 46.831561, -91.841322, ["FACF"], 3200),
        fix("RW27", 46.841361, -92.180119, ["MAP"]),
    ],
}
ANDOE = (46.837742, -92.050569)
RW27 = (46.841361, -92.180119)
# A field south-west of Duluth the legs come from.
SOUTH_WEST = (46.0, -92.8)


def test_an_approach_joins_its_final_where_its_transition_ends_on_it():
    path = approach_path(ILS27_DLH)
    assert path["points"] == [(46.802164, -92.202869), ANDOE, RW27]
    assert path["ft"] == [None, 3200, None]


def test_where_the_approach_doubles_back_it_turns_in_a_teardrop_out_past_the_fix():
    leg = flown(SOUTH_WEST, RW27, approach=ILS27_DLH)
    path = [tuple(p) for p in leg["path"]]
    # Out beyond ANDOE, away from the runway, then back across it westbound
    # to the runway: no hairpin at the fix.
    assert any(p[1] > ANDOE[1] and geo.distance_nm(*p, *ANDOE) > 2.5 for p in path)
    assert path[-1] == RW27
    assert leg["landing"] is True
    # Its final from ANDOE, the final approach fix, the last time it is there.
    assert near(path[leg["final_at"]], ANDOE)
    assert all(not near(p, ANDOE) for p in path[leg["final_at"] + 1:])


def test_no_reversal_is_flown_at_the_procedures_first_fix_come_to_from_the_route():
    """El Dorado's ILS 22 via ELD (2026-10-19): from the north to the VOR,
    then back out north-east to EL. A turn at ELD, not a teardrop past it
    over the field; the reversal is at EL, where the final doubles back."""
    eld, el, rw = (33.25, -92.75), (33.30, -92.70), (33.22, -92.81)
    approach = {
        "kind": "approach", "transition": "ELD", "holds": [],
        "lines": [{"role": "transition", "points": [list(eld), list(el)]}, {"role": "final", "points": [list(el), list(rw)]}],
        "fixes": [fix("ELD", *eld), fix("EL", *el, ["IAF", "FAF"], 2000), fix("RW22", *rw, ["MAP"])],
    }
    leg = flown((33.6, -92.75), rw, approach=approach)
    path = [tuple(p) for p in leg["path"]]
    # Straight from the route to ELD and on to EL: nothing south-west of the VOR first.
    assert path[1] == eld
    assert not any(p[0] < eld[0] - 0.01 for p in path[:path.index(el)])
    # Turned round at EL, out past it to the north-east.
    assert any(p[0] > el[0] + 0.02 for p in path)


def test_the_charts_hold_is_flown_once_round_where_it_has_one_in_lieu_of_a_procedure_turn():
    far = (46.84, -91.95)
    hold = [list(ANDOE), [46.85, -92.0], list(far), [46.83, -92.0], list(ANDOE)]
    leg = flown(SOUTH_WEST, RW27, approach={**ILS27_DLH, "holds": [{"missed": False, "points": hold}]})
    assert any(near(p, far) for p in leg["path"])


def test_from_vectors_the_final_is_joined_30_degrees_off_its_course_outside_its_first_fix():
    # A short final from the south-west, its first fix north of the
    # airplane: straight to a point three miles back from it, 30° off.
    final = [(42.95, -88.05), (42.975, -88.025), (43.0, -88.0)]
    join = vectors_join(final, (42.8, -88.0))
    assert len(join) == 1
    assert geo.distance_nm(*join[0], *final[0]) == pytest.approx(3, abs=0.01)
    course = geo.bearing_deg(*final[0], *final[1])
    inbound = geo.bearing_deg(*join[0], *final[0])
    assert abs(((inbound - course + 540) % 360) - 180) == pytest.approx(30, abs=1)


def test_from_vectors_with_the_field_between_flies_a_downwind_abeam_the_first_fix():
    # Eastbound from 43 N 88.2 W to the runway at 88 W, the airplane south
    # of the runway: a downwind four miles or more south, abeam the first
    # fix, then the join.
    final = [(43.0, -88.2), (43.0, -88.1), (43.0, -88.0)]
    join = vectors_join(final, (42.8, -88.0))
    assert len(join) == 4
    abeam = join[1]
    assert abeam[1] == pytest.approx(-88.2, abs=0.002)
    assert abeam[0] < 42.95


def test_a_departure_is_left_by_its_first_runway_transition_then_on_to_the_route():
    sid = {
        "kind": "departure", "holds": [], "fixes": [],
        "lines": [
            {"role": "runway", "points": [[46.0, -92.8], [46.05, -92.8]]},
            {"role": "common", "points": [[46.05, -92.8], [46.1, -92.6]]},
            {"role": "transition", "points": [[46.1, -92.6], [46.15, -92.5]]},
        ],
    }
    leg = flown(SOUTH_WEST, RW27, departure=sid)
    assert any(near(p, (46.15, -92.5)) for p in leg["path"])
    assert tuple(leg["path"][-1]) == RW27
    assert leg["landing"] is False
    assert leg["nm"] > geo.distance_nm(*SOUTH_WEST, *RW27)


def test_an_arrival_comes_in_by_the_runway_transition_nearest_the_approachs_start():
    star = {
        "kind": "arrival", "holds": [], "fixes": [],
        "lines": [
            {"role": "common", "points": [[46.6, -92.4], [46.75, -92.3]]},
            {"role": "runway", "points": [[46.75, -92.3], [46.84, -92.5]]},
            {"role": "runway", "points": [[46.75, -92.3], [46.80, -92.21]]},
        ],
    }
    assert procedure_path(star, (46.80, -92.2))["points"][-1] == (46.80, -92.21)
    leg = flown(SOUTH_WEST, RW27, arrival=star, approach=ILS27_DLH)
    assert any(near(p, (46.80, -92.21)) for p in leg["path"])
    assert not any(near(p, (46.84, -92.5), 0.5) for p in leg["path"])


def test_the_missed_approach_is_flown_from_its_point_round_its_hold_climbing_to_its_highest_fix():
    drawing = {
        "kind": "approach", "holds": [{"missed": True, "points": [[43, -88.3], [43.05, -88.35], [43, -88.3]]}],
        "lines": [{"role": "missed", "points": [[43, -88], [43, -88.3]]}],
        "fixes": [fix("UDTEG", 43, -88.3, ["hold"], 3300, missed=True)],
    }
    missed = missed_path(drawing, (43, -88))
    assert missed["points"] == [(43, -88.3), (43.05, -88.35), (43, -88.3)]
    assert missed["ft"] == 3300


def test_nothing_drawn_is_flown_as_the_route_goes():
    assert flown(SOUTH_WEST, RW27) is None
    assert flown(SOUTH_WEST, RW27, approach={"kind": "approach", "fixes": []}) is None
    assert length_nm([SOUTH_WEST]) == 0


def test_sent_direct_to_a_fix_the_procedure_is_flown_from_it_straight_there():
    """The owner's ask ("the ability to go direct to a fix as told by
    ATC"): Duluth's ILS 27 via DLH, direct ANDOE -- straight from the leg's
    start to ANDOE and down the final, no transition and no reversal; and an
    arrival is left for the approach's fix."""
    leg = flown(SOUTH_WEST, RW27, approach={**ILS27_DLH, "direct": "ANDOE"})
    assert [tuple(p) for p in leg["path"]] == [SOUTH_WEST, ANDOE, RW27]
    star = {"kind": "arrival", "holds": [], "fixes": [], "lines": [{"role": "common", "points": [[46.6, -92.4], [46.75, -92.3]]}]}
    both = flown(SOUTH_WEST, RW27, arrival=star, approach={**ILS27_DLH, "direct": "ANDOE"})
    assert [tuple(p) for p in both["path"]] == [SOUTH_WEST, ANDOE, RW27]
    # A fix not on the path changes nothing.
    assert flown(SOUTH_WEST, RW27, approach={**ILS27_DLH, "direct": "NOPE"})["path"] == flown(SOUTH_WEST, RW27, approach=ILS27_DLH)["path"]


# A final westbound from its IAF to the runway, a hold in lieu of a
# procedure turn at the IAF on the final's course, right turns, two-mile
# legs (as vfr.procedures draws a coded HF).
IAF, FAF, RWY = (43.0, -88.0), (43.0, -88.2), (43.0, -88.4)


def hilpt_approach():
    inbound = geo.bearing_deg(*IAF, *FAF)
    racetrack = [list(IAF), list(geo.destination_point(*IAF, inbound + 90, 1.3)),
                 list(geo.destination_point(*IAF, inbound + 180, 2)), list(IAF)]
    return {
        "kind": "approach", "transition": "IAF",
        "holds": [{"missed": False, "points": racetrack, "inbound_deg": round(inbound), "leg_nm": 2.0, "turn": "R"}],
        "lines": [{"role": "final", "points": [list(IAF), list(FAF), list(RWY)]}],
        "fixes": [fix("IAF", *IAF, ["IAF"], 3000), fix("FAF", *FAF, ["FAF"], 2500), fix("RW", *RWY, ["MAP"])],
    }


def test_a_hold_in_lieu_of_a_procedure_turn_at_the_first_fix_is_flown_from_the_far_side_by_its_entry():
    """Rockford's ILS 01 via KENNY and most RNAV approaches checked (the
    audit of 2026-10-21) put a hold in lieu of a procedure turn at their
    first fix, which the dry run never flew. Come to from the runway's
    side, the airplane must reverse course there (AIM 5-4-9): out past the
    fix, east, and back to it before the final."""
    leg = flown((43.05, -88.6), RWY, approach=hilpt_approach())
    path = [tuple(p) for p in leg["path"]]
    assert path[1] == IAF
    out = [p for p in path[2:path.index(FAF)]]
    assert any(p[1] > IAF[1] + 0.02 for p in out)
    assert near(out[-1], IAF)
    assert near(path[leg["final_at"]], FAF)


def test_from_the_near_side_the_first_fixs_hold_is_not_flown():
    # From the east, lined up with the final: straight in (AIM 5-4-5, NoPT).
    leg = flown((43.02, -87.6), RWY, approach=hilpt_approach())
    assert [tuple(p) for p in leg["path"]] == [(43.02, -87.6), IAF, FAF, RWY]


def test_a_hold_is_entered_as_the_aim_says_by_the_course_it_is_come_to_on():
    from vfr.procedure_paths import _entered
    hold = hilpt_approach()["holds"][0]
    inbound = hold["inbound_deg"]
    # Arriving on the outbound course, 180° off the inbound (right turns):
    # a teardrop, out 30° to the holding side, north of the inbound course.
    tear = _entered(hold, IAF, (inbound + 175) % 360)
    assert geo.bearing_deg(*IAF, *tear[0]) == pytest.approx((inbound + 180 - 30) % 360, abs=1)
    # From the non-holding side, beyond 180°: parallel, out on the outbound
    # course, then round to the left, toward the holding side, north, back
    # to the fix.
    par = _entered(hold, IAF, (inbound + 200) % 360)
    assert geo.bearing_deg(*IAF, *par[0]) == pytest.approx((inbound + 180) % 360, abs=1)
    assert any(p[0] > IAF[0] + 0.005 for p in par)
    assert par[-1] == IAF and tear[-1] == IAF


def test_an_approach_whose_missed_approach_point_is_short_of_the_runway_lands_at_the_threshold():
    """A VOR's or a LOC's MAP a mile out was where the dry run touched down
    (the audit of 2026-10-21): on to the threshold, the missed approach
    flown from the MAP."""
    map_point, threshold = (43.0, -88.35), (43.0, -88.4)
    approach = {
        "kind": "approach", "transition": None, "holds": [], "threshold": list(threshold),
        "lines": [{"role": "final", "points": [list(FAF), list(map_point)]},
                  {"role": "missed", "points": [list(map_point), [43.1, -88.5]]}],
        "fixes": [fix("FAF", *FAF, ["FAF"], 2500), fix("MAP", *map_point, ["MAP"]), fix("HOLD", 43.1, -88.5, ["hold"], 3000, missed=True)],
    }
    leg = flown((43.0, -87.8), threshold, approach=approach)
    path = [tuple(p) for p in leg["path"]]
    assert path[-1] == threshold
    # The missed approach goes on from there (the dry run flies it from
    # path[map_at]), not from the threshold.
    assert path[leg["map_at"]] == map_point
    assert leg["missed"]["path"][0] == [43.1, -88.5]


def test_an_arrival_alone_goes_on_from_where_it_ends_to_the_field():
    """Rockford's ALEXS1 ends in vectors 29 miles out, where the dry run
    came down (the audit of 2026-10-21)."""
    star = {"kind": "arrival", "holds": [], "fixes": [], "lines": [{"role": "common", "points": [[46.6, -92.4], [46.75, -92.3]]}]}
    leg = flown(SOUTH_WEST, RW27, arrival=star)
    assert tuple(leg["path"][-1]) == RW27
    assert leg["landing"] is True


def test_a_departure_is_left_by_the_runway_transition_for_the_runway_left_from():
    """St. Louis's BERYY6 left 30R by its runway 11 transition, out the
    wrong way (the audit of 2026-10-21). "RW12B" is both 12s."""
    lines = [
        {"role": "runway", "name": "RW11", "points": [[46.0, -92.8], [45.95, -92.9]]},
        {"role": "runway", "name": "RW30B", "points": [[46.0, -92.8], [46.05, -92.7]]},
        {"role": "common", "points": [[46.1, -92.6], [46.15, -92.5]]},
    ]
    sid = {"kind": "departure", "holds": [], "fixes": [], "lines": lines}
    assert procedure_path(sid, runway="30R")["points"][1] == (46.05, -92.7)
    assert procedure_path(sid, runway="11")["points"][1] == (45.95, -92.9)
    # None picked, or none fits: the first coded.
    assert procedure_path(sid)["points"][1] == (45.95, -92.9)
    assert procedure_path(sid, runway="4")["points"][1] == (45.95, -92.9)
    assert any(near(p, (46.05, -92.7)) for p in flown(SOUTH_WEST, RW27, departure=sid, runway="30L")["path"])


def test_a_transition_that_is_its_fix_alone_is_flown_from_that_fix_round_its_procedure_turn():
    """Duluth's VOR RWY 3 via DLH: a procedure turn at the VOR, on the
    final, and no line of its own. From the north, to DLH, out round the
    turn and back -- not to the final's first fix south of it and back in a
    hairpin (the audit of 2026-10-21)."""
    mizou, dlh, rw = (46.69, -92.25), (46.80, -92.20), (46.84, -92.19)
    turn = [list(dlh), [46.75, -92.25], [46.70, -92.27], [46.72, -92.20], [46.76, -92.215], list(dlh)]
    approach = {
        "kind": "approach", "transition": "DLH",
        "holds": [{"missed": False, "kind": "procedure turn", "points": turn, "inbound_deg": 12, "turn": "R"}],
        "lines": [{"role": "final", "points": [list(mizou), list(dlh), list(rw)]}],
        "fixes": [fix("MIZOU", *mizou, ["FACF"]), fix("DLH", *dlh, ["IAF", "FAF"], 2800), fix("RW03", *rw, ["MAP"])],
    }
    path = [tuple(p) for p in flown((47.5, -92.2), rw, approach=approach)["path"]]
    assert path[1] == dlh
    assert not any(near(p, mizou) for p in path)
    assert any(near(p, (46.70, -92.27)) for p in path)


def test_a_leg_with_runways_picked_is_flown_out_by_its_upwind_and_in_by_the_pattern():
    """C81 to UGN with 24 and 5 picked: off the runway's threshold, round
    UGN's pattern and down onto 5's threshold, not to the field's middle."""
    from vfr import pattern
    ugn = {"runway_ends": [
        {"ident": "05", "heading_true_deg": 49.0, "traffic": "left", "lat": 42.4176, "lon": -87.8742},
        {"ident": "23", "heading_true_deg": 229.0, "traffic": "right", "lat": 42.4268, "lon": -87.8593},
    ]}
    c81 = {"runway_ends": [
        {"ident": "6", "heading_true_deg": 58.0, "traffic": "left", "lat": 42.3236, "lon": -88.0800},
        {"ident": "24", "heading_true_deg": 238.0, "traffic": "left", "lat": 42.3270, "lon": -88.0710},
    ]}
    start, end = (42.3250, -88.0750), (42.4222, -87.8678)
    out = pattern.departure_circuit(c81, "6", end)
    into = pattern.arrival_circuit(ugn, "5", 1700, 727)
    leg = flown(start, end, takeoff_circuit=out, landing_circuit=into)
    assert tuple(leg["path"][0]) == (42.3236, -88.08)
    assert tuple(leg["path"][-1]) == (42.4176, -87.8742)
    assert leg["landing"] is True
    assert leg["nm"] > length_nm([start, end])
    assert leg["ft"][-1] == 727


def test_the_pattern_alone_is_a_landing_and_nothing_picked_is_the_route():
    from vfr import pattern
    ugn = {"runway_ends": [
        {"ident": "05", "heading_true_deg": 49.0, "traffic": "left", "lat": 42.4176, "lon": -87.8742},
        {"ident": "23", "heading_true_deg": 229.0, "traffic": "right", "lat": 42.4268, "lon": -87.8593},
    ]}
    into = pattern.arrival_circuit(ugn, "5", 1700, 727)
    assert flown((42.3, -88.0), (42.4222, -87.8678), landing_circuit=into)["landing"]
    assert flown((42.3, -88.0), (42.4222, -87.8678)) is None
