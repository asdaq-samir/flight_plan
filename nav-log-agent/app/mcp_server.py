"""Exposes the nav-log-assembler graph as an MCP tool -- the "LangGraph
Agent (MCP Server)" box in docs/architecture-future.png.
"""
from mcp.server.mcpserver import MCPServer

from . import db
from .graph import build_graph

db.ensure_schema()
mcp = MCPServer("vfr-nav-log-agent")
_graph = build_graph()


@mcp.tool()
def generate_nav_log_briefing(
    departure_ident: str, destination_ident: str, altitude_ft: float | None = None, aircraft_name: str = "c172"
) -> dict:
    """Generate a VFR nav-log briefing for a route: checkpoints from the
    trained model, a recommended cruise altitude (terrain/airspace/
    weather/aircraft-ceiling constrained -- pass altitude_ft explicitly to
    override it instead), dead-reckoning legs between checkpoints, and a
    natural-language briefing informed by similar past routes.
    """
    state = {
        "departure_ident": departure_ident,
        "destination_ident": destination_ident,
        "aircraft_name": aircraft_name,
    }
    if altitude_ft is not None:
        state["altitude_ft"] = altitude_ft
    result = _graph.invoke(state)
    return {"altitude_selection": result["altitude_selection"], "legs": result["legs"], "briefing": result["briefing"]}
