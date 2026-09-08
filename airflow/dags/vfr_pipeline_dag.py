"""Automated replacement for the manual notebook 01->02->03 sequence:
Collect -> Feature-Engineer -> Retrain -> Evaluate -> Promote, per the
Airflow DAG section of README-Future.md / architecture-future.drawio.

Hand-labeling (notebook 03's interactive cell) stays a human, notebook-only
step -- Retrain trains against whatever's already in data/labels/ at run
time, it doesn't generate labels. Evaluate only lets Promote run if the
freshly retrained model's held-out MAE beats the currently promoted model's
(or nothing is promoted yet) -- see vfr.pipeline.evaluate.
"""
from __future__ import annotations

import sys
from pathlib import Path

from airflow.decorators import dag, task
from airflow.operators.python import ShortCircuitOperator
from pendulum import datetime

PROJECT_SRC = Path("/opt/airflow/project/src")
if str(PROJECT_SRC) not in sys.path:
    sys.path.insert(0, str(PROJECT_SRC))


@dag(
    dag_id="vfr_pipeline",
    description="Collect -> Feature-Engineer -> Retrain -> Evaluate -> Promote",
    schedule=None,  # manual trigger for now -- not on a cron yet
    start_date=datetime(2026, 9, 7, tz="UTC"),
    catchup=False,
    tags=["vfr", "ml"],
)
def vfr_pipeline():
    @task
    def collect() -> str:
        from vfr import pipeline

        return str(pipeline.collect())

    @task
    def feature_engineer(candidates_path: str) -> str:
        from vfr import pipeline

        return str(pipeline.engineer_features(in_path=candidates_path))

    @task
    def retrain(features_path: str) -> str:
        from vfr import pipeline

        pipeline.retrain(features_path=features_path)
        return str(pipeline.CANDIDATE_MODEL_DIR)

    def _metrics_pass(candidate_dir: str) -> bool:
        from vfr import pipeline

        return pipeline.evaluate(candidate_dir=candidate_dir)

    @task
    def promote(candidate_dir: str) -> str:
        from vfr import pipeline

        return str(pipeline.promote(candidate_dir=candidate_dir))

    candidates_path = collect()
    features_path = feature_engineer(candidates_path)
    candidate_dir = retrain(features_path)

    metrics_pass = ShortCircuitOperator(
        task_id="evaluate",
        python_callable=_metrics_pass,
        op_kwargs={"candidate_dir": candidate_dir},
    )

    metrics_pass >> promote(candidate_dir)


vfr_pipeline()
