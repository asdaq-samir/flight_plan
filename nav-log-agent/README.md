# nav-log-agent/

A LangGraph agent that assembles a full nav log and writes a pilot
briefing, served over MCP. It is the Gen AI half of this project, and the
deliberate contrast to [`crewai-agent/`](../crewai-agent), which does the
same task in a different framework.

The agent adds no aviation knowledge. It orchestrates
[`src/vfr`](../src) — the same checkpoint selection, altitude logic and
dead reckoning the planner uses — and asks Claude for the one thing code
cannot produce: prose a pilot would want to read.

## Contents

- [Running it](#running-it)
- [Learning this from zero](#learning-this-from-zero)
- [The graph](#the-graph)
- [Things that are not obvious](#things-that-are-not-obvious)

## Running it

```bash
export ANTHROPIC_API_KEY=sk-ant-...
docker compose up -d nav-log-agent     # MCP server on :8082
```

Compose refuses to start without the key — `${ANTHROPIC_API_KEY:?...}`
fails at parse time rather than letting the container start and fail
later with a confusing auth error.

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
   what `graph.py` is: seven nodes in a fixed sequence. The model is used
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

Seven nodes, fixed order, defined in `app/graph.py`:

```
fetch_checkpoints → select_checkpoints → select_altitude → assemble_legs
                  → retrieve_memory → generate_briefing → store_memory
```

Only `generate_briefing` calls Claude. The rest is `src/vfr` and Postgres.

| File | What it is |
|---|---|
| `app/graph.py` | The state machine and its nodes. |
| `app/mcp_server.py` | MCP wrapper, so other clients can call it. |
| `app/db.py` | Postgres + pgvector access. |
| `vfr.model_client` (in `src/`) | Checkpoint scores, over HTTP or SageMaker Runtime -- shared with planning-service and crewai-agent. |
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
most of this image's size.
