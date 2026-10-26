"""web/src/lib/debrief.test.ts's cases for app.figures.debrief: the same
flight, the same track, the same expectations."""
import math
from datetime import datetime, timezone

import pytest

from app.figures.debrief import airborne, debrief, marked

#: A flight due north along 88 W: A at 42 N, a lake 30 nm on, B 30 nm past
#: it, 18 minutes a leg at 3,500 ft.
CHECKPOINTS = [
    {"sequence_no": 0, "name": "A", "category": "departure", "lat": 42, "lon": -88, "along_track_nm": 0,
     "true_course_deg": None, "ete_min": None, "altitude_ft": None},
    {"sequence_no": 1, "name": "Lake", "category": "lake", "lat": 42.5, "lon": -88, "along_track_nm": 30,
     "true_course_deg": 0, "ete_min": 18, "altitude_ft": 3500},
    {"sequence_no": 2, "name": "B", "category": "destination", "lat": 43, "lon": -88, "along_track_nm": 60,
     "true_course_deg": 0, "ete_min": 18, "altitude_ft": 3500},
]


def flown() -> list[dict]:
    """Flown every 5 s: two minutes' taxi, then north at 100 kt half a mile
    east of the line, climbing at 500 fpm to 3,600; 3,800 for two minutes
    on the second leg; down at 500 fpm to 1,800 in the last 4 nm; taxi."""
    t0 = datetime(2026, 10, 2, 15, tzinfo=timezone.utc).timestamp() * 1000
    lon = -88 + 0.5 / (60 * math.cos(42.5 * math.pi / 180))
    points = [{"t": t0 + s * 1000, "lat": 42 - 0.002 + (s / 3600) * (10 / 60), "lon": lon, "alt_ft": 700} for s in range(0, 120, 5)]
    off = t0 + 120_000
    for s in range(0, 36 * 60 + 1, 5):
        nm = (s / 3600) * 100
        alt = min(3600, 700 + (s / 60) * 500)
        if 40 < nm < 40 + 100 / 30:
            alt = 3800
        if nm > 56:
            alt = max(1800, 3600 - (nm - 56) * 600)
        points.append({"t": off + s * 1000, "lat": 42 + nm / 60, "lon": lon, "alt_ft": alt})
    on = off + 36 * 60_000
    points += [{"t": on + s * 1000, "lat": 43 + (s / 3600) * (10 / 60), "lon": lon, "alt_ft": 700} for s in range(5, 120, 5)]
    return points


@pytest.fixture(scope="module")
def d() -> dict:
    return debrief(CHECKPOINTS, flown(), {"B": 1700})


def test_the_flight_is_the_tracks_run_over_40_kt(d):
    assert len(airborne(flown())) == 1
    assert d["flown_min"] == pytest.approx(36, abs=0.5)
    assert d["planned_min"] == 36
    assert d["notes"] == []


def test_leg_by_leg_the_course_held_and_how_far_off_it_the_altitude_held(d):
    assert d["legs"][0]["course_within"] == 1
    # Half a mile east of a northbound line: right of it.
    assert d["legs"][0]["worst_off_nm"] == pytest.approx(0.5, abs=0.05)
    # The climb is not the cruise: 3,600 from there is within 200.
    assert d["legs"][0]["altitude_within"] == 1
    # Two minutes at 3,800 of the second leg's cruise.
    assert 0.75 < d["legs"][1]["altitude_within"] < 0.95
    assert d["legs"][1]["worst_alt_ft"] == 300
    # On the map, the two minutes at 3,800 are the off part of the line.
    off = [pt for pt in d["line"] if pt["off"]]
    assert len(off) > 10
    assert all(42 + 40 / 60 < pt["lat"] < 42 + 44 / 60 for pt in off)


def test_each_checkpoint_when_it_was_due_and_when_it_was_passed_and_the_pattern(d):
    assert [p["name"] for p in d["passes"]] == ["Lake", "B"]
    assert d["passes"][0]["due_min"] == 18
    assert d["passes"][0]["passed_min"] == pytest.approx(18, abs=0.5)
    assert d["passes"][0]["closest_nm"] == pytest.approx(0.5, abs=0.05)
    assert d["passes"][1]["passed_min"] == pytest.approx(36, abs=0.5)
    assert len(d["patterns"]) == 1
    assert d["patterns"][0]["pattern_ft"] == 1700
    assert d["patterns"][0]["alt_ft"] > 1700


def test_a_track_from_somewhere_else_is_said_and_one_that_never_flew_is_none():
    elsewhere = [{**p, "lat": p["lat"] + 1} for p in flown()]
    assert debrief(CHECKPOINTS, elsewhere)["notes"][0].startswith("The track takes off 60 nm from A")
    assert debrief(CHECKPOINTS, flown()[:20]) is None


def test_the_marks_are_the_pages_against_the_tolerances(d):
    m = marked(d)
    # The first leg held both; the second went 300 ft high, past 200.
    assert [leg["ok"] for leg in m["legs"]] == [True, False]
    assert m["passes"][0]["ok"] is True and m["passes"][0]["landed"] is False
    assert m["passes"][1]["landed"] is True
    assert m["passes"][0]["late_min"] == pytest.approx(0, abs=0.5)
    # Into the pattern: within 100 ft or not, by the figure.
    entry = m["patterns"][0]
    assert entry["off_ft"] == pytest.approx(entry["alt_ft"] - 1700)
    assert entry["ok"] is (abs(entry["off_ft"]) <= 100)
