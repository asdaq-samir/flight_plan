"""/api/checkpoint-notes: generating is a POST, and a pilot's own edit is
what that pilot sees while everyone else keeps the shared note."""
import json

from fastapi.testclient import TestClient
from vfr import checkpoint_notes

from app.main import app
from app.routers import notes

client = TestClient(app)

CHECKPOINT = {"lat": 45.0, "lon": -90.0, "id": "water@45.00000,-90.00000", "name": "Lake Mary", "category": "water",
              "along_track_nm": 12.0}


def _setup(monkeypatch, tmp_path):
    path = tmp_path / "notes.csv"
    monkeypatch.setattr(checkpoint_notes, "NOTES_PATH", path)
    monkeypatch.setattr(notes, "route_checkpoints", lambda r: ([CHECKPOINT], [CHECKPOINT], [[CHECKPOINT]]))
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


def test_a_shared_edit_saved_while_the_stream_runs_is_kept(monkeypatch, tmp_path):
    """Where nobody signs in every edit is shared, and one saved after the
    stream took its snapshot was buried under the generated text."""
    _setup(monkeypatch, tmp_path)

    def describe(cp, dep, prev_name, next_name):
        # The pilot saves while Claude is writing this checkpoint's note.
        checkpoint_notes.save_note(checkpoint_notes.route_key("C81", "KDLH"), 45.0, -90.0, "Edited: the island")
        return "Generated: the lake south of the highway"

    monkeypatch.setattr(notes, "_describe_checkpoint", describe)
    streamed = [m for m in _generate() if m["type"] == "checkpoint"][0]
    again = [m for m in _generate() if m["type"] == "checkpoint"][0]

    assert (streamed["source"], streamed["description"]) == ("saved", "Edited: the island")
    assert again["description"] == "Edited: the island"


def _claude_replies(monkeypatch, blocks, stop_reason):
    """notes' own Claude call, answered with these blocks and stop reason."""
    from types import SimpleNamespace
    messages = SimpleNamespace(create=lambda **kw: SimpleNamespace(content=blocks, stop_reason=stop_reason))
    monkeypatch.setattr(notes.anthropic, "Anthropic", lambda: SimpleNamespace(messages=messages))


def test_a_note_is_the_text_block_after_the_thinking(monkeypatch):
    from types import SimpleNamespace
    _claude_replies(monkeypatch, [SimpleNamespace(type="thinking", thinking=""),
                                  SimpleNamespace(type="text", text=" Look for the lake south of the highway. ")], "end_turn")
    assert notes._describe_checkpoint(CHECKPOINT, "C81", None, None) == "Look for the lake south of the highway."


def test_a_note_cut_off_at_the_cap_is_refused_rather_than_saved(monkeypatch):
    """The note is saved as the one every pilot sees: half a sentence is
    worse than the row's own "no note" and a pilot's edit."""
    import pytest
    from types import SimpleNamespace
    _claude_replies(monkeypatch, [SimpleNamespace(type="text", text="Look for the lake south of")], "max_tokens")
    with pytest.raises(RuntimeError, match="max_tokens"):
        notes._describe_checkpoint(CHECKPOINT, "C81", None, None)


def test_a_deleted_account_takes_its_own_notes_and_only_those(monkeypatch, tmp_path):
    path = tmp_path / "notes.csv"
    monkeypatch.setattr(checkpoint_notes, "NOTES_PATH", path)
    checkpoint_notes.save_note("C81->KDLH", 45.0, -90.0, "Shared", path=path)
    checkpoint_notes.save_note("C81->KDLH", 45.0, -90.0, "Mine", pilot="42", path=path)

    resp = client.delete("/api/checkpoint-notes/mine", headers={"X-Pilot-Id": "42"})
    assert resp.status_code == 200 and resp.json() == {"removed": 1}
    assert [n["description"] for n in checkpoint_notes.load_notes(path=path)] == ["Shared"]
    # Nobody named: refused, rather than read as the shared notes' empty pilot.
    assert client.delete("/api/checkpoint-notes/mine").status_code == 422

