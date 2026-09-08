# VFR Waypoint Recommender

A learning project: pick prominent visual waypoints for a VFR nav log
(C81 → KDLH) using pandas, scikit-learn, HuggingFace, PyTorch,
TensorFlow/Keras, and Spark MLlib. The route-planning tool is the excuse;
the point is hands-on practice with real ML workflow — model selection,
validation, bias/variance tradeoffs, and performance assessment.

See `notebooks/` for the numbered modules, and the plan this was built
from for the full module-by-module breakdown.

## Setup

Notebooks 01-03 run in the `ml` Docker container -- no native venv (recent
PyPI releases of numpy/pandas/scipy/pyarrow/matplotlib dropped Intel-macOS
wheels; see `docker/requirements-ml.txt`):

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

## Layout

- `data/raw/` — downloaded OSM extracts, airport CSV, cached imagery tiles
- `data/processed/` — cleaned feature tables
- `data/labels/` — hand-labeled spottability ratings
- `data/models/` — trained model artifacts (`candidate/`, `current/`, `versions/<timestamp>/`), written by `pipeline.retrain`/`evaluate`/`promote`
- `notebooks/` — numbered, run-in-order modules (human-facing/exploratory)
- `src/vfr/` — shared code imported by the notebooks; `pipeline.py` is the non-interactive subset the DAG/`pipeline` container run
- `airflow/dags/` — the `vfr_pipeline` DAG

## Where each container is headed on AWS

Not built yet -- see `README-Future.md` / `architecture-future.png` for the
full target diagram. This is just how today's `docker-compose.yml` services
map onto it, worked out 2026-09-07:

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

**No local equivalent exists yet** for several pieces for the target
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
