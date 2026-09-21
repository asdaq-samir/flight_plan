"""FAA VFR charts, drawn from the FAA's own GeoTIFFs.

The map used to draw the sectional from a hosted ArcGIS map service:
first the FAA's own tile cache, then Texas A&M's public mirror once the
FAA put theirs behind a login. Each was a dependency on someone else's
server for the one layer a pilot actually looks at, and each rendered
the chart its own way -- reprojected, resampled, and (for the mirror)
with a no-data checkerboard wherever its mosaic ran out, which it did
just west of Duluth.

The FAA publishes every sectional and terminal area chart (TAC) as a
georeferenced TIFF, free, on the same 56-day cycle as the paper chart.
This module downloads the ones a route needs, once per cycle, and
renders {z}/{x}/{y} tiles from them: the chart exactly as printed,
served by this app.

Two things make that more than a file download:

- The rasters include the printed sheet's collar -- the legend column,
  the communication boxes, the title -- georeferenced along with the
  chart face. Drawn as-is, the legend of one chart would paper over its
  neighbour along every seam. `detect_face` finds the neatline (the
  black border the chart face ends at) in each raster, and the renderer
  clips to it so adjacent charts butt together.

- Charts overlap (the sheets of the 36-40N row share a degree or so
  with their neighbours; a TAC sits inside its sectional), so a tile is
  composited from every chart whose face covers it.

Which chart covers where is `COVERAGE` below: each raster's own
bounding box, read from the FGDC metadata the FAA ships in every zip.
That is a superset of the chart face (collar included), which is the
right shape for deciding what to download; the face itself is measured
from the pixels once the raster is here.
"""
from __future__ import annotations

import io
import json
import logging
import math
import os
import re
import shutil
import threading
import time
import zipfile
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import requests
from PIL import Image

from .config import (
    CHART_TILE_CACHE_DIR,
    CHARTS_DIR,
    FAA_CHART_CYCLE_ANCHOR,
    FAA_CHART_CYCLE_DAYS,
    FAA_CHART_ZIP_URL,
    FAA_VFR_PRODUCTS_PAGE,
    VFR_SECTIONAL_MAX_ZOOM,
    VFR_SECTIONAL_MIN_ZOOM,
    VFR_TAC_MAX_ZOOM,
    VFR_TAC_MIN_ZOOM,
)

log = logging.getLogger(__name__)

TILE_PX = 256
REQUEST_HEADERS = {"User-Agent": "vfr-route-learning-project/0.1"}

# Web mercator's half-world extent in metres (EPSG:3857) -- the origin
# the standard {z}/{x}/{y} tile grid is laid out from -- and the sphere
# it is defined on.
_MERCATOR_ORIGIN_M = 20037508.342789244
_EARTH_RADIUS_M = 6378137.0
_METRES_PER_DEGREE = 111_320.0

Box = tuple[float, float, float, float]  # (west, south, east, north), degrees


@dataclass(frozen=True)
class ChartKind:
    key: str            # what the API and the tile cache call it
    folder: str         # the FAA's folder under a cycle
    zip_suffix: str     # appended to the chart name in the zip's name
    raster_suffix: str  # which members of the zip are the chart (a TAC zip also carries the flyway planning chart)
    min_zoom: int
    max_zoom: int
    # Typical collar widths (west, south, east, north) in degrees, for
    # a raster whose neatline could not be found: the sectional's west
    # collar is the legend column, its north one the communication
    # boxes; a TAC carries its legend down both sides.
    fallback_collar: Box


SECTIONAL = ChartKind("sec", "sectional-files", "", " SEC.tif", VFR_SECTIONAL_MIN_ZOOM, VFR_SECTIONAL_MAX_ZOOM,
                      (1.1, 0.2, 0.35, 0.55))
TAC = ChartKind("tac", "tac-files", "_TAC", " TAC.tif", VFR_TAC_MIN_ZOOM, VFR_TAC_MAX_ZOOM,
                (0.35, 0.02, 0.35, 0.08))
KINDS = {kind.key: kind for kind in (SECTIONAL, TAC)}

# Every chart's raster envelope (west, south, east, north), collar
# included, keyed by the name the FAA's zip carries. Read from the FGDC
# .htm inside each zip of the 09-03-2026 cycle; the sheets do not move
# between editions. A TAC zip can hold more than one chart (Denver's
# also carries Colorado Springs, Seattle's carries Portland) -- listed
# as the union, since the zip is the unit of download.
COVERAGE: dict[str, dict[str, Box]] = {
    "sec": {
        "Albuquerque": (-110.22, 31.50, -101.76, 36.29),
        "Atlanta": (-89.24, 31.82, -80.75, 36.62),
        "Billings": (-110.59, 44.29, -100.27, 49.10),
        "Brownsville": (-103.75, 23.52, -96.58, 28.27),
        "Charlotte": (-82.82, 31.50, -74.86, 36.29),
        "Cheyenne": (-110.17, 39.79, -100.62, 44.61),
        "Chicago": (-94.18, 39.77, -84.62, 44.59),
        "Cincinnati": (-86.61, 35.50, -77.71, 40.29),
        "Dallas-Ft_Worth": (-103.23, 31.52, -94.77, 36.28),
        "Denver": (-111.95, 35.32, -103.71, 40.13),
        "Detroit": (-86.14, 39.48, -76.63, 44.30),
        "El_Paso": (-109.87, 27.53, -102.44, 32.27),
        "Great_Falls": (-118.59, 44.26, -108.27, 49.09),
        "Green_Bay": (-94.52, 43.61, -84.31, 48.42),
        "Halifax": (-70.06, 43.49, -60.62, 48.29),
        "Houston": (-97.87, 27.56, -90.44, 32.27),
        "Jacksonville": (-85.88, 27.49, -78.43, 32.28),
        "Kansas_City": (-97.96, 35.50, -89.71, 40.29),
        "Klamath_Falls": (-126.18, 39.78, -116.62, 44.61),
        "Lake_Huron": (-86.51, 43.51, -76.33, 48.30),
        "Las_Vegas": (-119.54, 35.34, -110.70, 40.12),
        "Los_Angeles": (-122.40, 31.90, -114.51, 36.67),
        "Memphis": (-96.22, 31.49, -87.78, 36.29),
        "Miami": (-83.78, 23.79, -76.33, 28.55),
        "Montreal": (-78.50, 43.50, -68.31, 48.31),
        "New_Orleans": (-91.89, 27.50, -84.44, 32.27),
        "New_York": (-78.14, 39.47, -68.65, 44.29),
        "Omaha": (-102.18, 39.80, -92.62, 44.62),
        "Phoenix": (-117.14, 31.22, -108.72, 36.00),
        "Salt_Lake_City": (-118.16, 39.79, -108.62, 44.60),
        "San_Antonio": (-103.90, 27.55, -96.34, 32.27),
        "San_Francisco": (-125.95, 35.86, -117.63, 40.64),
        "Seattle": (-126.58, 44.28, -116.27, 49.09),
        "St_Louis": (-92.65, 35.50, -83.74, 40.30),
        "Twin_Cities": (-102.61, 44.29, -92.26, 49.11),
        "Washington": (-79.95, 35.50, -71.65, 40.28),
        "Wichita": (-104.91, 35.51, -96.63, 40.30),
    },
    "tac": {
        "Atlanta": (-85.66, 32.95, -83.58, 34.42),
        "Baltimore-Washington": (-78.74, 38.13, -75.74, 39.84),
        "Boston": (-72.30, 41.20, -69.05, 42.94),
        "Charlotte": (-82.20, 34.55, -80.07, 36.00),
        "Chicago": (-89.18, 41.43, -86.84, 42.59),
        "Cincinnati": (-85.93, 38.44, -83.68, 40.13),
        "Cleveland": (-83.03, 40.81, -80.57, 42.01),
        "Dallas-Ft_Worth": (-98.59, 32.02, -95.85, 33.70),
        "Denver": (-106.30, 37.62, -103.41, 40.63),
        "Detroit": (-85.09, 41.43, -82.36, 42.88),
        "Houston": (-96.48, 29.06, -94.49, 30.60),
        "Kansas_City": (-96.30, 38.66, -93.54, 40.14),
        "Las_Vegas": (-116.36, 35.64, -113.84, 36.85),
        "Los_Angeles": (-120.23, 33.37, -116.42, 34.54),
        "Memphis": (-91.26, 34.35, -88.64, 35.82),
        "Miami": (-81.51, 25.09, -79.30, 26.78),
        "Minneapolis-St_Paul": (-94.47, 44.31, -91.58, 45.49),
        "New_Orleans": (-91.63, 29.52, -89.32, 30.68),
        "New_York": (-75.68, 40.17, -72.62, 41.38),
        "Philadelphia": (-76.42, 38.98, -73.86, 40.63),
        "Phoenix": (-113.57, 32.75, -111.15, 34.20),
        "Pittsburgh": (-81.38, 39.92, -78.96, 41.11),
        "Salt_Lake_City": (-113.32, 40.09, -110.64, 41.55),
        "San_Diego": (-119.04, 32.45, -116.27, 33.65),
        "San_Francisco": (-123.91, 36.86, -121.36, 38.26),
        "Seattle": (-123.70, 45.15, -121.04, 48.17),
        "St_Louis": (-91.46, 38.11, -89.21, 39.33),
    },
}


# ---------------------------------------------------------------------------
# The chart cycle
# ---------------------------------------------------------------------------

_CYCLE_RE = re.compile(r"aeronav\.faa\.gov/visual/(\d{2}-\d{2}-\d{4})/sectional-files")
_CYCLE_TTL_S = 6 * 3600
_cycle_cache: dict = {"value": None, "at": 0.0}
_cycle_lock = threading.Lock()


def cycle_from_anchor(today: date) -> str:
    """The cycle date in effect on `today`, by 56-day arithmetic from
    the anchor -- what the FAA's page would say, without asking it."""
    anchor = date.fromisoformat(FAA_CHART_CYCLE_ANCHOR)
    cycles = (today - anchor).days // FAA_CHART_CYCLE_DAYS
    return (anchor + timedelta(days=cycles * FAA_CHART_CYCLE_DAYS)).strftime("%m-%d-%Y")


def cycle_from_products_page(html: str, today: date) -> str | None:
    """The latest cycle the products page links that is already in
    effect. The page lists the current edition and, near a changeover,
    the next one too; a chart file for a cycle that has not started is
    not there to download yet."""
    dates = set()
    for text in _CYCLE_RE.findall(html):
        try:
            dates.add(datetime.strptime(text, "%m-%d-%Y").date())
        except ValueError:
            continue
    live = sorted(d for d in dates if d <= today)
    return live[-1].strftime("%m-%d-%Y") if live else None


def current_cycle(today: date | None = None, fetch: bool = True) -> str:
    """The cycle whose charts are downloaded and drawn. From the FAA's
    products page when it answers (held for six hours -- the answer
    changes every 56 days), else the anchor arithmetic. `fetch=False`
    never touches the network: the status endpoint's own choice."""
    today = today or datetime.now(tz=timezone.utc).date()
    with _cycle_lock:
        if _cycle_cache["value"] and time.time() - _cycle_cache["at"] < _CYCLE_TTL_S:
            return _cycle_cache["value"]
    if not fetch:
        return _cycle_cache["value"] or cycle_from_anchor(today)
    value = None
    try:
        resp = requests.get(FAA_VFR_PRODUCTS_PAGE, headers=REQUEST_HEADERS, timeout=15)
        if resp.ok:
            value = cycle_from_products_page(resp.text, today)
    except requests.RequestException:
        log.info("FAA VFR products page unreachable; using the cycle arithmetic")
    value = value or cycle_from_anchor(today)
    with _cycle_lock:
        _cycle_cache.update(value=value, at=time.time())
    return value


# ---------------------------------------------------------------------------
# Tile geometry
# ---------------------------------------------------------------------------

def tile_bbox_3857(x: int, y: int, zoom: int) -> tuple:
    """The (xmin, ymin, xmax, ymax) of one standard tile, in EPSG:3857
    metres."""
    resolution = 2 * _MERCATOR_ORIGIN_M / (2 ** zoom)
    xmin = -_MERCATOR_ORIGIN_M + x * resolution
    ymax = _MERCATOR_ORIGIN_M - y * resolution
    return xmin, ymax - resolution, xmin + resolution, ymax


def tile_bbox_wgs84(x: int, y: int, zoom: int) -> Box:
    """The same tile as (west, south, east, north) degrees."""
    n = 2 ** zoom
    west, east = x / n * 360.0 - 180.0, (x + 1) / n * 360.0 - 180.0

    def lat(row: int) -> float:
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * row / n))))

    return west, lat(y + 1), east, lat(y)


def _intersects(a: Box, b: Box) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


# ---------------------------------------------------------------------------
# Charts on disk
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Raster:
    path: Path
    face: Box       # what the renderer draws: the chart, neatline inward
    envelope: Box   # the whole raster, collar included


@dataclass(frozen=True)
class Chart:
    kind: ChartKind
    name: str
    cycle: str
    rasters: tuple[Raster, ...]
    prepared_at: str


_READY = "ready.json"
_FAIL_TTL_S = 600
_locks: dict = {}
_locks_guard = threading.Lock()
_failed: dict[tuple, float] = {}


def _chart_dir(cycle: str, kind: ChartKind, name: str) -> Path:
    return CHARTS_DIR / cycle / kind.key / name


def _lock_for(key: tuple) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(key, threading.Lock())


def _load_ready(directory: Path, kind: ChartKind, name: str, cycle: str) -> Chart | None:
    try:
        data = json.loads((directory / _READY).read_text())
    except (OSError, ValueError):
        return None
    rasters = tuple(
        Raster(path=directory / r["file"], face=tuple(r["face"]), envelope=tuple(r["envelope"]))
        for r in data.get("rasters", [])
    )
    if not rasters or not all(r.path.exists() for r in rasters):
        return None
    return Chart(kind=kind, name=name, cycle=cycle, rasters=rasters, prepared_at=data.get("prepared_at", ""))


def _write_ready(directory: Path, chart: Chart) -> None:
    data = {
        "name": chart.name, "kind": chart.kind.key, "cycle": chart.cycle, "prepared_at": chart.prepared_at,
        "rasters": [{"file": r.path.name, "face": list(r.face), "envelope": list(r.envelope)} for r in chart.rasters],
    }
    tmp = directory / f"{_READY}.part"
    tmp.write_text(json.dumps(data, indent=1))
    tmp.replace(directory / _READY)


def _latest_on_disk(kind: ChartKind, name: str) -> Chart | None:
    """The newest prepared edition of a chart, from any cycle -- what
    is served while a newer edition cannot be downloaded."""
    if not CHARTS_DIR.exists():
        return None
    cycles = []
    for directory in CHARTS_DIR.iterdir():
        try:
            cycles.append((datetime.strptime(directory.name, "%m-%d-%Y"), directory.name))
        except ValueError:
            continue
    for _, cycle in sorted(cycles, reverse=True):
        chart = _load_ready(_chart_dir(cycle, kind, name), kind, name, cycle)
        if chart is not None:
            return chart
    return None


def ensure_chart(kind: ChartKind, name: str, cycle: str | None = None) -> Chart | None:
    """The chart, downloaded and prepared if it is not already -- once
    per cycle, whatever the number of tiles asking. None when it cannot
    be had at all (the FAA's server down and no earlier edition on
    disk); a failed download is not retried for ten minutes, so a map
    full of tiles does not turn one outage into a request storm."""
    if name not in COVERAGE[kind.key]:
        raise ValueError(f"no such {kind.key} chart: {name}")
    cycle = cycle or current_cycle()
    with _lock_for((kind.key, name)):
        chart = _load_ready(_chart_dir(cycle, kind, name), kind, name, cycle)
        if chart is not None:
            return chart
        failed_at = _failed.get((kind.key, name))
        if failed_at and time.time() - failed_at < _FAIL_TTL_S:
            return _latest_on_disk(kind, name)
        try:
            chart = _download_and_prepare(kind, name, cycle)
        except (requests.RequestException, OSError, zipfile.BadZipFile, RuntimeError) as err:
            log.warning("chart %s/%s (%s) unavailable: %s", kind.key, name, cycle, err)
            _failed[(kind.key, name)] = time.time()
            return _latest_on_disk(kind, name)
        _failed.pop((kind.key, name), None)
        return chart


def _download_and_prepare(kind: ChartKind, name: str, cycle: str) -> Chart:
    directory = _chart_dir(cycle, kind, name)
    directory.mkdir(parents=True, exist_ok=True)
    url = FAA_CHART_ZIP_URL.format(cycle=cycle, folder=kind.folder, name=f"{name}{kind.zip_suffix}")
    archive = directory / "chart.zip.part"
    started = time.time()
    with requests.get(url, headers=REQUEST_HEADERS, timeout=600, stream=True) as resp:
        if resp.status_code != 200:
            raise RuntimeError(f"HTTP {resp.status_code} for {url}")
        with archive.open("wb") as out:
            for chunk in resp.iter_content(1 << 20):
                out.write(chunk)
    log.info("downloaded %s (%d MB) in %.0f s", url, archive.stat().st_size >> 20, time.time() - started)

    paths = []
    with zipfile.ZipFile(archive) as z:
        for member in z.namelist():
            if not member.endswith(kind.raster_suffix):
                continue
            target = directory / Path(member).name
            with z.open(member) as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst)
            paths.append(target)
    archive.unlink()
    if not paths:
        raise RuntimeError(f"no '{kind.raster_suffix}' member in {url}")

    rasters = []
    for path in paths:
        started = time.time()
        build_overviews(path)
        envelope, face = detect_face(path, kind)
        rasters.append(Raster(path=path, face=face, envelope=envelope))
        log.info("prepared %s in %.0f s: face %s within %s", path.name, time.time() - started,
                 tuple(round(v, 3) for v in face), tuple(round(v, 3) for v in envelope))
    chart = Chart(kind=kind, name=name, cycle=cycle, rasters=tuple(rasters),
                  prepared_at=datetime.now(tz=timezone.utc).isoformat())
    _write_ready(directory, chart)
    return chart


_OVERVIEW_LEVELS = [2, 4, 8, 16, 32, 64]


def build_overviews(path: Path) -> None:
    """Reduced-resolution copies inside the TIFF, so a zoom-8 tile
    (a tenth of the chart's resolution) reads a tenth of the pixels,
    and a zoom-5 one a hundredth. Nearest-neighbour because the band
    is a palette: averaging colour indices would mean nothing."""
    import rasterio
    from rasterio.enums import Resampling

    with rasterio.open(path, "r+") as ds:
        if len(ds.overviews(1)) < len(_OVERVIEW_LEVELS):
            ds.build_overviews(_OVERVIEW_LEVELS, Resampling.nearest)
            ds.update_tags(ns="rio_overview", resampling="nearest")


# ---------------------------------------------------------------------------
# Finding the chart face
# ---------------------------------------------------------------------------

# The raster's palette, reduced to the three things the search needs to
# know about a pixel: is it ink, is it paper, or is it neither -- the
# tints the chart face is coloured with (terrain, water, towns,
# airspace) and the collar, being paper and print, mostly is not.
_DARK_MAX_RGB_SUM = 160
_WHITE_MIN_CHANNEL = 240
# Darkness is pooled over blocks this size (any dark pixel makes the
# block dark) so that a two-pixel line is hit by a sample that lands
# within the block, and the search can step at a fraction of it.
_POOL_PX = 4
_SAMPLES_ALONG = 600
# A line is the neatline when this much of it is ink along the middle
# three-fifths of the chart (labels, airways and the scale bars crossing
# it break the rest) ...
_MIN_CONTINUITY = 0.55
# ... and the strip this far outside it is the collar rather than more
# chart: mostly paper, or paper with print on it. The band just outside
# the neatline carries the minute ticks and their labels, so the strip
# starts beyond them.
_OUTSIDE_STRIP_PX = (140, 350)
_MIN_OUTSIDE_WHITE = 0.6
_MAX_OUTSIDE_TINT = 0.15
# Where there is no neatline (the chart runs on past its nominal edge
# and is cut by the sheet's edge, or by the boxes printed above it), the
# face ends where the tint does: sampled this often, and pulled this
# far inside the first tinted line, because a row of boxes ends on a
# straight raster row that a curved parallel crosses gradually.
_CONTENT_STEP_PX = 20
_CONTENT_MIN_TINT = 0.5
_CONTENT_MARGIN_PX = 100
# Sectional sheets end on whole and quarter degrees; a measured edge
# that close to one is that one.
_SNAP_GRID_DEG = 0.25
_SNAP_TOLERANCE_DEG = 0.012


@dataclass
class _Ink:
    crs: object
    transform: object
    dark: np.ndarray    # pooled: any ink in the block
    white: np.ndarray   # pooled: fraction of paper in the block
    tint: np.ndarray    # pooled: fraction of neither


def _palette(src) -> np.ndarray:
    """The colormap as a (256, 3) RGB lookup."""
    cmap = src.colormap(1)
    return np.array([cmap.get(i, (0, 0, 0, 255))[:3] for i in range(256)], dtype=np.uint8)


def _ink_maps(src) -> _Ink:
    lut = _palette(src).astype(np.int16)
    dark_lut = lut.sum(axis=1) < _DARK_MAX_RGB_SUM
    white_lut = lut.min(axis=1) >= _WHITE_MIN_CHANNEL
    tint_lut = ~dark_lut & ~white_lut
    pool = _POOL_PX
    rows, cols = src.height // pool, src.width // pool
    dark = np.zeros((rows, cols), dtype=bool)
    white = np.zeros((rows, cols), dtype=np.float32)
    tint = np.zeros((rows, cols), dtype=np.float32)
    step = 1024
    for r0 in range(0, rows * pool, step):
        r1 = min(r0 + step, rows * pool)
        block = src.read(1, window=((r0, r1), (0, cols * pool)))
        shape = ((r1 - r0) // pool, pool, cols, pool)
        dark[r0 // pool:r1 // pool] = dark_lut[block].reshape(shape).any(axis=(1, 3))
        white[r0 // pool:r1 // pool] = white_lut[block].reshape(shape).mean(axis=(1, 3))
        tint[r0 // pool:r1 // pool] = tint_lut[block].reshape(shape).mean(axis=(1, 3))
    return _Ink(crs=src.crs, transform=src.transform, dark=dark, white=white, tint=tint)


def _sample(ink: _Ink, lats: np.ndarray, lons: np.ndarray) -> tuple:
    """(dark, white, tint, inside) at each (lat, lon): outside the
    raster counts as paper."""
    import rasterio.transform
    import rasterio.warp

    xs, ys = rasterio.warp.transform("EPSG:4326", ink.crs, lons.tolist(), lats.tolist())
    rows, cols = rasterio.transform.rowcol(ink.transform, xs, ys)
    rows, cols = np.asarray(rows) // _POOL_PX, np.asarray(cols) // _POOL_PX
    inside = (rows >= 0) & (rows < ink.dark.shape[0]) & (cols >= 0) & (cols < ink.dark.shape[1])
    dark = np.zeros(len(lats), dtype=bool)
    white = np.ones(len(lats), dtype=np.float32)
    tint = np.zeros(len(lats), dtype=np.float32)
    dark[inside] = ink.dark[rows[inside], cols[inside]]
    white[inside] = ink.white[rows[inside], cols[inside]]
    tint[inside] = ink.tint[rows[inside], cols[inside]]
    return dark, white, tint, inside


def _find_edge(ink: _Ink, envelope: Box, res_m: float, edge: str) -> tuple:
    """Where the chart face ends along one edge: (position in degrees,
    how it was found), the position None when nothing chart-like lies
    within a quarter of the raster of that edge.

    Walks inward from the raster's edge, sampling each candidate line
    along the chart's middle three-fifths -- along the geographic
    parallel or meridian, not the raster row or column. That is what
    tells the neatline from the collar's own ruling: the chart is a
    conic projection, so its parallels curve across the sheet and its
    meridians lean, and a communication box's straight edge parts
    company with the parallel through it within a few kilometres.
    Interior graticule lines are just as continuous as the neatline and
    are told apart by what lies outside them: more chart, not paper.

    Not every edge has a neatline. A sheet overlaps its neighbour on two
    sides, and there the chart runs on past its nominal edge until the
    sheet's own edge, or the row of boxes printed above it, cuts it
    off; on those edges the face ends where the tint does.
    """
    west, south, east, north = envelope
    horizontal = edge in ("s", "n")
    if horizontal:
        along = np.linspace(west + 0.2 * (east - west), east - 0.2 * (east - west), _SAMPLES_ALONG)
        deg_per_px = res_m / _METRES_PER_DEGREE
        start, inward, depth = (south, 1.0, 0.25 * (north - south)) if edge == "s" else (north, -1.0, 0.25 * (north - south))
    else:
        along = np.linspace(south + 0.2 * (north - south), north - 0.2 * (north - south), _SAMPLES_ALONG)
        deg_per_px = res_m / (_METRES_PER_DEGREE * math.cos(math.radians((south + north) / 2)))
        start, inward, depth = (west, 1.0, 0.25 * (east - west)) if edge == "w" else (east, -1.0, 0.25 * (east - west))

    def sample_lines(at: np.ndarray) -> tuple:
        across = np.repeat(at, len(along))
        with_along = np.tile(along, len(at))
        lats, lons = (across, with_along) if horizontal else (with_along, across)
        dark, white, tint, inside = _sample(ink, lats, lons)
        shape = (len(at), len(along))
        return tuple(v.reshape(shape).mean(axis=1) for v in (dark, white, tint, inside))

    positions = start + inward * np.arange(0.0, depth, 1.5 * deg_per_px)
    continuity, _, _, covered = sample_lines(positions)
    candidates = np.flatnonzero((continuity >= _MIN_CONTINUITY) & (covered > 0.9))
    if candidates.size:
        # A two-pixel line answers at two or three consecutive steps:
        # one cluster, its best step.
        clusters, current = [], [candidates[0]]
        for i in candidates[1:]:
            if i - current[-1] <= 2:
                current.append(i)
            else:
                clusters.append(current)
                current = [i]
        clusters.append(current)
        for cluster in clusters:
            best = max(cluster, key=lambda i: continuity[i])
            line = positions[best]
            strip = line - inward * np.linspace(_OUTSIDE_STRIP_PX[0], _OUTSIDE_STRIP_PX[1], 6) * deg_per_px
            _, white, tint, _ = sample_lines(strip)
            if white.mean() >= _MIN_OUTSIDE_WHITE or tint.mean() <= _MAX_OUTSIDE_TINT:
                return float(line), "neatline"

    # From just inside the sheet's edge (the edge itself samples as
    # outside the raster) inward.
    coarse = start + inward * (_POOL_PX * deg_per_px + np.arange(0.0, depth, _CONTENT_STEP_PX * deg_per_px))
    _, _, tint, _ = sample_lines(coarse)
    tinted = np.flatnonzero(tint >= _CONTENT_MIN_TINT)
    if tinted.size == 0:
        return None, "none"
    first = int(tinted[0])
    if first == 0:
        return float(start), "sheet edge"
    return float(coarse[first] + inward * _CONTENT_MARGIN_PX * deg_per_px), "content"


def _snap(value: float) -> float:
    nearest = round(value / _SNAP_GRID_DEG) * _SNAP_GRID_DEG
    return nearest if abs(nearest - value) <= _SNAP_TOLERANCE_DEG else value


def detect_face(path: Path, kind: ChartKind) -> tuple[Box, Box]:
    """(envelope, face) of a chart raster, both (west, south, east,
    north) degrees: the raster's own bounds, and the chart within them
    with the collar cut away. An edge that yields nothing falls back to
    the kind's typical collar width, and says so in the log."""
    import rasterio
    import rasterio.warp

    with rasterio.open(path) as src:
        ink = _ink_maps(src)
        envelope = tuple(float(v) for v in rasterio.warp.transform_bounds(src.crs, "EPSG:4326", *src.bounds))
        res_m = float(src.res[0])

    west, south, east, north = envelope
    collar = kind.fallback_collar
    fallback = {"w": west + collar[0], "s": south + collar[1], "e": east - collar[2], "n": north - collar[3]}
    face = []
    for i, edge in enumerate("wsen"):
        position, how = _find_edge(ink, envelope, res_m, edge)
        if position is None:
            log.warning("%s: nothing chart-like near the %s edge; assuming a %.2f-degree collar",
                        path.name, edge, collar[i])
            face.append(fallback[edge])
            continue
        if how == "neatline" and kind is SECTIONAL:
            position = _snap(position)
        log.info("%s: %s edge at %.4f (%s)", path.name, edge, position, how)
        face.append(position)
    return envelope, tuple(face)


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def _warp_rgb(path: Path, bbox_3857: tuple, width: int, height: int, centre_lat: float) -> np.ndarray:
    """Part of a raster, reprojected to web mercator, as (height,
    width, 3) RGB -- one tile, or a whole row of them at once.

    The chart is a palette image, so it is warped as indices
    (nearest-neighbour -- an averaged index is a random colour) and
    coloured afterwards. At zooms coarser than the chart's own
    resolution that alone drops thin lines; so the warp is read at up
    to four times the requested size and box-filtered down in RGB,
    which is the averaging a palette cannot have."""
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.transform import from_bounds
    from rasterio.vrt import WarpedVRT

    xmin, ymin, xmax, ymax = bbox_3857
    with rasterio.open(path) as src:
        lut = _palette(src)
        ground_m_per_px = (xmax - xmin) / width * math.cos(math.radians(centre_lat))
        oversample = int(min(4, max(1, round(ground_m_per_px / float(src.res[0])))))
        w, h = width * oversample, height * oversample
        with WarpedVRT(
            src, crs="EPSG:3857", transform=from_bounds(xmin, ymin, xmax, ymax, w, h),
            width=w, height=h, resampling=Resampling.nearest, nodata=0,
        ) as vrt:
            indices = vrt.read(1)
    rgb = lut[indices]
    if oversample > 1:
        rgb = np.asarray(Image.fromarray(rgb).reduce(oversample))
    return rgb


def _tile_lats(y: int, zoom: int) -> np.ndarray:
    """The latitude at the centre of each pixel row of tile row `y`."""
    _, ymin, _, ymax = tile_bbox_3857(0, y, zoom)
    ys = ymax - (np.arange(TILE_PX) + 0.5) / TILE_PX * (ymax - ymin)
    return np.degrees(2 * np.arctan(np.exp(ys / _EARTH_RADIUS_M)) - np.pi / 2)


def _tile_lons(x: int, zoom: int) -> np.ndarray:
    """The longitude at the centre of each pixel column of tile column `x`."""
    xmin, _, xmax, _ = tile_bbox_3857(x, 0, zoom)
    return (xmin + (np.arange(TILE_PX) + 0.5) / TILE_PX * (xmax - xmin)) / _MERCATOR_ORIGIN_M * 180.0


def _face_mask(face: Box, lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    west, south, east, north = face
    return ((lats >= south) & (lats <= north))[:, None] & ((lons >= west) & (lons <= east))[None, :]


def render_tile(rasters: list, x: int, y: int, zoom: int) -> np.ndarray | None:
    """The tile as (TILE_PX, TILE_PX, 4) RGBA, composited from every
    raster whose face covers part of it -- first raster wins where
    faces overlap -- and transparent where none does. None when the
    whole tile is uncovered."""
    bbox = tile_bbox_3857(x, y, zoom)
    lats, lons = _tile_lats(y, zoom), _tile_lons(x, zoom)
    out = np.zeros((TILE_PX, TILE_PX, 4), dtype=np.uint8)
    for raster in rasters:
        covered = _face_mask(raster.face, lats, lons) & (out[:, :, 3] == 0)
        if not covered.any():
            continue
        rgb = _warp_rgb(raster.path, bbox, TILE_PX, TILE_PX, float(lats[TILE_PX // 2]))
        out[covered, :3] = rgb[covered]
        out[covered, 3] = 255
    return out if out[:, :, 3].any() else None


def encode_png(rgba: np.ndarray) -> bytes:
    """The tile as an 8-bit palette PNG: a third the bytes of the RGBA
    encoding (15 KB against 43 for a busy urban tile) at a third the
    time, and exact -- at the chart's own zoom the pixels are the
    sheet's palette to begin with, so the quantiser has nothing to
    approximate. The octree quantiser is the one that keeps alpha."""
    image = Image.fromarray(rgba, "RGBA").quantize(256, method=Image.Quantize.FASTOCTREE)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _decode_rgba(png: bytes) -> np.ndarray:
    return np.array(Image.open(io.BytesIO(png)).convert("RGBA"))  # a copy: the caller writes into it


# ---------------------------------------------------------------------------
# The tile cache, and what the rest of the app calls
# ---------------------------------------------------------------------------

_NONE_TTL_S = 3600


def _tile_path(kind: ChartKind, cycle: str, x: int, y: int, zoom: int) -> Path:
    return CHART_TILE_CACHE_DIR / cycle / kind.key / str(zoom) / str(x) / f"{y}.png"


def rasters_covering(kind: ChartKind, bbox: Box, cycle: str | None = None) -> tuple[list, bool]:
    """Every prepared raster of `kind` whose face touches `bbox`, and
    whether that is all of them -- False when a chart that should be
    there could not be downloaded, so a tile rendered without it is
    not cached as if it were complete."""
    cycle = cycle or current_cycle()
    rasters, complete = [], True
    for name, envelope in COVERAGE[kind.key].items():
        if not _intersects(envelope, bbox):
            continue
        chart = ensure_chart(kind, name, cycle)
        if chart is None:
            complete = False
            continue
        rasters.extend(r for r in chart.rasters if _intersects(r.face, bbox))
    return rasters, complete


def tile_png(x: int, y: int, zoom: int, kind: str = "sec") -> bytes | None:
    """The tile's PNG bytes, rendered on first request and cached on
    disk for the cycle; None where no chart of this kind covers it (a
    404 for the map's tile layer to leave blank)."""
    chart_kind = KINDS[kind]
    if not (chart_kind.min_zoom <= zoom <= chart_kind.max_zoom):
        return None
    cycle = current_cycle()
    path = _tile_path(chart_kind, cycle, x, y, zoom)
    none_marker = path.with_suffix(".none")
    try:
        if path.exists():
            return path.read_bytes()
        if none_marker.exists() and time.time() - none_marker.stat().st_mtime < _NONE_TTL_S:
            return None
    except OSError:
        pass

    rasters, complete = rasters_covering(chart_kind, tile_bbox_wgs84(x, y, zoom), cycle)
    rgba = render_tile(rasters, x, y, zoom) if rasters else None
    path.parent.mkdir(parents=True, exist_ok=True)
    if rgba is None:
        if complete:
            none_marker.touch()
        return None
    data = encode_png(rgba)
    if complete:
        _write_atomically(path, data)
        none_marker.unlink(missing_ok=True)
    return data


def _write_atomically(path: Path, data: bytes) -> None:
    tmp = path.with_name(f"{path.name}.{os.getpid()}.part")
    tmp.write_bytes(data)
    tmp.replace(path)  # so a killed process cannot leave a torn cache entry


def tile_image(x: int, y: int, zoom: int, kind: str = "sec") -> Image.Image | None:
    """The tile as an RGB image with the uncovered parts white -- what
    the chart reader (vfr.chartvision) wants: paper, not the black its
    road-and-rail class looks for."""
    png = tile_png(x, y, zoom, kind)
    if png is None:
        return None
    rgba = Image.open(io.BytesIO(png)).convert("RGBA")
    paper = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    return Image.alpha_composite(paper, rgba).convert("RGB")


def tile_cached(x: int, y: int, zoom: int, kind: str = "sec") -> bool:
    return _tile_path(KINDS[kind], current_cycle(fetch=False), x, y, zoom).exists()


def prepare_for_bbox(bbox: Box, kinds: tuple = ("sec", "tac")) -> list:
    """Download and prepare every chart of the given kinds whose raster
    touches `bbox` -- the corridor read and the warm-up call this so a
    route's charts are ready before its tiles are asked for."""
    charts = []
    for key in kinds:
        kind = KINDS[key]
        for name, envelope in COVERAGE[key].items():
            if _intersects(envelope, bbox):
                chart = ensure_chart(kind, name)
                if chart is not None:
                    charts.append(chart)
    return charts


def prepared_charts() -> list[Chart]:
    """Every chart prepared on disk, any cycle, newest cycle first."""
    charts = []
    if not CHARTS_DIR.exists():
        return charts
    for ready in sorted(CHARTS_DIR.glob(f"*/*/*/{_READY}"), reverse=True):
        directory = ready.parent
        kind = KINDS.get(directory.parent.name)
        if kind is None:
            continue
        chart = _load_ready(directory, kind, directory.name, directory.parent.parent.name)
        if chart is not None:
            charts.append(chart)
    return charts


def status() -> dict:
    """What the Dev console shows: the cycle in use, the charts prepared
    (any cycle), how many tiles have been rendered, and how far a
    pyramid render has got. Never touches the network."""
    charts = [
        {
            "name": c.name, "kind": c.kind.key, "cycle": c.cycle, "prepared_at": c.prepared_at,
            "rasters": [r.path.stem for r in c.rasters],
        }
        for c in prepared_charts()
    ]
    tiles = sum(1 for _ in CHART_TILE_CACHE_DIR.rglob("*.png")) if CHART_TILE_CACHE_DIR.exists() else 0
    return {"cycle": current_cycle(fetch=False), "charts": charts, "tiles_cached": tiles, "pyramid": pyramid_status()}


# ---------------------------------------------------------------------------
# The whole country, ahead of time
# ---------------------------------------------------------------------------
#
# Rendering on first request is fine for a corridor; it is not what a
# map that has no street layer under it wants. A sheet that is not on
# disk costs the first pilot to look at it half a minute, and every
# cold tile a quarter of a second -- the open-warp-encode of one tile
# is mostly fixed overhead (opening the raster and setting up the
# reprojection, ~70 ms of ~90), so a row of tiles warped in one go is
# twenty times cheaper per tile. `prepare_all` fetches every sheet;
# `render_pyramid` walks each sheet's face a tile row at a time and
# writes the same files `tile_png` would, so nothing changes for the
# tile endpoint except that it stops rendering.

_PYRAMID_STATUS = "pyramid.json"


def prepare_all(kinds: tuple = ("sec", "tac"), cycle: str | None = None) -> list[Chart]:
    """Every chart of the given kinds, downloaded and prepared: about
    5 GB for the country, twenty-odd seconds of overviews and neatline
    search per sheet on top of the download."""
    cycle = cycle or current_cycle()
    charts = []
    for key in kinds:
        kind = KINDS[key]
        names = list(COVERAGE[key])
        for i, name in enumerate(names, 1):
            started = time.time()
            chart = ensure_chart(kind, name, cycle)
            if chart is None:
                log.warning("%s/%s: could not be prepared", key, name)
                continue
            charts.append(chart)
            log.info("%s/%s ready (%d of %d, %.0f s)", key, name, i, len(names), time.time() - started)
    return charts


def _tile_range(face: Box, zoom: int) -> tuple:
    """(x0, x1, y0, y1), inclusive, of the tiles a face touches."""
    n = 2 ** zoom
    west, south, east, north = face

    def row(lat: float) -> int:
        lat = max(-85.05, min(85.05, lat))
        return int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)

    x0, x1 = int((west + 180) / 360 * n), int((east + 180) / 360 * n)
    return max(0, x0), min(n - 1, x1), max(0, row(north)), min(n - 1, row(south))


def _render_row(args: tuple) -> int:
    """One tile row of one raster at one zoom: warped in a single
    strip, cut into tiles, each clipped to the face, composited over
    whatever another sheet already left on disk, and written. Returns
    the number of tiles written. A top-level function because it runs
    in a worker process."""
    path, face, kind_key, cycle, zoom, y, x0, x1 = args
    kind = KINDS[kind_key]
    lats = _tile_lats(y, zoom)
    xmin = tile_bbox_3857(x0, y, zoom)[0]
    _, ymin, xmax, ymax = tile_bbox_3857(x1, y, zoom)
    width = (x1 - x0 + 1) * TILE_PX
    strip = _warp_rgb(Path(path), (xmin, ymin, xmax, ymax), width, TILE_PX, float(lats[TILE_PX // 2]))

    written = 0
    for x in range(x0, x1 + 1):
        covered = _face_mask(face, lats, _tile_lons(x, zoom))
        if not covered.any():
            continue
        tile_path = _tile_path(kind, cycle, x, y, zoom)
        rgba = None
        if tile_path.exists():
            try:
                rgba = _decode_rgba(tile_path.read_bytes())
            except OSError:
                rgba = None
        if rgba is None:
            rgba = np.zeros((TILE_PX, TILE_PX, 4), dtype=np.uint8)
        fill = covered & (rgba[:, :, 3] == 0)
        if not fill.any():
            continue  # the neighbouring sheet already drew all of it
        rgb = strip[:, (x - x0) * TILE_PX:(x - x0 + 1) * TILE_PX]
        rgba[fill, :3] = rgb[fill]
        rgba[fill, 3] = 255
        tile_path.parent.mkdir(parents=True, exist_ok=True)
        _write_atomically(tile_path, encode_png(rgba))
        tile_path.with_suffix(".none").unlink(missing_ok=True)
        written += 1
    return written


def _write_pyramid_status(update: dict) -> None:
    CHART_TILE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CHART_TILE_CACHE_DIR / _PYRAMID_STATUS
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        data = {}
    data[update["kind"]] = update
    path.write_text(json.dumps(data, indent=1))


def pyramid_status() -> dict:
    """Per kind, how far the last pyramid render got -- what the Dev
    console shows next to the chart list."""
    try:
        return json.loads((CHART_TILE_CACHE_DIR / _PYRAMID_STATUS).read_text())
    except (OSError, ValueError):
        return {}


def render_pyramid(kind: ChartKind, zooms: tuple | None = None, workers: int = 4, charts: list | None = None) -> int:
    """Every tile of every prepared chart of `kind`, at each zoom of
    the kind's own range, written into the tile cache. Sheets are done
    one at a time -- their tile rows in parallel across `workers`
    processes -- so two sheets never race for the same seam tile.
    Returns the number of tiles written. Re-runnable: a tile already
    complete on disk is left alone, so an interrupted render resumes
    where it stopped (an already-rendered sheet costs a scan)."""
    zooms = tuple(zooms or range(kind.min_zoom, kind.max_zoom + 1))
    charts = [c for c in (charts if charts is not None else prepared_charts()) if c.kind is kind]
    rasters = [(chart, raster) for chart in charts for raster in chart.rasters]
    started = datetime.now(tz=timezone.utc).isoformat()
    total = 0
    progress = {
        "kind": kind.key, "zooms": list(zooms), "started_at": started, "finished_at": None,
        "rasters_total": len(rasters), "rasters_done": 0, "tiles_written": 0, "current": None,
    }
    _write_pyramid_status(progress)

    pool = ProcessPoolExecutor(max_workers=workers) if workers > 0 else None
    try:
        for i, (chart, raster) in enumerate(rasters):
            progress["current"] = raster.path.stem
            _write_pyramid_status(progress)
            sheet_started = time.time()
            sheet_tiles = 0
            for zoom in zooms:
                x0, x1, y0, y1 = _tile_range(raster.face, zoom)
                jobs = [(str(raster.path), raster.face, kind.key, chart.cycle, zoom, y, x0, x1) for y in range(y0, y1 + 1)]
                if pool is None:
                    sheet_tiles += sum(map(_render_row, jobs))
                else:
                    sheet_tiles += sum(pool.map(_render_row, jobs, chunksize=1))
            total += sheet_tiles
            progress.update(rasters_done=i + 1, tiles_written=total)
            _write_pyramid_status(progress)
            log.info("%s: %d tiles in %.0f s (%d of %d sheets, %d tiles so far)",
                     raster.path.stem, sheet_tiles, time.time() - sheet_started, i + 1, len(rasters), total)
    finally:
        if pool is not None:
            pool.shutdown()
    progress.update(current=None, finished_at=datetime.now(tz=timezone.utc).isoformat())
    _write_pyramid_status(progress)
    return total


def _main(argv: list | None = None) -> int:
    """`python -m vfr.charts prepare` fetches every sheet;
    `python -m vfr.charts pyramid` renders every tile. Both resume."""
    import argparse

    parser = argparse.ArgumentParser(description="FAA VFR charts: fetch every sheet, render every tile.")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("prepare", "pyramid"):
        p = sub.add_parser(name)
        p.add_argument("--kind", nargs="+", choices=list(KINDS), default=list(KINDS))
        if name == "pyramid":
            p.add_argument("--workers", type=int, default=4)
            p.add_argument("--zooms", help="e.g. 5-12; the kind's own range by default")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if args.command == "prepare":
        charts = prepare_all(tuple(args.kind))
        log.info("%d charts ready under %s", len(charts), CHARTS_DIR)
        return 0
    zooms = None
    if args.zooms:
        lo, _, hi = args.zooms.partition("-")
        zooms = tuple(range(int(lo), int(hi or lo) + 1))
    for key in args.kind:
        kind = KINDS[key]
        count = render_pyramid(kind, zooms=zooms and tuple(z for z in zooms if kind.min_zoom <= z <= kind.max_zoom), workers=args.workers)
        log.info("%s: %d tiles written under %s", key, count, CHART_TILE_CACHE_DIR)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
