"""The nav-log-assembler graph: scored checkpoints (model-service) ->
the subset actually worth flying (vfr.checkpoints) -> recommended
cruise altitude (vfr.altitude, extracted from notebook 08 -- see
[[project-navlog-agent]] in project memory) -> dead-reckoning legs
(vfr.navlog, see [[project-navlog-dr-math]]) -> similar past routes
(pgvector) -> a Claude-generated briefing -> store that briefing back into
memory for next time.

The Brief tab already has all of the first four steps' output on screen
(the planner computed it, cached), so its calls start the graph at
retrieve_memory with the nav log supplied -- see build_graph.
"""
import os
from typing import TypedDict

import anthropic
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph

from vfr import aircraft, airports, altitude, checkpoints as checkpoint_selection, model_client, navlog

from . import db

CLAUDE_MODEL = os.environ.get("NAV_LOG_AGENT_MODEL", "claude-sonnet-5")
# A briefing a pilot reads in a minute, and one Claude writes in seconds:
# the narrative used to run to 1,024 tokens of prose, ten seconds or
# more of generation on its own.
BRIEFING_WORDS = 200
BRIEFING_MAX_TOKENS = 512


class NavLogState(TypedDict, total=False):
    """The graph's shared state, threaded through every node below --
    each node reads some of these keys and returns a dict of the ones it
    adds/updates, per LangGraph's StateGraph convention.
    """

    departure_ident: str
    destination_ident: str
    altitude_ft: float  # optional input override; computed by select_altitude if omitted
    aircraft_name: str
    checkpoints: list[dict]  # every scored candidate in the corridor
    selected_checkpoints: list[dict]  # the subset actually flown, see select_checkpoints
    altitude_selection: dict
    legs: list[dict]
    similar_briefings: list[dict]
    briefing: str
    briefing_failed: bool  # set by generate_briefing's own except branch


def fetch_checkpoints(state: NavLogState) -> dict:
    """Graph entry node: gets the trained model's scored checkpoints for
    the requested route from vfr.model_client (HTTP locally, SageMaker on AWS).
    """
    checkpoints = model_client.get_checkpoints(state["departure_ident"], state["destination_ident"])
    return {"checkpoints": checkpoints}


def select_checkpoints(state: NavLogState) -> dict:
    """Narrows the model's full scored ranking down to the handful of
    checkpoints a pilot actually flies.

    This node did not exist until 2026-09-10, and its absence was the gap
    between "the model works" and "the product works": assemble_legs used
    to consume the entire scored list, so a 206-candidate route produced
    205 legs and the predicted scores were carried through the whole
    system without ever deciding anything. See vfr.checkpoints.
    """
    selected = checkpoint_selection.select_checkpoints(state["checkpoints"])
    return {"selected_checkpoints": selected}


def select_altitude(state: NavLogState) -> dict:
    """Always computes the recommendation (floor/ceiling/hazards are useful
    briefing context regardless), but only uses it as the leg-planning
    altitude if the caller didn't explicitly supply altitude_ft.
    """
    dep = airports.get_airport(state["departure_ident"])
    dest = airports.get_airport(state["destination_ident"])
    profile = aircraft.load_aircraft_profile(state.get("aircraft_name", "c172"))
    result = altitude.select_cruise_altitude((dep["lat"], dep["lon"]), (dest["lat"], dest["lon"]), profile)

    altitude_ft = state.get("altitude_ft")
    if altitude_ft is None:
        if result["recommended_ft"] is None:
            raise ValueError(
                f"No valid VFR altitude for {state['departure_ident']}->{state['destination_ident']} "
                f"(floor {result['floor_ft']}ft, ceiling {result['band_ceiling_ft']}ft) -- "
                "and none was supplied explicitly either."
            )
        altitude_ft = result["recommended_ft"]

    return {"altitude_selection": result, "altitude_ft": altitude_ft}


def assemble_legs(state: NavLogState) -> dict:
    """Builds one dead-reckoning leg (vfr.navlog.legs) between each
    consecutive pair of *selected* checkpoints, in route order.

    Reads selected_checkpoints, not checkpoints -- the full scored list is
    a ranking of everything in the corridor, not a flight plan.
    """
    profile = aircraft.load_aircraft_profile(state.get("aircraft_name", "c172"))
    checkpoints = sorted(state["selected_checkpoints"], key=lambda c: c["along_track_nm"])
    return {"legs": navlog.legs(checkpoints, state["altitude_ft"], profile)}


def retrieve_memory(state: NavLogState) -> dict:
    """Looks up briefings for similar past routes via pgvector similarity
    search, so generate_briefing has real precedent to draw on."""
    query = f"{state['departure_ident']} to {state['destination_ident']}"
    return {"similar_briefings": db.retrieve_similar_briefings(query)}


def _format_legs(legs: list[dict]) -> str:
    """One line per leg. An unflyable leg (a headwind at or above cruise
    TAS -- ETE, fuel and groundspeed are None) is named as such rather
    than formatted as a number."""
    lines = []
    for leg in legs:
        if leg.get("ete_min") is None:
            lines.append(
                f"- {leg['from']} -> {leg['to']}: {leg['distance_nm']:.1f}nm, "
                "UNFLYABLE at this altitude (headwind at or above cruise TAS)"
            )
            continue
        lines.append(
            f"- {leg['from']} -> {leg['to']}: {leg['distance_nm']:.1f}nm, "
            f"heading {leg['magnetic_heading_deg']:.0f}M, GS {leg['groundspeed_kt']:.0f}kt, "
            f"ETE {leg['ete_min']:.0f}min, fuel {leg['fuel_gal']:.1f}gal"
        )
    return "\n".join(lines)


def _format_memory(similar_briefings: list[dict]) -> str:
    if not similar_briefings:
        return "(no similar past routes yet)"
    return "\n".join(
        f"- {b['departure_ident']}->{b['destination_ident']}: {b['briefing'][:200]}" for b in similar_briefings
    )


def _format_altitude_selection(sel: dict | None) -> str:
    if not sel:
        return "(the pilot set this altitude by hand; nothing was auto-selected)"
    lines = [
        f"Terrain/obstacle floor: {sel['floor_ft']:.0f}ft",
        f"Airspace/freezing-level/service-ceiling band: {sel['band_ceiling_ft']}ft",
    ]
    if sel.get("low_ceiling_or_visibility"):
        lines.append(
            f"GO/NO-GO: ceiling {sel['min_ceiling_ft']}ft / visibility {sel['min_visibility_sm']}SM "
            "near the route is below typical VFR minimums"
        )
    if sel.get("hazards"):
        lines.append(f"GO/NO-GO: {len(sel['hazards'])} SIGMET/AIRMET(s) intersect the route")
    return "\n".join(lines)


def briefing_prompt(state: NavLogState) -> str:
    """The one prompt both agents write from -- crewai-agent hands the
    same text to its crew, so the two frameworks are compared on the
    same task, not on two prompts."""
    return (
        f"Write a concise VFR pilot briefing, under {BRIEFING_WORDS} words, for a flight from "
        f"{state['departure_ident']} to {state['destination_ident']} at {state['altitude_ft']:.0f}ft. "
        "Plain prose in short paragraphs -- no Markdown headings, bold or bullet lists; it is shown as plain text.\n\n"
        f"Altitude selection:\n{_format_altitude_selection(state.get('altitude_selection'))}\n\n"
        f"Dead-reckoning legs:\n{_format_legs(state['legs'])}\n\n"
        f"Similar past route briefings (for context/consistency, not to copy verbatim):\n"
        f"{_format_memory(state.get('similar_briefings', []))}"
    )


def generate_briefing(state: NavLogState) -> dict:
    """Turns the altitude selection, legs, and retrieved memory into a
    natural-language pilot briefing via a single Claude API call -- the
    only node that actually needs the LLM; everything upstream is
    deterministic Python.

    Streamed: every text delta goes to LangGraph's custom stream writer
    as it arrives, so a caller running the graph with
    stream_mode="custom" (the /compare route) can show the briefing
    being written instead of a spinner for the whole of it. Under a
    plain invoke() (the MCP tool, the CLI) the writer is a no-op and the
    node just returns the finished text. Thinking blocks, when the model
    emits them, are not part of text_stream, so nothing here has to
    skip them.

    A failure here (a rate limit, an outage) falls back to a plain-text
    notice instead of raising: unlike every node before this one, losing
    the narrative doesn't make the briefing useless, so it shouldn't
    discard the checkpoints/altitude/legs those nodes already computed.
    """
    client = anthropic.Anthropic()
    writer = get_stream_writer()
    parts: list[str] = []
    try:
        with client.messages.stream(
            model=CLAUDE_MODEL,
            max_tokens=BRIEFING_MAX_TOKENS,
            messages=[{"role": "user", "content": briefing_prompt(state)}],
        ) as stream:
            for text in stream.text_stream:
                parts.append(text)
                writer({"type": "delta", "text": text})
        briefing = "".join(parts).strip()
        if not briefing:
            raise RuntimeError("Claude response had no text")
        return {"briefing": briefing}
    except (anthropic.APIError, RuntimeError) as err:
        return {
            "briefing": f"Narrative generation failed ({err}). Checkpoints, altitude, and legs above are still valid.",
            "briefing_failed": True,
        }


def store_memory(state: NavLogState) -> dict:
    """Embeds and saves this run's briefing, so retrieve_memory can find
    it as precedent for a future similar route. Skipped when
    generate_briefing fell back to its own failure notice -- that text
    is not a real briefing, and retrieve_memory has no way to tell the
    two apart later, so storing it would surface as false "precedent"
    for the next pilot on a similar route.
    """
    if state.get("briefing_failed"):
        return {}
    db.store_briefing(state["departure_ident"], state["destination_ident"], state["briefing"])
    return {}


def build_graph(from_nav_log: bool = False):
    """Wires the nodes above into the fixed sequence described in the
    module docstring and compiles the graph, ready for .invoke(state) or
    .stream(state, stream_mode="custom").

    from_nav_log=True skips the four computing nodes: the caller already
    has altitude_ft, altitude_selection and legs (the Brief tab, whose
    planner computed and cached them seconds earlier -- and whose pilot
    may have overridden the altitude, which a recomputation here would
    silently ignore), so the graph starts at retrieve_memory.
    """
    graph = StateGraph(NavLogState)
    graph.add_node("retrieve_memory", retrieve_memory)
    graph.add_node("generate_briefing", generate_briefing)
    graph.add_node("store_memory", store_memory)
    if from_nav_log:
        graph.add_edge(START, "retrieve_memory")
    else:
        graph.add_node("fetch_checkpoints", fetch_checkpoints)
        graph.add_node("select_checkpoints", select_checkpoints)
        graph.add_node("select_altitude", select_altitude)
        graph.add_node("assemble_legs", assemble_legs)
        graph.add_edge(START, "fetch_checkpoints")
        graph.add_edge("fetch_checkpoints", "select_checkpoints")
        graph.add_edge("select_checkpoints", "select_altitude")
        graph.add_edge("select_altitude", "assemble_legs")
        graph.add_edge("assemble_legs", "retrieve_memory")
    graph.add_edge("retrieve_memory", "generate_briefing")
    graph.add_edge("generate_briefing", "store_memory")
    graph.add_edge("store_memory", END)
    return graph.compile()
