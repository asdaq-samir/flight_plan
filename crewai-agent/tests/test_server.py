"""The HTTP wrapper, with the crew itself left out: nothing here calls
Claude. The prompt it hands the crew is vfr.narrative's, tested with
vfr (tests/test_narrative.py)."""
from fastapi.testclient import TestClient

from app import server

client = TestClient(server.app)

NAV_LOG = {
    "departure_ident": "C81",
    "destination_ident": "KDLH",
    "aircraft_name": "c172",
    "altitude_ft": 4500,
    "altitude_selection": None,
    "legs": [{
        "from": "C81", "to": "KDLH", "distance_nm": 290.0, "magnetic_heading_deg": 335.0,
        "groundspeed_kt": 110.0, "ete_min": 158.0, "fuel_gal": 22.4,
    }],
}


def test_a_narrative_request_without_legs_is_refused_before_a_crew_is_built(monkeypatch):
    built = []
    monkeypatch.setattr(server, "build_crew", lambda *args, **kwargs: built.append(args))
    body = {k: v for k, v in NAV_LOG.items() if k != "legs"}
    response = client.post("/compare", json=body)
    assert response.status_code == 422
    assert built == []


def test_a_narrative_request_hands_the_crew_the_nav_log_and_no_tools(monkeypatch):
    calls = []

    def fake_build_crew(dep, dest, aircraft, nav_log=None, stream=False):
        calls.append((dep, dest, aircraft, nav_log, stream))
        raise RuntimeError("stop before any crew runs")

    monkeypatch.setattr(server, "build_crew", fake_build_crew)
    try:
        client.post("/compare", json=NAV_LOG)
    except RuntimeError:
        pass
    dep, dest, aircraft, nav_log, stream = calls[0]
    assert (dep, dest, aircraft, stream) == ("C81", "KDLH", "c172", True)
    assert nav_log["legs"] == NAV_LOG["legs"]
