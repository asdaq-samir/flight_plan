"""vfr.planner_client: how both agents get a route's nav log from
planning-service. The HTTP calls are mocked on the module's own Session,
the same way tests/test_model_client.py does it."""
import pytest
import requests

from vfr import planner_client


class _Response:
    def __init__(self, status_code: int, body=None):
        self.status_code = status_code
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("not json")
        return self._body


def _getting(monkeypatch, response, calls=None):
    def fake_get(url, params, timeout):
        if calls is not None:
            calls.append((url, params))
        if isinstance(response, Exception):
            raise response
        return response

    monkeypatch.setattr(planner_client._session, "get", fake_get)


def test_a_plan_is_asked_for_with_only_what_the_caller_gave(monkeypatch):
    calls = []
    _getting(monkeypatch, _Response(200, {"legs": []}), calls)

    assert planner_client.plan("C81", "KDLH") == {"legs": []}
    assert calls == [(f"{planner_client.PLANNING_SERVICE_URL}/api/plan", {"dep": "C81", "dest": "KDLH"})]


def test_a_typed_altitude_and_an_aircraft_are_passed_through(monkeypatch):
    calls = []
    _getting(monkeypatch, _Response(200, {"legs": []}), calls)

    planner_client.plan("C81", "KDLH", altitude_ft=4500, aircraft_name="pa28")

    assert calls[0][1] == {"dep": "C81", "dest": "KDLH", "altitude_ft": 4500, "aircraft": "pa28"}


def test_the_planners_own_detail_is_the_error(monkeypatch):
    detail = "No legal VFR cruising altitude exists for this route and aircraft. Supply altitude_ft explicitly."
    _getting(monkeypatch, _Response(422, {"detail": detail}))

    with pytest.raises(planner_client.PlannerError) as err:
        planner_client.plan("C81", "KDLH")

    assert err.value.status == 422
    assert str(err.value) == detail


def test_a_status_without_a_detail_still_says_which(monkeypatch):
    _getting(monkeypatch, _Response(500))

    with pytest.raises(planner_client.PlannerError, match="answered 500"):
        planner_client.checkpoints("C81", "KDLH")


def test_an_unreachable_planner_is_a_502(monkeypatch):
    _getting(monkeypatch, requests.ConnectionError("refused"))

    with pytest.raises(planner_client.PlannerError) as err:
        planner_client.checkpoints("C81", "KDLH")

    assert err.value.status == 502
    assert "Could not reach planning-service" in str(err.value)


def test_what_the_pilot_planned_with_is_passed_through(monkeypatch):
    """Without these the planner answers for a departure now, its own
    plan and the stock profile -- not the nav log the pilot sees."""
    calls = []
    _getting(monkeypatch, _Response(200, {"legs": []}), calls)

    planner_client.plan("C81", "KDLH", depart="2026-09-25T13:00:00Z", altitude_choice="fastest",
                        cruise_tas_kt=118, fuel_burn_gph=9.0, usable_fuel_gal=50)

    (_, params), = calls
    assert params == {"dep": "C81", "dest": "KDLH", "depart": "2026-09-25T13:00:00Z", "altitude_choice": "fastest",
                      "cruise_tas_kt": 118, "fuel_burn_gph": 9.0, "usable_fuel_gal": 50}


def test_the_client_waits_past_the_planners_own_bound():
    """A plan the planner is still working on comes back as its own 504
    within its bound; the client must still be listening then."""
    from vfr.config import PLAN_LIMIT_S

    assert planner_client.TIMEOUT_S > PLAN_LIMIT_S
