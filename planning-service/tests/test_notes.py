"""/api/checkpoint-notes: generating is a POST, and a pilot's own edit is
what that pilot sees while everyone else keeps the shared note."""
import json

from fastapi.testclient import TestClient
from vfr import checkpoint_notes

from app.main import app
from app.routers import notes

client = TestClient(app)

CHECKPOINT = {"lat": 45.0, "lon": -90.0, "osm_id": "node/1", "name": "Lake Mary", "category": "lake",
              "along_track_nm": 12.0}


def _setup(monkeypatch, tmp_path):
    path = tmp_path / "notes.csv"
    monkeypatch.setattr(checkpoint_notes, "NOTES_PATH", path)
    monkeypatch.setattr(notes, "scored_and_selected", lambda dep, dest: ([CHECKPOINT], [CHECKPOINT]))
    calls = []

    def describe(cp, dep, prev_name, next_name):
        calls.append(cp["name"])
        return "Generated: the lake south of the highway"

    monkeypatch.setattr(notes, "_describe_checkpoint", describe)
    return calls


def _generate(headers=None):
    resp = client.post("/api/checkpoint-notes/generate",
                       json={"departure_ident": "C81", "destination_ident": "KDLH"}, headers=headers or {})
    assert resp.status_code == 200
    return [json.loads(line) for line in resp.text.splitlines() if line]


def test_generation_is_not_reachable_with_a_get():
    assert client.get("/api/checkpoint-notes", params={"dep": "C81", "dest": "KDLH"}).status_code == 405


def test_a_generated_note_is_shared_and_generated_once(monkeypatch, tmp_path):
    calls = _setup(monkeypatch, tmp_path)

    first = [m for m in _generate() if m["type"] == "checkpoint"]
    second = [m for m in _generate({"X-Pilot-Id": "42"}) if m["type"] == "checkpoint"]

    assert calls == ["Lake Mary"]
    assert first[0]["source"] == "generated"
    assert second[0]["source"] == "saved"
    assert second[0]["description"] == "Generated: the lake south of the highway"


def test_a_pilots_edit_is_theirs(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path)
    _generate()
    resp = client.post("/api/checkpoint-notes", headers={"X-Pilot-Id": "42"}, json={
        "departure_ident": "C81", "destination_ident": "KDLH", "lat": 45.0, "lon": -90.0,
        "description": "Mine: look for the island"})
    assert resp.status_code == 200

    mine = [m for m in _generate({"X-Pilot-Id": "42"}) if m["type"] == "checkpoint"][0]
    theirs = [m for m in _generate({"X-Pilot-Id": "7"}) if m["type"] == "checkpoint"][0]

    assert mine["description"] == "Mine: look for the island"
    assert theirs["description"] == "Generated: the lake south of the highway"
