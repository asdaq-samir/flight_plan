"""adsb.lol, the map's traffic: its API asked about a region at most once in five seconds
(the package's docstring says how), a pilot's search asked ahead of the regions' turns, and its
globe's traces of an airplane, today's and its last few minutes."""
from __future__ import annotations

import math
import threading

import requests
from cachetools import TTLCache

from .common import HEADERS, TIMEOUT_S, TrafficUnavailable, _LOCK, _NM_PER_DEG, _aircraft, _clock, _number, _sleep, _wall

URL = "https://api.adsb.lol/v2/point/{lat:.2f}/{lon:.2f}/{radius}"

#: A region's side, degrees, and how far round its middle it is asked
#: for: a view's middle is at most a quarter degree from the region's
#: (15 nm north and south, less east and west), so 80 nm holds a view of 60.
REGION_DEG = 0.5
REGION_RADIUS_NM = 80
#: The furthest a view is given its traffic from those regions, nm.
NEAR_RADIUS_NM = 60
#: A view further out than that -- the map zoomed out to a state or two,
#: whose traffic the pilot asked to see wherever it is panned -- from
#: regions of two degrees, asked for out to 250 nm, adsb.lol's furthest:
#: a view's middle is at most a degree from the region's (60 nm north and
#: south, 54 east and west as far south as 25 degrees north, 81 nm across),
#: so 250 nm holds a view of 165. Round O'Hare that was 474 airplanes and
#: 240 kB, answered in under a second (2026-10-11).
WIDE_REGION_DEG = 2.0
WIDE_REGION_RADIUS_NM = 250
#: The furthest a view is asked about, nm.
MAX_RADIUS_NM = 165
#: A region's answer is given again, not asked for, this long.
FRESH_S = 5.0
#: Never two requests to adsb.lol closer together than this.
MIN_GAP_S = 5.0
#: Turned away or not answered, nothing is asked for this long.
BACKOFF_S = 15.0
#: A region's last answer is given while adsb.lol cannot be asked, until
#: it is this old; then traffic is said to be unavailable.
KEEP_S = 60.0

#: Each region's last answer: (when it came, monotonic, airplanes).
_REGIONS: dict = {}
#: When adsb.lol may next be asked for a region (the regions' turns are
#: taken in order from it), when the last request went, when a search's
#: turn is, and until when nothing is asked after a refusal; monotonic.
_STATE = {"next_ask": 0.0, "last_ask": -math.inf, "search_at": -math.inf, "blocked_until": -math.inf}
#: Regions being asked for now; the rest of a region's askers wait on this.
_FLIGHTS: dict = {}

#: Regions whose kept answer is ADS-B Exchange's, for its credit.
_FROM_ADSBX: set = set()


def _region(lat: float, lon: float, radius_nm: float = NEAR_RADIUS_NM) -> tuple[float, float, int]:
    """The region a view of `radius_nm` round a point is given its traffic
    from: (its middle's latitude and longitude, how far round it adsb.lol
    is asked), a near one for a view of 60 nm or less, else a wide one."""
    deg, asked = (REGION_DEG, REGION_RADIUS_NM) if radius_nm <= NEAR_RADIUS_NM else (WIDE_REGION_DEG, WIDE_REGION_RADIUS_NM)
    return round(lat / deg) * deg, round(lon / deg) * deg, asked


def _ask(region: tuple[float, float, int]) -> list[dict]:
    """adsb.lol's airplanes round a region's middle. Raises
    TrafficUnavailable where it turns the request away or does not answer."""
    try:
        resp = requests.get(URL.format(lat=region[0], lon=region[1], radius=region[2]), headers=HEADERS, timeout=TIMEOUT_S)
        resp.raise_for_status()
        entries = resp.json().get("ac") or []
    except (requests.RequestException, ValueError) as err:
        raise TrafficUnavailable(f"adsb.lol did not answer: {err}") from err
    return [a for a in (_aircraft(e) for e in entries if isinstance(e, dict)) if a is not None]


def _region_turn(now: float) -> float:
    """The next region's turn to ask adsb.lol, taken: the first free one,
    a gap clear of a search's. Called with the lock held."""
    slot = max(now, _STATE["next_ask"])
    if abs(_STATE["search_at"] - slot) < MIN_GAP_S:
        slot = _STATE["search_at"] + MIN_GAP_S
    _STATE["next_ask"] = slot + MIN_GAP_S
    return slot


def _region_answer(region: tuple[float, float, int]) -> tuple[float, list[dict]]:
    """(when it came, airplanes) for a region: its last answer while fresh,
    or while adsb.lol may not be asked yet; else adsb.lol's -- for a
    region with none, after waiting out the gap between requests -- else,
    turned away, its last answer while not too old. One asker at a time
    per region: the rest wait for its answer and are given it. The lock
    is held only to decide and to store, never across the wait or the
    request, so a phone whose region has an answer is never kept behind
    another's request."""
    while True:
        with _LOCK:
            held = _REGIONS.get(region)
            now = _clock()
            kept = held is not None and now - held[0] < KEEP_S
            if held and now - held[0] < FRESH_S:
                return held
            wait = _STATE["next_ask"] - now
            if wait > 0 and kept:
                return held
            flight = _FLIGHTS.get(region)
            if flight is None:
                # Past two gaps is a back-off, not a queue of regions.
                if wait > 2 * MIN_GAP_S:
                    raise TrafficUnavailable("adsb.lol has not answered for a while")
                # Take the next free place between requests now, so the
                # next asker's place is a gap after this one's.
                slot = _region_turn(now)
                flight = _FLIGHTS[region] = threading.Event()
                break
        # Another phone is asking for this region: wait for it, then look again.
        flight.wait(TIMEOUT_S + 2 * MIN_GAP_S + 1)
    try:
        while True:
            if slot > now:
                _sleep(slot - now)
            with _LOCK:
                now = _clock()
                # A search took a turn within a gap of this one since it
                # was taken: it goes first, and the region is given its
                # last answer, or waits for a turn after the search's.
                go = abs(_STATE["search_at"] - slot) >= MIN_GAP_S
                if go:
                    _STATE["last_ask"] = now
                    break
                if kept:
                    break
                slot = _region_turn(now)
        if not go:
            return held
        asked = now
        try:
            answer = (asked, _ask(region))
        except TrafficUnavailable:
            answer = None
        with _LOCK:
            if answer is None:
                _STATE["next_ask"] = asked + BACKOFF_S
                _STATE["blocked_until"] = asked + BACKOFF_S
            else:
                _REGIONS[region] = answer
                _FROM_ADSBX.discard(region)
                if len(_REGIONS) > 256:
                    for gone in [r for r, (at, _) in _REGIONS.items() if asked - at > KEEP_S]:
                        del _REGIONS[gone]
    finally:
        with _LOCK:
            _FLIGHTS.pop(region, None)
        flight.set()
    if answer is not None:
        return answer
    if kept:
        return held
    raise TrafficUnavailable("adsb.lol has not answered for a while")


def _covering(lat: float, lon: float, radius_nm: float) -> tuple[float, list[dict]] | None:
    """The freshest kept answer of any region whose asked circle holds the
    whole view (its middle's distance plus the view's radius within it),
    not older than KEEP_S; None where none does."""
    now = _clock()
    best = None
    with _LOCK:
        for (rlat, rlon, asked), (at, planes) in _REGIONS.items():
            if now - at >= KEEP_S:
                continue
            apart = math.hypot((rlat - lat) * _NM_PER_DEG, (rlon - lon) * _NM_PER_DEG * math.cos(math.radians(lat)))
            if apart + radius_nm <= asked and (best is None or at > best[0]):
                best = (at, planes)
    return best


FIND_URL = "https://api.adsb.lol/v2/{by}/{value}"
#: The same open data's globe (adsb.lol's tar1090), where the traces are:
#: adsb.lol itself, as globe.adsb.lol answers every read with a redirect
#: here (seen 2026-10-16), a hop that cost 0.4 s a file (1.1 s against
#: 0.7 s, three reads each way).
GLOBE = "https://adsb.lol"
#: The day's track of an airplane, by its ICAO address: readsb's trace,
#: on the globe, gzip JSON.
TRACE_URL = GLOBE + "/data/traces/{last2}/trace_full_{hex}.json"
#: A trace is read again after this long, s: the map adds the reports
#: between (TrafficLayer).
TRACE_TTL_S = 60

_TRACES: TTLCache = TTLCache(maxsize=64, ttl=TRACE_TTL_S)
#: An airplane's last few minutes, on the same globe: the trace readsb
#: writes every few seconds (3 to 8 s old, measured 2026-10-12, where the
#: full trace was 4 to 7 minutes behind). A static file, not the API, so
#: a search by registration or address costs none of the API's turns.
RECENT_URL = GLOBE + "/data/traces/{last2}/trace_recent_{hex}.json"
#: A recent trace is read again after this long, s.
RECENT_TTL_S = 5
#: Each airplane's recent trace as read (None for a 404), for its search's
#: answer and its alerts' state (`status`).
_RECENT: TTLCache = TTLCache(maxsize=256, ttl=RECENT_TTL_S)

_TRACE_GATES: dict[str, threading.Lock] = {}


def _paced(url: str) -> dict:
    """adsb.lol's answer to a pilot's search, asked ahead of the regions'
    turns: a gap after the last request that went and the last search's,
    never two within MIN_GAP_S still (a region whose turn it falls near
    gives way, `_region_answer`). Behind a refusal's back-off it is not
    asked: TrafficUnavailable."""
    with _LOCK:
        now = _clock()
        slot = max(now, _STATE["last_ask"] + MIN_GAP_S, _STATE["search_at"] + MIN_GAP_S, _STATE["blocked_until"])
        if slot - now > 2 * MIN_GAP_S:
            raise TrafficUnavailable("adsb.lol has not answered for a while")
        _STATE["search_at"] = slot
    if slot > now:
        _sleep(slot - now)
    with _LOCK:
        _STATE["last_ask"] = max(_STATE["last_ask"], _clock())
    try:
        resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT_S)
        resp.raise_for_status()
        return resp.json()
    except (requests.RequestException, ValueError) as err:
        with _LOCK:
            _STATE["next_ask"] = _STATE["blocked_until"] = _clock() + BACKOFF_S
        raise TrafficUnavailable(f"adsb.lol did not answer: {err}") from err


def _heard(text: str) -> list[dict]:
    """The airplanes a region's last answer (any phone's, a minute at
    most) has by this callsign, registration or ICAO address, freshest
    first, each `seen_s` counted from now. Called with the lock held."""
    now = _clock()
    bare = text.replace("-", "")
    best: dict[str, dict] = {}
    for at, planes in _REGIONS.values():
        if now - at >= KEEP_S:
            continue
        for plane in planes:
            if text.lower() not in (plane["hex"], plane["hex"].lstrip("~")) and (plane["callsign"] or "").upper() != text \
                    and (plane["registration"] or "").replace("-", "").upper() != bare:
                continue
            aged = {**plane, "seen_s": round((plane["seen_s"] or 0.0) + now - at, 1)}
            if plane["hex"] not in best or aged["seen_s"] < best[plane["hex"]]["seen_s"]:
                best[plane["hex"]] = aged
    return sorted(best.values(), key=lambda plane: plane["seen_s"])


#: adsb.lol's credit, the map's traffic's by default (the planner's
#: Traffic schema), for a search's answer from it.
ADSB_LOL_SOURCE = {"source": "adsb.lol", "license": "ODbL 1.0"}


def _recent_trace(hex_id: str):
    """An airplane's recent trace (RECENT_URL), kept RECENT_TTL_S: a dict,
    None where it has none (a 404), UNREAD where it cannot be read now."""
    with _LOCK:
        if hex_id in _RECENT:
            return _RECENT[hex_id]
    try:
        resp = _globe_get(RECENT_URL.format(last2=hex_id[-2:], hex=hex_id), TIMEOUT_S)
        if resp.status_code == 404:
            trace = None
        elif resp.status_code == 200:
            trace = resp.json()
            if not isinstance(trace, dict):
                trace = None
        else:
            return UNREAD
    except (requests.RequestException, ValueError, _GlobeRefused):
        return UNREAD
    with _LOCK:
        _RECENT[hex_id] = trace
    return trace


def _recent(hex_id: str) -> list[dict] | None:
    """The airplane with this address as its recent trace last has it, as
    `_aircraft` gives it: [it] in the air and heard within STALE_S, [] on
    the ground, not heard that recently or with no recent trace (a 404),
    None where the trace cannot be read now (the API is asked instead)."""
    trace = _recent_trace(hex_id)
    if trace is UNREAD:
        return None
    plane = _last_heard(trace) if trace else None
    return [plane] if plane is not None else []


def _last_heard(trace: dict) -> dict | None:
    """A trace's last point as the API's answer has an airplane, read by
    `_aircraft`: readsb's trace point is [seconds after the trace's
    timestamp, lat, lon, altitude or "ground", ground speed, track, flags,
    vertical rate, details, source, GNSS altitude, GNSS rate, ...], the
    callsign and squawk in the last point that carries details."""
    points = [p for p in trace.get("trace") or [] if isinstance(p, list) and len(p) >= 8]
    base = _number(trace.get("timestamp"))
    if not points or base is None:
        return None
    last = points[-1]
    details = next((p[8] for p in reversed(points) if len(p) > 8 and isinstance(p[8], dict)), {})
    return _aircraft({
        "hex": trace.get("icao"), "flight": details.get("flight"), "r": trace.get("r"), "t": trace.get("t"),
        "lat": last[1], "lon": last[2], "alt_baro": last[3], "alt_geom": last[10] if len(last) > 10 else None,
        "gs": last[4], "track": last[5], "baro_rate": last[7], "geom_rate": last[11] if len(last) > 11 else None,
        "seen_pos": round(max(0.0, _wall() - base - float(last[0])), 1),
        "squawk": details.get("squawk"), "emergency": details.get("emergency"),
    })


#: How long the globe's files are not asked for after it turns the planner
#: away, s. Since 2026-10-23 adsb.lol answers the planner's requests for
#: its trace files with a "Verification" page and a 403, a browser check
#: the planner cannot pass; asked again on every card, each refusal took
#: 0.7 to 4 s, and a card's past flights asked for fourteen days of them,
#: 5 to 13 s, before showing what it had anyway (the recorded track).
GLOBE_BACKOFF_S = 600.0
_GLOBE = {"blocked_until": -math.inf}


class _GlobeRefused(Exception):
    """The globe turned the planner away, now or within GLOBE_BACKOFF_S."""


def _globe_get(url: str, timeout: float):
    """A file off adsb.lol's globe, or _GlobeRefused where it is turning
    the planner away: a 403 or a 429, or a page in place of the file (its
    verification wall answers 200 to some), starts GLOBE_BACKOFF_S without
    asking."""
    if _clock() < _GLOBE["blocked_until"]:
        raise _GlobeRefused("adsb.lol's globe turned the planner away a moment ago")
    resp = requests.get(url, headers=HEADERS, timeout=timeout)
    page = "html" in str(resp.headers.get("content-type") or "").lower()
    if resp.status_code in (403, 429) or (resp.status_code == 200 and page):
        _GLOBE["blocked_until"] = _clock() + GLOBE_BACKOFF_S
        raise _GlobeRefused(f"adsb.lol's globe answered {resp.status_code}")
    return resp


def _trace(hex_id: str) -> dict | None:
    """An airplane's trace today, read once a minute; None where there is
    none or it cannot be had (the flight is then drawn without its past).
    Only an answer is kept -- a 404 is the airplane having no trace today
    -- never a timeout or a refusal, which is asked again at the next
    read. One read per airplane at a time: a second asker waits for it
    and is given what it kept."""
    with _LOCK:
        if hex_id in _TRACES:
            return _TRACES[hex_id]
        gate = _TRACE_GATES.setdefault(hex_id, threading.Lock())
    with gate:
        with _LOCK:
            if hex_id in _TRACES:
                return _TRACES[hex_id]
        try:
            resp = _globe_get(TRACE_URL.format(last2=hex_id[-2:], hex=hex_id), TIMEOUT_S)
            if resp.status_code == 200:
                trace = resp.json()
                # Anything but an object is not a trace: no past, not a 500.
                if not isinstance(trace, dict):
                    trace = None
            elif resp.status_code == 404:
                trace = None
            else:
                return None
        except (requests.RequestException, ValueError, _GlobeRefused):
            return None
        with _LOCK:
            _TRACES[hex_id] = trace
            if len(_TRACE_GATES) > 256:
                _TRACE_GATES.clear()
    return trace


class _Unread:
    """A day's trace that could not be had now: refused or not answered."""


#: What `_day_trace` gives for a day it could not read, as against None,
#: a day the airplane has no trace.
UNREAD = _Unread()
