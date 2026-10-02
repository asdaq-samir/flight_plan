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


def test_the_pipelines_skip_code_is_the_one_its_stages_exit_with():
    # The DAG file cannot import vfr.pipeline (no pandas in Airflow's
    # image), so it writes the number again; a stage exiting with another
    # would fail the run it was meant to skip.
    from vfr.pipeline import SKIPPED_EXIT_CODE

    for path in DAGS:
        assignments = {
            node.targets[0].id: ast.literal_eval(node.value)
            for node in ast.parse(path.read_text()).body
            if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name) and node.targets[0].id == "SKIPPED_EXIT_CODE"
        }
        assert assignments.get("SKIPPED_EXIT_CODE", SKIPPED_EXIT_CODE) == SKIPPED_EXIT_CODE
