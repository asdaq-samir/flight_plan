"""The nav log's own arithmetic: the cruise altitude (remembered per
route), the course line, and the aircraft it is all computed for. The
legs are vfr.navlog's."""
import math
import threading
import time
from datetime import datetime, timedelta, timezone

from cachetools import TTLCache

from vfr import aircraft as aircraft_module
from vfr import altitude as altitude_module
from vfr import geo, navlog, sun, weather
from vfr.config import PLAN_LIMIT_S


# How long a caller waits on a computation that is already running before
# saying so, and after which that computation counts as abandoned: the
# planner's one bound, vfr.config's (see there).
COMPUTE_LIMIT_S = PLAN_LIMIT_S

# What the stages of vfr.altitude's selection are called to a pilot, by
# the part of their label before the dot.
_STAGE_NAMES = {
    "terrain": "the terrain and obstacles",
    "airspace": "the airspace",
    "weather": "aviationweather.gov",
    "magnetic_variation_deg": "the magnetic variation",
    "sua": "the FAA's special-use airspace",
    "model-service": "model-service's checkpoint scores",
}


def describe_stages(stages) -> str:
    """"the terrain and obstacles and aviationweather.gov" -- what a
    computation is still waiting on, in words a pilot can act on."""
    names = sorted({_STAGE_NAMES.get(stage.split(".")[0], stage) for stage in stages})
    if not names:
        return ""
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


class StillComputing(RuntimeError):
    """A computation for this key has been running longer than the limit.
    The message says for how long and on what it is still waiting;
    whatever it finishes with is cached for the next request."""

    def __init__(self, elapsed_s: float, stages):
        waiting = describe_stages(stages)
        super().__init__(
            f"Still working after {elapsed_s:.0f} s"
            + (f", waiting on {waiting}" if waiting else "")
            + ". Try again in a minute: the answer is kept once it arrives."
        )
        self.elapsed_s = elapsed_s
        self.stages = sorted(stages)


class _Flight:
    """One computation in progress: when it started, the stages it has
    said are still running, and the event its waiters wait on."""

    def __init__(self, pending: set | None):
        self.started = time.monotonic()
        self.pending = pending if pending is not None else set()
        self.done = threading.Event()

    def age(self) -> float:
        return time.monotonic() - self.started


class SingleFlightTTLCache:
    """A TTLCache where a miss is computed once per key, even under
    concurrent callers.

    The lock used to protect only the dict: check the cache, release the
    lock, compute on a miss, re-take the lock to store it. That leaves
    the computation itself unguarded, so two requests for the same
    not-yet-cached route -- the same plan loaded from two tabs, a retry
    racing the original -- both pay for the whole terrain/airspace/
    weather stack, which is exactly the cost this cache exists to avoid
    paying twice. The second caller now waits on the first caller's
    result instead of repeating it.

    A per-key event, not one lock for the whole cache: two different
    routes must still compute in parallel, only two callers of the
    *same* route serialise.

    And the wait is bounded (`limit_s`). It used to wait for as long as
    the first computation took, and one that never finished -- seen on
    2026-09-23, after a Docker restart, with every later nav log for the
    route streaming "still waiting" until the service was restarted --
    held every later caller with it. A caller now gives up after the
    limit with StillComputing, saying what the computation is waiting
    on; and a computation older than the limit counts as abandoned, so
    the next caller starts a fresh one rather than joining it.
    """

    def __init__(self, maxsize: int, ttl: float):
        self._cache: TTLCache = TTLCache(maxsize=maxsize, ttl=ttl)
        self._lock = threading.Lock()
        self._inflight: dict[object, _Flight] = {}
        # key -> a computation given up on as abandoned that has not
        # finished yet (see get_or_compute).
        self._abandoned: dict[object, _Flight] = {}

    def get(self, key):
        """Read-only access, for a caller that wants to see a cached
        value without joining anyone else's in-flight computation."""
        with self._lock:
            return self._cache.get(key)

    def running(self, key) -> tuple[float, list] | None:
        """How long the computation for `key` has been running and which
        of its stages are still going, or None when none is."""
        with self._lock:
            flight = self._inflight.get(key)
            return None if flight is None else (flight.age(), sorted(flight.pending))

    def clear(self):
        """Same shape as TTLCache.clear(), so the test fixture that
        resets every cache between tests does not need to know this one
        is not a bare TTLCache."""
        with self._lock:
            self._cache.clear()
            self._inflight.clear()
            self._abandoned.clear()

    def get_or_compute(self, key, compute, limit_s: float | None = None, pending: set | None = None):
        """The cached value, or `compute()`'s -- computed once however
        many callers ask at the same time. `pending` is the set `compute`
        reports its running stages in (see vfr.altitude._timed), shown to
        anyone waiting on it; `limit_s` bounds the wait (see above)."""
        with self._lock:
            hit = self._cache.get(key)
            if hit is not None:
                return hit
            flight = self._inflight.get(key)
            if flight is not None and limit_s is not None and flight.age() > limit_s:
                # Abandoned. A fresh computation replaces it -- once. The
                # abandoned one cannot be stopped and keeps its threads,
                # and when what it is stuck on is shared (a lock, a hung
                # download) the fresh one sticks on it too; replacing
                # every limit_s piled up another stuck computation each
                # time. While an abandoned one is still running, a caller
                # is told what it waits on instead.
                previous = self._abandoned.get(key)
                if previous is not None and not previous.done.is_set():
                    raise StillComputing(flight.age(), flight.pending)
                self._abandoned[key] = flight
                flight = None
            if flight is None:
                flight = _Flight(pending)
                self._inflight[key] = flight
                leader = True
            else:
                leader = False

        if not leader:
            remaining = None if limit_s is None else max(0.0, limit_s - flight.age())
            if not flight.done.wait(timeout=remaining):
                raise StillComputing(flight.age(), flight.pending)
            with self._lock:
                hit = self._cache.get(key)
            if hit is not None:
                return hit
            # The leader's own compute() raised, so nothing was stored --
            # fall through and try again rather than propagate an
            # unrelated caller's exception, or the leader's transient
            # network error, to every follower that was only waiting on
            # a lock.
            return self.get_or_compute(key, compute, limit_s, pending)

        try:
            value = compute()
        except BaseException:
            self._finish(key, flight)
            raise
        with self._lock:
            # The current flight owns the slot. One replaced as abandoned
            # only fills an empty one: it used to overwrite the newer
            # flight's answer with its own, from inputs at least limit_s
            # older, and a fresh TTL.
            if self._inflight.get(key) is flight or key not in self._cache:
                self._cache[key] = value
        self._finish(key, flight)
        return value

    def _finish(self, key, flight: _Flight) -> None:
        """Wakes this flight's waiters, and forgets it -- unless a later
        caller has already replaced it as abandoned, whose own flight
        must stay."""
        with self._lock:
            if self._abandoned.get(key) is flight:
                del self._abandoned[key]
            if self._inflight.get(key) is flight:
                del self._inflight[key]
        flight.done.set()


def aircraft_profile(
    name: str, cruise_tas_kt: float | None = None, fuel_burn_gph: float | None = None,
    usable_fuel_gal: float | None = None,
) -> dict:
    """One of data/aircraft's profiles, with a pilot's own aeroplane's
    numbers on top when given: the profile still supplies the service
    ceiling the altitude selection needs, the overrides supply what the
    legs and the fuel check need."""
    profile = aircraft_module.load_aircraft_profile(name)
    if cruise_tas_kt is not None:
        profile["cruise_tas_kt"] = cruise_tas_kt
    if fuel_burn_gph is not None:
        profile["fuel_burn_gph"] = fuel_burn_gph
    if usable_fuel_gal is not None:
        profile["usable_fuel_gal"] = usable_fuel_gal
    return profile


def flight_totals(leg_list: list, profile: dict, r, depart: datetime | None) -> dict:
    """navlog.totals plus the fuel check. Night is judged at both ends
    -- the departure at the departure time, the arrival at the
    destination that many minutes later -- and unknown without a
    departure time, when the day reserve is assumed and said so."""
    t = navlog.totals(leg_list)
    night = None
    if depart is not None:
        if depart.tzinfo is None:
            depart = depart.replace(tzinfo=timezone.utc)
        night = sun.is_night(r.start[0], r.start[1], depart)
        if t["ete_min"] is not None:
            arrival = depart + timedelta(minutes=t["ete_min"])
            night = night or sun.is_night(r.end[0], r.end[1], arrival)
    t.update(navlog.fuel_plan(t["fuel_gal"], profile, night))
    return t

# The altitude selection re-ran its whole stack -- terrain sampling
# (USGS EPQS, network), the airspace shapefile, and three separate
# aviationweather.gov calls -- on every single nav-log request, for a
# result that only moves when the weather does. The terrain and airspace
# halves are static per route outright; the weather half already runs on
# aviationweather.gov products reissued a few times a day, and
# vfr.weather's own winds cache uses this same 15-minute TTL. On a bad
# aviationweather.gov day (504s, retries) one uncached selection was
# observed taking over two minutes -- a price worth paying once per
# route per quarter hour, not on every page load.
# cachetools rather than a dict and a timestamp per entry: it holds the
# expiry itself, and -- the reason it matters here -- maxsize bounds it.
# The key includes every fix of the route, so a plain dict grew by a row
# for every distinct set of checkpoints a pilot tried and never gave one
# back. That is a leak in a process meant to stay up.
#
# Single-flight (see SingleFlightTTLCache above): the two-minute-worst-
# case number above is exactly what two identical requests on a cache
# miss used to both pay, concurrently, before this was single-flight --
# the same route opened in two tabs, or a client's own retry racing the
# request it gave up on.
_ALTITUDE_TTL_S = 900
_ALTITUDE_CACHE = SingleFlightTTLCache(maxsize=512, ttl=_ALTITUDE_TTL_S)


def _altitude_key(start: tuple, end: tuple, aircraft: str, fixes: list | None, fcst_hr: str,
                  window: tuple | None = None) -> tuple:
    return (
        round(start[0], 4), round(start[1], 4), round(end[0], 4), round(end[1], 4), aircraft,
        tuple((round(lat, 4), round(lon, 4)) for lat, lon in fixes) if fixes else None, fcst_hr,
        (round(window[0]), round(window[1])) if window else None,
    )


def flight_window(depart: datetime | None, distance_nm: float, cruise_tas_kt: float) -> tuple:
    """(start, end) in unix seconds: from the hour the departure falls in
    (now, when none is given) to an hour past the arrival at cruise TAS.
    The go/no-go forecast is read over this rather than at the moment of
    asking. Whole hours, so one hour's requests share a cached selection."""
    if depart is None:
        start = time.time()
    else:
        start = (depart if depart.tzinfo else depart.replace(tzinfo=timezone.utc)).timestamp()
    start -= start % 3600
    hours = distance_nm / max(cruise_tas_kt, 1.0) + 1.0
    return (start, start + math.ceil(hours) * 3600)


def cruise_altitude(
    start: tuple, end: tuple, profile: dict, aircraft: str, fixes: list | None = None, fcst_hr: str = "06",
    window: tuple | None = None,
) -> dict:
    """`fixes`, the nav log's own (lat, lon) fixes, add the leg-by-leg
    segments the stepped plans need; they are part of the key, since a
    different set of checkpoints is a different set of legs. So is the
    forecast period, since the freezing level is read from it. Raises
    StillComputing when the same selection has been running longer
    than COMPUTE_LIMIT_S."""
    pending: set = set()

    def compute():
        # The keywords only when they differ from the defaults: the
        # route-wide caller (/api/altitude-breakdown, which the CrewAI
        # agent's altitude tool asks) keeps the original call.
        extra = {}
        if fixes:
            extra["fixes"] = fixes
        if fcst_hr != "06":
            extra["fcst_hr"] = fcst_hr
        if window is not None:
            extra["window"] = window
        return altitude_module.select_cruise_altitude(start, end, profile, pending=pending, **extra)

    return _ALTITUDE_CACHE.get_or_compute(
        _altitude_key(start, end, aircraft, fixes, fcst_hr, window), compute, COMPUTE_LIMIT_S, pending,
    )


def altitude_waiting_on(start: tuple, end: tuple, aircraft: str, fixes: list | None, fcst_hr: str,
                        window: tuple | None = None) -> str:
    """What the selection cruise_altitude() would be joining is still
    waiting on, in words -- "" when nothing of it is running, which is
    also the case once it is done and the plans' winds are what remains."""
    running = _ALTITUDE_CACHE.running(_altitude_key(start, end, aircraft, fixes, fcst_hr, window))
    return "" if running is None else describe_stages(running[1])


# The three plans read the winds at every legal altitude of every leg,
# and the winds product is reissued a few times a day and held by
# vfr.weather for the same 15 minutes -- so the plans are held as long,
# per route, fixes and aeroplane, and switching between them is free.
# Single-flight for the same reason _ALTITUDE_CACHE is.
_PLANS_CACHE = SingleFlightTTLCache(maxsize=512, ttl=_ALTITUDE_TTL_S)


def altitude_plans(
    fix_list: list, selection: dict, profile: dict, aircraft: str, fcst_hr: str = "06",
    departure_elevation_ft: float | None = None,
) -> dict:
    key = (
        aircraft, profile.get("cruise_tas_kt"), profile.get("fuel_burn_gph"), fcst_hr, departure_elevation_ft,
        tuple((round(f["lat"], 4), round(f["lon"], 4)) for f in fix_list),
        tuple(tuple(s["candidates_ft"]) for s in selection.get("segments", [])),
    )

    def compute():
        return navlog.altitude_profiles(
            fix_list, selection.get("segments", []), profile, fcst_hr, departure_elevation_ft=departure_elevation_ft,
        )

    return _PLANS_CACHE.get_or_compute(key, compute, COMPUTE_LIMIT_S)


def forecast_hour_for(depart: datetime | None) -> str:
    """The winds forecast period for a departure time -- now, when none
    is given. A naive time is taken as UTC, the way the API documents."""
    if depart is None:
        return weather.forecast_hour(None)
    if depart.tzinfo is None:
        depart = depart.replace(tzinfo=timezone.utc)
    return weather.forecast_hour((depart - datetime.now(timezone.utc)).total_seconds() / 3600)


def no_altitude_detail(selection: dict) -> str:
    prohibited = [a["name"] for a in selection.get("special_use", []) if a.get("type") == "P"]
    if prohibited:
        return (
            f"The route crosses prohibited airspace ({', '.join(prohibited)}), which no VFR "
            "altitude may enter. Plan around it."
        )
    return (
        "No legal VFR cruising altitude exists for this route and aircraft "
        f"(floor {selection.get('floor_ft')} ft, ceiling "
        f"{selection.get('band_ceiling_ft')} ft). Supply altitude_ft "
        "explicitly to plan anyway."
    )


def course_line(start: tuple, end: tuple, step_nm: float = 5.0) -> list:
    """The course line as [[lat, lon], ...], following the great circle.

    Stepped with the bearing recomputed toward the destination at every
    point, which is what makes it the actual great circle: hold the
    initial bearing constant instead and you trace a different path that
    sits a couple of miles off true course at the midpoint of a 300 nm
    leg. That matters because candidate positions come from great-circle
    cross-track distance, so a line drawn any other way would show
    on-course checkpoints as visibly off it.
    """
    total = geo.distance_nm(start[0], start[1], end[0], end[1])
    points, current, travelled = [list(start)], start, 0.0
    while travelled + step_nm < total:
        bearing = geo.bearing_deg(current[0], current[1], end[0], end[1])
        current = geo.destination_point(current[0], current[1], bearing, step_nm)
        travelled += step_nm
        points.append(list(current))
    points.append(list(end))
    return points
