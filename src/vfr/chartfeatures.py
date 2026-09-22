"""Turning chart-vision detections into something a model can score.

The tabular pipeline's features (vfr.features) describe OSM objects:
name uniqueness, bbox area from a relation's geometry, elevation
prominence sampled per candidate. None of that exists for a blob read off
a raster, so this is the chart's own equivalent -- what the detector knows
about a thing, which is what a scorer for it has to work from.

Deliberately small. Five numbers and a category, because there are only
63 bootstrap labels to learn from (see label_chart_detections) and a wide
feature table on a narrow label set learns the labels rather than the
problem -- which this project has already seen once, when route position
recovered 78% of a model's apparent gain.

Measured 2026-09-10, and the result was negative. On the 77 bootstrap
labels that land on a detection:

    palette constants   MAE 0.810
    predict the mean    MAE 0.804
    Ridge               MAE 0.841
    RandomForest        MAE 0.824
    GradientBoosting    MAE 0.826

Nothing beats predicting the mean, and the hand-set palette constants
are already tied with it. The labels are the reason, not the features:
79% of them are 4 or 5 and 3% are 0 or 1, because they were made by
clicking points worth using, and every category's ratings span nearly
the full scale (river 4.40, water 4.27, town 4.00, road_or_rail 3.67 --
all inside one standard deviation of each other). There is no separation
in the target for a model to find.

The top feature was abs_cross_track_nm at 0.355, which is not a property
of the landmark but of where the cursor went -- the same leakage in a
new coat.

So this module is plumbing waiting on a label set, not a shipped
ranker. Re-run it after a labeling pass that deliberately rates poor
landmarks as poor; until the target has spread, the palette constants
are the better scorer and the honest one.
"""
from __future__ import annotations

import math

import pandas as pd

from . import geo

# Every category the detector can emit. Fixed rather than derived from
# whatever a given route happened to contain, so a model trained on one
# corridor can score another without its columns shifting underneath it.
CHART_CATEGORIES = ("water", "town", "river", "road_or_rail", "airport")

FEATURE_COLS = [
    "log_area",
    "linework_px",
    "abs_cross_track_nm",
    "nn_dist_nm",
    "same_kind_within_2nm",
] + [f"is_{c}" for c in CHART_CATEGORIES]


def _nearest_neighbour_nm(lats, lons) -> list:
    """Distance from each detection to the closest other one, of any kind.

    Isolation is most of what makes a landmark identifiable: one lake
    among forty is useless however large it is, which is the single
    clearest thing the hand-labelling showed.

    vfr.geo's KD-tree answers the whole list at once. This was a nested
    Python loop calling the scalar distance once per pair, which is
    quadratic: a corridor of a few hundred detections spent seconds in
    it. A lone detection has no neighbour, and keeps the zero the old
    loop returned for that case rather than an infinity the model has no
    use for.
    """
    nearest = geo.nearest_neighbour_nm(lats, lons)
    return [0.0 if math.isinf(d) else float(d) for d in nearest]


def build(detections: list) -> pd.DataFrame:
    """Feature rows for a list of chart-vision Landmarks (or the dicts the
    API returns for them). One row per detection, in the same order."""
    rows = [
        {
            "lat": float(d["lat"] if isinstance(d, dict) else d.lat),
            "lon": float(d["lon"] if isinstance(d, dict) else d.lon),
            "category": d["category"] if isinstance(d, dict) else d.category,
            "area_m2": float(d["area_m2"] if isinstance(d, dict) else d.area_m2),
            "pixels": float((d.get("pixels", 0) if isinstance(d, dict) else d.pixels) or 0),
            "cross_track_nm": float(
                d["cross_track_nm"] if isinstance(d, dict) else d.extras["cross_track_nm"]
            ),
            "along_track_nm": float(
                d["along_track_nm"] if isinstance(d, dict) else d.extras["along_track_nm"]
            ),
        }
        for d in detections
    ]
    df = pd.DataFrame(rows)
    if df.empty:
        return pd.DataFrame(columns=["lat", "lon", "category", *FEATURE_COLS])

    lats = df["lat"].to_numpy()
    lons = df["lon"].to_numpy()

    # Area spans four orders of magnitude between a pond and a town, and
    # a crossing has none at all, so it is logged with a floor rather than
    # used raw.
    df["log_area"] = df["area_m2"].clip(lower=1.0).apply(math.log10)
    df["linework_px"] = df["pixels"]
    df["abs_cross_track_nm"] = df["cross_track_nm"].abs()
    df["nn_dist_nm"] = _nearest_neighbour_nm(lats, lons)

    # Clutter of the same kind specifically. A river crossing two miles
    # from four other river crossings is a different proposition from one
    # on its own, and that is not visible in nn_dist_nm, which counts a
    # nearby town as company. The KD-tree returns everything within two
    # miles of each detection; the category filter is then a handful of
    # comparisons per detection rather than one per pair.
    categories = df["category"].to_numpy()
    df["same_kind_within_2nm"] = [
        sum(1 for j in neighbours if j != i and categories[j] == categories[i])
        for i, neighbours in enumerate(geo.neighbours_within_nm(lats, lons, 2.0))
    ]

    for category in CHART_CATEGORIES:
        df[f"is_{category}"] = (df["category"] == category).astype(int)

    # along_track_nm is deliberately absent. Where a landmark sits along
    # one route says nothing about spotting it and everything about which
    # route it is: measured on the tabular model, position alone recovered
    # 78% of the gain over a predict-the-mean baseline.
    return df[["lat", "lon", "category", *FEATURE_COLS]]
