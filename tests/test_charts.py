"""vfr.charts: the FAA chart cycle, the tile grid, finding the chart
face in a raster, and rendering tiles from more than one sheet."""
import dataclasses
import datetime as dt
import io
import json
import math
import re

import numpy as np
import pytest
import rasterio
from PIL import Image
from rasterio.transform import from_bounds
from rasterio.warp import transform_bounds

from vfr import chart_faces, charts

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
    for kind, entries in charts.COVERAGE.items():
        assert kind in charts.KINDS
        for name, entry in entries.items():
            assert re.fullmatch(r"[A-Za-z][A-Za-z0-9_\-]*", name), name
            for west, south, east, north in charts._boxes(entry):
                assert west < east and south < north, name
                assert -180 <= west and east <= 180 and 12 < south and north < 73, name
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
    assert charts._is_chart_member(charts.SECTIONAL, "Hawaiian_Islands", "Hawaiian Islands SEC.tif")
    assert not charts._is_chart_member(charts.SECTIONAL, "Hawaiian_Islands", "Honolulu Inset SEC.tif")
    assert charts._is_chart_member(charts.SECTIONAL, "Caribbean_1_VFR", "Caribbean 1 VFR Chart.tif")
    assert not charts._is_chart_member(charts.TAC, "Chicago", "Chicago FLY.tif")
    assert charts._is_chart_member(charts.IFR_LOW, "enr_l34", "ENR_L34.tif")
    assert not charts._is_chart_member(charts.IFR_LOW, "enr_l34", "ENR_L34_BOST_INSET.tif")
    # The insets are sheets of their own, under the overlay kinds, out
    # of the zips they ride in.
    assert charts.zip_url(charts.TAC, "Honolulu_Inset", "09-03-2026") == \
        "https://aeronav.faa.gov/visual/09-03-2026/sectional-files/Hawaiian_Islands.zip"
    assert charts._is_chart_member(charts.TAC, "Honolulu_Inset", "Honolulu Inset SEC.tif")
    assert not charts._is_chart_member(charts.TAC, "Honolulu_Inset", "Hawaiian Islands SEC.tif")
    assert charts.zip_url(charts.IFR_AREA, "enr_a02", "09-03-2026") == \
        "https://aeronav.faa.gov/enroute/09-03-2026/enr_a02.zip"
    assert charts._is_chart_member(charts.IFR_AREA, "enr_a01", "ENR_A01_ATL.tif")
    assert not charts._is_chart_member(charts.IFR_AREA, "enr_a01", "ENR_A01_ATL.htm")
    assert charts.IFR_AREA.over == ("ifr_low", "ifr_high") and charts.TAC.over == ("sec",)
    # A coverage entry may be several boxes, for a sheet across the antimeridian.
    assert charts._covers(((170.0, 50.0, 180.0, 53.0), (-180.0, 50.0, -172.0, 53.0)), (-175.0, 51.0, -174.0, 52.0))
    assert not charts._covers(((170.0, 50.0, 180.0, 53.0), (-180.0, 50.0, -172.0, 53.0)), (-160.0, 51.0, -159.0, 52.0))


def test_snap_pulls_a_sectional_edge_onto_the_quarter_degree():
    assert chart_faces._snap(43.9994) == 44.0
    assert chart_faces._snap(-92.9971) == -93.0
    assert chart_faces._snap(41.4416) == 41.4416   # a TAC-like edge stays measured


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
    # An IFR sheet's border is the sheet's own straight rows and
    # columns: the chart area is the widest stretch between ruling
    # lines -- here from the west line to the raster's east edge and
    # from the raster's top to the south line -- and comes with a mask
    # raster that keeps the collar out of the face's corners.
    envelope, face, mask = chart_faces.detect_face(tmp_path / "ifr.tif", charts.IFR_LOW)
    assert face[0] == pytest.approx(-91.0, abs=0.03)
    assert face[1] == pytest.approx(40.4, abs=0.1)
    assert face[2] == pytest.approx(-88.0, abs=0.03)
    assert face[3] == pytest.approx(44.0, abs=0.03)
    assert mask is not None and mask.exists()
    # Rendered with the whole envelope as its face, the mask alone
    # keeps the legend column west of the border transparent.
    masked = charts.Raster(tmp_path / "ifr.tif", face=box, envelope=box, mask=mask)
    tile = charts.render_tile([masked], 63, 94, 8)          # 91.4W to 90W
    west, _, east, _ = charts.tile_bbox_wgs84(63, 94, 8)
    col = int((-91.2 - west) / (east - west) * 256)
    assert tile[128, col, 3] == 0
    assert tuple(tile[128, 200]) == (216, 232, 206, 255)
    # The sectional method on the same raster, for comparison, reads
    # the neatline as a geographic line, and has no mask.
    envelope, face, mask = chart_faces.detect_face(tmp_path / "ifr.tif", charts.SECTIONAL)
    assert face[0] == pytest.approx(-91.0, abs=0.02)
    assert mask is None


def test_a_sheet_across_the_antimeridian_is_measured_unwrapped_and_drawn_in_two(tmp_path):
    """UTM zone 1's central meridian is 177W; a raster reaching west of
    its zone crosses 180. rasterio reports its bounds wrapped (west >
    east); the face is found in unwrapped longitudes and split at 180
    into the two boxes the tile arithmetic draws."""
    import rasterio.transform

    left, top = 60_000.0, 5_900_000.0   # UTM 1 metres: 640 km from about 176.6E across 180 to 174W
    size = 1000
    data = np.zeros((size, size), np.uint8)
    data[80:920, 80:920] = 8
    data[80:920, 79:82] = 7
    data[80:920, 918:921] = 7
    data[79:82, 80:920] = 7
    data[918:921, 80:920] = 7
    with rasterio.open(
        tmp_path / "aleut.tif", "w", driver="GTiff", width=size, height=size, count=1, dtype="uint8",
        crs="EPSG:32601", transform=rasterio.transform.from_origin(left, top, 640, 640),
    ) as ds:
        ds.write(data, 1)
        ds.write_colormap(1, PALETTE)

    envelope, face, _ = chart_faces.detect_face(tmp_path / "aleut.tif", charts.SECTIONAL)
    assert envelope[0] < 180 < envelope[2] < 200          # unwrapped: east carried on past 180
    assert envelope[0] < face[0] < face[2] < envelope[2]
    parts = chart_faces.split_antimeridian(face, envelope)
    assert len(parts) == 2
    (east_face, _), (west_face, _) = parts
    assert east_face[2] == 180.0 and west_face[0] == -180.0
    assert east_face[0] == face[0] and west_face[2] == pytest.approx(face[2] - 360.0)
    assert chart_faces.split_antimeridian((-90.0, 40.0, -88.0, 44.0), (-90.5, 39.5, -87.5, 44.5)) == \
        [((-90.0, 40.0, -88.0, 44.0), (-90.5, 39.5, -87.5, 44.5))]


def test_a_straight_bordered_face_reaches_the_bow_of_its_top_edge(tmp_path):
    """An IFR sheet is a rectangle in its conic projection, and a
    parallel bows toward the pole: the rectangle's top side is
    furthest north in its middle, not at its corners. The face box
    has to reach the middle, or the strip between is drawn by nobody
    and shows as a band of map background under the neighbour's
    neatline."""
    import rasterio.transform
    import rasterio.warp

    # A conic sheet 2,000 km wide, centred on the projection's meridian.
    crs = "EPSG:5070"
    transform = rasterio.transform.from_origin(-1_000_000.0, 2_700_000.0, 2000.0, 2000.0)
    width, height = 1000, 250
    data = np.full((height, width), 8, np.uint8)
    data[19:22, 40:960] = 7
    data[228:231, 40:960] = 7
    data[19:231, 39:42] = 7
    data[19:231, 958:961] = 7
    with rasterio.open(
        tmp_path / "conic.tif", "w", driver="GTiff", width=width, height=height, count=1, dtype="uint8",
        crs=crs, transform=transform,
    ) as ds:
        ds.write(data, 1)
        ds.write_colormap(1, PALETTE)

    def lat_at(col, row):
        x, y = transform @ (col, row)
        return rasterio.warp.transform(crs, "EPSG:4326", [x], [y])[1][0]

    # The ruling lines (rows 19-21 and 228-230) are inside the chart
    # area, whole, in pooled blocks of four rows: rows 16 to 231.
    corner, middle = lat_at(36, 16), lat_at(500, 16)
    assert middle > corner + 0.3
    _, face, _ = chart_faces.detect_face(tmp_path / "conic.tif", charts.IFR_LOW)
    assert face[3] == pytest.approx(middle, abs=0.05)
    assert face[1] == pytest.approx(lat_at(36, 232), abs=0.05)


def _rgb_raster_3857(path, bounds_m, rgb):
    """A three-band GeoTIFF over web-mercator metre bounds."""
    height, width = rgb.shape[:2]
    with rasterio.open(
        path, "w", driver="GTiff", width=width, height=height, count=3, dtype="uint8",
        crs="EPSG:3857", transform=from_bounds(*bounds_m, width, height),
    ) as ds:
        ds.write(np.moveaxis(rgb, -1, 0))


def test_two_straight_bordered_sheets_meet_without_daylight(tmp_path):
    """Adjacent IFR sheets are cut on the same line: the south ruling
    line of one is the north ruling line of the next. Across the seam,
    at the charts' own zoom and at coarser ones where the seam falls
    inside a pixel, every pixel is drawn."""
    import rasterio.warp

    west, east = transform_bounds("EPSG:4326", "EPSG:3857", -92.0, 40.0, -88.0, 44.0)[::2]
    top = transform_bounds("EPSG:4326", "EPSG:3857", -92.0, 40.0, -88.0, 44.0)[3]
    bottom = transform_bounds("EPSG:4326", "EPSG:3857", -92.0, 36.0, -88.0, 40.0)[1]
    # Sheet A: 1000 rows down from 44N, its south line on rows 897-899,
    # so the line's foot is row 900 -- where sheet B's raster starts.
    a_px = (top - transform_bounds("EPSG:4326", "EPSG:3857", -92.0, 40.0, -88.0, 40.0)[1]) / 1000.0
    a = np.full((1000, 1000, 3), (216, 232, 206), np.uint8)
    a[897:900, :, :] = 0
    a[900:, :, :] = 255                                     # collar below the line
    a_bottom = top - 1000 * a_px
    _rgb_raster_3857(tmp_path / "a.tif", (west, a_bottom, east, top), a)
    b_top = top - 900 * a_px
    b = np.full((1000, 1000, 3), (255, 0, 0), np.uint8)   # a different tint, to tell the two apart
    b[0:3, :, :] = 0                                        # its north line
    _rgb_raster_3857(tmp_path / "b.tif", (west, bottom, east, b_top), b)

    rasters = []
    for name in ("a", "b"):
        envelope, face, mask = chart_faces.detect_face(tmp_path / f"{name}.tif", charts.IFR_LOW)
        rasters.append(charts.Raster(tmp_path / f"{name}.tif", face=face, envelope=envelope, mask=mask))
    assert rasters[0].face[1] <= rasters[1].face[3]        # the masks meet or overlap

    seam_lat = rasterio.warp.transform("EPSG:3857", "EPSG:4326", [west], [b_top])[1][0]
    for zoom in (6, 7, 8, 9):
        n = 2 ** zoom
        x = int((-89.0 + 180.0) / 360.0 * n)
        y = int((1.0 - math.log(math.tan(math.radians(seam_lat)) + 1.0 / math.cos(math.radians(seam_lat))) / math.pi) / 2.0 * n)
        tile = charts.render_tile(rasters, x, y, zoom)
        assert tile is not None
        lons, lats = charts._tile_lons(x, zoom), charts._tile_lats(y, zoom)
        inside = ((lons > -91.9) & (lons < -88.1))[None, :] & ((lats > 36.1) & (lats < 43.9))[:, None]
        assert (tile[:, :, 3][inside] == 255).all(), f"daylight at zoom {zoom}"
        # Clear of the line, each side is its own sheet's colour.
        col = int(np.argmin(np.abs(lons + 89.0)))
        above, below = np.flatnonzero(lats > seam_lat + 0.05), np.flatnonzero(lats < seam_lat - 0.05)
        if len(above):
            assert tuple(tile[above[-1], col, :3]) == (216, 232, 206)
        if len(below):
            assert tuple(tile[below[0], col, :3]) == (255, 0, 0)


def test_render_leaves_a_sheets_own_leaning_edge_transparent(tmp_path):
    """A sheet is a rectangle in its own projection and a leaning
    quadrilateral in web mercator; its lat/lon face can run past the
    lean. Those pixels are the neighbour's to draw, not paper."""
    import rasterio.transform

    # A palette raster in UTM zone 15 (central meridian 93W): at 88W
    # its right edge leans a few degrees off the meridian.
    left, bottom = 900_000.0, 4_600_000.0   # metres, in the zone's east
    size = 800
    data = np.full((size, size), 8, np.uint8)
    with rasterio.open(
        tmp_path / "utm.tif", "w", driver="GTiff", width=size, height=size, count=1, dtype="uint8",
        crs="EPSG:32615", transform=rasterio.transform.from_origin(left, bottom + 200_000, 250, 250),
    ) as ds:
        ds.write(data, 1)
        ds.write_colormap(1, PALETTE)
    with rasterio.open(tmp_path / "utm.tif") as src:
        envelope = tuple(transform_bounds(src.crs, "EPSG:4326", *src.bounds))
    raster = charts.Raster(tmp_path / "utm.tif", face=envelope, envelope=envelope)

    # A tile row along the raster's east edge: every pixel there is
    # either the chart's tint or transparent, never paper.
    west, south, east, north = envelope
    x0, x1, y0, y1 = charts._tile_range(envelope, 9)
    rgba = charts.render_tile([raster], x1, (y0 + y1) // 2, 9)
    assert rgba is not None
    opaque = rgba[:, :, 3] == 255
    assert opaque.any() and not opaque.all()
    assert (rgba[opaque][:, :3] == (216, 232, 206)).all()
    assert not (rgba[~opaque][:, :3] == 255).all() or (rgba[~opaque][:, :3] == 0).all()


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

    envelope, face, _ = chart_faces.detect_face(tmp_path / "sheet.tif", charts.SECTIONAL)
    assert envelope == pytest.approx(box, abs=1e-3)
    west, south, east, north = face
    assert west == -91.0 and south == 41.0                    # neatlines, snapped
    assert -88.35 <= east <= -88.0                            # the sheet's own edge, less the margin
    assert 43.3 <= north <= 43.55                             # under the boxes, less the margin

    # `python -m vfr.charts` runs vfr.charts as __main__, whose SECTIONAL
    # is an equal but different object from the one chart_faces sees:
    # the sheet must still be read as a sectional (snapped edges).
    same_kind = dataclasses.replace(charts.SECTIONAL)
    assert same_kind is not charts.SECTIONAL
    assert chart_faces.detect_face(tmp_path / "sheet.tif", same_kind)[1] == face


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

    # Adjacent faces that meet are no gap; a face pulled back is,
    # unless a third sheet lies over the strip between them.
    assert charts.face_gaps(sheets) == []
    apart = [sheets[0], charts.Chart(charts.SECTIONAL, "Right", "09-03-2026",
                                     (charts.Raster(tmp_path / "right.tif", face=(-87.9, 41.0, -86.0, 43.0), envelope=right_box),), "now")]
    assert charts.face_gaps(apart) == [("left", "right", 0.1)]
    over = (-88.5, 40.5, -87.5, 43.5)
    filler = charts.Chart(charts.SECTIONAL, "Over", "09-03-2026",
                          (charts.Raster(tmp_path / "over.tif", face=over, envelope=over),), "now")
    assert charts.face_gaps([*apart, filler]) == []


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


def test_published_pointer_decides_the_served_cycle_in_the_cloud(tmp_path, monkeypatch):
    monkeypatch.setattr(charts, "CHART_TILE_CACHE_DIR", tmp_path / "tiles")
    monkeypatch.setattr(charts, "CHART_TILES_URL", "https://d123.cloudfront.net/tiles")
    monkeypatch.setattr(charts, "current_cycle", lambda *a, **k: "10-29-2026")
    monkeypatch.setattr(charts, "_serving_cache", {"value": None, "at": 0.0})

    class Response:
        ok = True

        def json(self):
            return {"cycle": "09-03-2026"}

    calls = []
    monkeypatch.setattr(charts.requests, "get", lambda url, **kw: calls.append(url) or Response())
    assert charts.serving_cycle() == "09-03-2026"
    assert calls == ["https://d123.cloudfront.net/tiles/serving.json"]
    assert charts.tiles_base_url() == "https://d123.cloudfront.net/tiles"

    # Unreachable, the planner falls back to its own disk and the FAA's cycle.
    monkeypatch.setattr(charts, "_serving_cache", {"value": None, "at": 0.0})
    monkeypatch.setattr(charts.requests, "get", lambda url, **kw: (_ for _ in ()).throw(charts.requests.ConnectionError()))
    assert charts.serving_cycle() == "10-29-2026"


def test_publish_uploads_every_tile_once_and_points_serving_at_the_cycle(tmp_path, monkeypatch):
    monkeypatch.setattr(charts, "CHART_TILE_CACHE_DIR", tmp_path / "tiles")
    root = tmp_path / "tiles" / "09-03-2026"
    for key in ("sec/8/65/94.png", "sec/8/65/95.png", "tac/11/522/757.png"):
        (root / key).parent.mkdir(parents=True, exist_ok=True)
        (root / key).write_bytes(b"\x89PNG" + key.encode())
    charts._write_pyramid_status("09-03-2026", {"kind": "sec", "zooms": [8], "started_at": "t", "finished_at": "t",
                                                "rasters_total": 1, "rasters_done": 1, "tiles_written": 2, "current": None})

    class Client:
        def __init__(self):
            self.objects = {}

        def put_object(self, Bucket, Key, Body, ContentType, CacheControl):
            self.objects[(Bucket, Key)] = (Body, ContentType, CacheControl)

    client = Client()
    assert charts.publish("09-03-2026", "charts-bucket", prefix="tiles", workers=2, client=client) == 3
    assert client.objects[("charts-bucket", "tiles/09-03-2026/sec/8/65/94.png")][1:] == \
        ("image/png", "public, max-age=2419200, immutable")
    pointer = json.loads(client.objects[("charts-bucket", "tiles/serving.json")][0])
    assert pointer["cycle"] == "09-03-2026" and pointer["kinds"] == {"sec": 2}

    # A second run uploads nothing new but refreshes the pointer.
    before = len(client.objects)
    assert charts.publish("09-03-2026", "charts-bucket", prefix="tiles", workers=2, client=client) == 0
    assert len(client.objects) == before


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


def _masked_sheet(path, box):
    """A sheet of land tint with a masked line down it -- a road across
    the band and lettering in it -- beside two things that are paper
    too and are not a masked line: a label box with a border, and a
    dry lake whose width and edges wander."""
    data = np.full((1600, 1600), 8, np.uint8)
    data[100:1500, 700:736] = 0                       # the band, 36 px wide
    data[800:803, :] = 7                              # a road across it
    data[400:420, 710:726] = 7                        # "TAC", lettered in it
    data[298:390, 98:548] = 7                         # a label box, the shape of the real ones: border ...
    data[300:388, 100:546] = 0                        # ... and its paper
    for row in range(200, 1400):                      # a dry lake
        centre = 1250 + int(20 * math.sin(row / 90))
        half = 15 + int(10 * math.sin(row / 37)) + (row * 7919) % 5
        data[row, centre - half:centre + half] = 0
    _palette_raster(path, box, data)
    return data


def test_remove_masked_lines_gives_the_band_its_tint_back_and_nothing_else(tmp_path):
    box = (-90.0, 41.0, -88.0, 43.0)
    path = tmp_path / "sheet.tif"
    before = _masked_sheet(path, box)

    boxes = chart_faces.remove_masked_lines(path, [box])

    with rasterio.open(path) as src:
        after = src.read(1)
        assert src.colormap(1)[8] == (216, 232, 206, 255)
        assert len(src.overviews(1)) == len(charts._OVERVIEW_LEVELS)
        coarse = src.read(1, out_shape=(400, 400))   # from the rebuilt overview, not the old one
    assert (after[100:1500, 700:736][before[100:1500, 700:736] == 0] == 8).all()
    assert (after[800:803, 690:750] == 7).all()               # the road is still printed across it
    assert (after[400:420, 710:726] == 7).all()               # and the lettering is still in it
    assert (after[300:388, 100:546] == 0).all()               # the label box keeps its paper
    assert (after[298:390, 98:548] == before[298:390, 98:548]).all()
    lake = before[200:1400, 1150:1350] == 0
    assert (after[200:1400, 1150:1350][lake] == 0).all()      # and so does the lake
    assert (after[:, :690] == before[:, :690]).all() and (after[:, 750:] == before[:, 750:]).all()
    assert (coarse[30:370, 176:183] != 0).all()              # no paper left in the band at zoom-out either

    assert len(boxes) == 1
    west, south, east, north = boxes[0]
    band_lon = -90.0 + 718 / 1600 * 2.0
    assert west < band_lon < east and south < 42.0 < north and east - west < 0.2

    # Run again, it finds nothing left to take out.
    assert chart_faces.remove_masked_lines(path, [box]) == ()


def test_masked_lines_outside_the_face_are_the_collar_and_are_left_alone(tmp_path):
    path = tmp_path / "sheet.tif"
    before = _masked_sheet(path, (-90.0, 41.0, -88.0, 43.0))
    assert chart_faces.remove_masked_lines(path, [(-88.9, 41.0, -88.0, 43.0)]) == ()   # the band is west of the face
    with rasterio.open(path) as src:
        assert (src.read(1) == before).all()


def test_what_was_taken_out_is_recorded_and_unmask_renders_its_tiles_again(tmp_path, monkeypatch):
    cycle, box = "09-03-2026", (-90.0, 41.0, -88.0, 43.0)
    monkeypatch.setattr(charts, "CHARTS_DIR", tmp_path / "charts")
    monkeypatch.setattr(charts, "CHART_TILE_CACHE_DIR", tmp_path / "tiles")
    directory = charts._chart_dir(cycle, charts.SECTIONAL, "Sheet")
    directory.mkdir(parents=True)
    _masked_sheet(directory / "sheet.tif", box)
    sheet = charts.Chart(charts.SECTIONAL, "Sheet", cycle,
                         (charts.Raster(directory / "sheet.tif", face=box, envelope=box),), "then")
    charts._write_ready(directory, sheet)   # prepared before masked lines were looked for
    assert charts._load_ready(directory, charts.SECTIONAL, "Sheet", cycle).rasters[0].masked_lines is None

    x, y = 64, 94   # zoom 8, over the band at about 89.1W
    tile = charts._tile_path(charts.SECTIONAL, cycle, x, y, 8)
    tile.parent.mkdir(parents=True)
    tile.write_bytes(b"old")
    (tile.parent.parent.parent.parent / charts._PUBLISHED).write_text(json.dumps(["sec/8/64/94.png", "sec/8/1/1.png"]))
    monkeypatch.setattr(charts, "rasters_covering",
                        lambda kind, bbox, cycle=None: ([charts._load_ready(directory, kind, "Sheet", cycle).rasters[0]], True))

    changed = charts.unmask_prepared(cycle, workers=0)

    assert len(changed["sec"]) == 1
    assert charts._load_ready(directory, charts.SECTIONAL, "Sheet", cycle).rasters[0].masked_lines == tuple(changed["sec"])
    assert tile.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"      # rendered again from the cleaned sheet
    assert charts.tiles_revision(cycle) == 1
    assert json.loads((tmp_path / "tiles" / cycle / charts._PUBLISHED).read_text()) == ["sec/8/1/1.png"]

    # Looked at once, the sheet is not looked at again, and nothing else is rendered.
    assert charts.unmask_prepared(cycle, workers=0) == {}
    assert charts.tiles_revision(cycle) == 1


def test_a_tile_is_not_rendered_again_without_every_sheet_it_needs(tmp_path, monkeypatch):
    monkeypatch.setattr(charts, "CHART_TILE_CACHE_DIR", tmp_path / "tiles")
    cycle, x, y = "09-03-2026", 64, 94
    tile = charts._tile_path(charts.SECTIONAL, cycle, x, y, 8)
    tile.parent.mkdir(parents=True)
    tile.write_bytes(b"old")
    raster = charts.Raster(tmp_path / "a.tif", face=(-90.0, 41.0, -88.0, 43.0), envelope=(-90.0, 41.0, -88.0, 43.0))
    monkeypatch.setattr(charts, "rasters_covering", lambda kind, bbox, cycle=None: ([raster], False))
    monkeypatch.setattr(charts, "render_tile", lambda *a: pytest.fail("rendered without every sheet"))

    assert charts._rerender_tile(("sec", cycle, x, y, 8)) is False
    assert tile.read_bytes() == b"old"

    # Nothing covers it at all: the old tile goes, as before.
    monkeypatch.setattr(charts, "rasters_covering", lambda kind, bbox, cycle=None: ([], True))
    assert charts._rerender_tile(("sec", cycle, x, y, 8)) is False
    assert not tile.exists()


def test_a_tile_rendered_on_demand_draws_the_same_sheet_as_the_pyramid(tmp_path, monkeypatch):
    monkeypatch.setattr(charts, "CHART_TILE_CACHE_DIR", tmp_path / "tiles")
    cycle = "09-03-2026"
    a_box, b_box = (-90.0, 41.0, -87.5, 43.0), (-88.5, 41.0, -86.0, 43.0)   # overlapping 88.5W to 87.5W
    _palette_raster(tmp_path / "a.tif", a_box, np.full((512, 512), 1, np.uint8))
    _palette_raster(tmp_path / "b.tif", b_box, np.full((512, 512), 2, np.uint8))
    sheets = {
        "Alpha": charts.Chart(charts.SECTIONAL, "Alpha", cycle, (charts.Raster(tmp_path / "a.tif", face=a_box, envelope=a_box),), "now"),
        "Bravo": charts.Chart(charts.SECTIONAL, "Bravo", cycle, (charts.Raster(tmp_path / "b.tif", face=b_box, envelope=b_box),), "now"),
    }
    charts.render_pyramid(charts.SECTIONAL, zooms=(8,), workers=0, charts=list(sheets.values()), cycle=cycle)
    monkeypatch.setitem(charts.COVERAGE, "sec", {"Alpha": a_box, "Bravo": b_box})
    monkeypatch.setattr(charts, "ensure_chart", lambda kind, name, cycle=None: sheets[name])

    x, y = 65, 94   # zoom 8, 88.6W to 87.2W: most of it the overlap
    pyramid = charts._decode_rgba(charts._tile_path(charts.SECTIONAL, cycle, x, y, 8).read_bytes())
    rasters, _ = charts.rasters_covering(charts.SECTIONAL, charts.tile_bbox_wgs84(x, y, 8), cycle)
    on_demand = charts.render_tile(rasters, x, y, 8)
    west, _, east, _ = charts.tile_bbox_wgs84(x, y, 8)
    col = int((-88.0 - west) / (east - west) * 256)
    assert tuple(pyramid[200, col]) == tuple(on_demand[200, col]) == (0, 0, 255, 255)   # Bravo, both ways


def _busy_band_sheet(path, box, clean_ends=True):
    """A long band whose middle runs through somewhere busy: half its
    blocks printed over, too little paper for a band on its own."""
    data = np.full((2400, 800), 8, np.uint8)
    rows, cols = np.mgrid[0:2400, 0:800]
    band = (rows >= 100) & (rows < 2300) & (cols >= 380) & (cols < 416)
    busy = band & (rows >= 900) & (rows < 1400)
    data[band] = 0 if clean_ends else 8
    data[busy] = 0
    data[busy & (((rows // 4) + (cols // 4)) % 2 == 0) & (cols >= 384) & (cols < 412)] = 7
    _palette_raster(path, box, data)
    return data


def test_a_band_through_somewhere_busy_is_followed_from_its_quiet_stretches(tmp_path):
    box, path = (-90.0, 40.0, -89.5, 43.0), tmp_path / "sheet.tif"
    before = _busy_band_sheet(path, box)
    assert chart_faces.remove_masked_lines(path, [box])
    with rasterio.open(path) as src:
        after = src.read(1)
    band = before[100:2300, 380:416] == 0
    assert (after[100:2300, 380:416][band] == 8).all()        # the busy stretch too
    assert (after[900:1400, 380:416][before[900:1400, 380:416] == 7] == 7).all()


def test_what_is_left_of_a_band_is_found_along_the_border_of_what_was_taken_out(tmp_path):
    box, path = (-90.0, 40.0, -89.5, 43.0), tmp_path / "sheet.tif"
    before = _busy_band_sheet(path, box, clean_ends=False)   # cleaned already, all but the busy stretch
    assert chart_faces.remove_masked_lines(path, [box]) == ()      # on its own it is not a band
    with rasterio.open(path) as src:   # where the band was taken out, a little wider than it
        (x0, y0), (x1, y1) = src.transform @ (376, 2300), src.transform @ (420, 100)
    taken_out = (transform_bounds("EPSG:3857", "EPSG:4326", x0, y0, x1, y1),)
    assert chart_faces.remove_masked_lines(path, [box], known=taken_out)
    with rasterio.open(path) as src:
        after = src.read(1)
    assert (after[900:1400, 380:416][before[900:1400, 380:416] == 0] == 8).all()


def test_a_scans_paper_border_does_not_draw_a_hairline_down_the_seam(tmp_path):
    # The first sheet's chart runs on to its raster's edge, and so does
    # its face; its scan ends in a column of paper. The neighbour covers
    # the strip beyond it.
    left_box, right_box = (-90.0, 41.0, -88.0, 43.0), (-88.3, 41.0, -86.0, 43.0)
    left = np.full((512, 512), 1, np.uint8)
    left[:, -1] = 0
    _palette_raster(tmp_path / "left.tif", left_box, left)
    _palette_raster(tmp_path / "right.tif", right_box, np.full((512, 512), 2, np.uint8))
    rasters = [
        charts.Raster(tmp_path / "left.tif", face=(-90.0, 41.0, -87.9, 43.0), envelope=left_box),
        charts.Raster(tmp_path / "right.tif", face=right_box, envelope=right_box),
    ]
    x0, _, y0, _ = charts._tile_range((-88.001, 41.999, -87.999, 42.001), 10)
    rgba = charts.render_tile(rasters, x0, y0, 10)
    paper = (rgba[:, :, :3] == 255).all(axis=2) & (rgba[:, :, 3] > 0)
    assert not paper.any()
    west, _, east, _ = charts.tile_bbox_wgs84(x0, y0, 10)
    col = lambda lon: int((lon - west) / (east - west) * 256)  # noqa: E731
    assert tuple(rgba[128, col(-88.05)]) == (255, 0, 0, 255)   # the first sheet, up to its edge
    assert tuple(rgba[128, col(-87.95)]) == (0, 0, 255, 255)   # its neighbour past it


def test_a_band_is_carried_through_the_lettering_up_to_the_sheets_edge(tmp_path):
    box, path = (-90.0, 40.0, -89.5, 42.0), tmp_path / "sheet.tif"
    data = np.full((1600, 800), 8, np.uint8)
    data[100:1600, 380:416] = 0                                   # runs off the bottom of the raster
    rows, cols = np.mgrid[1450:1600, 380:416]
    data[1450:1600, 380:416][((rows // 3 + cols // 3) % 3 != 0)] = 7   # a name lettered over its last stretch
    _palette_raster(path, box, data)
    assert chart_faces.remove_masked_lines(path, [(-90.0, 39.0, -89.5, 42.0)])
    with rasterio.open(path) as src:
        after = src.read(1)
    assert (after[100:1600, 380:416][data[100:1600, 380:416] == 0] == 8).all()
