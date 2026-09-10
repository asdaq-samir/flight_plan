import numpy as np
import pytest

from vfr.chartvision import (
    DEFAULT_ZOOM,
    Landmark,
    Mosaic,
    _dedupe,
    corridor_tiles,
    global_px_to_latlon,
    latlon_to_global_px,
    metres_per_pixel,
    tile_blocks,
)

WISCONSIN = (44.3667, -89.8478)


def test_pixel_projection_round_trips():
    x, y = latlon_to_global_px(*WISCONSIN)
    lat, lon = global_px_to_latlon(x, y)
    assert lat == pytest.approx(WISCONSIN[0], abs=1e-6)
    assert lon == pytest.approx(WISCONSIN[1], abs=1e-6)


def test_pixel_ground_size_shrinks_toward_the_pole():
    """Web mercator stretches with latitude, so blob areas would be
    overstated in the north if this were treated as a constant."""
    assert metres_per_pixel(60.0) < metres_per_pixel(20.0)


def test_a_zoom12_pixel_is_tens_of_metres():
    assert 25 < metres_per_pixel(44.0, DEFAULT_ZOOM) < 45


def test_corridor_tiles_follow_the_route_not_its_bounding_box():
    """The reason blocks exist: a long diagonal's bounding box is mostly
    empty, and fetching it would multiply the tile count for nothing."""
    start, end = (42.32, -88.07), (46.84, -92.20)
    tiles = corridor_tiles(start, end, half_width_nm=2.0)
    xs = [x for x, _ in tiles]
    ys = [y for _, y in tiles]
    bounding_box = (max(xs) - min(xs) + 1) * (max(ys) - min(ys) + 1)
    assert len(tiles) < bounding_box / 5


def test_corridor_tiles_have_no_gap_along_the_route():
    """A skipped tile would silently lose every landmark inside it."""
    tiles = set(corridor_tiles((42.32, -88.07), (46.84, -92.20), half_width_nm=2.0))
    for x, y in tiles:
        neighbours = [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1),
                      (x + 1, y + 1), (x - 1, y - 1), (x + 1, y - 1), (x - 1, y + 1)]
        assert any(n in tiles for n in neighbours), f"tile {(x, y)} is isolated"


def test_blocks_cover_every_tile():
    tiles = corridor_tiles((42.32, -88.07), (46.84, -92.20), half_width_nm=2.0)
    covered = {t for block in tile_blocks(tiles) for t in block}
    assert covered == set(tiles)


def test_blocks_stay_small_enough_to_allocate():
    """The point of blocks is bounded allocation, so the test is on the
    stitched rectangle's area rather than on its shape. Blocks advance in
    columns along the corridor and take its full thickness, so the second
    dimension is whatever the corridor happens to be."""
    tiles = corridor_tiles((42.32, -88.07), (46.84, -92.20), half_width_nm=2.0)
    for block in tile_blocks(tiles, max_span=6):
        xs = [x for x, _ in block]
        ys = [y for _, y in block]
        assert (max(xs) - min(xs) + 1) <= 6
        assert (max(xs) - min(xs) + 1) * (max(ys) - min(ys) + 1) <= 6 * 12


def test_blocks_do_not_re_stitch_the_corridor_many_times_over():
    """Overlap is needed so a lake on a seam is seen whole, but the first
    version overlapped in both axes and re-stitched 369 tiles to cover
    198 on a corridor barely three tiles thick."""
    tiles = corridor_tiles((42.32, -88.07), (46.84, -92.20), half_width_nm=2.0)
    loads = sum(len(block) for block in tile_blocks(tiles))
    assert loads < len(tiles) * 1.4


def test_blocks_overlap_so_a_feature_on_a_seam_is_seen_whole():
    tiles = corridor_tiles((42.32, -88.07), (46.84, -92.20), half_width_nm=2.0)
    blocks = tile_blocks(tiles)
    seen = [t for block in blocks for t in block]
    assert len(seen) > len(set(seen)), "no tile appears twice, so no block overlaps"


def test_empty_tile_list_yields_no_blocks():
    assert tile_blocks([]) == []


def _lm(lat, lon, area, category="water"):
    return Landmark(category=category, lat=lat, lon=lon, area_m2=area, score=4.0, pixels=int(area))


def test_dedupe_keeps_the_larger_sighting():
    """Whichever block saw more of the feature saw it better."""
    kept = _dedupe([_lm(44.0, -89.0, 1000.0), _lm(44.0001, -89.0001, 5000.0)])
    assert len(kept) == 1
    assert kept[0].area_m2 == 5000.0


def test_dedupe_keeps_genuinely_separate_features():
    kept = _dedupe([_lm(44.0, -89.0, 1000.0), _lm(44.2, -89.2, 1000.0)])
    assert len(kept) == 2


def test_dedupe_does_not_merge_across_categories():
    kept = _dedupe([_lm(44.0, -89.0, 1000.0, "water"), _lm(44.0, -89.0, 1000.0, "town")])
    assert len(kept) == 2


def test_mosaic_maps_its_own_pixels_back_to_the_world():
    x, y = latlon_to_global_px(*WISCONSIN)
    origin = (int(x) - 100, int(y) - 50)
    mosaic = Mosaic(pixels=np.zeros((256, 256, 3), np.uint8), origin_px=origin, zoom=DEFAULT_ZOOM)
    lat, lon = mosaic.to_latlon(x - origin[0], y - origin[1])
    assert lat == pytest.approx(WISCONSIN[0], abs=1e-4)
    assert lon == pytest.approx(WISCONSIN[1], abs=1e-4)


# --- the course walk must follow the great circle, not a pixel-space line ---

from vfr.chartvision import great_circle_pixels, global_px_to_latlon  # noqa: E402
from vfr.geo import cross_track_distance_nm  # noqa: E402

C81, KDLH = (42.3246, -88.0741), (46.8419, -92.1987)


def test_course_pixels_stay_on_the_great_circle():
    """The bug this guards: interpolating straight between the endpoints
    in pixel space is a rhumb line. On this 323 nm route that drifted up
    to 0.6 nm off course, growing with distance, so detected crossings
    landed nowhere near the ones picked by hand -- recall against real
    labels was 3% and went to 71% once fixed."""
    path = great_circle_pixels(C81, KDLH)
    worst = 0.0
    for px, py in path[::200]:
        lat, lon = global_px_to_latlon(px, py)
        worst = max(worst, abs(cross_track_distance_nm(lat, lon, C81, KDLH)))
    assert worst < 0.01, f"course path drifts {worst:.3f} nm off the great circle"


def test_a_pixel_space_line_would_have_failed_this_test():
    """Shows the guard above has teeth, by measuring the drift of the
    approach it replaced."""
    x0, y0 = latlon_to_global_px(*C81)
    x1, y1 = latlon_to_global_px(*KDLH)
    worst = 0.0
    for t in np.linspace(0, 1, 50):
        lat, lon = global_px_to_latlon(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
        worst = max(worst, abs(cross_track_distance_nm(lat, lon, C81, KDLH)))
    assert worst > 0.1, "the rhumb line is supposed to drift; this test is the control"


def test_course_pixels_start_and_end_at_the_airports():
    path = great_circle_pixels(C81, KDLH)
    for point, expected in ((path[0], C81), (path[-1], KDLH)):
        lat, lon = global_px_to_latlon(point[0], point[1])
        assert lat == pytest.approx(expected[0], abs=1e-4)
        assert lon == pytest.approx(expected[1], abs=1e-4)


def test_course_pixels_are_about_one_pixel_apart():
    path = great_circle_pixels(C81, KDLH)
    steps = np.hypot(np.diff(path[:, 0]), np.diff(path[:, 1]))
    assert 0.5 < steps.mean() < 2.0


def test_identical_endpoints_yield_no_path():
    assert len(great_circle_pixels(C81, C81)) == 0
