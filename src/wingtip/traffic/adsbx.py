"""ADS-B Exchange, the fallback where adsb.lol turns us away, through RapidAPI, within its
month's requests."""
from __future__ import annotations

import json
import math
import time

import requests

from ..config import get_settings
from .common import HEADERS, TIMEOUT_S, TrafficUnavailable, _LOCK, _aircraft, _clock, _wall

#: ADS-B Exchange's API through RapidAPI, the same readsb answer as
#: adsb.lol's (`ac`), asked only where adsb.lol has refused or not
#: answered, at the owner's ask ("a hybrid solution of adsb.lol and adsb
#: exchange community version"): its non-commercial plan, 10,000 requests
#: a month. Off unless ADSBX_RAPIDAPI_KEY is set.
ADSBX_HOST = "adsbexchange-com1.p.rapidapi.com"
ADSBX_URL = "https://adsbexchange-com1.p.rapidapi.com/v2/{path}/"
#: Requests a month at most, short of the plan's 10,000 so a month's end
#: never brings its overage charges.
ADSBX_MONTHLY = get_settings().adsbx_monthly_requests
#: Never two of the map's region requests to it closer together than
#: this, s: 9,000 a month is one every five minutes on average; this
#: keeps a bad hour from spending a week's. A pilot's search is not held
#: to it -- it is asked at once, within the month's budget.
ADSBX_MIN_GAP_S = 30.0
#: Where the month's count is kept, so a restart does not forget it: the
#: project's data folder (wingtip.config), where it went to the planner's
#: working folder from a path of its own, outside the data kept between
#: containers and not ignored by git.
ADSBX_USAGE_FILE = get_settings().adsbx_usage_file
#: Its credit, as the map says it where it draws what it gave.
ADSBX_SOURCE = {"source": "ADS-B Exchange", "license": "ADS-B Exchange terms"}
_ADSBX = {"last": -math.inf}


def _adsbx_spend(search: bool = False) -> bool:
    """One of the month's requests to ADS-B Exchange taken, where there is a
    key, the month has one left and -- for the map's regions, not a pilot's
    search, which is asked at once -- the gap since the last region's is
    kept; the count kept on disk."""
    if not get_settings().adsbx_rapidapi_key:
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
            **HEADERS, "x-rapidapi-key": get_settings().adsbx_rapidapi_key or "", "x-rapidapi-host": ADSBX_HOST})
        _adsbx_counted(resp.headers)
        resp.raise_for_status()
        entries = resp.json().get("ac") or []
    except (requests.RequestException, ValueError) as err:
        raise TrafficUnavailable(f"ADS-B Exchange did not answer: {err}") from err
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
