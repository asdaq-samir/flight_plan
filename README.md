# VFR Nav Log Platform

![Python](https://img.shields.io/badge/Python%203.12-3776AB?style=flat-square&logo=python&logoColor=white)
![Java](https://img.shields.io/badge/Java%2025-437291?style=flat-square&logo=openjdk&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=flat-square&logo=go&logoColor=white)
![Docker](https://img.shields.io/badge/Docker%20Compose-2496ED?style=flat-square&logo=docker&logoColor=white)
![Spring Boot](https://img.shields.io/badge/Spring%20Boot-6DB33F?style=flat-square&logo=springboot&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL%20%2B%20pgvector-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Airflow](https://img.shields.io/badge/Apache%20Airflow-017CEE?style=flat-square&logo=apacheairflow&logoColor=white)
![AWS](https://img.shields.io/badge/AWS-232F3E?style=flat-square&logo=amazonaws&logoColor=white)
![Claude](https://img.shields.io/badge/Claude%20API-D97757?style=flat-square&logo=anthropic&logoColor=white)

**A production-shaped platform that plans VFR cross-country flights end to end** — a trained model picks visually identifiable ground checkpoints off a real FAA sectional chart, a dead-reckoning engine computes headings, groundspeed, ETE, and fuel burn from live weather, a rules engine selects a legal cruising altitude from terrain, airspace, and weather constraints, and a Gen AI agent turns all of it into a natural-language pilot briefing.

Demo route: **Campbell Airport (C81)** → **Duluth International (KDLH)**.

![Architecture](docs/architecture-current.svg)

## Capabilities

- **Chart-native checkpoint detection.** Ground features are read directly off the sectional's own raster tiles — a fixed cartographic palette, not an OpenStreetMap extract — so the training label ("could a pilot spot this on the chart") and the input data are the same source.
- **Four-way model selection.** scikit-learn (Ridge, Random Forest, Gradient Boosting), PyTorch, TensorFlow/Keras, and Spark MLlib are trained and benchmarked on the same feature set, with nested cross-validation and permutation importance for the baseline.
- **Orchestrated training pipeline.** An Airflow DAG runs collection, feature engineering, training, evaluation, and promotion; a new model goes live only if it beats the currently deployed one on held-out metrics.
- **FAA-accurate flight planning.** Dead-reckoning legs (wind correction angle, true/magnetic heading, groundspeed, ETE, fuel burn) from live NOAA winds-aloft and magnetic-declination data. Cruising-altitude selection accounts for terrain/obstacle clearance (FAA MEF methodology), live Class B/C/D airspace, and current METAR/TAF/SIGMET data.
- **A Gen AI agent with long-term memory.** A LangGraph agent, served over MCP, assembles the full nav log into a natural-language briefing and recalls similar past routes via a Postgres/pgvector semantic-search store.
- **The same agent, two frameworks.** A second implementation in CrewAI runs the identical task — same tools, same model-serving backend, same Claude API — so LangGraph's explicit state-graph control flow and CrewAI's agent-driven tool selection can be compared on one real task, side by side, from the UI.
- **A defined path to production.** Every local service maps to a named AWS target — SageMaker, ECS Fargate, RDS, CloudFormation — with no architectural rewrite between the two.

## Architecture

| Service | Role |
|---|---|
| `webapp` | Spring Boot — public API, auth, and the React front end |
| `planning-service` | FastAPI — sectional chart vision, checkpoint selection, dead reckoning |
| `model-service` | FastAPI — model serving (`/ping`, `/invocations`) |
| `nav-log-agent` | LangGraph agent, served over MCP — assembles the nav log and briefing |
| `crewai-agent` | The identical task in CrewAI, for framework comparison |
| `db` | PostgreSQL + pgvector — application data and agent long-term memory |
| `airflow` | Orchestrates the training pipeline |
| `pipeline-processing` / `pipeline-training` | Data collection, feature engineering, and training, as isolated jobs |
| `ml` | Jupyter environment for model development |

Ten services, one `docker compose up`. Full write-up, including the AWS target architecture, is in [`docs/README.md`](docs/README.md).

## Quick start

```bash
git clone https://github.com/asdaq-samir/flight_plan.git
cd flight_plan

export ANTHROPIC_API_KEY=sk-...   # only needed for nav-log-agent / crewai-agent

docker compose up webapp          # UI + API at http://localhost:8080/app
```

Everything else — `ml`, `airflow`, `nav-log-agent`, `crewai-agent`, and the full prerequisite/setup guide — is in [`docs/README.md#getting-started`](docs/README.md#getting-started). No native Python, Node, or Java toolchain is required; every service builds its own image.

## Project layout

| Path | Contents |
|---|---|
| [`web/`](web) | React 19 + TypeScript + Leaflet front end |
| [`planning-service/`](planning-service) | Route planning and chart-vision API |
| [`model-service/`](model-service) | Model-serving API |
| [`springboot-app/`](springboot-app) | Public API, authentication, database |
| [`nav-log-agent/`](nav-log-agent) | LangGraph briefing agent |
| [`crewai-agent/`](crewai-agent) | CrewAI briefing agent |
| [`src/`](src) | Shared Python package — pipeline, model registry, nav-log math |
| [`airflow/`](airflow) | Training-pipeline DAGs |
| [`infra/`](infra) | AWS CloudFormation and Lambda |
| [`notebooks/`](notebooks) | Numbered, run-in-order exploratory notebooks |
| [`docs/`](docs) | Full documentation, AWS deployment guide, architecture diagrams |

## Documentation

| | |
|---|---|
| [`docs/README.md`](docs/README.md) | Architecture, service reference, data design, developer guide |
| [`docs/README-AWS.md`](docs/README-AWS.md) | AWS target architecture and deployment |
| [`docs/LEARNING-GUIDE.md`](docs/LEARNING-GUIDE.md) | Guided walkthrough of the system, section by section |

## License

[`LICENSE`](LICENSE)
