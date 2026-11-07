"""The route a flight number flies."""
from __future__ import annotations

import re

import requests
from cachetools import TTLCache

from .. import geo
from .common import HEADERS, TIMEOUT_S, _LOCK, _number

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
