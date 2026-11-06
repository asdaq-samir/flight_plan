"""wingtip.ground_grid: the ground under the lower 48 read once, and a leg's
floor read from it (wingtip.terrain.floor_profile)."""
import numpy as np
import pytest

from wingtip import congested, elevation, faa_data, geo, ground_grid, terrain

START, END = (45.0, -90.0), (45.0, -89.0)   # due east, about 42.4 nm
TOTAL_NM = geo.distance_nm(*START, *END)


def cell(lat, lon):
    return int((lat - ground_grid.SOUTH) * ground_grid.PER_DEG), int((lon - ground_grid.WEST) * ground_grid.PER_DEG)


@pytest.fixture
def grid(monkeypatch, tmp_path):
    """Flat ground at 1,000 ft (its lowest 900) over the grid's whole
    extent; no obstacles."""
    high = np.full((ground_grid.ROWS, ground_grid.COLS), 1000, dtype=np.int16)
    low = np.full((ground_grid.ROWS, ground_grid.COLS), 900, dtype=np.int16)
    monkeypatch.setattr(ground_grid, "_grids", lambda: (high, low))
    monkeypatch.setattr(faa_data, "_OBSTACLES_CACHE", {})
    # Over a town everywhere: 14 CFR 91.119(b)'s 1,000 ft (wingtip.congested).
    monkeypatch.setattr(congested, "congested", lambda lats, lons: np.ones(len(lats), dtype=bool))
    dof = tmp_path / "DOF.DAT"
    dof.write_text("", encoding="latin-1")
    monkeypatch.setattr(faa_data, "ensure_nasr_file", lambda name, cache_dir: dof, raising=False)
    return high, low


def test_a_legs_floor_is_its_highest_cell_with_the_margin_and_its_lowest_ground_the_lowest(grid):
    high, low = grid
    # A ridge in one cell half way along: a two-mile sampling could step over it.
    high[cell(45.0, -89.5)] = 2350
    low[cell(45.0, -89.2)] = 600
    (segment,) = terrain.floor_profile(START, END, [0.0, TOTAL_NM])
    # 14 CFR 91.119(b)'s 1,000 ft over the ridge and the resampling's 150,
    # rounded up to the hundred.
    assert segment.floor_ft == 3500
    assert segment.lowest_ground_ft == 600


def test_the_ridge_counts_for_the_leg_over_it_alone(grid):
    high, _ = grid
    high[cell(45.0, -89.2)] = 2350
    floors = [s.floor_ft for s in terrain.floor_profile(START, END, [0.0, TOTAL_NM / 2, TOTAL_NM])]
    assert floors == [2200, 3500]


def test_outside_the_grid_or_where_no_tile_reached_the_tiles_are_read(grid):
    high, _ = grid
    assert ground_grid.ground_ft(np.array([60.0]), np.array([-150.0])) is None
    high[cell(45.0, -89.5)] = ground_grid.NONE
    lats, lons, _ = ground_grid.line_points(START, END)
    assert ground_grid.ground_ft(lats, lons) is None


def test_every_cell_the_line_crosses_holds_a_point(grid):
    lats, lons, along = ground_grid.line_points(START, END)
    rows, cols = ground_grid._cells(lats, lons)
    crossed = set(zip(rows.tolist(), cols.tolist()))
    first, last = cell(*START), cell(45.0, -89.0001)
    assert all((first[0], c) in crossed for c in range(first[1], last[1] + 1))
    assert along[-1] == pytest.approx(TOTAL_NM)


def test_a_tiles_pixels_go_into_their_cells_highest_and_lowest(monkeypatch):
    high = np.full((ground_grid.ROWS, ground_grid.COLS), ground_grid.NONE, dtype=np.int16)
    low = high.copy()
    x, y = int(ground_grid._tile_x(-90.0)), int(ground_grid._tile_y(45.0))
    heights = np.full((256, 256), 100.0)
    heights[10, 10] = 500.0        # one high pixel
    heights[200, 200] = -20.0      # one low one
    ground_grid._into(high, low, x, y, heights)
    reached = high != ground_grid.NONE
    assert reached.sum() > 100
    assert high[reached].max() == round(500 * ground_grid.M_TO_FT)
    assert low[reached].min() == round(-20 * ground_grid.M_TO_FT)
    assert np.median(high[reached]) == round(100 * ground_grid.M_TO_FT)


def test_a_grid_built_after_the_planner_started_is_taken_up(monkeypatch, tmp_path):
    clock = [1000.0]
    monkeypatch.setattr("time.monotonic", lambda: clock[0])
    monkeypatch.setattr(ground_grid, "HIGH_PATH", tmp_path / "high.npy")
    monkeypatch.setattr(ground_grid, "LOW_PATH", tmp_path / "low.npy")
    monkeypatch.setattr(ground_grid, "DONE_PATH", tmp_path / "done.json")
    monkeypatch.setattr(ground_grid, "_HELD", {})
    assert ground_grid._grids() is None
    np.save(tmp_path / "high.npy", np.zeros((2, 2), dtype=np.int16))
    np.save(tmp_path / "low.npy", np.zeros((2, 2), dtype=np.int16))
    assert ground_grid._grids() is None            # not looked for again yet
    clock[0] += ground_grid.LOOK_AGAIN_S + 1
    assert ground_grid._grids() is not None


def test_a_terrarium_void_is_no_height_and_the_sea_floor_the_seas_surface():
    # Tile 11/565/876, round 26.41 N 80.45 W: black and white pixels, the
    # encoding's -32,768 m and +32,767.996 m, between real ones (2026-11-02).
    rgb = np.zeros((1, 30, 3))
    rgb[0, :] = (128, 3, 64)         # 3.25 m, Everglades ground
    rgb[0, 0] = (0, 0, 0)
    rgb[0, 1] = (255, 255, 255)
    rgb[0, 23] = (127, 170, 64)      # -85.75 m, Badwater, 282 ft below the sea
    rgb[0, 24:] = (127, 156, 0)      # -100 m: the sea floor, so the sea's surface
    heights = elevation.terrarium_m(rgb)
    # The voids, and the pixels drawn half from them out to 11 beyond.
    assert np.isnan(heights[0, :13]).all()
    assert heights[0, 13] == 3.25
    assert heights[0, 23] == -85.75
    assert (heights[0, 24:] == 0.0).all()


def test_a_void_or_an_impossible_peak_counts_for_nothing_in_a_cell(monkeypatch):
    high = np.full((ground_grid.ROWS, ground_grid.COLS), ground_grid.NONE, dtype=np.int16)
    low = high.copy()
    x, y = int(ground_grid._tile_x(-80.45)), int(ground_grid._tile_y(26.41))
    heights = np.full((256, 256), 3.0)
    heights[100:110, 100:110] = np.nan                   # a void
    heights[50, 50] = 4933.0                              # 16,184 ft: a ringing pixel
    ground_grid._into(high, low, x, y, heights)
    reached = high != ground_grid.NONE
    assert high[reached].max() == round(3 * ground_grid.M_TO_FT)
    assert low[reached].min() == round(3 * ground_grid.M_TO_FT)
    # A tile of nothing but voids leaves its cells unreached, so a floor
    # there reads the tiles.
    empty = np.full((ground_grid.ROWS, ground_grid.COLS), ground_grid.NONE, dtype=np.int16)
    ground_grid._into(empty, empty.copy(), x, y, np.full((256, 256), np.nan))
    assert (empty == ground_grid.NONE).all()


def test_a_pixel_far_off_the_ground_round_it_is_no_height():
    # Sonora's coast at zoom 11: 4,933 m beside 72 m ground, the averaging's
    # ringing; a cliff's real step (180 m, El Capitan's at zoom 11) stays.
    rgb = np.zeros((7, 7, 3))
    rgb[:, :] = (128, 72, 0)          # 72 m
    rgb[2, 2] = (147, 69, 0)          # 4,933 m
    rgb[0, 4] = (128, 252, 0)         # 252 m: 180 m over the rest
    heights = elevation.terrarium_m(rgb)
    assert np.isnan(heights[2, 2])
    assert heights[0, 4] == 252.0
    assert np.nansum(np.isnan(heights)) == 1
