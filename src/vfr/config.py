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

# The VFR charts themselves: the FAA publishes every sectional and
# terminal area chart as a georeferenced TIFF, free, on the 56-day
# chart cycle. vfr.charts downloads the ones a route needs and renders
# the map's tiles from them -- the chart exactly as printed, served by
# this app, with no hosted map service in between. (Two came and went
# before this: the FAA's own ArcGIS tile cache, which went behind a
# login around 2026-09-03, then Texas A&M's public mirror of the same
# data, which had no tile cache and no chart west of Duluth.)
#
# Chart editions are listed on the products page, each under a
# cycle-dated URL; the anchor date is one such cycle, from which the
# others are 56-day arithmetic when the page cannot be reached.
FAA_VFR_PRODUCTS_PAGE = "https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/vfr/"
FAA_CHART_ZIP_URL = "https://aeronav.faa.gov/visual/{cycle}/{folder}/{name}.zip"
FAA_CHART_CYCLE_ANCHOR = "2026-09-03"
FAA_CHART_CYCLE_DAYS = 56

# Where the downloaded rasters and the tiles rendered from them live --
# both under data/raw, which is not tracked. The whole country is 64
# sheets (about 5 GB with their overviews) and a quarter of a million
# tiles (about 3 GB): the `.nosync` suffix is what keeps iCloud Drive
# from syncing a folder, and this repository lives under a Desktop it
# syncs. Any other machine sees an ordinary folder name.
CHARTS_DIR = DATA_DIR / "raw" / "charts.nosync"
CHART_TILE_CACHE_DIR = DATA_DIR / "raw" / "chart_tiles.nosync"

# A sectional is printed at 1:500,000 (about 42 m per pixel in the
# FAA's raster), which is a web-mercator zoom of 12 at these latitudes;
# past that there is nothing more to see. It is the map's only base
# layer, so it is drawn all the way out to zoom 3, where the whole
# country fits a phone screen (59 degrees of longitude is 335 px
# there) and the chart is its own colours at a five-hundredth of its
# resolution: terrain tint, water, and the cities as yellow dots. A
# terminal area chart is 1:250,000, one zoom further in, and only
# worth drawing close up.
VFR_SECTIONAL_MAX_ZOOM = 12
VFR_SECTIONAL_MIN_ZOOM = 3
VFR_TAC_MAX_ZOOM = 13
VFR_TAC_MIN_ZOOM = 10
