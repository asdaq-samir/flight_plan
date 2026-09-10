"""Shared locations and thresholds, deliberately free of heavy imports.

`vfr.pipeline` owns the pipeline logic but pulls in requests/pyarrow and
the OSM/FAA modules just by being imported, so anything that only needs
to know *where* the data lives -- labeling-ui, for one -- would drag that
whole chain in for three constants. Keeping them here means a consumer
pays for pathlib and nothing else.

vfr.pipeline re-exports these, so `from vfr.pipeline import
CANDIDATES_PATH` keeps working for the notebooks and the DAG.
"""
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"

CANDIDATES_PATH = DATA_DIR / "processed" / "candidates_c81_kdlh.csv"
FEATURES_PATH = DATA_DIR / "processed" / "features_c81_kdlh.parquet"
LABELS_PATH = DATA_DIR / "labels" / "spottability_ratings.csv"

# Below this many labeled examples, a train/test split and 5-fold CV
# aren't meaningful (some rating classes may have 0-1 examples), so
# retrain() refuses to run rather than let scikit-learn raise an opaque
# stratify/fold-count error.
MIN_LABELED_ROWS = 30
