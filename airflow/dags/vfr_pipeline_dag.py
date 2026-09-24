"""Automated replacement for the manual notebook 01->02->03 sequence:
Collect -> Feature-Engineer -> Retrain -> Evaluate -> Promote, per the
Airflow DAG section of docs/README-AWS.md / docs/architecture-aws.drawio.

Collect/Feature-Engineer/Retrain each run in a separate sibling container
(launched via DockerOperator over the host Docker socket mounted into this
`airflow` container) rather than in-process here -- the local mirror of
"Airflow orchestrates, SageMaker does the compute" (see the AWS-mapping
table in docs/README.md). Evaluate/Promote stay in-process: vfr.model_registry has zero
third-party dependencies, so there's no real compute to hand off -- on AWS
these are just Model Registry API calls, not a job at all.

Hand-labeling (notebook 03's interactive cell) stays a human, notebook-only
step -- Retrain trains against whatever's already in data/labels/ at run
time, it doesn't generate labels.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from airflow.providers.docker.operators.docker import DockerOperator
from airflow.providers.standard.operators.python import ShortCircuitOperator
from airflow.sdk import dag, task
from docker.types import Mount
from pendulum import datetime

# The image bakes this file and src/ in side by side (docker/Dockerfile.airflow),
# so src/ is two levels up from here -- wherever that is.
PROJECT_SRC = Path(__file__).resolve().parents[2] / "src"
if str(PROJECT_SRC) not in sys.path:
    sys.path.insert(0, str(PROJECT_SRC))

# DockerOperator talks to the HOST's Docker daemon over the mounted socket,
# so its mounts must be HOST paths -- a path inside this container means
# nothing to that daemon.
PROJECT_HOST_PATH = os.environ["PROJECT_HOST_PATH"]
PROJECT_MOUNT = Mount(source=PROJECT_HOST_PATH, target="/workspace", type="bind")

# Compose names the images it builds <project>-<service>, and the project
# is the directory's name unless COMPOSE_PROJECT_NAME says otherwise --
# docker-compose.yml passes that in, so a checkout under another name
# still finds its own pipeline images. The old hard-coded "vfr_route-"
# prefix was the repo's previous name, and every task failed to find its
# image once it was renamed.
IMAGE_PREFIX = os.environ.get("PIPELINE_IMAGE_PREFIX", "flight_plan")


def _docker_task(task_id: str, image: str, command: list[str]) -> DockerOperator:
    return DockerOperator(
        task_id=task_id,
        image=image,
        command=command,
        docker_url="unix://var/run/docker.sock",
        mounts=[PROJECT_MOUNT],
        auto_remove="success",
        mount_tmp_dir=False,
    )


@dag(
    dag_id="vfr_pipeline",
    description="Collect -> Feature-Engineer -> Retrain -> Evaluate -> Promote",
    schedule=None,  # manual trigger for now -- not on a cron yet
    start_date=datetime(2026, 9, 7, tz="UTC"),
    catchup=False,
    tags=["vfr", "ml"],
)
def vfr_pipeline():
    collect = _docker_task("collect", f"{IMAGE_PREFIX}-pipeline-processing", ["collect"])
    feature_engineer = _docker_task("feature_engineer", f"{IMAGE_PREFIX}-pipeline-processing", ["engineer-features"])
    retrain = _docker_task("retrain", f"{IMAGE_PREFIX}-pipeline-training", ["retrain"])

    def _metrics_pass() -> bool:
        from vfr import model_registry

        return model_registry.evaluate()

    evaluate = ShortCircuitOperator(task_id="evaluate", python_callable=_metrics_pass)

    @task
    def promote() -> str:
        from vfr import model_registry

        return str(model_registry.promote())

    collect >> feature_engineer >> retrain >> evaluate >> promote()


vfr_pipeline()
