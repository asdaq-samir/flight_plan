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
nm whose middle is in it -- at most once in five seconds, never two
requests within five seconds of each other whatever the region, and
waits fifteen after being turned away; between times every phone is
given the region's last answer, cut to its own view, with how old it is,
so the map can carry each airplane on from where it was (TrafficLayer).
"""
from __future__ import annotations

import math
import re
import threading
import time

import numpy as np
import requests
from cachetools import TTLCache

from . import airports

URL = "https://api.adsb.lol/v2/point/{lat:.2f}/{lon:.2f}/{radius}"
HEADERS = {"User-Agent": "wingtip-maps/0.1 (VFR flight planner; traffic for pilots' situational awareness)"}
#: A region's side, degrees, and how far round its middle it is asked
#: for: a view's middle is at most a quarter degree from the region's
#: (15 nm north and south, less east and west), so 80 nm holds a view of 60.
REGION_DEG = 0.5
REGION_RADIUS_NM = 80
#: The furthest a view is asked about, nm.
MAX_RADIUS_NM = 60
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

_LOCK = threading.Lock()
#: Each region's last answer: (when it came, monotonic, airplanes).
_REGIONS: dict = {}
#: When adsb.lol may next be asked, monotonic.
_STATE = {"next_ask": 0.0}
#: Regions being asked for now; the rest of a region's askers wait on this.
_FLIGHTS: dict = {}


class TrafficUnavailable(RuntimeError):
    """adsb.lol has not answered for a while."""


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
    }


def _region(lat: float, lon: float) -> tuple[float, float]:
    return round(lat / REGION_DEG) * REGION_DEG, round(lon / REGION_DEG) * REGION_DEG


def _ask(region: tuple[float, float]) -> list[dict]:
    """adsb.lol's airplanes round a region's middle. Raises
    TrafficUnavailable where it turns the request away or does not answer."""
    try:
        resp = requests.get(URL.format(lat=region[0], lon=region[1], radius=REGION_RADIUS_NM), headers=HEADERS, timeout=TIMEOUT_S)
        resp.raise_for_status()
        entries = resp.json().get("ac") or []
    except (requests.RequestException, ValueError) as err:
        raise TrafficUnavailable(f"adsb.lol did not answer: {err}") from err
    return [a for a in (_aircraft(e) for e in entries if isinstance(e, dict)) if a is not None]


def _region_answer(region: tuple[float, float]) -> tuple[float, list[dict]]:
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
                slot = max(now, _STATE["next_ask"])
                _STATE["next_ask"] = slot + MIN_GAP_S
                flight = _FLIGHTS[region] = threading.Event()
                break
        # Another phone is asking for this region: wait for it, then look again.
        flight.wait(TIMEOUT_S + 2 * MIN_GAP_S + 1)
    try:
        if slot > now:
            _sleep(slot - now)
        asked = _clock()
        try:
            answer = (asked, _ask(region))
        except TrafficUnavailable:
            answer = None
        with _LOCK:
            if answer is None:
                _STATE["next_ask"] = asked + BACKOFF_S
            else:
                _REGIONS[region] = answer
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


def near(lat: float, lon: float, radius_nm: float) -> dict:
    """The airplanes in the air within `radius_nm` (at most 60) of a point,
    as `_aircraft` gives each, and `age_s`, how many seconds before now
    they were where they are given (each `seen_s` more): {"aircraft",
    "age_s"}. Raises TrafficUnavailable where adsb.lol has not answered
    for a minute."""
    at, planes = _region_answer(_region(lat, lon))
    radius = min(MAX_RADIUS_NM, radius_nm)
    if planes:
        lats = np.array([p["lat"] for p in planes])
        lons = np.array([p["lon"] for p in planes])
        # Flat-earth miles: within 60 the error is a fraction of one.
        nm = np.hypot((lats - lat) * _NM_PER_DEG, (lons - lon) * _NM_PER_DEG * np.cos(np.radians(lat)))
        planes = [p for p, d in zip(planes, nm) if d <= radius]
    return {"aircraft": planes, "age_s": round(_clock() - at, 1)}


# --- One airplane: found by what a pilot knows it by, and its flight ---

FIND_URL = "https://api.adsb.lol/v2/{by}/{value}"
#: The day's track of an airplane, by its ICAO address: readsb's trace,
#: on the same open data's globe (adsb.lol's tar1090), gzip JSON.
TRACE_URL = "https://globe.adsb.lol/data/traces/{last2}/trace_full_{hex}.json"
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


def _paced(url: str) -> dict:
    """adsb.lol's answer to one request, taken in its turn between the
    region requests (never two within MIN_GAP_S, as `_region_answer`
    keeps them): waited for up to two gaps, else TrafficUnavailable."""
    with _LOCK:
        now = _clock()
        slot = max(now, _STATE["next_ask"])
        if slot - now > 2 * MIN_GAP_S:
            raise TrafficUnavailable("adsb.lol has not answered for a while")
        _STATE["next_ask"] = slot + MIN_GAP_S
    if slot > now:
        _sleep(slot - now)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT_S)
        resp.raise_for_status()
        return resp.json()
    except (requests.RequestException, ValueError) as err:
        with _LOCK:
            _STATE["next_ask"] = _clock() + BACKOFF_S
        raise TrafficUnavailable(f"adsb.lol did not answer: {err}") from err


def find(query: str) -> list[dict]:
    """The airplanes in the air a pilot names: by callsign ("UAL2088"),
    registration ("N174HA") or ICAO address ("a0b7d8"), as `_aircraft`
    gives each. Empty where none is in the air and heard now."""
    text = re.sub(r"\s+", "", query).upper()
    if not text or not re.fullmatch(r"[~A-Z0-9-]{2,10}", text):
        return []
    if _HEX.fullmatch(text.lower()):
        tries = [("hex", text.lower()), ("callsign", text)]
    elif _N_NUMBER.fullmatch(text) or "-" in text:
        tries = [("reg", text)]
    else:
        tries = [("callsign", text), ("reg", text)]
    for by, value in tries:
        found = [a for a in (_aircraft(e) for e in _paced(FIND_URL.format(by=by, value=value)).get("ac") or []
                             if isinstance(e, dict)) if a is not None]
        if found:
            return found
    return []


def _trace(hex_id: str) -> dict | None:
    """An airplane's trace today, read once a minute; None where there is
    none or it cannot be had (the flight is then drawn without its past)."""
    with _LOCK:
        if hex_id in _TRACES:
            return _TRACES[hex_id]
    try:
        resp = requests.get(TRACE_URL.format(last2=hex_id[-2:], hex=hex_id), headers=HEADERS, timeout=TIMEOUT_S)
        trace = resp.json() if resp.status_code == 200 else None
    except (requests.RequestException, ValueError):
        trace = None
    with _LOCK:
        _TRACES[hex_id] = trace
    return trace


def _altitude_ft(point: list) -> float | None:
    """A trace point's height: its GNSS height where it has one, as the
    map's live reports are, else its pressure altitude; None on the ground."""
    if point[3] == "ground":
        return None
    geometric = point[10] if len(point) > 10 else None
    return _number(geometric) if geometric is not None else _number(point[3])


def flight(hex_id: str) -> dict:
    """An airplane's flight today, from its trace: {"hex", "registration",
    "type", "description", "operator", "year", "departed" ({"ident",
    "name", "at"} -- the field it took off from, where its trace shows it
    on the ground at one, else None), "trail" ([{"t", "lat", "lon",
    "alt_ft"}], this flight's track from its takeoff or the start of its
    leg, at most TRAIL_POINTS)}."""
    hex_id = hex_id.lower()
    trace = _trace(hex_id) or {}
    points = trace.get("trace") or []
    base = _number(trace.get("timestamp")) or 0.0
    # This flight: from its last time on the ground, or where readsb
    # started its leg, whichever is later.
    start = 0
    for i, point in enumerate(points):
        if point[3] == "ground" or (isinstance(point[6], int) and point[6] & _NEW_LEG):
            start = i
    leg = points[start:]
    departed = None
    if leg and leg[0][3] == "ground":
        nearest = airports.nearest(leg[0][1], leg[0][2], limit=1)
        if nearest and nearest[0]["distance_nm"] <= DEPARTED_WITHIN_NM:
            # When it left the ground: the first point in the air after it.
            off = next((p for p in leg if p[3] != "ground"), leg[0])
            departed = {"ident": nearest[0]["ident"], "name": nearest[0].get("name"), "at": round(base + off[0])}
    step = max(1, math.ceil(len(leg) / TRAIL_POINTS))
    kept = leg[::step] + ([leg[-1]] if leg and (len(leg) - 1) % step else [])
    return {
        "hex": hex_id,
        "registration": trace.get("r") or None,
        "type": trace.get("t") or None,
        "description": trace.get("desc") or None,
        "operator": trace.get("ownOp") or None,
        "year": trace.get("year") or None,
        "departed": departed,
        "trail": [
            {"t": round(base + p[0], 1), "lat": round(p[1], 5), "lon": round(p[2], 5), "alt_ft": _altitude_ft(p)}
            for p in kept
        ],
    }
