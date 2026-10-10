"""Traffic near a point, for the map: the airplanes ADS-B receivers on the
ground are hearing there now, from adsb.lol's open data (api.adsb.lol,
`/v2/point/{lat}/{lon}/{radius}`; the data under the Open Database
License 1.0, said on the map where it is drawn).

Seconds old by the time it is drawn, with holes where no receiver hears:
for knowing what is about, not for avoiding it. 14 CFR 91.113(b) asks
the pilot to see and avoid whatever the screen shows.

One answer is shared for five seconds by everyone asking about the same
place (to a hundredth of a degree, the radius to ten miles), so many
phones over one field cost adsb.lol one request, whose API asks to be
spared (its rate limits follow its load).
"""
from __future__ import annotations

import threading

import requests
from cachetools import TTLCache

URL = "https://api.adsb.lol/v2/point/{lat}/{lon}/{radius}"
HEADERS = {"User-Agent": "wingtip-maps/0.1 (VFR flight planner; traffic for pilots' situational awareness)"}
#: How long one answer serves: about an ADS-B receiver's own refresh.
TTL_S = 5
#: The radius asked for is kept between these, nm: adsb.lol's own most is 250.
MIN_RADIUS_NM, MAX_RADIUS_NM = 5, 100
#: A position older than this is left out: the airplane is somewhere else.
STALE_S = 30.0

_CACHE: TTLCache = TTLCache(maxsize=512, ttl=TTL_S)
_LOCK = threading.Lock()


class TrafficUnavailable(RuntimeError):
    """adsb.lol did not answer."""


def _number(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _aircraft(entry: dict) -> dict | None:
    """One airplane as the map draws it; None on the ground, without a
    position, or with one too old. Its height the GNSS's where it sends
    one (`alt_geom`, as the phone's own is), else its pressure altitude."""
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
    }


def near(lat: float, lon: float, radius_nm: float) -> list[dict]:
    """The airplanes in the air within `radius_nm` of a point, as
    `_aircraft` gives each. Raises TrafficUnavailable where adsb.lol does
    not answer."""
    radius = int(min(MAX_RADIUS_NM, max(MIN_RADIUS_NM, round(radius_nm / 10) * 10)))
    key = (round(lat, 2), round(lon, 2), radius)
    with _LOCK:
        held = _CACHE.get(key)
    if held is not None:
        return held
    try:
        resp = requests.get(URL.format(lat=key[0], lon=key[1], radius=radius), headers=HEADERS, timeout=8)
        resp.raise_for_status()
        entries = resp.json().get("ac") or []
    except (requests.RequestException, ValueError) as err:
        raise TrafficUnavailable(f"adsb.lol did not answer: {err}") from err
    found = [a for a in (_aircraft(e) for e in entries if isinstance(e, dict)) if a is not None]
    with _LOCK:
        _CACHE[key] = found
    return found
