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

The package is that module split by source, a module each:

- common: the headers, time limit, clocks and lock every part shares, and
  an airplane read from a readsb answer (`_aircraft`).
- adsb_lol: adsb.lol's API by region and by search, and its globe's traces.
- adsbx: ADS-B Exchange, the fallback, within its month's requests.
- adsbfi: adsb.fi, asked for a watched airplane.
- radar: the FAA's terminal radar's tracks through SWIM (app.swim).
- recorded: the tracks recorded here and the airplanes followed.
- watched: an open card's airplane asked for, and the followed ones.
- view: the map's traffic round a point, every source merged (`near`).
- lookup: a pilot's search for one airplane (`find`).
- routes: the route a flight number flies.
- flights: an airplane's flight today and its past flights.
- alerts: an airplane's state now, for a pilot's alerts (`status`).
- bases: where an airplane is based.

Each cache, lock and pool is made once, in the part that owns it, and the
parts that need it import that one object. The public names are
re-exported here, so `traffic.near(...)` reads as it always has.
"""
from __future__ import annotations

from .common import HEADERS, STALE_S, TIMEOUT_S, TrafficUnavailable
from .adsb_lol import (
    ADSB_LOL_SOURCE, BACKOFF_S, FIND_URL, FRESH_S, GLOBE, GLOBE_BACKOFF_S, KEEP_S, MAX_RADIUS_NM, MIN_GAP_S, NEAR_RADIUS_NM,
    RECENT_TTL_S, RECENT_URL, REGION_DEG, REGION_RADIUS_NM, TRACE_TTL_S, TRACE_URL, UNREAD, URL, WIDE_REGION_DEG, WIDE_REGION_RADIUS_NM,
)
from .adsbx import ADSBX_HOST, ADSBX_MIN_GAP_S, ADSBX_MONTHLY, ADSBX_SOURCE, ADSBX_URL, ADSBX_USAGE_FILE
from .adsbfi import ADSBFI_BACKOFF_S, ADSBFI_MIN_GAP_S, ADSBFI_SOURCE, ADSBFI_URL
from .radar import ELSEWHERE_RECORD_S, LOOKED_S, heard_elsewhere, radar_wanted
from .recorded import RECORDED_DIR, RECORD_KEEP_S, follow
from .watched import FOLLOW_EVERY_S, WATCH_FOR_S, WATCH_GAP_S, follow_round, start_following
from .view import ALTIMETER_NM, near, on_altimeter
from .lookup import ADSBX_BY, FOUND_TTL_S, find, find_credited, registered
from .routes import OFF_ROUTE_NM, ROUTE_TTL_S, ROUTE_URL, route
from .flights import (
    ARCHIVE_DAYS, DEPARTED_WITHIN_NM, FIELD_ABOVE_FT, FIELD_APPROACH_DEG, FIELD_APPROACH_FPM, FIELD_APPROACH_FT, FIELD_APPROACH_NM,
    FIELD_NEAR_NM, HISTORY_BATCH, HISTORY_DAYS_PER_ASK, HISTORY_FLIGHTS, HISTORY_TIMEOUT_S, HISTORY_TTL_S, HISTORY_URL, LEFT_ABOVE_FT,
    LEFT_NEAR_NM, LEG_GAP_S, LEG_MIN_S, PAST_POINTS, TRAIL_POINTS, flight, history, past_flight,
)
from .alerts import LANDED_UNHEARD_S, status
from .bases import BASED_MIN_ENDS, BASED_SHARE, BASED_TTL_S, BASED_WORKERS, based

__all__ = [
    "ADSBFI_BACKOFF_S", "ADSBFI_MIN_GAP_S", "ADSBFI_SOURCE", "ADSBFI_URL", "ADSBX_BY", "ADSBX_HOST", "ADSBX_MIN_GAP_S", "ADSBX_MONTHLY",
    "ADSBX_SOURCE", "ADSBX_URL", "ADSBX_USAGE_FILE", "ADSB_LOL_SOURCE", "ALTIMETER_NM", "ARCHIVE_DAYS", "BACKOFF_S", "BASED_MIN_ENDS",
    "BASED_SHARE", "BASED_TTL_S", "BASED_WORKERS", "DEPARTED_WITHIN_NM", "ELSEWHERE_RECORD_S", "FIELD_ABOVE_FT", "FIELD_APPROACH_DEG",
    "FIELD_APPROACH_FPM", "FIELD_APPROACH_FT", "FIELD_APPROACH_NM", "FIELD_NEAR_NM", "FIND_URL", "FOLLOW_EVERY_S", "FOUND_TTL_S",
    "FRESH_S", "GLOBE", "GLOBE_BACKOFF_S", "HEADERS", "HISTORY_BATCH", "HISTORY_DAYS_PER_ASK", "HISTORY_FLIGHTS", "HISTORY_TIMEOUT_S",
    "HISTORY_TTL_S", "HISTORY_URL", "KEEP_S", "LANDED_UNHEARD_S", "LEFT_ABOVE_FT", "LEFT_NEAR_NM", "LEG_GAP_S", "LEG_MIN_S", "LOOKED_S",
    "MAX_RADIUS_NM", "MIN_GAP_S", "NEAR_RADIUS_NM", "OFF_ROUTE_NM", "PAST_POINTS", "RECENT_TTL_S", "RECENT_URL", "RECORDED_DIR",
    "RECORD_KEEP_S", "REGION_DEG", "REGION_RADIUS_NM", "ROUTE_TTL_S", "ROUTE_URL", "STALE_S", "TIMEOUT_S", "TRACE_TTL_S", "TRACE_URL",
    "TRAIL_POINTS", "TrafficUnavailable", "UNREAD", "URL", "WATCH_FOR_S", "WATCH_GAP_S", "WIDE_REGION_DEG", "WIDE_REGION_RADIUS_NM",
    "based", "find", "find_credited", "flight", "follow", "follow_round", "heard_elsewhere", "history", "near", "on_altimeter",
    "past_flight", "radar_wanted", "registered", "route", "start_following", "status",
]
