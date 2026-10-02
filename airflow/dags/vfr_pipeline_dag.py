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

Two models, side by side. The landmark model's branch starts with
whether its ratings are enough (landmarks_ready) and skips, rather than
fails, when they are not. The chart reader's scorer (vfr.chartmodel)
trains from the table the planner writes when it starts the run, and
goes through the same gate into data/models/chart/current.
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
# still finds its own pipeline images. Required, like the host path: the
# old hard-coded "vfr_route-" prefix was the repo's previous name, and
# every task failed to find its image once it was renamed -- a default
# here is the same name written a second time.
IMAGE_PREFIX = os.environ["PIPELINE_IMAGE_PREFIX"]


# vfr.pipeline.SKIPPED_EXIT_CODE, written again rather than imported: the
# DAG file is parsed in Airflow's own image, which has no pandas for
# vfr.pipeline to import.
SKIPPED_EXIT_CODE = 99


def _docker_task(task_id: str, image: str, command: list[str]) -> DockerOperator:
    return DockerOperator(
        task_id=task_id,
        image=image,
        command=command,
        docker_url="unix://var/run/docker.sock",
        mounts=[PROJECT_MOUNT],
        auto_remove="success",
        mount_tmp_dir=False,
        # A stage with too few ratings to train on ends with this, and
        # is skipped with the tasks after it rather than failing the run.
        skip_on_exit_code=SKIPPED_EXIT_CODE,
    )


@dag(
    dag_id="vfr_pipeline",
    description="Collect -> Feature-Engineer -> Retrain -> Evaluate -> Promote, and the chart model's Retrain -> Evaluate -> Promote",
    schedule=None,  # manual trigger for now -- not on a cron yet
    start_date=datetime(2026, 9, 7, tz="UTC"),
    catchup=False,
    # One run at a time. Every stage hands off through one fixed place --
    # the candidate model evaluate reads is the one promote copies later --
    # so a second run's retrain between the two would put a model into
    # service that never passed the gate. A second trigger queues.
    max_active_runs=1,
    tags=["vfr", "ml"],
)
def vfr_pipeline():
    landmarks_ready = _docker_task("landmarks_ready", f"{IMAGE_PREFIX}-pipeline-processing", ["readiness"])
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

    landmarks_ready >> collect >> feature_engineer >> retrain >> evaluate >> promote()

    chart_retrain = _docker_task("chart_retrain", f"{IMAGE_PREFIX}-pipeline-training", ["chart-retrain"])

    def _chart_metrics_pass() -> bool:
        from vfr import model_registry

        return model_registry.evaluate(model_registry.CHART_CANDIDATE_DIR, model_registry.CHART_CURRENT_DIR)

    chart_evaluate = ShortCircuitOperator(task_id="chart_evaluate", python_callable=_chart_metrics_pass)

    @task
    def chart_promote() -> str:
        from vfr import model_registry

        return str(model_registry.promote(model_registry.CHART_CANDIDATE_DIR, model_registry.CHART_CURRENT_DIR))

    chart_retrain >> chart_evaluate >> chart_promote()


vfr_pipeline()
