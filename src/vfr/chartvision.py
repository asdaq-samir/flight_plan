"""Finding visual checkpoints by reading the VFR sectional itself.

The rest of this project derives candidates from OpenStreetMap and FAA
datasets, then filters them down to the ones a sectional actually draws.
This module skips the middle step: it reads the chart raster and takes
what is drawn. That is the same question the 1-5 spottability label asks,
so the chart is the ground truth rather than a proxy for it, and the
filtering work that removed towers, water towers, quarries and unnamed
lakes is unnecessary here -- none of them are drawn, so none of them are
seen.

It is also the fast path, which is the point. Collecting a corridor from
Overpass plus the FAA subscription plus a per-candidate elevation lookup
is minutes of network I/O. Reading tiles the browser is about to render
anyway is seconds, and the segmentation itself is milliseconds: 0.16 s
for a 1024x1024 mosaic, measured.

Sectionals are cartographic products with a fixed palette, which is what
makes this tractable without a trained model. Water is a specific pale
blue, urban tint a specific yellow, sampled from real tiles (see
PALETTE). Tiles are served lossily compressed, so classification is by
tolerant colour relationships rather than exact match.

What this does NOT do is name anything. A detected blue blob is a usable
checkpoint before anyone knows it is called Nepco Lake; names are a
cross-check to run afterwards against OSM/FAA, not something to block a
pilot on.
"""
from __future__ import annotations

import hashlib
import io
import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import requests
from PIL import Image

from .config import DATA_DIR
from .geo import along_track_distance_nm, cross_track_distance_nm, distance_nm
from .labeling import FAA_VFR_SECTIONAL_URL, VFR_SECTIONAL_MAX_ZOOM

TILE_PX = 256
DEFAULT_ZOOM = VFR_SECTIONAL_MAX_ZOOM  # 12; the chart's own maximum
TILE_CACHE_DIR = DATA_DIR / "raw" / "chart_tiles"
REQUEST_HEADERS = {"User-Agent": "vfr-route-learning-project/0.1"}

# Earth's circumference at the equator, for the web-mercator scale below.
EARTH_CIRCUMFERENCE_M = 40_075_016.686


@dataclass
class PaletteClass:
    """One thing the chart draws, and how to recognise its pixels.

    `test` takes the R/G/B planes as integer arrays and returns a boolean
    mask. Written as relationships between channels rather than distance
    to a reference colour because the tiles are JPEG-compressed: a lake
    interior varies by 20-30 per channel, but blue stays dominant over
    red throughout.
    """

    name: str
    test: object
    min_area_px: int
    # Roughly how confidently this class means "a pilot can find it".
    # Water and towns are unambiguous on a chart; anything softer would
    # need the learned scorer rather than a constant.
    base_score: float


def _water(r, g, b):
    # Sampled at Nepco Lake: (190, 223, 238). Blue clearly above red, and
    # light -- the chart's water is a tint, not a saturated blue.
    return (b > r + 25) & (b > 200) & (g > r) & (r > 120)


def _urban(r, g, b):
    # The (250, 248, 86) yellow used for built-up areas.
    return (r > 210) & (g > 200) & (b < 160)


PALETTE = (
    PaletteClass("water", _water, min_area_px=40, base_score=4.2),
    PaletteClass("town", _urban, min_area_px=400, base_score=4.0),
)


def latlon_to_global_px(lat: float, lon: float, zoom: int = DEFAULT_ZOOM) -> tuple:
    """Web-mercator pixel coordinates at `zoom`, in the whole-world plane."""
    scale = (2 ** zoom) * TILE_PX
    x = (lon + 180.0) / 360.0 * scale
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * scale
    return x, y


def global_px_to_latlon(x: float, y: float, zoom: int = DEFAULT_ZOOM) -> tuple:
    scale = (2 ** zoom) * TILE_PX
    lon = x / scale * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * y / scale))))
    return lat, lon


def metres_per_pixel(lat: float, zoom: int = DEFAULT_ZOOM) -> float:
    """Ground resolution at this latitude -- web mercator stretches with
    latitude, so a pixel is not a fixed distance and blob areas would be
    overstated in the north without this."""
    return EARTH_CIRCUMFERENCE_M * math.cos(math.radians(lat)) / ((2 ** zoom) * TILE_PX)


def corridor_tiles(start: tuple, end: tuple, half_width_nm: float, zoom: int = DEFAULT_ZOOM) -> list:
    """The tile (x, y) pairs covering a corridor around the route.

    Walks the great circle rather than taking the bounding box of the two
    endpoints: a long diagonal route's bounding box is mostly empty, and
    fetching it would multiply the tile count for nothing.
    """
    from .geo import bearing_deg, destination_point

    total_nm = distance_nm(start[0], start[1], end[0], end[1])
    step_nm = max(1.0, half_width_nm)
    tiles, current, travelled = set(), start, 0.0
    while True:
        for side in (-90.0, 0.0, 90.0):
            bearing = bearing_deg(current[0], current[1], end[0], end[1]) + side
            offset = (
                current if side == 0.0
                else destination_point(current[0], current[1], bearing, half_width_nm)
            )
            px, py = latlon_to_global_px(offset[0], offset[1], zoom)
            tiles.add((int(px // TILE_PX), int(py // TILE_PX)))
        if travelled >= total_nm:
            break
        bearing = bearing_deg(current[0], current[1], end[0], end[1])
        current = destination_point(current[0], current[1], bearing, step_nm)
        travelled += step_nm

    # No hole-filling pass. The sampling step above is at most
    # half_width_nm, and a zoom-12 tile is about 5 nm across at these
    # latitudes, so consecutive samples land in the same or an adjacent
    # tile and cannot skip one. Dilating the set "to be safe" would have
    # widened an already 3-wide corridor to 5 and roughly tripled the
    # tiles fetched, which is the one cost that actually matters here.
    return sorted(tiles)


def _tile_cache_path(x: int, y: int, zoom: int) -> Path:
    key = hashlib.sha1(FAA_VFR_SECTIONAL_URL.encode()).hexdigest()[:8]
    return TILE_CACHE_DIR / key / str(zoom) / str(x) / f"{y}.png"


def fetch_tile(x: int, y: int, zoom: int = DEFAULT_ZOOM, session=None) -> Image.Image | None:
    """One chart tile, from the on-disk cache when present.

    Cached because the chart changes on a 28-day cycle while a pilot may
    replan the same corridor repeatedly, and because a second route
    through the same area should be instant. Returns None rather than
    raising if a tile is unavailable -- the sectional does not cover
    every tile in a bounding box (oceans, Canada), and one missing tile
    should leave a hole in the mosaic, not fail the whole request.
    """
    path = _tile_cache_path(x, y, zoom)
    if path.exists():
        try:
            return Image.open(path).convert("RGB")
        except OSError:
            path.unlink(missing_ok=True)  # a half-written cache entry

    url = FAA_VFR_SECTIONAL_URL.format(z=zoom, x=x, y=y)
    getter = session.get if session is not None else requests.get
    try:
        resp = getter(url, headers=REQUEST_HEADERS, timeout=20)
        if resp.status_code != 200 or not resp.content:
            return None
        image = Image.open(io.BytesIO(resp.content)).convert("RGB")
    except (requests.RequestException, OSError):
        return None

    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    image.save(tmp, "PNG")
    tmp.replace(path)  # atomic, so a killed request cannot leave a torn cache entry
    return image


@dataclass
class Mosaic:
    """A stitched block of chart tiles plus where it sits in the world."""

    pixels: np.ndarray  # (h, w, 3) uint8
    origin_px: tuple    # global pixel coords of the top-left corner
    zoom: int
    missing_tiles: int = 0
    fetched_tiles: int = 0
    cached_tiles: int = 0

    def to_latlon(self, cx: float, cy: float) -> tuple:
        return global_px_to_latlon(self.origin_px[0] + cx, self.origin_px[1] + cy, self.zoom)


def build_mosaic(tiles: list, zoom: int = DEFAULT_ZOOM, max_workers: int = 48) -> Mosaic:
    """Fetch and stitch `tiles` into one array.

    Parallel because this is entirely network-bound. At 16 workers a
    323 nm route's 191 tiles took 80 s, which is not a fast path by any
    reading; the work per tile is a few milliseconds of decode against
    ~400 ms of round trip, so the worker count is the whole story. The
    tile service is a CDN and handles the concurrency fine.

    The disk cache matters as much: the second plan through the same
    corridor fetches nothing at all.
    """
    xs = [x for x, _ in tiles]
    ys = [y for _, y in tiles]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    width, height = (x1 - x0 + 1) * TILE_PX, (y1 - y0 + 1) * TILE_PX
    canvas = np.zeros((height, width, 3), dtype=np.uint8)

    cached = sum(1 for x, y in tiles if _tile_cache_path(x, y, zoom).exists())
    with requests.Session() as session:
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            results = pool.map(lambda t: (t, fetch_tile(t[0], t[1], zoom, session)), tiles)
            missing = 0
            for (x, y), image in results:
                if image is None:
                    missing += 1
                    continue
                px, py = (x - x0) * TILE_PX, (y - y0) * TILE_PX
                canvas[py:py + TILE_PX, px:px + TILE_PX] = np.asarray(image)

    return Mosaic(
        pixels=canvas,
        origin_px=(x0 * TILE_PX, y0 * TILE_PX),
        zoom=zoom,
        missing_tiles=missing,
        fetched_tiles=len(tiles) - cached,
        cached_tiles=cached,
    )


@dataclass
class Landmark:
    """One thing found on the chart, in the candidate schema's shape."""

    category: str
    lat: float
    lon: float
    area_m2: float
    score: float
    pixels: int
    name: str | None = None  # filled in later by name cross-check, if at all
    extras: dict = field(default_factory=dict)


def detect_landmarks(mosaic: Mosaic, palette=PALETTE) -> list:
    """Connected components of each palette class, as Landmarks.

    Blob area is converted to ground area using the mosaic's own latitude,
    not a constant, since a web-mercator pixel covers less ground the
    further north it is.
    """
    from scipy import ndimage

    channels = mosaic.pixels.astype(np.int16)
    r, g, b = channels[:, :, 0], channels[:, :, 1], channels[:, :, 2]
    centre_lat, _ = mosaic.to_latlon(mosaic.pixels.shape[1] / 2, mosaic.pixels.shape[0] / 2)
    m_per_px = metres_per_pixel(centre_lat, mosaic.zoom)

    landmarks = []
    for spec in palette:
        mask = spec.test(r, g, b)
        labelled, count = ndimage.label(mask)
        if count == 0:
            continue
        sizes = ndimage.sum(mask, labelled, range(1, count + 1))
        keep = [i + 1 for i, size in enumerate(sizes) if size >= spec.min_area_px]
        if not keep:
            continue
        for label, (cy, cx) in zip(keep, ndimage.center_of_mass(mask, labelled, keep)):
            lat, lon = mosaic.to_latlon(cx, cy)
            landmarks.append(
                Landmark(
                    category=spec.name,
                    lat=lat,
                    lon=lon,
                    area_m2=float(sizes[label - 1]) * m_per_px ** 2,
                    score=spec.base_score,
                    pixels=int(sizes[label - 1]),
                )
            )
    return landmarks


# How many tiles across a single stitched block may span. A block is
# allocated as a dense rectangle, so this bounds memory and the pixels
# segmented -- see tile_blocks.
MAX_BLOCK_TILES = 6

# Two detections of the same feature closer than this are the same
# feature, seen from two overlapping blocks.
DEDUPE_NM = 0.2


def tile_blocks(tiles: list, max_span: int = MAX_BLOCK_TILES) -> list:
    """Split a corridor's tiles into small dense rectangles to stitch.

    A route corridor is a thin diagonal ribbon, and the bounding box of a
    long one is almost entirely empty. Stitching it as a single mosaic
    allocated that whole rectangle: a 323 nm route spans roughly 62 by 55
    tiles, which is 668 MB of canvas to hold about 191 tiles of actual
    chart, and it made a fully cached run take 39 s. Blocks keep the
    allocation proportional to the chart actually fetched.

    Blocks overlap by one tile so a lake straddling a boundary is seen
    whole by at least one of them; _dedupe removes the double sighting.
    """
    if not tiles:
        return []
    remaining = sorted(tiles)
    blocks, seen = [], set()
    for anchor_x, anchor_y in remaining:
        if (anchor_x, anchor_y) in seen:
            continue
        block = [
            (x, y) for x, y in remaining
            if anchor_x <= x < anchor_x + max_span and anchor_y - 1 <= y < anchor_y + max_span
        ]
        if not block:
            continue
        # Only the non-overlapping core counts as consumed, so the next
        # block starts one tile back and the seam is covered twice.
        seen.update(
            (x, y) for x, y in block
            if x < anchor_x + max_span - 1 and y < anchor_y + max_span - 1
        )
        blocks.append(block)
    return blocks


def _dedupe(landmarks: list, within_nm: float = DEDUPE_NM) -> list:
    """Drop repeat sightings of one feature from overlapping blocks,
    keeping the largest -- that is the block that saw more of it."""
    kept = []
    for landmark in sorted(landmarks, key=lambda l: -l.area_m2):
        if any(
            k.category == landmark.category
            and distance_nm(k.lat, k.lon, landmark.lat, landmark.lon) < within_nm
            for k in kept
        ):
            continue
        kept.append(landmark)
    return kept


def landmarks_along_route(
    start: tuple,
    end: tuple,
    half_width_nm: float = 1.0,
    zoom: int = DEFAULT_ZOOM,
    margin_nm: float = 5.0,
) -> dict:
    """Everything the chart draws inside the route corridor.

    The whole fast path in one call: pick tiles, fetch them (cached),
    segment, and keep the blobs that fall inside the corridor. No
    Overpass, no FAA subscription, no elevation service.
    """
    tiles = corridor_tiles(start, end, half_width_nm + 1.0, zoom)
    route_nm = distance_nm(start[0], start[1], end[0], end[1])

    found, stats = [], {"missing": 0, "fetched": 0, "cached": 0}
    for block in tile_blocks(tiles):
        mosaic = build_mosaic(block, zoom)
        stats["missing"] += mosaic.missing_tiles
        stats["fetched"] += mosaic.fetched_tiles
        stats["cached"] += mosaic.cached_tiles
        for landmark in detect_landmarks(mosaic):
            cross = cross_track_distance_nm(landmark.lat, landmark.lon, start, end)
            along = along_track_distance_nm(landmark.lat, landmark.lon, start, end)
            if abs(cross) > half_width_nm or not (-margin_nm <= along <= route_nm + margin_nm):
                continue
            landmark.extras = {"cross_track_nm": cross, "along_track_nm": along}
            found.append(landmark)

    found = _dedupe(found)
    found.sort(key=lambda l: l.extras["along_track_nm"])
    return {
        "landmarks": found,
        "tiles": len(tiles),
        "tiles_missing": stats["missing"],
        "tiles_fetched": stats["fetched"],
        "tiles_cached": stats["cached"],
        "route_nm": route_nm,
    }
