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
  neighbour along every seam. `chart_faces.detect_face` finds the neatline (the
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

The whole-country pyramid, its revision and keeping up with the cycle
stay here rather than in a module of their own. They were measured for
a split on 2026-09-24, when every recent commit to this file had landed
in them: taking them out would take fourteen of the renderer's private
helpers along -- the warp, the composite and the tile paths among them,
since a pyramid row is warped and cut the way render_tile draws one
tile, only in bulk -- and the refresh machinery alone, which needs just
two, held none of those commits whole. They are the tile renderer's own
work. A split is worth another look when a change arrives here for a
reason other than rendering, serving or keeping up with the cycle.
"""
from __future__ import annotations

import contextlib
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
    CHART_TILES_BUCKET,
    CHART_TILES_PREFIX,
    CHART_TILES_URL,
    CHARTS_DIR,
    FAA_CHART_CYCLE_ANCHOR,
    FAA_CHART_CYCLE_DAYS,
    FAA_ENROUTE_ZIP_URL,
    FAA_VFR_PRODUCTS_PAGE,
    FAA_VISUAL_ZIP_URL,
    IFR_AREA_MAX_ZOOM,
    IFR_AREA_MIN_ZOOM,
    IFR_HIGH_MAX_ZOOM,
    IFR_HIGH_MIN_ZOOM,
    IFR_LOW_MAX_ZOOM,
    IFR_LOW_MIN_ZOOM,
    VFR_SECTIONAL_MAX_ZOOM,
    VFR_SECTIONAL_MIN_ZOOM,
    VFR_TAC_MAX_ZOOM,
    VFR_TAC_MIN_ZOOM,
)
from . import chart_faces

log = logging.getLogger(__name__)

TILE_PX = 256
REQUEST_HEADERS = {"User-Agent": "vfr-route-learning-project/0.1"}

# Web mercator's half-world extent in metres (EPSG:3857) -- the origin
# the standard {z}/{x}/{y} tile grid is laid out from -- and the sphere
# it is defined on.
_MERCATOR_ORIGIN_M = 20037508.342789244
_EARTH_RADIUS_M = 6378137.0

Box = tuple[float, float, float, float]  # (west, south, east, north), degrees


@dataclass(frozen=True)
class ChartKind:
    key: str                 # what the API and the tile cache call it
    label: str               # what the map's layer picker calls it
    zip_url: str             # the FAA's URL template for one chart's zip, with {cycle} and {name}
    raster_suffixes: tuple   # which members of the zip are the chart (a TAC zip also carries the flyway planning chart)
    min_zoom: int
    max_zoom: int
    # Typical collar widths (west, south, east, north) in degrees, for
    # a raster whose neatline could not be found: the sectional's west
    # collar is the legend column, its north one the communication
    # boxes; a TAC carries its legend down both sides.
    fallback_collar: Box
    # A base layer the map draws one of (sectional, IFR low, IFR high),
    # or an overlay drawn on top of a base: `over` names the base kinds
    # it belongs over (the TAC over the sectional, the IFR area charts
    # over the IFR enroute charts).
    base: bool = True
    over: tuple = ()
    # How the chart face is found in the raster. A VFR sheet's neatline
    # follows parallels and meridians, which curve and lean across the
    # sheet; an IFR enroute chart's border is the sheet's own rectangle,
    # straight rows and columns of pixels, with the legend panels'
    # table rules the only other straight lines on it.
    straight_border: bool = False
    # Whether the sheets carry masked lines -- the paper band a
    # sectional prints around a TAC's coverage and its own insets --
    # to be taken back out when a sheet is prepared (see
    # chart_faces.remove_masked_lines).
    masked_lines: bool = False


SECTIONAL = ChartKind(
    "sec", "Sectional", FAA_VISUAL_ZIP_URL.replace("{folder}", "sectional-files"), (" SEC.tif", " VFR Chart.tif"),
    VFR_SECTIONAL_MIN_ZOOM, VFR_SECTIONAL_MAX_ZOOM, (1.1, 0.2, 0.35, 0.55), masked_lines=True,
)
TAC = ChartKind(
    "tac", "Terminal area", FAA_VISUAL_ZIP_URL.replace("{folder}", "tac-files").replace("{name}", "{name}_TAC"),
    (" TAC.tif",), VFR_TAC_MIN_ZOOM, VFR_TAC_MAX_ZOOM, (0.35, 0.02, 0.35, 0.08), base=False, over=("sec",),
)
IFR_LOW = ChartKind(
    "ifr_low", "IFR low", FAA_ENROUTE_ZIP_URL, (".tif",), IFR_LOW_MIN_ZOOM, IFR_LOW_MAX_ZOOM, (0.3, 0.3, 0.3, 0.3),
    straight_border=True,
)
IFR_HIGH = ChartKind(
    "ifr_high", "IFR high", FAA_ENROUTE_ZIP_URL, (".tif",), IFR_HIGH_MIN_ZOOM, IFR_HIGH_MAX_ZOOM, (0.3, 0.3, 0.3, 0.3),
    straight_border=True,
)
# The IFR area charts: the enroute charts' own terminal-area sheets
# (Atlanta, Chicago, Denver ... fourteen of them, two zips), drawn over
# the IFR bases the way the TAC is drawn over the sectional. Not the
# Boston and Wilmington "insets" that ride in two of the low-altitude
# zips: those rasters are georeferenced as strips of their parent
# sheets, seven and ten degrees across, not as the excerpts they show.
IFR_AREA = ChartKind(
    "ifr_area", "IFR area", FAA_ENROUTE_ZIP_URL, (".tif",), IFR_AREA_MIN_ZOOM, IFR_AREA_MAX_ZOOM, (0.2, 0.2, 0.2, 0.2),
    base=False, over=("ifr_low", "ifr_high"), straight_border=True,
)
KINDS = {kind.key: kind for kind in (SECTIONAL, TAC, IFR_LOW, IFR_HIGH, IFR_AREA)}

# Sheets that come from another kind's zip, or a folder of their own:
# the two Caribbean VFR charts are sectional-scale sheets published
# under their own folder; the Honolulu inset is a terminal-area-scale
# sheet inside the Hawaiian Islands sectional zip.
_ZIP_URL_OVERRIDES = {
    ("sec", "Caribbean_1_VFR"): FAA_VISUAL_ZIP_URL.replace("{folder}", "Caribbean"),
    ("sec", "Caribbean_2_VFR"): FAA_VISUAL_ZIP_URL.replace("{folder}", "Caribbean"),
    ("tac", "Honolulu_Inset"): FAA_VISUAL_ZIP_URL.replace("{folder}", "sectional-files").replace("{name}", "Hawaiian_Islands"),
}
_MEMBER_OVERRIDES = {
    ("tac", "Honolulu_Inset"): ("Honolulu Inset SEC.tif",),
}


def zip_url(kind: ChartKind, name: str, cycle: str) -> str:
    return _ZIP_URL_OVERRIDES.get((kind.key, name), kind.zip_url).format(cycle=cycle, name=name)


def _is_chart_member(kind: ChartKind, name: str, member: str) -> bool:
    """Whether a zip member is a sheet of chart `name`. Insets are not
    part of the sheet they ride with -- larger-scale excerpts that
    would paint over it -- and are listed as sheets of their own
    (_MEMBER_OVERRIDES) under the overlay kinds instead."""
    wanted = _MEMBER_OVERRIDES.get((kind.key, name))
    if wanted is not None:
        return member in wanted
    upper = member.upper()
    if " INSET " in upper or "_INSET" in upper:
        return False
    return any(member.endswith(suffix) for suffix in kind.raster_suffixes)


def _boxes(entry) -> tuple:
    """A coverage entry as a tuple of boxes: one, or several for a
    chart that straddles the antimeridian."""
    return entry if isinstance(entry[0], tuple) else (entry,)


def _covers(entry, bbox: Box) -> bool:
    return any(_intersects(box, bbox) for box in _boxes(entry))


def sheets(kind: ChartKind) -> list[tuple[str, Box]]:
    """Every sheet of a kind as (name, box), a chart across the
    antimeridian counted once per side."""
    return [(name, box) for name, entry in COVERAGE[kind.key].items() for box in _boxes(entry)]


def sheet_label(kind: ChartKind, name: str) -> str:
    """What to call a sheet on screen: "Chicago TAC", "Dallas-Ft Worth
    TAC"; the IFR area charts, several sheets to a zip, go by the
    kind's own name."""
    if kind is TAC:
        return f"{name.replace('_', ' ')} TAC"
    return "IFR area chart" if kind is IFR_AREA else kind.label


# Every chart's raster envelope (west, south, east, north), collar
# included, keyed by the name the FAA's zip carries. Read from the FGDC
# .htm inside each zip of the 09-03-2026 cycle; the sheets do not move
# between editions. A TAC zip can hold more than one chart (Denver's
# also carries Colorado Springs, Seattle's carries Portland) -- listed
# as the union, since the zip is the unit of download. An entry is one
# box, or several for a chart that straddles the antimeridian.
COVERAGE: dict[str, dict] = {
    "sec": {
        "Anchorage": (-153.84, 59.43, -139.35, 64.29),
        "Bethel": (-174.88, 59.44, -160.30, 64.31),
        "Cape_Lisburne": (-175.38, 67.41, -154.93, 72.29),
        "Caribbean_1_VFR": (-86.97, 14.81, -71.71, 27.52),
        "Caribbean_2_VFR": (-74.85, 12.72, -60.23, 22.25),
        "Cold_Bay": (-165.36, 53.75, -154.08, 56.26),
        "Dawson": (-147.66, 63.43, -130.71, 68.30),
        "Dutch_Harbor": (-174.37, 51.44, -163.08, 56.25),
        "Fairbanks": (-160.71, 63.44, -143.70, 68.31),
        "Hawaiian_Islands": (-161.76, 17.71, -153.36, 24.02),
        "Juneau": (-142.36, 55.44, -129.70, 60.29),
        "Ketchikan": (-140.49, 51.47, -129.24, 56.25),
        "Kodiak": (-163.38, 55.47, -150.70, 60.28),
        "McGrath": (-164.22, 59.44, -149.89, 64.27),
        "Nome": (-173.61, 63.46, -156.64, 68.31),
        "Point_Barrow": (-159.62, 67.42, -139.13, 72.34),
        "Seward": (-154.17, 59.03, -139.95, 61.60),
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
        # Two sheets in one zip; the eastern one straddles the
        # antimeridian, hence the two boxes.
        "Western_Aleutian_Islands": ((168.17, 50.75, 180.0, 53.29), (-180.0, 50.75, -172.35, 53.29)),
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
        "Honolulu_Inset": (-158.51, 20.73, -157.35, 21.62),
        "Pittsburgh": (-81.38, 39.92, -78.96, 41.11),
        "Puerto_Rico-VI": (-67.81, 17.61, -64.22, 18.80),
        "Salt_Lake_City": (-113.32, 40.09, -110.64, 41.55),
        "San_Diego": (-119.04, 32.45, -116.27, 33.65),
        "San_Francisco": (-123.91, 36.86, -121.36, 38.26),
        "Seattle": (-123.70, 45.15, -121.04, 48.17),
        "St_Louis": (-91.46, 38.11, -89.21, 39.33),
    },
    "ifr_low": {
        "enr_l01": (-128.23, 41.30, -118.39, 50.14),
        "enr_l02": (-126.83, 35.77, -118.93, 44.32),
        "enr_l03": (-124.28, 31.69, -116.81, 40.79),
        "enr_l04": (-123.14, 30.45, -113.18, 36.81),
        "enr_l05": (-119.45, 29.09, -105.95, 36.55),
        "enr_l06": (-108.38, 28.21, -101.04, 35.11),
        "enr_l07": (-122.21, 32.74, -112.84, 37.35),
        "enr_l08": (-115.54, 33.20, -102.74, 38.05),
        "enr_l09": (-122.95, 34.35, -103.40, 42.92),
        "enr_l10": (-108.79, 36.73, -92.85, 41.51),
        "enr_l11": (-124.78, 36.82, -103.58, 46.80),
        "enr_l12": (-110.58, 39.68, -90.35, 46.02),
        "enr_l13": (-125.75, 40.83, -99.86, 51.86),
        "enr_l14": (-107.40, 43.70, -85.91, 49.60),
        "enr_l15": (-106.48, 34.52, -93.75, 38.42),
        "enr_l16": (-97.16, 34.61, -84.41, 38.42),
        "enr_l17": (-103.55, 31.63, -91.32, 35.29),
        "enr_l18": (-94.60, 31.26, -82.41, 35.29),
        "enr_l19": (-104.18, 28.46, -92.45, 32.16),
        "enr_l20": (-102.89, 25.47, -91.60, 29.05),
        "enr_l21": (-100.52, 22.33, -73.98, 31.80),
        "enr_l22": (-93.68, 28.08, -81.95, 32.15),
        "enr_l23": (-86.25, 23.41, -74.95, 28.18),
        "enr_l24": (-83.91, 25.67, -78.34, 36.02),
        "enr_l25": (-86.77, 33.84, -77.85, 37.13),
        "enr_l26": (-85.89, 36.00, -77.42, 39.27),
        "enr_l27": (-95.55, 37.56, -82.25, 41.56),
        "enr_l28": (-94.05, 40.50, -80.11, 44.68),
        "enr_l29": (-84.62, 37.89, -75.13, 41.36),
        "enr_l30": (-83.90, 39.97, -74.10, 43.51),
        "enr_l31": (-92.13, 41.53, -73.71, 48.60),
        "enr_l32": (-83.67, 37.96, -60.26, 51.22),
        "enr_l33": (-77.60, 38.51, -66.34, 45.31),
        "enr_l34": (-79.13, 36.18, -70.17, 44.49),
        "enr_l35": (-81.16, 31.71, -71.82, 39.71),
        "enr_l36": (-81.86, 32.85, -73.54, 41.04),
    },
    "ifr_high": {
        "enr_h01": (-135.13, 38.78, -103.00, 52.98),
        "enr_h02": (-110.96, 42.71, -80.58, 50.18),
        "enr_h03": (-132.60, 32.50, -103.43, 46.67),
        "enr_h04": (-128.51, 26.59, -101.86, 40.17),
        "enr_h05": (-109.43, 36.33, -81.97, 43.80),
        "enr_h06": (-108.59, 29.92, -83.54, 37.35),
        "enr_h07": (-107.59, 23.64, -84.57, 30.91),
        "enr_h08": (-92.40, 21.52, -68.94, 32.12),
        "enr_h09": (-90.50, 27.24, -65.01, 38.59),
        "enr_h10": (-89.84, 33.28, -61.99, 45.03),
        "enr_h11": (-89.84, 38.69, -59.58, 50.59),
        "enr_h12": (-87.96, 27.71, -67.52, 47.37),
    },
    "ifr_area": {
        # Each zip is several sheets; the box is their union, and the
        # sheets' own faces decide which draws where.
        "enr_a01": (-94.14, 25.20, -74.02, 45.53),
        "enr_a02": (-123.29, 31.40, -87.06, 43.40),
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
    # A small companion raster, 255 where the sheet is chart and 0
    # where it is collar, for a sheet whose chart area is a rectangle
    # of pixels rather than of latitude and longitude (the IFR enroute
    # charts): the face box then covers the whole leaning rectangle and
    # this cuts the collar out of its corners. None for a VFR sheet.
    mask: Path | None = None
    # The areas whose masked lines were taken out of this raster, () when
    # it had none, and None when it has not been looked at -- a sheet
    # prepared before chart_faces.remove_masked_lines existed, which the `unmask`
    # command then finds.
    masked_lines: tuple | None = None


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
        Raster(path=directory / r["file"], face=tuple(r["face"]), envelope=tuple(r["envelope"]),
               mask=directory / r["mask"] if r.get("mask") else None,
               masked_lines=None if r.get("masked_lines") is None else tuple(tuple(b) for b in r["masked_lines"]))
        for r in data.get("rasters", [])
    )
    if not rasters or not all(r.path.exists() for r in rasters):
        return None
    return Chart(kind=kind, name=name, cycle=cycle, rasters=rasters, prepared_at=data.get("prepared_at", ""))


def _write_ready(directory: Path, chart: Chart) -> None:
    data = {
        "name": chart.name, "kind": chart.kind.key, "cycle": chart.cycle, "prepared_at": chart.prepared_at,
        "rasters": [
            {"file": r.path.name, "face": list(r.face), "envelope": list(r.envelope),
             "mask": r.mask.name if r.mask else None,
             "masked_lines": None if r.masked_lines is None else [list(b) for b in r.masked_lines]}
            for r in chart.rasters
        ],
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
    directory = _chart_dir(cycle, kind, name)
    with _lock_for((kind.key, name)), _directory_lock(directory):
        chart = _load_ready(directory, kind, name, cycle)
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


@contextlib.contextmanager
def _directory_lock(directory: Path):
    """An exclusive lock on a chart's folder, held across processes:
    the serving planner's warm-up and a `prepare` run in another
    container can want the same sheet at the same moment, and two
    extractions plus two overview builds on one TIFF is a corrupt
    TIFF. The second one waits, then finds the sheet ready."""
    import fcntl

    directory.mkdir(parents=True, exist_ok=True)
    with (directory / ".lock").open("w") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def _download_and_prepare(kind: ChartKind, name: str, cycle: str) -> Chart:
    directory = _chart_dir(cycle, kind, name)
    directory.mkdir(parents=True, exist_ok=True)
    url = zip_url(kind, name, cycle)
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
            if not _is_chart_member(kind, name, member):
                continue
            target = directory / Path(member).name
            with z.open(member) as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst)
            paths.append(target)
    archive.unlink()
    if not paths:
        raise RuntimeError(f"no {kind.raster_suffixes} member in {url}")

    rasters = []
    for path in paths:
        started = time.time()
        build_overviews(path)
        envelope, face, mask = chart_faces.detect_face(path, kind)
        parts = chart_faces.split_antimeridian(face, envelope)
        removed = chart_faces.remove_masked_lines(path, [f for f, _ in parts]) if kind.masked_lines else None
        for part_face, part_envelope in parts:
            rasters.append(Raster(path=path, face=part_face, envelope=part_envelope, mask=mask, masked_lines=removed))
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




def _warp_rgb(path: Path, bbox_3857: tuple, width: int, height: int, centre_lat: float,
              mask: Path | None = None) -> tuple:
    """Part of a raster, reprojected to web mercator: (height, width,
    3) RGB and (height, width) float32 coverage, 0 to 1, of how much
    of each pixel the raster actually had (and, given a companion
    `mask` raster, how much is chart rather than collar) -- one tile,
    or a whole row of them at once. The RGB of a partly covered pixel
    is the average of its covered part alone.

    The chart is a palette image, so it is warped as indices
    (nearest-neighbour -- an averaged index is a random colour) and
    coloured afterwards. At zooms coarser than the chart's own
    resolution that alone drops thin lines; so the warp is read at up
    to four times the requested size and box-filtered down in RGB,
    which is the averaging a palette cannot have.

    The coverage matters at a sheet's own edge. A sheet is a rectangle
    in its conic projection, which in web mercator is a quadrilateral
    with leaning sides; its face is a lat/lon box, and where the box
    runs past the leaning edge the warp has nothing to put. Left as
    index 0 that is paper, and paper drawn over the neighbouring sheet
    showed on the map as a white sliver, widening down the seam. And
    it is a fraction rather than a yes or no because two sheets that
    meet inside one pixel each cover less than half of it: a yes-or-no
    at half left such a pixel to nobody, a hairline along the seam."""
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.transform import from_bounds
    from rasterio.vrt import WarpedVRT

    xmin, ymin, xmax, ymax = bbox_3857
    with rasterio.open(path) as src:
        ground_m_per_px = (xmax - xmin) / width * math.cos(math.radians(centre_lat))
        oversample = int(min(4, max(1, round(ground_m_per_px / float(src.res[0])))))
        w, h = width * oversample, height * oversample
        bands = src.count
        # No nodata value: with one, GDAL "protects" it by rewriting
        # every source pixel of that index to the next one, and index
        # 0 is the chart's paper. add_alpha gives the mask instead.
        grid = dict(crs="EPSG:3857", transform=from_bounds(xmin, ymin, xmax, ymax, w, h), width=w, height=h,
                    resampling=Resampling.nearest)
        with WarpedVRT(src, add_alpha=True, **grid) as vrt:
            rgb = chart_faces.read_rgb(vrt)
            alpha = vrt.read(bands + 1)
        if mask is not None:
            with rasterio.open(mask) as mask_src, WarpedVRT(mask_src, **grid) as vrt:
                alpha = np.minimum(alpha, vrt.read(1))
        inside = chart_faces.without_raster_rim(alpha >= 128, rgb, src, (xmin, ymin, xmax, ymax))
    if oversample == 1:
        return rgb, inside.astype(np.float32)
    # Box-filter the covered samples alone (the others zeroed, the
    # sum divided by the covered fraction), so that a pixel on the
    # sheet's edge is the colour of the chart in it, not of the chart
    # averaged with collar.
    weighted = np.where(inside[:, :, None], rgb, 0).astype(np.uint8)
    rgb = np.asarray(Image.fromarray(np.ascontiguousarray(weighted)).reduce(oversample)).astype(np.float32)
    coverage = np.asarray(Image.fromarray(inside.astype(np.uint8) * 255).reduce(oversample)).astype(np.float32) / 255.0
    scale = np.where(coverage > 0, 1.0 / np.maximum(coverage, 1e-6), 0.0)
    rgb = np.clip(rgb * scale[:, :, None] + 0.5, 0, 255).astype(np.uint8)
    return rgb, coverage


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


def _composite(rgba: np.ndarray, rgb: np.ndarray, coverage: np.ndarray) -> np.ndarray:
    """`rgba` with a sheet's `rgb` drawn into whatever part of each
    pixel is still uncovered, by the sheet's own `coverage` of it: a
    pixel a sheet covers wholly is drawn once and left alone after
    (the first sheet wins where two overlap); a pixel two sheets meet
    inside is the two averaged by their shares. The alpha kept is that
    total: opaque from half a pixel's worth up, so a seam inside a
    pixel is a seam and not a hairline of daylight, and the fraction
    itself below that, so the next sheet knows what is left."""
    old = rgba[:, :, 3].astype(np.float32) / 255.0
    weight = coverage * (1.0 - old)
    touched = weight > 0
    if not touched.any():
        return rgba
    total = old + weight
    colour = (rgba[:, :, :3].astype(np.float32) * old[:, :, None] + rgb.astype(np.float32) * weight[:, :, None])
    colour = colour / np.maximum(total, 1e-6)[:, :, None]
    rgba[touched, :3] = np.clip(colour[touched] + 0.5, 0, 255).astype(np.uint8)
    rgba[touched, 3] = np.where(total[touched] >= 0.5, 255, total[touched] * 255.0).astype(np.uint8)
    return rgba


def render_tile(rasters: list, x: int, y: int, zoom: int) -> np.ndarray | None:
    """The tile as (TILE_PX, TILE_PX, 4) RGBA, composited from every
    raster whose face covers part of it -- first raster wins where
    faces overlap -- and transparent where none does. None when the
    whole tile is uncovered."""
    bbox = tile_bbox_3857(x, y, zoom)
    lats, lons = _tile_lats(y, zoom), _tile_lons(x, zoom)
    out = np.zeros((TILE_PX, TILE_PX, 4), dtype=np.uint8)
    for raster in rasters:
        covered = _face_mask(raster.face, lats, lons) & (out[:, :, 3] < 255)
        if not covered.any():
            continue
        rgb, coverage = _warp_rgb(raster.path, bbox, TILE_PX, TILE_PX, float(lats[TILE_PX // 2]), raster.mask)
        out = _composite(out, rgb, coverage * covered)
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


def _encode_lossless(rgba: np.ndarray) -> bytes:
    """A tile still being drawn, kept exactly: encode_png's palette is
    for the finished tile, and quantising at every sheet drew the seams
    a little further off each pass."""
    buffer = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buffer, format="PNG")
    return buffer.getvalue()


# The pyramid render's own version. A pass records it when it finishes,
# and a later pass under a different one draws every tile again rather
# than keeping the ones on disk -- a change to how a tile is drawn (the
# sheet rims of 9ace720, say) used to reach only tiles not yet rendered.
# Records from before it was kept count as this version. Raise it with
# any change to what a rendered tile looks like.
RENDERER_VERSION = 1


# ---------------------------------------------------------------------------
# The tile cache, and what the rest of the app calls
# ---------------------------------------------------------------------------

_NONE_TTL_S = 3600


def _tile_path(kind: ChartKind, cycle: str, x: int, y: int, zoom: int) -> Path:
    return CHART_TILE_CACHE_DIR / cycle / kind.key / str(zoom) / str(x) / f"{y}.png"


def _draw_order(names) -> list:
    """The order sheets are drawn into a tile -- the first wins where two
    faces overlap -- which is reverse name order. Nothing makes one sheet
    better than another inside an overlap; what matters is that the
    pyramid and a tile rendered on demand agree. They did not: the
    pyramid drew sheets in `prepared_charts`' order (newest cycle first,
    and so names last first) and a tile rendered on demand in
    `COVERAGE`'s (names first first), so a tile rendered on demand drew
    the other sheet from its pyramid neighbours across the whole
    overlap, and showed it as a seam along its edge. Reverse name order
    is the one the pyramid on disk was rendered in, so it stays valid."""
    return sorted(names, reverse=True)


def rasters_covering(kind: ChartKind, bbox: Box, cycle: str | None = None) -> tuple[list, bool]:
    """Every prepared raster of `kind` whose face touches `bbox`, in
    `_draw_order`, and whether that is all of them -- False when a chart
    that should be there could not be downloaded, so a tile rendered
    without it is not cached as if it were complete."""
    cycle = cycle or current_cycle()
    rasters, complete = [], True
    for name in _draw_order(COVERAGE[kind.key]):
        envelope = COVERAGE[kind.key][name]
        if not _covers(envelope, bbox):
            continue
        chart = ensure_chart(kind, name, cycle)
        if chart is None:
            complete = False
            continue
        rasters.extend(r for r in chart.rasters if _intersects(r.face, bbox))
    return rasters, complete


def tile_png(x: int, y: int, zoom: int, kind: str = "sec") -> bytes | None:
    """The tile's PNG bytes -- from the pyramid when there is one, else
    rendered on first request and cached on disk for the cycle; None
    where no chart of this kind covers it (a 404 for the map's tile
    layer to leave blank)."""
    chart_kind = KINDS[kind]
    if not (chart_kind.min_zoom <= zoom <= chart_kind.max_zoom):
        return None
    cycle = serving_cycle()
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
    # Named for the thread as well as the process: two of the planner's
    # request threads rendering the same tile wrote one temp file, and
    # the second's rename could move the first's half-written bytes.
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.part")
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
    return _tile_path(KINDS[kind], serving_cycle(), x, y, zoom).exists()


def prepare_for_bbox(bbox: Box, kinds: tuple = tuple(KINDS)) -> list:
    """Download and prepare every chart of the given kinds whose raster
    touches `bbox` -- the corridor read and the warm-up call this so a
    route's charts are ready before its tiles are asked for."""
    charts = []
    for key in kinds:
        kind = KINDS[key]
        for name, envelope in COVERAGE[key].items():
            if _covers(envelope, bbox):
                chart = ensure_chart(kind, name)
                if chart is not None:
                    charts.append(chart)
    return charts


def prepared_charts(cycle: str | None = None) -> list[Chart]:
    """Every chart prepared on disk -- one cycle's, or any cycle's
    newest first."""
    charts = []
    if not CHARTS_DIR.exists():
        return charts
    for ready in sorted(CHARTS_DIR.glob(f"*/*/*/{_READY}"), reverse=True):
        directory = ready.parent
        kind = KINDS.get(directory.parent.name)
        if kind is None or (cycle and directory.parent.parent.name != cycle):
            continue
        chart = _load_ready(directory, kind, directory.name, directory.parent.parent.name)
        if chart is not None:
            charts.append(chart)
    return charts


def _cycles_on_disk(root: Path) -> list[str]:
    """The cycle-named folders under `root`, newest first."""
    if not root.exists():
        return []
    found = []
    for directory in root.iterdir():
        try:
            found.append((datetime.strptime(directory.name, "%m-%d-%Y"), directory.name))
        except ValueError:
            continue
    return [name for _, name in sorted(found, reverse=True)]


_serving_cache: dict = {"value": None, "at": 0.0}
_SERVING_TTL_S = 60


def serving_cycle() -> str:
    """The cycle the map draws: the newest on disk whose sectional
    pyramid is complete, so a new cycle is served only once every one
    of its tiles is there -- until then the map keeps the previous
    edition, whole, rather than rendering the new one a tile at a
    time. With no complete pyramid at all (a fresh checkout) it is the
    FAA's current cycle, rendered on demand. Where the tiles live in
    the cloud (CHART_TILES_URL) it is whatever the published pointer
    there says. Held for a minute: this is asked once per tile."""
    if _serving_cache["value"] and time.time() - _serving_cache["at"] < _SERVING_TTL_S:
        return _serving_cache["value"]
    value = _published_cycle() if CHART_TILES_URL else None
    value = value or next((c for c in _cycles_on_disk(CHART_TILE_CACHE_DIR) if pyramid_complete(c, ("sec",))), None)
    value = value or current_cycle()
    _serving_cache.update(value=value, at=time.time())
    return value


def _published_cycle() -> str | None:
    """The cycle the published pyramid's own pointer names, or None
    when it cannot be read (and the planner falls back to its disk)."""
    try:
        resp = requests.get(f"{CHART_TILES_URL}/serving.json", headers=REQUEST_HEADERS, timeout=5)
        return resp.json()["cycle"] if resp.ok else None
    except (requests.RequestException, ValueError, KeyError):
        return None


def tiles_base_url() -> str | None:
    """Where the browser should fetch tiles from instead of this
    planner, when the pyramid is published: the map appends
    /<cycle>/<kind>/{z}/{x}/{y}.png."""
    return CHART_TILES_URL


def status() -> dict:
    """What the Dev console shows: the cycle being served and the one
    the FAA is on, the charts prepared (any cycle), how many tiles have
    been rendered, how far the served cycle's pyramid got and whether
    a newer one is being built. Never touches the network."""
    charts = [
        {
            "name": c.name, "kind": c.kind.key, "cycle": c.cycle, "prepared_at": c.prepared_at,
            "rasters": [r.path.stem for r in c.rasters],
        }
        for c in prepared_charts()
    ]
    serving, current = serving_cycle(), current_cycle(fetch=False)

    def described(cycle: str) -> dict:
        return {key: {**record, "complete": pyramid_complete(cycle, (key,)), "missing": pyramid_missing(cycle, key)}
                for key, record in pyramid_status(cycle).items()}

    pyramid = described(serving)
    # What the pyramid wrote, not a walk of the cache: counting three
    # hundred thousand files on a bind mount took the status endpoint
    # (and the Dev console behind it) tens of seconds.
    tiles = sum(p["tiles"] for p in pyramid.values())
    building = described(current) if current != serving else {}
    return {
        "cycle": serving, "current_cycle": current, "charts": charts, "tiles_cached": tiles,
        "pyramid": pyramid, "building": building, "refresh_running": refresh_running(),
    }


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


def prepare_all(kinds: tuple = tuple(KINDS), cycle: str | None = None, redetect: bool = False) -> list[Chart]:
    """Every chart of the given kinds, downloaded and prepared: about
    7 GB for the country, twenty-odd seconds of overviews and neatline
    search per sheet on top of the download. `redetect` runs the face
    detection again on sheets already on disk (after a change to it)
    and rewrites what they say about themselves."""
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
            if redetect:
                chart = _redetect(chart)
            charts.append(chart)
            log.info("%s/%s ready (%d of %d, %.0f s)", key, name, i, len(names), time.time() - started)
    return charts


def _redetect(chart: Chart) -> Chart:
    directory = chart.rasters[0].path.parent
    removed = {r.path: r.masked_lines for r in chart.rasters}
    with _lock_for((chart.kind.key, chart.name)), _directory_lock(directory):
        rasters = []
        for path in sorted({r.path for r in chart.rasters}):
            envelope, face, mask = chart_faces.detect_face(path, chart.kind)
            for part_face, part_envelope in chart_faces.split_antimeridian(face, envelope):
                rasters.append(Raster(path=path, face=part_face, envelope=part_envelope, mask=mask,
                                      masked_lines=removed.get(path)))
        chart = Chart(kind=chart.kind, name=chart.name, cycle=chart.cycle, rasters=tuple(rasters),
                      prepared_at=datetime.now(tz=timezone.utc).isoformat())
        _write_ready(directory, chart)
    return chart


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
    whatever another sheet already drew there, and written. Returns
    the number of tiles written. A top-level function because it runs
    in a worker process.

    A tile the composite leaves unfinished -- a seam another sheet has
    yet to draw its side of, or the edge of the country -- goes to a
    `.partial` beside the served file, kept lossless, and becomes the
    tile only when finished or when the pass ends
    (_promote_partials). The served file used to be the blend buffer
    too: a half-drawn seam tile was served, and kept by browsers for
    weeks, while the pass went on. `since`, for a pass under a new
    renderer, is when it began: a tile on disk from before then is drawn
    again rather than kept."""
    path, face, kind_key, cycle, zoom, y, x0, x1, mask, since = args
    kind = KINDS[kind_key]
    lats = _tile_lats(y, zoom)

    def current(p: Path) -> bool:
        return p.exists() and (since is None or p.stat().st_mtime >= since)

    # What this row still owes, before the warp: on a resumed or
    # repeated render most rows owe nothing, and the warp is the cost.
    owed = []
    for x in range(x0, x1 + 1):
        covered = _face_mask(face, lats, _tile_lons(x, zoom))
        if not covered.any():
            continue
        tile_path = _tile_path(kind, cycle, x, y, zoom)
        partial = tile_path.with_suffix(".partial")
        source = partial if current(partial) else tile_path if current(tile_path) else None
        rgba = None
        if source is not None:
            try:
                rgba = _decode_rgba(source.read_bytes())
            except OSError:
                rgba = None
        if rgba is None:
            rgba = np.zeros((TILE_PX, TILE_PX, 4), dtype=np.uint8)
        fill = covered & (rgba[:, :, 3] < 255)
        if fill.any():
            owed.append((x, tile_path, rgba, fill))
    if not owed:
        return 0

    xmin = tile_bbox_3857(x0, y, zoom)[0]
    _, ymin, xmax, ymax = tile_bbox_3857(x1, y, zoom)
    width = (x1 - x0 + 1) * TILE_PX
    strip, coverage = _warp_rgb(Path(path), (xmin, ymin, xmax, ymax), width, TILE_PX, float(lats[TILE_PX // 2]),
                                Path(mask) if mask else None)

    written = 0
    for x, tile_path, rgba, fill in owed:
        columns = slice((x - x0) * TILE_PX, (x - x0 + 1) * TILE_PX)
        share = coverage[:, columns] * fill
        if not (share > 0).any():
            continue  # the face runs past this sheet's own edge here; the neighbour draws it
        rgba = _composite(rgba, strip[:, columns], share)
        tile_path.parent.mkdir(parents=True, exist_ok=True)
        partial = tile_path.with_suffix(".partial")
        if (rgba[:, :, 3] == 255).all():
            _write_atomically(tile_path, encode_png(rgba))
            partial.unlink(missing_ok=True)
        else:
            _write_atomically(partial, _encode_lossless(rgba))
        tile_path.with_suffix(".none").unlink(missing_ok=True)
        written += 1
    return written


def _promote_partials(kind: ChartKind, cycle: str, since: float | None = None) -> int:
    """Every tile a pass left unfinished made the served tile, once the
    last sheet has drawn: what is not drawn by now is where no sheet
    reaches. One older than `since` is another renderer's that this
    pass never touched, and goes. Returns how many were made tiles."""
    root = CHART_TILE_CACHE_DIR / cycle / kind.key
    count = 0
    for partial in sorted(root.rglob("*.partial")) if root.exists() else []:
        if since is None or partial.stat().st_mtime >= since:
            _write_atomically(partial.with_suffix(".png"), encode_png(_decode_rgba(partial.read_bytes())))
            count += 1
        partial.unlink(missing_ok=True)
    return count


def _write_pyramid_status(cycle: str, record: dict) -> None:
    """One kind's record, written whole: the file beside it and renamed
    over it, so a reader never meets half of one."""
    path = CHART_TILE_CACHE_DIR / cycle / _PYRAMID_STATUS
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        data = {}
    data[record["kind"]] = record
    _write_atomically(path, json.dumps(data, indent=1).encode())
    _serving_cache["at"] = 0.0  # a pass just ended, or began: re-decide what to serve


def _record(kind_key: str, raw: dict) -> dict:
    """A kind's record in the current shape. One written before sheets
    were kept reads as complete once if it said it had finished -- which
    is what it said -- and as a pass under way otherwise."""
    if "sheets" in raw:
        return raw
    finished = raw.get("finished_at")
    return {
        "kind": kind_key, "zooms": raw.get("zooms", []),
        "sheets": sorted(COVERAGE.get(kind_key, {})) if finished else [],
        "finished_at": finished, "tiles": raw.get("tiles_written", 0),
        "current_pass": None if finished or not raw.get("started_at") else {
            "started_at": raw["started_at"], "done": raw.get("rasters_done", 0),
            "total": raw.get("rasters_total", 0), "current": raw.get("current"),
        },
    }


def pyramid_status(cycle: str) -> dict:
    """Per kind, a cycle's pyramid record (see above) -- what the Dev
    console shows next to the chart list."""
    try:
        raw = json.loads((CHART_TILE_CACHE_DIR / cycle / _PYRAMID_STATUS).read_text())
    except (OSError, ValueError):
        return {}
    return {key: _record(key, record) for key, record in raw.items()}


def pyramid_missing(cycle: str, kind_key: str) -> list[str]:
    """The sheets of a kind the FAA publishes that no finished pass of
    this cycle has rendered."""
    rendered = set(pyramid_status(cycle).get(kind_key, {}).get("sheets", []))
    return sorted(set(COVERAGE.get(kind_key, {})) - rendered)


def pyramid_complete(cycle: str, kinds: tuple = tuple(KINDS)) -> bool:
    """Whether every one of `kinds` has a finished pass and every sheet
    the FAA publishes of it rendered."""
    progress = pyramid_status(cycle)
    return all(
        progress.get(k, {}).get("finished_at") and not (set(COVERAGE.get(k, {})) - set(progress[k].get("sheets", [])))
        for k in kinds
    )


def pyramid_due(cycle: str, kinds: tuple = tuple(KINDS)) -> tuple:
    """The kinds of `kinds` a refresh has to render for `cycle`: those
    not complete, and those last drawn under another RENDERER_VERSION."""
    progress = pyramid_status(cycle)
    return tuple(k for k in kinds if not pyramid_complete(cycle, (k,))
                 or progress[k].get("renderer", 1) != RENDERER_VERSION)


def render_pyramid(kind: ChartKind, zooms: tuple | None = None, workers: int = 4, charts: list | None = None,
                   cycle: str | None = None) -> int:
    """Every tile of every prepared chart of `kind` in `cycle` (the
    FAA's current one by default), at each zoom of the kind's own
    range, written into the tile cache. Sheets are done one at a time
    -- their tile rows in parallel across `workers` processes -- so two
    sheets never race for the same seam tile. Returns the number of
    tiles written. Re-runnable: a tile already complete on disk is left
    alone, so an interrupted render resumes where it stopped (an
    already-rendered sheet costs a scan) -- unless the last finished
    pass was under another RENDERER_VERSION, when every tile is drawn
    again and the cycle's revision bumped at the end."""
    zooms = tuple(zooms or range(kind.min_zoom, kind.max_zoom + 1))
    if charts is None:
        cycle = cycle or current_cycle()
        charts = prepared_charts(cycle)
    charts = [c for c in charts if c.kind is kind]
    order = {name: i for i, name in enumerate(_draw_order({c.name for c in charts}))}
    charts = sorted(charts, key=lambda c: order[c.name])  # the first sheet written into a tile wins it
    cycle = cycle or (charts[0].cycle if charts else current_cycle())
    rasters = [(chart, raster) for chart in charts for raster in chart.rasters]
    total = 0
    before = pyramid_status(cycle).get(kind.key) or {"sheets": [], "finished_at": None, "tiles": 0}
    started = datetime.now(tz=timezone.utc)
    # Tiles on disk from a pass under another renderer are drawn again:
    # `since`, the time before which a tile does not count as drawn. A
    # pass under this one that was cut short is resumed with its own.
    cut_short = before.get("current_pass") or {}
    if cut_short and cut_short.get("renderer", 1) == RENDERER_VERSION:
        since = cut_short.get("since")
    elif cut_short or (before["finished_at"] and before.get("renderer", 1) != RENDERER_VERSION):
        # A little before now: a file's time comes from the kernel's
        # coarser clock, which can read a few milliseconds behind this.
        since = time.time() - 0.05
    else:
        since = None
    record = {
        "kind": kind.key, "zooms": list(zooms), "sheets": before["sheets"], "finished_at": before["finished_at"],
        "tiles": before["tiles"], "renderer": before.get("renderer", 1),
        "current_pass": {"started_at": started.isoformat(), "done": 0, "total": len(rasters), "current": None,
                         "renderer": RENDERER_VERSION, "since": since},
    }
    _write_pyramid_status(cycle, record)

    pool = ProcessPoolExecutor(max_workers=workers) if workers > 0 else None
    try:
        for i, (chart, raster) in enumerate(rasters):
            record["current_pass"]["current"] = raster.path.stem
            _write_pyramid_status(cycle, record)
            sheet_started = time.time()
            sheet_tiles = 0
            for zoom in zooms:
                x0, x1, y0, y1 = _tile_range(raster.face, zoom)
                jobs = [
                    (str(raster.path), raster.face, kind.key, chart.cycle, zoom, y, x0, x1,
                     str(raster.mask) if raster.mask else None, since)
                    for y in range(y0, y1 + 1)
                ]
                if pool is None:
                    sheet_tiles += sum(map(_render_row, jobs))
                else:
                    sheet_tiles += sum(pool.map(_render_row, jobs, chunksize=1))
            total += sheet_tiles
            record["current_pass"]["done"] = i + 1
            _write_pyramid_status(cycle, record)
            log.info("%s: %d tiles in %.0f s (%d of %d sheets, %d tiles so far)",
                     raster.path.stem, sheet_tiles, time.time() - sheet_started, i + 1, len(rasters), total)
    finally:
        if pool is not None:
            pool.shutdown()
    promoted = _promote_partials(kind, cycle, since)
    # The permanent part, at the end of the pass only: the sheets it
    # rendered join those before it.
    record.update(
        sheets=sorted(set(record["sheets"]) | {c.name for c in charts}),
        finished_at=datetime.now(tz=timezone.utc).isoformat(), tiles=record["tiles"] + total, current_pass=None,
        renderer=RENDERER_VERSION,
    )
    _write_pyramid_status(cycle, record)
    if since is not None:
        # Every tile drawn again, under URLs browsers hold for weeks: a
        # new revision, and the publish ledger struck for this kind.
        _bump_revision(cycle, strike=lambda key: key.startswith(f"{kind.key}/"))
    log.info("%s %s: pass finished, %d tiles written, %d finished at its end", cycle, kind.key, total, promoted)
    missing = sorted(set(COVERAGE.get(kind.key, {})) - set(record["sheets"]))
    if missing:
        log.warning("%s %s: not complete, %d sheet(s) never rendered: %s", cycle, kind.key, len(missing),
                    ", ".join(missing))
    return total


# The cycle's tile revision: how many times tiles already served for it
# have been rendered again. The map puts it in every tile URL next to
# the cycle, because a browser holds tiles for weeks (the service
# worker's CacheFirst) under a URL that a re-render does not change --
# which is how one phone went on showing a white sliver down a sheet
# seam for days after the planner had stopped drawing it.
_TILES_REVISION = "revision"


def tiles_revision(cycle: str) -> int:
    try:
        return int((CHART_TILE_CACHE_DIR / cycle / _TILES_REVISION).read_text())
    except (OSError, ValueError):
        return 0


def _rerender_tile(args: tuple) -> bool:
    """One cached tile rendered again from the sheets as they are now,
    the same way `tile_png` would render it, and written over the old
    one. A top-level function because it runs in a worker process."""
    kind_key, cycle, x, y, zoom = args
    kind = KINDS[kind_key]
    rasters, complete = rasters_covering(kind, tile_bbox_wgs84(x, y, zoom), cycle)
    if not complete:
        # A sheet this tile needs could not be had. Drawn without it, the
        # tile would go out under the bumped revision -- which browsers
        # then keep for weeks -- missing that sheet; `tile_png` never
        # caches such a tile either. The old tile stays until a run that
        # has every sheet.
        return False
    rgba = render_tile(rasters, x, y, zoom) if rasters else None
    path = _tile_path(kind, cycle, x, y, zoom)
    if rgba is None:
        path.unlink(missing_ok=True)
        return False
    _write_atomically(path, encode_png(rgba))
    return True


def rerender_tiles(kind: ChartKind, boxes: list, cycle: str, workers: int = 2) -> int:
    """Every tile of `kind` already cached for `cycle` that touches one
    of `boxes`, rendered again -- after a sheet changed on disk -- then
    the cycle's revision bumped so browsers ask for them afresh, and the
    tiles struck off the publish ledger so the next `publish` uploads
    them again. Tiles not yet cached are left to render on demand.
    Returns the number rewritten."""
    tiles = set()
    for zoom in range(kind.min_zoom, kind.max_zoom + 1):
        for box in boxes:
            x0, x1, y0, y1 = _tile_range(box, zoom)
            tiles.update((x, y, zoom) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)
                         if _tile_path(kind, cycle, x, y, zoom).exists())
    jobs = [(kind.key, cycle, x, y, zoom) for x, y, zoom in sorted(tiles, key=lambda t: (t[2], t[1], t[0]))]
    log.info("%s %s: rendering %d tiles again", cycle, kind.key, len(jobs))
    if workers > 0 and len(jobs) > 1:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            written = sum(pool.map(_rerender_tile, jobs, chunksize=16))
    else:
        written = sum(map(_rerender_tile, jobs))

    root = CHART_TILE_CACHE_DIR / cycle
    stale = {str(_tile_path(kind, cycle, x, y, zoom).relative_to(root)) for x, y, zoom in tiles}
    _bump_revision(cycle, strike=stale.__contains__)
    return written


def _bump_revision(cycle: str, strike) -> None:
    """The cycle's tile revision one higher, and the publish ledger's
    entries `strike` says are stale taken off it, so the next publish
    uploads them again. Both files written whole; the callers hold the
    refresh lock, which `publish` takes too, so neither is written back
    stale by a run beside them."""
    root = CHART_TILE_CACHE_DIR / cycle
    root.mkdir(parents=True, exist_ok=True)
    _write_atomically(root / _TILES_REVISION, str(tiles_revision(cycle) + 1).encode())
    ledger = root / _PUBLISHED
    try:
        published = set(json.loads(ledger.read_text()))
    except (OSError, ValueError):
        return
    kept = sorted(key for key in published if not strike(key))
    if len(kept) != len(published):
        _write_atomically(ledger, json.dumps(kept).encode())


def unmask_prepared(cycle: str | None = None, workers: int = 2, again: bool = False) -> dict:
    """The masked lines taken out of every sheet already on disk that
    has not been looked at for them -- preparing a sheet does this
    itself, so this is for the ones prepared before it did -- and the
    cached tiles they touched rendered again. `again` looks once more at
    sheets already cleaned, for what is left along the borders of what
    was taken out (after the search learns to find more). Returns {kind
    key: boxes changed}. Re-runnable."""
    cycle = cycle or serving_cycle()
    changed: dict = {}
    for chart in prepared_charts(cycle):
        if not chart.kind.masked_lines:
            continue
        if not again and all(r.masked_lines is not None for r in chart.rasters):
            continue
        started = time.time()
        directory = chart.rasters[0].path.parent
        with _lock_for((chart.kind.key, chart.name)), _directory_lock(directory):
            removed = {}
            for path in sorted({r.path for r in chart.rasters}):
                parts = [r for r in chart.rasters if r.path == path]
                before = tuple(dict.fromkeys(b for r in parts for b in (r.masked_lines or ())))
                if parts[0].masked_lines is not None and not again:
                    removed[path] = (before, ())
                    continue
                removed[path] = (before, chart_faces.remove_masked_lines(path, [r.face for r in parts], known=before))
            rasters = tuple(
                Raster(path=r.path, face=r.face, envelope=r.envelope, mask=r.mask,
                       masked_lines=removed[r.path][0] + removed[r.path][1])
                for r in chart.rasters
            )
            _write_ready(directory, Chart(kind=chart.kind, name=chart.name, cycle=chart.cycle, rasters=rasters,
                                          prepared_at=chart.prepared_at))
        boxes = [box for _, found in removed.values() for box in found]
        changed.setdefault(chart.kind.key, []).extend(boxes)
        log.info("%s/%s: %d masked-line area(s) removed in %.0f s", chart.kind.key, chart.name, len(boxes),
                 time.time() - started)
    for key, boxes in changed.items():
        if boxes:
            count = rerender_tiles(KINDS[key], boxes, cycle, workers=workers)
            log.info("%s: %d tiles rendered again; revision %d", key, count, tiles_revision(cycle))
    return changed


# ---------------------------------------------------------------------------
# Keeping up with the cycle
# ---------------------------------------------------------------------------
#
# A new edition every 56 days, and a map that shows nothing but the
# chart, means somebody has to fetch and render the new one before its
# date or the map quietly flies stale charts. `refresh` is that job:
# the whole prepare-and-render for the FAA's current cycle when it is
# not complete on disk yet, then the previous cycle's files go. The
# planner runs it in a subprocess of its own once a day (and at
# start-up), so the serving process stays the size it is; the tile
# endpoints switch to the new cycle only when `serving_cycle` sees its
# pyramid complete.

_REFRESH_LOCK = "refresh.lock"


@contextlib.contextmanager
def refresh_lock(wait: bool = False):
    """The lock every run that renders the cycle's tiles holds for its
    whole life -- `refresh`, `pyramid` and `unmask`, from the planner's
    subprocess or a shell in another container -- yielding whether it
    got it. `wait` blocks until it is free; otherwise it yields False at
    once when another run holds it. The kernel lets go when the process
    ends, however it ends.

    What "a refresh is running" used to be read from: a pid written into
    this file (never deleted, and alive as a zombie -- the planner never
    reaped its child -- so one refresh read as running until the planner
    restarted), and failing that a pyramid status file touched in the
    last ten minutes, which missed a shell refresh's hours of preparing
    and a sheet slower than ten minutes."""
    import fcntl

    CHART_TILE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with (CHART_TILE_CACHE_DIR / _REFRESH_LOCK).open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX if wait else fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            yield False
            return
        try:
            yield True
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def refresh(kinds: tuple = tuple(KINDS), workers: int = 2, prune: bool = True,
            publish_bucket: str | None = None) -> str:
    """Bring the FAA's current cycle to a complete pyramid, publish it
    to `publish_bucket` if one is given (the AWS refresh task's job),
    then drop older cycles. Returns the cycle. Idempotent: a complete,
    published cycle costs one status read and one listing."""
    cycle = current_cycle()
    # Only the kinds due: a finished kind is not rendered again unless
    # the renderer has changed since, and one with a sheet missing is
    # tried again every run -- it used to read complete, and nothing
    # ever retried it.
    todo = pyramid_due(cycle, kinds)
    if todo:
        log.info("cycle %s: preparing sheets", cycle)
        prepare_all(todo, cycle)
        for key in todo:
            log.info("cycle %s: rendering the %s pyramid", cycle, key)
            render_pyramid(KINDS[key], workers=workers, cycle=cycle)
    if publish_bucket and pyramid_complete(cycle, kinds):
        publish(cycle, publish_bucket)
    if prune and pyramid_complete(cycle, kinds):
        prune_cycles(keep=cycle)
    return cycle


# ---------------------------------------------------------------------------
# Publishing to S3
# ---------------------------------------------------------------------------

_PUBLISHED = "published.json"


def publish(cycle: str, bucket: str, prefix: str = CHART_TILES_PREFIX, workers: int = 32, client=None) -> int:
    """Upload a complete cycle's tiles to s3://bucket/prefix/<cycle>/
    with the headers a CDN wants, then point prefix/serving.json at
    the cycle so every planner and browser switches at once. Resumable:
    what was uploaded is remembered beside the tiles, so a task killed
    half-way picks up where it stopped. Returns the tiles uploaded."""
    from concurrent.futures import ThreadPoolExecutor

    if client is None:
        import boto3

        client = boto3.client("s3")
    root = CHART_TILE_CACHE_DIR / cycle
    ledger = root / _PUBLISHED
    try:
        done = set(json.loads(ledger.read_text()))
    except (OSError, ValueError):
        done = set()
    todo = [p for p in root.rglob("*.png") if str(p.relative_to(root)) not in done]
    log.info("publishing cycle %s: %d tiles to upload (%d already there)", cycle, len(todo), len(done))

    def upload(path: Path) -> str:
        key = str(path.relative_to(root))
        client.put_object(
            Bucket=bucket, Key=f"{prefix}/{cycle}/{key}", Body=path.read_bytes(), ContentType="image/png",
            CacheControl="public, max-age=2419200, immutable",
        )
        return key

    uploaded = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for i, key in enumerate(pool.map(upload, todo), 1):
            done.add(key)
            uploaded += 1
            if i % 5000 == 0:
                _write_atomically(ledger, json.dumps(sorted(done)).encode())
                log.info("  %d of %d uploaded", i, len(todo))
    _write_atomically(ledger, json.dumps(sorted(done)).encode())

    pointer = {"cycle": cycle, "kinds": {k: p["tiles"] for k, p in pyramid_status(cycle).items()},
               "published_at": datetime.now(tz=timezone.utc).isoformat()}
    client.put_object(
        Bucket=bucket, Key=f"{prefix}/serving.json", Body=json.dumps(pointer).encode(),
        ContentType="application/json", CacheControl="public, max-age=300",
    )
    log.info("cycle %s published: %d tiles uploaded, serving.json points at it", cycle, uploaded)
    return uploaded


def prune_cycles(keep: str) -> list[str]:
    """Delete every cycle's sheets and tiles but `keep`'s (and any
    newer, which a refresh in progress may be building)."""
    removed = []
    keep_date = datetime.strptime(keep, "%m-%d-%Y")
    for root in (CHARTS_DIR, CHART_TILE_CACHE_DIR):
        for cycle in _cycles_on_disk(root):
            if cycle == keep or datetime.strptime(cycle, "%m-%d-%Y") > keep_date:
                continue
            shutil.rmtree(root / cycle, ignore_errors=True)
            removed.append(f"{root.name}/{cycle}")
            log.info("removed %s/%s", root.name, cycle)
    _serving_cache["at"] = 0.0
    return removed


def refresh_running() -> bool:
    """Whether a run that renders tiles -- a refresh, a `pyramid` or an
    `unmask`, from anywhere -- holds the refresh lock. Two renders of the
    same cycle at once would race each other on the seam tiles."""
    with refresh_lock() as got:
        return not got


def refresh_in_background(workers: int = 2, nice: int = 10) -> bool:
    """Start `python -m vfr.charts refresh` as a subprocess, unless one
    is running. Returns whether one was started. Its log goes beside
    the tiles (refresh.log); it takes the refresh lock itself, which is
    how `refresh_running` knows. Niced (where `nice` exists): it is hours
    of every core it is given, and the planner serving tiles beside it
    -- and, on a machine that is also somebody's desk, the browser
    looking at them -- come first."""
    import shutil
    import subprocess
    import sys

    if refresh_running():
        return False
    CHART_TILE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    log_file = (CHART_TILE_CACHE_DIR / "refresh.log").open("ab")
    command = [sys.executable, "-m", "vfr.charts", "refresh", "--workers", str(workers)]
    if nice and shutil.which("nice"):
        command = ["nice", "-n", str(nice), *command]
    process = subprocess.Popen(command, stdout=log_file, stderr=subprocess.STDOUT, start_new_session=True)
    # Waited on, so a finished refresh does not linger as a zombie.
    threading.Thread(target=process.wait, name="chart-refresh-reaper", daemon=True).start()
    log.info("chart refresh started (pid %d)", process.pid)
    return True


def refresh_due() -> bool:
    """Whether the FAA's current cycle is not yet complete on disk, or
    was drawn under another renderer."""
    return bool(pyramid_due(current_cycle()))


def face_gaps(charts: list | None = None) -> list[tuple]:
    """Adjacent sectional faces that fail to meet: (a, b, gap in
    degrees) for every pair whose faces leave daylight between them
    along a shared edge that no third sheet fills. The seam check
    `python -m vfr.charts check` prints; an empty list is what a
    healthy cycle looks like (the sheets overlap by a tenth of a
    degree to a degree), except that the FAA charts no sheet over the
    open Gulf between the Caribbean 1 chart and Jacksonville, and that
    is reported as what it is."""
    charts = charts if charts is not None else prepared_charts(serving_cycle())
    faces = {r.path.stem: r.face for c in charts if c.kind is SECTIONAL for r in c.rasters}

    def overlap(a0, a1, b0, b1):
        return min(a1, b1) - max(a0, b0)

    def unfilled(strip: Box, a: str, b: str) -> bool:
        """Whether some point of the strip between two faces lies in
        no other face."""
        west, south, east, north = strip
        lons = west + (np.arange(24) + 0.5) / 24 * (east - west)
        lats = south + (np.arange(4) + 0.5) / 4 * (north - south)
        covered = np.zeros((4, 24), dtype=bool)
        for name, (w, s, e, n) in faces.items():
            if name in (a, b):
                continue
            covered |= ((lats >= s) & (lats <= n))[:, None] & ((lons >= w) & (lons <= e))[None, :]
        return not covered.all()

    gaps = []
    for a, (aw, as_, ae, an) in faces.items():
        for b, (bw, bs, be, bn) in faces.items():
            if a == b:
                continue
            if overlap(as_, an, bs, bn) > 0.5 and abs(ae - bw) < 1.5 and bw > aw and be > ae and bw - ae > 0.005:
                strip = (ae, max(as_, bs), bw, min(an, bn))
                if unfilled(strip, a, b):
                    gaps.append((a, b, round(bw - ae, 3)))
            if overlap(aw, ae, bw, be) > 1.0 and abs(an - bs) < 1.5 and bs > as_ and bn > an and bs - an > 0.005:
                strip = (max(aw, bw), an, min(ae, be), bs)
                if unfilled(strip, a, b):
                    gaps.append((a, b, round(bs - an, 3)))
    return gaps


def _main(argv: list | None = None) -> int:
    """`python -m vfr.charts prepare` fetches every sheet;
    `python -m vfr.charts pyramid` renders every tile; `refresh` does
    both for the FAA's current cycle and prunes the old ones; `check`
    looks for daylight between adjacent sheets; `unmask` takes the
    masked lines out of sheets prepared before `prepare` did it itself
    and renders their tiles again. All resume."""
    import argparse

    parser = argparse.ArgumentParser(description="FAA VFR charts: fetch every sheet, render every tile.")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("prepare", "pyramid", "refresh", "check", "publish", "unmask"):
        p = sub.add_parser(name)
        if name in ("prepare", "pyramid"):
            p.add_argument("--kind", nargs="+", choices=list(KINDS), default=list(KINDS))
        if name == "prepare":
            p.add_argument("--redetect", action="store_true", help="run the face detection again on sheets already on disk")
        if name in ("pyramid", "refresh", "unmask"):
            p.add_argument("--workers", type=int, default=4 if name == "pyramid" else 2)
        if name == "unmask":
            p.add_argument("--cycle", help="the cycle whose sheets and tiles to clean; the served one by default")
            p.add_argument("--again", action="store_true",
                           help="look again at sheets already cleaned, along the borders of what was taken out")
        if name == "pyramid":
            p.add_argument("--zooms", help="e.g. 5-12; the kind's own range by default")
            p.add_argument("--tiles-dir", help="render into this folder instead of the tile cache -- a staging "
                                               "pyramid to swap in whole while the old one keeps serving")
        if name in ("refresh", "publish"):
            p.add_argument("--bucket", default=CHART_TILES_BUCKET,
                           help="S3 bucket to publish the complete cycle to (CHART_TILES_BUCKET by default)")
        if name == "publish":
            p.add_argument("--cycle", help="the cycle to publish; the served one by default")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if getattr(args, "tiles_dir", None):
        global CHART_TILE_CACHE_DIR
        CHART_TILE_CACHE_DIR = Path(args.tiles_dir)

    # The runs that write the cycle's tiles, or its publish ledger, hold
    # the refresh lock for their whole life. A refresh or a pyramid that
    # finds it held leaves the running one to it; an unmask waits, then
    # renders its tiles again on what that run left; a publish waits
    # rather than write back a ledger an unmask has struck tiles off.
    if args.command in ("refresh", "pyramid", "unmask", "publish"):
        wait = args.command in ("unmask", "publish")
        with refresh_lock(wait=wait) as got:
            if not got:
                log.info("a refresh, pyramid or unmask is already running on %s; leaving it to that",
                         CHART_TILE_CACHE_DIR)
                return 0 if args.command == "refresh" else 1
            return _run(args, parser)
    return _run(args, parser)


def _run(args, parser) -> int:
    if args.command == "prepare":
        charts = prepare_all(tuple(args.kind), redetect=args.redetect)
        log.info("%d charts ready under %s", len(charts), CHARTS_DIR)
        return 0
    if args.command == "unmask":
        changed = unmask_prepared(args.cycle, workers=args.workers, again=args.again)
        log.info("masked lines removed: %s", {k: len(v) for k, v in changed.items()} or "none left to remove")
        return 0
    if args.command == "refresh":
        cycle = refresh(workers=args.workers, publish_bucket=args.bucket)
        log.info("cycle %s complete; serving %s", cycle, serving_cycle())
        return 0
    if args.command == "publish":
        if not args.bucket:
            parser.error("publish needs --bucket or CHART_TILES_BUCKET")
        count = publish(args.cycle or serving_cycle(), args.bucket)
        log.info("%d tiles uploaded", count)
        return 0
    if args.command == "check":
        gaps = face_gaps()
        for a, b, gap in gaps:
            print(f"GAP {gap:.3f} deg between {a} and {b}")
        print(f"{len(gaps)} gaps between adjacent sheets ({serving_cycle()})")
        return 1 if gaps else 0
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
