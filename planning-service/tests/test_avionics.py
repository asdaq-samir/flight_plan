"""/api/waypoint-codes: a route's points' Garmin types and ICAO regions,
for the flight plan files the web app writes for a panel GPS."""
from fastapi.testclient import TestClient
from vfr import waypoint_codes

from app.main import app

client = TestClient(app)


def test_each_point_in_order(monkeypatch):
    seen = []

    def code_of(ident, airport, lat, lon):
        seen.append((ident, airport, lat, lon))
        return {"ident": ident, "type": "AIRPORT" if airport else None, "region": "K3" if airport else None}

    monkeypatch.setattr(waypoint_codes, "code_of", code_of)
    answer = client.get("/api/waypoint-codes", params={"points": "A:KDLH:46.8421:-92.1936,F:VPXYZ:46.5:-92.5"})
    assert answer.status_code == 200
    assert answer.json() == {"points": [{"ident": "KDLH", "type": "AIRPORT", "region": "K3"},
                                        {"ident": "VPXYZ", "type": None, "region": None}]}
    assert seen == [("KDLH", True, 46.8421, -92.1936), ("VPXYZ", False, 46.5, -92.5)]


def test_what_is_not_a_point_is_a_422():
    assert client.get("/api/waypoint-codes", params={"points": "KDLH"}).status_code == 422
    assert client.get("/api/waypoint-codes", params={"points": "X:KDLH:1:2"}).status_code == 422
    assert client.get("/api/waypoint-codes", params={"points": "A:K D:1:2"}).status_code == 422
