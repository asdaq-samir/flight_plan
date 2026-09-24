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
PALETTE). Classification is by tolerant colour relationships rather
than exact match: the tiles used to arrive JPEG-compressed from a
hosted map service, and the same tests carried over unchanged when the
source became the FAA's own palette rasters (vfr.charts).

What this does NOT do is name anything. A detected blue blob is a usable
checkpoint before anyone knows it is called Nepco Lake; names are a
cross-check to run afterwards against OSM/FAA, not something to block a
pilot on.
"""
from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import numpy as np
from PIL import Image

from . import charts
from .config import VFR_SECTIONAL_MAX_ZOOM
from .geo import along_track_distance_nm, cross_track_distance_nm, distance_nm

TILE_PX = 256
DEFAULT_ZOOM = VFR_SECTIONAL_MAX_ZOOM  # 12; the chart's own maximum

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
    # For linear classes: how far the feature must run before it counts
    # as a line rather than a glyph. Only meaningful where the class can
    # pick up chart text -- see MIN_LINE_EXTENT_PX.
    min_extent_px: int = 0
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

# Two crossing pixels further apart than this along the course are
# separate crossings. A river meanders and can cut the course several
# times within a mile, but below this they are one checkpoint.
CROSSING_SEPARATION_PX = 24

# How far the feature under a crossing must extend before it counts as a
# line at all, measured as the longer side of its connected component's
# bounding box. 60 px at zoom 12 is a bit over 2 km.
#
# This is what separates a road from a letter. Chart text is drawn in the
# same near-black ink as roads, so "Nepco Lake" and every airport name
# matched the linework test and produced crossings on bare grass wherever
# a label happened to sit near the course. Measured over one tile block:
# the median dark-line component is 1 px across and the 99th percentile
# is 31 px, while genuine roads and rivers are the handful that run for
# hundreds. Requiring real extent keeps those and discards the text,
# without needing to recognise text as such.
MIN_LINE_EXTENT_PX = 60

# A landmark abeam has to be bigger to be usable than the same landmark
# underneath you. Apparent size falls off with distance, so the area
# required grows with the square of how far off course it sits: a pond
# 290 m across is a fine checkpoint overhead and invisible at four miles.
#
# This is the answer to "why are there 400 candidates". The corridor was
# widened from 1 nm to 4 nm half-width to admit visual references, which
# multiplied the searched area four-fold -- 8,900 km2 on one route -- and
# nearly all of the extra was small water. Median blob was 0.084 km2 with
# only 24 of 209 above 1 km2. The area is not wrong; requiring the same
# minimum size across all of it was.
ON_COURSE_NM = 1.0

# An obstacle is drawn as a small inverted V, in the same near-black ink,
# and is a hazard to avoid rather than a checkpoint to look for. The
# extent test removes it for the same reason it removes text: the glyph
# is a dozen pixels across and goes nowhere.


LINEAR_PALETTE = (
    # No extent test on rivers. Chart text is near-black ink and is never
    # dark blue, so the river class cannot pick up a label in the first
    # place -- and requiring extent here cost real river crossings a
    # pilot had marked by hand, dropping recall from 65% to 47% while
    # removing nothing that was wrong.
    PaletteClass("river", _river_line, min_area_px=12, base_score=4.3),
    PaletteClass(
        "road_or_rail", _dark_line, min_area_px=12,
        min_extent_px=MIN_LINE_EXTENT_PX, base_score=3.6,
    ),
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


def fetch_tile(x: int, y: int, zoom: int = DEFAULT_ZOOM) -> Image.Image | None:
    """One sectional tile as RGB, rendered from the FAA's own raster by
    vfr.charts (and cached there on disk, so a second route through the
    same area reads it back instantly). None where no chart covers the
    tile -- open water, Canada -- so one missing tile leaves a hole in
    the mosaic rather than failing the whole read.

    The same tiles back the map's own tile endpoint (planning-service's
    /api/sectional-tile): a corridor planned once has its map tiles
    ready, and a map browsed once has its detection tiles ready. The
    transparency of an uncovered corner is white here, since the
    detector's road-and-rail class looks for black.
    """
    return charts.tile_image(x, y, zoom, kind="sec")


@dataclass
class Mosaic:
    """A stitched block of chart tiles plus where it sits in the world."""

    pixels: np.ndarray  # (h, w, 3) uint8
    origin_px: tuple    # global pixel coords of the top-left corner
    zoom: int
    #: True where a tile was actually pasted. A tile the FAA publishes
    #: no sheet for -- open water, Canada, the gap either side of an
    #: Alaska route -- leaves its block of the canvas at the zeros it
    #: was allocated with, and (0, 0, 0) is not "no data" to a colour
    #: test: it is black, which is exactly what _dark_line looks for.
    #: Every missing tile was therefore being read as a solid block of
    #: road and railway linework, and a course crossing one came back
    #: with a string of road_or_rail crossings on chart that does not
    #: exist. 75 of 463 detections on one Alaska-to-Duluth route.
    covered: np.ndarray | None = None
    missing_tiles: int = 0
    fetched_tiles: int = 0
    cached_tiles: int = 0

    def to_latlon(self, cx: float, cy: float) -> tuple:
        return global_px_to_latlon(self.origin_px[0] + cx, self.origin_px[1] + cy, self.zoom)

    def on_chart(self, mask: np.ndarray) -> np.ndarray:
        """`mask` with everything off the published chart removed. Every
        palette test goes through this, so a new one cannot forget."""
        return mask if self.covered is None else mask & self.covered


def build_mosaic(tiles: list, zoom: int = DEFAULT_ZOOM, max_workers: int = 8) -> Mosaic:
    """Render and stitch `tiles` into one array.

    The charts the block needs are downloaded first, once, on this
    thread -- a 70 MB sectional the first time a corridor crosses it,
    nothing after -- and only then are the tiles rendered, in parallel:
    the warp itself releases the GIL, so a handful of workers keeps a
    block to a few seconds. (Back when the tiles came from a hosted map
    service this ran 48 workers, because the work was all round trip.)

    The disk cache matters as much: the second plan through the same
    corridor renders nothing at all.
    """
    xs = [x for x, _ in tiles]
    ys = [y for _, y in tiles]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    width, height = (x1 - x0 + 1) * TILE_PX, (y1 - y0 + 1) * TILE_PX
    canvas = np.zeros((height, width, 3), dtype=np.uint8)
    covered = np.zeros((height, width), dtype=bool)

    west, south, _, _ = charts.tile_bbox_wgs84(x0, y1, zoom)
    _, _, east, north = charts.tile_bbox_wgs84(x1, y0, zoom)
    charts.prepare_for_bbox((west, south, east, north), kinds=("sec",))

    cached = sum(1 for x, y in tiles if charts.tile_cached(x, y, zoom, "sec"))
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        results = pool.map(lambda t: (t, fetch_tile(t[0], t[1], zoom)), tiles)
        missing = 0
        for (x, y), image in results:
            if image is None:
                missing += 1
                continue
            px, py = (x - x0) * TILE_PX, (y - y0) * TILE_PX
            canvas[py:py + TILE_PX, px:px + TILE_PX] = np.asarray(image)
            covered[py:py + TILE_PX, px:px + TILE_PX] = True

    return Mosaic(
        pixels=canvas,
        origin_px=(x0 * TILE_PX, y0 * TILE_PX),
        zoom=zoom,
        covered=covered,
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
        mask = mosaic.on_chart(spec.test(r, g, b))
        labelled, count = ndimage.label(mask)
        if count == 0:
            continue
        # np.bincount over the label image rather than ndimage.sum: the
        # same per-component pixel counts, and the single most expensive
        # step in blob detection before this (18 ms a block against 6-9
        # for everything else).
        sizes = np.bincount(labelled.ravel(), minlength=count + 1)[1:]
        keep = [
            i + 1 for i, size in enumerate(sizes)
            if size >= spec.min_area_px
            and (spec.max_area_px is None or size <= spec.max_area_px)
        ]
        if not keep:
            continue

        # A point guaranteed to lie inside each blob, rather than its
        # centre of mass. A centroid need not be inside its own shape: a
        # crescent lake, a river bend or a ring of linework all put it
        # outside, on bare chart. This is the raster form of shapely's
        # representative_point -- the same fix vfr.osm needed for the
        # same reason.
        #
        # Done per blob inside its own bounding box. Running a distance
        # transform over the whole block was correct but was most of why
        # reading a route took 25 seconds with every tile already cached:
        # it is a global operation repeated per palette class per block,
        # to answer a question about a few hundred small shapes.
        boxes = ndimage.find_objects(labelled)
        positions = [_interior_point(labelled, boxes[label - 1], label) for label in keep]
        for label, (cy, cx) in zip(keep, positions):
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


def _has_chart(block: list, zoom: int) -> bool:
    """Whether any sectional sheet reaches this block at all.

    Asked before a block is read rather than after. A corridor is a
    rectangle of tiles and a long one can cross hundreds of miles the
    FAA publishes no sheet for -- the Pacific, Canada, the gap either
    side of an Alaska route. Those blocks used to be fetched tile by
    tile (every one a 404), stitched into an all-zero canvas, and run
    through the whole palette segmentation to find nothing, while the
    progress line counted them as work. Now they are not in the list,
    so the percentage measures chart actually read.

    Tested against each sheet's own envelope, which includes the
    printed collar and is therefore a superset of the chart face. That
    is the safe direction for skipping: no overlap with the envelope
    means there is certainly no chart, while a block that overlaps only
    the collar is still read and simply finds nothing.
    """
    xs = [x for x, _ in block]
    ys = [y for _, y in block]
    west, south, _, _ = charts.tile_bbox_wgs84(min(xs), max(ys), zoom)
    _, _, east, north = charts.tile_bbox_wgs84(max(xs), min(ys), zoom)
    return any(
        west < sheet_east and sheet_west < east and south < sheet_north and sheet_south < north
        for _, (sheet_west, sheet_south, sheet_east, sheet_north) in charts.sheets(charts.SECTIONAL)
    )


def tile_blocks(tiles: list, max_span: int = MAX_BLOCK_TILES) -> list:
    """Split a corridor's tiles into small dense rectangles to stitch.

    A route corridor is a thin diagonal ribbon, and the bounding box of a
    long one is almost entirely empty. Stitching it as a single mosaic
    allocated that whole rectangle: a 323 nm route spans roughly 62 by 55
    tiles, which is 668 MB of canvas to hold about 191 tiles of actual
    chart, and it made a fully cached run take 39 s.

    Blocks advance along the corridor in columns and take every tile in
    that column range, which suits a shape that is long in one direction
    and a few tiles thick in the other. One column of overlap so a lake
    on a seam is seen whole by one block; _dedupe drops the double
    sighting.

    The first version grouped by a square window in both axes and marked
    only an inner core as consumed, which re-stitched 369 tiles to cover
    198 -- 1.86x redundancy on a corridor barely three tiles thick.
    """
    if not tiles:
        return []
    by_x = {}
    for x, y in tiles:
        by_x.setdefault(x, []).append(y)

    columns = sorted(by_x)
    blocks, start = [], 0
    stride = max(1, max_span - 1)
    while start < len(columns):
        window = columns[start:start + max_span]
        block = [(x, y) for x in window for y in by_x[x]]
        if block:
            blocks.append(block)
        if start + max_span >= len(columns):
            break
        start += stride
    return blocks


def _dedupe(landmarks: list, within_nm: float = DEDUPE_NM) -> list:
    """Drop repeat sightings of one feature from overlapping blocks,
    keeping the largest -- that is the block that saw more of it."""
    kept = []
    for landmark in sorted(landmarks, key=lambda candidate: -candidate.area_m2):
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
    # Only the stretch of course that actually crosses this block. Every
    # block used to walk the whole route -- 16,000 points per palette
    # class per block, about 900,000 Python iterations to examine 29 small
    # images, which was the entire reason reading a route took 30 seconds
    # when the tiles were already cached and fetching them took 0.05 s.
    inside = (
        (local[:, 0] >= 0) & (local[:, 0] < mosaic.pixels.shape[1])
        & (local[:, 1] >= 0) & (local[:, 1] < mosaic.pixels.shape[0])
    )
    indices = np.nonzero(inside)[0]
    if not len(indices):
        return []

    centre_lat, _ = mosaic.to_latlon(width / 2, height / 2)
    m_per_px = metres_per_pixel(centre_lat, mosaic.zoom)

    from scipy import ndimage

    found = []
    for spec in palette:
        mask = mosaic.on_chart(spec.test(r, g, b))
        # Component labels are needed to ask how far the thing under a
        # crossing actually extends -- see MIN_LINE_EXTENT_PX.
        if spec.min_extent_px:
            labelled, _count = ndimage.label(mask)
            extents = _component_extents(labelled)
        else:
            labelled, extents = None, {}
        # Sampled per course point rather than by filtering the whole
        # block. Precomputing proximity with a uniform_filter was tried
        # and was twice as slow: the course touches a couple of thousand
        # pixels of a block that holds millions, so answering the question
        # everywhere costs far more than asking it where it matters.
        hits = []
        for step in indices:
            ix, iy = int(round(local[step][0])), int(round(local[step][1]))
            lo_y, hi_y = max(0, iy - CROSSING_TOLERANCE_PX), min(height, iy + CROSSING_TOLERANCE_PX + 1)
            lo_x, hi_x = max(0, ix - CROSSING_TOLERANCE_PX), min(width, ix + CROSSING_TOLERANCE_PX + 1)
            window = mask[lo_y:hi_y, lo_x:hi_x]
            if window.any():
                hits.append((step, ix, iy, int(window.sum())))

        # Collapse runs of consecutive hits into one crossing each.
        for group in _group_hits(hits):
            mid = group[len(group) // 2]
            # The course point is where the line passes, which is up to
            # CROSSING_TOLERANCE_PX away from the linework it crossed.
            # Snap onto an actual pixel of the feature so the marker sits
            # on the river, not beside it.
            snapped = _nearest_mask_pixel(mask, mid[1], mid[2], CROSSING_TOLERANCE_PX)
            if snapped is None:
                continue
            if spec.min_extent_px:
                component = labelled[snapped[1], snapped[0]]
                if extents.get(int(component), 0) < spec.min_extent_px:
                    continue  # a letter, an obstacle glyph or speckle -- not a line
            lat, lon = mosaic.to_latlon(snapped[0], snapped[1])
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


def _interior_point(labelled, box, label: int) -> tuple:
    """A (row, col) inside this component, near its middle.

    Takes the component's own pixels within its bounding box and picks
    the one closest to the box centre, which is inside by construction
    and close enough to the middle to read as "where the feature is".
    """
    ys, xs = np.nonzero(labelled[box] == label)
    cy = (ys.min() + ys.max()) / 2.0
    cx = (xs.min() + xs.max()) / 2.0
    nearest = np.argmin((xs - cx) ** 2 + (ys - cy) ** 2)
    return ys[nearest] + box[0].start, xs[nearest] + box[1].start


def _component_extents(labelled) -> dict:
    """Longest bounding-box side of each labelled component, in pixels."""
    from scipy import ndimage

    extents = {}
    for index, slices in enumerate(ndimage.find_objects(labelled), start=1):
        if slices is None:
            continue
        height = slices[0].stop - slices[0].start
        width = slices[1].stop - slices[1].start
        extents[index] = max(height, width)
    return extents


def _nearest_mask_pixel(mask, cx: int, cy: int, radius: int):
    """The (x, y) of the mask pixel nearest (cx, cy), or None.

    Used to put a crossing marker on the feature rather than on the
    course line beside it -- the two are up to `radius` apart by
    construction, which on bare chart is the difference between a marker
    on a river and a marker on grass.
    """
    height, width = mask.shape
    lo_y, hi_y = max(0, cy - radius), min(height, cy + radius + 1)
    lo_x, hi_x = max(0, cx - radius), min(width, cx + radius + 1)
    window = mask[lo_y:hi_y, lo_x:hi_x]
    if not window.any():
        return None
    ys, xs = np.nonzero(window)
    ys, xs = ys + lo_y, xs + lo_x
    nearest = np.argmin((xs - cx) ** 2 + (ys - cy) ** 2)
    return int(xs[nearest]), int(ys[nearest])


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


def iter_landmarks_along_route(
    start: tuple,
    end: tuple,
    half_width_nm: float = 1.0,
    zoom: int = DEFAULT_ZOOM,
    margin_nm: float = 5.0,
):
    """Everything the chart draws inside the route corridor, a block at a
    time.

    The whole fast path: pick tiles, fetch them (cached), segment, keep
    what falls inside the corridor. No Overpass, no FAA subscription, no
    elevation service.

    Yielded rather than returned because there is no reason to hold the
    whole corridor back. Blocks advance along the course, so the first one
    covers the departure end and is ready in a fraction of a second while
    a 323 nm route takes a few seconds in total -- a caller can put
    checkpoints on the map and let someone start work on them while the
    rest is still being read.
    """
    tiles = corridor_tiles(start, end, half_width_nm + 1.0, zoom)
    route_nm = distance_nm(start[0], start[1], end[0], end[1])

    # Once for the whole route, not once per block: the path is the same
    # for every block and building it 40 times was pure waste.
    course_px = great_circle_pixels(start, end, zoom)

    def big_enough_to_see(landmark, cross_nm: float) -> bool:
        """Whether a blob is large enough to pick out from this far off
        course. Crossings are exempt: they are on the course by
        construction, and a river is identified by where it cuts the
        line rather than by its area."""
        if landmark.extras.get("crossing") or landmark.area_m2 <= 0:
            return True
        spec = next((s for s in PALETTE if s.name == landmark.category), None)
        if spec is None:
            return True
        offset = max(1.0, abs(cross_nm) / ON_COURSE_NM)
        m_per_px = metres_per_pixel(landmark.lat, zoom)
        return landmark.area_m2 >= spec.min_area_px * m_per_px ** 2 * offset ** 2

    # Ordered by how far along the route each block sits, so a caller
    # streaming these fills the map from the departure end. tile_blocks
    # advances in ascending tile-x, which is the direction of flight only
    # for an eastbound route -- C81->KDLH runs west, so the departure had
    # the highest x and the whole corridor arrived back to front: the
    # first candidates on screen were the ones 320 nm away.
    def block_along_track(block) -> float:
        xs = [x for x, _ in block]
        ys = [y for _, y in block]
        centre_x = (min(xs) + max(xs) + 1) / 2 * TILE_PX
        centre_y = (min(ys) + max(ys) + 1) / 2 * TILE_PX
        lat, lon = global_px_to_latlon(centre_x, centre_y, zoom)
        return along_track_distance_nm(lat, lon, start, end)

    blocks = [b for b in sorted(tile_blocks(tiles), key=block_along_track) if _has_chart(b, zoom)]
    for index, block in enumerate(blocks):
        mosaic = build_mosaic(block, zoom)
        block_landmarks = detect_landmarks(mosaic) + linear_crossings(
            mosaic, start, end, course_px=course_px
        )
        kept = []
        for landmark in block_landmarks:
            cross = cross_track_distance_nm(landmark.lat, landmark.lon, start, end)
            along = along_track_distance_nm(landmark.lat, landmark.lon, start, end)
            if abs(cross) > half_width_nm or not (-margin_nm <= along <= route_nm + margin_nm):
                continue
            if not big_enough_to_see(landmark, cross):
                continue
            landmark.extras.update({"cross_track_nm": cross, "along_track_nm": along})
            kept.append(landmark)

        yield {
            "landmarks": _dedupe(kept),
            "block": index,
            "blocks": len(blocks),
            "tiles": len(tiles),
            "missing": mosaic.missing_tiles,
            "fetched": mosaic.fetched_tiles,
            "cached": mosaic.cached_tiles,
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
