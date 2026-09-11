"""Shared locations and thresholds, deliberately free of heavy imports.

`vfr.pipeline` owns the pipeline logic but pulls in requests/pyarrow and
the OSM/FAA modules just by being imported, so anything that only needs
to know *where* the data lives -- planning-service, for one -- would drag
that whole chain in for three constants. Keeping them here means a consumer
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

# The FAA's own tiled VFR Sectional service, in the same {z}/{y}/{x} XYZ
# scheme as any slippy map. Chart tiles stop at zoom 12 -- fixed print
# resolution, unlike a photo you can zoom into indefinitely -- and the
# service 404s below 8.
#
# These live in config rather than with the labeling loop they were
# written for: vfr.chartvision reads the chart, both browser pages draw
# it, and none of that is labeling. Keeping them next to a loop that has
# been superseded meant three modules importing a labeling module for a
# URL.
FAA_VFR_SECTIONAL_URL = (
    "https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/"
    "VFR_Sectional/MapServer/tile/{z}/{y}/{x}"
)
VFR_SECTIONAL_MAX_ZOOM = 12
VFR_SECTIONAL_MIN_ZOOM = 8
