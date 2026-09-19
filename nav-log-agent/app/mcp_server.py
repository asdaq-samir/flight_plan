"""Exposes the nav-log-assembler graph as an MCP tool -- the "LangGraph
Agent (MCP Server)" box in docs/architecture-aws.svg.
"""
import json

from mcp.server.mcpserver import MCPServer
from starlette.requests import Request
from starlette.responses import JSONResponse

from . import db
from .graph import build_graph

db.ensure_schema()
mcp = MCPServer("vfr-nav-log-agent")
_graph = build_graph()


def _run_graph(departure_ident: str, destination_ident: str, altitude_ft: float | None, aircraft_name: str) -> dict:
    state = {
        "departure_ident": departure_ident,
        "destination_ident": destination_ident,
        "aircraft_name": aircraft_name,
    }
    if altitude_ft is not None:
        state["altitude_ft"] = altitude_ft
    result = _graph.invoke(state)
    return {"altitude_selection": result["altitude_selection"], "legs": result["legs"], "briefing": result["briefing"]}


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
    return _run_graph(departure_ident, destination_ident, altitude_ft, aircraft_name)


@mcp.custom_route("/compare", methods=["GET"])
async def compare(request: Request) -> JSONResponse:
    """Plain REST twin of generate_nav_log_briefing, not an MCP tool call --
    for the Brief tab's own AI popover (ComparisonProxyController
    on the webapp side), which needs a request-response HTTP call it can
    make directly rather than an MCP client/session. Still behind
    BearerAuthMiddleware (app/main.py wraps this whole Starlette app, and
    that wrapping is outside the mcp library's own routing -- the "not
    require authorization" custom_route promises is about its own internal
    OAuth layer, not this).
    """
    q = request.query_params
    result = _run_graph(
        q.get("departure_ident", "C81"),
        q.get("destination_ident", "KDLH"),
        float(q["altitude_ft"]) if "altitude_ft" in q else None,
        q.get("aircraft_name", "c172"),
    )
    return JSONResponse(json.loads(json.dumps(result, default=str)))
