"""The ground under the whole of the lower 48 read once, so a plan's floor
needs no tiles: the highest and the lowest ground in every cell of a grid
a 120th of a degree on a side (half a nautical mile north to south), from
the same elevation tiles vfr.elevation reads (AWS Terrain Tiles, USGS 3DEP
and SRTM), at zoom 11 (some 60 m a pixel in the lower 48).

Why: a route's floor (vfr.terrain.floor_profile) fetched and decoded the
tiles under it point by point, and kept every point in a CSV it parsed
again whenever another request had added to it. A new route waited on
that: 3 to 10 s a leg on a quiet Mac, 80 s a leg on a busy one (a 3,000 nm
route of eleven stops, 2026-10-23). Read from here, a leg's floor is a few
array reads.

And it is the more careful read: the points were two miles apart along the
line, each the height of one pixel, so a ridge between two of them was
missed; a cell's highest is the highest of every pixel in it, and every
cell the line crosses is read (vfr.terrain). Its lowest is kept beside, for
the lowest ground under a leg -- 14 CFR 91.159's 3,000 ft above the surface
is from there -- which the highest would put too high.

Built once by `python -m vfr.ground_grid` (resumable, row of tiles by row
of tiles; the tiles are not kept), into data/raw/ground_grid. Where it has
not been built, or a point is outside it, vfr.terrain reads the tiles as it
did.
"""
from __future__ import annotations

import io
import json
import math
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import requests

from .units import M_TO_FT

#: The grid's extent: the lower 48 and a margin round it, degrees.
SOUTH, NORTH, WEST, EAST = 24.0, 50.0, -125.0, -66.0
#: Cells a degree, each way.
PER_DEG = 120
ROWS = int((NORTH - SOUTH) * PER_DEG)
COLS = int((EAST - WEST) * PER_DEG)
#: The tiles it is read from.
ZOOM = 11
TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
HEADERS = {"User-Agent": "wingtip-maps/0.1 (VFR flight planner; terrain floor)"}
DIR = Path(__file__).resolve().parents[2] / "data" / "raw" / "ground_grid"
HIGH_PATH = DIR / "high_ft.npy"
LOW_PATH = DIR / "low_ft.npy"
#: The tile rows already read into the grid, for a build stopped part way.
DONE_PATH = DIR / "rows_done.json"
#: Added to a cell's highest: the zoom-11 tiles are drawn from the finer
#: ones by averaging, and a peak's pixel at zoom 12 (vfr.elevation's) stood
#: up to 119 ft above its cell's highest at 11, on 4,768 points every half
#: mile along fourteen routes over the West and the Appalachians (1% of
#: them above it at all; 2026-10-23). With this, the floor read here is
#: never under the one the zoom-12 points gave.
RESAMPLED_MARGIN_FT = 150
#: A cell no tile reached (open sea past the tiles' own edge is 0 m).
NONE = np.iinfo(np.int16).min

_HELD: dict = {}
_HELD_LOCK = threading.Lock()


def _tile_x(lon):
    return (np.asarray(lon) + 180.0) / 360.0 * 2 ** ZOOM


def _tile_y(lat):
    lat = np.radians(np.asarray(lat))
    return (1.0 - np.arcsinh(np.tan(lat)) / np.pi) / 2.0 * 2 ** ZOOM


def _lon_of(x):
    return np.asarray(x) / 2 ** ZOOM * 360.0 - 180.0


def _lat_of(y):
    return np.degrees(np.arctan(np.sinh(np.pi * (1.0 - 2.0 * np.asarray(y) / 2 ** ZOOM))))


#: How long "not built" is believed before the files are looked for again,
#: s: a server builds its grid in the background after a deploy, and the
#: planner beside it takes it up once it is there, with no restart.
LOOK_AGAIN_S = 600


def _grids() -> tuple[np.ndarray, np.ndarray] | None:
    """The built grids, memory-mapped once; None where none is built."""
    import time

    with _HELD_LOCK:
        held = _HELD.get("grids")
        if held is not None and (held[1] is not None or time.monotonic() - held[0] < LOOK_AGAIN_S):
            return held[1]
        grids = None
        if HIGH_PATH.exists() and LOW_PATH.exists() and not DONE_PATH.exists():
            grids = (np.load(HIGH_PATH, mmap_mode="r"), np.load(LOW_PATH, mmap_mode="r"))
        _HELD["grids"] = (time.monotonic(), grids)
        return grids


def _cells(lats: np.ndarray, lons: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
    rows = np.floor((np.asarray(lats) - SOUTH) * PER_DEG).astype(int)
    cols = np.floor((np.asarray(lons) - WEST) * PER_DEG).astype(int)
    if rows.size == 0 or rows.min() < 0 or rows.max() >= ROWS or cols.min() < 0 or cols.max() >= COLS:
        return None
    return rows, cols


def ground_ft(lats, lons) -> tuple[np.ndarray, np.ndarray] | None:
    """The highest and the lowest ground, ft, in the cell of each point;
    None where the grid is not built or any point is outside it or in a
    cell no tile reached, so the caller reads the tiles instead."""
    grids = _grids()
    if grids is None:
        return None
    at = _cells(lats, lons)
    if at is None:
        return None
    high, low = grids
    h, lo = high[at], low[at]
    if (h == NONE).any():
        return None
    return h.astype(float) + RESAMPLED_MARGIN_FT, lo.astype(float)


def line_points(start: tuple, end: tuple) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Points along the line from start to end close enough that every
    cell it crosses holds one -- a third of a cell apart -- and how far
    along each is, nm: (lats, lons, along_nm)."""
    from . import geo

    total = float(geo.distance_nm(start[0], start[1], end[0], end[1]))
    span = max(abs(end[0] - start[0]), abs(end[1] - start[1]))
    n = max(2, int(math.ceil(span * PER_DEG * 3)) + 1)
    t = np.linspace(0.0, 1.0, n)
    # Along the great circle, not the straight line on the chart: the
    # same path vfr.terrain's samples and the course line take.
    a = np.radians(start)
    b = np.radians(end)
    va = np.array([np.cos(a[0]) * np.cos(a[1]), np.cos(a[0]) * np.sin(a[1]), np.sin(a[0])])
    vb = np.array([np.cos(b[0]) * np.cos(b[1]), np.cos(b[0]) * np.sin(b[1]), np.sin(b[0])])
    omega = math.acos(min(1.0, max(-1.0, float(va @ vb))))
    if omega < 1e-12:
        v = np.outer(np.ones_like(t), va)
    else:
        v = (np.outer(np.sin((1 - t) * omega), va) + np.outer(np.sin(t * omega), vb)) / math.sin(omega)
    lats = np.degrees(np.arctan2(v[:, 2], np.hypot(v[:, 0], v[:, 1])))
    lons = np.degrees(np.arctan2(v[:, 1], v[:, 0]))
    return lats, lons, t * total


# --- The build ---


def _fetch(session: requests.Session, x: int, y: int) -> np.ndarray | None:
    """A tile's heights, m; None for one the bucket has not (the sea)."""
    from PIL import Image

    for attempt in range(4):
        try:
            resp = session.get(TILE_URL.format(z=ZOOM, x=x, y=y), headers=HEADERS, timeout=30)
            if resp.status_code in (403, 404):
                return None
            resp.raise_for_status()
            rgb = np.asarray(Image.open(io.BytesIO(resp.content)).convert("RGB")).astype(np.float64)
            return rgb[:, :, 0] * 256 + rgb[:, :, 1] + rgb[:, :, 2] / 256 - 32768
        except (requests.RequestException, OSError):
            if attempt == 3:
                raise
    return None


def _into(high: np.ndarray, low: np.ndarray, x: int, y: int, heights: np.ndarray) -> None:
    """A tile's pixels into the cells they fall in: each cell's highest
    and lowest of its pixels."""
    size = heights.shape[0]
    px = x + (np.arange(size) + 0.5) / size
    py = y + (np.arange(size) + 0.5) / size
    lons = _lon_of(px)
    lats = _lat_of(py)
    cols = np.floor((lons - WEST) * PER_DEG).astype(int)
    rows = np.floor((lats - SOUTH) * PER_DEG).astype(int)
    keep_c = (cols >= 0) & (cols < COLS)
    keep_r = (rows >= 0) & (rows < ROWS)
    if not keep_c.any() or not keep_r.any():
        return
    ft = heights[np.ix_(keep_r, keep_c)] * M_TO_FT
    rr, cc = np.meshgrid(rows[keep_r], cols[keep_c], indexing="ij")
    flat = rr.ravel() * COLS + cc.ravel()
    values = np.clip(np.round(ft.ravel()), -30000, 32000).astype(np.int16)
    hi_flat, lo_flat = high.reshape(-1), low.reshape(-1)
    # Cells not yet reached hold NONE: the highest takes over from it, the
    # lowest is set where it is still NONE.
    np.maximum.at(hi_flat, flat, values)
    unset = lo_flat[flat] == NONE
    lo_flat[flat[unset]] = 32767
    np.minimum.at(lo_flat, flat, values)


def build(workers: int = 12) -> None:
    """Reads every zoom-11 tile over the grid into it, a row of tiles at
    a time, keeping the rows done, so a build stopped carries on."""
    DIR.mkdir(parents=True, exist_ok=True)
    if HIGH_PATH.exists() and LOW_PATH.exists():
        high = np.load(HIGH_PATH)
        low = np.load(LOW_PATH)
    else:
        high = np.full((ROWS, COLS), NONE, dtype=np.int16)
        low = np.full((ROWS, COLS), NONE, dtype=np.int16)
    done = set(json.loads(DONE_PATH.read_text())) if DONE_PATH.exists() else set()
    x0, x1 = int(_tile_x(WEST)), int(_tile_x(EAST))
    y0, y1 = int(_tile_y(NORTH)), int(_tile_y(SOUTH))
    session = requests.Session()
    session.mount("https://", requests.adapters.HTTPAdapter(pool_connections=1, pool_maxsize=workers))
    with ThreadPoolExecutor(workers) as pool:
        for y in range(y0, y1 + 1):
            if y in done:
                continue
            tiles = list(pool.map(lambda x, y=y: (x, _fetch(session, x, y)), range(x0, x1 + 1)))
            for x, heights in tiles:
                if heights is not None:
                    _into(high, low, x, y, heights)
            done.add(y)
            # Kept every ten rows (two 44 MB arrays a write), and at the end.
            if len(done) % 10 == 0 or y == y1:
                np.save(HIGH_PATH, high)
                np.save(LOW_PATH, low)
                DONE_PATH.write_text(json.dumps(sorted(done)))
            print(f"row {y - y0 + 1} of {y1 - y0 + 1}", flush=True)
    # Built: the rows' record goes, and the grid is read from now on.
    np.save(HIGH_PATH, high)
    np.save(LOW_PATH, low)
    DONE_PATH.unlink()
    with _HELD_LOCK:
        _HELD.pop("grids", None)


if __name__ == "__main__":
    build()
