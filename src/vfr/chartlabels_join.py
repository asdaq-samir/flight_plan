"""Assembling a training set for the chart-vision scorer.

Two sources of judgment exist, and both are chart judgments:

- data/labels/chart_picks.csv, made directly on the chart. The right
  shape, but as of writing almost all of them are 5s -- clicking to add
  only ever produces points you would use.
- data/labels/spottability_ratings.csv, the older pass. Anchored to OSM
  ids rather than to the chart, but *rated against the sectional*, which
  is what makes it usable here. Crucially it has spread: 1s through 5s.

So the older pass is joined by position: an OSM candidate whose
coordinates land on a chart detection carries its rating over to that
detection. About a third of them do, which is itself a measurement -- the
rest are things the chart does not draw, the same finding that removed
towers, water towers, quarries and unnamed lakes.
"""
from __future__ import annotations

import csv
from pathlib import Path

from .config import DATA_DIR
from .geo import distance_nm

# Wider than the labeling UI's routecsv.SAME_PLACE_NM (0.2 nm) on
# purpose: this carries OSM points onto chart detections, and an OSM
# point sits off the feature the chart draws as well as shifting between
# overlapping tile blocks.
MATCH_NM = 0.3


def _rows(path: Path) -> list:
    return list(csv.DictReader(path.open())) if path.exists() else []


def osm_labels_with_positions(
    labels_path: Path = DATA_DIR / "labels" / "spottability_ratings.csv",
    candidates_path: Path = DATA_DIR / "processed" / "candidates_c81_kdlh.csv",
) -> list:
    """The older ratings, with the coordinates they were made at."""
    candidates = {(r["osm_id"], r["osm_type"]): r for r in _rows(candidates_path)}
    out = []
    for row in _rows(labels_path):
        candidate = candidates.get((row["osm_id"], row["osm_type"]))
        if candidate:
            out.append({
                "lat": float(candidate["lat"]),
                "lon": float(candidate["lon"]),
                "rating": int(row["rating"]),
            })
    return out


def chart_picks(route: str, path: Path = DATA_DIR / "labels" / "chart_picks.csv") -> list:
    return [
        {"lat": float(r["lat"]), "lon": float(r["lon"]), "rating": int(r["rating"])}
        for r in _rows(path)
        if r["route"] == route and r["rating"] != ""
    ]


def label_detections(detections: list, labels: list, tolerance_nm: float = MATCH_NM) -> list:
    """Attach a rating to each detection a label lands on.

    Each label claims its nearest unclaimed detection, rather than every
    detection asking whether a label is nearby -- the same assignment the
    labeling UI makes, and for the same reason: independent lookups let
    one label rate two neighbouring detections.
    """
    claimed: dict = {}
    for label in labels:
        best, best_nm = None, tolerance_nm
        for index, d in enumerate(detections):
            if index in claimed:
                continue
            lat = d["lat"] if isinstance(d, dict) else d.lat
            lon = d["lon"] if isinstance(d, dict) else d.lon
            gap = distance_nm(label["lat"], label["lon"], lat, lon)
            if gap < best_nm:
                best, best_nm = index, gap
        if best is not None:
            claimed[best] = label["rating"]
    return [(index, rating) for index, rating in sorted(claimed.items())]
