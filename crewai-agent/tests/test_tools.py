"""The crew's tools answer with the planner's own nav log, fetched
through vfr.planner_client; the planner is mocked here."""
import json

import pytest

from app import tools


@pytest.fixture
def planner(monkeypatch):
    calls = []

    def record(name, answer):
        def fake(*args, **kwargs):
            calls.append((name, *args, *(f"{k}={v}" for k, v in kwargs.items() if v is not None)))
            return answer
        return fake

    monkeypatch.setattr(tools.planner_client, "checkpoints",
                        record("checkpoints", {"candidates": [{"name": "A"}, {"name": "B"}], "selected": [{"name": "B"}]}))
    monkeypatch.setattr(tools.planner_client, "plan", record("plan", {
        "legs": [{"from": "C81", "to": "B", "altitude_ft": 3500.0}, {"from": "B", "to": "KDLH", "altitude_ft": 5500.0}],
        "totals": {"fuel_gal": 23.3},
        "candidates": [{"name": "A"}, {"name": "B"}],
        "altitude_ft": 3500.0, "altitude_choice": "lowest",
        "altitude_options": [{"kind": "lowest"}, {"kind": "highest"}, {"kind": "fastest"}],
        # The route-wide recommendation can be None where the plan still
        # flies, stepping under a shelf.
        "altitude_selection": {"recommended_ft": None, "segments": [{}, {}]},
    }))
    return calls


def test_checkpoints_are_the_planners_selection_not_every_candidate(planner):
    assert json.loads(tools.get_route_checkpoints.func("C81", "KDLH")) == [{"name": "B"}]


def test_the_altitude_is_the_one_the_planners_plan_flies(planner):
    answer = json.loads(tools.get_recommended_altitude.func("C81", "KDLH"))

    assert answer["altitude_ft"] == 3500.0 and answer["altitude_choice"] == "lowest"
    assert answer["altitude_selection"]["recommended_ft"] is None
    assert planner == [("plan", "C81", "KDLH", None, None)]


def test_the_legs_are_the_planners_own_airport_to_airport_with_no_altitude_asked(planner):
    """They were flown flat at an altitude the crew passed in; LangGraph's
    build flies the planner's plan."""
    answer = json.loads(tools.compute_dead_reckoning_legs.func("C81", "KDLH", "pa28"))

    assert [leg["altitude_ft"] for leg in answer["legs"]] == [3500.0, 5500.0]
    assert answer["totals"] == {"fuel_gal": 23.3}
    assert planner == [("plan", "C81", "KDLH", None, "pa28")]
