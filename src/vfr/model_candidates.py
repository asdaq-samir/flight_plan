"""PyTorch, TensorFlow and Spark MLlib versions of the same checkpoint-
spottability regression sklearn's retrain() already solves -- lifted out
of notebooks 04 and 06 the same way notebook 03's own model-selection
logic became vfr.pipeline.retrain(), so each is a real, re-runnable
training entry point rather than notebook-only code, and each actually
persists an artifact (neither notebook did before this).

Deliberately not part of vfr.pipeline: retrain() is shared by the lean
Dockerfile.processing/Dockerfile.training images, and importing torch/
tensorflow/pyspark at module level there would make every pipeline stage
require the full `ml` image just to import the module. This file is only
ever run inside that heavier image (`docker compose run --rm ml python -m
vfr.model_candidates <pytorch|tensorflow|spark>`), one-off, not as a
standing service.

Feature parity with retrain(), on purpose: all three train on the exact
same feature_cols vfr.pipeline.FEATURE_COLS_BASE selects (excluding the
three route-position columns removed 2026-09-10 for overfitting reasons
-- see that module's own comment) and the same data/processed/
features_c81_kdlh.parquet, not each notebook's own divergent feature set
(04 kept the position columns; 06 rebuilt features from the raw
candidates CSV in Spark and dropped elevation_prominence_m). Without
that, the Dev ML tab's model-comparison table would be comparing
algorithms trained on different information, not comparing algorithms.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

from vfr.config import FEATURES_PATH, LABELS_PATH, MIN_LABELED_ROWS
from vfr.model_registry import MODELS_DIR
from vfr.pipeline import RANDOM_STATE, InsufficientLabelsError, _ensure_local_dir, _load_labeled

CANDIDATES_DIR = MODELS_DIR / "candidates"


def _split(features_path: Path, labels_path: Path, min_labeled_rows: int):
    from sklearn.model_selection import train_test_split

    labeled_df, feature_cols = _load_labeled(features_path, labels_path)
    if len(labeled_df) < min_labeled_rows:
        raise InsufficientLabelsError(
            f"Only {len(labeled_df)} labeled candidates (need >= {min_labeled_rows}) -- "
            "label more checkpoints before training a candidate model."
        )
    X = labeled_df[feature_cols].fillna({"name_uniqueness": 0.0})
    y = labeled_df["rating"].astype(float)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=RANDOM_STATE, stratify=y
    )
    return X_train, X_test, y_train, y_test, feature_cols, len(labeled_df)


def train_pytorch(
    features_path: Path = FEATURES_PATH,
    labels_path: Path = LABELS_PATH,
    out_dir: Path = CANDIDATES_DIR / "pytorch",
    min_labeled_rows: int = MIN_LABELED_ROWS,
) -> dict:
    """Notebook 04's PyTorch model, now actually saved:
    `model_state.pt` (SpottabilityMLP's state_dict) plus the fitted
    StandardScaler (`scaler.joblib` -- persisted with joblib, same as
    the sklearn candidate, rather than hand-rolled JSON, since scaling
    a fresh input at inference time needs the exact fitted mean/scale)
    and `metrics.json`.
    """
    import joblib
    import torch
    from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
    from sklearn.model_selection import train_test_split
    from sklearn.preprocessing import StandardScaler
    from torch import nn

    from vfr.torch_model import SpottabilityMLP

    X_train, X_test, y_train, y_test, feature_cols, n_labeled = _split(
        features_path, labels_path, min_labeled_rows
    )
    # A second split of the training data for early-stopping validation
    # -- the test set stays untouched until final evaluation, matching
    # retrain()'s own train/test discipline.
    X_fit, X_val, y_fit, y_val = train_test_split(
        X_train, y_train, test_size=0.2, random_state=RANDOM_STATE, stratify=y_train
    )

    scaler = StandardScaler().fit(X_fit)
    to_tensor = lambda df: torch.tensor(scaler.transform(df), dtype=torch.float32)  # noqa: E731
    X_fit_t, X_val_t, X_test_t = to_tensor(X_fit), to_tensor(X_val), to_tensor(X_test)
    y_fit_t = torch.tensor(y_fit.to_numpy(), dtype=torch.float32).unsqueeze(1)
    y_val_t = torch.tensor(y_val.to_numpy(), dtype=torch.float32).unsqueeze(1)

    model = SpottabilityMLP(n_features=len(feature_cols))
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3, weight_decay=1e-4)
    loss_fn = nn.MSELoss()

    best_val_loss, best_state, patience_left = float("inf"), None, 20
    dataset = torch.utils.data.TensorDataset(X_fit_t, y_fit_t)
    loader = torch.utils.data.DataLoader(dataset, batch_size=32, shuffle=True, generator=torch.Generator().manual_seed(RANDOM_STATE))
    for _epoch in range(300):
        model.train()
        for xb, yb in loader:
            optimizer.zero_grad()
            loss_fn(model(xb), yb).backward()
            optimizer.step()
        model.eval()
        with torch.no_grad():
            val_loss = loss_fn(model(X_val_t), y_val_t).item()
        if val_loss < best_val_loss:
            best_val_loss, best_state, patience_left = val_loss, {k: v.clone() for k, v in model.state_dict().items()}, 20
        else:
            patience_left -= 1
            if patience_left <= 0:
                break
    model.load_state_dict(best_state)

    model.eval()
    with torch.no_grad():
        y_pred = model(X_test_t).squeeze(1).numpy()

    metrics = {
        "model_type": "PyTorchMLP",
        "held_out_mae": mean_absolute_error(y_test, y_pred),
        "held_out_rmse": mean_squared_error(y_test, y_pred) ** 0.5,
        "held_out_r2": r2_score(y_test, y_pred),
        "n_labeled": n_labeled,
        "n_train": len(X_train),
        "n_test": len(X_test),
        "feature_cols": feature_cols,
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }

    out_dir = _ensure_local_dir(out_dir)
    torch.save(model.state_dict(), out_dir / "model_state.pt")
    joblib.dump(scaler, out_dir / "scaler.joblib")
    (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=2))
    return metrics


def train_tensorflow(
    features_path: Path = FEATURES_PATH,
    labels_path: Path = LABELS_PATH,
    out_dir: Path = CANDIDATES_DIR / "tensorflow",
    min_labeled_rows: int = MIN_LABELED_ROWS,
) -> dict:
    """Notebook 04's Keras model, now actually saved (`model.keras`,
    self-contained -- architecture and weights both, unlike PyTorch's
    state_dict) plus the fitted scaler and metrics.json.
    """
    import joblib
    import tensorflow as tf
    from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
    from sklearn.model_selection import train_test_split
    from sklearn.preprocessing import StandardScaler

    tf.random.set_seed(RANDOM_STATE)

    X_train, X_test, y_train, y_test, feature_cols, n_labeled = _split(
        features_path, labels_path, min_labeled_rows
    )
    X_fit, X_val, y_fit, y_val = train_test_split(
        X_train, y_train, test_size=0.2, random_state=RANDOM_STATE, stratify=y_train
    )

    scaler = StandardScaler().fit(X_fit)
    X_fit_s, X_val_s, X_test_s = scaler.transform(X_fit), scaler.transform(X_val), scaler.transform(X_test)

    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(len(feature_cols),)),
        tf.keras.layers.Dense(32, activation="relu"),
        tf.keras.layers.Dropout(0.3),
        tf.keras.layers.Dense(16, activation="relu"),
        tf.keras.layers.Dropout(0.3),
        tf.keras.layers.Dense(1),
    ])
    model.compile(optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3), loss="mse")
    model.fit(
        X_fit_s, y_fit, validation_data=(X_val_s, y_val),
        epochs=300, batch_size=32, verbose=0,
        callbacks=[tf.keras.callbacks.EarlyStopping(monitor="val_loss", patience=20, restore_best_weights=True)],
    )

    y_pred = model.predict(X_test_s, verbose=0).squeeze(-1)
    metrics = {
        "model_type": "TensorFlowMLP",
        "held_out_mae": mean_absolute_error(y_test, y_pred),
        "held_out_rmse": mean_squared_error(y_test, y_pred) ** 0.5,
        "held_out_r2": r2_score(y_test, y_pred),
        "n_labeled": n_labeled,
        "n_train": len(X_train),
        "n_test": len(X_test),
        "feature_cols": feature_cols,
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }

    out_dir = _ensure_local_dir(out_dir)
    model.save(out_dir / "model.keras")
    joblib.dump(scaler, out_dir / "scaler.joblib")
    (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=2))
    return metrics


def train_spark(
    features_path: Path = FEATURES_PATH,
    labels_path: Path = LABELS_PATH,
    out_dir: Path = CANDIDATES_DIR / "spark",
    min_labeled_rows: int = MIN_LABELED_ROWS,
) -> dict:
    """Notebook 06's GBTRegressor, retrained on the canonical feature
    parquet (not the notebook's own from-scratch Spark feature
    rebuild) for comparability with the others.

    Not served live: a JVM + Spark session's cold-start time is wildly
    inappropriate for a request-serving container that everything else
    answers in milliseconds, and model-service is deliberately lean
    (see its own docstring). Instead this scores every labeled
    candidate now, at training time, and persists the predictions
    themselves (`predictions.json`, keyed by osm_id) -- model-service
    serves Spark's results the same way it already serves everything
    else, by reading a precomputed store, which is the exact pattern
    its own docstring already establishes for feature stores in
    general ("this serves whichever precomputed feature stores... are
    present" rather than computing them per request).
    """
    from pyspark.ml import Pipeline
    from pyspark.ml.evaluation import RegressionEvaluator
    from pyspark.ml.feature import VectorAssembler
    from pyspark.ml.regression import GBTRegressor
    from pyspark.ml.tuning import CrossValidator, ParamGridBuilder
    from pyspark.sql import SparkSession
    from sklearn.model_selection import train_test_split

    labeled_df, feature_cols = _load_labeled(features_path, labels_path)
    if len(labeled_df) < min_labeled_rows:
        raise InsufficientLabelsError(
            f"Only {len(labeled_df)} labeled candidates (need >= {min_labeled_rows}) -- "
            "label more checkpoints before training a candidate model."
        )
    labeled_df = labeled_df.fillna({"name_uniqueness": 0.0})
    train_df, test_df = train_test_split(
        labeled_df, test_size=0.2, random_state=RANDOM_STATE, stratify=labeled_df["rating"]
    )

    spark = SparkSession.builder.appName("vfr-candidate-spark").master("local[*]").getOrCreate()
    try:
        category_cols = [c for c in feature_cols if c.startswith("category_")]
        numeric_cols = [c for c in feature_cols if c not in category_cols]
        # The parquet's categories are already one-hot columns (category_*),
        # so no StringIndexer/OneHotEncoder is actually needed here -- unlike
        # notebook 06, which worked from the raw pre-one-hot candidates CSV.
        assembler = VectorAssembler(inputCols=numeric_cols + category_cols, outputCol="features")
        gbt = GBTRegressor(featuresCol="features", labelCol="rating", seed=RANDOM_STATE)
        pipeline = Pipeline(stages=[assembler, gbt])

        grid = (
            ParamGridBuilder()
            .addGrid(gbt.maxDepth, [2, 3, 4])
            .addGrid(gbt.maxIter, [20, 50])
            .addGrid(gbt.stepSize, [0.05, 0.1])
            .build()
        )
        evaluator = RegressionEvaluator(labelCol="rating", predictionCol="prediction", metricName="mae")
        cv = CrossValidator(estimator=pipeline, estimatorParamMaps=grid, evaluator=evaluator, numFolds=5, seed=RANDOM_STATE)

        spark_train = spark.createDataFrame(train_df[feature_cols + ["rating", "osm_id"]])
        spark_test = spark.createDataFrame(test_df[feature_cols + ["rating", "osm_id"]])
        spark_all = spark.createDataFrame(labeled_df[feature_cols + ["rating", "osm_id"]])

        cv_model = cv.fit(spark_train)
        best_cv_mae = min(cv_model.avgMetrics)

        test_predictions = cv_model.bestModel.transform(spark_test)
        held_out_mae = evaluator.evaluate(test_predictions)
        r2_evaluator = RegressionEvaluator(labelCol="rating", predictionCol="prediction", metricName="r2")
        rmse_evaluator = RegressionEvaluator(labelCol="rating", predictionCol="prediction", metricName="rmse")
        held_out_r2 = r2_evaluator.evaluate(test_predictions)
        held_out_rmse = rmse_evaluator.evaluate(test_predictions)

        # Score every labeled candidate (not only the test split) --
        # model-service's own lookup needs a prediction for whichever
        # osm_id a route's checkpoints ask about, and this is a one-time
        # batch job, not a per-request cost.
        all_predictions = cv_model.bestModel.transform(spark_all).select("osm_id", "prediction").collect()
        predictions = {row["osm_id"]: row["prediction"] for row in all_predictions}
    finally:
        spark.stop()

    metrics = {
        "model_type": "SparkGBT",
        "cv_mae": best_cv_mae,
        "held_out_mae": held_out_mae,
        "held_out_rmse": held_out_rmse,
        "held_out_r2": held_out_r2,
        "n_labeled": len(labeled_df),
        "n_train": len(train_df),
        "n_test": len(test_df),
        "feature_cols": feature_cols,
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }

    out_dir = _ensure_local_dir(out_dir)
    (out_dir / "predictions.json").write_text(json.dumps(predictions, indent=2))
    (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=2))
    return metrics


def _cli() -> None:
    """`python -m vfr.model_candidates pytorch|tensorflow|spark` -- one
    stage per invocation, matching vfr.pipeline._cli()'s own shape.
    Run inside the `ml` image (`docker compose run --rm ml python -m
    vfr.model_candidates <name>`), which already has torch/tensorflow/
    pyspark installed for the notebooks; none of the lean pipeline/
    serving images need to.
    """
    import argparse

    trainers = {"pytorch": train_pytorch, "tensorflow": train_tensorflow, "spark": train_spark}
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("algorithm", choices=sorted(trainers))
    parser.add_argument("--features-path", type=Path, default=FEATURES_PATH)
    parser.add_argument("--labels-path", type=Path, default=LABELS_PATH)
    parser.add_argument("--min-labeled-rows", type=int, default=MIN_LABELED_ROWS)
    args = parser.parse_args()

    result = trainers[args.algorithm](
        features_path=args.features_path, labels_path=args.labels_path, min_labeled_rows=args.min_labeled_rows
    )
    print(result)


if __name__ == "__main__":
    _cli()
