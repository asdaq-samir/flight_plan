"""A thin FastAPI wrapper around build_crew()/kickoff() -- the REST twin
of nav-log-agent/app/mcp_server.py's own /compare route, for the Brief
tab's own AI popover (ComparisonProxyController on the webapp
side). Not the documented way to run a one-off comparison (see main.py's
CLI, still the source of truth for that, and still the module docstring's
"one-shot CLI, not a standing server" for direct use); docker-compose.yml
overrides this image's entrypoint to run this server instead, specifically
for `docker compose up`, so the webapp always has something to call
on demand without a pilot running the CLI by hand first.

No auth of its own, matching planning-service's own precedent (see that
service's Dockerfile/docstring) -- reachable only over the internal
docker network (crewai-agent:8000), no host port published in
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
