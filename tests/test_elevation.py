"""vfr.elevation's on-disk cache: what two lookups at once each fetched
is kept, and the file is never seen half-written."""
import threading

import pytest

from vfr import elevation


@pytest.fixture(autouse=True)
def no_elevation_tiles(monkeypatch):
    """EPQS alone, unless a test gives the tiles' heights itself: a real
    tile is read from the network."""
    monkeypatch.setattr(elevation, "_dem_heights", lambda name, points: {})


def test_lookups_at_once_keep_every_point_they_fetched(tmp_path, monkeypatch):
    """Each used to write back the copy it read before its lookups, so
    the later write dropped the other's points."""
    cache = tmp_path / "elevation_cache.csv"
    monkeypatch.setattr(elevation, "_fetch_elevation_m", lambda lat, lon: lat * 10)
    barrier = threading.Barrier(12)

    def lookup(i: int):
        barrier.wait()
        elevation.get_elevations_m([(40.0 + i, -90.0)], cache_path=cache, max_workers=1)

    threads = [threading.Thread(target=lookup, args=(i,)) for i in range(12)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)

    assert elevation._load_cache(cache) == {(40.0 + i, -90.0): (40.0 + i) * 10 for i in range(12)}


def test_a_cached_point_is_not_fetched_again(tmp_path, monkeypatch):
    cache = tmp_path / "elevation_cache.csv"
    monkeypatch.setattr(elevation, "_fetch_elevation_m", lambda lat, lon: 250.0)
    elevation.get_elevations_m([(45.0, -90.0)], cache_path=cache)

    monkeypatch.setattr(elevation, "_fetch_elevation_m", lambda lat, lon: (_ for _ in ()).throw(AssertionError("fetched")))
    assert elevation.get_elevations_m([(45.0, -90.0)], cache_path=cache) == {(45.0, -90.0): 250.0}


def test_the_ground_at_a_point_is_read_from_its_terrain_tile(tmp_path, monkeypatch):
    import math

    import numpy as np
    from PIL import Image

    from vfr import elevation

    monkeypatch.setattr(elevation, "TERRAIN_TILE_DIR", tmp_path)
    monkeypatch.setattr(elevation, "_TERRAIN_TILES", {})
    lat, lon, zoom = 42.3172, -88.0905, elevation.TERRAIN_TILE_ZOOM
    n = 2 ** zoom
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    # Terrarium's encoding: (R * 256 + G + B / 256) - 32768 metres.
    code = 238 + 32768
    pixels = np.zeros((256, 256, 3), dtype=np.uint8)
    pixels[:, :] = (code // 256, code % 256, 128)
    (tmp_path / str(zoom) / str(x)).mkdir(parents=True)
    Image.fromarray(pixels).save(tmp_path / str(zoom) / str(x) / f"{y}.png")

    def no_network(*args, **kwargs):
        raise AssertionError("a tile on disk is not fetched again")

    monkeypatch.setattr(elevation.requests, "get", no_network)
    assert elevation.ground_m(lat, lon) == 238.5


def test_the_tiles_answer_what_they_can_and_epqs_the_rest(tmp_path, monkeypatch):
    """A route's ground from USGS's 1 arc-second tiles, a tile at a time,
    and from EPQS only where a tile has no height."""
    cache = tmp_path / "elevation_cache.csv"
    tiles = []

    def dem_heights(name, points):
        tiles.append((name, sorted(points)))
        return {p: 238.577 for p in points if p != (42.5, -88.5)}

    monkeypatch.setattr(elevation, "_dem_heights", dem_heights)
    asked = []
    monkeypatch.setattr(elevation, "_fetch_elevation_m", lambda lat, lon: asked.append((lat, lon)) or 300.0)
    heights = elevation.get_elevations_m([(42.3172, -88.0905), (42.5, -88.5), (43.5, -88.5)], cache_path=cache)
    assert heights == {(42.3172, -88.0905): 238.577, (42.5, -88.5): 300.0, (43.5, -88.5): 238.577}
    assert sorted(tiles) == [("n43w089", [(42.3172, -88.0905), (42.5, -88.5)]), ("n44w089", [(43.5, -88.5)])]
    assert asked == [(42.5, -88.5)]


def test_a_tile_that_cannot_be_read_leaves_its_points_to_epqs(tmp_path, monkeypatch):
    def unreadable(name, points):
        raise OSError("no such tile")

    monkeypatch.setattr(elevation, "_dem_heights", unreadable)
    monkeypatch.setattr(elevation, "_fetch_elevation_m", lambda lat, lon: 250.0)
    assert elevation.get_elevations_m([(45.0, -90.0)], cache_path=tmp_path / "c.csv") == {(45.0, -90.0): 250.0}


def test_a_tile_is_named_by_its_north_west_corner():
    assert elevation._dem_name(42.3172, -88.0905) == "n43w089"
    assert elevation._dem_name(46.8421, -92.1936) == "n47w093"
    assert elevation._dem_name(-33.9, 151.2) is None
