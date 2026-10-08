"""The graph's own logic, with the database and Claude left out: nothing
here opens a connection or spends a token."""
from app import graph


def test_the_prompt_is_the_shared_one_with_this_agents_memory_added():
    """The wording is vfr.narrative's, the same crewai-agent writes from;
    what this agent adds is its own memory of similar routes."""
    state = {
        "departure_ident": "C81", "destination_ident": "KDLH", "altitude_ft": 4500.0, "altitude_selection": None,
        "legs": [{"from": "C81", "to": "KDLH", "distance_nm": 290.0, "magnetic_heading_deg": 335.0,
                  "groundspeed_kt": 110.0, "ete_min": 158.0, "fuel_gal": 22.4}],
        "similar_briefings": [{"departure_ident": "C81", "destination_ident": "KMSP", "briefing": "Depart 27."}],
    }
    text = graph.briefing_prompt(state)
    assert "- C81 -> KDLH: 290.0nm, heading 335M" in text
    assert "Similar past route briefings" in text and "C81->KMSP: Depart 27." in text


def test_a_failed_narration_is_not_stored_as_precedent(monkeypatch):
    stored = []
    monkeypatch.setattr(graph.db, "store_briefing", lambda *args: stored.append(args))
    graph.store_memory({
        "departure_ident": "C81", "destination_ident": "KDLH",
        "briefing": "Narrative generation failed (overloaded).", "briefing_failed": True,
    })
    assert stored == []


def test_a_real_narration_is_stored(monkeypatch):
    stored = []
    monkeypatch.setattr(graph.db, "store_briefing", lambda *args: stored.append(args))
    graph.store_memory({"departure_ident": "C81", "destination_ident": "KDLH", "briefing": "Depart runway 27."})
    assert stored == [("C81", "KDLH", "Depart runway 27.")]


def test_the_unnarrated_graph_has_no_claude_node():
    """What the MCP tools run: everything up to the memory lookup, and
    nothing that needs an Anthropic key."""
    assert "generate_briefing" not in graph.build_graph(narrate=False).nodes
    assert "generate_briefing" in graph.build_graph().nodes


STATE = {
    "departure_ident": "C81", "destination_ident": "KDLH", "altitude_ft": 4500.0, "altitude_selection": None,
    "legs": [{"from": "C81", "to": "KDLH", "distance_nm": 290.0, "magnetic_heading_deg": 335.0,
              "groundspeed_kt": 110.0, "ete_min": 158.0, "fuel_gal": 22.4}],
}


class _Stream:
    """A stand-in for anthropic's message stream: these text deltas, then
    a final message with this stop reason."""

    def __init__(self, parts, stop_reason):
        self.text_stream, self.stop_reason = iter(parts), stop_reason

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get_final_message(self):
        from types import SimpleNamespace
        return SimpleNamespace(stop_reason=self.stop_reason)


def _claude_streams(monkeypatch, parts, stop_reason):
    from types import SimpleNamespace
    messages = SimpleNamespace(stream=lambda **kw: _Stream(parts, stop_reason))
    monkeypatch.setattr(graph.anthropic, "Anthropic", lambda: SimpleNamespace(messages=messages))
    monkeypatch.setattr(graph, "get_stream_writer", lambda: (lambda chunk: None))


def test_a_whole_briefing_is_the_briefing(monkeypatch):
    _claude_streams(monkeypatch, ["Depart C81 ", "at 4,500 ft."], "end_turn")
    assert graph.generate_briefing(STATE) == {"briefing": "Depart C81 at 4,500 ft."}


def test_a_briefing_cut_off_at_the_cap_is_a_failure_and_not_kept(monkeypatch):
    """Cut off before its weather, it would read as whole to a pilot and
    become the next briefing's precedent; as a failure it is neither."""
    _claude_streams(monkeypatch, ["Depart C81 at 4,500 ft. Weather along the route:"], "max_tokens")
    out = graph.generate_briefing(STATE)
    assert out["briefing_failed"] and "cut off" in out["briefing"]
