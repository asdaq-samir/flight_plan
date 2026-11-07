"""An airplane's flight today, and its past flights: the last days' from adsb.lol's archive and
the ones recorded here, and one replayed."""
from __future__ import annotations

import math
import time
from concurrent.futures import ThreadPoolExecutor

import requests
from cachetools import TTLCache

from .. import airports, geo, registry
from .common import _LOCK, _clock, _number
from .adsb_lol import GLOBE, UNREAD, _GlobeRefused, _Unread, _globe_get, _trace
from .recorded import _recorded, follow
from .watched import _WATCHED, _watch

#: At most this many points of a trail are sent: enough for a line on a
#: phone, a fraction of a long flight's.
TRAIL_POINTS = 600
#: A field within this of where a flight began on the ground is where it
#: departed from.
DEPARTED_WITHIN_NM = 3.0
#: readsb's trace flag for a point that starts a new leg.
_NEW_LEG = 2


def _altitude_ft(point: list) -> float | None:
    """A trace point's height: its GNSS height where it has one, as the
    map's live reports are, else its pressure altitude; None on the ground."""
    if point[3] == "ground":
        return None
    geometric = point[10] if len(point) > 10 else None
    return _number(geometric) if geometric is not None else _number(point[3])


def flight(hex_id: str) -> dict:
    """An airplane's flight today, from its trace: {"hex", "faa" (its FAA
    registration, wingtip.registry.lookup; None for one registered abroad or
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
        # N-number (wingtip.registry); None for one registered abroad.
        "faa": registry.lookup(hex_id=hex_id, n_number=trace.get("r")),
        "registration": trace.get("r") or None,
        "type": trace.get("t") or None,
        "description": trace.get("desc") or None,
        "operator": trace.get("ownOp") or None,
        "year": trace.get("year") or None,
        "departed": departed,
        "trail": trail,
    }


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


def _day_trace(hex_id: str, day) -> dict | None | _Unread:
    """An airplane's trace on a past UTC day (a datetime.date), kept; None
    where it has none that day; UNREAD where it could not be had now -- a
    refusal or a timeout, which is not kept and is asked again next time."""
    key = (hex_id, day.isoformat())
    with _LOCK:
        if key in _DAYS:
            return _DAYS[key]
    try:
        resp = _globe_get(HISTORY_URL.format(day=day, last2=hex_id[-2:], hex=hex_id), HISTORY_TIMEOUT_S)
        if resp.status_code == 404:
            trace = None
        else:
            resp.raise_for_status()
            trace = resp.json()
            if not isinstance(trace, dict):
                trace = None
    except (requests.RequestException, ValueError, _GlobeRefused):
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
        headed = track is not None and geo.angle_between(track, toward) <= FIELD_APPROACH_DEG
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
