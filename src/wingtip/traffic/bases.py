"""Where an airplane is based: the field its own flights keep to."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from cachetools import TTLCache

from .common import _LOCK
from .lookup import _HEX
from .flights import history

#: An airplane's base is kept this long, s: it changes seldom.
BASED_TTL_S = 12 * 3600
#: A field is its base where at least this many of its last flights'
#: ends (takeoffs and landings) are there...
BASED_MIN_ENDS = 3
#: ...and at least this share of them.
BASED_SHARE = 0.4
#: Airplanes asked about at a time: each a history's few days of reads.
BASED_WORKERS = 2
_BASED: TTLCache = TTLCache(maxsize=4096, ttl=BASED_TTL_S)
_BASED_PENDING: set[str] = set()
_BASED_POOL = ThreadPoolExecutor(max_workers=BASED_WORKERS)


def _base_of(flights: list[dict]) -> dict | None:
    """The field most of these flights begin or end at, by BASED_MIN_ENDS
    and BASED_SHARE; None where none is. No open data says where an
    airplane is kept, so where it flies from and back to is taken for it,
    at the owner's ask (the Aircraft tab's "based at" filter, 2026-10-13)."""
    ends = [f["origin"] for f in flights if f.get("origin")] \
        + [f["destination"] for f in flights if f.get("destination") and f.get("landed")]
    counts: dict[str, int] = {}
    for end in ends:
        counts[end["ident"]] = counts.get(end["ident"], 0) + 1
    if not counts:
        return None
    ident, count = max(counts.items(), key=lambda kv: kv[1])
    if count < BASED_MIN_ENDS or count < BASED_SHARE * len(ends):
        return None
    return next(end for end in ends if end["ident"] == ident)


def _find_base(hex_id: str) -> None:
    try:
        field = _base_of(history(hex_id)["flights"])
    except Exception:  # noqa: BLE001 -- asked again next time, not kept
        with _LOCK:
            _BASED_PENDING.discard(hex_id)
        return
    with _LOCK:
        _BASED[hex_id] = field
        _BASED_PENDING.discard(hex_id)


def based(hexes: list[str]) -> dict:
    """Where each of these airplanes is based (`_base_of` over its last
    flights, `history`): {"based": {hex: field or None}, "pending": [hex]}
    -- those not known yet are looked up in the background, two airplanes
    at a time, and given on a later ask."""
    known: dict[str, dict | None] = {}
    pending: list[str] = []
    asking: list[str] = []
    with _LOCK:
        for hex_id in dict.fromkeys(h.lower() for h in hexes if _HEX.fullmatch(h.lower()) and not h.startswith("~")):
            if hex_id in _BASED:
                known[hex_id] = _BASED[hex_id]
                continue
            pending.append(hex_id)
            if hex_id not in _BASED_PENDING:
                _BASED_PENDING.add(hex_id)
                asking.append(hex_id)
    # Handed to the pool once the lock is let go: a lookup takes it to store.
    for hex_id in asking:
        _BASED_POOL.submit(_find_base, hex_id)
    return {"based": known, "pending": pending}
