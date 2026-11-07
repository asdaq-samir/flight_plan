"""An airplane watched: its track recorded as it is asked for, and the followed airplanes asked
for in the background."""
from __future__ import annotations

import logging
import math
import threading

from ..config import get_settings
from .common import STALE_S, TrafficUnavailable, _LOCK, _NM_PER_DEG, _aircraft, _clock, _sleep, _wall
from .adsb_lol import ADSB_LOL_SOURCE, FIND_URL, _paced
from .adsbx import ADSBX_SOURCE, _adsbx
from .adsbfi import ADSBFI_MIN_GAP_S, ADSBFI_SOURCE, _ADSBFI, _adsbfi
from .recorded import _FOLLOWED, _followed, _record, _recorded
from .radar import _heard_elsewhere_now

log = logging.getLogger(__name__)

#: adsb.lol's globe, where the traces are, answers the planner with a
#: browser check since 2026-10-19 (a 403 and an HTML page), so a card's
#: trail and an alert's state came back empty for every airplane; and
#: some airplanes no adsb.lol feeder hears at all -- N3429J, a UAT
#: airplane rebroadcast by the FAA's ADS-R, which ADS-B Exchange and
#: FlightAware had while adsb.lol had nothing (the owner's screenshots,
#: 2026-10-19). An airplane whose card is open is asked for by its address
#: -- adsb.lol's API first, ADS-B Exchange where it has nothing -- and its
#: positions are kept: its trail, the field it left, and its place on the
#: map, where a region's answer does not have it.
#: Its card is open while its flight was asked for this recently, s: the
#: card asks each minute (queryClient's flightQuery).
WATCH_FOR_S = 150.0
#: A watched airplane is asked for at most this often, s: about the map's
#: own traffic rate, and at ADS-B Exchange's prices (its RapidAPI plan, a
#: month's 10,000) some 180 an hour while a card stays open.
WATCH_GAP_S = 20.0

_WATCHED: dict[str, float] = {}
_WATCH_ASKED: dict[str, float] = {}
#: Whose a watched airplane's last report was, for the map's credit.
_WATCH_SOURCE: dict[str, str] = {}

#: How often each followed airplane is asked for in the background, s:
#: its flights recorded as FlightAware records them, card open or not
#: (the owner's screenshots of N3429J's day, 2026-10-19, of which the
#: planner had nothing). Of adsb.fi alone, which costs nothing, at its
#: one request a second; adsb.lol's map and ADS-B Exchange's paid month
#: are left to the map and an open card.
FOLLOW_EVERY_S = 30.0


def follow_round() -> int:
    """Each followed airplane not heard elsewhere just now (the FAA's
    radar records it, heard_elsewhere) asked of adsb.fi by its address,
    a request a second at most, and what it hears recorded. How many
    were heard."""
    _followed("")  # the followed read from their files, the first time
    with _LOCK:
        followed = sorted(_FOLLOWED)
    heard = 0
    for hex_id in followed:
        if _heard_elsewhere_now(hex_id) is not None:
            continue
        # adsb.fi's pace, a little over a second, between asks.
        with _LOCK:
            wait = _ADSBFI["last"] + ADSBFI_MIN_GAP_S - _clock()
        if wait > 0:
            _sleep(wait)
        for plane in _adsbfi(hex_id):
            if plane["hex"].lower().lstrip("~") == hex_id:
                _record(hex_id, plane)
                with _LOCK:
                    _WATCH_SOURCE[hex_id] = ADSBFI_SOURCE["source"]
                heard += 1
    return heard


def start_following() -> None:
    """The followed airplanes asked for every FOLLOW_EVERY_S on a thread
    of their own, for as long as the planner runs; nothing where adsb.fi
    is off (ADSBFI_OPEN_DATA=0)."""
    if not get_settings().adsbfi_open_data:
        return

    def run() -> None:
        while True:
            started = _clock()
            try:
                follow_round()
            except Exception:  # noqa: BLE001 -- a bad round is not the end of following
                log.exception("Following the airplanes failed this round")
            _sleep(max(1.0, FOLLOW_EVERY_S - (_clock() - started)))

    threading.Thread(target=run, name="traffic-follow", daemon=True).start()


def _watch(hex_id: str) -> None:
    """The airplane asked for now, where it is due (WATCH_GAP_S): adsb.lol's
    API by its address, then adsb.fi's, which costs nothing, then ADS-B
    Exchange where neither has it or answers; what is heard in the air
    recorded, and whose it was. Quiet where none may be asked or answers:
    the next ask tries again."""
    # The FAA's radar has it now (app.swim): recorded from there, nothing
    # asked of adsb.lol or spent of ADS-B Exchange.
    if _heard_elsewhere_now(hex_id) is not None:
        return
    now = _clock()
    with _LOCK:
        if now - _WATCH_ASKED.get(hex_id, -math.inf) < WATCH_GAP_S:
            return
        _WATCH_ASKED[hex_id] = now
    planes: list[dict] = []
    try:
        answer = _paced(FIND_URL.format(by="hex", value=hex_id))
        entries = answer.get("ac") if isinstance(answer, dict) else None
        planes = [a for a in (_aircraft(e) for e in entries if isinstance(e, dict)) if a is not None] if isinstance(entries, list) else []
    except TrafficUnavailable:
        planes = []
    source = ADSB_LOL_SOURCE["source"]
    if not planes:
        planes, source = _adsbfi(hex_id), ADSBFI_SOURCE["source"]
    if not planes:
        try:
            planes, source = _adsbx(f"icao/{hex_id}", search=True), ADSBX_SOURCE["source"]
        except TrafficUnavailable:
            planes = []
    for plane in planes:
        if plane["hex"].lower().lstrip("~") == hex_id.lstrip("~"):
            _record(hex_id, plane)
            with _LOCK:
                _WATCH_SOURCE[hex_id] = source


def _watched_near(lat: float, lon: float, radius_nm: float, have: set[str]) -> list[dict]:
    """The watched airplanes heard in the last STALE_S within `radius_nm`
    that a region's answer left out, as `_aircraft` gives each, its age
    brought up to now: where adsb.lol does not hear one, the map has it."""
    with _LOCK:
        watched = [h for h, at in _WATCHED.items() if _clock() - at < WATCH_FOR_S and h not in have]
    out = []
    for hex_id in watched:
        if _heard_elsewhere_now(hex_id) is not None:
            continue
        _watch(hex_id)
        track = _recorded(hex_id)
        if not track:
            continue
        last = track[-1]
        age = _wall() - last["t"]
        nm = math.hypot((last["lat"] - lat) * _NM_PER_DEG, (last["lon"] - lon) * _NM_PER_DEG * math.cos(math.radians(lat)))
        if age <= STALE_S and nm <= radius_nm:
            out.append({**last["plane"], "seen_s": round(age, 1)})
    return out
