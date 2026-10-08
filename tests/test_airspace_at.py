"""vfr.airspace_at: the airspace over a point, from the ground up --
the classes in bands, 91.155's minimums, what it takes to go in."""
import pytest
import shapefile

from vfr import airspace_at


def _volume(klass, floor_ft, floor_ref, ceiling_ft=18000.0, name=""):
    return {"class": klass, "local_type": f"CLASS_{klass}", "name": name, "ident": "",
            "floor_ft": floor_ft, "floor_ref": floor_ref, "ceiling_ft": ceiling_ft}


def _bands(bands):
    return [(b["class"], b["floor_ft"], b["ceiling_ft"]) for b in bands]


def test_under_a_class_b_shelf_with_a_700_ft_class_e_floor():
    # C81's own column: G to 700 ft above the ground, E to the Class B's
    # 3,600 ft shelf, the B to 10,000, E above it, A from 18,000.
    volumes = [_volume("E", 700, "AGL"), _volume("B", 3600, "MSL", 10000, "CHICAGO CLASS B")]
    bands = airspace_at.column(42.3, -88.1, 780.0, volumes, in_veil=True)
    assert _bands(bands) == [
        ("G", 780.0, 1480.0), ("E", 1480.0, 3600.0), ("B", 3600.0, 10000.0), ("E", 10000.0, 18000.0), ("A", 18000.0, 60000.0),
    ]
    g, e, b = bands[0], bands[1], bands[2]
    # Under the shelf, 200 kt (91.117(c)); in the veil, the transponder.
    assert g["speed_kt"] == 200 and e["speed_kt"] == 200 and b["speed_kt"] == 250
    assert "Mode C veil" in g["equipment"]
    assert b["name"] == "CHICAGO CLASS B" and "clearance" in b["entry"]


def test_a_class_d_inside_the_mode_c_veil_needs_the_transponder_too():
    # 14 CFR 91.215(b)(2): a transponder with altitude reporting in "all
    # airspace within 30 nautical miles of an airport listed in appendix D,
    # section 1 ... from the surface upward to 10,000 feet MSL"; 91.225(d)
    # asks ADS-B Out in the same airspace. A Class D is not an exception.
    volumes = [_volume("D", 0, "SFC", 3000.0, "ADDISON CLASS D")]
    inside = airspace_at.column(32.97, -96.84, 640.0, volumes, in_veil=True)[0]
    outside = airspace_at.column(32.97, -96.84, 640.0, volumes, in_veil=False)[0]
    assert inside["class"] == outside["class"] == "D"
    assert "transponder" in inside["equipment"] and "ADS-B Out" in inside["equipment"]
    assert outside["equipment"] == "A two-way radio."


def test_class_g_minimums_change_at_1200_ft_above_the_ground_and_at_10000_ft():
    # Nothing drawn: G to 14,500 ft, E above it.
    bands = airspace_at.column(39.6, -106.5, 8650.0, [])
    assert [b["class"] for b in bands] == ["G", "G", "G", "G", "E", "A"]
    low, high_below_10k, high, above_2500_agl = bands[0], bands[1], bands[2], bands[3]
    assert (low["floor_ft"], low["ceiling_ft"]) == (8650.0, 9850.0)
    assert low["minimums"]["day"] == {
        "visibility_sm": 1, "clear_of_clouds": True, "below_ft": None, "above_ft": None, "horizontal_ft": None,
    }
    assert high_below_10k["minimums"]["day"]["below_ft"] == 500
    assert high["minimums"]["day"]["visibility_sm"] == 5 and high["minimums"]["day"]["horizontal_ft"] == 5280
    # At or below 2,500 ft above the ground no transponder above 10,000 ft;
    # higher, one is asked for.
    assert high["equipment"] is None and above_2500_agl["equipment"] is not None
    assert bands[4]["floor_ft"] == 14500.0


def test_the_most_restrictive_class_holds_where_they_overlap():
    volumes = [_volume("D", 0, "SFC", 3300, "DUPAGE CLASS D"), _volume("B", 3000, "MSL", 10000, "CHICAGO CLASS B")]
    bands = airspace_at.column(41.9, -88.25, 750.0, volumes)
    assert _bands(bands)[:2] == [("D", 750.0, 3000.0), ("B", 3000.0, 10000.0)]


@pytest.mark.parametrize("klass, floor, agl, day_vis, clear", [
    ("B", 3000, 2000, 3, True), ("C", 0, 0, 3, False), ("D", 0, 0, 3, False),
    ("E", 5000, 4000, 3, False), ("E", 11000, 9000, 5, False), ("G", 1000, 500, 1, True),
])
def test_91_155_minimums_by_class(klass, floor, agl, day_vis, clear):
    rules = airspace_at.minimums(klass, floor, agl)
    assert rules["day"]["visibility_sm"] == day_vis and rules["day"]["clear_of_clouds"] is clear
    assert airspace_at.minimums("A", 18000, 17000) is None


def test_the_mode_c_veil_is_the_nearest_class_b_airport_within_30_nm():
    airports = [{"ident": "KORD", "name": "O'Hare", "lat": 41.9786, "lon": -87.9048},
                {"ident": "KMSP", "name": "Minneapolis", "lat": 44.882, "lon": -93.2218}]
    veil = airspace_at.mode_c_veil(42.3172, -88.0905, airports)
    assert veil["ident"] == "KORD" and veil["distance_nm"] == pytest.approx(21.9, abs=0.3)
    assert airspace_at.mode_c_veil(44.5, -90.5, airports) is None


def test_the_volumes_over_a_point_are_read_from_the_shapefile(tmp_path):
    path = tmp_path / "Class_Airspace"
    with shapefile.Writer(str(path), shapeType=shapefile.POLYGON) as w:
        for name in ("IDENT", "NAME", "CLASS", "LOCAL_TYPE", "LOWER_CODE", "LOWER_VAL", "UPPER_CODE", "UPPER_VAL"):
            w.field(name, "C")
        square = [[(-88.5, 42.0), (-88.5, 42.5), (-88.0, 42.5), (-88.0, 42.0), (-88.5, 42.0)]]
        elsewhere = [[(-80.5, 40.0), (-80.5, 40.5), (-80.0, 40.5), (-80.0, 40.0), (-80.5, 40.0)]]
        w.poly(square)
        w.record("ORD", "CHICAGO CLASS B", "B", "CLASS_B", "MSL", "3600", "MSL", "10000")
        w.poly(square)
        w.record("", "CHICAGO CLASS E5", "E", "CLASS_E5", "SFC", "700", "", "-9998")
        w.poly(elsewhere)
        w.record("", "FAR CLASS D", "D", "CLASS_D", "SFC", "0", "MSL", "2800")
    found = airspace_at.volumes_at(42.3, -88.1, path.with_suffix(".shp"))
    assert sorted((v["class"], v["floor_ft"], v["floor_ref"], v["ceiling_ft"]) for v in found) == [
        ("B", 3600.0, "MSL", 10000.0), ("E", 700.0, "AGL", 18000.0),
    ]
