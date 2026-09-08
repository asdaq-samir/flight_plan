# Development Notes

Operational detail for working on this repo — setup, service-by-service
internals, verification status, and the reasoning behind non-obvious
decisions. `README.md` is the project overview; this is the "how it
actually runs and why it's built this way" reference.

## Status / roadmap

Rough phase plan (not a fixed timeline, and renumbered 2026-09-08 to match
actual execution order -- originally planned as 1. ML notebooks → 2.
Airflow DAG → 3. GitHub remote + CI → 4. Gen AI nav-log agent → 5. AWS
deployment, but Gen AI moved ahead of GitHub/CI by deliberate choice, since
there's no real technical dependency between them and GitHub/CI was only
sequenced first in the original plan for learning-path reasons):
**1. ML notebooks → 2. Airflow DAG → 3. Gen AI nav-log agent → 4. GitHub
remote + CI → 5. AWS deployment.**

| Phase | Status |
|---|---|
| 1. ML notebooks (01-08) | Built. Blocked on data, not code — see below. |
| 2. Airflow DAG (`vfr_pipeline`) | Built and verified, including the 2026-09-08 conversion to `DockerOperator` (separate `pipeline-processing`/`pipeline-training` containers per task) -- see the AWS mapping section for what was checked. |
| 3. Gen AI nav-log agent (LangGraph + MCP + vector store, CrewAI comparison) | **Built and verified.** DR-leg math, altitude selection, the LangGraph/MCP agent, pgvector memory, and the CrewAI comparison build are all done (below). |
| 4. GitHub remote + CI | **CI prepped, remote not pushed yet.** `.github/workflows/ci.yml` + `tests/` are built and verified locally (below) -- by explicit user choice, the actual `git remote add` + push was left for the user to do themselves, not automated. The workflow has never actually run on GitHub as of this writing (no remote to trigger it). |
| 5. AWS deployment (SageMaker, Fargate, RDS, CloudFormation) | Not started — see the AWS mapping section below for how today's pieces are expected to land. |

**The one real data blocker, independent of all of the above**: chart-based
labeling (`data/labels/spottability_ratings.csv`) only has **2-3 labeled
candidates** against 426 total candidates. `pipeline.retrain()` has a hard
floor of 30 labeled rows before it'll run at all, so the model-training
side of the pipeline is code-complete but can't produce a real model yet —
`model-service` still returns a hand-written stub, not real predictions.

**Git**: initialized 2026-09-07/08 (this project had no version control at
all before then — not just "no GitHub remote"). Local commits only, no
remote yet -- the user's explicit choice was to have CI prepped locally
(workflow + tests, both verified) and push it themselves, rather than have
an agent authenticate to their GitHub account or create the repo.

## Testing / CI

`tests/` -- pytest, covering the parts of `src/vfr` that are pure logic and
don't need live network/data: `vfr.geo` (great-circle math), `vfr.features`
(engineered features), `vfr.navlog`/`vfr.weather`'s wind-correction-angle
and FD-group-decoding logic (formalizing the hand-derived headwind/
tailwind/crosswind checks worked through while building
[[project-navlog-dr-math|navlog.py]] -- see project memory), and
`vfr.model_registry`'s `evaluate`/`promote` (via `tmp_path`, no real model
artifacts needed). Deliberately not covered: anything needing live network
calls or a real trained model (`collect`, `engineer_features`, `retrain`,
`vfr.altitude`, `vfr.airspace`) -- those are exercised by the manual live
verification documented throughout this file instead, not unit tests.

`requirements-dev.txt` + `pyproject.toml` (`[tool.ruff]`, `[tool.pytest.ini_options]`)
are CI-only, not a project-wide dependency file -- consistent with this
project being Docker-only otherwise (see [[project-vfr-ml-environment]]).
Ruff is scoped to `E`/`F` (pyflakes + real errors) rather than a full style
ruleset, so CI catches actual bugs (unused imports, undefined names)
without relitigating this codebase's existing style on day one -- it did
catch two genuine unused imports and one ambiguous variable name in
`vfr.faa_data`/`vfr.airspace`, fixed the same session.

`.github/workflows/ci.yml` -- two jobs. `test`: checkout, `actions/setup-python`,
`pip install -r requirements-dev.txt`, `ruff check`, `pytest`. `build-images`
(needs `test`): builds all eight service Dockerfiles (everything in
`docker-compose.yml` except `db`, which uses a stock image) via
`docker/build-push-action`, and on push to `main` only, publishes each to
GHCR (`ghcr.io/<owner>/<repo>/<service>:latest`) using the built-in
`GITHUB_TOKEN` -- no extra secrets needed. Pushing to ECR instead (or as
well) is deferred to Phase 5, once AWS credentials exist as repo secrets.

**Verified locally** (2026-09-08, inside the `ml` container -- a Linux
environment, representative of the Ubuntu GitHub Actions runner, unlike
this dev machine's native Intel-macOS environment): all 31 tests pass,
`ruff check src/vfr tests` is clean, and the trickiest build-matrix entry
(`model-service`, the one with a non-repo-root build context) was directly
built with the exact `docker build -f <dockerfile> <context>` invocation
`docker/build-push-action` performs, confirming the context/dockerfile
pairing is correct. **Not verified**: the workflow has never actually run
on GitHub (no remote exists yet) -- YAML syntax and matrix structure were
validated locally with `yaml.safe_load`, but a real Actions run could still
surface something the above didn't (e.g. runner-specific behavior). Worth
checking the Actions tab after the first push.

## Setup

Notebooks 01-03 (and 04-08) run in the `ml` Docker container -- no native
venv (recent PyPI releases of numpy/pandas/scipy/pyarrow/matplotlib dropped
Intel-macOS wheels; see `docker/requirements-ml.txt`):

```bash
docker compose up ml   # Jupyter at http://localhost:8888, token "vfr"
```

The automatable subset of notebooks 01-03 also runs standalone, split into
two lean containers matching where each stage lands on AWS (see the AWS
mapping below) -- `pipeline-processing` (`src/vfr/pipeline.py`'s `collect`/
`engineer-features`, pandas/requests/pyarrow only) and `pipeline-training`
(`retrain`, pandas/scikit-learn/joblib/pyarrow/requests -- `requests` isn't
retrain's own dependency, but `pipeline.py` imports `vfr.airports`/`vfr.osm`
at module level and those need it; `scikit-learn`/`joblib` are lazy-imported
inside `retrain()` specifically so `pipeline-processing` can skip them):

```bash
docker compose run --rm pipeline-processing collect
docker compose run --rm pipeline-processing engineer-features
docker compose run --rm pipeline-training retrain
```

`evaluate`/`promote` (`src/vfr/model_registry.py`) need no container at all
-- zero third-party dependencies, so they run anywhere Python + `src/` are
available:

```bash
docker compose run --rm pipeline-training python -m vfr.model_registry evaluate
```

The `airflow` service (`docker compose up airflow`, UI at
`http://localhost:8081`) runs `vfr_pipeline`: Collect/Feature-Engineer/
Retrain each launch as a separate sibling container via `DockerOperator`
(over the host's Docker socket, mounted into `airflow`), matching
"Airflow orchestrates, SageMaker does the compute" -- Evaluate/Promote stay
in-process in `airflow` itself, since `model_registry` has no dependencies
to hand off. **The `pipeline-processing`/`pipeline-training` images must be
built before triggering the DAG** (`docker compose build pipeline-processing
pipeline-training`) -- DockerOperator runs pre-built images, it doesn't
build them.

`webapp` (Spring Boot, `:8080`), `model-service` (FastAPI, `:8000`), and
`db` (Postgres+pgvector, `:5432`) round out the local stack -- `docker
compose up webapp` brings up its dependencies too.

`nav-log-agent` (`:8082`, MCP over SSE) needs a real `ANTHROPIC_API_KEY` --
export it in your shell, or put it in a `.env` file (gitignored) -- before
any `docker compose` command will even parse (it's declared as a required
variable, so compose fails loudly if it's unset, rather than starting with
an empty key and failing confusingly later):

```bash
export ANTHROPIC_API_KEY=sk-...
docker compose up nav-log-agent
```

`crewai-agent` needs the same `ANTHROPIC_API_KEY`. It's a one-shot CLI, not
a standing server:

```bash
docker compose run --rm crewai-agent --departure-ident C81 --destination-ident KDLH
```

## Layout

- `data/raw/` — downloaded OSM extracts, airport CSV, cached imagery tiles, elevation/magnetic-variation caches (all gitignored, regenerable)
- `data/processed/` — cleaned feature tables
- `data/labels/` — hand-labeled spottability ratings (the current bottleneck — see Status above)
- `data/aircraft/` — aircraft performance profiles (`c172.json`, etc.) — never hardcoded, always loaded via `vfr.aircraft`
- `data/models/` — trained model artifacts (`candidate/`, `current/`, `versions/<timestamp>/`), written by `pipeline.retrain`/`evaluate`/`promote`
- `notebooks/` — numbered, run-in-order modules (human-facing/exploratory; breakdown below)
- `src/vfr/` — shared code imported by the notebooks; `pipeline.py` (collect/engineer_features/retrain) and `model_registry.py` (evaluate/promote) are the non-interactive subset the DAG and `pipeline-processing`/`pipeline-training` containers run; `navlog.py` is the dead-reckoning leg math, `altitude.py` the cruise-altitude recommendation (see below)
- `airflow/dags/` — the `vfr_pipeline` DAG
- `model-service/`, `springboot-app/` — the two serving-side apps (FastAPI model stub, Spring Boot API)
- `nav-log-agent/` — the LangGraph/MCP nav-log-assembler agent (see below)
- `crewai-agent/` — the same task, built in CrewAI, for framework comparison (see below)
- `tests/`, `.github/workflows/ci.yml`, `requirements-dev.txt`, `pyproject.toml` — CI (see Testing / CI below)

## Notebooks

| # | Notebook | What it does | Role |
|---|---|---|---|
| 01 | `data_collection` | Pulls candidate checkpoints along the route corridor from OSM (Overpass) + FAA NASR data | Part of the pipeline (`pipeline.collect`) |
| 02 | `feature_engineering` | Builds the model feature table from 01's candidates | Part of the pipeline (`pipeline.engineer_features`) |
| 03 | `sklearn_baseline` | Interactive hand-labeling + Ridge/RandomForest/GradientBoosting model selection, nested CV | Labeling stays notebook-only (human judgment); model-selection logic reused in `pipeline.retrain` |
| 04 | `pytorch_tensorflow` | PyTorch + Keras MLP, benchmarked against 03's sklearn baseline | One-off comparison exercise, not part of the pipeline |
| 05 | `huggingface_embeddings` | Sentence-transformer embeddings on candidate names as engineered features | One-off comparison exercise (weak-signal test) |
| 06 | `spark_mllib` | Spark MLlib GBTRegressor, same comparison | One-off comparison exercise |
| 08 | `altitude_selection` | Terrain/obstacle floor (FAA MEF formula), Class B/C/D airspace ceilings, freezing level/ceiling/visibility/SIGMET-AIRMET, aircraft service ceiling → a recommended cruise altitude | Separate subsystem — rule-based domain computation, not model training. Verified end-to-end on C81→KDLH. |

(No 07 — numbering skip, not a typo.) 04-06 hardcoded their "compare against
03" baseline numbers as literals at first; fixed 2026-09-07 to read the live
promoted model's metrics from `data/models/current/metrics.json` instead,
since a hardcoded number can't track a model that retrains repeatedly.

## Nav log: dead-reckoning leg math

`src/vfr/navlog.py`'s `assemble_leg()` computes one leg of the eventual full
VFR nav log — true course/distance (`vfr.geo`), wind at altitude
(`vfr.weather.wind_at_altitude`, from the same live winds-aloft product
`freezing_level_ft` already used, now also decoding wind — it used to only
decode temperature), wind correction angle, true/magnetic heading
(`vfr.magnetic.magnetic_variation_deg`, live from NOAA NCEI), groundspeed,
ETE, and fuel burn (`data/aircraft/*.json`'s `cruise_tas_kt`/`fuel_burn_gph`).
Verified against hand-derived headwind/tailwind/crosswind cases and
end-to-end against the live C81→KDLH route.

**Deliberately not computed**: compass heading (magnetic → compass, via
deviation) — that needs a per-aircraft compass deviation card, which isn't
data this project has anywhere. Magnetic heading is as far as the chain
goes for now.

## Gen AI: the nav-log-assembler agent

`nav-log-agent/` — a LangGraph agent wrapped as an MCP server (the
"LangGraph Agent (MCP Server)" box in `architecture-future.png`), exposing
one tool, `generate_nav_log_briefing(departure_ident, destination_ident,
altitude_ft=None, aircraft_name="c172")`. The graph:

1. **`fetch_checkpoints`** — calls `model-service`'s `/invocations` (still
   the hand-written stub, per Status above).
2. **`select_altitude`** — `vfr.altitude.select_cruise_altitude()` (the same
   terrain/airspace/weather/aircraft-ceiling logic as notebook 08, extracted
   so this agent can call it too — see Notebooks above). Always computes the
   recommendation (floor/ceiling/hazards feed the briefing regardless); only
   used as the leg-planning altitude if the caller didn't pass `altitude_ft`
   explicitly.
3. **`assemble_legs`** — loops `vfr.navlog.assemble_leg()` over consecutive
   checkpoints at that altitude.
4. **`retrieve_memory`** — queries `route_briefings` in pgvector for
   similar past routes (embedded with a local `sentence-transformers`
   model, `all-MiniLM-L6-v2` — Anthropic has no embeddings endpoint, so this
   isn't an extra API dependency, just a local model, already an
   established choice in this project via notebook 05).
5. **`generate_briefing`** — calls the **Anthropic Claude API** with the
   altitude rationale + legs + retrieved memory, produces a natural-language
   briefing.
6. **`store_memory`** — embeds and stores that briefing back into pgvector.

**pgvector lives on the existing `db` Postgres service**, not a new
dedicated vector DB — reuses infra `webapp` already depends on, rather than
adding another moving part. The extension/table are created idempotently
at agent startup (`CREATE EXTENSION`/`TABLE IF NOT EXISTS`) rather than via
a Postgres init script, because `db`'s volume already had real data before
pgvector was added -- an init script wouldn't have re-run against it.

**What's verified**: the full graph -- `fetch_checkpoints` →
`select_altitude` → `assemble_legs` → `retrieve_memory` → `generate_briefing`
-- was run end-to-end against live services on the real C81→KDLH route
(2026-09-07/08), via the still-stub `model-service`. `select_altitude`
matches the known-good notebook 08 values exactly (2200ft floor, 3600ft
ceiling, 2500ft recommended). `generate_briefing` (the node that calls the
Anthropic API) reached the real `api.anthropic.com` and got back a proper
`401 invalid x-api-key` -- this dev environment's key is a placeholder, not
a real one, so the *response* is expected to fail, but that 401 (rather
than a request-construction error) confirms the request itself -- model,
headers, message format -- is built correctly. The one thing not yet
observed is a *successful* completion; that needs a real `ANTHROPIC_API_KEY`
(see Setup above).

### CrewAI comparison build

`crewai-agent/` -- a second, independent implementation of the exact same
task (checkpoints → recommended altitude → dead-reckoning legs → Claude
briefing), built in CrewAI instead of LangGraph, purely to compare the two
frameworks -- the "CrewAI Agent (comparison build, same task, different
framework)" box in `architecture-future.png` (dashed border: exists in
parallel, not pipeline-connected). Not a fallback, not wired into anything
else, and deliberately doesn't duplicate the pgvector memory store.

Structural difference from the LangGraph build, which is the actual point
of the comparison: LangGraph's graph is an explicit sequence of plain
Python functions (deterministic control flow; the LLM only writes the
final briefing text). CrewAI's model is an `Agent` reasoning over which
`tools` to call and when -- so `get_route_checkpoints`/
`get_recommended_altitude`/`compute_dead_reckoning_legs` (in
`crewai-agent/app/tools.py`) wrap the *exact same* underlying calls
(`vfr.altitude`, `vfr.navlog`, the same `model_client.get_checkpoints`
hitting `model-service`) that `nav-log-agent`'s graph nodes call directly --
same data, same deterministic logic, different control-flow philosophy.
One-shot CLI (`docker compose run --rm crewai-agent`, flags
`--departure-ident`/`--destination-ident`/`--aircraft-name`), not a
standing server, matching its non-pipeline-connected role.

**Gotcha hit while building this**: newer `crewai` versions need the
`anthropic` extra installed explicitly for the native Anthropic provider
(`crewai[anthropic]` in `requirements.txt`) -- plain `crewai` raises
`ImportError: Anthropic native provider not available` the moment an
`Agent` with `llm="anthropic/<model>"` is constructed, not at import time.

**Verified**: all three tools tested directly against the live C81→KDLH
route (bypassing the agent/LLM layer) -- same checkpoints, same 2200/3600/
2500ft altitude numbers, same leg headings as the LangGraph build, since
they call the same underlying code. `Agent`/`Task`/`Crew` construction and
a full `kickoff()` were also run -- like `nav-log-agent`, it reached the
real `api.anthropic.com` and got a proper `401 invalid x-api-key` from the
placeholder key, confirming the whole CrewAI wiring (tools, native
Anthropic provider, request construction) is correct. Same caveat as
`nav-log-agent`: a *successful* completion hasn't been observed yet.

## Where each container is headed on AWS

Not built yet -- see `README-Future.md` / `architecture-future.png` for the
full target diagram. This is how today's `docker-compose.yml` services map
onto it:

| Local service | AWS target |
|---|---|
| `webapp` (Spring Boot) | ECS Fargate -- Spring Boot API |
| `db` (postgres:16) | RDS PostgreSQL |
| `model-service` (FastAPI `/ping` + `/invocations` stub) | SageMaker Endpoint -- already shaped for this, see `model-service/app/main.py` |
| `airflow` (`vfr_pipeline` DAG) | Same DAG shape, but its own hosting isn't decided -- Amazon MWAA vs. self-hosted on Fargate/EC2 is an open question, not settled |
| `pipeline-processing` (`collect`/`engineer-features`) | SageMaker Processing Jobs -- dependency footprint (pandas/requests/pyarrow, no scikit-learn) matches what that container would actually need |
| `pipeline-training` (`retrain`) | SageMaker Training Job -- separate image on purpose, since Processing and Training are different AWS constructs with different container contracts (scikit-learn/joblib only load here, lazily, inside `retrain()`) |
| `model_registry.py`'s `evaluate`/`promote` | SageMaker Model Registry -- register a Model Package Version, "promote" becomes approving it. Not a container job on AWS at all, which is why it doesn't get one locally either (runs in-process in `airflow`, zero third-party deps) |
| `ml` (Jupyter; notebooks 04-06's PyTorch/TF/HuggingFace/Spark comparisons) | SageMaker Studio, ad hoc -- these are one-off benchmarking exercises with no recurring production role, so they don't become standing infra either locally or on AWS |
| notebook 08 (altitude selection) | No mapping here -- it's rule-based domain computation (terrain/airspace/weather/aircraft), not model training; headed toward the LangGraph nav-log agent or `model-service` instead |
| `nav-log-agent` (LangGraph + MCP + pgvector) | **LangGraph Agent (MCP Server)** + **Vector Store** boxes in `architecture-future.png`, calling the same SageMaker Endpoint `webapp` calls |

**No local equivalent exists yet** for several pieces of the target
diagram: CI/CD (GitHub Actions -> ECR), the Retrain Trigger (API Gateway ->
Lambda (Go) -> DAG trigger), or public ingress (`northflyers.com` -> API
Gateway in front of `webapp`) -- today `webapp` is just hit directly on
`localhost:8080`.

**Update 2026-09-08**: Airflow now launches `pipeline-processing`/
`pipeline-training` as separate containers via `DockerOperator`, rather
than running `pipeline.py` in-process -- the fuller mirror of "Airflow
orchestrates, SageMaker does the compute." This needed the host's Docker
socket mounted into `airflow` (`docker-compose.yml`'s `airflow` service),
a real access-control tradeoff that was flagged and consciously accepted
here, not defaulted into. Verified: the DAG parses with no import errors
and has the correct task tree; the `airflow` container's Docker-socket
access can see the pre-built sibling images; and a container launched with
the same `PROJECT_HOST_PATH` mount config the DAG uses correctly resolves
to the real project files on the host, not an empty/wrong directory.

One thing unchanged: `retrain` currently has a hard floor of 30 labeled
candidates before it'll run at all -- chart-based relabeling only has 2-3
so far, so a full pipeline run stops at that step until there's more data.
