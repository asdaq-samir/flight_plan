"""vfr.charts: the FAA chart cycle, the tile grid, finding the chart
face in a raster, and rendering tiles from more than one sheet."""
import datetime as dt
import io
import re

import numpy as np
import pytest
import rasterio
from PIL import Image
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
            assert re.fullmatch(r"[A-Za-z][A-Za-z0-9_\-]*", name), name
            assert west < east and south < north, name
            # The Aleutians' western sheets straddle the antimeridian
            # and are deliberately not listed.
            assert -180 < west and east < -55 and 12 < south and north < 73, name
    # The route this project was built around is covered by every kind.
    here = (C81[1], C81[0], C81[1], C81[0])
    for kind in charts.KINDS:
        assert any(charts._intersects(box, here) for box in charts.COVERAGE[kind].values()), kind


def test_zip_urls_follow_each_kind_and_the_caribbean_exception():
    assert charts.zip_url(charts.SECTIONAL, "Green_Bay", "09-03-2026") == \
        "https://aeronav.faa.gov/visual/09-03-2026/sectional-files/Green_Bay.zip"
    assert charts.zip_url(charts.TAC, "Chicago", "09-03-2026") == \
        "https://aeronav.faa.gov/visual/09-03-2026/tac-files/Chicago_TAC.zip"
    assert charts.zip_url(charts.IFR_LOW, "enr_l12", "09-03-2026") == \
        "https://aeronav.faa.gov/enroute/09-03-2026/enr_l12.zip"
    assert charts.zip_url(charts.SECTIONAL, "Caribbean_1_VFR", "09-03-2026") == \
        "https://aeronav.faa.gov/visual/09-03-2026/Caribbean/Caribbean_1_VFR.zip"
    assert charts._is_chart_member(charts.SECTIONAL, "Hawaiian Islands SEC.tif")
    assert not charts._is_chart_member(charts.SECTIONAL, "Honolulu Inset SEC.tif")
    assert charts._is_chart_member(charts.SECTIONAL, "Caribbean 1 VFR Chart.tif")
    assert not charts._is_chart_member(charts.TAC, "Chicago FLY.tif")
    assert charts._is_chart_member(charts.IFR_LOW, "ENR_L34.tif")
    assert not charts._is_chart_member(charts.IFR_LOW, "ENR_L34_BOST_INSET.tif")


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


def _rgb_raster(path, box_deg, rgb):
    """A three-band GeoTIFF in web mercator, the way the IFR charts come."""
    height, width = rgb.shape[:2]
    transform = from_bounds(*transform_bounds("EPSG:4326", "EPSG:3857", *box_deg), width, height)
    with rasterio.open(
        path, "w", driver="GTiff", width=width, height=height, count=3, dtype="uint8",
        crs="EPSG:3857", transform=transform,
    ) as ds:
        ds.write(np.moveaxis(rgb, -1, 0))


def test_render_and_detect_read_three_band_rasters_too(tmp_path):
    box = (-92.0, 40.0, -88.0, 44.0)
    rgb = np.full((1000, 1000, 3), 255, np.uint8)             # paper
    rgb[100:900, 250:, :] = (216, 232, 206)                  # a face: tinted
    rgb[899:901, 250:, :] = 0                                # south neatline
    rgb[100:900, 249:252, :] = 0                             # west neatline
    _rgb_raster(tmp_path / "ifr.tif", box, rgb)
    raster = charts.Raster(tmp_path / "ifr.tif", face=box, envelope=box)
    tile = charts.render_tile([raster], 63, 94, 8)   # 91.4W to 90W, inside the tinted part
    assert tile is not None and tuple(tile[128, 128]) == (216, 232, 206, 255)
    envelope, face = charts.detect_face(tmp_path / "ifr.tif", charts.IFR_LOW)
    assert face[0] == pytest.approx(-91.0, abs=0.02)
    assert face[1] == pytest.approx(40.4, abs=0.1)


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


def test_palette_png_keeps_the_colours_and_the_transparency():
    # A busy top half from a small palette, the way a chart tile is
    # (linework and labels over a handful of tints), and a transparent
    # bottom half.
    rng = np.random.default_rng(7)
    colours = np.array([(216, 232, 206), (0, 0, 0), (248, 248, 88), (8, 104, 136), (184, 152, 152)], np.uint8)
    rgba = np.zeros((256, 256, 4), np.uint8)
    rgba[:128, :, :3] = colours[rng.integers(0, len(colours), (128, 256))]
    rgba[:128, :, 3] = 255
    rgba[64, 64, :3] = (216, 232, 206)
    rgba[64, 15, :3] = (0, 0, 0)
    png = charts.encode_png(rgba)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    back = charts._decode_rgba(png)
    assert tuple(back[64, 64]) == (216, 232, 206, 255)
    assert tuple(back[64, 15]) == (0, 0, 0, 255)
    assert back[200, 64, 3] == 0
    assert (back[:128, :, 3] == 255).all()
    rgba_png = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(rgba_png, format="PNG")
    assert len(png) < len(rgba_png.getvalue()) / 2


def test_render_pyramid_writes_every_tile_of_every_sheet_and_composites_seams(tmp_path, monkeypatch):
    monkeypatch.setattr(charts, "CHART_TILE_CACHE_DIR", tmp_path / "tiles")
    left_box, right_box = (-90.0, 41.0, -88.0, 43.0), (-88.0, 41.0, -86.0, 43.0)
    _palette_raster(tmp_path / "left.tif", left_box, np.full((512, 512), 1, np.uint8))
    _palette_raster(tmp_path / "right.tif", right_box, np.full((512, 512), 2, np.uint8))
    sheets = [
        charts.Chart(charts.SECTIONAL, "Left", "09-03-2026",
                     (charts.Raster(tmp_path / "left.tif", face=left_box, envelope=left_box),), "now"),
        charts.Chart(charts.SECTIONAL, "Right", "09-03-2026",
                     (charts.Raster(tmp_path / "right.tif", face=right_box, envelope=right_box),), "now"),
    ]
    written = charts.render_pyramid(charts.SECTIONAL, zooms=(7, 8), workers=0, charts=sheets)

    tiles = sorted(p.relative_to(tmp_path / "tiles").as_posix() for p in (tmp_path / "tiles").rglob("*.png"))
    # Zoom 7: x 32-33, y 47; zoom 8: x 64-66 (90W to 86W), y 94-95.
    assert len(tiles) == 8
    # Each sheet writes the seam tiles it shares with the other (one
    # at zoom 7, two at zoom 8), so writes outnumber files by three.
    assert written == 11
    assert "09-03-2026/sec/8/65/94.png" in tiles
    assert "09-03-2026/sec/8/64/95.png" in tiles
    assert not any(t.startswith("09-03-2026/sec/8/67/") for t in tiles)

    # The seam tile at 88W carries both sheets.
    seam = charts._decode_rgba((tmp_path / "tiles" / "09-03-2026" / "sec" / "8" / "65" / "94.png").read_bytes())
    west, _, east, _ = charts.tile_bbox_wgs84(65, 94, 8)
    col = lambda lon: int((lon - west) / (east - west) * 256)  # noqa: E731
    assert tuple(seam[200, col(-88.3)]) == (255, 0, 0, 255)
    assert tuple(seam[200, col(-87.7)]) == (0, 0, 255, 255)
    assert seam[2, 128, 3] == 0

    progress = charts.pyramid_status("09-03-2026")["sec"]
    assert progress["rasters_done"] == 2 and progress["finished_at"] and progress["tiles_written"] == written
    assert charts.pyramid_complete("09-03-2026", ("sec",))
    assert not charts.pyramid_complete("09-03-2026")   # no TAC pyramid yet

    # A second run finds every tile complete and writes nothing.
    assert charts.render_pyramid(charts.SECTIONAL, zooms=(7, 8), workers=0, charts=sheets) == 0

    # Adjacent faces that meet are no gap; a face pulled back is.
    assert charts.face_gaps(sheets) == []
    apart = [sheets[0], charts.Chart(charts.SECTIONAL, "Right", "09-03-2026",
                                     (charts.Raster(tmp_path / "right.tif", face=(-87.9, 41.0, -86.0, 43.0), envelope=right_box),), "now")]
    assert charts.face_gaps(apart) == [("left", "right", 0.1)]


def test_serving_cycle_is_the_newest_complete_pyramid(tmp_path, monkeypatch):
    monkeypatch.setattr(charts, "CHART_TILE_CACHE_DIR", tmp_path / "tiles")
    monkeypatch.setattr(charts, "CHARTS_DIR", tmp_path / "charts")
    monkeypatch.setattr(charts, "current_cycle", lambda *a, **k: "10-29-2026")
    monkeypatch.setattr(charts, "_serving_cache", {"value": None, "at": 0.0})

    # Nothing on disk: the FAA's current cycle, rendered on demand.
    assert charts.serving_cycle() == "10-29-2026"

    done = {"kind": "sec", "zooms": [3], "started_at": "t", "finished_at": "t", "rasters_total": 1,
            "rasters_done": 1, "tiles_written": 1, "current": None}
    charts._write_pyramid_status("09-03-2026", done)
    charts._write_pyramid_status("10-29-2026", {**done, "finished_at": None})   # the new one, still rendering
    assert charts.serving_cycle() == "09-03-2026"
    assert charts.refresh_due()

    # A render of the current cycle in progress, by anyone, counts as
    # running -- until its status file goes stale.
    assert charts.refresh_running()
    monkeypatch.setattr(charts, "_RENDER_STALE_S", -1)
    assert not charts.refresh_running()
    monkeypatch.setattr(charts, "_RENDER_STALE_S", 600)

    for kind in charts.KINDS:
        charts._write_pyramid_status("10-29-2026", {**done, "kind": kind})
    assert charts.serving_cycle() == "10-29-2026"
    assert not charts.refresh_due()
    assert not charts.refresh_running()

    (tmp_path / "charts" / "09-03-2026" / "sec").mkdir(parents=True)
    (tmp_path / "charts" / "10-29-2026" / "sec").mkdir(parents=True)
    removed = charts.prune_cycles(keep="10-29-2026")
    assert sorted(removed) == ["charts/09-03-2026", "tiles/09-03-2026"]
    assert not (tmp_path / "charts" / "09-03-2026").exists()
    assert (tmp_path / "charts" / "10-29-2026").exists()
    assert not (tmp_path / "tiles" / "09-03-2026").exists()


def test_refresh_prepares_renders_and_prunes_only_when_complete(tmp_path, monkeypatch):
    monkeypatch.setattr(charts, "CHART_TILE_CACHE_DIR", tmp_path / "tiles")
    monkeypatch.setattr(charts, "CHARTS_DIR", tmp_path / "charts")
    monkeypatch.setattr(charts, "current_cycle", lambda *a, **k: "10-29-2026")
    monkeypatch.setattr(charts, "_serving_cache", {"value": None, "at": 0.0})
    calls = []
    monkeypatch.setattr(charts, "prepare_all", lambda kinds, cycle: calls.append(("prepare", kinds, cycle)))

    def fake_render(kind, workers=2, cycle=None, **kw):
        calls.append(("render", kind.key, cycle))
        charts._write_pyramid_status(cycle, {"kind": kind.key, "zooms": [], "started_at": "t", "finished_at": "t",
                                             "rasters_total": 0, "rasters_done": 0, "tiles_written": 0, "current": None})
        return 0

    monkeypatch.setattr(charts, "render_pyramid", fake_render)
    (tmp_path / "tiles" / "09-03-2026").mkdir(parents=True)

    assert charts.refresh(workers=1) == "10-29-2026"
    assert calls == [("prepare", tuple(charts.KINDS), "10-29-2026")] + [("render", k, "10-29-2026") for k in charts.KINDS]
    assert not (tmp_path / "tiles" / "09-03-2026").exists()   # pruned once the new cycle was complete
    calls.clear()
    assert charts.refresh(workers=1) == "10-29-2026"
    assert calls == []                                        # already complete: nothing to do


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
