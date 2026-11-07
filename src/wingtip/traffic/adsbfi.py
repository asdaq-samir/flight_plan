"""adsb.fi, the free one asked for a watched airplane."""
from __future__ import annotations

import math

import requests

from ..config import get_settings
from .common import HEADERS, TIMEOUT_S, _LOCK, _aircraft, _clock

#: adsb.fi's open data by an airplane's address (opendata.adsb.fi), in
#: ADS-B Exchange's v2 shape. Its feeders hear airplanes adsb.lol's do not
#: -- N3429J, a UAT airplane rebroadcast by ADS-R (2026-10-19) -- and it
#: costs nothing, so a watched airplane is asked of it before ADS-B
#: Exchange's paid month. Its terms (github.com/adsbfi/opendata): personal,
#: non-commercial use, adsb.fi credited with a link to adsb.fi (the map's
#: credit, the console's About); commercial use by its leave only. On by
#: default, for the owner's own use before launch; ADSBFI_OPEN_DATA=0 turns
#: it off, as the production stack has it until adsb.fi agrees.
ADSBFI_URL = "https://opendata.adsb.fi/api/v2/hex/{hex}"
#: One request a second at most (its public endpoints' limit), from the
#: whole planner.
ADSBFI_MIN_GAP_S = 1.1
#: Where it turns us away, not asked again for this long, s: its refusals
#: count toward a ban of the address.
ADSBFI_BACKOFF_S = 600.0
ADSBFI_SOURCE = {"source": "adsb.fi", "license": "adsb.fi terms"}
_ADSBFI = {"last": -math.inf, "blocked_until": -math.inf}


def _adsbfi(hex_id: str) -> list[dict]:
    """adsb.fi's report of an airplane by its address, as `_aircraft` gives
    it; none where it is off, may not be asked yet (ADSBFI_MIN_GAP_S),
    turned us away lately, or does not answer."""
    if not get_settings().adsbfi_open_data:
        return []
    with _LOCK:
        now = _clock()
        if now < _ADSBFI["blocked_until"] or now - _ADSBFI["last"] < ADSBFI_MIN_GAP_S:
            return []
        _ADSBFI["last"] = now
    try:
        resp = requests.get(ADSBFI_URL.format(hex=hex_id), headers=HEADERS, timeout=TIMEOUT_S)
        if resp.status_code != 200:
            with _LOCK:
                _ADSBFI["blocked_until"] = _clock() + ADSBFI_BACKOFF_S
            return []
        entries = resp.json().get("ac") or []
    except (requests.RequestException, ValueError, AttributeError):
        return []
    return [a for a in (_aircraft(e) for e in entries if isinstance(e, dict)) if a is not None]
