"""What the DAG files declare, read from their source: Airflow is not
installed where these tests run, and the images check the imports
themselves when they are built."""
import ast
from pathlib import Path

import pytest

DAGS = sorted((Path(__file__).resolve().parents[1] / "airflow" / "dags").glob("*.py"))


def _dag_keywords(path: Path) -> dict:
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.FunctionDef):
            for decorator in node.decorator_list:
                if isinstance(decorator, ast.Call) and getattr(decorator.func, "id", None) == "dag":
                    return {k.arg: ast.literal_eval(k.value) for k in decorator.keywords if k.arg == "max_active_runs"}
    raise AssertionError(f"no @dag in {path.name}")


@pytest.mark.parametrize("path", DAGS, ids=lambda p: p.stem)
def test_each_pipeline_runs_one_at_a_time(path):
    # Evaluate reads the candidate model and promote copies it later, both
    # from one fixed place: an overlapping run's retrain between the two
    # promoted a model that never passed the gate.
    assert _dag_keywords(path).get("max_active_runs") == 1
