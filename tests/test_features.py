import numpy as np
import pandas as pd
import pytest

from vfr.features import log_size_feature, name_uniqueness, nearest_neighbor_distance_nm


def test_log_size_feature_zero_area_maps_to_zero():
    result = log_size_feature(pd.Series([0.0]))
    assert result.iloc[0] == pytest.approx(0.0)


def test_log_size_feature_is_monotonic():
    result = log_size_feature(pd.Series([0.0, 100.0, 10000.0]))
    assert result.iloc[0] < result.iloc[1] < result.iloc[2]


def test_name_uniqueness_unique_name_is_one():
    names = pd.Series(["Round Lake", "Fox Lake", "Long Lake"])
    result = name_uniqueness(names)
    assert result.tolist() == pytest.approx([1.0, 1.0, 1.0])


def test_name_uniqueness_repeated_name_is_fractional():
    names = pd.Series(["Long Lake", "Long Lake", "Round Lake"])
    result = name_uniqueness(names)
    assert result[0] == pytest.approx(0.5)
    assert result[1] == pytest.approx(0.5)
    assert result[2] == pytest.approx(1.0)


def test_name_uniqueness_unnamed_is_nan():
    names = pd.Series(["Round Lake", None])
    result = name_uniqueness(names)
    assert np.isnan(result[1])


def test_nearest_neighbor_distance_nm_finds_the_closer_of_two():
    # three points on the same meridian, 1nm and 10nm apart -- the middle
    # point's nearest neighbor should be ~1nm away, not ~10nm
    one_deg_lat_nm = 60.04
    lat = pd.Series([0.0, 1.0 / one_deg_lat_nm, 10.0 / one_deg_lat_nm])
    lon = pd.Series([0.0, 0.0, 0.0])
    result = nearest_neighbor_distance_nm(lat, lon)
    assert result.iloc[1] == pytest.approx(1.0, rel=0.05)
