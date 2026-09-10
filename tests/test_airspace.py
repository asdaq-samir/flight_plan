import struct

import pytest
from shapely.geometry import Point, Polygon

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


def test_complete_shapefile_passes(tmp_path):
    shp = tmp_path / "Class_Airspace.shp"
    _write_shp(shp, declared_words=(100 + 40) // 2, body_len=40)
    (tmp_path / "Class_Airspace.shx").write_bytes(b"\x00" * 100)
    assert _shapefile_is_complete(shp) is True


def test_truncated_shapefile_is_rejected(tmp_path):
    """The real failure: a file that opens fine and reads hundreds of
    shapes before raising on garbage from the middle of the file."""
    shp = tmp_path / "Class_Airspace.shp"
    _write_shp(shp, declared_words=(100 + 5000) // 2, body_len=40)
    (tmp_path / "Class_Airspace.shx").write_bytes(b"\x00" * 100)
    assert _shapefile_is_complete(shp) is False


def test_missing_index_is_rejected(tmp_path):
    shp = tmp_path / "Class_Airspace.shp"
    _write_shp(shp, declared_words=(100 + 40) // 2, body_len=40)
    assert _shapefile_is_complete(shp) is False


def test_wrong_magic_is_rejected(tmp_path):
    shp = tmp_path / "Class_Airspace.shp"
    shp.write_bytes(b"not a shapefile" + b"\x00" * 200)
    (tmp_path / "Class_Airspace.shx").write_bytes(b"\x00" * 100)
    assert _shapefile_is_complete(shp) is False


def test_absent_file_is_rejected(tmp_path):
    assert _shapefile_is_complete(tmp_path / "nope.shp") is False
