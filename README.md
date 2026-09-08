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
- **A concrete path to production**, not just a demo: every local service
  maps to a specific AWS target (SageMaker, ECS Fargate, RDS, CloudFormation)
  — see [Target Architecture](#target-architecture).

## Architecture

The system runs today as eight Docker services:

| Service | Role |
|---|---|
| `webapp` | Spring Boot API — the public-facing route-planning service |
| `model-service` | FastAPI model-serving endpoint (`/ping`, `/invocations`) |
| `nav-log-agent` | LangGraph agent (MCP server) that assembles the full nav log and briefing |
| `db` | PostgreSQL + pgvector — application data and agent long-term memory |
| `airflow` | Orchestrates the ML training pipeline |
| `pipeline-processing` / `pipeline-training` | Data collection, feature engineering, and model training, run as isolated jobs |
| `ml` | Jupyter environment for model development and experimentation |

```
HTTP client → Spring Boot API ─┐
                               ├→ FastAPI Model Service → trained model
MCP client  → LangGraph Agent ─┘  (LangGraph Agent also calls the Claude API + pgvector memory)

Airflow → Processing Job → Training Job → Model Registry → Model Service
```

## Tech stack

- **ML/Data:** scikit-learn, PyTorch, TensorFlow/Keras, Apache Spark MLlib, pandas, HuggingFace sentence-transformers
- **Pipeline orchestration:** Apache Airflow
- **Backend:** Spring Boot (Java), FastAPI (Python)
- **Gen AI:** LangGraph, Model Context Protocol (MCP), Anthropic Claude API, pgvector (RAG-style semantic memory)
- **Data:** PostgreSQL, OpenStreetMap (Overpass API), FAA NASR/DOF datasets, NOAA aviation weather and magnetic-model APIs
- **Infrastructure:** Docker / Docker Compose, designed for AWS (SageMaker, ECS Fargate, RDS, CloudFormation)

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
| `pipeline-processing` | SageMaker Processing Jobs |
| `pipeline-training` | SageMaker Training Job |
| Model evaluation/promotion | SageMaker Model Registry |
| `nav-log-agent` | LangGraph Agent + Vector Store, deployed alongside the SageMaker endpoint |
| CI/CD | GitHub Actions → ECR |

## Status

The ML pipeline, orchestration layer, dead-reckoning engine, altitude
selection logic, and Gen AI agent are built and integrated. Model training
is gated on accumulating enough hand-labeled examples to clear the
pipeline's minimum-sample threshold; until then, the serving endpoint
returns representative sample output so the rest of the system can be
exercised end to end. AWS deployment and CI/CD are designed (see Target
Architecture) but not yet provisioned.

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for setup instructions, a
notebook-by-notebook breakdown, and detailed engineering notes.
