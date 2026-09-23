"""Exposes the nav-log-assembler graph as an MCP tool -- the "LangGraph
Agent (MCP Server)" box in docs/architecture-aws.svg -- and as the plain
HTTP route the flight planning drawer's narrative popover streams a narrative from.
"""
import json
from collections.abc import Iterator

from mcp.server.mcpserver import MCPServer
from pydantic import BaseModel, ValidationError
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse

from . import db
from .graph import briefing_prompt, build_graph

mcp = MCPServer("vfr-nav-log-agent")
_graph = build_graph()
_graph_from_nav_log = build_graph(from_nav_log=True)
# Everything except the one node that calls Claude. This is what the
# tools below run, so this server needs no Anthropic key of its own.
_graph_unnarrated = build_graph(narrate=False)


def startup() -> None:
    """What the process does once before it serves: the schema
    migrations, and the embedding model loaded now rather than on the
    first request (the first embedding otherwise paid the model load
    -- and, before HF_HUB_OFFLINE, a round of huggingface.co checks --
    inside a pilot's own wait for a narrative). Called from `main`,
    not on import: importing this module must not need a database,
    or the documentation build (pdoc imports every module) and any
    test that imports it would."""
    db.ensure_schema()
    db.preload_embedder()


def _route(departure_ident: str, destination_ident: str, altitude_ft: float | None, aircraft_name: str | None) -> dict:
    """The graph's input: only what the caller actually gave, so the
    planner's own defaults (its altitude choice, its default aeroplane)
    apply to the rest."""
    state = {"departure_ident": departure_ident, "destination_ident": destination_ident}
    if altitude_ft is not None:
        state["altitude_ft"] = altitude_ft
    if aircraft_name:
        state["aircraft_name"] = aircraft_name
    return state


@mcp.tool()
def generate_nav_log_briefing(
    departure_ident: str, destination_ident: str, altitude_ft: float | None = None, aircraft_name: str | None = None
) -> dict:
    """Generate a VFR nav-log briefing for a route: the nav log the
    planner flies (checkpoints from the trained model, each leg's legal
    cruise altitude -- pass altitude_ft to fly one of your own instead --
    climbs, headings, times and fuel) and a natural-language briefing of
    it, informed by similar past routes. aircraft_name picks one of the
    planner's aircraft profiles; omitted, its default.
    """
    result = _graph.invoke(_route(departure_ident, destination_ident, altitude_ft, aircraft_name))
    return {
        "altitude_selection": result["altitude_selection"],
        "legs": result["legs"],
        "totals": result["totals"],
        "briefing": result["briefing"],
    }


@mcp.tool()
def assemble_nav_log(
    departure_ident: str, destination_ident: str, altitude_ft: float | None = None, aircraft_name: str | None = None
) -> dict:
    """Everything a VFR nav-log briefing is made of, without writing the
    briefing: the nav log the planner flies -- the checkpoints worth
    flying, the cruise altitude with the terrain, airspace, weather and
    aircraft-ceiling reasoning behind it (pass altitude_ft to fly your
    own instead), the dead-reckoning legs from the departure airport to
    the destination with their climbs, and the totals with the fuel
    check -- and briefings from similar past routes for precedent.

    Use this and write the briefing yourself. `generate_nav_log_briefing`
    does the same work and then spends this server's own Anthropic
    credit narrating it, which is wasteful when you are a model already.

    `briefing_prompt` in the result is the exact instruction this
    server's own narrator writes from, data included -- following it
    keeps a briefing written here consistent with one written there, and
    it carries the constraints that matter (plain prose, no Markdown, and
    nothing invented that the data does not support).
    """
    result = _graph_unnarrated.invoke(_route(departure_ident, destination_ident, altitude_ft, aircraft_name))
    return {
        "departure_ident": departure_ident,
        "destination_ident": destination_ident,
        "altitude_ft": result["altitude_ft"],
        "altitude_selection": result["altitude_selection"],
        "selected_checkpoints": result["selected_checkpoints"],
        "legs": result["legs"],
        "totals": result["totals"],
        "similar_briefings": result["similar_briefings"],
        "briefing_prompt": briefing_prompt(result),
    }


@mcp.tool()
def remember_briefing(departure_ident: str, destination_ident: str, briefing: str) -> dict:
    """Save a briefing you wrote, so later routes can retrieve it as
    precedent (it is embedded and searched by similarity).

    The server stores its own narrations automatically; a briefing
    written by a connecting agent is invisible to it, so without this
    the memory only ever learns from the narrator that costs money. Send
    real briefings only -- an apology or an error message stored here
    comes back as "precedent" to whoever flies a similar route next.
    """
    db.store_briefing(departure_ident, destination_ident, briefing)
    return {"stored": True}


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


class NarrativeRequest(BaseModel):
    """The nav log the flight planning drawer already shows -- the same
    shape crewai-agent's own /compare takes, checked the same way before
    anything runs."""

    departure_ident: str
    destination_ident: str
    aircraft_name: str | None = None
    altitude_ft: float
    altitude_selection: dict | None = None
    legs: list[dict]


def _invalid(err: ValueError) -> JSONResponse:
    """A 422 naming what was wrong, in the `detail` string webapp's
    proxy passes on -- rather than the KeyError a missing field used to
    raise inside the stream."""
    if isinstance(err, ValidationError):
        detail = "; ".join(f"{'.'.join(str(part) for part in e['loc'])}: {e['msg']}" for e in err.errors())
    else:
        detail = "the request body is not JSON"
    return JSONResponse({"detail": f"invalid nav log: {detail}"}, status_code=422)


@mcp.custom_route("/compare", methods=["POST"])
async def compare(request: Request) -> StreamingResponse | JSONResponse:
    """Plain REST twin of generate_nav_log_briefing, not an MCP tool call --
    for the flight planning drawer's narrative popover
    (ComparisonProxyController on the webapp side), which needs a
    request-response HTTP call it can make directly rather than an MCP
    client/session. Streams the narrative as it is written (see
    _narrative_lines).

    The body is the nav log the page already shows -- departure and
    destination idents, aircraft_name, altitude_ft, altitude_selection
    and legs -- and the graph starts at retrieve_memory with it.

    Still behind BearerAuthMiddleware (app/main.py wraps this whole
    Starlette app, and that wrapping is outside the mcp library's own
    routing -- the "not require authorization" custom_route promises is
    about its own internal OAuth layer, not this).
    """
    try:
        body = NarrativeRequest.model_validate(await request.json())
    except ValueError as err:  # ValidationError, or JSON that does not parse
        return _invalid(err)
    state = body.model_dump(exclude_none=True)
    return StreamingResponse(_narrative_lines(_graph_from_nav_log, state), media_type="application/x-ndjson")
