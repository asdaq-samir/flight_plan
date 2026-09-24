"""Finding a chart's face on its raster, and cleaning the raster up:
where the printed sheet's collar ends and the chart begins (detect_face,
and split_antimeridian for a sheet that crosses 180), and the lines the
FAA's own masking left across the chart (find_masked_lines,
remove_masked_lines).

Split out of vfr.charts, which keeps the catalogue, the chart cycles,
rendering, publishing and serving. This is the part that changes on its
own: every chart commit between 2026-09-23's two simplicity assessments
was raster cleaning or edge detection, and none touched anything else
in the module. vfr.charts calls in here while preparing a sheet, and
while warping a tile (read_rgb, without_raster_rim); this calls back into vfr.charts for the chart
kinds and sheets, through the module rather than its names, so either
can be imported first.
"""
from __future__ import annotations

import logging
import math
import os
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np

from . import charts

if TYPE_CHECKING:
    from .charts import Box, ChartKind

log = logging.getLogger(__name__)

# One degree of latitude, in metres, on the sphere web mercator uses.
_METRES_PER_DEGREE = 111_320.0

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
    # A sheet across the antimeridian is worked in unwrapped longitudes
    # (east of 180 counted on past it) and samples are wrapped back
    # before they are projected.
    wrap: bool = False


def _palette(src) -> np.ndarray | None:
    """The colormap as a (256, 3) RGB lookup -- None for a raster that
    carries its colours as three bands (the IFR enroute charts)."""
    if src.count >= 3:
        return None
    cmap = src.colormap(1)
    return np.array([cmap.get(i, (0, 0, 0, 255))[:3] for i in range(256)], dtype=np.uint8)


def read_rgb(src, window=None, out_shape=None) -> np.ndarray:
    """A window of the raster as (rows, cols, 3) RGB, whichever way the
    file stores its colours. vfr.charts reads a tile's warp through this
    too."""
    lut = _palette(src)
    if lut is None:
        shape = None if out_shape is None else (3, *out_shape)
        return np.moveaxis(src.read([1, 2, 3], window=window, out_shape=shape), 0, -1)
    return lut[src.read(1, window=window, out_shape=out_shape)]


def _ink_maps(src) -> _Ink:
    pool = _POOL_PX
    rows, cols = src.height // pool, src.width // pool
    dark = np.zeros((rows, cols), dtype=bool)
    white = np.zeros((rows, cols), dtype=np.float32)
    tint = np.zeros((rows, cols), dtype=np.float32)
    step = 1024
    for r0 in range(0, rows * pool, step):
        r1 = min(r0 + step, rows * pool)
        rgb = read_rgb(src, window=((r0, r1), (0, cols * pool))).astype(np.int16)
        is_dark = rgb.sum(axis=2) < _DARK_MAX_RGB_SUM
        is_white = rgb.min(axis=2) >= _WHITE_MIN_CHANNEL
        shape = ((r1 - r0) // pool, pool, cols, pool)
        dark[r0 // pool:r1 // pool] = is_dark.reshape(shape).any(axis=(1, 3))
        white[r0 // pool:r1 // pool] = is_white.reshape(shape).mean(axis=(1, 3))
        tint[r0 // pool:r1 // pool] = (~is_dark & ~is_white).reshape(shape).mean(axis=(1, 3))
    return _Ink(crs=src.crs, transform=src.transform, dark=dark, white=white, tint=tint)


def _sample(ink: _Ink, lats: np.ndarray, lons: np.ndarray) -> tuple:
    """(dark, white, tint, inside) at each (lat, lon): outside the
    raster counts as paper."""
    import rasterio.transform
    import rasterio.warp

    if ink.wrap:
        lons = ((lons + 180.0) % 360.0) - 180.0
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


def split_antimeridian(face: Box, envelope: Box) -> list:
    """A face measured in unwrapped longitudes (east past 180, see
    detect_face) as the one or two (face, envelope) pairs the tile
    arithmetic can draw: the part up to 180, and the part from -180 on."""
    if face[2] <= 180.0:
        return [(face, envelope)]
    west, south, east, north = face
    e_west, e_south, e_east, e_north = envelope
    return [
        ((west, south, 180.0, north), (e_west, e_south, 180.0, e_north)),
        ((-180.0, south, east - 360.0, north), (-180.0, e_south, e_east - 360.0, e_north)),
    ]


# A straight raster line counts as ruling when this much of it is ink
# over the middle three-fifths of the sheet; the chart area is the
# widest stretch of the sheet between two such lines (or the sheet's
# edge), since the legend panels are ruled tables and the chart is not.
_STRAIGHT_CONTINUITY = 0.9


def _widest_gap(continuity: np.ndarray) -> tuple:
    """(start, end) in pooled units of the widest interval between
    consecutive ruling lines, the raster's edges counting as lines,
    with each line taken whole: a line thicker than a pooled block, or
    astride two, is ruled in every block it touches, and the interval
    runs to the far side of both."""
    ruled = continuity >= _STRAIGHT_CONTINUITY
    edges = [0, *np.flatnonzero(ruled).tolist(), len(continuity)]
    best = (edges[0], edges[1])
    for a, b in zip(edges, edges[1:]):
        if b - a > best[1] - best[0]:
            best = (a, b)
    start, end = best
    while start > 0 and ruled[start - 1]:
        start -= 1
    while end + 1 < len(continuity) and ruled[end + 1]:
        end += 1
    return start, end


def _straight_face(ink: _Ink, crs, transform, mask_path: Path) -> Box:
    """The chart area of a sheet whose border is the sheet's own
    rectangle: written to `mask_path` as a small raster (255 inside
    the rectangle, 0 outside, one pixel per pooled block) that the
    renderer warps alongside the sheet, and returned as the lat/lon box
    around the rectangle's whole outline. A conic sheet leans and bows
    in lat/lon, so the box takes in collar at the corners; the mask is
    what keeps that from being drawn.

    The ruling lines themselves are inside the mask, whole. Two
    adjacent sheets are cut on the same line (to within a pixel or
    two), so with the lines left out their masks stood a line's width
    apart and every seam was a hairline of map background; with them
    in, the masks overlap by that width."""
    import rasterio
    import rasterio.warp
    from rasterio.transform import Affine

    rows, cols = ink.dark.shape
    col_continuity = ink.dark[int(rows * 0.2):int(rows * 0.8), :].mean(axis=0)
    row_continuity = ink.dark[:, int(cols * 0.2):int(cols * 0.8)].mean(axis=1)
    c0, c1 = _widest_gap(col_continuity)
    r0, r1 = _widest_gap(row_continuity)

    r_lo, r_hi = r0, min(r1 + 1, rows)   # pooled rows [r_lo, r_hi): the chart and its ruling lines
    c_lo, c_hi = c0, min(c1 + 1, cols)
    inside = np.zeros((rows, cols), dtype=np.uint8)
    inside[r_lo:r_hi, c_lo:c_hi] = 255
    with rasterio.open(
        mask_path, "w", driver="GTiff", width=cols, height=rows, count=1, dtype="uint8",
        crs=crs, transform=transform @ Affine.scale(_POOL_PX), compress="deflate",
    ) as out:
        out.write(inside, 1)

    x0, x1 = c_lo * _POOL_PX, c_hi * _POOL_PX
    y0, y1 = r_lo * _POOL_PX, r_hi * _POOL_PX
    # The rectangle's sides are straight on the sheet and arcs in
    # latitude and longitude: a parallel bows toward the pole between
    # two points on it, so the top side is furthest north in its
    # middle, not at either corner (on a sheet twenty degrees wide, by
    # a third of a degree). A box around the corners alone left that
    # bow to nobody: a strip of map background under the neighbour's
    # neatline. So the box is around the whole outline.
    along = np.linspace(0.0, 1.0, 256)
    xs = np.concatenate([x0 + along * (x1 - x0), x0 + along * (x1 - x0), np.full_like(along, x0), np.full_like(along, x1)])
    ys = np.concatenate([np.full_like(along, y0), np.full_like(along, y1), y0 + along * (y1 - y0), y0 + along * (y1 - y0)])
    px, py = transform @ (xs, ys)
    lons, lats = rasterio.warp.transform(crs, "EPSG:4326", list(px), list(py))
    return (min(lons), min(lats), max(lons), max(lats))


def detect_face(path: Path, kind: ChartKind) -> tuple[Box, Box, Path | None]:
    """(envelope, face, mask) of a chart raster: the raster's own
    bounds and the chart within them with the collar cut away, both
    (west, south, east, north) degrees, and for a sheet with a straight
    border the mask raster that cuts the collar out of the face's
    corners (None otherwise). An edge that yields nothing falls back to
    the kind's typical collar width, and says so in the log."""
    import rasterio
    import rasterio.warp

    with rasterio.open(path) as src:
        ink = _ink_maps(src)
        envelope = tuple(float(v) for v in rasterio.warp.transform_bounds(src.crs, "EPSG:4326", *src.bounds))
        if envelope[0] > envelope[2]:
            # Across the antimeridian (the western Aleutians): carry on
            # past 180 so that west is west of east, and wrap samples
            # back on their way to the raster. The face comes back the
            # same way; split_antimeridian cuts it in two for drawing.
            envelope = (envelope[0], envelope[1], envelope[2] + 360.0, envelope[3])
            ink.wrap = True
        res_m = float(src.res[0])
        if kind.straight_border:
            mask_path = path.with_name(f"{path.stem}.mask.tif")
            face = _straight_face(ink, src.crs, src.transform, mask_path)
            log.info("%s: face %s (straight border)", path.name, tuple(round(v, 4) for v in face))
            return envelope, face, mask_path

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
        # By key, not identity: `python -m vfr.charts` (the refresh, the
        # pyramid) runs vfr.charts as __main__, so its SECTIONAL is not the
        # one this module sees through its import of vfr.charts.
        if how == "neatline" and kind.key == charts.SECTIONAL.key:
            position = _snap(position)
        log.info("%s: %s edge at %.4f (%s)", path.name, edge, position, how)
        face.append(position)
    return envelope, tuple(face), None


# ---------------------------------------------------------------------------
# The masked line, taken back out of the sectional
# ---------------------------------------------------------------------------
#
# A sectional marks where a terminal area chart takes over -- and where
# one of its own insets does -- with a "masked line": a band a few
# millimetres wide on the paper sheet (thirty-odd pixels of raster, a
# kilometre and a half of ground) along the other chart's boundary,
# where the terrain tint is knocked out to bare paper and "TAC" or
# "INSET" is lettered at intervals. Everything crossing it -- roads,
# rivers, obstructions, airways -- is still printed over it. On paper
# it points at another sheet. On this map, which draws that sheet
# itself when asked (the TAC layer), it was a white box around every
# Class B whether the TAC was drawn or not, and read as a seam.
#
# `remove_masked_lines` finds the bands and puts the tint back under
# them. Only paper changes: each paper pixel of a band takes the tint
# of the nearest chart just outside it. Ink is left exactly as printed,
# the lettering included -- it is the same blue as real symbols, and a
# filter that told "TAC" from an obstruction height lying in the band
# would have to be trusted not to delete the obstruction.
#
# A band is searched for as paper that runs straight for kilometres
# with chart either side, and then measured across at full resolution
# before anything is touched. The white label boxes ("CTC MEMPHIS APP
# WITHIN 20 NM") are straight and even too, but have a border inside
# them and are only a few times longer than they are wide; dry lakes,
# salt flats, beaches and the white of a neighbouring country have
# ragged edges and no steady width. A sheet with no TAC and no inset
# finds nothing.

_BAND_BLOCK = 4              # searched at a quarter of the raster's resolution
_BAND_RUN = 61               # blocks a band stays paper along (about 10 km)
_BAND_SIDE = 14              # blocks either side of it that must be chart, not paper
_BAND_MIN_BLOCKS = 100       # blocks (about 17 km) a band runs at the least
_BAND_BRIDGE = 41            # blocks of lettering or crossing linework a band is joined across
_BAND_PAPER_IN, _BAND_PAPER_OUT = 0.55, 0.25
# Measured across every this many pixels, a band is a strip of paper
# of steady width, whose edges lie on smooth lines for most of its
# length, mostly paper inside. Its width depends on the sheet (about 40
# pixels round a TAC, 100 round the Alaska insets); a label box is as
# wide as that but only a few times longer, with a border inside it.
_BAND_STEP_PX = 24
_BAND_CHART_RUN_PX = 10   # not-paper this long across is the chart resuming, not a line over the band
_BAND_WIDTH_PX = (18, 120)
_BAND_WIDTH_SPREAD_PX = 4
_BAND_MIN_ON_EDGE = 0.3
_BAND_MAX_EDGE_WOBBLE_PX = 2.5   # the scan's pale edge colours jitter it a pixel or two
_BAND_MIN_PAPER = 0.4
_BAND_BOX_ASPECT = 10
_BAND_BOX_BORDERED = 0.25
_BAND_MIN_SECTIONS = 8
_BAND_MIN_SECTION_SHARE = 0.3
# A candidate that runs on from a band already measured -- the fourth
# side of a box whose other three are, the rest of a side a crossing
# broke -- has that for evidence, and is measured again more loosely:
# busy stretches of chart leave fewer clean cuts across a band.
_BAND_NEIGHBOUR_BLOCKS = 30   # past the corner square of the widest bands (100 px, round the Alaska insets)
_BAND_LOOSE = {"wobble": 5.0, "on_edge": 0.15, "spread": 12, "paper": 0.3}
# ... and, beside a band, a run need only be this much paper to be
# looked at at all: where a band crosses a town, the lettering, the
# symbols and their halos can leave a third of it paper.
_BAND_PAPER_IN_NEAR = 0.3
# ... and be this short: the last few kilometres of a band before a
# sheet's own edge cuts it off.
_BAND_MIN_BLOCKS_NEAR = 40
# A measured band is carried on along its line while the strip between
# its edges stays this much paper, across this many cuts that are not.
_BAND_EXTEND_PAPER = 0.3
_BAND_EXTEND_MISSES = 2
# The tint a band pixel takes is one of the colours the chart around it
# is mostly painted in, not whatever halo or hairline is nearest; the
# fill is worked in chunks so a band around a whole Caribbean inset is
# not one distance transform the size of the sheet.
_BAND_FILL_MIN_SHARE = 0.02
_BAND_FILL_CHUNK_PX = 1024
_BAND_FILL_MARGIN_PX = 64


def _paper_and_tint(lut: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Per palette entry: is it paper, and is it one of the light area
    tints a chart is painted in (terrain, water, towns) rather than
    linework."""
    paper = lut.min(axis=1) >= _WHITE_MIN_CHANNEL
    tint = ~paper & (lut.astype(int).sum(axis=1) >= 500) & (lut.min(axis=1) >= 60)
    return paper, tint


def _shifted(a: np.ndarray, by: int, axis: int, fill) -> np.ndarray:
    """`a` moved `by` places along `axis`, the vacated end filled --
    np.roll without the wrap-around, which would bring one edge of the
    sheet in beside the other."""
    out = np.full_like(a, fill)
    src = [slice(None)] * a.ndim
    dst = [slice(None)] * a.ndim
    if by >= 0:
        src[axis], dst[axis] = slice(0, a.shape[axis] - by), slice(by, None)
    else:
        src[axis], dst[axis] = slice(-by, None), slice(0, a.shape[axis] + by)
    out[tuple(dst)] = a[tuple(src)]
    return out


def _faces_in_blocks(crs, transform, faces, shape: tuple) -> np.ndarray:
    """Which search blocks lie inside the chart face: the face boxes,
    traced along their edges into the raster's own projection (where a
    parallel is an arc) and filled."""
    from affine import Affine
    from rasterio.features import rasterize
    from rasterio.warp import transform as transform_points

    shapes = []
    for west, south, east, north in faces:
        n = 200
        lons = np.concatenate([np.linspace(west, east, n), np.full(n, east), np.linspace(east, west, n), np.full(n, west)])
        lats = np.concatenate([np.full(n, south), np.linspace(south, north, n), np.full(n, north), np.linspace(north, south, n)])
        xs, ys = transform_points("EPSG:4326", crs, lons.tolist(), lats.tolist())
        ring = list(zip(xs, ys))
        shapes.append(({"type": "Polygon", "coordinates": [ring + ring[:1]]}, 1))
    block = transform @ Affine.scale(_BAND_BLOCK, _BAND_BLOCK)
    return rasterize(shapes, out_shape=shape, transform=block).astype(bool)


def _band_candidates(paper: np.ndarray, inside: np.ndarray, paper_in: float = _BAND_PAPER_IN,
                     min_blocks: int = _BAND_MIN_BLOCKS) -> list:
    """(axis, mask, span) for each straight run of paper with chart
    either side, in search blocks: axis 0 runs down the raster, 1
    across it; `mask` is the run within `span`. `paper_in` is how much
    of a run must be paper and `min_blocks` how long it must be, both
    less where a band is expected."""
    from scipy import ndimage as ndi

    p = paper.astype(np.float32)
    found = []
    for axis in (0, 1):
        across = 1 - axis
        # reflected at the raster's own edge: a band the sheet's edge cuts
        # off is as much paper up to it as anywhere else
        along = ndi.uniform_filter1d(p, _BAND_RUN, axis=axis, mode="reflect")
        ridge = (
            (along >= paper_in)
            & (_shifted(along, _BAND_SIDE, across, 1.0) <= _BAND_PAPER_OUT)
            & (_shifted(along, -_BAND_SIDE, across, 1.0) <= _BAND_PAPER_OUT)
            & inside & _shifted(inside, _BAND_SIDE, across, False) & _shifted(inside, -_BAND_SIDE, across, False)
            # a band, not a line: paper for several blocks across it too
            & (ndi.uniform_filter1d(along, 5, axis=across) >= 0.8 * paper_in)
        )
        line = np.ones((_BAND_BRIDGE, 1) if axis == 0 else (1, _BAND_BRIDGE), bool)
        ridge = ndi.binary_closing(ridge, line) & inside
        labels, _ = ndi.label(ridge, structure=np.ones((3, 3), bool))
        for i, span in enumerate(ndi.find_objects(labels), 1):
            if span[axis].stop - span[axis].start >= min_blocks:
                found.append((axis, labels[span] == i, span))
    return found


def _measure_band(data: np.ndarray, paper_lut: np.ndarray, tint_lut: np.ndarray, axis: int, mask: np.ndarray,
                  span: tuple, loose: bool = False) -> tuple | None:
    """A candidate measured at full resolution: (axis, first, last, left
    edge, right edge) -- the run along the raster it covers and its two
    edges as quadratics in the position along it -- when it measures as
    a masked line, None when it does not.

    Cut across every few pixels, a band's edge is the last paper before
    the chart resumes: before a long run of anything that is not paper.
    The lines and letters over the band are a few pixels thick; the
    tint beyond it -- a flat green, or a mountain's shading in dozens of
    shades -- goes on. A halo beside the band can push an edge out and a
    solid symbol in it can pull one in, so each edge is fitted to the
    sections that agree: a running median first, then the ones on it. A
    masked line then has edges on smooth lines (a parallel is an arc,
    so a quadratic) along most of its length, a steady width, mostly
    paper inside, and is far longer than it is wide -- which a label box
    is not, and a label box has its border just outside its paper.
    `loose` is for a candidate running on from a band already measured."""
    from scipy import ndimage as ndi

    wobble = _BAND_LOOSE["wobble"] if loose else _BAND_MAX_EDGE_WOBBLE_PX
    min_on_edge = _BAND_LOOSE["on_edge"] if loose else _BAND_MIN_ON_EDGE
    spread = _BAND_LOOSE["spread"] if loose else _BAND_WIDTH_SPREAD_PX
    min_paper = _BAND_LOOSE["paper"] if loose else _BAND_MIN_PAPER

    b = _BAND_BLOCK
    grid = data if axis == 0 else data.T
    mask = mask if axis == 0 else mask.T
    (along0, along1), across0 = ((span[0].start, span[0].stop), span[1].start) if axis == 0 else \
        ((span[1].start, span[1].stop), span[0].start)
    half = 2 * _BAND_SIDE * b
    linework = ~paper_lut & ~tint_lut
    sections, found = 0, []
    for pos in range(along0 * b, min(along1 * b, grid.shape[0]), _BAND_STEP_PX):
        blocks = np.nonzero(mask[pos // b - along0])[0]
        if not len(blocks):
            continue
        sections += 1
        centre = int((across0 + blocks.mean()) * b + b // 2)
        lo = max(centre - half, 0)
        row = grid[pos, lo:min(centre + half, grid.shape[1])]
        on = paper_lut[row]
        c = centre - lo
        start = next((c + d for d in (0, -1, 1, -2, 2, -3, 3) if 0 <= c + d < len(on) and on[c + d]), None)
        if start is None:
            continue  # something printed right across the centre line here
        edges = []
        for step in (-1, 1):
            i, last, gap = start, start, 0
            while 0 <= i < len(on) and gap < _BAND_CHART_RUN_PX:
                if on[i]:
                    last, gap = i, 0
                else:
                    gap += 1
                i += step
            edges.append(last if gap >= _BAND_CHART_RUN_PX else None)
        left, right = edges
        if left is None or right is None:
            continue  # paper as far as the section reaches: not a band
        bordered = bool(linework[row[max(left - 2, 0):left]].any() and linework[row[right + 1:right + 3]].any())
        found.append((pos, lo + left, lo + right, float(on[left:right + 1].mean()), bordered))
    if len(found) < max(_BAND_MIN_SECTIONS, _BAND_MIN_SECTION_SHARE * sections):
        return None
    pos, left, right, paper, bordered = (np.array(v) for v in zip(*found))

    on_edge, fits = [], []
    for edge in (left, right):
        fit = np.polyfit(pos, ndi.median_filter(edge, size=9, mode="nearest").astype(float), 2)
        for _ in range(4):
            keep = np.abs(edge - np.polyval(fit, pos)) <= wobble
            if keep.sum() < _BAND_MIN_SECTIONS:
                return None
            fit = np.polyfit(pos[keep], edge[keep], 2)
        on_edge.append(np.abs(edge - np.polyval(fit, pos)) <= wobble)
        fits.append(fit)
    both = on_edge[0] & on_edge[1]
    if min(on_edge[0].mean(), on_edge[1].mean()) < min_on_edge or both.sum() < _BAND_MIN_SECTIONS:
        return None
    # ... all along it, not in one stretch: a lake narrows for a while.
    either = on_edge[0] | on_edge[1]
    if min(either[third].mean() for third in np.array_split(np.arange(len(pos)), 3)) < min_on_edge:
        return None
    width = (right - left + 1)[both]
    q1, median, q3 = np.percentile(width, [25, 50, 75])
    if not _BAND_WIDTH_PX[0] <= median <= _BAND_WIDTH_PX[1] or q3 - q1 > spread:
        return None
    if float(np.median(paper[both])) < min_paper:
        return None
    length = float(pos.max() - pos.min() + _BAND_STEP_PX)
    if length < _BAND_BOX_ASPECT * median and float(bordered[both].mean()) >= _BAND_BOX_BORDERED:
        return None
    return axis, int(pos.min()), int(pos.max()), fits[0], fits[1]


def _extend_band(data: np.ndarray, paper_lut: np.ndarray, band: tuple) -> tuple:
    """A measured band carried on along its own line past where its
    measurement stopped, for as long as the strip between its edges is
    still mostly paper: through the name lettered across it in the last
    kilometres before a sheet's edge, up to the edge itself."""
    axis, first, last, left_fit, right_fit = band
    grid = data if axis == 0 else data.T

    def paper_at(pos: int) -> float | None:
        lo = int(np.floor(np.polyval(left_fit, pos)))
        hi = int(np.ceil(np.polyval(right_fit, pos))) + 1
        if not 0 <= pos < grid.shape[0] or lo < 0 or hi > grid.shape[1] or hi - lo < 3:
            return None
        return float(paper_lut[grid[pos, lo:hi]].mean())

    ends = []
    for start, step in ((first, -_BAND_STEP_PX), (last, _BAND_STEP_PX)):
        pos, end, misses = start, start, 0
        while misses <= _BAND_EXTEND_MISSES:
            pos += step
            share = paper_at(pos)
            if share is None:
                break
            if share >= _BAND_EXTEND_PAPER:
                end, misses = pos, 0
            else:
                misses += 1
        ends.append(end)
    return axis, min(ends[0], first), max(ends[1], last), left_fit, right_fit


def _band_region(shape: tuple, band: tuple) -> tuple:
    """The pixels a measured band covers -- between its two edges, a
    couple of pixels out for the scan's soft edge, and carried one band
    width on past either end so that where two meet at a corner the
    square they share is covered -- as (rows, cols) index arrays."""
    axis, first, last, left_fit, right_fit = band
    along_size, across_size = shape if axis == 0 else shape[::-1]
    width = float(np.median(np.polyval(right_fit, [first, last]) - np.polyval(left_fit, [first, last])))
    reach = int(width) + 8
    along = np.arange(max(first - reach, 0), min(last + _BAND_STEP_PX + reach, along_size))
    lo = np.clip(np.floor(np.polyval(left_fit, along)).astype(int) - 2, 0, across_size)
    hi = np.clip(np.ceil(np.polyval(right_fit, along)).astype(int) + 3, 0, across_size)   # exclusive
    counts = np.maximum(hi - lo, 0)
    along_idx = np.repeat(along, counts)
    across_idx = np.concatenate([np.arange(a, b) for a, b in zip(lo, hi)]) if counts.sum() else np.array([], int)
    return (along_idx, across_idx) if axis == 0 else (across_idx, along_idx)


def _fill_bands(data: np.ndarray, region: np.ndarray, paper_lut: np.ndarray, tint_lut: np.ndarray) -> int:
    """Every paper pixel in `region` given the palette index of the
    nearest pixel of the surrounding chart's own tints, in place.
    Returns the number of pixels changed."""
    from scipy import ndimage as ndi

    chunk, margin = _BAND_FILL_CHUNK_PX, _BAND_FILL_MARGIN_PX
    height, width = data.shape
    changed = 0
    for r0 in range(0, height, chunk):
        for c0 in range(0, width, chunk):
            r1, c1 = min(r0 + chunk, height), min(c0 + chunk, width)
            if not region[r0:r1, c0:c1].any():
                continue
            top, bottom = max(r0 - margin, 0), min(r1 + margin, height)
            left, right = max(c0 - margin, 0), min(c1 + margin, width)
            window = data[top:bottom, left:right]
            near = region[top:bottom, left:right]
            target = np.zeros_like(near)
            target[r0 - top:r1 - top, c0 - left:c1 - left] = near[r0 - top:r1 - top, c0 - left:c1 - left]
            target &= paper_lut[window]
            if not target.any():
                continue
            around = ~near & tint_lut[window]
            values, counts = np.unique(window[around], return_counts=True)
            if not len(values):
                continue
            usual = np.zeros(256, bool)
            usual[values[counts >= _BAND_FILL_MIN_SHARE * counts.sum()]] = True
            source = around & usual[window]
            _, (rows, cols) = ndi.distance_transform_edt(~source, return_indices=True)
            window[target] = window[rows[target], cols[target]]
            changed += int(target.sum())
    return changed


def _box_outlines(crs, transform, boxes, shape: tuple) -> np.ndarray:
    """Search blocks along the borders of lat/lon `boxes`, traced into the
    raster's projection: where the rest of a band lies, when the boxes
    are areas already taken out of it."""
    from affine import Affine
    from rasterio.features import rasterize
    from rasterio.warp import transform as transform_points

    lines = []
    for west, south, east, north in boxes:
        n = 100
        lons = np.concatenate([np.linspace(west, east, n), np.full(n, east), np.linspace(east, west, n), np.full(n, west)])
        lats = np.concatenate([np.full(n, south), np.linspace(south, north, n), np.full(n, north), np.linspace(north, south, n)])
        xs, ys = transform_points("EPSG:4326", crs, lons.tolist(), lats.tolist())
        ring = list(zip(xs, ys))
        lines.append(({"type": "LineString", "coordinates": ring + ring[:1]}, 1))
    block = transform @ Affine.scale(_BAND_BLOCK, _BAND_BLOCK)
    return rasterize(lines, out_shape=shape, transform=block, all_touched=True).astype(bool)


def find_masked_lines(data: np.ndarray, lut: np.ndarray, crs, transform, faces: list, known: tuple = ()) -> np.ndarray | None:
    """The pixels of a palette raster's masked lines inside `faces`, as
    a mask the shape of `data`; None where it has none. Candidates that
    measure as bands on their own come first. Then, round after round,
    whatever lies beside a band found so far -- or along the border of
    one of `known`, areas already taken out of this raster -- is looked
    for again with less paper asked of it and measured loosely: the
    stretch of a band through a town, the fourth side of a box."""
    from scipy import ndimage as ndi

    b = _BAND_BLOCK
    paper_lut, tint_lut = _paper_and_tint(lut)
    paper = paper_lut[data[::b, ::b]]
    inside = _faces_in_blocks(crs, transform, faces, paper.shape)
    anchors = _box_outlines(crs, transform, known, paper.shape) if known else np.zeros(paper.shape, bool)
    region = np.zeros(data.shape, bool)
    for axis, mask, span in _band_candidates(paper, inside):
        band = _measure_band(data, paper_lut, tint_lut, axis, mask, span)
        if band is not None:
            region[_band_region(data.shape, _extend_band(data, paper_lut, band))] = True
    if not region.any() and not anchors.any():
        return None
    waiting = _band_candidates(paper, inside, paper_in=_BAND_PAPER_IN_NEAR, min_blocks=_BAND_MIN_BLOCKS_NEAR)
    while waiting:
        near = ndi.binary_dilation(region[::b, ::b] | anchors, iterations=_BAND_NEIGHBOUR_BLOCKS)[:paper.shape[0], :paper.shape[1]]
        still, found = [], False
        for axis, mask, span in waiting:
            band = None
            if (mask & near[span]).any() and not (mask & region[::b, ::b][span]).all():
                band = _measure_band(data, paper_lut, tint_lut, axis, mask, span, loose=True)
            if band is None:
                still.append((axis, mask, span))
            else:
                region[_band_region(data.shape, _extend_band(data, paper_lut, band))] = True
                found = True
        if not found:
            break
        waiting = still
    if not region.any():
        return None
    # Only inside the face: the collar beyond it is never drawn, and is
    # left as printed.
    region &= np.repeat(np.repeat(inside, b, axis=0), b, axis=1)[:data.shape[0], :data.shape[1]]
    return region


def remove_masked_lines(path: Path, faces: list, known: tuple = ()) -> tuple:
    """The masked lines taken out of a palette chart raster, in place:
    found inside `faces` (a sheet split at the antimeridian has two),
    their paper filled with the tint around them, and the raster
    rewritten -- written whole to a copy with the same profile, colours
    and overviews, and swapped in, so a planner rendering from it at
    that moment finishes on the old file rather than reading half a
    new one. `known` are areas already taken out of it, whose borders
    the rest of a band is looked for along. Returns the (west, south,
    east, north) boxes changed, () when there were none (or the raster
    is not a palette image)."""
    import rasterio
    from rasterio.warp import transform_bounds
    from scipy import ndimage as ndi

    b = _BAND_BLOCK
    with rasterio.open(path) as src:
        lut = _palette(src)
        if lut is None:
            return ()
        paper_lut, tint_lut = _paper_and_tint(lut)
        data = src.read(1)
        profile, colormap, tags, band_tags = src.profile, src.colormap(1), src.tags(), src.tags(1)
        crs, transform = src.crs, src.transform
    region = find_masked_lines(data, lut, crs, transform, faces, known)
    if region is None:
        return ()
    changed = _fill_bands(data, region, paper_lut, tint_lut)
    if not changed:
        return ()

    boxes = []
    labels, _ = ndi.label(region[::b, ::b], structure=np.ones((3, 3), bool))
    for rows, cols in ndi.find_objects(labels):
        x0, y0 = transform @ (cols.start * b, rows.stop * b)
        x1, y1 = transform @ (cols.stop * b, rows.start * b)
        boxes.append(tuple(float(v) for v in transform_bounds(crs, "EPSG:4326", x0, y0, x1, y1, densify_pts=21)))

    if not profile.get("tiled"):
        profile.pop("blockxsize", None)   # a striped file's strips are whole rows; GDAL only warns about it
    tmp = path.with_name(f"{path.name}.{os.getpid()}.part")
    with rasterio.open(tmp, "w", **profile) as dst:
        dst.write_colormap(1, colormap)   # first: GDAL cannot make it a palette image once pixels are written
        dst.write(data, 1)
        dst.update_tags(**tags)
        dst.update_tags(1, **band_tags)
    charts.build_overviews(tmp)
    tmp.replace(path)
    log.info("%s: %d masked-line pixels given back their tint, in %d area(s)", path.name, changed, len(boxes))
    return tuple(boxes)


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

# A scan's own outermost pixels are a paper border -- one column of white
# down the Twin Cities sheet's east edge -- which is only ever collar,
# except where the chart runs on to the raster's edge and the face with
# it. Drawn there, it was a white hairline down the seam, with the
# neighbouring sheet on the far side of it.
_RASTER_RIM_PX = 2


def without_raster_rim(inside: np.ndarray, rgb: np.ndarray, src, bbox_3857: tuple) -> np.ndarray:
    """`inside` -- which pixels of a warp grid the source raster covers --
    with the paper in the raster's outermost `_RASTER_RIM_PX` pixels
    taken out: the scan's border, not a chart that runs to the edge of
    its raster, which two sheets meeting there need. Only pixels near
    the edge of what is covered are looked at, so a warp well inside a
    sheet costs nothing."""
    from rasterio.warp import transform as transform_points
    from scipy import ndimage as ndi

    height, width = inside.shape
    xmin, ymin, xmax, ymax = bbox_3857
    dest_px_m = (xmax - xmin) / width
    reach = int(math.ceil(_RASTER_RIM_PX * float(src.res[0]) / dest_px_m)) + 2
    rows, cols = np.nonzero(inside & ~ndi.binary_erosion(inside, iterations=reach, border_value=1))
    if not len(rows):
        return inside
    xs = xmin + (cols + 0.5) * dest_px_m
    ys = ymax - (rows + 0.5) * (ymax - ymin) / height
    sx, sy = transform_points("EPSG:3857", src.crs, xs.tolist(), ys.tolist())
    inverse = ~src.transform
    sx, sy = np.asarray(sx), np.asarray(sy)
    c, r = inverse.a * sx + inverse.b * sy + inverse.c, inverse.d * sx + inverse.e * sy + inverse.f
    rim = (c < _RASTER_RIM_PX) | (r < _RASTER_RIM_PX) | (c > src.width - _RASTER_RIM_PX) | (r > src.height - _RASTER_RIM_PX)
    rim &= rgb[rows, cols].min(axis=1) >= _WHITE_MIN_CHANNEL
    inside = inside.copy()
    inside[rows[rim], cols[rim]] = False
    return inside
