"""Exposes the nav-log-assembler graph as an MCP tool -- the "LangGraph
Agent (MCP Server)" box in docs/architecture-aws.svg -- and as the plain
HTTP route the Brief tab's own AI popover streams a narrative from.
"""
import json
from collections.abc import Iterator

from mcp.server.mcpserver import MCPServer
from starlette.requests import Request
from starlette.responses import StreamingResponse

from . import db
from .graph import build_graph

db.ensure_schema()
# Loaded now, not on the first request: the first embedding otherwise
# paid the model load (and, before HF_HUB_OFFLINE, a round of
# huggingface.co checks) inside a pilot's own wait for a narrative.
db.preload_embedder()
mcp = MCPServer("vfr-nav-log-agent")
_graph = build_graph()
_graph_from_nav_log = build_graph(from_nav_log=True)


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


def _line(message: dict) -> str:
    return json.dumps(message, default=str) + "\n"


def _narrative_lines(graph, state: dict) -> Iterator[str]:
    """Newline-delimited JSON: one "delta" line per piece of text as
    Claude writes it, then a "done" line with the whole briefing, or an
    "error" line -- the same stream contract planning-service's own
    streams keep, and for the same reason: a failure after the first
    line is out cannot change the status any more."""
    try:
        final: dict = {}
        for mode, chunk in graph.stream(state, stream_mode=["custom", "values"]):
            if mode == "custom":
                yield _line(chunk)
            else:
                final = chunk
        if final.get("briefing_failed"):
            yield _line({"type": "error", "detail": final["briefing"]})
            return
        yield _line({
            "type": "done",
            "briefing": final["briefing"],
            "altitude_selection": final.get("altitude_selection"),
            "legs": final.get("legs", []),
        })
    except Exception as err:  # noqa: BLE001 -- whatever failed, the stream must end with a line saying so
        yield _line({"type": "error", "detail": str(err)})


@mcp.custom_route("/compare", methods=["GET", "POST"])
async def compare(request: Request) -> StreamingResponse:
    """Plain REST twin of generate_nav_log_briefing, not an MCP tool call --
    for the Brief tab's own AI popover (ComparisonProxyController on the
    webapp side), which needs a request-response HTTP call it can make
    directly rather than an MCP client/session. Streams the narrative as
    it is written (see _narrative_lines).

    POST carries the nav log the page already shows -- departure and
    destination idents, aircraft_name, altitude_ft, altitude_selection
    and legs -- and the graph starts at retrieve_memory with them. GET
    with idents alone still computes the whole nav log first.

    Still behind BearerAuthMiddleware (app/main.py wraps this whole
    Starlette app, and that wrapping is outside the mcp library's own
    routing -- the "not require authorization" custom_route promises is
    about its own internal OAuth layer, not this).
    """
    if request.method == "POST":
        body = await request.json()
        state = {
            "departure_ident": body["departure_ident"],
            "destination_ident": body["destination_ident"],
            "aircraft_name": body.get("aircraft_name", "c172"),
            "altitude_ft": float(body["altitude_ft"]),
            "altitude_selection": body.get("altitude_selection"),
            "legs": body["legs"],
        }
        graph = _graph_from_nav_log
    else:
        q = request.query_params
        state = {
            "departure_ident": q.get("departure_ident", "C81"),
            "destination_ident": q.get("destination_ident", "KDLH"),
            "aircraft_name": q.get("aircraft_name", "c172"),
        }
        if "altitude_ft" in q:
            state["altitude_ft"] = float(q["altitude_ft"])
        graph = _graph
    return StreamingResponse(_narrative_lines(graph, state), media_type="application/x-ndjson")
