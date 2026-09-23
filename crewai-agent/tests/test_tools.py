"""The crew's tools answer with the planner's own nav log, fetched
through vfr.planner_client; the planner is mocked here."""
import json

import pytest

from app import tools


@pytest.fixture
def planner(monkeypatch):
    calls = []

    def record(name, answer):
        def fake(*args):
            calls.append((name, *args))
            return answer
        return fake

    monkeypatch.setattr(tools.planner_client, "checkpoints",
                        record("checkpoints", {"candidates": [{"name": "A"}, {"name": "B"}], "selected": [{"name": "B"}]}))
    monkeypatch.setattr(tools.planner_client, "altitude_breakdown",
                        record("altitude_breakdown", {"recommended_ft": 4500.0}))
    monkeypatch.setattr(tools.planner_client, "plan", record("plan", {
        "legs": [{"from": "C81", "to": "B"}, {"from": "B", "to": "KDLH"}],
        "totals": {"fuel_gal": 23.3},
        "candidates": [{"name": "A"}, {"name": "B"}],
    }))
    return calls


def test_checkpoints_are_the_planners_selection_not_every_candidate(planner):
    assert json.loads(tools.get_route_checkpoints.func("C81", "KDLH")) == [{"name": "B"}]


def test_the_altitude_is_the_planners_and_the_aircraft_is_optional(planner):
    assert json.loads(tools.get_recommended_altitude.func("C81", "KDLH")) == {"recommended_ft": 4500.0}
    assert planner == [("altitude_breakdown", "C81", "KDLH", None)]


def test_the_legs_are_the_planners_at_the_given_altitude_airport_to_airport(planner):
    answer = json.loads(tools.compute_dead_reckoning_legs.func("C81", "KDLH", 5500, "pa28"))

    assert answer == {"legs": [{"from": "C81", "to": "B"}, {"from": "B", "to": "KDLH"}], "totals": {"fuel_gal": 23.3}}
    assert planner == [("plan", "C81", "KDLH", 5500, "pa28")]
