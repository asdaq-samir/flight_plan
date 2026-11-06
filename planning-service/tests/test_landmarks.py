"""The chart's lakes and towns read once a cycle (app.landmarks): a
corridor read with them is the reader's own read to the digit, on a
chart drawn here with lakes and towns across every edge a read has."""
import functools
import json
import threading

import numpy as np
import pytest
from app import chart_reader, detection, landmarks
from PIL import Image
from wingtip import charts, chartvision

# Near Rockford, on the Chicago sectional (charts.COVERAGE), so the
# reader's own test of whether a block has chart says yes.
START, END = (42.20, -89.10), (42.32, -88.86)
HALF_WIDTH_NM = 4.0

WATER, TOWN, ROAD, RIVER = (190, 223, 238), (250, 248, 86), (20, 20, 20), (0, 43, 85)


def _scene():
    """Lakes and towns of every size about the course -- inside a tile,
    across tiles, across the corridor's edge, bigger than a block -- and
    roads and a river across it, in whole-world pixels at zoom 12."""
    rng = np.random.default_rng(7)
    (x0, y0), (x1, y1) = (chartvision.latlon_to_global_px(*p) for p in (START, END))
    lo_x, hi_x = min(x0, x1) - 600, max(x0, x1) + 600
    lo_y, hi_y = min(y0, y1) - 600, max(y0, y1) + 600
    lakes = [(rng.uniform(lo_x, hi_x), rng.uniform(lo_y, hi_y), r, r * rng.uniform(0.4, 1.0))
             for r in rng.choice([6.0, 10.0, 16.0, 30.0, 60.0, 200.0, 420.0], size=200,
                                    p=[0.25, 0.25, 0.2, 0.12, 0.1, 0.05, 0.03])]
    towns = [(rng.uniform(lo_x, hi_x), rng.uniform(lo_y, hi_y), w, w * rng.uniform(0.5, 1.5))
             for w in rng.choice([22.0, 40.0, 90.0, 300.0], size=70)]
    lines = []
    for t in np.linspace(0.1, 0.9, 6):
        cx, cy = x0 + t * (x1 - x0), y0 + t * (y1 - y0)
        lines.append((cx - 300, cy - 260, cx + 300, cy + 260))
    return lakes, towns, lines, (x0, y0, x1, y1)


@functools.lru_cache(maxsize=None)
def _tile(x: int, y: int):
    """One tile of the chart drawn here; None for the odd tile no sheet
    covers, as along a coast."""
    if (x * 7 + y * 3) % 23 == 0:
        return None
    lakes, towns, lines, (rx0, ry0, rx1, ry1) = _scene()
    gy, gx = np.mgrid[0:256, 0:256].astype(float)
    gx += x * 256
    gy += y * 256
    rgb = np.full((256, 256, 3), 255, dtype=np.uint8)
    for cx, cy, w, h in towns:
        rgb[(abs(gx - cx) <= w) & (abs(gy - cy) <= h)] = TOWN
    for cx, cy, a, b in lakes:
        rgb[((gx - cx) / a) ** 2 + ((gy - cy) / b) ** 2 <= 1.0] = WATER
    for ax, ay, bx, by in lines:
        dx, dy = bx - ax, by - ay
        t = np.clip(((gx - ax) * dx + (gy - ay) * dy) / (dx * dx + dy * dy), 0, 1)
        rgb[np.hypot(gx - ax - t * dx, gy - ay - t * dy) <= 1.5] = ROAD
    dx, dy = rx1 - rx0, ry1 - ry0
    # A river along the course a little to one side, and so across it
    # nowhere: crossings come from the roads; the river is a long thin
    # line beside the course, as a block's edge cuts one.
    t = np.clip(((gx - rx0) * dx + (gy - ry0) * dy) / (dx * dx + dy * dy), 0, 1)
    rgb[np.abs(np.hypot(gx - rx0 - t * dx, gy - ry0 - t * dy) - 140) <= 1.5] = RIVER
    return Image.fromarray(rgb)


@pytest.fixture
def drawn_chart(monkeypatch, tmp_path):
    """The chart above in place of the FAA's, cells kept under tmp_path,
    and cells of 8 by 8 tiles read 4 by 4 at a time, so a short route
    crosses many of each and their edges."""
    monkeypatch.setattr(charts, "tile_image", lambda x, y, zoom, kind="sec": _tile(x, y))
    monkeypatch.setattr(charts, "tile_cached", lambda *args, **kwargs: True)
    monkeypatch.setattr(charts, "prepare_for_bbox", lambda *args, **kwargs: [])
    monkeypatch.setattr(charts, "serving_cycle", lambda: "09-03-2026")
    monkeypatch.setattr(charts, "tiles_revision", lambda cycle: 3)
    monkeypatch.setattr(landmarks, "LANDMARKS_ROOT", tmp_path / "landmarks")
    monkeypatch.setattr(landmarks, "CELL_TILES", 8)
    monkeypatch.setattr(landmarks, "CORE_TILES", 4)
    landmarks._CELLS.clear()
    yield tmp_path
    landmarks._CELLS.clear()


def _readers_own(tmp_path) -> list:
    """The corridor as app.detection reads and keeps it, from the file."""
    job = {"blocks": [], "done": False, "error": None, "at": 0.0, "cond": threading.Condition()}
    kept = tmp_path / "own.json"
    detection._run_detect(job, START, END, HALF_WIDTH_NM, kept)
    assert job["error"] is None
    return json.loads(kept.read_text())


def _with_cells(tmp_path, blocks) -> list:
    kept = tmp_path / "cells.json"
    detection._keep(kept, blocks)
    return json.loads(kept.read_text())


def _corridor_cells() -> list:
    tiles = chartvision.corridor_tiles(START, END, HALF_WIDTH_NM + 1.0)
    return sorted({landmarks.cell_of(tile) for tile in tiles})


@pytest.mark.parametrize("built", ["all", "some"])
def test_a_read_with_the_cells_is_the_readers_own_to_the_digit(drawn_chart, monkeypatch, built):
    cells = _corridor_cells()
    for cell in cells if built == "all" else cells[::2]:
        landmarks.build_cell(cell, landmarks.cells_dir())
    read = []
    detect = chartvision.detect_landmarks

    def counted(mosaic, palette=chartvision.PALETTE):
        read[-1] += mosaic.pixels.shape[0] * mosaic.pixels.shape[1] * len(palette)
        return detect(mosaic, palette)

    monkeypatch.setattr(chartvision, "detect_landmarks", counted)
    read.append(0)
    own = _readers_own(drawn_chart)
    read.append(0)
    with_cells = _with_cells(drawn_chart, landmarks.read_blocks(START, END, HALF_WIDTH_NM))
    assert with_cells == own
    found = [landmark for block in own for landmark in block["landmarks"]]
    assert len(found) > 20 and {"water", "town", "road_or_rail"} <= {landmark["category"] for landmark in found}
    # The cells did some of the work, the pixels searched for blobs fewer;
    # not all of it: a lake across the corridor's edge is read where it is.
    assert 0 < read[1] < read[0]


def test_with_no_cell_built_there_is_no_read_of_its_own(drawn_chart):
    assert landmarks.read_blocks(START, END, HALF_WIDTH_NM) is None


def test_a_blob_cut_off_by_its_cells_block_is_not_kept_and_its_tiles_say_so(drawn_chart):
    cell = _corridor_cells()[0]
    landmarks.build_cell(cell, landmarks.cells_dir())
    loaded = landmarks._cell(landmarks.cells_dir(), cell)
    cut = {tile for tile, bits in loaded["bits"].items()
           if any(bits >> (kind * landmarks._BITS_PER_KIND) & landmarks.CUT for kind in range(2))}
    assert cut, "the drawn chart has lakes bigger than a block"
    kept_tiles = set(loaded["blobs"])
    # Every blob kept sits in a tile of its cell.
    assert all(landmarks.cell_of(tile) == cell for tile in kept_tiles)


def test_the_cells_are_named_for_the_cycle_its_tiles_and_the_reader(monkeypatch, tmp_path):
    monkeypatch.setattr(landmarks, "LANDMARKS_ROOT", tmp_path)
    monkeypatch.setattr(charts, "tiles_revision", lambda cycle: 4)
    path = landmarks.cells_dir("10-29-2026")
    assert path == tmp_path / "10-29-2026" / f"landmarks-r4-{detection._READER}"
    monkeypatch.setattr(charts, "tiles_revision", lambda cycle: 5)
    assert landmarks.cells_dir("10-29-2026") != path
    monkeypatch.setattr(charts, "serving_cycle", lambda: "09-03-2026")
    assert landmarks.cells_dir().parent.name == "09-03-2026"


def test_the_reader_keeps_a_read_with_the_cells_without_reading_the_chart_again(monkeypatch, tmp_path):
    kept = tmp_path / "kept.json"
    monkeypatch.setattr(detection, "_kept_path", lambda key: kept)
    landmark = chartvision.Landmark(category="water", lat=42.2, lon=-89.0, area_m2=1.0, score=4.2, pixels=40,
                                    extras={"cross_track_nm": 0.1, "along_track_nm": 2.0})
    monkeypatch.setattr(landmarks, "read_blocks", lambda *args: [
        {"block": 0, "blocks": 1, "tiles": 3, "missing": 0, "landmarks": [landmark]}])
    monkeypatch.setattr(chart_reader, "detect_job", lambda *args: pytest.fail("read the chart again"))
    assert chart_reader.read_corridor(("C81->KRFD", 4.0), START, END, 4.0) is None
    assert detection._load_kept(kept)[0]["landmarks"] == [landmark]


@pytest.mark.parametrize("cells", ["none", "broken"])
def test_the_reader_reads_as_before_where_the_cells_cannot(monkeypatch, tmp_path, cells):
    monkeypatch.setattr(detection, "_kept_path", lambda key: tmp_path / "kept.json")

    def read_blocks(*args):
        if cells == "broken":
            raise ValueError("a torn cell")
        return None

    monkeypatch.setattr(landmarks, "read_blocks", read_blocks)
    asked = []

    def detect_job(*args):
        asked.append(args[0])
        return {"cond": threading.Condition(), "done": True, "error": None}

    monkeypatch.setattr(chart_reader, "detect_job", detect_job)
    assert chart_reader.read_corridor(("C81->KRFD", 4.0), START, END, 4.0) is None
    assert asked == [("C81->KRFD", 4.0)]


def test_the_cells_under_a_sectional_are_the_zoom_7_tiles_it_spans():
    cells = landmarks.sheet_cells(["Chicago"])
    west, south, east, north = charts.COVERAGE["sec"]["Chicago"]
    corners = [landmarks.cell_of(tuple(int(v) // 256 for v in chartvision.latlon_to_global_px(lat, lon)))
               for lat, lon in ((north, west), (south, east))]
    assert cells[0] == corners[0] and cells[-1] == corners[1]
    assert len(cells) == (corners[1][0] - corners[0][0] + 1) * (corners[1][1] - corners[0][1] + 1)


def test_the_planner_builds_the_cells_of_the_sectionals_it_has_and_fetches_none(monkeypatch):
    """At start (app.main), only the sheets already prepared here: the
    rest are the daily refresh's to bring."""
    monkeypatch.setattr(charts, "sheets", lambda kind: [("Chicago", (0, 0, 1, 1)), ("Omaha", (0, 0, 1, 1))])
    monkeypatch.setattr(charts, "_latest_on_disk", lambda kind, name: object() if name == "Chicago" else None)
    asked = []
    monkeypatch.setattr(landmarks, "build", lambda names, **kwargs: asked.append((names, kwargs)) or 7)
    assert landmarks.build_on_disk() == 7
    assert asked == [(["Chicago"], {"workers": 1, "cycle": None, "initializer": landmarks._low_priority})]


def test_with_no_sectional_on_disk_nothing_is_built(monkeypatch):
    monkeypatch.setattr(charts, "sheets", lambda kind: [("Chicago", (0, 0, 1, 1))])
    monkeypatch.setattr(charts, "_latest_on_disk", lambda kind, name: None)
    monkeypatch.setattr(landmarks, "build", lambda *args, **kwargs: pytest.fail("built with no chart"))
    assert landmarks.build_on_disk() == 0
