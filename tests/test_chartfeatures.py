"""The chart-vision feature table.

Nothing imports vfr.chartfeatures: it is the reproducible basis for a
measurement the docs record -- on the 77 bootstrap labels available, no
model beat predicting the mean -- and for the re-run its own docstring
asks for once a labelling pass has spread the target. That is a reason
to keep it, not a reason to leave it untested, and it had no tests at
all while its two clutter measures were rewritten from nested Python
loops onto vfr.geo's KD-tree.

These pin what those two measure, so the re-run when it comes is
measuring the landmarks rather than a regression.
"""
import math

import pytest

from vfr.chartfeatures import CHART_CATEGORIES, FEATURE_COLS, build
from vfr.geo import destination_point


def _detection(lat, lon, category="water", area_m2=10_000.0, pixels=500.0, cross_track_nm=0.0):
    return {
        "lat": lat,
        "lon": lon,
        "category": category,
        "area_m2": area_m2,
        "pixels": pixels,
        "cross_track_nm": cross_track_nm,
        "along_track_nm": 10.0,
    }


def test_no_detections_still_gives_the_full_set_of_columns():
    # A corridor the detector found nothing in is an ordinary answer,
    # and a scorer downstream still expects its columns.
    df = build([])
    assert list(df.columns) == ["lat", "lon", "category", *FEATURE_COLS]
    assert df.empty


def test_one_row_per_detection_in_input_order():
    points = [(44.0, -89.0), (44.5, -88.5), (45.0, -88.0)]
    df = build([_detection(lat, lon) for lat, lon in points])
    assert len(df) == 3
    assert [round(v, 4) for v in df["lat"]] == [round(lat, 4) for lat, _ in points]


def test_nearest_neighbour_is_the_distance_to_the_closest_other_detection():
    # Isolation is the feature: a lake among forty is useless however
    # large it is.
    a = (44.0, -89.0)
    near = destination_point(*a, bearing=90, distance_nm_=0.5)
    far = destination_point(*a, bearing=90, distance_nm_=9.0)
    df = build([_detection(*a), _detection(*near), _detection(*far)])

    assert df["nn_dist_nm"].iloc[0] == pytest.approx(0.5, rel=1e-3)
    assert df["nn_dist_nm"].iloc[1] == pytest.approx(0.5, rel=1e-3)
    assert df["nn_dist_nm"].iloc[2] == pytest.approx(8.5, rel=1e-3)


def test_a_lone_detection_has_a_nearest_neighbour_of_zero():
    # Not infinity: the KD-tree has no neighbour to offer, and a model
    # has no use for an infinite feature. Zero is what the loop this
    # replaced returned.
    df = build([_detection(44.0, -89.0)])
    assert df["nn_dist_nm"].iloc[0] == 0.0
    assert not math.isinf(df["nn_dist_nm"].iloc[0])


def test_same_kind_counts_only_its_own_category_and_not_itself():
    # A river crossing two miles from four other river crossings is a
    # different proposition from one on its own, and a nearby town is
    # not company in that sense.
    a = (44.0, -89.0)
    close_river = destination_point(*a, bearing=90, distance_nm_=1.0)
    close_town = destination_point(*a, bearing=270, distance_nm_=1.0)
    far_river = destination_point(*a, bearing=90, distance_nm_=5.0)

    df = build([
        _detection(*a, category="river"),
        _detection(*close_river, category="river"),
        _detection(*close_town, category="town"),
        _detection(*far_river, category="river"),
    ])

    assert df["same_kind_within_2nm"].iloc[0] == 1   # the close river, not the town, not itself
    assert df["same_kind_within_2nm"].iloc[1] == 1
    assert df["same_kind_within_2nm"].iloc[2] == 0   # the only town
    assert df["same_kind_within_2nm"].iloc[3] == 0   # five miles from the others


def test_the_two_mile_radius_is_the_boundary():
    a = (44.0, -89.0)
    inside = destination_point(*a, bearing=90, distance_nm_=1.9)
    outside = destination_point(*a, bearing=270, distance_nm_=2.1)
    df = build([_detection(*a), _detection(*inside), _detection(*outside)])
    # 1.9 counts and 2.1 does not, so the middle point sees one
    # neighbour, the near one sees only the middle (the far one is four
    # miles from it), and the far one sees nobody.
    assert df["same_kind_within_2nm"].iloc[0] == 1
    assert df["same_kind_within_2nm"].iloc[1] == 1
    assert df["same_kind_within_2nm"].iloc[2] == 0


def test_area_is_logged_with_a_floor_so_a_crossing_is_not_negative_infinity():
    # A crossing has no area at all, and log10(0) would poison the column.
    df = build([_detection(44.0, -89.0, area_m2=0.0), _detection(44.5, -88.5, area_m2=1_000_000.0)])
    assert df["log_area"].iloc[0] == 0.0
    assert df["log_area"].iloc[1] == pytest.approx(6.0)


def test_the_category_is_one_hot_over_a_fixed_set():
    # Fixed rather than derived from whatever a route contained, so a
    # model trained on one corridor can score another.
    df = build([_detection(44.0, -89.0, category="town")])
    assert df["is_town"].iloc[0] == 1
    assert sum(df[f"is_{c}"].iloc[0] for c in CHART_CATEGORIES) == 1


def test_along_track_is_deliberately_absent_from_the_features():
    # Where a landmark sits along one route says nothing about spotting
    # it and everything about which route it is -- measured at 78% of a
    # model's apparent gain.
    df = build([_detection(44.0, -89.0)])
    assert "along_track_nm" not in df.columns
    assert "abs_cross_track_nm" in df.columns
