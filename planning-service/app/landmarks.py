"""The chart's lakes and towns read once a cycle, so a new route's read
does not find them again.

A corridor read (app.detection, wingtip.chartvision) was most of a new
route's checkpoints: KOVS->KRGK's 116 nm took 2.2 to 2.6 s of one
processor, 1.3 s of it finding the water and towns in each block
(detect_landmarks), 0.4 to 0.6 s stitching the tiles and 0.5 to 0.7 s
finding where the course crosses rivers and roads (measured 2026-10-28,
the planner's image on two processors). The water and towns are the
chart's, the same for every route; the crossings are the course's, and
are read with it as before.

`python -m app.landmarks build` reads every sectional tile once, in
cells of 32 by 32 zoom-12 tiles (a zoom-7 tile), and keeps each cell's
blobs in a file of its own beside the cycle's tiles, named for the
cycle, its tile revision and the reader's code as a kept read is: a new
edition, tiles rendered again or a change to the reader starts the
cells again, and a cell with its file is done, so a build stopped part
way picks up where it was.

A corridor read then takes a block's blobs from the cells wherever that
gives exactly what reading the block would: the same points, areas and
order, so the read it keeps is the reader's own to the last digit and
the training page, which replays it, cannot tell. That is so for a kind
of blob in a block when none of its blobs there is cut off, by the
corridor's edge or the block's, which the cells know from where each of
their tiles' blobs runs into the next tile. Where it is not so -- a lake
across the corridor's edge, a cell not built -- the block reads that
kind as before."""
import argparse
import logging
import os
import threading
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from pathlib import Path

import numpy as np
from cachetools import LRUCache
from wingtip import charts, chartvision
from wingtip.config import CHART_TILE_CACHE_DIR, get_settings
from wingtip.geo import along_track_distance_nm, cross_track_distance_nm, distance_nm

from . import detection

log = logging.getLogger(__name__)

ZOOM = chartvision.DEFAULT_ZOOM
TILE_PX = chartvision.TILE_PX
# A cell is a zoom-7 tile: 1,024 zoom-12 tiles, about 2.8 by 2.1 degrees
# at 42 N, read in 10 to 30 s. Small enough to build a sheet at a time
# and to load only the few a route crosses.
CELL_ZOOM = 7
CELL_TILES = 2 ** (ZOOM - CELL_ZOOM)
# Each cell read in blocks of 8 by 8 tiles with a tile of chart around
# them: a blob is the block's whose point is in its middle 8 by 8, seen
# whole if it reaches no further than the tile around. 1.56 tiles read
# for each one kept; a blob that reaches further is marked cut off
# (below), and the blocks that have it read it themselves.
CORE_TILES = 8
APRON_TILES = 1

# Where the cells are kept: beside the cycle's tiles, or elsewhere where
# CHART_LANDMARKS_DIR says (a server whose tiles are in the cloud).
LANDMARKS_ROOT = get_settings().chart_landmarks_dir or CHART_TILE_CACHE_DIR

# Per tile and per kind of blob, five bits: whether that kind's pixels
# run on into the tile to the right, below, to the left or above, and
# whether any of them belongs to a blob its cell's block saw cut off.
RIGHT, DOWN, LEFT, UP, CUT = 1, 2, 4, 8, 16
_BITS_PER_KIND = 5


def cells_dir(cycle: str | None = None) -> Path:
    """The cells of the cycle the planner serves, named as its kept reads
    are (app.detection._kept_path): by tile revision and reader."""
    cycle = cycle or charts.serving_cycle()
    return LANDMARKS_ROOT / cycle / f"landmarks-r{charts.tiles_revision(cycle)}-{detection._READER}"


def _cell_path(root: Path, cell: tuple) -> Path:
    return root / str(cell[0]) / f"{cell[1]}.npz"


def cell_of(tile: tuple) -> tuple:
    return tile[0] // CELL_TILES, tile[1] // CELL_TILES


# ---------------------------------------------------------------------------
# Reading the chart a cell at a time
# ---------------------------------------------------------------------------

def _read_block(bx: int, by: int) -> tuple[list, dict]:
    """One block of a cell, its middle 8 by 8 tiles from (bx, by): the
    blobs whose point is in the middle and are not cut off, as rows
    (kind, lat, lon, pixels, first row, first column), and each middle
    tile's bits (above). Read with chartvision's own build_mosaic and
    detect_landmarks; the blobs labelled again here, the same way, to
    know where each runs."""
    from scipy import ndimage

    block = [(x, y) for x in range(bx - APRON_TILES, bx + CORE_TILES + APRON_TILES)
             for y in range(by - APRON_TILES, by + CORE_TILES + APRON_TILES)]
    if not chartvision._has_chart(block, ZOOM):
        return [], {}
    mosaic = chartvision.build_mosaic(block, ZOOM)
    found = chartvision.detect_landmarks(mosaic)
    ox, oy = mosaic.origin_px
    rows: list = []
    bits: dict = {}
    for kind, spec in enumerate(chartvision.PALETTE):
        mask = mosaic.on_chart(mosaic.colour(spec.test))
        labelled, _ = ndimage.label(mask)
        edge = np.unique(np.concatenate([labelled[0], labelled[-1], labelled[:, 0], labelled[:, -1]]))
        cut = np.isin(labelled, edge[edge > 0])
        shift = kind * _BITS_PER_KIND
        for i in range(CORE_TILES):
            for j in range(CORE_TILES):
                c0, r0 = (APRON_TILES + i) * TILE_PX, (APRON_TILES + j) * TILE_PX
                c1, r1 = c0 + TILE_PX, r0 + TILE_PX
                tile_bits = (
                    RIGHT * bool((mask[r0:r1, c1 - 1] & mask[r0:r1, c1]).any())
                    | DOWN * bool((mask[r1 - 1, c0:c1] & mask[r1, c0:c1]).any())
                    | LEFT * bool((mask[r0:r1, c0] & mask[r0:r1, c0 - 1]).any())
                    | UP * bool((mask[r0, c0:c1] & mask[r0 - 1, c0:c1]).any())
                    | CUT * bool(cut[r0:r1, c0:c1].any())
                )
                if tile_bits:
                    key = (bx + i, by + j)
                    bits[key] = bits.get(key, 0) | (tile_bits << shift)
        boxes = ndimage.find_objects(labelled)
        for landmark in found:
            if landmark.category != spec.name:
                continue
            # The blob's own pixel, back from its point: a whole pixel,
            # as detect_landmarks placed it.
            gx, gy = (round(v) for v in chartvision.latlon_to_global_px(landmark.lat, landmark.lon, ZOOM))
            if not (bx <= gx // TILE_PX < bx + CORE_TILES and by <= gy // TILE_PX < by + CORE_TILES):
                continue
            label = int(labelled[gy - oy, gx - ox])
            box = boxes[label - 1] if label else None
            if box is None or int(np.count_nonzero(labelled[box] == label)) != landmark.pixels:
                # Not the blob found there: never so far, and should it be,
                # its tile is read by each block that has it, not trusted.
                key = (gx // TILE_PX, gy // TILE_PX)
                bits[key] = bits.get(key, 0) | (CUT << shift)
                continue
            if cut[gy - oy, gx - ox]:
                continue
            # Its first pixel as a block is scanned, row by row: the order
            # detect_landmarks finds blobs in.
            first_col = box[1].start + int(np.argmax(labelled[box[0].start, box[1]] == label))
            rows.append((kind, landmark.lat, landmark.lon, landmark.pixels, oy + box[0].start, ox + first_col))
    return rows, bits


def build_cell(cell: tuple, root: Path) -> Path:
    """A cell read and its file written, whole or not at all."""
    cx, cy = cell
    rows: list = []
    bits: dict = {}
    for bx in range(cx * CELL_TILES, (cx + 1) * CELL_TILES, CORE_TILES):
        for by in range(cy * CELL_TILES, (cy + 1) * CELL_TILES, CORE_TILES):
            block_rows, block_bits = _read_block(bx, by)
            rows += block_rows
            bits.update(block_bits)
    blobs = np.array(rows, dtype=float).reshape(-1, 6)
    tiles = np.array([(x, y, b) for (x, y), b in sorted(bits.items())], dtype=np.int64).reshape(-1, 3)
    path = _cell_path(root, cell)
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_name(f"{path.name}.{os.getpid()}.part")
    with part.open("wb") as handle:
        np.savez_compressed(
            handle, kind=blobs[:, 0].astype(np.int8), lat=blobs[:, 1], lon=blobs[:, 2],
            pixels=blobs[:, 3].astype(np.int64), first_y=blobs[:, 4].astype(np.int64),
            first_x=blobs[:, 5].astype(np.int64), tiles=tiles,
        )
    part.replace(path)
    return path


def sheet_cells(names: list | None = None) -> list:
    """The cells under the named sectionals, every sectional's by default."""
    cells = set()
    for name, (west, south, east, north) in charts.sheets(charts.SECTIONAL):
        if names and name not in names:
            continue
        x0, y0 = (int(v) // TILE_PX for v in chartvision.latlon_to_global_px(north, west, ZOOM))
        x1, y1 = (int(v) // TILE_PX for v in chartvision.latlon_to_global_px(south, east, ZOOM))
        cells |= {(x, y) for x in range(x0 // CELL_TILES, x1 // CELL_TILES + 1)
                  for y in range(y0 // CELL_TILES, y1 // CELL_TILES + 1)}
    return sorted(cells)


def build(names: list | None = None, workers: int = 2, cycle: str | None = None, initializer=None) -> int:
    """Every cell under the named sectionals not built yet for the cycle,
    `workers` at a time, each in a process of its own (a cell holds the
    interpreter for most of its read). Returns the cells built."""
    root = cells_dir(cycle)
    todo = [c for c in sheet_cells(names) if not _cell_path(root, c).exists()]
    log.info("%d cells to read into %s", len(todo), root)
    if not todo:
        return 0
    with ProcessPoolExecutor(max_workers=workers, initializer=initializer) as pool:
        for done, path in enumerate(pool.map(build_cell, todo, [root] * len(todo)), 1):
            if done % 10 == 0 or done == len(todo):
                log.info("  %d of %d cells (%s)", done, len(todo), path.name)
    return len(todo)


# ---------------------------------------------------------------------------
# A corridor's read, its blobs from the cells
# ---------------------------------------------------------------------------

# Cells as loaded, by path: a few dozen kilobytes each, and a route
# crosses a handful. A missing cell is not remembered, so one built while
# the planner runs is taken up by the next route over it.
_CELLS: LRUCache = LRUCache(maxsize=512)
_CELLS_LOCK = threading.Lock()


def _cell(root: Path, cell: tuple) -> dict | None:
    path = _cell_path(root, cell)
    with _CELLS_LOCK:
        if path in _CELLS:
            return _CELLS[path]
    if not path.exists():
        return None
    with np.load(path) as data:
        by_tile: dict = {}
        for kind, lat, lon, pixels, first_y, first_x in zip(
            data["kind"].tolist(), data["lat"].tolist(), data["lon"].tolist(),
            data["pixels"].tolist(), data["first_y"].tolist(), data["first_x"].tolist(),
        ):
            gx, gy = (round(v) for v in chartvision.latlon_to_global_px(lat, lon, ZOOM))
            by_tile.setdefault((gx // TILE_PX, gy // TILE_PX), []).append((kind, first_y, first_x, lat, lon, pixels))
        loaded = {"blobs": by_tile, "bits": {(int(x), int(y)): int(b) for x, y, b in data["tiles"]}}
    with _CELLS_LOCK:
        _CELLS[path] = loaded
    return loaded


def _sides(tile: tuple) -> tuple:
    x, y = tile
    return (RIGHT, (x + 1, y)), (DOWN, (x, y + 1)), (LEFT, (x - 1, y)), (UP, (x, y - 1))


def _tiles_to_read(kind: int, block: list, cells: dict) -> set | None:
    """The block's tiles whose blobs of `kind` the cells cannot give as a
    read of the block would find them -- a blob cut off where its cell
    read it, or running on into a tile the block has not got, which the
    block sees cut off there -- with every tile those blobs run on into
    within the block: what is left holds only blobs that are whole in
    the block and kept whole in the cells. None where a tile's cell is
    not built: the whole block is read."""
    if any(cells.get(cell_of(tile)) is None for tile in block):
        return None
    have = set(block)
    shift = kind * _BITS_PER_KIND

    def bits(tile):
        return cells[cell_of(tile)]["bits"].get(tile, 0) >> shift

    todo = [tile for tile in block
            if bits(tile) & CUT or any(bits(tile) & side and n not in have for side, n in _sides(tile))]
    read: set = set()
    while todo:
        tile = todo.pop()
        if tile in read:
            continue
        read.add(tile)
        todo += [n for side, n in _sides(tile) if bits(tile) & side and n in have and n not in read]
    return read


def _read_tiles(mosaic, tiles: set, spec) -> list:
    """The blobs of `spec` in these of the block's tiles, read from the
    block's mosaic cut down to them, as cell rows (first row, first
    column, lat, lon, pixels): the blobs the whole block's read finds
    there, since no blob in them runs on out of them (_tiles_to_read)."""
    from scipy import ndimage

    tx0 = min(x for x, _ in tiles)
    ty0 = min(y for _, y in tiles)
    tx1 = max(x for x, _ in tiles) + 1
    ty1 = max(y for _, y in tiles) + 1
    mx, my = mosaic.origin_px[0] // TILE_PX, mosaic.origin_px[1] // TILE_PX
    rows, cols = slice((ty0 - my) * TILE_PX, (ty1 - my) * TILE_PX), slice((tx0 - mx) * TILE_PX, (tx1 - mx) * TILE_PX)
    block_covered = mosaic.covered[rows, cols]
    covered = np.zeros_like(block_covered)
    for x, y in tiles:
        r, c = (y - ty0) * TILE_PX, (x - tx0) * TILE_PX
        covered[r:r + TILE_PX, c:c + TILE_PX] = block_covered[r:r + TILE_PX, c:c + TILE_PX]
    mosaic.colour(spec.test)  # the block's classes, read once, shared with the cut-down one
    part = chartvision.Mosaic(pixels=mosaic.pixels[rows, cols], origin_px=(tx0 * TILE_PX, ty0 * TILE_PX),
                              zoom=mosaic.zoom, covered=covered, _classes=mosaic._classes[rows, cols])
    found = chartvision.detect_landmarks(part, palette=(spec,))
    labelled, _ = ndimage.label(part.on_chart(part.colour(spec.test)))
    boxes = ndimage.find_objects(labelled)
    ox, oy = part.origin_px
    out = []
    for landmark in found:
        gx, gy = (round(v) for v in chartvision.latlon_to_global_px(landmark.lat, landmark.lon, ZOOM))
        label = int(labelled[gy - oy, gx - ox])
        box = boxes[label - 1]
        first_col = box[1].start + int(np.argmax(labelled[box[0].start, box[1]] == label))
        out.append((oy + box[0].start, ox + first_col, landmark.lat, landmark.lon, landmark.pixels))
    return out


def _block_blobs(block: list, mosaic, cells: dict) -> list:
    """What detect_landmarks would find in the block: each kind's blobs
    from the cells where they hold them whole, read from the mosaic in
    the tiles where not -- in detect_landmarks' order, kind by kind, each
    kind's blobs in the order a scan of the block meets them, their areas
    at the block's own scale."""
    height, width = mosaic.pixels.shape[:2]
    centre_lat, _ = mosaic.to_latlon(width / 2, height / 2)
    m_per_px = chartvision.metres_per_pixel(centre_lat, mosaic.zoom)
    found = []
    for kind, spec in enumerate(chartvision.PALETTE):
        to_read = _tiles_to_read(kind, block, cells)
        if to_read is None:
            found += chartvision.detect_landmarks(mosaic, palette=(spec,))
            continue
        rows = [row[1:] for tile in block if tile not in to_read
                for row in cells[cell_of(tile)]["blobs"].get(tile, ()) if row[0] == kind]
        if to_read:
            rows += _read_tiles(mosaic, to_read, spec)
        found += [
            chartvision.Landmark(category=spec.name, lat=lat, lon=lon, area_m2=float(pixels) * m_per_px ** 2,
                                 score=spec.base_score, pixels=int(pixels))
            for _, _, lat, lon, pixels in sorted(rows)
        ]
    return found


def read_blocks(start: tuple, end: tuple, half_width_nm: float, margin_nm: float = 5.0) -> list | None:
    """The corridor's read as app.detection keeps it -- its blocks, each
    with the landmarks no earlier block had -- or None where no cell
    under it is built (the reader's own read is then the same work).

    chartvision.iter_landmarks_along_route and detection._run_detect's
    steps, one for one, with the blobs from _block_blobs: written out
    here rather than given a way in there, because their source names
    every kept read (detection._READER), and a change to it would read
    every corridor again."""
    tiles = chartvision.corridor_tiles(start, end, half_width_nm + 1.0, ZOOM)
    root = cells_dir()
    cells = {cell: _cell(root, cell) for cell in {cell_of(tile) for tile in tiles}}
    if not any(cells.values()):
        return None
    route_nm = distance_nm(start[0], start[1], end[0], end[1])
    course_px = chartvision.great_circle_pixels(start, end, ZOOM)

    def big_enough_to_see(landmark, cross_nm: float) -> bool:
        if landmark.extras.get("crossing") or landmark.area_m2 <= 0:
            return True
        spec = next((s for s in chartvision.PALETTE if s.name == landmark.category), None)
        if spec is None:
            return True
        offset = max(1.0, abs(cross_nm) / chartvision.ON_COURSE_NM)
        m_per_px = chartvision.metres_per_pixel(landmark.lat, ZOOM)
        return landmark.area_m2 >= spec.min_area_px * m_per_px ** 2 * offset ** 2

    def block_along_track(block) -> float:
        xs = [x for x, _ in block]
        ys = [y for _, y in block]
        centre_x = (min(xs) + max(xs) + 1) / 2 * TILE_PX
        centre_y = (min(ys) + max(ys) + 1) / 2 * TILE_PX
        lat, lon = chartvision.global_px_to_latlon(centre_x, centre_y, ZOOM)
        return along_track_distance_nm(lat, lon, start, end)

    blocks = [b for b in sorted(chartvision.tile_blocks(tiles), key=block_along_track)
              if chartvision._has_chart(b, ZOOM)]

    def read(block):
        mosaic = chartvision.build_mosaic(block, ZOOM)
        found = _block_blobs(block, mosaic, cells) + chartvision.linear_crossings(mosaic, start, end, course_px=course_px)
        return found, mosaic.missing_tiles

    kept_blocks: list = []
    emitted: list = []
    with ThreadPoolExecutor(max_workers=chartvision.READ_AT_ONCE) as pool:
        for index, (block_landmarks, missing) in enumerate(pool.map(read, blocks)):
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
            fresh = []
            for landmark in chartvision._dedupe(kept):
                if any(other.category == landmark.category
                       and distance_nm(other.lat, other.lon, landmark.lat, landmark.lon) < chartvision.DEDUPE_NM
                       for other in emitted):
                    continue
                emitted.append(landmark)
                fresh.append(landmark)
            kept_blocks.append({"block": index, "blocks": len(blocks), "tiles": len(tiles),
                                "missing": missing, "landmarks": fresh})
    return kept_blocks


def _low_priority() -> None:
    """A builder's process yields to the planner's own: the cells are a
    head start on the next routes, not anything a pilot is waiting for."""
    try:
        os.nice(10)
    except OSError:
        pass


def build_on_disk(cycle: str | None = None) -> int:
    """The cells under every sectional this planner already has on disk,
    the ones its corridors are read from, one process at a time and at a
    low priority. A sectional not prepared here is not fetched for it:
    the whole set is 7 GB, the daily refresh's to bring (app.chart_refresh),
    and its cells are read the next start after. Returns the cells built."""
    names = [name for name, _ in charts.sheets(charts.SECTIONAL)
             if charts._latest_on_disk(charts.SECTIONAL, name) is not None]
    if not names:
        return 0
    return build(names, workers=1, cycle=cycle, initializer=_low_priority)


def _main(argv: list | None = None) -> int:
    """`python -m app.landmarks build [--sheet Chicago ...]` reads the
    served cycle's cells not read yet, under the named sectionals or all
    of them."""
    parser = argparse.ArgumentParser(description="The chart's lakes and towns, read once a cycle.")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("build")
    p.add_argument("--sheet", nargs="+", help="sectionals by name (Chicago, Green_Bay); every one by default")
    p.add_argument("--workers", type=int, default=2)
    p.add_argument("--cycle", help="the cycle to read; the served one by default")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    count = build(args.sheet, workers=args.workers, cycle=args.cycle)
    log.info("%d cells read into %s", count, cells_dir(args.cycle))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
