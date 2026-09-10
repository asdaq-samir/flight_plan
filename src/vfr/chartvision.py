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
    # Upper bound, where being too big is itself disqualifying. An
    # airport symbol is a small glyph; a magenta region the size of a
    # county is airspace shading wearing the same colour.
    max_area_px: int | None = None
    # Roughly how confidently this class means "a pilot can find it".
    # Water and towns are unambiguous on a chart; anything softer would
    # need the learned scorer rather than a constant.
    base_score: float = 3.0


def _water(r, g, b):
    # Sampled at Nepco Lake: (190, 223, 238). Blue clearly above red, and
    # light -- the chart's water is a tint, not a saturated blue.
    return (b > r + 25) & (b > 200) & (g > r) & (r > 120)


def _urban(r, g, b):
    # The (250, 248, 86) yellow used for built-up areas.
    return (r > 210) & (g > 200) & (b < 160)


def _airport(r, g, b):
    """The magenta an airport is drawn in. Kept, but NOT in PALETTE.

    Colour cannot find airports on a sectional, and this function is here
    to record why rather than to be used for detection. The magenta is
    real -- sampled at KISW and Wag-Aero as (83,36,52), (74,12,33),
    (86,18,39) -- but the chart shades Class E and Class D airspace in the
    same colour over enormous areas. Detecting on colour returned 554
    "airports" on one 323 nm route. Bounding blob size to something
    glyph-shaped only got that to 535, because the vignette is a gradient
    and thresholding a gradient produces speckle at every size. Worse, at
    KISW's own coordinates the near-black linework of the runway symbol
    outvoted the magenta.

    Airports are the one landmark class where vision is the wrong tool
    anyway: they are a finite, enumerated set with exact published
    coordinates, and this project already caches the FAA's own APT_BASE.
    Reading a local file beats inferring from pixels. See
    vfr.faa_data.load_route_airports, merged in by the planner.

    Still used by _dark_line, which subtracts it so airport magenta is at
    least not reported as a road.
    """
    return (r > g + 25) & (b > g + 8) & (r < 170) & (g < 90)


def _river_line(r, g, b):
    """A river or stream, drawn as a dark blue line rather than a fill.

    Distinct from _water and missed entirely by it: the chart fills a
    lake with a pale tint around (190,223,238) but draws a watercourse as
    a saturated dark blue line, sampled between (0,43,85) and (3,82,113)
    at points a pilot marked by hand. Dark blue is unambiguous on a
    sectional -- nothing else uses it -- so this needs no shape test.
    """
    return (b > r + 40) & (b > 55) & (r < 110) & (g < b + 20)


def _dark_line(r, g, b):
    """Roads, railroads and boundaries: the chart's black linework.

    Deliberately one class rather than three. They are all near-black and
    separating them needs stroke pattern -- railroads carry cross ticks,
    boundaries are dashed -- which is a different kind of analysis than a
    colour test. As a *crossing* they are all the same thing to a pilot
    anyway: a line the course cuts at a knowable point. Which kind it is
    gets settled during labeling.
    """
    dark = (r < 110) & (g < 115) & (b < 110)
    # Airport magenta is dark too. Excluded here rather than relying on
    # ordering, because linear_crossings runs its own palette and would
    # otherwise report every airport symbol as a road crossing.
    return dark & ~_airport(r, g, b)


# Fills are found as blobs and reported at their centroid. Lines are
# found as crossings of the course, because the centroid of a river is
# not a place -- see linear_crossings.
# No airport class here, deliberately -- see _airport.
PALETTE = (
    PaletteClass("water", _water, min_area_px=40, base_score=4.2),
    PaletteClass("town", _urban, min_area_px=400, base_score=4.0),
)

LINEAR_PALETTE = (
    PaletteClass("river", _river_line, min_area_px=12, base_score=4.3),
    PaletteClass("road_or_rail", _dark_line, min_area_px=12, base_score=3.6),
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
        keep = [
            i + 1 for i, size in enumerate(sizes)
            if size >= spec.min_area_px
            and (spec.max_area_px is None or size <= spec.max_area_px)
        ]
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



# How far from the course line a pixel may sit and still count as being
# on it. The course is drawn as a mathematical line but chart linework
# has width, and a pilot clicking a crossing does not hit the exact
# pixel; 3 px at zoom 12 is a bit over 100 m.
CROSSING_TOLERANCE_PX = 3

# Two crossing pixels further apart than this along the course are
# separate crossings. A river meanders and can cut the course several
# times within a mile, but below this they are one checkpoint.
CROSSING_SEPARATION_PX = 24


def great_circle_pixels(start: tuple, end: tuple, zoom: int = DEFAULT_ZOOM) -> np.ndarray:
    """The course as global pixel coordinates, sampled about one pixel
    apart, following the great circle.

    Interpolating straight between the endpoints *in pixel space* is a
    rhumb line, not a great circle, and the difference is not academic:
    on a 323 nm route it put detected crossings up to 0.6 nm off course,
    drifting further the longer the route ran, so almost none of them
    lined up with the same crossings picked by hand. Cross-track distance
    is measured against the great circle everywhere else in this project,
    so the raster walk has to use it too.

    Spherical linear interpolation rather than repeated bearing steps:
    it is exact, and it vectorises, which matters because a long route is
    tens of thousands of samples.
    """
    lat1, lon1 = math.radians(start[0]), math.radians(start[1])
    lat2, lon2 = math.radians(end[0]), math.radians(end[1])
    a = np.array([math.cos(lat1) * math.cos(lon1), math.cos(lat1) * math.sin(lon1), math.sin(lat1)])
    b = np.array([math.cos(lat2) * math.cos(lon2), math.cos(lat2) * math.sin(lon2), math.sin(lat2)])

    omega = math.acos(float(np.clip(np.dot(a, b), -1.0, 1.0)))
    # Not `== 0`: the dot product of a unit vector with itself comes back
    # as 0.999999... in floating point, so acos gives ~1e-8 rather than
    # zero and the guard never fired. Below a microradian (~6 m) there is
    # no course to walk.
    if omega < 1e-6:
        return np.empty((0, 2))

    # One sample per pixel of the straight-line pixel distance is enough:
    # the great circle is never further from it than the drift above.
    x0, y0 = latlon_to_global_px(start[0], start[1], zoom)
    x1, y1 = latlon_to_global_px(end[0], end[1], zoom)
    steps = max(2, int(math.hypot(x1 - x0, y1 - y0)))

    t = np.linspace(0.0, 1.0, steps + 1)
    points = (
        np.sin((1 - t)[:, None] * omega) * a + np.sin(t[:, None] * omega) * b
    ) / math.sin(omega)

    lat = np.degrees(np.arcsin(np.clip(points[:, 2], -1.0, 1.0)))
    lon = np.degrees(np.arctan2(points[:, 1], points[:, 0]))
    scale = (2 ** zoom) * TILE_PX
    px = (lon + 180.0) / 360.0 * scale
    py = (1.0 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2.0 * scale
    return np.column_stack([px, py])


def linear_crossings(
    mosaic: Mosaic, start: tuple, end: tuple, palette=LINEAR_PALETTE, course_px=None
) -> list:
    """Where the course crosses linear chart features, as Landmarks.

    A blob centroid is the wrong answer for anything linear. The centroid
    of a river that wanders across a whole mosaic is a point in a field
    somewhere; what a pilot uses is the place the course actually cuts
    it. This is the raster equivalent of vfr.osm.find_line_crossings, and
    the same reasoning: for a linear feature the checkpoint *is* the
    intersection.

    Found by walking the course in pixel space and testing the mask
    under it, rather than by labelling components and intersecting
    geometry -- the course is one line, so walking it is O(length) and
    needs no component analysis at all.
    """
    channels = mosaic.pixels.astype(np.int16)
    r, g, b = channels[:, :, 0], channels[:, :, 1], channels[:, :, 2]
    height, width = mosaic.pixels.shape[:2]
    if course_px is None:
        course_px = great_circle_pixels(start, end, mosaic.zoom)
    if len(course_px) < 2:
        return []

    local = course_px - np.array(mosaic.origin_px)

    centre_lat, _ = mosaic.to_latlon(width / 2, height / 2)
    m_per_px = metres_per_pixel(centre_lat, mosaic.zoom)

    found = []
    for spec in palette:
        mask = spec.test(r, g, b)
        hits = []
        for step, (px, py) in enumerate(local):
            ix, iy = int(round(px)), int(round(py))
            if not (0 <= ix < width and 0 <= iy < height):
                continue
            lo_y, hi_y = max(0, iy - CROSSING_TOLERANCE_PX), min(height, iy + CROSSING_TOLERANCE_PX + 1)
            lo_x, hi_x = max(0, ix - CROSSING_TOLERANCE_PX), min(width, ix + CROSSING_TOLERANCE_PX + 1)
            window = mask[lo_y:hi_y, lo_x:hi_x]
            if window.any():
                hits.append((step, ix, iy, int(window.sum())))

        # Collapse runs of consecutive hits into one crossing each.
        for group in _group_hits(hits):
            mid = group[len(group) // 2]
            lat, lon = mosaic.to_latlon(mid[1], mid[2])
            weight = sum(h[3] for h in group)
            if weight < spec.min_area_px:
                continue
            found.append(
                Landmark(
                    category=spec.name,
                    lat=lat,
                    lon=lon,
                    # A crossing has no area; the linework under it stands
                    # in for how prominent the feature is on the chart.
                    area_m2=float(weight) * m_per_px ** 2,
                    score=spec.base_score,
                    pixels=weight,
                    extras={"crossing": True, "width_px": len(group)},
                )
            )
    return found


def _group_hits(hits: list, separation: int = CROSSING_SEPARATION_PX) -> list:
    """Split hits along the course into separate crossings."""
    groups, current = [], []
    for hit in hits:
        if current and hit[0] - current[-1][0] > separation:
            groups.append(current)
            current = []
        current.append(hit)
    if current:
        groups.append(current)
    return groups


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

    # Once for the whole route, not once per block: the path is the same
    # for every block and building it 40 times was pure waste.
    course_px = great_circle_pixels(start, end, zoom)

    found, stats = [], {"missing": 0, "fetched": 0, "cached": 0}
    for block in tile_blocks(tiles):
        mosaic = build_mosaic(block, zoom)
        stats["missing"] += mosaic.missing_tiles
        stats["fetched"] += mosaic.fetched_tiles
        stats["cached"] += mosaic.cached_tiles
        block_landmarks = detect_landmarks(mosaic) + linear_crossings(
            mosaic, start, end, course_px=course_px
        )
        for landmark in block_landmarks:
            cross = cross_track_distance_nm(landmark.lat, landmark.lon, start, end)
            along = along_track_distance_nm(landmark.lat, landmark.lon, start, end)
            if abs(cross) > half_width_nm or not (-margin_nm <= along <= route_nm + margin_nm):
                continue
            landmark.extras.update({"cross_track_nm": cross, "along_track_nm": along})
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

# Order matters: the tests are not mutually exclusive and the first match
# wins. Airport magenta and river dark-blue are both dark enough to also
# satisfy the near-black linework test, so both are checked before it --
# the specific answer beats the generic one.
CLASSIFY_ORDER = ("river", "water", "town", "road_or_rail")

# Half-width of the window sampled around a point, in pixels. Nobody
# clicks the exact centre of a two-pixel-wide river line.
CLASSIFY_WINDOW_PX = 4


def classify_point(lat: float, lon: float, zoom: int = DEFAULT_ZOOM) -> dict:
    """What the chart draws at one point.

    Exists because a person marking a checkpoint should not also have to
    tell the system what kind of thing it is. The chart already says, and
    asking twice is how 34 hand-picked points came to be recorded as
    "water" when most of them sat on roads -- the category came from a
    dropdown default rather than from the pixels.

    Returns the matching class and the pixel that matched, or class None
    if the point is on open chart background.
    """
    px, py = latlon_to_global_px(lat, lon, zoom)
    tile = fetch_tile(int(px // TILE_PX), int(py // TILE_PX), zoom)
    if tile is None:
        return {"category": None, "reason": "no chart coverage here"}

    pixels = np.asarray(tile).astype(np.int16)
    ix, iy = int(px) % TILE_PX, int(py) % TILE_PX
    lo_y, hi_y = max(0, iy - CLASSIFY_WINDOW_PX), min(TILE_PX, iy + CLASSIFY_WINDOW_PX + 1)
    lo_x, hi_x = max(0, ix - CLASSIFY_WINDOW_PX), min(TILE_PX, ix + CLASSIFY_WINDOW_PX + 1)
    window = pixels[lo_y:hi_y, lo_x:hi_x].reshape(-1, 3)
    r, g, b = window[:, 0], window[:, 1], window[:, 2]

    # Whichever class covers the most of the window, not whichever is
    # tested first. Order alone was wrong at the edge of a lake: a lake is
    # outlined in the same dark blue a river is drawn in, so three
    # shoreline pixels made Nepco Lake classify as "river" while dozens of
    # water-fill pixels sat under the same click.
    tests = {spec.name: spec.test for spec in PALETTE + LINEAR_PALETTE}
    scores = {}
    for name in CLASSIFY_ORDER:
        mask = tests[name](r, g, b)
        if mask.any():
            scores[name] = (int(mask.sum()), window[mask][0])
    if not scores:
        return {"category": None, "reason": "chart background -- nothing drawn here"}

    # Ties break by CLASSIFY_ORDER, which runs specific before generic.
    best = max(scores, key=lambda n: (scores[n][0], -CLASSIFY_ORDER.index(n)))
    count, matched = scores[best]
    return {
        "category": best,
        "rgb": [int(v) for v in matched],
        "matched_pixels": count,
        "considered": {n: scores[n][0] for n in scores},
    }
