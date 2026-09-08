"""The nav-log-assembler graph: checkpoints (model-service) -> dead-
reckoning legs (vfr.navlog, see [[project-navlog-dr-math]] in project
memory) -> similar past routes (pgvector) -> a Claude-generated briefing ->
store that briefing back into memory for next time.

Altitude is currently a plain input parameter, not pulled from notebook
08's altitude-selection logic (vfr.terrain/airspace/weather/aircraft) --
integrating that is a deliberate next step, not done here, to keep this
first slice bounded.
"""
import os
from typing import TypedDict

import anthropic
from langgraph.graph import END, START, StateGraph

from vfr import aircraft, navlog

from . import db, model_client

CLAUDE_MODEL = os.environ.get("NAV_LOG_AGENT_MODEL", "claude-sonnet-5")


class NavLogState(TypedDict, total=False):
    departure_ident: str
    destination_ident: str
    altitude_ft: float
    aircraft_name: str
    checkpoints: list[dict]
    legs: list[dict]
    similar_briefings: list[dict]
    briefing: str


def fetch_checkpoints(state: NavLogState) -> dict:
    checkpoints = model_client.get_checkpoints(state["departure_ident"], state["destination_ident"])
    return {"checkpoints": checkpoints}


def assemble_legs(state: NavLogState) -> dict:
    profile = aircraft.load_aircraft_profile(state.get("aircraft_name", "c172"))
    checkpoints = sorted(state["checkpoints"], key=lambda c: c["along_track_nm"])
    legs = []
    for a, b in zip(checkpoints, checkpoints[1:]):
        leg = navlog.assemble_leg((a["lat"], a["lon"]), (b["lat"], b["lon"]), state["altitude_ft"], profile)
        leg["from"] = a["name"] or a["category"]
        leg["to"] = b["name"] or b["category"]
        legs.append(leg)
    return {"legs": legs}


def retrieve_memory(state: NavLogState) -> dict:
    query = f"{state['departure_ident']} to {state['destination_ident']}"
    return {"similar_briefings": db.retrieve_similar_briefings(query)}


def _format_legs(legs: list[dict]) -> str:
    return "\n".join(
        f"- {leg['from']} -> {leg['to']}: {leg['distance_nm']:.1f}nm, "
        f"heading {leg['magnetic_heading_deg']:.0f}M, GS {leg['groundspeed_kt']:.0f}kt, "
        f"ETE {leg['ete_min']:.0f}min, fuel {leg['fuel_gal']:.1f}gal"
        for leg in legs
    )


def _format_memory(similar_briefings: list[dict]) -> str:
    if not similar_briefings:
        return "(no similar past routes yet)"
    return "\n".join(
        f"- {b['departure_ident']}->{b['destination_ident']}: {b['briefing'][:200]}" for b in similar_briefings
    )


def generate_briefing(state: NavLogState) -> dict:
    client = anthropic.Anthropic()
    prompt = (
        f"Write a concise VFR pilot briefing for a flight from "
        f"{state['departure_ident']} to {state['destination_ident']} at {state['altitude_ft']:.0f}ft.\n\n"
        f"Dead-reckoning legs:\n{_format_legs(state['legs'])}\n\n"
        f"Similar past route briefings (for context/consistency, not to copy verbatim):\n"
        f"{_format_memory(state.get('similar_briefings', []))}"
    )
    resp = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    return {"briefing": resp.content[0].text}


def store_memory(state: NavLogState) -> dict:
    db.store_briefing(state["departure_ident"], state["destination_ident"], state["briefing"])
    return {}


def build_graph():
    graph = StateGraph(NavLogState)
    graph.add_node("fetch_checkpoints", fetch_checkpoints)
    graph.add_node("assemble_legs", assemble_legs)
    graph.add_node("retrieve_memory", retrieve_memory)
    graph.add_node("generate_briefing", generate_briefing)
    graph.add_node("store_memory", store_memory)

    graph.add_edge(START, "fetch_checkpoints")
    graph.add_edge("fetch_checkpoints", "assemble_legs")
    graph.add_edge("assemble_legs", "retrieve_memory")
    graph.add_edge("retrieve_memory", "generate_briefing")
    graph.add_edge("generate_briefing", "store_memory")
    graph.add_edge("store_memory", END)
    return graph.compile()
