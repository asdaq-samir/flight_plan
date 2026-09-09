# VFR Nav Log Platform

An end-to-end system that generates VFR (Visual Flight Rules) flight nav
logs: a trained model selects visually identifiable ground checkpoints
along a route, a dead-reckoning engine computes headings, groundspeed, ETE,
and fuel burn from live weather, a rules engine recommends a legal cruising
altitude from terrain/airspace/weather constraints, and a Gen AI agent
assembles it all into a natural-language pilot briefing.

Route: Campbell Airport (C81, Grayslake, IL) → Duluth International
(KDLH, MN).

Built as a full-lifecycle platform engineering project — model training and
selection, orchestrated data pipelines, a microservices architecture, and a
Gen AI agent with long-term memory — designed from the outset with an
explicit path to production on AWS.

## Highlights

- **Model selection across four frameworks.** Ridge regression, Random
  Forest, and Gradient Boosting (scikit-learn) benchmarked against PyTorch,
  TensorFlow/Keras, and Spark MLlib on the same feature set, with nested
  cross-validation and permutation importance for the sklearn baseline.
- **Orchestrated ML pipeline.** An Apache Airflow DAG automates data
  collection, feature engineering, training, evaluation, and model
  promotion — a new model only goes live if it beats the currently
  deployed one on held-out metrics.
- **Container architecture that mirrors its cloud target.** Compute is
  split along the same boundaries it will occupy on AWS: a
  Processing-Job-shaped container, a Training-Job-shaped container, and
  Airflow launching both as isolated, independently-versioned tasks — the
  same orchestration pattern used against managed services like SageMaker.
- **Domain-accurate flight planning.** Dead-reckoning leg calculations
  (wind correction angle, true/magnetic heading, groundspeed, ETE, fuel
  burn) built from FAA-standard formulas against live NOAA winds-aloft and
  magnetic-declination data. Cruising-altitude selection incorporates real
  terrain/obstacle clearance (FAA MEF methodology), live FAA Class B/C/D
  airspace shapefiles, and current METAR/TAF/SIGMET data.
- **A Gen AI agent with real memory.** A LangGraph agent, exposed as an MCP
  server, assembles the full nav log into a natural-language briefing, with
  long-term recall of past routes via a Postgres/pgvector semantic-search
  store — reusing existing infrastructure rather than standing up a
  separate vector database.
- **The same agent task built twice, to compare frameworks.** A second
  implementation in CrewAI — identical tools, identical model-serving
  backend, identical Claude API — evaluates LangGraph's explicit
  state-graph control flow against CrewAI's agent-driven tool selection on
  the same real task, not a toy example.
- **A concrete path to production**, not just a demo: every local service
  maps to a specific AWS target (SageMaker, ECS Fargate, RDS, CloudFormation)
  — see [Target Architecture](#target-architecture). The CloudFormation
  template for that target already exists (`infra/`) and passes `cfn-lint`,
  and the services themselves are AWS-readiness-hardened ahead of an actual
  deploy: `pipeline.retrain()` honors SageMaker script-mode's
  `SM_CHANNEL_*`/`SM_MODEL_DIR` conventions, `webapp` has Actuator
  liveness/readiness probes and Flyway-versioned migrations instead of
  JPA's `ddl-auto: update`, and local-filesystem code explicitly rejects a
  remote (`s3://`) path rather than silently mishandling it.
- **CI on every push.** GitHub Actions runs the test suite and lint on
  every push/PR, then builds every custom service image (all but the
  stock Postgres one) and publishes them to GHCR from `main` — no
  manually-run steps between a commit and a built, tagged image.

## Architecture

The system runs today as nine Docker services:

| Service | Role |
|---|---|
| `webapp` | Spring Boot API — the public-facing route-planning service |
| `model-service` | FastAPI model-serving endpoint (`/ping`, `/invocations`) |
| `nav-log-agent` | LangGraph agent (MCP server) that assembles the full nav log and briefing |
| `crewai-agent` | The same task, built in CrewAI, for framework comparison |
| `db` | PostgreSQL + pgvector — application data and agent long-term memory |
| `airflow` | Orchestrates the ML training pipeline |
| `pipeline-processing` / `pipeline-training` | Data collection, feature engineering, and model training, run as isolated jobs |
| `ml` | Jupyter environment for model development and experimentation |

![Current local architecture](architecture-current.svg)

## Tech stack

- **ML/Data:** scikit-learn, PyTorch, TensorFlow/Keras, Apache Spark MLlib, pandas, HuggingFace sentence-transformers
- **Pipeline orchestration:** Apache Airflow
- **Backend:** Spring Boot (Java), FastAPI (Python)
- **Gen AI:** LangGraph, CrewAI, Model Context Protocol (MCP), Anthropic Claude API, pgvector (RAG-style semantic memory)
- **Data:** PostgreSQL, OpenStreetMap (Overpass API), FAA NASR/DOF datasets, NOAA aviation weather and magnetic-model APIs
- **Infrastructure:** Docker / Docker Compose, GitHub Actions CI (pytest, ruff, image builds to GHCR), designed for AWS (SageMaker, ECS Fargate, RDS, CloudFormation)

## Target architecture

The system is designed to deploy onto a specific AWS architecture — see
[`README-Future.md`](README-Future.md) and `architecture-future.png` for
the full diagram (CI/CD, managed training/serving infrastructure, and the
Gen AI layer).

| Local component | AWS target |
|---|---|
| `webapp` | ECS Fargate |
| `db` | RDS PostgreSQL |
| `model-service` | SageMaker Endpoint |
| `airflow` | Same DAG, hosting undecided — Amazon MWAA vs. self-hosted on Fargate/EC2 |
| `pipeline-processing` | SageMaker Processing Jobs |
| `pipeline-training` | SageMaker Training Job |
| Model evaluation/promotion | SageMaker Model Registry |
| `nav-log-agent` | LangGraph Agent + Vector Store, deployed alongside the SageMaker endpoint |
| `crewai-agent` | A second agent deployment alongside it, for framework comparison — not part of the live request path |
| `ml` | SageMaker Studio, used ad hoc for development — not standing production infrastructure |
| CI/CD | GitHub Actions builds today, publishing to GHCR; pushing to ECR instead is the remaining step once AWS credentials exist |

The infrastructure itself is already written as code: `infra/cloudformation/template.yaml`
provisions the ECS/RDS/SageMaker/API-Gateway/Lambda resources above into an
existing VPC, and `infra/lambda-retrain-trigger/` is the Go source for the
Retrain Trigger. Neither has been deployed against a real AWS account — see
[`infra/README.md`](../infra/README.md) for what's verified (`cfn-lint`
clean, the Lambda compiles and passes `go vet`) versus what can only be
proven with a live deploy.

## Status

The ML pipeline, orchestration layer, dead-reckoning engine, altitude
selection logic, both Gen AI agents (LangGraph and CrewAI), and CI
(test/lint/build/publish) are built and integrated. Model training is
gated on accumulating enough hand-labeled examples to clear the pipeline's
minimum-sample threshold; until then, the serving endpoint returns
representative sample output so the rest of the system can be exercised
end to end. AWS deployment is designed and drafted as IaC (see Target
Architecture) but not yet provisioned — no AWS account/credentials exist
in this project's environment yet.

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for setup instructions, a
notebook-by-notebook breakdown, and detailed engineering notes.
