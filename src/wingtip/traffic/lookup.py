"""One airplane, found by what a pilot knows it by: callsign, registration or ICAO address."""
from __future__ import annotations

import re
import threading

from cachetools import TTLCache

from .. import registry
from .common import TrafficUnavailable, _LOCK, _aircraft
from .adsb_lol import ADSB_LOL_SOURCE, FIND_URL, _heard, _paced, _recent
from .adsbx import ADSBX_SOURCE, _adsbx
from .routes import _CALLSIGN

_HEX = re.compile(r"^~?[0-9a-f]{6}$")
_N_NUMBER = re.compile(r"^N[1-9][0-9A-Z]{0,4}$")

#: A search's answer from adsb.lol is given again this long, s.
FOUND_TTL_S = 15
_FOUND: TTLCache = TTLCache(maxsize=256, ttl=FOUND_TTL_S)
_FIND_GATES: dict[str, threading.Lock] = {}


def find(query: str) -> list[dict]:
    """The airplanes in the air a pilot names (`find_credited`'s)."""
    return find_credited(query)[0]


def find_credited(query: str) -> tuple[list[dict], dict]:
    """The airplanes in the air a pilot names: by callsign ("UAL2088"),
    registration ("N174HA") or ICAO address ("a0b7d8"), as `_aircraft`
    gives each, and whose data they are ({"source", "license"}, as the
    map's traffic says it). Empty where none is in the air and heard now.
    One heard about a region in the last minute is found there, at once;
    else ADS-B Exchange is asked first (`_looked_up`), the owner's fast
    source for a search, within its month's requests; else -- or for an
    address it found nothing for -- one named by its address, or by an
    N-number the FAA's registry gives the address of, from its recent
    trace (`_recent`), which asks adsb.lol's API nothing; else adsb.lol's
    API is asked, in a search's turn. The answer is kept for FOUND_TTL_S
    so the same search again -- a second phone's, a tap back -- asks
    nothing."""
    text = re.sub(r"\s+", "", query).upper()
    if not text or not re.fullmatch(r"[~A-Z0-9-]{2,10}", text):
        return [], ADSB_LOL_SOURCE
    with _LOCK:
        heard = _heard(text)
        if heard:
            return heard, ADSB_LOL_SOURCE
        if text in _FOUND:
            return _FOUND[text]
        gate = _FIND_GATES.setdefault(text, threading.Lock())
    # One search for a name at a time: the rest wait and are given its answer.
    with gate:
        with _LOCK:
            if text in _FOUND:
                return _FOUND[text]
        try:
            looked = _looked_up(text)
            if looked is not None:
                answer = (looked, ADSBX_SOURCE)
            else:
                hex_id = _address_of(text)
                recent = _recent(hex_id) if hex_id else None
                # The API only where the trace could not be read: a search
                # there waits its turn behind the map's regions and any
                # refusal's back-off, which is what kept the owner's
                # searches waiting (2026-10-12).
                answer = (recent, ADSB_LOL_SOURCE) if recent is not None else _asked(text, adsbx_tried=True)
            # The answer is stored in the same lock section the gate is
            # dropped in, so a search arriving between finds one or the other.
            with _LOCK:
                _FOUND[text] = answer
        finally:
            with _LOCK:
                _FIND_GATES.pop(text, None)
        return answer


def _looked_up(text: str) -> list[dict] | None:
    """A pilot's search asked of ADS-B Exchange first, at the owner's ask
    ("use adsb exchange for aircraft lookup for now so it's fast"): one
    request, where adsb.lol's API answers a search in its turn, seconds
    behind the map's regions. By what the name is: an ICAO address, or an
    N-number the FAA's registry gives the address of, by that address;
    another registration by registration; an airline's flight number
    ("UAL2088") as a callsign; anything else as a callsign and then as a
    registration -- two requests at most. None where it is not keyed, the
    month's requests are spent or it does not answer (adsb.lol is asked as
    before), or where it found nothing for an address: the recent trace,
    which costs nothing, is read for it too."""
    if text.startswith("~"):
        return None
    hex_id = _address_of(text)
    if hex_id:
        tries = [("hex", hex_id)]
    elif _N_NUMBER.fullmatch(text) or "-" in text:
        tries = [("reg", text)]
    elif _CALLSIGN.fullmatch(text):
        tries = [("callsign", text)]
    else:
        tries = [("callsign", text), ("reg", text)]
    for by, value in tries:
        try:
            found = _adsbx(f"{ADSBX_BY[by]}/{value}", search=True)
        except TrafficUnavailable:
            return None
        if found:
            return found
    return None if hex_id else []


def _address_of(text: str) -> str | None:
    """The ICAO address a search names: the address itself, or the one the
    FAA's registry gives an N-number; None for a callsign, an adsb.lol
    "~" pseudo-address (it has no trace of its own) or an N-number the
    registry does not have."""
    if _HEX.fullmatch(text.lower()):
        return None if text.startswith("~") else text.lower()
    if _N_NUMBER.fullmatch(text):
        record = registry.lookup(n_number=text)
        address = (record or {}).get("mode_s_hex")
        return address.lower() if isinstance(address, str) and _HEX.fullmatch(address.lower()) else None
    return None


def registered(query: str) -> dict | None:
    """The FAA's record of the airplane a pilot names (wingtip.registry), by its
    N-number or its ICAO address: for one not in the air or not heard now,
    which a search finds nothing for, its card all the same."""
    text = re.sub(r"\s+", "", query).upper()
    if _HEX.fullmatch(text.lower()):
        return registry.lookup(hex_id=text.lower())
    return registry.lookup(n_number=text) if _N_NUMBER.fullmatch(text) else None


def _asked(text: str, adsbx_tried: bool = False) -> tuple[list[dict], dict]:
    """adsb.lol's answer to a search, and its credit: by address, callsign
    or registration, as the text reads, the next way where one finds none;
    where it turns us away, ADS-B Exchange asked the same way, unless it
    was asked about this search already (`adsbx_tried`)."""
    if _HEX.fullmatch(text.lower()):
        tries = [("hex", text.lower()), ("callsign", text)]
    elif _N_NUMBER.fullmatch(text) or "-" in text:
        tries = [("reg", text)]
    else:
        tries = [("callsign", text), ("reg", text)]
    for by, value in tries:
        credit = ADSB_LOL_SOURCE
        try:
            found = [a for a in (_aircraft(e) for e in _paced(FIND_URL.format(by=by, value=value)).get("ac") or []
                                 if isinstance(e, dict)) if a is not None]
        except TrafficUnavailable:
            if adsbx_tried:
                raise
            # adsb.lol turning us away: ADS-B Exchange asked the same way.
            found, credit = _adsbx(f"{ADSBX_BY[by]}/{value}", search=True), ADSBX_SOURCE
        if found:
            return found, credit
    return [], ADSB_LOL_SOURCE


#: adsb.lol's ways of naming an airplane, as ADS-B Exchange's API says them.
ADSBX_BY = {"hex": "icao", "callsign": "callsign", "reg": "registration"}
