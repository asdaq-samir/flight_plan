"""Comparison-only build of nav-log-agent's task (see
nav-log-agent/app/graph.py) in CrewAI instead of LangGraph -- the "CrewAI
Agent (comparison build, same task, different framework)" box in
docs/architecture-aws.svg. Not a fallback for the LangGraph build and not
part of the request pipeline proper: it exists purely to compare the two
frameworks on identical work (the same nav log from planning-service, the
same Claude API), and doesn't duplicate the pgvector memory store.

This module is the one-shot CLI: `python -m app.main --departure-ident
C81 --destination-ident KDLH` builds the crew, runs it once and prints
the briefing. The image itself runs app.server, a small FastAPI wrapper
around the same build_crew(), so the webapp's flight planning drawer has something to
call on demand.

Where this differs structurally from the LangGraph build: LangGraph's
graph is an explicit sequence of plain Python functions (deterministic
control flow, the LLM only writes the final briefing text). CrewAI's model
is an Agent reasoning over which tools to call and when -- so here the
three deterministic steps (checkpoints/altitude/DR-legs) are exposed as
tools the agent chooses to invoke, rather than hardcoded as call sites.
That difference in control-flow philosophy is the actual point of comparison.

The flight planning drawer is the exception: it already has the nav log on screen, so
its calls hand the crew that data (nav_log below) and no tools at all,
and the agent's one job is the prose -- the same shortcut the LangGraph
build takes for the same caller. Every tool call there was one more
round trip through Claude, and the pilot was paying for the framework
comparison in wall-clock time.
"""
import argparse
import os

from crewai import Agent, Crew, Task
from vfr.narrative import briefing_prompt

from .tools import compute_dead_reckoning_legs, get_recommended_altitude, get_route_checkpoints

CLAUDE_MODEL = os.environ.get("NAV_LOG_AGENT_MODEL", "claude-sonnet-5")


def build_crew(
    departure_ident: str,
    destination_ident: str,
    aircraft_name: str | None = None,
    nav_log: dict | None = None,
    stream: bool = False,
) -> Crew:
    """Builds the single-agent Crew for one route: an Agent holding the
    three tools in tools.py, and the Task describing what to produce with
    them -- see module docstring for how this compares to the LangGraph
    build. aircraft_name, when given, is one of the planner's aircraft
    profiles; omitted, the tools use the planner's default. With nav_log (altitude_ft, altitude_selection, legs -- what
    the flight planning drawer already shows) the agent gets that data in its task
    and no tools. stream=True makes kickoff() return the crew's own
    streaming output (text as Claude writes it) instead of the result."""
    briefer = Agent(
        role="VFR Nav Log Briefer",
        goal="Produce an accurate, concise VFR pilot briefing for a route",
        backstory=(
            "An experienced VFR flight instructor who assembles nav-log briefings from "
            "checkpoint, altitude, and dead-reckoning data before every cross-country flight."
        ),
        tools=[] if nav_log else [get_route_checkpoints, get_recommended_altitude, compute_dead_reckoning_legs],
        llm=f"anthropic/{CLAUDE_MODEL}",
        verbose=True,
    )

    if nav_log:
        description = briefing_prompt(
            departure_ident, destination_ident, nav_log["altitude_ft"], nav_log.get("altitude_selection"), nav_log["legs"],
        )
    else:
        aircraft = f" in the {aircraft_name} aircraft profile (pass it to every tool)" if aircraft_name else ""
        description = (
            f"Produce a VFR pilot briefing for a flight from {departure_ident} to "
            f"{destination_ident}{aircraft}. First get the recommended "
            "checkpoints, then the recommended cruising altitude, then the dead-reckoning "
            "legs at that altitude. Write a concise briefing, under 200 words, in plain prose "
            "(no Markdown), covering the recommended altitude and why (terrain/airspace/weather), "
            "each leg's heading/groundspeed/ETE/fuel, and total distance/time/fuel for the route."
        )

    task = Task(
        description=description,
        expected_output="A concise natural-language VFR pilot briefing for the route, under 200 words.",
        agent=briefer,
    )

    return Crew(agents=[briefer], tasks=[task], verbose=True, stream=stream)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--departure-ident", default="C81")
    parser.add_argument("--destination-ident", default="KDLH")
    parser.add_argument("--aircraft-name", help="one of the planner's aircraft profiles; its default if omitted")
    args = parser.parse_args()

    crew = build_crew(args.departure_ident, args.destination_ident, args.aircraft_name)
    result = crew.kickoff()
    print(result)


if __name__ == "__main__":
    main()
