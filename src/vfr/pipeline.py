"""Callable, non-interactive versions of the notebook 01->02->03 sequence:
collect, engineer_features, retrain. (evaluate/promote moved to
vfr.model_registry -- see that module's docstring for why.) Each function
here is one Airflow/DockerOperator task body (see
airflow/dags/vfr_pipeline_dag.py). The notebooks stay the human-facing/
exploratory versions of this same logic (plots, the folium map, the
interactive hand-labeling cell); this module is the automatable subset --
everything except labeling itself, which is still a human judgment call
and out of scope for a scheduled DAG.

scikit-learn/joblib are imported lazily, inside retrain() only, rather than
at module level -- this module is now shared by two differently-provisioned
containers (Dockerfile.processing has pandas/requests/pyarrow but NOT
scikit-learn; Dockerfile.training has scikit-learn/joblib but not requests).
A module-level sklearn import would make collect()/engineer_features()
uncallable in the processing image even though neither one touches sklearn.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from vfr import airports, elevation, faa_data, features, geo, osm
from vfr.model_registry import CANDIDATE_MODEL_DIR

from vfr.config import (  # noqa: F401  (re-exported: callers import these from here)
    CANDIDATES_PATH,
    DATA_DIR,
    FEATURES_PATH,
    LABELS_PATH,
    MIN_LABELED_ROWS,
    PROJECT_ROOT,
)

RANDOM_STATE = 42
PREFERRED_HALF_WIDTH_NM = 0.25  # "essentially on the line"
FALLBACK_HALF_WIDTH_NM = 1.0  # outer bound, fills gaps later
MARGIN_NM = 5
RIVER_FILTER = '["waterway"="river"]["intermittent"!="yes"]'
RAILROAD_FILTER = '["railway"="rail"]["service"!~".*"]'

# Properties of the landmark itself -- deliberately nothing about where it
# sits on the route.
#
# cross_track_nm, along_track_nm and within_preferred_corridor used to be
# in here and were removed 2026-09-10. They are corridor *filtering*
# inputs, and every candidate that survives collect() is already inside
# the corridor, so their leftover variance is just position along one
# route. The model was leaning on it hard: with all 206 labels, 25-fold
# repeated CV put the dummy-mean baseline at 1.1130 MAE, the full model
# at 0.9232 -- and a model given *only* those three position features at
# 0.9653, recovering 78% of the full model's gain over the baseline while
# knowing nothing whatever about the landmark. The C81->KDLH corridor
# runs from southern Wisconsin farmland into northern forest and lake
# country, so along-track distance was proxying for terrain type, which
# cannot transfer to a different route. Dropping them measured at 0.0165
# MAE against a paired std of 0.0587 -- indistinguishable from zero.
#
# They stay in the features parquet as identity/display columns (see
# engineer_features) because the serving API orders checkpoints by
# along-track distance; they are just not fed to the model.
FEATURE_COLS_BASE = [
    "log_size",
    "elevation_prominence_m",
    "name_uniqueness",
    "nn_dist_nm",
]

# Carried through to the parquet for display and ordering, not as model
# inputs.
ROUTE_POSITION_COLS = ["cross_track_nm", "along_track_nm", "within_preferred_corridor"]

class InsufficientLabelsError(RuntimeError):
    """Raised by retrain() when fewer than min_labeled_rows candidates are
    labeled -- a train/test split and 5-fold CV aren't meaningful below
    that, so this fails loudly instead of letting scikit-learn raise an
    opaque stratify/fold-count error."""


def _reject_remote_uri(path) -> None:
    """`pathlib.Path` has no concept of URI schemes, so an unguarded
    mkdir() against e.g. "s3://bucket/key" wouldn't raise a helpful error --
    it'd just silently try to create a local directory literally named
    that. This is also the one seam that would need to change to add real
    S3 support later: swap the two functions below (and the corresponding
    pd.read_csv/read_parquet/to_csv/to_parquet/joblib.dump calls) for
    fsspec/s3fs-aware equivalents; nothing else in this module assumes a
    local filesystem beyond that.

    Takes the raw value (str or Path), checked *before* any Path(...)
    conversion happens at the call site -- Path() itself collapses a
    scheme's "//" down to a single "/" (e.g. "s3://bucket/x" ->
    "s3:/bucket/x"), which would silently defeat an "://" check performed
    after conversion.
    """
    if "://" in str(path):
        raise NotImplementedError(
            f"'{path}' looks like a remote URI, but this pipeline only writes to a local "
            "filesystem right now -- see _reject_remote_uri's docstring for what S3 support "
            "would need to change."
        )


def _ensure_local_output_dir(path) -> Path:
    """For a file path: ensure its parent directory exists locally."""
    _reject_remote_uri(path)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _ensure_local_dir(path) -> Path:
    """For a directory path (e.g. retrain's out_dir, which files get
    written *into*): ensure it exists locally, as itself, not its parent.
    """
    _reject_remote_uri(path)
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)
    return path


def collect(
    dep_ident: str = "C81",
    dest_ident: str = "KDLH",
    out_path: Path = CANDIDATES_PATH,
) -> Path:
    """Notebook 01: pull candidate checkpoints along the route corridor from
    OSM (Overpass) + FAA NASR data, filter to the corridor, dedupe, and save.
    """
    dep = airports.get_airport(dep_ident)
    dest = airports.get_airport(dest_ident)
    route_distance_nm = geo.distance_nm(dep["lat"], dep["lon"], dest["lat"], dest["lon"])
    route_start = (dep["lat"], dep["lon"])
    route_end = (dest["lat"], dest["lon"])

    bbox_pad_nm = FALLBACK_HALF_WIDTH_NM + 2
    bbox = geo.corridor_bbox(route_start, route_end, bbox_pad_nm)

    raw = osm.query_overpass(bbox)
    raw_df = osm.parse_overpass_response(raw)

    river_ways = osm.query_line_features(bbox, RIVER_FILTER)
    river_df = osm.find_line_crossings(river_ways, route_start, route_end)
    river_df["category"] = "river"

    rail_ways = osm.query_line_features(bbox, RAILROAD_FILTER)
    rail_df = osm.find_line_crossings(rail_ways, route_start, route_end)
    rail_df["category"] = "railroad"

    highway_ways, node_coords = osm.query_major_highways(bbox)
    intersection_df = osm.find_intersections(highway_ways, node_coords)

    turbine_df = osm.query_wind_turbines(bbox)
    windfarm_df = osm.find_wind_farms(turbine_df)

    raw_df = pd.concat([raw_df, river_df, rail_df, intersection_df, windfarm_df], ignore_index=True)

    faa_cache_dir = DATA_DIR / "raw" / "faa_nasr"
    nav_csv_path, apt_csv_path, _dof_dat_path = faa_data.ensure_nasr_data(faa_cache_dir)
    vor_df = faa_data.load_vor_navaids(nav_csv_path, bbox)
    # DOF obstacles (faa_data.load_obstacles) are deliberately not
    # collected as candidates. A sectional draws every obstacle with the
    # same symbol regardless of what the structure actually is, so from
    # the chart there's nothing to distinguish one from another -- and a
    # tower is a small, easily-missed target in flight next to the things
    # pilotage actually leans on: water bodies, road intersections, wind
    # farms, towns. Keeping them only added candidates that couldn't be
    # rated consistently.
    #
    # Note this removes towers from consideration rather than teaching
    # the model to score them low -- the model will never see one. Same
    # outcome for recommendations, without spending labeling effort.
    # load_obstacles itself is untouched; notebook 08's terrain/obstacle
    # clearance still uses the DOF for altitude selection.
    # Airports from the FAA's own APT data (see
    # faa_data.load_route_airports). A runway is among the most
    # unambiguous things on a sectional, so a field in the corridor is a
    # strong checkpoint -- but only a charted one, and FAA registration
    # is what tracks with being drawn, which is why this comes from
    # APT_BASE rather than from every strip OSM or OurAirports lists. The
    # two route endpoints are excluded, being where the flight starts and
    # ends rather than marks along the way.
    airport_df = faa_data.load_route_airports(
        apt_csv_path, bbox, exclude_idents=(dep_ident, dest_ident)
    )
    raw_df = pd.concat([raw_df, vor_df, airport_df], ignore_index=True)

    def add_route_distances(df):
        df = df.copy()
        df["cross_track_nm"] = df.apply(
            lambda r: geo.cross_track_distance_nm(r["lat"], r["lon"], route_start, route_end), axis=1
        )
        df["along_track_nm"] = df.apply(
            lambda r: geo.along_track_distance_nm(r["lat"], r["lon"], route_start, route_end), axis=1
        )
        return df

    candidates_df = add_route_distances(raw_df)
    in_corridor = (
        candidates_df["cross_track_nm"].abs() <= FALLBACK_HALF_WIDTH_NM
    ) & (
        candidates_df["along_track_nm"].between(-MARGIN_NM, route_distance_nm + MARGIN_NM)
    )
    candidates_df = candidates_df[in_corridor].reset_index(drop=True)
    candidates_df["within_preferred_corridor"] = (
        candidates_df["cross_track_nm"].abs() <= PREFERRED_HALF_WIDTH_NM
    )
    candidates_df = candidates_df.drop_duplicates(subset=["lat", "lon"]).reset_index(drop=True)

    # Unnamed water bodies are dropped outright, whatever their size.
    # The label is a judgment made against the chart, and an unnamed lake
    # gives you nothing to make it with: at 1:500,000 the chart draws
    # water in blue with no label, so a marker on one blue shape among
    # several identical blue shapes cannot be confirmed as the right
    # shape -- which is a different failure from "hard to spot" and would
    # teach the model noise. A size floor was tried first (250,000 m2,
    # about a millimetre of chart) and still left ponds that were either
    # undrawn or unidentifiable. A charted name is the identification, so
    # named water stays regardless of size.
    is_unnamed_water = candidates_df["category"].isin(
        ["lake_or_pond", "reservoir"]
    ) & candidates_df["name"].isna()
    candidates_df = candidates_df[~is_unnamed_water].reset_index(drop=True)

    out_path = _ensure_local_output_dir(out_path)
    out_df = candidates_df.copy()
    out_df["tags"] = out_df["tags"].apply(json.dumps)
    out_df.to_csv(out_path, index=False)
    return out_path


def engineer_features(in_path: Path = CANDIDATES_PATH, out_path: Path = FEATURES_PATH) -> Path:
    """Notebook 02: turn raw candidates into the model's feature table."""
    df = pd.read_csv(in_path)
    df["tags"] = df["tags"].apply(json.loads)

    df["log_size"] = features.log_size_feature(df["bbox_area_m2"])
    category_dummies = pd.get_dummies(df["category"], prefix="category")
    df = pd.concat([df, category_dummies], axis=1)

    candidate_points = list(zip(df["lat"], df["lon"]))
    df["elevation_prominence_m"] = elevation.elevation_prominence_m(candidate_points)
    df["name_uniqueness"] = features.name_uniqueness(df["name"])
    df["nn_dist_nm"] = features.nearest_neighbor_distance_nm(df["lat"], df["lon"])

    feature_cols = FEATURE_COLS_BASE + list(category_dummies.columns)
    id_cols = ["osm_id", "osm_type", "category", "name", "lat", "lon"] + ROUTE_POSITION_COLS
    out_df = df[id_cols + feature_cols].copy()

    out_path = _ensure_local_output_dir(out_path)
    out_df.to_parquet(out_path, index=False)
    return out_path


def _load_labeled(features_path: Path, labels_path: Path) -> tuple[pd.DataFrame, list[str]]:
    candidates_df = pd.read_parquet(features_path)
    labels_df = pd.read_csv(labels_path)
    # osm_id round-trips as str through the candidates CSV/parquet but as
    # int64 through a freshly-read labels CSV (plain numeric column) --
    # normalize both to str so the merge key types actually match.
    candidates_df["osm_id"] = candidates_df["osm_id"].astype(str)
    labels_df["osm_id"] = labels_df["osm_id"].astype(str)
    labeled_df = candidates_df.merge(labels_df[["osm_id", "osm_type", "rating"]], on=["osm_id", "osm_type"])
    category_cols = [c for c in candidates_df.columns if c.startswith("category_")]
    feature_cols = FEATURE_COLS_BASE + category_cols
    return labeled_df, feature_cols


def retrain(
    features_path: Path = FEATURES_PATH,
    labels_path: Path = LABELS_PATH,
    out_dir: Path = CANDIDATE_MODEL_DIR,
    min_labeled_rows: int = MIN_LABELED_ROWS,
) -> dict:
    """Notebook 03's model-selection logic, minus labeling and plots: compare
    Ridge/RandomForest/GradientBoosting (grid-searched) against a dummy
    baseline, refit the best on a train split, score on the held-out split,
    and save the fitted model + its held-out metrics as the "candidate".
    """
    import joblib
    from sklearn.dummy import DummyRegressor
    from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
    from sklearn.linear_model import Ridge
    from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
    from sklearn.model_selection import GridSearchCV, KFold, cross_val_score, train_test_split

    labeled_df, feature_cols = _load_labeled(features_path, labels_path)
    if len(labeled_df) < min_labeled_rows:
        raise InsufficientLabelsError(
            f"Only {len(labeled_df)} labeled candidates (need >= {min_labeled_rows}) -- "
            "label more candidates (notebook 03's labeling cell) before retraining."
        )

    X = labeled_df[feature_cols].fillna({"name_uniqueness": 0.0})
    y = labeled_df["rating"].astype(float)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=RANDOM_STATE, stratify=y
    )
    cv = KFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)

    param_grids = {
        "Ridge": (Ridge(random_state=RANDOM_STATE), {"alpha": [0.01, 0.1, 1.0, 10.0, 100.0]}),
        "RandomForest": (
            RandomForestRegressor(random_state=RANDOM_STATE),
            {"n_estimators": [100, 300], "max_depth": [3, 5, 10, None], "min_samples_leaf": [1, 3, 5]},
        ),
        "GradientBoosting": (
            GradientBoostingRegressor(random_state=RANDOM_STATE),
            {"n_estimators": [100, 300], "max_depth": [2, 3, 4], "learning_rate": [0.01, 0.05, 0.1]},
        ),
    }
    best_estimators, cv_mae = {}, {}
    for name, (estimator, grid) in param_grids.items():
        search = GridSearchCV(estimator, grid, cv=cv, scoring="neg_mean_absolute_error", n_jobs=-1)
        search.fit(X_train, y_train)
        best_estimators[name] = search.best_estimator_
        cv_mae[name] = -search.best_score_

    dummy_mae = -cross_val_score(
        DummyRegressor(strategy="mean"), X_train, y_train, cv=cv, scoring="neg_mean_absolute_error"
    ).mean()

    best_name = min(cv_mae, key=cv_mae.get)
    best_model = best_estimators[best_name]
    best_model.fit(X_train, y_train)
    y_pred = best_model.predict(X_test)

    metrics = {
        "model_type": best_name,
        "cv_mae": cv_mae[best_name],
        # The full comparison, not just the winner -- Ridge/GradientBoosting's
        # own cv_mae used to be computed here and thrown away the moment
        # best_name was picked. Kept alongside "cv_mae" (still the winner's
        # score alone, still what model_registry.PROMOTION_METRIC reads)
        # rather than replacing it, so the promotion gate's read path never
        # has to change.
        "cv_mae_by_model": {**cv_mae, "Dummy": dummy_mae},
        "dummy_cv_mae": dummy_mae,
        "held_out_mae": mean_absolute_error(y_test, y_pred),
        "held_out_rmse": mean_squared_error(y_test, y_pred) ** 0.5,
        "held_out_r2": r2_score(y_test, y_pred),
        "n_labeled": len(labeled_df),
        "n_train": len(X_train),
        "n_test": len(X_test),
        "feature_cols": feature_cols,
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }

    out_dir = _ensure_local_dir(out_dir)
    joblib.dump(best_model, out_dir / "model.joblib")
    (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=2))
    return metrics


def _find_one(directory: Path, pattern: str) -> Path:
    matches = sorted(Path(directory).glob(pattern))
    if not matches:
        raise FileNotFoundError(f"No file matching {pattern!r} in {directory}")
    return matches[0]


def _retrain_defaults() -> dict:
    """Local defaults, unless SageMaker script-mode env vars are present, in
    which case those win -- SM_CHANNEL_FEATURES/SM_CHANNEL_LABELS are
    directories SageMaker downloads one S3 "channel" into each (the actual
    filename inside isn't guaranteed, hence the glob), SM_MODEL_DIR is where
    a Training Job expects the model artifact written so it can tar and
    upload it. Never set locally/in Docker Compose, so this is a no-op
    there -- only takes effect when this script actually runs as a
    SageMaker Training Job entry point.
    """
    features_path = FEATURES_PATH
    if channel := os.environ.get("SM_CHANNEL_FEATURES"):
        features_path = _find_one(channel, "*.parquet")

    labels_path = LABELS_PATH
    if channel := os.environ.get("SM_CHANNEL_LABELS"):
        labels_path = _find_one(channel, "*.csv")

    out_dir = Path(os.environ["SM_MODEL_DIR"]) if "SM_MODEL_DIR" in os.environ else CANDIDATE_MODEL_DIR

    return {"features_path": features_path, "labels_path": labels_path, "out_dir": out_dir}


def _cli() -> None:
    """Run one stage standalone, e.g. `docker compose run --rm pipeline-training retrain`
    or `docker compose run --rm pipeline-processing collect`.

    Kept deliberately close to a SageMaker script-mode entry point (one
    stage per invocation, paths as arguments with sensible defaults, result
    printed to stdout) -- this is the leanest, most reusable form of the
    pipeline, independent of Airflow or any other orchestrator. `retrain`
    specifically honors SM_CHANNEL_FEATURES/SM_CHANNEL_LABELS/SM_MODEL_DIR
    when present (see _retrain_defaults) so this same entry point could
    become an actual SageMaker Training Job's script without modification.
    """
    import argparse

    retrain_defaults = _retrain_defaults()

    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="stage", required=True)

    p = sub.add_parser("collect")
    p.add_argument("--dep-ident", default="C81")
    p.add_argument("--dest-ident", default="KDLH")
    p.add_argument("--out-path", type=Path, default=CANDIDATES_PATH)

    p = sub.add_parser("engineer-features")
    p.add_argument("--in-path", type=Path, default=CANDIDATES_PATH)
    p.add_argument("--out-path", type=Path, default=FEATURES_PATH)

    p = sub.add_parser("retrain")
    p.add_argument("--features-path", type=Path, default=retrain_defaults["features_path"])
    p.add_argument("--labels-path", type=Path, default=retrain_defaults["labels_path"])
    p.add_argument("--out-dir", type=Path, default=retrain_defaults["out_dir"])
    p.add_argument("--min-labeled-rows", type=int, default=MIN_LABELED_ROWS)

    args = parser.parse_args()
    kwargs = {k: v for k, v in vars(args).items() if k != "stage"}

    if args.stage == "collect":
        result = collect(**kwargs)
    elif args.stage == "engineer-features":
        result = engineer_features(**kwargs)
    elif args.stage == "retrain":
        result = retrain(**kwargs)

    print(result)


if __name__ == "__main__":
    _cli()
