# crewai-agent/

The same nav-log task as [`nav-log-agent/`](../nav-log-agent), built in
CrewAI instead of LangGraph. It exists to make a comparison concrete:
two frameworks, one task, same domain library underneath.

It is a one-shot CLI, not a server — which is itself part of the finding.

## Contents

- [Running it](#running-it)
- [Learning this from zero](#learning-this-from-zero)
- [What the comparison showed](#what-the-comparison-showed)

## Running it

```bash
export ANTHROPIC_API_KEY=sk-ant-...
docker compose run --rm crewai-agent \
  --departure-ident C81 --destination-ident KDLH
```

No port and no standing service. On AWS it is registered as a task
definition and run with `aws ecs run-task`, matching that role.

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

2. **Give it tools.** `app/tools.py` wraps `src/vfr` functions so the
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

Both share `model_client.py`, and both call the same `src/vfr`
functions, so the comparison is of the frameworks and not of two
different implementations.
