"""vfr.charts: the FAA chart cycle, the tile grid, finding the chart
face in a raster, and rendering tiles from more than one sheet."""
import datetime as dt
import re

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import transform_bounds

from vfr import charts

C81 = (42.3225, -88.0742)  # Campbell, Grayslake IL


def test_cycle_arithmetic_from_the_anchor():
    assert charts.cycle_from_anchor(dt.date(2026, 9, 3)) == "09-03-2026"
    assert charts.cycle_from_anchor(dt.date(2026, 9, 20)) == "09-03-2026"
    assert charts.cycle_from_anchor(dt.date(2026, 10, 28)) == "09-03-2026"
    assert charts.cycle_from_anchor(dt.date(2026, 10, 29)) == "10-29-2026"
    assert charts.cycle_from_anchor(dt.date(2026, 7, 9)) == "07-09-2026"


def test_products_page_yields_the_cycle_already_in_effect():
    """Near a changeover the page links both editions; the next one's
    files are not there to download until its date."""
    html = (
        '<a href="https://aeronav.faa.gov/visual/09-03-2026/sectional-files/Chicago.zip">current</a>'
        '<a href="https://aeronav.faa.gov/visual/10-29-2026/sectional-files/Chicago.zip">next</a>'
    )
    assert charts.cycle_from_products_page(html, dt.date(2026, 9, 20)) == "09-03-2026"
    assert charts.cycle_from_products_page(html, dt.date(2026, 10, 29)) == "10-29-2026"
    assert charts.cycle_from_products_page("<p>no charts here</p>", dt.date(2026, 9, 20)) is None


def test_current_cycle_never_fetches_when_told_not_to(monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("must not touch the network")

    monkeypatch.setattr(charts.requests, "get", boom)
    monkeypatch.setattr(charts, "_cycle_cache", {"value": None, "at": 0.0})
    assert charts.current_cycle(dt.date(2026, 9, 20), fetch=False) == "09-03-2026"


def test_tile_bbox_wgs84_contains_a_known_point():
    west, south, east, north = charts.tile_bbox_wgs84(65, 94, 8)
    assert west < C81[1] < east
    assert south < C81[0] < north
    assert west == pytest.approx(-88.59375)
    assert north == pytest.approx(43.0689, abs=1e-3)


def test_coverage_index_is_well_formed():
    for kind, boxes in charts.COVERAGE.items():
        assert kind in charts.KINDS
        for name, (west, south, east, north) in boxes.items():
            assert re.fullmatch(r"[A-Za-z][A-Za-z_\-]*", name), name
            assert west < east and south < north, name
            assert -130 < west and east < -60 and 20 < south and north < 50, name
    # The route this project was built around is covered by both kinds.
    assert charts._intersects(charts.COVERAGE["sec"]["Chicago"], (C81[1], C81[0], C81[1], C81[0]))
    assert charts._intersects(charts.COVERAGE["tac"]["Chicago"], (C81[1], C81[0], C81[1], C81[0]))


def test_snap_pulls_a_sectional_edge_onto_the_quarter_degree():
    assert charts._snap(43.9994) == 44.0
    assert charts._snap(-92.9971) == -93.0
    assert charts._snap(41.4416) == 41.4416   # a TAC-like edge stays measured


PALETTE = {
    0: (255, 255, 255, 255),  # paper
    1: (255, 0, 0, 255),
    2: (0, 0, 255, 255),
    7: (0, 0, 0, 255),        # ink
    8: (216, 232, 206, 255),  # the sectional's land tint
}


def _palette_raster(path, box_deg, data):
    """A palette GeoTIFF in web mercator covering `box_deg`."""
    height, width = data.shape
    transform = from_bounds(*transform_bounds("EPSG:4326", "EPSG:3857", *box_deg), width, height)
    with rasterio.open(
        path, "w", driver="GTiff", width=width, height=height, count=1, dtype="uint8",
        crs="EPSG:3857", transform=transform,
    ) as ds:
        ds.write(data, 1)
        ds.write_colormap(1, PALETTE)


def test_render_composites_two_sheets_and_clips_each_to_its_face(tmp_path):
    left_box, right_box = (-90.0, 41.0, -88.0, 43.0), (-88.0, 41.0, -86.0, 43.0)
    _palette_raster(tmp_path / "left.tif", left_box, np.full((512, 512), 1, np.uint8))
    _palette_raster(tmp_path / "right.tif", right_box, np.full((512, 512), 2, np.uint8))
    rasters = [
        charts.Raster(tmp_path / "left.tif", face=left_box, envelope=left_box),
        charts.Raster(tmp_path / "right.tif", face=right_box, envelope=right_box),
    ]

    # Tile 65/94 at zoom 8 straddles the seam at 88W and the sheets'
    # north edge at 43N.
    rgba = charts.render_tile(rasters, 65, 94, 8)
    assert rgba is not None and rgba.shape == (256, 256, 4)
    west, _, east, _ = charts.tile_bbox_wgs84(65, 94, 8)

    def col(lon):
        return int((lon - west) / (east - west) * 256)

    assert tuple(rgba[200, col(-88.3)]) == (255, 0, 0, 255)
    assert tuple(rgba[200, col(-87.7)]) == (0, 0, 255, 255)
    assert rgba[2, 128, 3] == 0            # north of both faces: transparent
    assert rgba[200, col(-88.3) - 1:col(-87.7), 3].all()   # nothing missing along the seam

    assert charts.render_tile(rasters, 65, 80, 8) is None   # far to the north


def test_detect_face_reads_neatlines_and_where_the_chart_runs_out(tmp_path):
    """A synthetic sheet, 4x4 degrees at 2000 px: a tinted face with an
    inked neatline on its west and south edges inside a paper collar,
    running on to the sheet's own east edge, and under a row of paper
    (the communication boxes) along the north."""
    box = (-92.0, 40.0, -88.0, 44.0)
    px_per_deg = 500
    data = np.zeros((2000, 2000), np.uint8)  # paper

    def col(lon):
        return int((lon - box[0]) * px_per_deg)

    def row(lat):
        # Rows run north to south; the raster is mercator, so equal
        # spacing in the transform is what these coordinates follow.
        y_top, y_bottom = (transform_bounds("EPSG:4326", "EPSG:3857", *box)[i] for i in (3, 1))
        y = transform_bounds("EPSG:4326", "EPSG:3857", box[0], lat, box[2], lat)[1]
        return int((y_top - y) / (y_top - y_bottom) * 2000)

    data[row(43.6):row(41.0), col(-91.0):] = 8               # the face
    data[row(41.0) - 1:row(41.0) + 2, col(-91.0):] = 7       # south neatline
    data[row(43.6):row(41.0), col(-91.0) - 1:col(-91.0) + 2] = 7   # west neatline
    _palette_raster(tmp_path / "sheet.tif", box, data)

    envelope, face = charts.detect_face(tmp_path / "sheet.tif", charts.SECTIONAL)
    assert envelope == pytest.approx(box, abs=1e-3)
    west, south, east, north = face
    assert west == -91.0 and south == 41.0                    # neatlines, snapped
    assert -88.35 <= east <= -88.0                            # the sheet's own edge, less the margin
    assert 43.3 <= north <= 43.55                             # under the boxes, less the margin


def test_tile_png_caches_the_render_and_remembers_empty_tiles(tmp_path, monkeypatch):
    monkeypatch.setattr(charts, "CHART_TILE_CACHE_DIR", tmp_path / "tiles")
    monkeypatch.setattr(charts, "current_cycle", lambda *a, **k: "09-03-2026")
    box = (-90.0, 41.0, -86.0, 43.0)
    _palette_raster(tmp_path / "sheet.tif", box, np.full((256, 256), 1, np.uint8))
    raster = charts.Raster(tmp_path / "sheet.tif", face=box, envelope=box)
    calls = []

    def covering(kind, bbox, cycle=None):
        calls.append(bbox)
        return ([raster] if charts._intersects(box, bbox) else []), True

    monkeypatch.setattr(charts, "rasters_covering", covering)

    first = charts.tile_png(65, 94, 8, "sec")
    assert first and first[:8] == b"\x89PNG\r\n\x1a\n"
    assert charts.tile_cached(65, 94, 8, "sec")
    monkeypatch.setattr(charts, "render_tile", lambda *a: pytest.fail("cached tiles are not re-rendered"))
    assert charts.tile_png(65, 94, 8, "sec") == first
    assert len(calls) == 1

    assert charts.tile_png(65, 80, 8, "sec") is None
    assert (tmp_path / "tiles" / "09-03-2026" / "sec" / "8" / "65" / "80.none").exists()
    assert charts.tile_png(65, 80, 8, "sec") is None
    assert len(calls) == 2

    assert charts.tile_png(65, 94, 20, "sec") is None        # past the chart's own zoom range

    image = charts.tile_image(65, 94, 8, "sec")
    assert image is not None and image.mode == "RGB"
    assert image.getpixel((128, 200)) == (255, 0, 0)
