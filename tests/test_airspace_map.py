"""vfr.airspace_map: the Class B, C and D in a box, as lines on the
chart and the altitudes for their labels, from a stand-in shapefile."""
import pytest
import shapefile
from shapely.geometry import Point, Polygon

from vfr import airspace, airspace_map


def _write(path) -> None:
    """A Class B shelf round a hole (the inner shelf's), a Wheeling-like
    Class D up to but not including 3,000 ft, and a Class E the map
    leaves out."""
    w = shapefile.Writer(str(path))
    for name in ("IDENT", "NAME", "CLASS", "UPPER_DESC", "UPPER_CODE", "LOWER_CODE", "WKHR_CODE", "WKHR_RMK"):
        w.field(name, "C")
    w.field("UPPER_VAL", "N", decimal=0)
    w.field("LOWER_VAL", "N", decimal=0)
    outer = [(-88.5, 41.5), (-88.5, 42.5), (-87.5, 42.5), (-87.5, 41.5), (-88.5, 41.5)]
    hole = [(-88.2, 41.8), (-87.8, 41.8), (-87.8, 42.2), (-88.2, 42.2), (-88.2, 41.8)]
    w.poly([outer, hole])
    w.record("ORD", "CHICAGO CLASS B", "B", "TI", "MSL", "MSL", "H24", "<Null>", 10000, 3000)
    w.poly([[(-87.98, 42.08), (-87.98, 42.16), (-87.86, 42.16), (-87.86, 42.08), (-87.98, 42.08)]])
    w.record("PWK", "WHEELING CLASS D", "D", "TNI", "MSL", "SFC", "NOTAM", "Legal description references NOTAM", 3000, 0)
    w.poly([[(-89.0, 41.0), (-89.0, 41.2), (-88.8, 41.2), (-88.8, 41.0), (-89.0, 41.0)]])
    w.record("", "SOMEWHERE E", "E", "TI", "MSL", "MSL", "H24", "", 17999, 700)
    w.close()


@pytest.fixture
def chicago(tmp_path, monkeypatch):
    shp = tmp_path / "Class_Airspace.shp"
    _write(shp)
    monkeypatch.setattr(airspace, "_ALL_AIRSPACE_CACHE", {})
    airspace_map._volumes_in.cache_clear()
    return shp


def test_each_volume_has_its_altitudes_as_the_file_gives_them(chicago):
    volumes = {v["ident"]: v for v in airspace_map.volumes_in(chicago, 41.0, -89.5, 43.0, -87.0)}
    # The Class E is no line the map draws.
    assert set(volumes) == {"ORD", "PWK"}
    ord_, pwk = volumes["ORD"], volumes["PWK"]
    assert (ord_["airspace_class"], ord_["ceiling_ft"], ord_["floor_ft"], ord_["floor_sfc"], ord_["ceiling_excluded"]) == (
        "B", 10000.0, 3000.0, False, False)
    assert (pwk["airspace_class"], pwk["ceiling_ft"], pwk["floor_sfc"], pwk["ceiling_excluded"]) == ("D", 3000.0, True, True)
    # The shelf's outside and its hole, each a line of [lat, lon].
    assert len(ord_["lines"]) == 2
    assert [41.5, -88.5] in ord_["lines"][0] + ord_["lines"][1]


def test_each_volume_says_when_it_is_in_effect_as_the_file_does(chicago):
    volumes = {v["ident"]: v for v in airspace_map.volumes_in(chicago, 41.0, -89.5, 43.0, -87.0)}
    # The Bravo continuous, its "<Null>" remark none; Wheeling part-time,
    # its hours by NOTAM, with the file's remark as it is written.
    assert (volumes["ORD"]["hours_code"], volumes["ORD"]["hours_remark"]) == ("H24", None)
    assert (volumes["PWK"]["hours_code"], volumes["PWK"]["hours_remark"]) == ("NOTAM", "Legal description references NOTAM")


def test_a_label_sits_on_its_own_shelf_not_in_the_hole(chicago):
    ord_ = next(v for v in airspace_map.volumes_in(chicago, 41.0, -89.5, 43.0, -87.0) if v["ident"] == "ORD")
    shelf = Polygon([(-88.5, 41.5), (-88.5, 42.5), (-87.5, 42.5), (-87.5, 41.5)],
                    [[(-88.2, 41.8), (-87.8, 41.8), (-87.8, 42.2), (-88.2, 42.2)]])
    assert shelf.contains(Point(ord_["label_lon"], ord_["label_lat"]))


def test_a_volume_cut_by_the_box_has_no_line_along_the_boxs_edge(chicago):
    # The box's west edge cuts the shelf at -88.0: the lines run to it,
    # never along it, so a kept answer draws no false airspace line.
    ord_ = next(v for v in airspace_map.volumes_in(chicago, 41.0, -88.0, 43.0, -87.0) if v["ident"] == "ORD")
    on_edge = [p for line in ord_["lines"] for p in line if p[1] == -88.0]
    assert on_edge and all(p[0] in (41.5, 41.8, 42.2, 42.5) for p in on_edge)
    # And its label is in the box, on the part of the shelf in it.
    assert ord_["label_lon"] >= -88.0


def test_a_box_far_out_is_simplified_further_than_one_close_in():
    assert airspace_map.tolerance_for(42.0, 42.5) == airspace_map.MIN_TOLERANCE_DEG
    assert airspace_map.tolerance_for(36.0, 48.0) == pytest.approx(0.001)
