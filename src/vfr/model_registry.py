"""Evaluate/promote: compare a freshly retrained model against the
currently promoted one, and promote it if it wins. Split out of pipeline.py
deliberately -- this is the closest local analog to a SageMaker Model
Registry action (approve/reject a Model Package Version), which isn't a
compute job on AWS at all, just bookkeeping. Kept to the standard library on
purpose so it stays importable with zero third-party dependencies, in
particular inside Airflow's own image, which no longer installs pandas/
scikit-learn now that collect/engineer_features/retrain run in separate
sibling containers (pipeline-processing and pipeline-training in
docker-compose.yml, launched by the DAG in airflow/dags).
"""
import json
import os
import shutil
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = PROJECT_ROOT / "data" / "models"
CANDIDATE_MODEL_DIR = MODELS_DIR / "candidate"
CURRENT_MODEL_DIR = MODELS_DIR / "current"


def _reject_remote_uri(path) -> None:
    """Same guard as vfr.pipeline's (duplicated deliberately, see this
    module's docstring on why it has zero deps on vfr.pipeline) -- fails
    loudly for a URI-style path instead of pathlib silently mishandling it.
    Takes the raw value, checked *before* any Path(...) conversion at the
    call site -- Path() collapses a scheme's "//" to "/" (e.g.
    "s3://bucket/x" -> "s3:/bucket/x"), which would silently defeat an
    "://" check performed after conversion. Worth noting this module's
    shape on AWS isn't really "swap local copy2() for an S3 copy" though:
    a real SageMaker Model Registry "promote" is a registry API call
    (approve a Model Package Version), not a file copy at all -- the
    artifact is already in S3 from the Training Job. This guard is
    defensive correctness for local use, not a signpost for what AWS
    support here would look like.
    """
    if "://" in str(path):
        raise NotImplementedError(
            f"'{path}' looks like a remote URI, but this module only operates on a local "
            "filesystem right now."
        )


# Which metric the promotion gate compares. This was held_out_mae until
# 2026-09-10 and is now cv_mae, because held_out_mae is a single
# train_test_split and at this dataset size that statistic is dominated
# by which rows happened to land in the split.
#
# Measured directly, on the 206-label set: recomputing held_out_mae over
# 50 random split seeds gives sd 0.068-0.072 and a range of 0.73-1.09 for
# one unchanged model. The first real gate decision this ever made
# rejected a candidate on a 0.0669 gap -- almost exactly one sd of the
# statistic. Across those same 50 splits the two models it was comparing
# had a paired difference of -0.0008 +/- 0.0518 and the candidate won on
# 25 of 50: a coin flip decided by the split seed.
#
# cv_mae is the mean over 5 CV folds of the training set, so it averages
# that noise down, and it is already the metric retrain() uses to pick
# between Ridge/RandomForest/GradientBoosting -- selecting on one metric
# and gating on another was its own inconsistency. held_out_mae is still
# recorded in metrics.json as an honest held-out report; it is just not
# what a promotion turns on.
PROMOTION_METRIC = "cv_mae"


def evaluate(candidate_dir: Path = CANDIDATE_MODEL_DIR, current_dir: Path = CURRENT_MODEL_DIR) -> bool:
    """True (proceed to Promote) if the candidate strictly beats the
    currently promoted model, or if nothing is promoted yet.

    "Beats" is judged on one holdout: the training run scores the
    promoted model on the very landmarks it held out itself
    (`current_held_out_mae`, beside its own `held_out_mae`). Comparing the
    two runs' cross-validation scores instead compared answers to
    different questions once labels changed between them. PROMOTION_METRIC
    is the fallback for a candidate written before that, or when the
    promoted model could not be scored (other features). A tie keeps the
    promoted model.
    """
    candidate_metrics_path = Path(candidate_dir) / "metrics.json"
    candidate_metrics = json.loads(candidate_metrics_path.read_text())
    current_metrics_path = Path(current_dir) / "metrics.json"
    if not current_metrics_path.exists():
        return True
    current_on_holdout = candidate_metrics.get("current_held_out_mae")
    if current_on_holdout is not None and candidate_metrics.get("held_out_mae") is not None:
        return candidate_metrics["held_out_mae"] < current_on_holdout
    current_metrics = json.loads(current_metrics_path.read_text())
    return candidate_metrics[PROMOTION_METRIC] < current_metrics[PROMOTION_METRIC]


def _copy_into_place(source: Path, dest: Path) -> None:
    """Copy beside `dest` and rename over it, so model-service -- which
    reloads when these files change -- never reads a half-copied one."""
    tmp = dest.with_name(f".{dest.name}.tmp")
    shutil.copy2(source, tmp)
    os.replace(tmp, dest)


def promote(candidate_dir: Path = CANDIDATE_MODEL_DIR, current_dir: Path = CURRENT_MODEL_DIR) -> Path:
    """Copy the candidate model + metrics into the "current" (serving)
    location, and keep a timestamped copy under models/versions/ for history.
    """
    _reject_remote_uri(candidate_dir)
    _reject_remote_uri(current_dir)
    candidate_dir = Path(candidate_dir)
    current_dir = Path(current_dir)
    current_dir.mkdir(parents=True, exist_ok=True)

    _copy_into_place(candidate_dir / "model.joblib", current_dir / "model.joblib")
    _copy_into_place(candidate_dir / "metrics.json", current_dir / "metrics.json")

    run_id = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    version_dir = current_dir.parent / "versions" / run_id
    version_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(candidate_dir / "model.joblib", version_dir / "model.joblib")
    shutil.copy2(candidate_dir / "metrics.json", version_dir / "metrics.json")
    return current_dir


def _cli() -> None:
    """`python -m vfr.model_registry evaluate|promote` -- runs anywhere
    Python + this file are available, no installed deps required (see
    module docstring). Separate from vfr.pipeline._cli() on purpose: these
    are registry actions, not script-mode training entry points.
    """
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="stage", required=True)

    for name in ("evaluate", "promote"):
        p = sub.add_parser(name)
        p.add_argument("--candidate-dir", type=Path, default=CANDIDATE_MODEL_DIR)
        p.add_argument("--current-dir", type=Path, default=CURRENT_MODEL_DIR)

    args = parser.parse_args()
    kwargs = {"candidate_dir": args.candidate_dir, "current_dir": args.current_dir}

    if args.stage == "evaluate":
        result = evaluate(**kwargs)
    else:
        result = promote(**kwargs)

    print(result)
    if args.stage == "evaluate" and result is False:
        raise SystemExit(1)  # non-zero exit -- a container-based orchestrator can branch on this


if __name__ == "__main__":
    _cli()
