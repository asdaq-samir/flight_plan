"""A thin FastAPI wrapper around build_crew()/kickoff() -- the REST twin
of nav-log-agent/app/mcp_server.py's /compare route, for the flight planning
drawer's narrative popover (ComparisonProxyController on the webapp side). This is what
the image runs; the one-shot CLI is app.main.

No auth of its own, matching planning-service -- reachable only over the
internal docker network (crewai-agent:8000), no host port published in
docker-compose.yml, no ALB route in infra/cloudformation/template.yaml.
"""
import json
from collections.abc import Iterator

from crewai.types.streaming import StreamChunkType
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .main import build_crew

app = FastAPI()


class NarrativeRequest(BaseModel):
    """The nav log the flight planning drawer already shows -- the crew writes about
    these numbers rather than recomputing them through its tools."""

    departure_ident: str
    destination_ident: str
    aircraft_name: str | None = None
    altitude_ft: float
    altitude_selection: dict | None = None
    legs: list[dict]


@app.get("/")
def index() -> dict:
    """Health-check only -- docker-compose.yml's healthcheck needs
    something that answers immediately, unlike /compare below (a full
    agent run)."""
    return {"service": "crewai-agent"}


def _line(message: dict) -> str:
    return json.dumps(message, default=str) + "\n"


def _narrative_lines(crew) -> Iterator[str]:
    """Newline-delimited JSON: one "delta" line per piece of text as the
    agent writes, then a "done" line with the whole briefing, or an
    "error" line -- the same contract nav-log-agent's /compare and
    planning-service's own streams keep.

    Every text chunk is forwarded as it arrives. With Claude's native
    tool calling a tool-free crew streams the briefing itself, nothing
    else (observed 2026-09-20: the first chunk was the title). A
    tool-driven run streams the agent's reasoning between tool calls
    too; the "done" line's briefing is the crew's own final result, and
    the page replaces whatever streamed with it, so scaffolding never
    outlives the stream.
    """
    try:
        streaming = crew.kickoff()
        for chunk in streaming:
            if chunk.chunk_type == StreamChunkType.TEXT and chunk.content:
                yield _line({"type": "delta", "text": chunk.content})
        yield _line({"type": "done", "briefing": str(streaming.result).strip()})
    except Exception as err:  # noqa: BLE001 -- whatever failed, the stream must end with a line saying so
        yield _line({"type": "error", "detail": str(err)})


@app.post("/compare")
def compare(body: NarrativeRequest) -> StreamingResponse:
    """The flight planning drawer's narrative, streamed as it is written, about the
    nav log in the body."""
    crew = build_crew(
        body.departure_ident, body.destination_ident, body.aircraft_name,
        nav_log={"altitude_ft": body.altitude_ft, "altitude_selection": body.altitude_selection, "legs": body.legs},
        stream=True,
    )
    return StreamingResponse(_narrative_lines(crew), media_type="application/x-ndjson")

