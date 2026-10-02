"""Ratings carried onto the chart reader's detections by position.

Each label claims its nearest unclaimed detection within a tolerance --
the same assignment the training page makes -- so a rating made on the
chart lands on the detection it was made on. vfr.chartmodel uses it for
the training page's picks, at routecsv.SAME_PLACE_NM.

It once also carried the older OSM-anchored ratings over to detections,
for a bootstrap set; those ratings are the landmark model's alone now.
"""
from __future__ import annotations

from .geo import distance_nm

# The default, wider than the training page's routecsv.SAME_PLACE_NM
# (0.2 nm), from when OSM points were carried onto detections: an OSM
# point sits off the feature the chart draws.
MATCH_NM = 0.3


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
