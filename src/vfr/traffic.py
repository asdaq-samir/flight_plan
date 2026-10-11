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
A pilot's search for one airplane goes ahead of the regions' turns, which
are given their last answer meanwhile, and one already heard about any
region is found at once, with no request at all.
"""
from __future__ import annotations

import math
import re
import threading
import time

import numpy as np
import requests
from cachetools import TTLCache

from . import airports, geo, registry

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
#: When adsb.lol may next be asked for a region (the regions' turns are
#: taken in order from it), when the last request went, when a search's
#: turn is, and until when nothing is asked after a refusal; monotonic.
_STATE = {"next_ask": 0.0, "last_ask": -math.inf, "search_at": -math.inf, "blocked_until": -math.inf}
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


def _region_turn(now: float) -> float:
    """The next region's turn to ask adsb.lol, taken: the first free one,
    a gap clear of a search's. Called with the lock held."""
    slot = max(now, _STATE["next_ask"])
    if abs(_STATE["search_at"] - slot) < MIN_GAP_S:
        slot = _STATE["search_at"] + MIN_GAP_S
    _STATE["next_ask"] = slot + MIN_GAP_S
    return slot


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
    """The airplanes in the air a pilot names: by callsign ("UAL2088"),
    registration ("N174HA") or ICAO address ("a0b7d8"), as `_aircraft`
    gives each. Empty where none is in the air and heard now. One heard
    about a region in the last minute is found there, at once; else
    adsb.lol is asked, in a search's turn, and its answer kept for
    FOUND_TTL_S so the same search again -- a second phone's, a tap back --
    asks nothing."""
    text = re.sub(r"\s+", "", query).upper()
    if not text or not re.fullmatch(r"[~A-Z0-9-]{2,10}", text):
        return []
    with _LOCK:
        heard = _heard(text)
        if heard:
            return heard
        if text in _FOUND:
            return _FOUND[text]
        gate = _FIND_GATES.setdefault(text, threading.Lock())
    # One search for a name at a time: the rest wait and are given its answer.
    with gate:
        with _LOCK:
            if text in _FOUND:
                return _FOUND[text]
        try:
            found = _asked(text)
            # The answer is stored in the same lock section the gate is
            # dropped in, so a search arriving between finds one or the other.
            with _LOCK:
                _FOUND[text] = found
        finally:
            with _LOCK:
                _FIND_GATES.pop(text, None)
        return found


def _asked(text: str) -> list[dict]:
    """adsb.lol's answer to a search: by address, callsign or
    registration, as the text reads, the next way where one finds none."""
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
        "trail": [
            {"t": round(base + p[0], 1), "lat": round(p[1], 5), "lon": round(p[2], 5), "alt_ft": _altitude_ft(p)}
            for p in kept
        ],
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
    Only an answer or a 404 is kept: a refusal is asked again next time,
    and raises TrafficUnavailable so that it is not mistaken for "no route"."""
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
    except (requests.RequestException, ValueError) as err:
        raise TrafficUnavailable("the route database could not be asked") from err
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
