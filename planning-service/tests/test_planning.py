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
