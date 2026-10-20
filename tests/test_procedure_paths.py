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
