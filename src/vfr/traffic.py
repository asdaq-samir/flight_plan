"""Traffic near a point, for the map: the airplanes ADS-B receivers on the
ground are hearing there now, from adsb.lol's open data (api.adsb.lol,
`/v2/point/{lat}/{lon}/{radius}`; the data under the Open Database
License 1.0, said on the map where it is drawn).

Seconds old by the time it is drawn, with holes where no receiver hears:
for knowing what is about, not for avoiding it. 14 CFR 91.113(b) asks
the pilot to see and avoid whatever the screen shows.

adsb.lol answers one request every few seconds from one address and
turns the rest away (429 Too Many Requests: of twelve asked 1.5 s apart
on 2026-10-10, three were answered). So the planner asks it about a
region -- half a degree square, out to 80 nm, which holds any view of 60
nm whose middle is in it; two degrees square, out to 250 nm, for a view
zoomed further out, up to 165 nm -- at most once in five seconds, never two
requests within five seconds of each other whatever the region, and
waits fifteen after being turned away; between times every phone is
given the region's last answer, cut to its own view, with how old it is,
so the map can carry each airplane on from where it was (TrafficLayer).
A pilot's search for one airplane goes ahead of the regions' turns, which
are given their last answer meanwhile, and one already heard about any
region is found at once, with no request at all.
"""
from __future__ import annotations

import json
import math
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from pathlib import Path

import numpy as np
import requests
from cachetools import TTLCache

from . import airports, geo, registry
from .config import DATA_DIR

URL = "https://api.adsb.lol/v2/point/{lat:.2f}/{lon:.2f}/{radius}"
HEADERS = {"User-Agent": "wingtip-maps/0.1 (VFR flight planner; traffic for pilots' situational awareness)"}
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
#: A position older than this is left out: the airplane is somewhere else.
STALE_S = 30.0
#: How long one request may take.
TIMEOUT_S = 5.0

_NM_PER_DEG = 60.0

# Monotonic clock and sleep, through the module so the tests can stand in.
_clock = time.monotonic
_sleep = time.sleep
#: The wall clock, for a trace's times, which are Unix seconds.
_wall = time.time

_LOCK = threading.Lock()
#: Each region's last answer: (when it came, monotonic, airplanes).
_REGIONS: dict = {}
#: When adsb.lol may next be asked for a region (the regions' turns are
#: taken in order from it), when the last request went, when a search's
#: turn is, and until when nothing is asked after a refusal; monotonic.
_STATE = {"next_ask": 0.0, "last_ask": -math.inf, "search_at": -math.inf, "blocked_until": -math.inf}
#: Regions being asked for now; the rest of a region's askers wait on this.
_FLIGHTS: dict = {}


class TrafficUnavailable(RuntimeError):
    """adsb.lol has not answered for a while."""


# --- ADS-B Exchange, the fallback where adsb.lol turns us away ---

#: ADS-B Exchange's API through RapidAPI, the same readsb answer as
#: adsb.lol's (`ac`), asked only where adsb.lol has refused or not
#: answered, at the owner's ask ("a hybrid solution of adsb.lol and adsb
#: exchange community version"): its non-commercial plan, 10,000 requests
#: a month. Off unless ADSBX_RAPIDAPI_KEY is set.
ADSBX_HOST = "adsbexchange-com1.p.rapidapi.com"
ADSBX_URL = "https://adsbexchange-com1.p.rapidapi.com/v2/{path}/"
#: Requests a month at most, short of the plan's 10,000 so a month's end
#: never brings its overage charges.
ADSBX_MONTHLY = int(os.environ.get("ADSBX_MONTHLY_REQUESTS", "9000"))
#: Never two of the map's region requests to it closer together than
#: this, s: 9,000 a month is one every five minutes on average; this
#: keeps a bad hour from spending a week's. A pilot's search is not held
#: to it -- it is asked at once, within the month's budget.
ADSBX_MIN_GAP_S = 30.0
#: Where the month's count is kept, so a restart does not forget it: the
#: project's data folder (vfr.config), where it went to the planner's
#: working folder from a path of its own, outside the data kept between
#: containers and not ignored by git.
ADSBX_USAGE_FILE = Path(os.environ.get("ADSBX_USAGE_FILE", str(DATA_DIR / "raw" / "adsbx_usage.json")))
#: Its credit, as the map says it where it draws what it gave.
ADSBX_SOURCE = {"source": "ADS-B Exchange", "license": "ADS-B Exchange terms"}
_ADSBX = {"last": -math.inf}


def _adsbx_spend(search: bool = False) -> bool:
    """One of the month's requests to ADS-B Exchange taken, where there is a
    key, the month has one left and -- for the map's regions, not a pilot's
    search, which is asked at once -- the gap since the last region's is
    kept; the count kept on disk."""
    if not os.environ.get("ADSBX_RAPIDAPI_KEY"):
        return False
    month = time.strftime("%Y-%m", time.gmtime(_wall()))
    with _LOCK:
        if not search and _clock() - _ADSBX["last"] < ADSBX_MIN_GAP_S:
            return False
        try:
            used = json.loads(ADSBX_USAGE_FILE.read_text()) if ADSBX_USAGE_FILE.exists() else {}
        except (OSError, ValueError):
            used = {}
        if used.get(month, 0) >= ADSBX_MONTHLY:
            return False
        used = {month: used.get(month, 0) + 1}
        try:
            ADSBX_USAGE_FILE.parent.mkdir(parents=True, exist_ok=True)
            ADSBX_USAGE_FILE.write_text(json.dumps(used))
        except OSError:
            return False
        if not search:
            _ADSBX["last"] = _clock()
    return True


def _adsbx(path: str, search: bool = False) -> list[dict]:
    """ADS-B Exchange's airplanes for a path of its API ("lat/42.00/lon/
    -88.00/dist/80", "callsign/UAL2088"), as `_aircraft` gives each.
    TrafficUnavailable where it may not be asked now or does not answer."""
    if not _adsbx_spend(search):
        raise TrafficUnavailable("ADS-B Exchange may not be asked now")
    try:
        resp = requests.get(ADSBX_URL.format(path=path), timeout=TIMEOUT_S, headers={
            **HEADERS, "x-rapidapi-key": os.environ.get("ADSBX_RAPIDAPI_KEY", ""), "x-rapidapi-host": ADSBX_HOST})
        _adsbx_counted(resp.headers)
        resp.raise_for_status()
        entries = resp.json().get("ac") or []
    except (requests.RequestException, ValueError) as err:
        raise TrafficUnavailable(f"ADS-B Exchange did not answer: {err}") from err
    return [a for a in (_aircraft(e) for e in entries if isinstance(e, dict)) if a is not None]


# --- adsb.fi, the free one asked for a watched airplane ---

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
    if os.environ.get("ADSBFI_OPEN_DATA", "1") == "0":
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


def _adsbx_counted(headers) -> None:
    """The month's count brought up to what RapidAPI says the key has used
    (its limit less what remains, on every answer): the same key spent
    elsewhere -- a developer's own lookups, another copy of the planner --
    counts against the plan's 10,000 too, which the planner's own count
    alone would not know."""
    try:
        used = int(headers.get("x-ratelimit-api-requests-limit")) - int(headers.get("x-ratelimit-api-requests-remaining"))
    except (TypeError, ValueError):
        return
    month = time.strftime("%Y-%m", time.gmtime(_wall()))
    with _LOCK:
        try:
            kept = json.loads(ADSBX_USAGE_FILE.read_text()) if ADSBX_USAGE_FILE.exists() else {}
        except (OSError, ValueError):
            kept = {}
        if used > kept.get(month, 0):
            try:
                ADSBX_USAGE_FILE.write_text(json.dumps({month: used}))
            except OSError:
                pass


#: Regions whose kept answer is ADS-B Exchange's, for its credit.
_FROM_ADSBX: set = set()


def _number(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _aircraft(entry: dict) -> dict | None:
    """One airplane as the map draws it; None on the ground, without a
    position, or with one too old. Its height the GNSS's where it sends
    one (`alt_geom`, height above the WGS84 ellipsoid, as a phone's GNSS
    fix is; about 100 ft from mean sea level over the US, and not the
    pressure altitude ATC and TCAS use), else its pressure altitude
    (`alt_baro`), which `pressure_altitude` says."""
    lat, lon = _number(entry.get("lat")), _number(entry.get("lon"))
    seen = _number(entry.get("seen_pos"))
    if lat is None or lon is None or entry.get("alt_baro") == "ground" or (seen is not None and seen > STALE_S):
        return None
    geometric, pressure = _number(entry.get("alt_geom")), _number(entry.get("alt_baro"))
    return {
        "hex": str(entry.get("hex") or ""),
        "callsign": (entry.get("flight") or "").strip() or None,
        "registration": entry.get("r") or None,
        "type": entry.get("t") or None,
        "lat": round(lat, 5), "lon": round(lon, 5),
        "altitude_ft": geometric if geometric is not None else pressure,
        "pressure_altitude": geometric is None and pressure is not None,
        "track_deg": _number(entry.get("track")),
        "speed_kt": _number(entry.get("gs")),
        "vertical_fpm": _number(entry.get("geom_rate") if entry.get("geom_rate") is not None else entry.get("baro_rate")),
        "seen_s": seen,
        # What its transponder is set to, and an emergency it declares
        # (7500, 7600, 7700 are "unlawful", "nordo", "general").
        "squawk": entry.get("squawk") or None,
        "emergency": entry.get("emergency") if entry.get("emergency") not in (None, "", "none") else None,
        # What it is, as its transponder says (DO-260B's emitter category:
        # A1 light, A2 small, A3 large, A4 a B757, A5 heavy, A6 high
        # performance, A7 rotorcraft, B1 glider, B6 unmanned): the
        # Aircraft tab's filter by kind.
        "category": entry.get("category") or None,
    }


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


def near(lat: float, lon: float, radius_nm: float) -> dict:
    """The airplanes in the air within `radius_nm` (at most 165) of a
    point, as `_aircraft` gives each, and `age_s`, how many seconds before
    now they were where they are given (each `seen_s` more): {"aircraft",
    "age_s"}. Raises TrafficUnavailable where adsb.lol has not answered
    for a minute."""
    radius = min(MAX_RADIUS_NM, radius_nm)
    region = _region(lat, lon, radius)
    credit: dict = {}
    try:
        at, planes = _region_answer(region)
        with _LOCK:
            if region in _FROM_ADSBX:
                credit = ADSBX_SOURCE
    except TrafficUnavailable:
        # A view panned into a region not asked about yet while adsb.lol
        # waits out a refusal, or behind other regions' turns, was a 503
        # and "Traffic isn't available" over the map (the owner's, over
        # Indiana, 2026-10-11). Another region's answer that holds the
        # whole view -- the wide one it was zoomed out from, the one next
        # door -- is given instead, with its age.
        covering = _covering(lat, lon, radius)
        if covering is None:
            # None to give: ADS-B Exchange asked for the region instead,
            # kept as adsb.lol's answer would be, and credited.
            asked = _clock()
            planes = _adsbx(f"lat/{region[0]:.2f}/lon/{region[1]:.2f}/dist/{min(250, region[2])}")
            with _LOCK:
                _REGIONS[region] = (asked, planes)
                _FROM_ADSBX.add(region)
            covering = (asked, planes)
            credit = ADSBX_SOURCE
        at, planes = covering
    if planes:
        lats = np.array([p["lat"] for p in planes])
        lons = np.array([p["lon"] for p in planes])
        # Flat-earth miles: within 165 the error is a mile or two, at the
        # edge of a view the size of a state.
        nm = np.hypot((lats - lat) * _NM_PER_DEG, (lons - lon) * _NM_PER_DEG * np.cos(np.radians(lat)))
        planes = [p for p, d in zip(planes, nm) if d <= radius]
    # An airplane whose card is open and that adsb.lol does not hear (a UAT
    # airplane ADS-R rebroadcasts), from its own asks: on the map with the
    # rest, whose its report was credited with the region's.
    have = {p["hex"].lower() for p in planes}
    watched = _watched_near(lat, lon, radius, have)
    if watched:
        with _LOCK:
            whose = {_WATCH_SOURCE.get(p["hex"].lower(), ADSBX_SOURCE["source"]) for p in watched}
        base = (credit or ADSB_LOL_SOURCE)["source"]
        named = [base, *sorted(whose - {base})]
        credit = {**(credit or ADSB_LOL_SOURCE), "source": " and ".join(named)}
    # And the FAA's terminal radar's (app.swim): every airplane with a
    # transponder its STARS facilities track, which no ADS-B network may hear.
    radar = _elsewhere_near(lat, lon, radius, have | {p["hex"] for p in watched})
    return {"aircraft": planes + watched + radar, "age_s": round(_clock() - at, 1), **credit}


# --- One airplane: found by what a pilot knows it by, and its flight ---

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
#: At most this many points of a trail are sent: enough for a line on a
#: phone, a fraction of a long flight's.
TRAIL_POINTS = 600
#: A field within this of where a flight began on the ground is where it
#: departed from.
DEPARTED_WITHIN_NM = 3.0
#: readsb's trace flag for a point that starts a new leg.
_NEW_LEG = 2

_HEX = re.compile(r"^~?[0-9a-f]{6}$")
_N_NUMBER = re.compile(r"^N[1-9][0-9A-Z]{0,4}$")
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
#: A search's answer from adsb.lol is given again this long, s.
FOUND_TTL_S = 15
_FOUND: TTLCache = TTLCache(maxsize=256, ttl=FOUND_TTL_S)
_FIND_GATES: dict[str, threading.Lock] = {}
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


#: adsb.lol's credit, the map's traffic's by default (the planner's
#: Traffic schema), for a search's answer from it.
ADSB_LOL_SOURCE = {"source": "adsb.lol", "license": "ODbL 1.0"}


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


def _recent_trace(hex_id: str):
    """An airplane's recent trace (RECENT_URL), kept RECENT_TTL_S: a dict,
    None where it has none (a 404), UNREAD where it cannot be read now."""
    with _LOCK:
        if hex_id in _RECENT:
            return _RECENT[hex_id]
    try:
        resp = requests.get(RECENT_URL.format(last2=hex_id[-2:], hex=hex_id), headers=HEADERS, timeout=TIMEOUT_S)
        if resp.status_code == 404:
            trace = None
        elif resp.status_code == 200:
            trace = resp.json()
            if not isinstance(trace, dict):
                trace = None
        else:
            return UNREAD
    except (requests.RequestException, ValueError):
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


def registered(query: str) -> dict | None:
    """The FAA's record of the airplane a pilot names (vfr.registry), by its
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
            resp = requests.get(TRACE_URL.format(last2=hex_id[-2:], hex=hex_id), headers=HEADERS, timeout=TIMEOUT_S)
            if resp.status_code == 200:
                trace = resp.json()
                # Anything but an object is not a trace: no past, not a 500.
                if not isinstance(trace, dict):
                    trace = None
            elif resp.status_code == 404:
                trace = None
            else:
                return None
        except (requests.RequestException, ValueError):
            return None
        with _LOCK:
            _TRACES[hex_id] = trace
            if len(_TRACE_GATES) > 256:
                _TRACE_GATES.clear()
    return trace


# --- An airplane watched: its track recorded as it is asked for ---

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
#: A recorded track is kept this long, s: the archive's own reach
#: (ARCHIVE_DAYS), its flights listed with the archive's.
RECORD_KEEP_S = 30 * 86400.0
#: Where each airplane's recorded track is kept, a file each, so a restart
#: of the planner does not lose the flights it watched.
RECORDED_DIR = Path(os.environ.get("RECORDED_TRACKS_DIR", str(DATA_DIR / "raw" / "watched_tracks")))
_WATCHED: dict[str, float] = {}
_WATCH_ASKED: dict[str, float] = {}
#: Whose a watched airplane's last report was, for the map's credit.
_WATCH_SOURCE: dict[str, str] = {}
_RECORDED: dict[str, list[dict]] = {}


def _load_recorded(hex_id: str) -> None:
    """An airplane's recorded track read from its file the first time it is
    wanted; nothing where there is none or it cannot be read. Called with
    the lock held."""
    if hex_id in _RECORDED:
        return
    try:
        kept = json.loads((RECORDED_DIR / f"{hex_id.lstrip('~')}.json").read_text())
        _RECORDED[hex_id] = [p for p in kept if isinstance(p, dict) and "t" in p] if isinstance(kept, list) else []
    except (OSError, ValueError):
        _RECORDED[hex_id] = []


def _save_recorded(hex_id: str, track: list[dict]) -> None:
    """The track written to its file whole, through a file beside it, so a
    read never finds half of one; a failure to write leaves the old one."""
    try:
        RECORDED_DIR.mkdir(parents=True, exist_ok=True)
        path = RECORDED_DIR / f"{hex_id.lstrip('~')}.json"
        part = path.with_suffix(".part")
        part.write_text(json.dumps(track))
        part.replace(path)
    except OSError:
        pass


#: Airplanes heard by another source -- the FAA's terminal radar through
#: SWIM (planning-service's app.swim) -- by address: the latest report of
#: each, with "at" (s, wall clock), for the map where adsb.lol does not
#: hear one, and recorded for those followed.
_ELSEWHERE: dict[str, dict] = {}
#: Airplanes followed: those whose card has been opened, kept as long as
#: their recorded track (RECORDED_DIR's files), whose flights are recorded
#: from any source, card open or not.
_FOLLOWED: set[str] = set()
_FOLLOWED_READ = {"done": False}
#: A followed airplane's report from elsewhere is recorded at most this
#: often, s: STARS sweeps every 4.8 s; a point a quarter minute is a
#: track's shape on a phone and a day's file of a few hundred kB.
ELSEWHERE_RECORD_S = 15.0


def _followed(hex_id: str) -> bool:
    with _LOCK:
        if not _FOLLOWED_READ["done"]:
            _FOLLOWED_READ["done"] = True
            try:
                _FOLLOWED.update(p.stem for p in RECORDED_DIR.glob("*.json"))
            except OSError:
                pass
        return hex_id in _FOLLOWED


def follow(hex_id: str) -> None:
    """An airplane followed from now on: its card opened."""
    _followed(hex_id)
    with _LOCK:
        _FOLLOWED.add(hex_id.lstrip("~"))


def heard_elsewhere(plane: dict, at: float) -> None:
    """A report from another source (the FAA's terminal radar, app.swim),
    as `_aircraft` gives an airplane and when it was where it is (s): kept
    as the airplane's latest for the map, and recorded where it is
    followed, a point every ELSEWHERE_RECORD_S."""
    hex_id = plane["hex"]
    with _LOCK:
        was = _ELSEWHERE.get(hex_id)
        if was is not None and was["at"] >= at:
            return
        _ELSEWHERE[hex_id] = {**plane, "at": at}
        if len(_ELSEWHERE) > 20000:
            stale = [h for h, p in _ELSEWHERE.items() if at - p["at"] > STALE_S]
            for h in stale:
                del _ELSEWHERE[h]
    if _followed(hex_id):
        last = _recorded(hex_id)[-1:] or [None]
        if last[0] is None or at - last[0]["t"] >= ELSEWHERE_RECORD_S:
            _record(hex_id, {**plane, "seen_s": max(0.0, _wall() - at)})


def _heard_elsewhere_now(hex_id: str) -> dict | None:
    """Its report from elsewhere, where heard within STALE_S, its age now."""
    with _LOCK:
        plane = _ELSEWHERE.get(hex_id)
    if plane is None:
        return None
    age = _wall() - plane["at"]
    return {k: v for k, v in plane.items() if k != "at"} | {"seen_s": round(age, 1)} if age <= STALE_S else None


def _elsewhere_near(lat: float, lon: float, radius_nm: float, have: set[str]) -> list[dict]:
    """The airplanes heard elsewhere in the last STALE_S within `radius_nm`
    that the region's answer left out."""
    now = _wall()
    with _LOCK:
        planes = [p for h, p in _ELSEWHERE.items() if h not in have and now - p["at"] <= STALE_S]
    cos = math.cos(math.radians(lat))
    out = []
    for p in planes:
        if math.hypot((p["lat"] - lat) * _NM_PER_DEG, (p["lon"] - lon) * _NM_PER_DEG * cos) <= radius_nm:
            out.append({k: v for k, v in p.items() if k != "at"} | {"seen_s": round(now - p["at"], 1)})
    return out


def _record(hex_id: str, plane: dict) -> None:
    """A watched airplane's report kept as a trace point is (`_points`), its
    time when it was heard, not when it was asked."""
    at = round(_wall() - (plane.get("seen_s") or 0.0), 1)
    point = {
        "t": at, "lat": plane["lat"], "lon": plane["lon"], "alt_ft": plane.get("altitude_ft"),
        "gs_kt": plane.get("speed_kt"), "track_deg": plane.get("track_deg"), "vrate_fpm": plane.get("vertical_fpm"),
        "new_leg": False, "plane": plane,
    }
    with _LOCK:
        _load_recorded(hex_id)
        track = _RECORDED[hex_id]
        if track and track[-1]["t"] >= at:
            return
        track.append(point)
        while track and at - track[0]["t"] > RECORD_KEEP_S:
            track.pop(0)
        kept = list(track)
    _save_recorded(hex_id, kept)


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


def _watching(hex_id: str) -> bool:
    with _LOCK:
        return _clock() - _WATCHED.get(hex_id, -math.inf) < WATCH_FOR_S


def _recorded(hex_id: str) -> list[dict]:
    with _LOCK:
        _load_recorded(hex_id)
        return list(_RECORDED.get(hex_id, []))


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


def _altitude_ft(point: list) -> float | None:
    """A trace point's height: its GNSS height where it has one, as the
    map's live reports are, else its pressure altitude; None on the ground."""
    if point[3] == "ground":
        return None
    geometric = point[10] if len(point) > 10 else None
    return _number(geometric) if geometric is not None else _number(point[3])


def flight(hex_id: str) -> dict:
    """An airplane's flight today, from its trace: {"hex", "faa" (its FAA
    registration, vfr.registry.lookup; None for one registered abroad or
    while the registry is not yet read), "registration", "type",
    "description", "operator", "year", "departed" ({"ident",
    "name", "at"} -- the field it took off from, where its trace shows it
    on the ground at one, else None), "trail" ([{"t", "lat", "lon",
    "alt_ft"}], this flight's track from its takeoff or the start of its
    leg, at most TRAIL_POINTS)}."""
    hex_id = hex_id.lower()
    # Its card open: followed from now on, its flights recorded from the
    # FAA's radar card open or not (heard_elsewhere).
    follow(hex_id)
    trace = _trace(hex_id) or {}
    # A point is [seconds, lat, lon, altitude, ground speed, track, flags,
    # ...]; one too short to hold them is not used.
    points = [p for p in trace.get("trace") or [] if isinstance(p, list) and len(p) > 6]
    base = _number(trace.get("timestamp")) or 0.0
    # This flight: from its last time on the ground before its last point
    # in the air, or where readsb started its leg, whichever is later. An
    # airplane that has landed and is parked is given the flight it just
    # flew, to its landing, not the parked tail.
    last_air = max((i for i, p in enumerate(points) if p[3] != "ground"), default=-1)
    start = 0
    for i, point in enumerate(points[:last_air + 1]):
        if point[3] == "ground" or (isinstance(point[6], int) and point[6] & _NEW_LEG):
            start = i
    leg = points[start:last_air + 2] if last_air >= 0 else []
    departed = None
    if leg and leg[0][3] == "ground":
        nearest = airports.nearest(leg[0][1], leg[0][2], limit=1)
        if nearest and nearest[0]["distance_nm"] <= DEPARTED_WITHIN_NM:
            # When it left the ground: the first point in the air after it.
            off = next(p for p in leg if p[3] != "ground")
            departed = {"ident": nearest[0]["ident"], "name": nearest[0].get("name"), "at": round(base + off[0])}
    step = max(1, math.ceil(len(leg) / TRAIL_POINTS))
    kept = leg[::step] + ([leg[-1]] if leg and (len(leg) - 1) % step else [])
    trail = [
        {"t": round(base + p[0], 1), "lat": round(p[1], 5), "lon": round(p[2], 5), "alt_ft": _altitude_ft(p)}
        for p in kept
    ]
    if not trail:
        # No trace to be had (adsb.lol's globe turns the planner away, or no
        # feeder heard it): its card open, it is watched -- asked for and its
        # positions recorded -- and its trail the track recorded so far, the
        # field it left where that track starts low over one.
        with _LOCK:
            _WATCHED[hex_id] = _clock()
        _watch(hex_id)
        recorded = _recorded(hex_id)
        rstep = max(1, math.ceil(len(recorded) / TRAIL_POINTS))
        trail = [{"t": p["t"], "lat": p["lat"], "lon": p["lon"], "alt_ft": p["alt_ft"]} for p in recorded[::rstep]]
        if recorded and departed is None:
            departed = _left_from(recorded[0])
    return {
        "hex": hex_id,
        # The FAA's record of a US airplane, by its address or its
        # N-number (vfr.registry); None for one registered abroad.
        "faa": registry.lookup(hex_id=hex_id, n_number=trace.get("r")),
        "registration": trace.get("r") or None,
        "type": trace.get("t") or None,
        "description": trace.get("desc") or None,
        "operator": trace.get("ownOp") or None,
        "year": trace.get("year") or None,
        "departed": departed,
        "trail": trail,
    }


# --- The route a flight number flies ---

#: Virtual Radar Server's route database (its standing data, CC0), as
#: adsb.lol serves it: the airports a scheduled flight number flies
#: between, by its callsign, one file a callsign.
ROUTE_URL = "https://vrs-standing-data.adsb.lol/routes/{prefix}/{callsign}.json"
#: A flight number's route is read again after this long, s: it changes
#: with the airline's schedule, not by the minute.
ROUTE_TTL_S = 6 * 3600
#: An airplane further than this off every leg of its flight number's
#: route, nm, or this far beyond a leg's ends, is not flying that route
#: today (a callsign reused, a diversion, the database out of date).
OFF_ROUTE_NM = 100.0
_ROUTES: TTLCache = TTLCache(maxsize=1024, ttl=ROUTE_TTL_S)
_CALLSIGN = re.compile(r"^[A-Z]{3}[0-9][0-9A-Z]{0,4}$")


def _route_airports(callsign: str) -> list[dict] | None:
    """The airports a flight number's route joins, in order; None where the
    database has none (a private airplane's callsign, an unknown flight).
    Only an answer or a 404 is kept: a refusal is asked again next time."""
    with _LOCK:
        if callsign in _ROUTES:
            return _ROUTES[callsign]
    try:
        resp = requests.get(ROUTE_URL.format(prefix=callsign[:2], callsign=callsign), headers=HEADERS, timeout=TIMEOUT_S)
        if resp.status_code == 404:
            found = None
        else:
            resp.raise_for_status()
            found = [
                {"ident": a.get("icao") or a.get("iata"), "name": a.get("name"), "location": a.get("location"),
                 "lat": _number(a.get("lat")), "lon": _number(a.get("lon"))}
                for a in resp.json().get("_airports") or [] if isinstance(a, dict)
            ]
            found = [a for a in found if a["ident"] and a["lat"] is not None and a["lon"] is not None] or None
    except (requests.RequestException, ValueError):
        return None
    with _LOCK:
        _ROUTES[callsign] = found
    return found


def route(callsign: str, lat: float | None = None, lon: float | None = None) -> dict | None:
    """The route a flight number is scheduled to fly: {"airports" ([{"ident",
    "name", "location"}], in order), "plausible" (whether the airplane at
    lat/lon is on or near it, None where no position is given)}, from the
    route database; None for a callsign that is not an airline's flight
    number (an N-number) or one it does not know. Not the flight plan
    filed for today's flight, which the FAA does not publish openly."""
    callsign = re.sub(r"\s+", "", callsign or "").upper()
    if not _CALLSIGN.fullmatch(callsign):
        return None
    stops = _route_airports(callsign)
    if not stops or len(stops) < 2:
        return None
    plausible = None
    if lat is not None and lon is not None:
        plausible = False
        for a, b in zip(stops, stops[1:]):
            start, end = (a["lat"], a["lon"]), (b["lat"], b["lon"])
            cross, along = geo.track_distances_nm(lat, lon, start, end)
            length = geo.distance_nm(*start, *end)
            if abs(cross) <= OFF_ROUTE_NM and -OFF_ROUTE_NM <= along <= length + OFF_ROUTE_NM:
                plausible = True
                break
    return {"airports": [{k: a[k] for k in ("ident", "name", "location")} for a in stops], "plausible": plausible}


# --- Past flights: an airplane's flights of the last days, and one replayed ---

#: A day's trace of an airplane, by its ICAO address, from adsb.lol's
#: archive of the globe's traces (the same open data, kept a day at a
#: time, UTC days): gzip JSON, as today's.
HISTORY_URL = GLOBE + "/globe_history/{day:%Y/%m/%d}/traces/{last2}/trace_full_{hex}.json"
#: How many of an airplane's flights are listed at a time, the newest
#: found, at the owner's ask ("make it last 10 flights you were able to
#: find"), where it was the last seven days' whatever their number.
HISTORY_FLIGHTS = 10
#: How far back adsb.lol's archive of days goes, days: on 2026-10-13 the
#: day of 2026-09-01 was there and 2026-08-20's was not (a 404 for an
#: airliner that flies daily), so about six weeks. Days are read back from
#: the newest until the flights are found or the archive runs out.
ARCHIVE_DAYS = 42
#: Days read side by side, at most, as the search goes back: a day's read
#: took 1 to 20 s on 2026-10-13, a 404 among the slowest.
HISTORY_BATCH = 7
#: Days read for one ask at most, today's among them: past them the list
#: says there may be more, and the next ask goes on from there, so an
#: airplane that seldom flies is not a minute's wait.
HISTORY_DAYS_PER_ASK = 14
#: A past day's trace is kept this long, s: it no longer changes.
HISTORY_TTL_S = 12 * 3600
#: No report for this long, s, ends a flight: the airplane landed out of
#: the receivers' hearing (a small airplane low over a field often is)
#: and went again later.
LEG_GAP_S = 10 * 60
#: A flight's first or last report this near a landing field, nm, and
#: this little above its elevation, ft, is a takeoff from it or a landing
#: at it: low near a field where the receivers stopped or started hearing it.
FIELD_NEAR_NM = 5.0
FIELD_ABOVE_FT = 2000.0
#: Further out and higher, a report still is, where the airplane was
#: coming down to it (its last) or going up from it (its first): receivers
#: lose a small airplane well before it lands. N654FL's LWM to LCI on
#: 2026-10-11 was last heard 3,000 ft over Laconia, coming down.
FIELD_APPROACH_NM = 10.0
FIELD_APPROACH_FT = 3500.0
#: Coming down or going up: this fast, ft/min, or headed this near
#: straight at it or away from it, degrees (a light airplane levels off
#: for its pattern).
FIELD_APPROACH_FPM = 200.0
FIELD_APPROACH_DEG = 30.0
#: A flight shorter than this, s, is a blip, not a flight.
LEG_MIN_S = 120
#: At most this many points of a past flight are sent: a track log and a
#: replay's worth, a fraction of a long flight's seconds.
PAST_POINTS = 1500
#: How long a day's trace may take, s: a busy airplane's is a few hundred kB.
HISTORY_TIMEOUT_S = 15.0
_DAYS: TTLCache = TTLCache(maxsize=256, ttl=HISTORY_TTL_S)


def _merged(traces: list) -> list[dict]:
    """The points of several traces in time order, each once: the recent
    trace (`_trace`, the last day or so, not a UTC day) runs over the
    archive's last day."""
    seen, out = set(), []
    read = [t for t in traces if isinstance(t, dict)]
    for point in sorted((p for trace in read for p in _points(trace)), key=lambda p: p["t"]):
        if point["t"] not in seen:
            seen.add(point["t"])
            out.append(point)
    return out


class _Unread:
    """A day's trace that could not be had now: refused or not answered."""


#: What `_day_trace` gives for a day it could not read, as against None,
#: a day the airplane has no trace.
UNREAD = _Unread()


def _day_trace(hex_id: str, day) -> dict | None | _Unread:
    """An airplane's trace on a past UTC day (a datetime.date), kept; None
    where it has none that day; UNREAD where it could not be had now -- a
    refusal or a timeout, which is not kept and is asked again next time."""
    key = (hex_id, day.isoformat())
    with _LOCK:
        if key in _DAYS:
            return _DAYS[key]
    try:
        resp = requests.get(HISTORY_URL.format(day=day, last2=hex_id[-2:], hex=hex_id), headers=HEADERS, timeout=HISTORY_TIMEOUT_S)
        if resp.status_code == 404:
            trace = None
        else:
            resp.raise_for_status()
            trace = resp.json()
            if not isinstance(trace, dict):
                trace = None
    except (requests.RequestException, ValueError):
        return UNREAD
    with _LOCK:
        _DAYS[key] = trace
    return trace


def _points(trace: dict | None) -> list[dict]:
    """A trace's points as {"t" (s since 1970), "lat", "lon", "alt_ft" (None
    on the ground), "gs_kt", "track_deg", "vrate_fpm", "new_leg"}."""
    if not trace:
        return []
    base = _number(trace.get("timestamp")) or 0.0
    out = []
    for p in trace.get("trace") or []:
        if not isinstance(p, list) or len(p) < 7 or _number(p[1]) is None or _number(p[2]) is None:
            continue
        out.append({
            "t": round(base + float(p[0]), 1), "lat": round(float(p[1]), 5), "lon": round(float(p[2]), 5),
            "alt_ft": _altitude_ft(p), "gs_kt": _number(p[4]), "track_deg": _number(p[5]),
            "vrate_fpm": _number(p[7]) if len(p) > 7 else None,
            "new_leg": isinstance(p[6], int) and bool(p[6] & _NEW_LEG),
        })
    return out


def _field_at(point: dict, landing: bool) -> dict | None:
    """The landing field a flight's first or last (`landing`) report is at:
    one within FIELD_NEAR_NM, the report on the ground or within
    FIELD_ABOVE_FT of its elevation; or within FIELD_APPROACH_NM and
    FIELD_APPROACH_FT, coming down to it or going up from it. None where it
    was heard first or last on its way somewhere."""
    rate = point.get("vrate_fpm") or 0.0
    sloping = rate <= -FIELD_APPROACH_FPM if landing else rate >= FIELD_APPROACH_FPM
    track = point.get("track_deg")
    # The US's fields, then -- none of them near -- the rest of the
    # world's, so a flight abroad is named by its own airports (the owner
    # saw "— → —" for a Vueling A320 on 2026-10-12).
    near = airports.nearest(point["lat"], point["lon"], limit=3)
    if not near or near[0]["distance_nm"] > FIELD_APPROACH_NM:
        near = airports.nearest_abroad(point["lat"], point["lon"], limit=3)
    for field in near:
        if field["distance_nm"] > FIELD_APPROACH_NM:
            break
        above = None if point["alt_ft"] is None else point["alt_ft"] - (field.get("elevation_ft") or 0.0)
        close = field["distance_nm"] <= FIELD_NEAR_NM and (above is None or above <= FIELD_ABOVE_FT)
        # `bearing_deg` is from the report to the field: a landing heads along it, a takeoff away.
        toward = (field["bearing_deg"] if landing else field["bearing_deg"] + 180) % 360
        headed = track is not None and abs((track - toward + 180) % 360 - 180) <= FIELD_APPROACH_DEG
        if close or ((sloping or headed) and above is not None and above <= FIELD_APPROACH_FT):
            return {"ident": field["ident"], "name": field.get("name"), "city": field.get("municipality"),
                    "region": field.get("region")}
    return None


def _legs(points: list[dict]) -> list[list[dict]]:
    """A run of points cut into flights: at readsb's own new leg, at a
    stretch on the ground, and at a silence of LEG_GAP_S; the points on the
    ground at either end kept, as the takeoff's and the landing's place."""
    legs, leg = [], []
    for point in points:
        gap = leg and point["t"] - leg[-1]["t"] > LEG_GAP_S
        landed = leg and point["alt_ft"] is None and any(p["alt_ft"] is not None for p in leg)
        if leg and (point["new_leg"] or gap):
            legs.append(leg)
            leg = []
        leg.append(point)
        if landed:
            legs.append(leg)
            leg = [point]
    if leg:
        legs.append(leg)
    flown = []
    for leg in legs:
        air = [p for p in leg if p["alt_ft"] is not None]
        if len(air) >= 2 and air[-1]["t"] - air[0]["t"] >= LEG_MIN_S:
            flown.append(leg)
    return flown


def _summaries(points: list[dict]) -> list[dict]:
    """A merged trace's flights, oldest first, as `history` lists them."""
    now = time.time()
    flights = []
    for leg in _legs(points):
        air = [p for p in leg if p["alt_ft"] is not None]
        start, end = _field_at(leg[0], landing=False), _field_at(leg[-1], landing=True)
        in_air = now - leg[-1]["t"] < 5 * 60 and leg[-1]["alt_ft"] is not None
        flights.append({
            "id": int(air[0]["t"]), "origin": start, "destination": None if in_air else end,
            "off": air[0]["t"], "on": air[-1]["t"], "landed": not in_air and end is not None, "in_air": in_air,
            "max_alt_ft": max(p["alt_ft"] for p in air),
        })
    return flights


def _recorded_flights(hex_id: str) -> list[dict]:
    """The flights of an airplane's recorded track, as `_summaries` gives
    them, each one's start named only where it starts just off a field
    (`_left_from`): a track recorded from when a card was opened mostly
    starts on the way somewhere."""
    out = []
    for leg in _legs(_recorded(hex_id)):
        for flight in _summaries(leg):
            left = _left_from(leg[0])
            flight["origin"] = left and {"ident": left["ident"], "name": left.get("name"), "city": None, "region": None}
            out.append(flight)
    return out


def history(hex_id: str, limit: int = HISTORY_FLIGHTS, until=None, before: float | None = None, today=None) -> dict:
    """An airplane's last `limit` flights found, newest first, as FlightAware
    lists them: {"hex", "registration", "type", "flights": [{"id" (its
    takeoff's time, s), "origin", "destination" (each {"ident", "name",
    "city", "region"}, None where it was first or last heard on its way),
    "off", "on" (s, when first and last heard in the air), "landed"
    (whether its end is at a field), "in_air" (heard in the last few
    minutes, still flying), "max_alt_ft"}], "next_until" (the UTC day, ISO,
    to ask from with `before` for the flights before the last given; None
    where the archive has none older), "unread_days"}. From `until` (a UTC
    date, today where None) back, only those that took off before `before`
    (s) where it is given -- a few
    days at a time side by side, until the flights are found or the
    archive's ARCHIVE_DAYS run out: today's from the recent trace, the
    days before from the archive. A day that cannot be had is left out and
    counted, not an error."""
    import datetime as dt

    hex_id = hex_id.lower()
    today = today or dt.datetime.now(dt.timezone.utc).date()
    if until is None and before is not None:
        until = dt.datetime.fromtimestamp(before, dt.timezone.utc).date()
    until = min(until or today, today)
    oldest = today - dt.timedelta(days=ARCHIVE_DAYS - 1)
    stop = max(oldest, until - dt.timedelta(days=HISTORY_DAYS_PER_ASK - 1))
    traces: list = [_trace(hex_id)] if until == today else []
    day = until - dt.timedelta(days=1) if until == today else until
    unread = 0
    flights: list[dict] = []
    def found() -> list[dict]:
        listed = _summaries(_merged(traces))
        return [f for f in listed if f["id"] < before] if before is not None else listed
    with ThreadPoolExecutor(max_workers=HISTORY_BATCH) as pool:
        while True:
            # The flights of the days read so far, the oldest day's first
            # flight possibly begun the day before: one more is wanted than
            # is shown, so the last shown is whole.
            flights = found()
            if len(flights) > limit or day < stop:
                break
            batch = [day - dt.timedelta(days=n) for n in range(HISTORY_BATCH) if day - dt.timedelta(days=n) >= stop]
            past = list(pool.map(lambda d: _day_trace(hex_id, d), batch))
            unread += sum(1 for t in past if t is UNREAD)
            traces += past
            day = batch[-1] - dt.timedelta(days=1)
    named = next((t for t in traces if isinstance(t, dict)), {})
    # And the flights watched here (`_watch`), where the archive has none
    # at that time: adsb.lol's history closed to the planner behind a
    # browser check since 2026-10-19, and some airplanes (N3429J, a UAT
    # airplane rebroadcast by ADS-R) no adsb.lol feeder hears.
    recorded = [f for f in _recorded_flights(hex_id) if before is None or f["id"] < before]
    taken = [(f["off"], f["on"]) for f in flights]
    flights = sorted(flights + [f for f in recorded if not any(off <= f["on"] and f["off"] <= on for off, on in taken)],
                     key=lambda f: f["id"])
    flights.reverse()
    shown = flights[:limit]
    # Where the next ask starts: the last shown's day where more were found
    # than shown (those that took off before it, by `before`), else the
    # first day not read yet, while the archive has it.
    if len(flights) > limit:
        next_until = dt.datetime.fromtimestamp(shown[-1]["id"], dt.timezone.utc).date().isoformat()
    else:
        next_until = day.isoformat() if day >= oldest else None
    return {"hex": hex_id, "registration": named.get("r") or None, "type": named.get("t") or None, "flights": shown,
            "next_until": next_until, "unread_days": unread}


def past_flight(hex_id: str, flight_id: int, today=None) -> dict | None:
    """One of `history`'s flights, its points for a track log and a replay:
    {"id", "points" ([{"t", "lat", "lon", "alt_ft", "gs_kt", "track_deg",
    "vrate_fpm"}], at most PAST_POINTS, evenly)}; None where it is not one
    of the archive's days' flights."""
    import datetime as dt

    hex_id = hex_id.lower()
    today = today or dt.datetime.now(dt.timezone.utc).date()
    day = dt.datetime.fromtimestamp(flight_id, dt.timezone.utc).date()
    back = (today - day).days
    if back < 0 or back >= ARCHIVE_DAYS:
        return None
    # Its day and the next from the archive, which a flight across
    # midnight UTC runs into, and the recent trace for today's.
    days = [d for d in (day, day + dt.timedelta(days=1)) if d < today]
    traces = [_trace(hex_id)] + [_day_trace(hex_id, d) for d in days]
    points = _merged(traces)
    for leg in _legs(points):
        air = [p for p in leg if p["alt_ft"] is not None]
        if int(air[0]["t"]) != flight_id:
            continue
        step = max(1, math.ceil(len(leg) / PAST_POINTS))
        kept = leg[::step] + ([leg[-1]] if (len(leg) - 1) % step else [])
        return {"id": flight_id, "points": [{k: p[k] for k in ("t", "lat", "lon", "alt_ft", "gs_kt", "track_deg", "vrate_fpm")}
                                           for p in kept]}
    # One watched here (`history` lists those too).
    for leg in _legs(_recorded(hex_id)):
        if int(leg[0]["t"]) == flight_id:
            step = max(1, math.ceil(len(leg) / PAST_POINTS))
            kept = leg[::step] + ([leg[-1]] if (len(leg) - 1) % step else [])
            return {"id": flight_id, "points": [{k: p.get(k) for k in ("t", "lat", "lon", "alt_ft", "gs_kt", "track_deg", "vrate_fpm")}
                                               for p in kept]}
    return None


# --- An airplane's state now, for the alerts a pilot sets on it ---

#: An airplane last heard in the air, low near a field or coming down to
#: it, is taken to have landed there once it has gone unheard this long,
#: s: a small airplane in the pattern often drops out of the receivers'
#: hearing for half a minute on its downwind and comes back. Where its
#: last report is on the ground, it has landed at once.
LANDED_UNHEARD_S = 120


#: A recorded track that starts within this of a field, nm, and this far
#: over it, ft, starts at its takeoff from it: about the pattern's crosswind
#: turn, 500 ft up (AC 90-66C's departure leg).
LEFT_NEAR_NM = 2.0
LEFT_ABOVE_FT = 500.0


def _left_from(first: dict) -> dict | None:
    """The field a recorded track starts at, where it starts there: within
    LEFT_NEAR_NM of it and LEFT_ABOVE_FT over it, just off the ground. A
    track recorded from when a card was opened mostly starts in the air
    on the way somewhere -- N3429J's, opened over Burlington at 2,000 ft,
    was said to have left KBUU where it had left C81 -- and its departure
    is then not known."""
    if first.get("alt_ft") is None:
        return None
    for field in airports.nearest(first["lat"], first["lon"], limit=1):
        above = first["alt_ft"] - (field.get("elevation_ft") or 0.0)
        if field["distance_nm"] <= LEFT_NEAR_NM and above <= LEFT_ABOVE_FT:
            return {"ident": field["ident"], "name": field.get("name"), "at": round(first["t"])}
    return None


def _recorded_status(hex_id: str, recorded: list[dict]) -> dict:
    """`status` from a watched airplane's recorded track: in the air while
    heard within STALE_S, the field its track starts at as where it left;
    landed where unheard for LANDED_UNHEARD_S last low over a field."""
    last = recorded[-1]
    heard = round(max(0.0, _wall() - last["t"]), 1)
    state = {"hex": hex_id, "heard_s": heard, "airborne": False, "aircraft": None, "departed": None, "arrived": None}
    if heard <= STALE_S:
        left = _left_from(recorded[0])
        departed = left and {k: v for k, v in left.items() if k != "at"} | {"city": None, "region": None}
        state.update(airborne=True, aircraft={**last["plane"], "seen_s": heard}, departed=departed)
    elif heard >= LANDED_UNHEARD_S:
        field = _field_at(last, landing=True)
        if field is not None:
            state["arrived"] = {**field, "at": last["t"]}
    return state


def status(hex_id: str) -> dict:
    """An airplane's state now, for the alerts a pilot sets on it (the
    card's Alert): {"hex", "heard_s" (s since its last report, None with
    none), "airborne" (that report in the air and within STALE_S, as the
    map would draw it), "aircraft" (it, as the map draws it, while
    airborne), "departed" (the field this flight took off from, where its
    recent trace shows it on the ground at one or going up from one), and
    "arrived" (where it has landed, while it is not airborne: on the
    ground at a field, or last heard low near one or coming down to it,
    `_field_at`, and unheard for LANDED_UNHEARD_S since; with "at", when
    it was last heard)}. From its recent trace, seconds old; where it has
    none, from its trace of today. TrafficUnavailable where the recent
    trace cannot be read now."""
    hex_id = hex_id.lower()
    trace = _recent_trace(hex_id)
    if trace is UNREAD or (trace is None and _recorded(hex_id)):
        # No recent trace to read: the track recorded while its card was
        # open, where there is one (`_watch`), else unavailable.
        recorded = _recorded(hex_id)
        if not recorded:
            raise TrafficUnavailable("adsb.lol's recent trace could not be read")
        return _recorded_status(hex_id, recorded)
    if trace is None:
        trace = _trace(hex_id)
    raw = [p for p in (trace or {}).get("trace") or []
           if isinstance(p, list) and len(p) > 6 and _number(p[1]) is not None and _number(p[2]) is not None]
    points = _points(trace) if raw else []
    state = {"hex": hex_id, "heard_s": None, "airborne": False, "aircraft": None, "departed": None, "arrived": None}
    if not points:
        return state
    last = points[-1]
    ground = [p[3] == "ground" for p in raw]
    state["heard_s"] = round(max(0.0, _wall() - last["t"]), 1)
    aircraft = _last_heard(trace) if not ground[-1] else None
    if aircraft is not None:
        # The run in the air it is on: back to the stretch on the ground
        # it took off from, readsb's own new leg, or a silence of LEG_GAP_S.
        start = len(points) - 1
        while (start > 0 and not ground[start - 1] and not points[start]["new_leg"]
               and points[start]["t"] - points[start - 1]["t"] <= LEG_GAP_S):
            start -= 1
        if start > 0 and ground[start - 1]:
            on = points[start - 1]
            near = airports.nearest(on["lat"], on["lon"], limit=1)
            if near and near[0]["distance_nm"] <= DEPARTED_WITHIN_NM:
                state["departed"] = {"ident": near[0]["ident"], "name": near[0].get("name"),
                                     "city": near[0].get("municipality"), "region": near[0].get("region")}
        else:
            state["departed"] = _field_at(points[start], landing=False)
        state.update(airborne=True, aircraft=aircraft)
    elif ground[-1] or state["heard_s"] >= LANDED_UNHEARD_S:
        field = _field_at(last, landing=True)
        if field is not None:
            state["arrived"] = {**field, "at": last["t"]}
    return state


# --- Where an airplane is based: the field its own flights keep to ---

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
