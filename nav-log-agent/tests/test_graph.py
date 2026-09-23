"""The graph's own logic, with the database and Claude left out: nothing
here opens a connection or spends a token."""
from app import graph


def _leg(**overrides) -> dict:
    leg = {
        "from": "C81", "to": "LAKE GENEVA", "distance_nm": 12.34, "magnetic_heading_deg": 331.6,
        "groundspeed_kt": 104.2, "ete_min": 7.1, "fuel_gal": 1.0,
    }
    leg.update(overrides)
    return leg


def test_a_flyable_leg_is_written_with_its_numbers():
    line = graph._format_legs([_leg()])
    assert line == "- C81 -> LAKE GENEVA: 12.3nm, heading 332M, GS 104kt, ETE 7min, fuel 1.0gal"


def test_an_unflyable_leg_is_named_rather_than_formatted_as_a_number():
    line = graph._format_legs([_leg(ete_min=None, groundspeed_kt=None, fuel_gal=None)])
    assert "UNFLYABLE" in line
    assert "GS" not in line


def test_a_typed_altitude_says_nothing_was_selected():
    assert "set this altitude by hand" in graph._format_altitude_selection(None)


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
