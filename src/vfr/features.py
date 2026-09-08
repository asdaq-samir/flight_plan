"""Feature engineering shared by Notebook 02 (pandas) and, later, Notebook
06 (Spark). Kept dependency-light (plain pandas/numpy, no sklearn) so the
Spark notebook can reimplement the same feature *definitions* with the
Spark DataFrame API without importing pandas-specific code.
"""
import numpy as np
import pandas as pd

from .geo import EARTH_RADIUS_NM


def log_size_feature(bbox_area_m2: pd.Series) -> pd.Series:
    """log1p of footprint area. Point features (bbox_area_m2 == 0, e.g. a
    water-tower node) map to 0; log-scaling keeps a handful of huge lakes
    from dominating a linear model's size coefficient.
    """
    return np.log1p(bbox_area_m2)


def name_uniqueness(names: pd.Series) -> pd.Series:
    """1.0 if a candidate's name doesn't repeat elsewhere in the table,
    lower the more other candidates share it, NaN if unnamed. "Long Lake"
    appearing three times along the route is a worse waypoint reference
    than a single "Long Lake" would be -- a pilot can't tell which one a
    checkpoint list means.
    """
    counts = names.value_counts()
    shared = names.map(counts)
    return np.where(names.isna(), np.nan, 1.0 / shared)


def nearest_neighbor_distance_nm(lat: pd.Series, lon: pd.Series) -> pd.Series:
    """Great-circle distance from each candidate to its closest other
    candidate -- "clutter": two landmarks 0.1 nm apart are harder to
    distinguish from the air (and to describe unambiguously on a nav log)
    than two 10 nm apart. Vectorized pairwise haversine; fine for the
    couple hundred candidates on one route.
    """
    lat_r = np.radians(lat.to_numpy())
    lon_r = np.radians(lon.to_numpy())
    dlat = lat_r[:, None] - lat_r[None, :]
    dlon = lon_r[:, None] - lon_r[None, :]
    a = np.sin(dlat / 2) ** 2 + np.cos(lat_r[:, None]) * np.cos(lat_r[None, :]) * np.sin(dlon / 2) ** 2
    dist_matrix = 2 * EARTH_RADIUS_NM * np.arcsin(np.sqrt(np.clip(a, 0, 1)))
    np.fill_diagonal(dist_matrix, np.inf)
    return pd.Series(dist_matrix.min(axis=1), index=lat.index)
