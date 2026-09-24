"""app.planning's own pieces: the aircraft profile an override must not
corrupt for the next pilot, and SingleFlightTTLCache's actual promise --
one computation per key, even from several threads at once.
"""
import threading
import time

from app import planning


def test_an_aeroplanes_own_override_does_not_leak_into_the_stock_profile():
    """aircraft_profile() writes cruise_tas_kt/fuel_burn_gph/usable_fuel_gal
    onto the dict load_aircraft_profile() gives it, in place -- so if that
    dict were the cached object itself (vfr.aircraft.load_aircraft_profile
    is lru_cache'd), one pilot's own aeroplane numbers would still be
    sitting on "c172" the next time someone asked for the stock profile
    with no override at all. Two different pilots, two different answers,
    is the only acceptable outcome.
    """
    overridden = planning.aircraft_profile("c172", cruise_tas_kt=999.0)
    assert overridden["cruise_tas_kt"] == 999.0

    stock = planning.aircraft_profile("c172")
    assert stock["cruise_tas_kt"] != 999.0


def test_single_flight_cache_computes_a_cold_key_once():
    cache = planning.SingleFlightTTLCache(maxsize=8, ttl=60)
    calls = []

    def compute():
        calls.append(1)
        return "value"

    assert cache.get_or_compute("k", compute) == "value"
    assert cache.get_or_compute("k", compute) == "value"
    assert calls == [1]


def test_single_flight_cache_coalesces_concurrent_misses():
    """The bug this exists for: two callers racing a cache miss on the
    same key used to both run compute() -- the lock only ever protected
    the dict, not the gap between reading it empty and writing the
    answer back. Twenty threads asking for the same key at once, with
    compute() deliberately slow enough that every one of them arrives
    before the first finishes, must still only run it once.
    """
    cache = planning.SingleFlightTTLCache(maxsize=8, ttl=60)
    started = threading.Event()
    calls = []
    lock = threading.Lock()

    def compute():
        with lock:
            calls.append(1)
        started.set()
        time.sleep(0.2)
        return "value"

    results = []
    results_lock = threading.Lock()

    def worker():
        value = cache.get_or_compute("shared-key", compute)
        with results_lock:
            results.append(value)

    threads = [threading.Thread(target=worker) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=5)

    assert calls == [1]
    assert results == ["value"] * 20


def test_single_flight_cache_lets_different_keys_run_in_parallel():
    """The reverse of coalescing: two different keys must not serialise
    behind one lock held for the whole computation, or a slow route
    blocks every other route's request while it runs."""
    cache = planning.SingleFlightTTLCache(maxsize=8, ttl=60)
    both_running = threading.Barrier(2, timeout=5)

    def compute():
        both_running.wait()
        return "value"

    results = {}

    def worker(key):
        results[key] = cache.get_or_compute(key, compute)

    a = threading.Thread(target=worker, args=("a",))
    b = threading.Thread(target=worker, args=("b",))
    a.start()
    b.start()
    a.join(timeout=5)
    b.join(timeout=5)

    assert results == {"a": "value", "b": "value"}


def test_single_flight_cache_lets_a_follower_retry_after_the_leaders_error():
    """compute() raising must not poison every caller waiting on it --
    each of two callers behind a failing first attempt gets its own
    shot, not the first one's exception."""
    cache = planning.SingleFlightTTLCache(maxsize=8, ttl=60)
    attempts = []
    attempts_lock = threading.Lock()
    release_leader = threading.Event()
    leader_running = threading.Event()

    def compute():
        with attempts_lock:
            mine = len(attempts)
            attempts.append(mine)
        if mine == 0:
            leader_running.set()
            release_leader.wait(timeout=5)
            raise RuntimeError("transient failure")
        return "recovered"

    results = []
    errors = []

    def leader():
        try:
            cache.get_or_compute("k", compute)
        except RuntimeError:
            errors.append("leader")

    def follower():
        leader_running.wait(timeout=5)
        # Give the leader a moment to actually be registered as in-flight
        # before this one joins it, rather than racing to become its own
        # leader on an empty cache.
        time.sleep(0.05)
        results.append(cache.get_or_compute("k", compute))

    t_leader = threading.Thread(target=leader)
    t_follower = threading.Thread(target=follower)
    t_leader.start()
    t_follower.start()  # waits on leader_running itself; no join needed here
    time.sleep(0.1)
    release_leader.set()
    t_leader.join(timeout=5)
    t_follower.join(timeout=5)

    assert errors == ["leader"]
    assert results == ["recovered"]


def test_single_flight_cache_clear_drops_cached_values_and_inflight_state():
    cache = planning.SingleFlightTTLCache(maxsize=8, ttl=60)
    cache.get_or_compute("k", lambda: "value")
    assert cache.get("k") == "value"

    cache.clear()

    assert cache.get("k") is None


def _stuck(pending_stage: str | None = None):
    """A compute() that never finishes on its own -- the 2026-09-23 hang --
    reporting `pending_stage` as still running, and the event that lets
    the test release it afterwards."""
    release = threading.Event()

    def make(pending: set):
        def compute():
            if pending_stage:
                pending.add(pending_stage)
            release.wait(timeout=5)
            return "late"
        return compute
    return make, release


def test_a_follower_gives_up_after_the_limit_and_says_what_is_running():
    cache = planning.SingleFlightTTLCache(maxsize=8, ttl=60)
    make, release = _stuck("terrain.floor_profile")
    leader_pending: set = set()
    leader = threading.Thread(target=lambda: cache.get_or_compute("k", make(leader_pending), 5, leader_pending))
    leader.start()
    time.sleep(0.1)

    started = time.monotonic()
    try:
        cache.get_or_compute("k", lambda: "never", limit_s=0.3)
        raise AssertionError("the follower should have given up")
    except planning.StillComputing as err:
        assert time.monotonic() - started < 1.0
        assert err.stages == ["terrain.floor_profile"]
        assert "waiting on the terrain and obstacles" in str(err)
    finally:
        release.set()
        leader.join(timeout=5)


def test_a_computation_past_the_limit_is_replaced_not_joined():
    """After the limit, the next caller starts afresh instead of waiting
    on a computation that may never finish; the old one finishing late
    must not remove the new one's entry."""
    cache = planning.SingleFlightTTLCache(maxsize=8, ttl=60)
    make, release = _stuck()
    stuck_pending: set = set()
    stuck = threading.Thread(target=lambda: cache.get_or_compute("k", make(stuck_pending), 5, stuck_pending))
    stuck.start()
    time.sleep(0.3)

    assert cache.get_or_compute("k", lambda: "fresh", limit_s=0.2) == "fresh"
    release.set()
    stuck.join(timeout=5)
    assert cache.running("k") is None
    # And the late one's answer, from older inputs, does not replace it.
    assert cache.get("k") == "fresh"


def test_an_abandoned_computation_finishing_first_fills_the_empty_slot():
    """Nothing newer to keep: its answer is the best there is, until the
    fresh one lands."""
    cache = planning.SingleFlightTTLCache(maxsize=8, ttl=60)
    make, release = _stuck()
    stuck_pending: set = set()
    stuck = threading.Thread(target=lambda: cache.get_or_compute("k", make(stuck_pending), 5, stuck_pending))
    stuck.start()
    time.sleep(0.3)

    fresh_started, fresh_release = threading.Event(), threading.Event()

    def fresh():
        fresh_started.set()
        fresh_release.wait(timeout=5)
        return "fresh"

    replacing = threading.Thread(target=lambda: cache.get_or_compute("k", fresh, limit_s=0.2))
    replacing.start()
    fresh_started.wait(timeout=5)
    release.set()
    stuck.join(timeout=5)
    assert cache.get("k") == "late"

    fresh_release.set()
    replacing.join(timeout=5)
    assert cache.get("k") == "fresh"


def test_a_second_abandoned_computation_is_not_replaced_while_the_first_still_runs():
    """When what a computation is stuck on is shared, a fresh one sticks
    on it too; replacing each one after the limit piled up another stuck
    computation -- and its threads -- every time. One replacement at a
    time: while an abandoned one is still running, callers are told so."""
    cache = planning.SingleFlightTTLCache(maxsize=8, ttl=60)
    make, release = _stuck("weather.metars")
    first_pending: set = set()
    first = threading.Thread(target=lambda: cache.get_or_compute("k", make(first_pending), 5, first_pending))
    first.start()
    time.sleep(0.3)
    second_pending: set = set()
    second = threading.Thread(target=lambda: cache.get_or_compute("k", make(second_pending), 0.2, second_pending))
    second.start()                       # replaces the first, which is abandoned
    time.sleep(0.3)

    started = []
    try:
        cache.get_or_compute("k", lambda: started.append(1) or "third", limit_s=0.2)
        raise AssertionError("a third computation should not have started")
    except planning.StillComputing:
        pass
    finally:
        release.set()
        first.join(timeout=5)
        second.join(timeout=5)
    assert started == []


def test_stages_are_named_in_a_pilots_words():
    assert planning.describe_stages(["weather.freezing_level", "terrain.floor_profile", "weather.hazards_along_route"]) \
        == "aviationweather.gov and the terrain and obstacles"
    assert planning.describe_stages([]) == ""


def test_a_corridor_collected_the_other_way_round_serves_this_one(monkeypatch, tmp_path):
    """KDLH->C81 with only C81->KDLH built: the same candidates, measured
    from the other end, instead of a 404 and a minutes-long build."""
    import pytest
    from vfr import model_client

    from app import scoring

    built = tmp_path / "features_c81_kdlh.parquet"
    built.write_text("x")
    monkeypatch.setattr(scoring, "paths", lambda dep, dest: (
        tmp_path / f"candidates_{dep.lower()}_{dest.lower()}.csv", tmp_path / f"features_{dep.lower()}_{dest.lower()}.parquet"))

    def invoke(dep, dest, model=None):
        if (dep, dest) != ("C81", "KDLH"):
            raise model_client.RouteNotCollected(dep, dest)
        return {"departure_ident": dep, "destination_ident": dest, "checkpoints": [
            {"osm_id": "1", "name": "near C81", "along_track_nm": 10.0},
            {"osm_id": "2", "name": "near KDLH", "along_track_nm": 280.0},
        ]}

    monkeypatch.setattr(model_client, "invoke", invoke)

    answer = scoring.invoke_model("KDLH", "C81")

    assert [c["name"] for c in answer["checkpoints"]] == ["near KDLH", "near C81"]
    from vfr import geo
    total = geo.distance_nm(42.3172, -88.0905, 46.8421, -92.1936)   # conftest's C81 and KDLH
    assert answer["checkpoints"][0]["along_track_nm"] == pytest.approx(total - 280.0, abs=0.01)
    assert answer["departure_ident"] == "KDLH"


def test_a_corridor_built_neither_way_is_still_a_404(monkeypatch, tmp_path):
    import pytest
    from fastapi import HTTPException
    from vfr import model_client

    from app import scoring

    monkeypatch.setattr(scoring, "paths", lambda dep, dest: (tmp_path / "c.csv", tmp_path / "f.parquet"))
    monkeypatch.setattr(model_client, "invoke", lambda dep, dest, model=None: (_ for _ in ()).throw(
        model_client.RouteNotCollected(dep, dest)))

    with pytest.raises(HTTPException) as err:
        scoring.invoke_model("KDLH", "C81")
    assert err.value.status_code == 404
