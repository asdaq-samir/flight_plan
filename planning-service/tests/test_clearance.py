"""app.routers.clearance: a clearance's places found near the route, and
the names its recognizer is told to listen for."""
from app.routers import clearance
from app.schemas import ClearanceAsk, SpokenProcedureAsk

PLACES = [
    {"ident": "GEP", "name": "Gopher", "what": "navaid", "lat": 45.15, "lon": -93.37},
    {"ident": "DLH", "name": "Duluth", "what": "navaid", "lat": 46.80, "lon": -92.20},
    {"ident": "PYKLA", "what": "fix", "lat": 46.83, "lon": -91.85},
]
LISTED = {"airport": "KMSP", "cycle": "261029", "procedures": [
    {"kind": "departure", "id": "BUNYN1", "transitions": ["DLH", "KVUSI"]},
    {"kind": "arrival", "id": "GEP1", "transitions": ["FAR"]},
]}


def _near_route(monkeypatch):
    monkeypatch.setattr(clearance, "_places", lambda near: PLACES)
    monkeypatch.setattr(clearance, "_exact", lambda said, near: [])
    duluth = {"ident": "KDLH", "name": "Duluth International Airport", "lat": 46.84, "lon": -92.19}
    monkeypatch.setattr(clearance, "_airport", lambda said, near: duluth)
    monkeypatch.setattr(clearance.procedures, "procedures_at", lambda ident: LISTED)


def test_the_limit_route_and_sid_said_are_found_as_idents(monkeypatch):
    _near_route(monkeypatch)
    found = clearance.clearance_places(ClearanceAsk(
        near="44.88,-93.22;46.84,-92.19", dep="KMSP", limit="duluth airport", route=["gopher", "pickla wibble"],
        departure=SpokenProcedureAsk(name="bunyan", number="1", transition="duluth"),
    ))
    assert found["limit"]["ident"] == "KDLH"
    assert [[p["ident"] for p in run] for run in found["route"]] == [["GEP"], ["PYKLA", None]]
    assert found["route"][1][0]["sure"] is False
    # Among the field's own SIDs of that number, one sound alike is the one.
    assert found["departure"] == {"id": "BUNYN1", "transition": "DLH", "sure": True}


class _Response:
    headers: dict = {}


def test_the_words_to_listen_for_are_the_sids_the_navaids_and_the_fixes(monkeypatch):
    _near_route(monkeypatch)
    words = clearance.clearance_words(_Response(), near="44.88,-93.22", dep="KMSP")["words"]
    assert words == ["Bunyn departure", "Duluth", "Gopher", "Pykla"]
