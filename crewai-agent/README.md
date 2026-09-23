# crewai-agent/

The same nav-log task as [`nav-log-agent/`](../nav-log-agent), built in
CrewAI instead of LangGraph. It exists to make a comparison concrete:
two frameworks, one task, the same planner nav log underneath.

Run by hand it is a one-shot CLI; the webapp reaches it through a thin
HTTP wrapper around the same crew.

## Contents

- [Running it](#running-it)
- [Learning this from zero](#learning-this-from-zero)
- [What the comparison showed](#what-the-comparison-showed)

## Running it

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # this service is behind the `ai` profile
docker compose run --rm crewai-agent \
  python -m app.main --departure-ident C81 --destination-ident KDLH
```

That is the one-shot CLI. `docker compose up crewai-agent` instead runs
the image's own command, a small FastAPI wrapper (`app/server.py`)
around the same crew on the internal network only, so the briefing's
AI popover on Plan can call it. That route takes the nav log the page
already shows and runs the crew with no tools at all -- the agent's one job is
the prose, streamed as it is written -- since every tool call was one
more round trip through Claude, paid for in a pilot's wall-clock time.
The full tool-driven run, the framework comparison proper, is the CLI
above. On AWS only the CLI exists: a task definition run with
`aws ecs run-task`, no standing service.

## Learning this from zero

CrewAI's model is people-shaped: you describe *agents* by role, give them
*tasks*, and let the framework work out the calls.

```python
from crewai import Agent, Crew, Task

planner = Agent(
    role="VFR flight planner",
    goal="Produce a nav log a pilot can fly",
    backstory="You are a CFI who briefs students before every flight.",
)
task = Task(description="Plan C81 to KDLH.", agent=planner, expected_output="A nav log")
print(Crew(agents=[planner], tasks=[task]).kickoff())
```

That runs, and produces confident nonsense, because the agent has no
tools. Which is the first lesson: the framework makes the *orchestration*
easy and does nothing about whether the answer is true.

### The rungs

1. **A crew with no tools** (above). See how little scaffolding is needed
   and how unreliable the output is.

2. **Give it tools.** `app/tools.py` wraps the planner's own answers
   (checkpoints, altitude, legs, through `vfr.planner_client`) so the
   agent can call real checkpoint selection and dead reckoning. Output
   becomes grounded.

3. **Watch it choose.** Unlike the LangGraph version, you do not write
   the order — the agent decides which tool to call next. Run it twice
   and compare. The variation is the whole trade.

4. **Decide which you want.** For a task whose sequence is known, that
   freedom is a cost. For open-ended work, it is the feature.

## What the comparison showed

Both produce a nav log. The difference is where control lives.

| | LangGraph | CrewAI |
|---|---|---|
| Order of steps | You write it, as edges | The agent decides |
| Reading a failure | Which node, deterministically | Re-run and hope it repeats |
| Code to write | More — every node explicit | Less — roles and goals |
| Fits | A known sequence | Open-ended tasks |

A nav log has a known sequence: checkpoints, then altitude, then legs,
then prose. **LangGraph is the better fit for this task**, and the
project runs it as the standing service while this one stays a CLI.

That is not a verdict on CrewAI. It is a verdict on using a
model-directed framework for a procedure you can already draw — which is
the point worth taking away.

Both get their nav log from planning-service through
`vfr.planner_client`, the one a pilot sees on the page, so the
comparison is of the frameworks and not of two different nav logs.
