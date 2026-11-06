"""A file's table read once, however many ask for it at once.

functools.lru_cache keeps what a function returned, but does nothing for
callers that come while the first is still working it out: each misses
and works it out too. After a restart the planner's warm-up and every
request that came in the meantime -- the map's airports in view, each
card's place, the Stops along a route -- were each reading the same FAA
file and building the same table, a copy apiece, and the planner answered
nothing, not even its health check, for minutes (py-spy on the live
planner, 2026-10-28: four request threads and the warm-up all in
faa_data._contacts_of). `once` is lru_cache with one builder per key: the
others wait for its answer and take it.
"""

import threading
from collections.abc import Callable
from functools import lru_cache, wraps
from typing import ParamSpec, TypeVar

P = ParamSpec("P")
R = TypeVar("R")


def once(maxsize: int | None = 128) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """lru_cache(maxsize), each key built by one caller at a time. A hit
    takes the key's lock only while another caller is still building it."""
    def decorate(build: Callable[P, R]) -> Callable[P, R]:
        cached = lru_cache(maxsize=maxsize)(build)
        locks: dict = {}
        guard = threading.Lock()

        @wraps(build)
        def read(*args: P.args, **kwargs: P.kwargs) -> R:
            key = (args, tuple(sorted(kwargs.items())))
            with guard:
                lock = locks.setdefault(key, threading.RLock())
            with lock:
                try:
                    return cached(*args, **kwargs)
                finally:
                    # Dropped once built, so the locks do not outlive the
                    # cache's own keys; a caller already waiting on it holds
                    # its own reference and finds the answer cached.
                    with guard:
                        if locks.get(key) is lock:
                            del locks[key]

        read.cache_clear = cached.cache_clear  # type: ignore[attr-defined]
        read.cache_info = cached.cache_info  # type: ignore[attr-defined]
        return read
    return decorate
