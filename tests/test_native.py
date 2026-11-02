"""The Rust extension (native/, vfr_native) held to references it does not
share code with:

- route options' straight lines against the Python they were until
  2026-11-01, kept here as the oracle (`_cells`, `_minutes`, `_turns`),
  on random grids; and against the turns, minutes and cells that Python
  gave for two real routes' grids (KMSP-KDEN, KDLH-KSTL), captured then;
- the airspace at a point against shapely's contains on pyshp's own
  reading of each shape, at random points, and against the volumes the
  pyshp and shapely code gave at real taps round Chicago (O'Hare, KDPA,
  Midway and its shelf, Wheeling under O'Hare's shelf), captured then from
  the NASR Class Airspace shapefile the planner held, cut to the volumes
  there.

The wheel is built into the planner's image; CI builds it for these."""
import gzip
import json
import math
import shutil
from pathlib import Path

import numpy as np
import pytest
import shapefile
from shapely.geometry import Point
from shapely.geometry import shape as shapely_shape

import vfr_native
from vfr import airspace_at, geo
from vfr import route_options as ro

FIXTURES = Path(__file__).parent / "fixtures" / "native"


# --- The Python the Rust replaced, as the oracle -------------------------


def _cells(grid, a, b):
    steps = max(2, int(max(abs(b[0] - a[0]), abs(b[1] - a[1])) / (ro.CELL_DEG / 3)) + 1)
    t = np.linspace(0.0, 1.0, steps)
    rows = np.clip(((a[0] + (b[0] - a[0]) * t - grid.lat0) / ro.CELL_DEG).astype(int), 0, grid.rows - 1)
    cols = np.clip(((a[1] + (b[1] - a[1]) * t - grid.lon0) / ro.CELL_DEG).astype(int), 0, grid.cols - 1)
    keep = np.ones(steps, dtype=bool)
    keep[1:] = (rows[1:] != rows[:-1]) | (cols[1:] != cols[:-1])
    return list(zip(rows[keep].tolist(), cols[keep].tolist()))


def _minutes(grid, gs, a, b, marginal_cost=0.0, water_cost=0.0):
    nm = float(geo.distance_nm(a[0], a[1], b[0], b[1]))
    if nm == 0:
        return 0.0
    bearing = math.atan2((b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2)), b[0] - a[0])
    k = ro._step_index(round(math.cos(bearing)), round(math.sin(bearing)))
    rate = [(1.0 + grid.dear[c] + (marginal_cost if grid.marginal[c] >= 0 else 0.0) + water_cost * grid.offshore[c])
            / gs[c[0], c[1], k] for c in _cells(grid, a, b)]
    return nm * float(np.mean(rate)) * 60.0


def _turns(grid, gs, points, marginal_cost, slower_min, water_cost):
    def is_open(c):
        return grid.closed[c] < 0 or c in grid.ends

    out, i = [points[0]], 0
    legs = [_minutes(grid, gs, points[k], points[k + 1], marginal_cost, water_cost) for k in range(len(points) - 1)]

    def marginal_cells(a, b):
        return sum(1 for c in _cells(grid, a, b) if grid.marginal[c] >= 0)

    leg_closed = [{c for c in _cells(grid, points[k], points[k + 1]) if not is_open(c)} for k in range(len(points) - 1)]

    def clear_enough(i, j):
        crossed = set().union(*leg_closed[i:j])
        line = _cells(grid, points[i], points[j])
        return all(is_open(c) for c in line) or sum(1 for c in line if not is_open(c)) <= len(crossed)

    while i < len(points) - 1:
        j = len(points) - 1
        while j > i + 1:
            if clear_enough(i, j) and \
                    _minutes(grid, gs, points[i], points[j], marginal_cost, water_cost) <= sum(legs[i:j]) + slower_min and \
                    (not marginal_cost or marginal_cells(points[i], points[j])
                     <= sum(marginal_cells(points[k], points[k + 1]) for k in range(i, j))):
                break
            j -= 1
        out.append(points[j])
        i = j
    return out


# --- Random grids ----------------------------------------------------------


def _grid(seed: int, closed_share: float = 0.15, marginal_share: float = 0.15):
    rng = np.random.default_rng(seed)
    start = (float(rng.uniform(30, 47)), float(rng.uniform(-120, -75)))
    end = (start[0] + float(rng.uniform(-6, 6)), start[1] + float(rng.uniform(-9, 9)))
    grid = ro._Grid(start, end)
    grid.closed[rng.random((grid.rows, grid.cols)) < closed_share] = 0
    grid.marginal[rng.random((grid.rows, grid.cols)) < marginal_share] = 1
    grid.dear[rng.random((grid.rows, grid.cols)) < 0.1] = 0.5
    grid.offshore = rng.random((grid.rows, grid.cols)) * (rng.random((grid.rows, grid.cols)) < 0.2)
    gs = rng.uniform(60.0, 160.0, (grid.rows, grid.cols, 8))
    return grid, gs, start, end, rng


def _walk(grid, start, end, rng) -> list[tuple]:
    """A way from end to end through cell centres, as _way's are drawn."""
    cell, last = grid.cell(start), grid.cell(end)
    cells = [cell]
    while cell != last and len(cells) < 400:
        dr = int(np.sign(last[0] - cell[0])) if rng.random() < 0.8 else int(rng.integers(-1, 2))
        dc = int(np.sign(last[1] - cell[1])) if rng.random() < 0.8 else int(rng.integers(-1, 2))
        cell = (min(max(cell[0] + dr, 0), grid.rows - 1), min(max(cell[1] + dc, 0), grid.cols - 1))
        if cell != cells[-1]:
            cells.append(cell)
    return [start] + [grid.centre(c) for c in cells[1:-1]] + [end]


@pytest.mark.parametrize("seed", range(40))
def test_line_cells_and_minutes_are_the_pythons(seed):
    grid, gs, start, end, rng = _grid(seed)
    pairs = [((float(rng.uniform(grid.lat0, grid.lat0 + grid.rows * ro.CELL_DEG)),
               float(rng.uniform(grid.lon0, grid.lon0 + grid.cols * ro.CELL_DEG))),
              (float(rng.uniform(grid.lat0 - 1, grid.lat0 + grid.rows * ro.CELL_DEG + 1)),
               float(rng.uniform(grid.lon0 - 1, grid.lon0 + grid.cols * ro.CELL_DEG + 1)))) for _ in range(60)]
    pairs += [(start, end), (start, start), (grid.centre((0, 0)), grid.centre((grid.rows - 1, grid.cols - 1)))]
    for a, b in pairs:
        assert grid.line_cells(a, b) == _cells(grid, a, b)
        for marginal_cost, water_cost in ((0.0, 0.0), (ro.MARGINAL_COST, 0.0), (0.0, ro.WATER_COST)):
            assert ro._line_minutes(grid, gs, a, b, marginal_cost, water_cost) == \
                _minutes(grid, gs, a, b, marginal_cost, water_cost)


@pytest.mark.parametrize("seed", range(60))
def test_straightened_turns_are_the_pythons(seed):
    grid, gs, start, end, rng = _grid(seed, closed_share=0.25 if seed % 2 else 0.05)
    points = _walk(grid, start, end, rng)
    for marginal_cost, water_cost in ((0.0, 0.0), (ro.MARGINAL_COST, 0.0), (0.0, ro.WATER_COST)):
        for slower in (1.0, 6.0, 24.0):
            assert ro._straightened(grid, gs, points, marginal_cost, slower, water_cost) == \
                _turns(grid, gs, points, marginal_cost, slower, water_cost)


def test_minutes_average_as_numpy_does():
    """np.mean's pairwise sum, which the minutes hang on, at every length
    round its blocks of 8 and 128."""
    rng = np.random.default_rng(7)
    grid = ro._Grid((37.0, -125.0), (37.0, -67.0))
    gs = rng.uniform(1.0, 300.0, (grid.rows, grid.cols, 8))
    grid.dear[:] = rng.random((grid.rows, grid.cols)) * 10.0 ** rng.integers(-6, 3, (grid.rows, grid.cols))
    lat = grid.centre((grid.rows // 2, 0))[0]
    for n in [*range(2, 40), 127, 128, 129, 200, 255, 256, 257]:
        a, b = (lat, grid.lon0 + 0.5 * ro.CELL_DEG), (lat, grid.lon0 + (n - 0.5) * ro.CELL_DEG)
        assert len(grid.line_cells(a, b)) == n
        assert ro._line_minutes(grid, gs, a, b) == _minutes(grid, gs, a, b)


# --- Real routes' grids, as the Python answered on 2026-11-02 --------------


@pytest.mark.parametrize("route", ["KMSP-KDEN", "KDLH-KSTL"])
def test_real_routes_turn_where_the_python_turned(route):
    arrays = np.load(FIXTURES / f"route-{route}.npz")
    cases = json.loads(gzip.decompress((FIXTURES / f"route-{route}.json.gz").read_bytes()))
    grid = ro._Grid.__new__(ro._Grid)
    grid.lat0, grid.lon0 = (float(v) for v in arrays["corner"])
    grid.closed, grid.marginal, grid.dear, grid.offshore = (arrays[k] for k in ("closed", "marginal", "dear", "offshore"))
    grid.rows, grid.cols = grid.closed.shape
    grid.ends = {tuple(int(v) for v in e) for e in arrays["ends"]}
    grid._lines = {}
    gs = arrays["gs"]
    assert cases
    for case in cases:
        points = [tuple(p) for p in case["points"]]
        mc, wc = case["marginal_cost"], case["water_cost"]
        assert ro._straightened(grid, gs, points, mc, case["slower_min"], wc) == [tuple(p) for p in case["turns"]]
        assert [ro._line_minutes(grid, gs, p, q, mc, wc) for p, q in zip(points, points[1:])] == case["legs_min"]
        assert [grid.line_cells(points[0], p) for p in points[1:]] == \
            [[tuple(c) for c in cells] for cells in case["cells_from_first"]]


# --- The airspace at a point -------------------------------------------------


@pytest.fixture(scope="module")
def chicago(tmp_path_factory) -> Path:
    where = tmp_path_factory.mktemp("airspace") / "chicago_airspace.shp"
    for part in ("shp", "dbf"):
        where.with_suffix(f".{part}").write_bytes(gzip.decompress((FIXTURES / f"chicago_airspace.{part}.gz").read_bytes()))
    shutil.copy(FIXTURES / "chicago_airspace.shx", where.with_suffix(".shx"))
    return where


def test_real_taps_find_the_volumes_the_shapely_code_found(chicago):
    taps = json.loads((FIXTURES / "chicago_airspace.json").read_text())
    for name, tap in taps.items():
        assert airspace_at.volumes_at(*tap["at"], chicago) == tap["volumes"], name


def test_a_shape_holds_what_shapely_says_it_holds(chicago):
    """Random points in each volume's box -- Chicago's Class B, C, D and E,
    their shelves and cut-outs -- against shapely."""
    rng = np.random.default_rng(3)
    shp = chicago.read_bytes()
    shx = np.frombuffer(chicago.with_suffix(".shx").read_bytes(), dtype=">i4", offset=100).reshape(-1, 2)
    reader = shapefile.Reader(str(chicago))
    held = 0
    for i, (offset, length) in enumerate(shx):
        shape = reader.shape(i)
        polygon = shapely_shape(shape.__geo_interface__)
        content = shp[int(offset) * 2 + 8:int(offset) * 2 + 8 + int(length) * 2]
        x0, y0, x1, y1 = shape.bbox
        for x, y in zip(rng.uniform(x0, x1, 300), rng.uniform(y0, y1, 300)):
            inside = polygon.contains(Point(x, y))
            held += inside
            assert vfr_native.shape_holds(content, float(x), float(y)) == inside, (i, x, y)
    reader.close()
    assert held > 1000
