"""Where the agent's nav log comes from: planning-service's /api/plan,
through vfr.planner_client, and nowhere else. The planner and the
database are mocked; nothing here needs either running."""
import pytest
from starlette.testclient import TestClient

from app import graph, mcp_server

# The planner's nav log for a short route, shaped as /api/plan sends it:
# departure airport -> one checkpoint -> destination, the first leg
# carrying the climb from the field.
PLAN = {
    "selected": [{"name": "LAKE GENEVA", "category": "water", "lat": 42.6, "lon": -88.5, "along_track_nm": 21.0}],
    "altitude_ft": 4500.0,
    "altitude_choice": "lowest",
    "altitude_selection": {"floor_ft": 2200.0, "band_ceiling_ft": 9500, "recommended_ft": 4500.0},
    "legs": [
        {"from": "C81", "to": "LAKE GENEVA", "distance_nm": 21.0, "altitude_ft": 4500.0, "climb_min": 4.2,
         "magnetic_heading_deg": 280.0, "groundspeed_kt": 104.0, "ete_min": 12.9, "fuel_gal": 2.0},
        {"from": "LAKE GENEVA", "to": "KDLH", "distance_nm": 270.0, "altitude_ft": 4500.0, "climb_min": 0.0,
         "magnetic_heading_deg": 336.0, "groundspeed_kt": 108.0, "ete_min": 150.0, "fuel_gal": 21.3},
    ],
    "totals": {"distance_nm": 291.0, "ete_min": 162.9, "fuel_gal": 23.3, "fuel_required_gal": 27.6},
}


@pytest.fixture
def planner(monkeypatch):
    """planner_client.plan, recording what it was asked for."""
    calls = []

    def fake_plan(dep, dest, altitude_ft=None, aircraft_name=None):
        calls.append((dep, dest, altitude_ft, aircraft_name))
        return PLAN

    monkeypatch.setattr(graph.planner_client, "plan", fake_plan)
    monkeypatch.setattr(graph.db, "retrieve_similar_briefings", lambda query: [])
    return calls


def test_the_graph_takes_the_planners_nav_log_unchanged(planner):
    state = graph.fetch_nav_log({"departure_ident": "C81", "destination_ident": "KDLH"})

    assert state["legs"] == PLAN["legs"]
    assert state["selected_checkpoints"] == PLAN["selected"]
    assert state["altitude_ft"] == 4500.0
    assert state["totals"] == PLAN["totals"]


def test_only_what_the_caller_gave_is_asked_for(planner):
    graph.fetch_nav_log({"departure_ident": "C81", "destination_ident": "KDLH"})
    graph.fetch_nav_log({"departure_ident": "C81", "destination_ident": "KDLH", "altitude_ft": 5500, "aircraft_name": "pa28"})

    assert planner == [("C81", "KDLH", None, None), ("C81", "KDLH", 5500, "pa28")]


def test_the_mcp_tool_hands_back_the_nav_log_a_pilot_sees(planner):
    """The regression this replaced: the agent used to build its own legs
    between the checkpoints alone -- 20 legs where the planner flew 22,
    none to or from the airports, no climbs."""
    result = mcp_server.assemble_nav_log("C81", "KDLH")

    assert result["legs"] == PLAN["legs"]
    assert result["legs"][0]["from"] == "C81"
    assert result["legs"][-1]["to"] == "KDLH"
    assert result["totals"] == PLAN["totals"]
    assert "C81 -> LAKE GENEVA" in result["briefing_prompt"]
    assert planner == [("C81", "KDLH", None, None)]


def _compare_client() -> TestClient:
    return TestClient(mcp_server.mcp.sse_app(sse_path="/mcp/sse", message_path="/mcp/messages/", host="0.0.0.0"))


def test_a_narrative_request_missing_its_legs_is_a_422_naming_the_field(monkeypatch):
    ran = []
    monkeypatch.setattr(mcp_server, "_narrative_lines", lambda graph, state: ran.append(state) or iter(()))

    response = _compare_client().post("/compare", json={
        "departure_ident": "C81", "destination_ident": "KDLH", "altitude_ft": 4500,
    })

    assert response.status_code == 422
    assert response.json()["detail"] == "invalid nav log: legs: Field required"
    assert ran == []


def test_a_narrative_request_that_is_not_json_is_a_422(monkeypatch):
    response = _compare_client().post("/compare", content=b"not json", headers={"content-type": "application/json"})

    assert response.status_code == 422
    assert response.json()["detail"] == "invalid nav log: the request body is not JSON"


def test_a_valid_narrative_request_starts_the_graph_at_the_memory_lookup(monkeypatch):
    ran = []
    monkeypatch.setattr(mcp_server, "_narrative_lines", lambda graph, state: ran.append((graph, state)) or iter(()))

    response = _compare_client().post("/compare", json={
        "departure_ident": "C81", "destination_ident": "KDLH", "altitude_ft": 4500, "legs": PLAN["legs"],
    })

    assert response.status_code == 200
    started_graph, state = ran[0]
    assert started_graph is mcp_server._graph_from_nav_log
    assert state["legs"] == PLAN["legs"]
    assert "aircraft_name" not in state


def test_the_graph_says_whose_altitudes_the_planner_flew(planner, monkeypatch):
    monkeypatch.setitem(PLAN, "altitude_choice", "lowest")
    assert graph.fetch_nav_log({"departure_ident": "C81", "destination_ident": "KDLH"})["flown"] == "lowest"
    monkeypatch.setitem(PLAN, "altitude_choice", None)
    assert graph.fetch_nav_log(
        {"departure_ident": "C81", "destination_ident": "KDLH", "altitude_ft": 5500},
    )["flown"] == "custom"
