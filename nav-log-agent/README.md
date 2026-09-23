# nav-log-agent/

A LangGraph agent that assembles a full nav log and writes a pilot
briefing, served over MCP. It is the Gen AI half of this project, and the
deliberate contrast to [`crewai-agent/`](../crewai-agent), which does the
same task in a different framework.

The agent adds no aviation knowledge. It fetches the nav log the
planner flies -- the same checkpoints, per-leg altitudes, climbs and
fuel check a pilot sees on the page -- from planning-service's
`/api/plan`, and asks Claude for the one thing code cannot produce:
prose a pilot would want to read.

## Contents

- [Running it](#running-it)
- [Learning this from zero](#learning-this-from-zero)
- [The graph](#the-graph)
- [Things that are not obvious](#things-that-are-not-obvious)

## Running it

```bash
export NAV_LOG_AGENT_API_KEY=any-string-you-choose
docker compose up -d nav-log-agent     # MCP server on :8082
```

No Anthropic key is needed for that, and none is needed to use the
server. Of the graph's four nodes exactly one calls Claude, and the MCP
tools stop before it:

| Tool | What it does | Anthropic key |
|---|---|---|
| `assemble_nav_log` | the planner's nav log -- checkpoints, cruise altitude and the reasoning behind it, legs from airport to airport with their climbs, totals and the fuel check -- similar past routes, and `briefing_prompt`, the exact instruction this server's own narrator writes from | no |
| `remember_briefing` | stores a briefing *you* wrote, so later routes retrieve it as precedent | no |
| `generate_nav_log_briefing` | all of the above, then narrates it here | **yes** |

An agent connecting to this server already has a model. Asking it to
pay for a second one to write the prose is a strange thing to insist
on, so `assemble_nav_log` hands back the data and the prompt and lets
the caller's own model write. `remember_briefing` exists so that the
memory learns from those briefings too — otherwise pgvector would only
ever accumulate narrations that cost the operator money.

Set `ANTHROPIC_API_KEY` as well if you want `generate_nav_log_briefing`
and the flight planning drawer's own streamed narrative; without it those two fail
and the rest is unaffected.

This service is behind the `ai` Compose profile, so a plain
`docker compose up` leaves it out; naming it as above enables its
profile, as does `--profile ai`.

Both keys are checked when the container starts, not when Compose parses
the file: unset, the server exits with "refuses to start
unauthenticated" rather than coming up open. It used to be
`${ANTHROPIC_API_KEY:?...}`, which reads well and fails too widely --
Compose interpolates the whole file before it decides what to run, so
that marker failed `docker compose up webapp` too, and even
`docker compose config`.

## Learning this from zero

An "agent" is a badly overloaded word. The smallest honest version is a
function that calls a model:

```python
import anthropic

client = anthropic.Anthropic()
msg = client.messages.create(
    model="claude-sonnet-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Brief a VFR flight C81 to KDLH."}],
)
print(msg.content[0].text)
```

That is not useless, and it is not an agent — it has no tools and no
state. Everything below is about giving it those two things.

### The rungs

1. **One model call** (above). Learn the message shape and that the
   answer is confident and partly invented, because it has no data.

2. **Give it real data.** Call `vfr.navlog` yourself, put the numbers in
   the prompt, and ask for prose about *those*. The hallucinations stop.
   This is retrieval in its crudest form and is often enough.

3. **Let the model choose.** Describe your functions as tools and let it
   decide which to call. Now you have an agent — and also
   nondeterminism, so write down what you want it to do before you find
   out what it does.

4. **Make the steps explicit** (`langgraph`). For a task whose order you
   already know, a state machine beats letting the model pick. That is
   what `graph.py` is: four nodes in a fixed sequence. The model is used
   at one node, not as the control flow.

5. **Give it memory** (`pgvector`). Embed past briefings, retrieve
   similar ones, and let the model see how this route was briefed before.
   `sentence-transformers` produces the vectors locally — there is no
   Anthropic embeddings API.

6. **Expose it as tools** (`mcp`). MCP is a protocol for letting *other*
   clients call your capabilities. `mcp_server.py` turns the graph into
   something an MCP-speaking client can invoke.

### The method

Add a model call only where code cannot do the job. Every node in this
graph except `generate_briefing` is ordinary Python, and that ratio is
deliberate: a model asked to do arithmetic will do it wrong,
confidently.

## The graph

Four nodes, fixed order, defined in `app/graph.py`:

```
fetch_nav_log → retrieve_memory → generate_briefing → store_memory
```

Only `generate_briefing` calls Claude. `fetch_nav_log` is one call to
planning-service's `/api/plan` through `vfr.planner_client`; the rest is
Postgres.

It used to be seven nodes, the first four assembling the nav log from
`vfr`'s pieces. That nav log was not the pilot's: legs between the
checkpoints alone (20 where the planner flew 22, none to or from the
airports), one altitude for the whole route, no climbs, no fuel check.
Asking the planner for its own is what keeps the two from drifting
apart again.

The briefing's own calls from Plan skip `fetch_nav_log`: the page
already has the nav log (a pilot's altitude override included), so it
POSTs that to `/compare` and the graph starts at `retrieve_memory`. A
body missing a field is refused with a 422 naming it. The briefing
streams back as newline-delimited JSON while Claude writes it, the same
`delta`/`done`/`error` lines the planner's own streams use; the MCP tool
runs all four nodes and returns the finished text.

| File | What it is |
|---|---|
| `app/graph.py` | The state machine and its nodes. |
| `app/mcp_server.py` | MCP wrapper, so other clients can call it, and the `/compare` route Plan's briefing streams from. |
| `app/db.py` | Postgres + pgvector access. |
| `vfr.planner_client` (in `src/`) | The nav log, from planning-service -- shared with crewai-agent. With `vfr.narrative`, the only `vfr` modules this image imports, so it installs none of `vfr`'s geometry, raster or FAA data dependencies. |
| `vfr.narrative` (in `src/`) | The `/compare` request model and the briefing prompt, shared word for word with crewai-agent. |
| `app/migrations.py` + `migrations/` | Its own schema, applied at startup. |

## Things that are not obvious

**The state machine is the point.** LangGraph can run model-directed
loops. This graph deliberately does not: the order of a nav log is known,
so encoding it as edges makes the thing reproducible and debuggable. Use
an agent loop when the sequence genuinely depends on what is found.

**It installs CPU-only PyTorch on purpose.** `sentence-transformers`
pulls `torch`, and the default wheel is a GPU build — 3.2 GB of CUDA
libraries in an image that runs on a laptop and deploys to Fargate. The
first line of the Dockerfile fixes that; it took the image from 9.86 GB
to 2.31 GB.

**Embeddings are local, not an API call.** Anthropic has no embeddings
endpoint. `sentence-transformers` runs the model in-process, which is
most of this image's size. The weights are downloaded once, at image
build time, and read offline from then on (`HF_HUB_OFFLINE`), loaded at
startup rather than on the first request: before that, every process
start made a round of huggingface.co requests inside a pilot's own wait
for a narrative, and a rebuilt image fetched the model again on first
use.

**The narrative is short on purpose.** Under 200 words and 512 tokens:
Claude writes that in a few seconds, and it streams as it is written,
so the first sentence is on screen within a second or two.
