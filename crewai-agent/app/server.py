"""A thin FastAPI wrapper around build_crew()/kickoff() -- the REST twin
of nav-log-agent/app/mcp_server.py's /compare route, for the Brief tab's
AI popover (ComparisonProxyController on the webapp side). This is what
the image runs; the one-shot CLI is app.main.

No auth of its own, matching planning-service -- reachable only over the
internal docker network (crewai-agent:8000), no host port published in
docker-compose.yml, no ALB route in infra/cloudformation/template.yaml.
"""
from fastapi import FastAPI

from .main import build_crew

app = FastAPI()


@app.get("/")
def index() -> dict:
    """Health-check only -- docker-compose.yml's healthcheck needs
    something that answers immediately, unlike /compare below (a full
    agent run)."""
    return {"service": "crewai-agent"}


@app.get("/compare")
def compare(departure_ident: str = "C81", destination_ident: str = "KDLH", aircraft_name: str = "c172") -> dict:
    crew = build_crew(departure_ident, destination_ident, aircraft_name)
    result = crew.kickoff()
    return {"briefing": str(result)}
