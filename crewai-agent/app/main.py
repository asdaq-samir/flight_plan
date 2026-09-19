"""Comparison-only build of nav-log-agent's task (see
nav-log-agent/app/graph.py) in CrewAI instead of LangGraph -- the "CrewAI
Agent (comparison build, same task, different framework)" box in
docs/architecture-aws.svg. Not a fallback for the LangGraph build and not
part of the request pipeline proper: it exists purely to compare the two
frameworks on identical work (same tools, same model-service, same Claude
API), and doesn't duplicate the pgvector memory store.

Two ways to run it, both in this same file: `--departure-ident ...`
flags mean a one-shot CLI comparison, the documented way to run this by
hand (see docs/README.md's command reference). No flags at all means
`docker compose up` started it, in which case it runs app.server's small
FastAPI wrapper instead, so the webapp's own comparison panel always has
something to call on demand -- see main()'s own comment and app/server.py.

Where this differs structurally from the LangGraph build: LangGraph's
graph is an explicit sequence of plain Python functions (deterministic
control flow, the LLM only writes the final briefing text). CrewAI's model
is an Agent reasoning over which tools to call and when -- so here the
three deterministic steps (checkpoints/altitude/DR-legs) are exposed as
tools the agent chooses to invoke, rather than hardcoded as call sites.
That difference in control-flow philosophy is the actual point of comparison.
"""
import argparse
import os
import sys

from crewai import Agent, Crew, Task

from .tools import compute_dead_reckoning_legs, get_recommended_altitude, get_route_checkpoints

CLAUDE_MODEL = os.environ.get("NAV_LOG_AGENT_MODEL", "claude-sonnet-5")


def build_crew(departure_ident: str, destination_ident: str, aircraft_name: str) -> Crew:
    """Builds the single-agent Crew for one route: an Agent holding the
    three tools in tools.py, and the Task describing what to produce with
    them -- see module docstring for how this compares to the LangGraph build."""
    briefer = Agent(
        role="VFR Nav Log Briefer",
        goal="Produce an accurate, concise VFR pilot briefing for a route",
        backstory=(
            "An experienced VFR flight instructor who assembles nav-log briefings from "
            "checkpoint, altitude, and dead-reckoning data before every cross-country flight."
        ),
        tools=[get_route_checkpoints, get_recommended_altitude, compute_dead_reckoning_legs],
        llm=f"anthropic/{CLAUDE_MODEL}",
        verbose=True,
    )

    task = Task(
        description=(
            f"Produce a VFR pilot briefing for a flight from {departure_ident} to "
            f"{destination_ident} in a {aircraft_name} aircraft. First get the recommended "
            "checkpoints, then the recommended cruising altitude, then the dead-reckoning "
            "legs at that altitude. Write a concise briefing covering the recommended "
            "altitude and why (terrain/airspace/weather), each leg's heading/groundspeed/"
            "ETE/fuel, and total distance/time/fuel for the route."
        ),
        expected_output="A concise natural-language VFR pilot briefing for the route.",
        agent=briefer,
    )

    return Crew(agents=[briefer], tasks=[task], verbose=True)


def main() -> None:
    """CLI entry point: parses --departure-ident/--destination-ident/
    --aircraft-name, builds the crew, runs it once, and prints the briefing.

    With no flags at all (`docker compose up`, as opposed to `docker
    compose run --rm crewai-agent --departure-ident ...`), starts
    app.server's FastAPI app instead -- see that module's own docstring
    for why. sys.argv has just the script name in that case; any flag at
    all, even one that only repeats a default, means a real one-shot CLI
    invocation was intended, so this only checks length, not values.
    """
    if len(sys.argv) == 1:
        import uvicorn

        uvicorn.run("app.server:app", host="0.0.0.0", port=8000)
        return

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--departure-ident", default="C81")
    parser.add_argument("--destination-ident", default="KDLH")
    parser.add_argument("--aircraft-name", default="c172")
    args = parser.parse_args()

    crew = build_crew(args.departure_ident, args.destination_ident, args.aircraft_name)
    result = crew.kickoff()
    print(result)


if __name__ == "__main__":
    main()
