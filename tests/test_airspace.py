import os
import struct

import pytest
import shapefile
from shapely.geometry import Point, Polygon

from vfr import airspace
from vfr.airspace import _shapefile_is_complete, is_own_surface_area

DEPARTURE = Point(-93.65, 41.53)
DESTINATION = Point(-95.89, 41.30)
ELSEWHERE = Point(-94.70, 41.40)


def _airspace(floor_ft, around):
    """A square of airspace centred on `around`, with the given floor."""
    x, y = around.x, around.y
    return {
        "floor_ft_msl": floor_ft,
        "geometry": Polygon([(x - .2, y - .2), (x + .2, y - .2), (x + .2, y + .2), (x - .2, y + .2)]),
    }


def test_surface_area_around_departure_is_the_airports_own():
    assert is_own_surface_area(_airspace(0.0, DEPARTURE), DEPARTURE, DESTINATION) is True


def test_surface_area_around_destination_is_the_airports_own():
    assert is_own_surface_area(_airspace(0.0, DESTINATION), DEPARTURE, DESTINATION) is True


def test_overlying_shelf_is_a_real_constraint_even_over_the_departure():
    """The case the Class-D-only rule got right and this must keep: a
    shelf sitting over the departure field still imposes a ceiling."""
    assert is_own_surface_area(_airspace(1900.0, DEPARTURE), DEPARTURE, DESTINATION) is False


def test_surface_area_along_the_way_is_not_excluded():
    assert is_own_surface_area(_airspace(0.0, ELSEWHERE), DEPARTURE, DESTINATION) is False


def _write_shp(path, declared_words, body_len):
    header = bytearray(100)
    struct.pack_into(">i", header, 0, 9994)
    struct.pack_into(">i", header, 24, declared_words)
    path.write_bytes(bytes(header) + b"\x00" * body_len)


def _companions(tmp_path, *suffixes):
    for suffix in suffixes:
        (tmp_path / f"Class_Airspace{suffix}").write_bytes(b"\x00" * 100)


def test_complete_shapefile_passes(tmp_path):
    shp = tmp_path / "Class_Airspace.shp"
    _write_shp(shp, declared_words=(100 + 40) // 2, body_len=40)
    _companions(tmp_path, ".shx", ".dbf")
    assert _shapefile_is_complete(shp) is True


def test_truncated_shapefile_is_rejected(tmp_path):
    """The real failure: a file that opens fine and reads hundreds of
    shapes before raising on garbage from the middle of the file."""
    shp = tmp_path / "Class_Airspace.shp"
    _write_shp(shp, declared_words=(100 + 5000) // 2, body_len=40)
    _companions(tmp_path, ".shx", ".dbf")
    assert _shapefile_is_complete(shp) is False


def test_missing_index_is_rejected(tmp_path):
    shp = tmp_path / "Class_Airspace.shp"
    _write_shp(shp, declared_words=(100 + 40) // 2, body_len=40)
    _companions(tmp_path, ".dbf")
    assert _shapefile_is_complete(shp) is False


def test_missing_dbf_is_rejected(tmp_path):
    """iCloud evicted exactly this file minutes after a clean download;
    pyshp only complains much later, and not about the cache."""
    shp = tmp_path / "Class_Airspace.shp"
    _write_shp(shp, declared_words=(100 + 40) // 2, body_len=40)
    _companions(tmp_path, ".shx")
    assert _shapefile_is_complete(shp) is False


def test_wrong_magic_is_rejected(tmp_path):
    shp = tmp_path / "Class_Airspace.shp"
    shp.write_bytes(b"not a shapefile" + b"\x00" * 200)
    _companions(tmp_path, ".shx", ".dbf")
    assert _shapefile_is_complete(shp) is False


def test_absent_file_is_rejected(tmp_path):
    assert _shapefile_is_complete(tmp_path / "nope.shp") is False


# --- the hemispheric cruising-altitude rule ---

from vfr.airspace import CLEARANCE_CLASSES, TWO_WAY_COMMS_CLASSES  # noqa: E402
from vfr.altitude import lowest_vfr_cruising_altitude  # noqa: E402

EAST, WEST = 90.0, 270.0


@pytest.mark.parametrize(
    "floor_ft, bearing, expected",
    [
        (3000, WEST, 4500),   # KDSM->KOMA: the case that used to give 12,500
        (2200, WEST, 2500),
        (3000, EAST, 3500),
        (2200, EAST, 3500),   # 2,500 is a westbound altitude, so climb to 3,500
        (4500, WEST, 4500),   # already legal and eastbound-correct: unchanged
        (4600, WEST, 6500),   # just above one, so the next in the same band
    ],
)
def test_lowest_legal_altitude_above_the_floor(floor_ft, bearing, expected):
    assert lowest_vfr_cruising_altitude(floor_ft, bearing) == expected


def test_bearing_wraps():
    assert lowest_vfr_cruising_altitude(3000, 630.0) == lowest_vfr_cruising_altitude(3000, 270.0)


def test_only_class_b_takes_a_clearance():
    """The domain rule this module now encodes: C and D need two-way
    radio communication established, B needs a clearance."""
    assert CLEARANCE_CLASSES == ("B",)
    assert set(TWO_WAY_COMMS_CLASSES) == {"C", "D"}


# --- the parsed-polygon cache beside the shapefile ---


def _write_shapefile(path, extra_polygon: bool = False) -> None:
    """A two-record stand-in for Class_Airspace.shp: one Class C surface
    area and one Class E polygon the loader must leave out."""
    w = shapefile.Writer(str(path))
    w.field("NAME", "C")
    w.field("CLASS", "C")
    w.field("LOWER_VAL", "N", decimal=0)
    w.field("LOWER_CODE", "C")
    w.poly([[(-93.9, 41.3), (-93.4, 41.3), (-93.4, 41.8), (-93.9, 41.8), (-93.9, 41.3)]])
    w.record("DES MOINES", "C", 0, "SFC")
    w.poly([[(-95.0, 41.0), (-94.5, 41.0), (-94.5, 41.5), (-95.0, 41.5), (-95.0, 41.0)]])
    w.record("SOMEWHERE E", "E", 700, "MSL")
    if extra_polygon:
        w.poly([[(-96.0, 42.0), (-95.5, 42.0), (-95.5, 42.5), (-96.0, 42.5), (-96.0, 42.0)]])
        w.record("OMAHA", "C", 0, "SFC")
    w.close()


def test_controlled_polygons_round_trip_through_the_wkb_cache(tmp_path, monkeypatch):
    shp = tmp_path / "Class_Airspace.shp"
    _write_shapefile(shp)
    monkeypatch.setattr(airspace, "_ALL_AIRSPACE_CACHE", {})

    parsed = airspace._load_all_controlled_airspace(shp)

    assert [p["name"] for p in parsed] == ["DES MOINES"]  # Class E excluded
    assert airspace._controlled_cache_path(shp).exists()

    # A fresh process: nothing in memory, the cache beside the file
    # answers, and the shapefile is not walked again.
    monkeypatch.setattr(airspace, "_ALL_AIRSPACE_CACHE", {})
    monkeypatch.setattr(airspace, "_parse_controlled_airspace", lambda path: pytest.fail("parsed instead of reading the cache"))
    from_cache = airspace._load_all_controlled_airspace(shp)

    assert from_cache[0]["name"] == "DES MOINES" and from_cache[0]["class"] == "C"
    assert from_cache[0]["floor_ft_msl"] == 0.0
    assert from_cache[0]["bbox"] == parsed[0]["bbox"]
    assert from_cache[0]["geometry"].equals(parsed[0]["geometry"])


def test_a_new_shapefile_cycle_rebuilds_the_cache(tmp_path, monkeypatch):
    shp = tmp_path / "Class_Airspace.shp"
    _write_shapefile(shp)
    monkeypatch.setattr(airspace, "_ALL_AIRSPACE_CACHE", {})
    airspace._load_all_controlled_airspace(shp)

    # The next 28-day cycle: a re-downloaded file with different content.
    _write_shapefile(shp, extra_polygon=True)
    later = os.stat(shp).st_mtime + 100
    os.utime(shp, (later, later))
    parses = []
    real_parse = airspace._parse_controlled_airspace
    monkeypatch.setattr(airspace, "_parse_controlled_airspace", lambda path: parses.append(path) or real_parse(path))
    monkeypatch.setattr(airspace, "_ALL_AIRSPACE_CACHE", {})

    rebuilt = airspace._load_all_controlled_airspace(shp)

    assert parses == [shp]
    assert [p["name"] for p in rebuilt] == ["DES MOINES", "OMAHA"]
