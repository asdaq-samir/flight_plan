"""Where a route is over large water, out of an airplane's glide to dry
land: for FPL's Routes' way that keeps over land, at the owner's ask ("a
route to avoid large water bodies ... for engine failure emergency,
landing is feasible on a dry land", 2026-10-25).

The land and the large lakes are Natural Earth's at 1:50 million (public
domain: naturalearthdata.com), the Great Lakes, the big reservoirs and
the oceans among them, read once from the project's GitHub copy and kept
in data/raw/natural_earth. A point is water where it is off the land or on
a lake; "out of glide" where water runs on round it for more than
GLIDE_NM every way.
"""
from __future__ import annotations

import json
import logging
import threading
from pathlib import Path

import numpy as np
import requests
import shapely
from scipy import ndimage
from shapely.geometry import shape

logger = logging.getLogger(__name__)

DIR = Path(__file__).resolve().parents[2] / "data" / "raw" / "natural_earth"
#: Natural Earth 5.1.2's own files, pinned, so a later release cannot
#: move the shore under a kept answer.
SOURCES = {
    "land": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_land.geojson",
    "lakes": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_lakes.geojson",
}
#: How far from dry land an engine failure still reaches it, nm: the
#: planner's own figure, not a rule's -- a light single's best glide of
#: about 9 to 1 (the C172S's POH, section 3, "Maximum Glide": 1.5 nm a
#: thousand feet above the ground) from some 4,000 ft over the water.
#: 14 CFR 91.205(b)(12) draws the same line, flotation gear for a flight
#: for hire beyond power-off gliding distance from the shore.
GLIDE_NM = 6.0
#: How fine water is read, deg: a twentieth of a degree, 3 nm north-south,
#: half the glide, so a shore is never more than a sample off.
STEP_DEG = 0.05

_LOCK = threading.Lock()
_HELD: dict = {}


class WaterUnavailable(RuntimeError):
    """The land and lakes could not be had: the water is not read."""


def _read(name: str) -> object:
    path = DIR / f"ne_50m_{name}.geojson"
    if not path.exists():
        try:
            resp = requests.get(SOURCES[name], timeout=60)
            resp.raise_for_status()
        except requests.RequestException as err:
            raise WaterUnavailable(f"{name}: {err}") from err
        DIR.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        tmp.write_bytes(resp.content)
        tmp.replace(path)
    features = json.loads(path.read_text())["features"]
    geometry = shapely.union_all([shape(f["geometry"]) for f in features])
    shapely.prepare(geometry)
    return geometry


def _shapes() -> tuple:
    with _LOCK:
        if "land" not in _HELD:
            _HELD["land"] = _read("land")
            _HELD["lakes"] = _read("lakes")
        return _HELD["land"], _HELD["lakes"]


def preload() -> None:
    """Read the land and lakes now, not on the first route's ask."""
    _shapes()


def is_water(lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    """Whether each point is on water: off the land, or on a large lake."""
    land, lakes = _shapes()
    return ~shapely.contains_xy(land, lons, lats) | shapely.contains_xy(lakes, lons, lats)


def out_of_glide(lat0: float, lon0: float, rows: int, cols: int, cell_deg: float) -> np.ndarray:
    """For each cell of a grid (its south-west corner at lat0, lon0, `rows`
    by `cols` cells of `cell_deg`), the share of it, 0 to 1, over water
    more than GLIDE_NM from dry land, read every STEP_DEG.

    A WaterUnavailable where the land and lakes could not be had."""
    per = max(1, int(round(cell_deg / STEP_DEG)))
    step = cell_deg / per
    lats = lat0 + (np.arange(rows * per) + 0.5) * step
    lons = lon0 + (np.arange(cols * per) + 0.5) * step
    lat_grid, lon_grid = np.meshgrid(lats, lons, indexing="ij")
    wet = is_water(lat_grid.ravel(), lon_grid.ravel()).reshape(lat_grid.shape)
    # Miles to the nearest dry sample, rows and columns at their own
    # scale (a degree of longitude is the cosine of the latitude's).
    mid = np.radians((lats[0] + lats[-1]) / 2)
    nm_row, nm_col = step * 60.0, step * 60.0 * max(0.2, float(np.cos(mid)))
    if wet.all():
        far = np.ones_like(wet, dtype=bool)
    else:
        far = ndimage.distance_transform_edt(wet, sampling=(nm_row, nm_col)) > GLIDE_NM
    return far.reshape(rows, per, cols, per).mean(axis=(1, 3))
