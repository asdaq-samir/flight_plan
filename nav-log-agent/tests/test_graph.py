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
