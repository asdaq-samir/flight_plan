"""Comparison-only build of nav-log-agent's task (see
nav-log-agent/app/graph.py) in CrewAI instead of LangGraph -- the "CrewAI
Agent (comparison build, same task, different framework)" box in
docs/architecture-future.png. Not a fallback for the LangGraph build and not
part of the request pipeline: it exists purely to compare the two
frameworks on identical work (same tools, same model-service, same Claude
API), which is why it's a one-shot CLI rather than a standing MCP server,
and doesn't duplicate the pgvector memory store.

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

from crewai import Agent, Crew, Task

from .tools import compute_dead_reckoning_legs, get_recommended_altitude, get_route_checkpoints

CLAUDE_MODEL = os.environ.get("NAV_LOG_AGENT_MODEL", "claude-sonnet-5")


def build_crew(departure_ident: str, destination_ident: str, aircraft_name: str) -> Crew:
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
