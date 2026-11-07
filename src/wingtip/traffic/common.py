"""What every source of traffic shares: the request's headers and time limit, the clocks and the
lock the whole package keeps, and an airplane read from a readsb answer as the map draws it."""
from __future__ import annotations

import threading
import time

HEADERS = {"User-Agent": "wingtip-maps/0.1 (VFR flight planner; traffic for pilots' situational awareness)"}

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
        # What it is, as its transponder says (DO-260B's emitter category:
        # A1 light, A2 small, A3 large, A4 a B757, A5 heavy, A6 high
        # performance, A7 rotorcraft, B1 glider, B6 unmanned): the
        # Aircraft tab's filter by kind.
        "category": entry.get("category") or None,
    }
