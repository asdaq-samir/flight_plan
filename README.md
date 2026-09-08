# VFR Waypoint Recommender

A learning project building toward a complete **VFR flight nav log between
two airports** (C81 → KDLH) — waypoints for pilotage, full dead-reckoning
leg math, and weather. The ML/route-planning work (pandas, scikit-learn,
HuggingFace, PyTorch, TensorFlow/Keras, Spark MLlib) is the excuse; the
point is hands-on practice with real ML + data-pipeline + cloud-architecture
workflow.

See `notebooks/` for the numbered modules (breakdown below), and
`README-Future.md` for the target AWS/CI/CD/Gen AI architecture this is
building toward.

## Status / roadmap

Rough phase plan (not a fixed timeline): **1. ML notebooks → 2. Airflow
DAG → 3. GitHub remote + CI → 4. Gen AI nav-log agent → 5. AWS deployment.**
Phase 4 is being done **before** Phase 3, by deliberate choice — there's no
real technical dependency between them, Phase 3 was only sequenced first in
the original plan for learning-path reasons.

| Phase | Status |
|---|---|
| 1. ML notebooks (01-08) | Built. Blocked on data, not code — see below. |
| 2. Airflow DAG (`vfr_pipeline`) | Built and verified (collect → feature_engineer → retrain → evaluate → promote). |
| 3. GitHub remote + CI | **Not started.** Local git only (see below) — no remote, no GitHub Actions. |
| 4. Gen AI nav-log agent (LangGraph + MCP + vector store, CrewAI comparison) | **In progress.** DR-leg math done (below); LangGraph/MCP/vector-store agent itself not started as of this writing. |
| 5. AWS deployment (SageMaker, Fargate, RDS, CloudFormation) | Not started — see the AWS mapping section below for how today's pieces are expected to land. |

**The one real data blocker, independent of all of the above**: chart-based
labeling (`data/labels/spottability_ratings.csv`) only has **2-3 labeled
candidates** against 426 total candidates. `pipeline.retrain()` has a hard
floor of 30 labeled rows before it'll run at all, so the model-training
side of the pipeline is code-complete but can't produce a real model yet —
`model-service` still returns a hand-written stub, not real predictions.

**Git**: initialized 2026-09-07/08 (this project had no version control at
all before then — not just "no GitHub remote"). Local commits only, no
remote yet; that's the parked Phase 3 work.

## Setup

Notebooks 01-03 (and 04-08) run in the `ml` Docker container -- no native
venv (recent PyPI releases of numpy/pandas/scipy/pyarrow/matplotlib dropped
Intel-macOS wheels; see `docker/requirements-ml.txt`):

```bash
docker compose up ml   # Jupyter at http://localhost:8888, token "vfr"
```

The automatable subset of notebooks 01-03 (`src/vfr/pipeline.py` --
collect/engineer_features/retrain/evaluate/promote) also runs standalone in
a separate, much leaner `pipeline` container (no jupyter/matplotlib/
torch/tensorflow -- just pandas/sklearn/pyarrow/joblib):

```bash
docker compose run --rm pipeline retrain   # or collect / engineer-features / evaluate / promote
```

The `airflow` service (`docker compose up airflow`, UI at
`http://localhost:8081`) runs that same `pipeline.py` logic on a schedule
via the `vfr_pipeline` DAG, in-process rather than by launching the
`pipeline` container -- a deliberate simplification for now, see
`airflow/dags/vfr_pipeline_dag.py`.

`webapp` (Spring Boot, `:8080`), `model-service` (FastAPI, `:8000`), and
`db` (Postgres, `:5432`) round out the local stack -- `docker compose up
webapp` brings up its dependencies too.

## Layout

- `data/raw/` — downloaded OSM extracts, airport CSV, cached imagery tiles, elevation/magnetic-variation caches (all gitignored, regenerable)
- `data/processed/` — cleaned feature tables
- `data/labels/` — hand-labeled spottability ratings (the current bottleneck — see Status above)
- `data/aircraft/` — aircraft performance profiles (`c172.json`, etc.) — never hardcoded, always loaded via `vfr.aircraft`
- `data/models/` — trained model artifacts (`candidate/`, `current/`, `versions/<timestamp>/`), written by `pipeline.retrain`/`evaluate`/`promote`
- `notebooks/` — numbered, run-in-order modules (human-facing/exploratory; breakdown below)
- `src/vfr/` — shared code imported by the notebooks; `pipeline.py` is the non-interactive subset the DAG/`pipeline` container run; `navlog.py` is the dead-reckoning leg math (see below)
- `airflow/dags/` — the `vfr_pipeline` DAG
- `model-service/`, `springboot-app/` — the two serving-side apps (FastAPI model stub, Spring Boot API)

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

**The Gen AI layer being built on top of this (Phase 4, in progress)**:
a LangGraph agent, wrapped as an MCP server, that pulls the trained model's
recommended checkpoints, loops `assemble_leg()` over them, pulls live
weather, and produces the actual filled-out nav log — with long-term memory
of past routes/briefings via **pgvector on the existing `db` Postgres**
service (not a new dedicated vector DB), calling the **Anthropic Claude
API**. A second, comparison-only build of the same agent in CrewAI is
planned alongside it (breadth exercise, not a fallback — both call the same
model-serving endpoint). None of this is built yet as of this writing.

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
| `pipeline` (`src/vfr/pipeline.py`'s `collect`/`engineer_features`/`retrain` stages) | SageMaker Processing Jobs (collect, engineer_features) + a SageMaker Training Job (retrain) -- this image's dependency footprint (pandas/sklearn/pyarrow/joblib, nothing else) is deliberately close to what that training container would actually contain |
| `pipeline`'s `evaluate`/`promote` (file-copy logic) | SageMaker Model Registry -- register a Model Package Version, "promote" becomes approving it |
| `ml` (Jupyter; notebooks 04-06's PyTorch/TF/HuggingFace/Spark comparisons) | SageMaker Studio, ad hoc -- these are one-off benchmarking exercises with no recurring production role, so they don't become standing infra either locally or on AWS |
| notebook 08 (altitude selection) | No mapping here -- it's rule-based domain computation (terrain/airspace/weather/aircraft), not model training; headed toward the LangGraph nav-log agent or `model-service` instead |
| The Gen AI agent being built now (LangGraph + MCP + pgvector) | **LangGraph Agent (MCP Server)** + **Vector Store** boxes in `architecture-future.png`, calling the same SageMaker Endpoint `webapp` calls |

**No local equivalent exists yet** for several pieces of the target
diagram: CI/CD (GitHub Actions -> ECR), the Retrain Trigger (API Gateway ->
Lambda (Go) -> DAG trigger), or public ingress (`northflyers.com` -> API
Gateway in front of `webapp`) -- today `webapp` is just hit directly on
`localhost:8080`.

Two deliberate simplifications worth knowing before extending this:
Airflow runs `pipeline.py` in-process rather than launching the `pipeline`
container per task (a "partial split" -- the fuller mirror of
"Airflow calls SageMakerTrainingOperator, compute happens elsewhere" would
use `DockerOperator`, which needs the host's Docker socket mounted into
`airflow` -- a real access-control tradeoff, considered and deferred, not
overlooked). And `retrain` currently has a hard floor of 30 labeled
candidates before it'll run at all -- chart-based relabeling only has 2-3
so far, so a full pipeline run stops at that step until there's more data.
