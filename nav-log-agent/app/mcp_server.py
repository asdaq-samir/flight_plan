"""Exposes the nav-log-assembler graph as an MCP tool -- the "LangGraph
Agent (MCP Server)" box in architecture-future.png.
"""
from mcp.server.mcpserver import MCPServer

from .graph import build_graph

mcp = MCPServer("vfr-nav-log-agent")
_graph = build_graph()


@mcp.tool()
def generate_nav_log_briefing(
    departure_ident: str, destination_ident: str, altitude_ft: float, aircraft_name: str = "c172"
) -> dict:
    """Generate a VFR nav-log briefing for a route: checkpoints from the
    trained model, dead-reckoning legs between them, and a natural-language
    briefing informed by similar past routes.
    """
    result = _graph.invoke(
        {
            "departure_ident": departure_ident,
            "destination_ident": destination_ident,
            "altitude_ft": altitude_ft,
            "aircraft_name": aircraft_name,
        }
    )
    return {"legs": result["legs"], "briefing": result["briefing"]}
