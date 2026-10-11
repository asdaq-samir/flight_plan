"""GET /api/alternate through its response model, vfr.alternates stubbed:
the destination's check, the pilot's alternate checked at its own ETA --
the destination's plus the way there at the cruise speed -- and the
fields offered."""
from datetime import datetime, timezone

from fastapi.testclient import TestClient
from vfr import alternates

from app.main import app

client = TestClient(app)
ETA = datetime(2026, 10, 12, 18, 0, tzinfo=timezone.utc)


def test_the_destination_the_pilots_alternate_and_the_fields_offered(monkeypatch):
    asked = {}

    def destination(ident, eta):
        asked["destination"] = (ident, eta)
        return {"ident": ident, "approach": True, "required": True, "reasons": ["The TAF has a 1,500 ft ceiling."]}

    def alternate(ident, eta):
        asked["alternate"] = (ident, eta)
        return {"ident": ident, "approach": True, "precision": True, "good": True, "reasons": [],
                "minimums": {"ceiling_ft": 600, "visibility_sm": 2}}

    monkeypatch.setattr(alternates, "destination", destination)
    monkeypatch.setattr(alternates, "alternate", alternate)
    monkeypatch.setattr(alternates, "nearby", lambda at, ident, eta_of: [])
    resp = client.get("/api/alternate", params={"dest": "KDLH", "eta": ETA.isoformat(), "alternate": "KMSN", "tas_kt": 120})
    assert resp.status_code == 200
    body = resp.json()
    assert body["destination"]["required"] is True
    assert body["alternate"]["ident"] == "KMSN" and body["alternate"]["good"] is True
    assert body["alternate"]["distance_nm"] > 200
    # KMSN's ETA: KDLH's plus its distance at 120 kt.
    assert asked["destination"][1] == ETA.timestamp()
    assert abs(asked["alternate"][1] - ETA.timestamp() - body["alternate"]["distance_nm"] / 120 * 3600) < 60


def test_an_unknown_alternate_is_a_404(monkeypatch):
    from vfr import airports

    from .conftest import airport

    def known(ident, **kw):
        if ident.upper() == "KXXX":
            raise ValueError("not found")
        return airport(ident.upper())

    monkeypatch.setattr(airports, "get_airport", known)
    resp = client.get("/api/alternate", params={"dest": "KDLH", "eta": ETA.isoformat(), "alternate": "KXXX"})
    assert resp.status_code == 404
