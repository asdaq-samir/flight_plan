"""vfr.elevation's on-disk cache: what two lookups at once each fetched
is kept, and the file is never seen half-written."""
import threading

from vfr import elevation


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
