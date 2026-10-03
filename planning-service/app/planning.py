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
from vfr import airspace, geo, navlog, sun, weather
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
    "chart": "the chart reader",
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
    usable_fuel_gal: float | None = None, climb_tas_kt: float | None = None,
    climb_fuel_burn_gph: float | None = None, cruise_power_pct: float | None = None,
) -> dict:
    """One of data/aircraft's profiles, with a pilot's own aeroplane's
    numbers on top when given: the profile still supplies the service
    ceiling the altitude selection needs, the overrides supply what the
    legs, their climbs and the fuel check need."""
    profile = aircraft_module.load_aircraft_profile(name)
    overrides = {
        "cruise_tas_kt": cruise_tas_kt, "fuel_burn_gph": fuel_burn_gph, "usable_fuel_gal": usable_fuel_gal,
        "climb_tas_kt": climb_tas_kt, "climb_fuel_burn_gph": climb_fuel_burn_gph,
        "cruise_power_pct": cruise_power_pct,
    }
    profile.update({k: v for k, v in overrides.items() if v is not None})
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
                  window: tuple | None = None, class_b_cleared: bool = False) -> tuple:
    return (
        round(start[0], 4), round(start[1], 4), round(end[0], 4), round(end[1], 4), aircraft,
        tuple((round(lat, 4), round(lon, 4)) for lat, lon in fixes) if fixes else None, fcst_hr,
        (round(window[0]), round(window[1])) if window else None, class_b_cleared,
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
    window: tuple | None = None, class_b_cleared: bool = False,
) -> dict:
    """`fixes`, the nav log's own (lat, lon) fixes, add the leg-by-leg
    segments the stepped plans need; they are part of the key, since a
    different set of checkpoints is a different set of legs. So is the
    forecast period, since the freezing level is read from it, and
    `class_b_cleared`, a pilot who will have a Class B clearance (vfr.altitude).
    Raises StillComputing when the same selection has been running longer
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
        if class_b_cleared:
            extra["class_b_cleared"] = True
        return altitude_module.select_cruise_altitude(start, end, profile, pending=pending, **extra)

    return _ALTITUDE_CACHE.get_or_compute(
        _altitude_key(start, end, aircraft, fixes, fcst_hr, window, class_b_cleared), compute, COMPUTE_LIMIT_S,
        pending,
    )


def altitude_waiting_on(start: tuple, end: tuple, aircraft: str, fixes: list | None, fcst_hr: str,
                        window: tuple | None = None, class_b_cleared: bool = False) -> str:
    """What the selection cruise_altitude() would be joining is still
    waiting on, in words -- "" when nothing of it is running, which is
    also the case once it is done and the plans' winds are what remains."""
    running = _ALTITUDE_CACHE.running(_altitude_key(start, end, aircraft, fixes, fcst_hr, window, class_b_cleared))
    return "" if running is None else describe_stages(running[1])


# The four plans read the winds at every legal altitude of every leg,
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
        aircraft, profile.get("cruise_tas_kt"), profile.get("fuel_burn_gph"),
        profile.get("climb_tas_kt"), profile.get("climb_fuel_burn_gph"), profile.get("cruise_power_pct"),
        fcst_hr, departure_elevation_ft,
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


def no_altitude(selection: dict, between: tuple[str, str] | None = None, via: dict | None = None) -> dict:
    """Why no plan has an altitude, in a pilot's words, in three parts: a
    headline saying where along the route it fails, the reasons there as
    short sentences -- the terrain's floor, the first VFR altitude above
    it on that course, what stops the climb -- and what to do about it.
    The page lists the reasons under the headline in the nav log, where
    they stay; it was one long sentence in a toast that went before it
    could be read. It gave the whole route's highest floor beside its
    lowest ceiling ("floor 13700 ft, ceiling 3000.0 ft" for Chicago to
    Las Vegas: the Rockies' floor beside the Chicago Class B shelf, a
    thousand miles apart) and asked for a query parameter. `between`, the
    hop of a route with stops it fails on: the distances are from its
    start, and the headline names it. `class_b` says Class B airspace is
    what stops it, for the page to offer a clearance or a way round:
    `via`, the best waypoint round it (class_b_detours), when there is one."""
    prohibited = [a["name"] for a in selection.get("special_use", []) if a.get("type") == "P"]
    if prohibited:
        return {
            "title": "The route crosses prohibited airspace",
            "reasons": [f"{name} is closed to every VFR altitude." for name in prohibited],
            "advice": "Plan around it.",
            "class_b": False,
        }
    stuck = next((s for s in selection.get("segments", []) if not s.get("candidates_ft")), None)
    course = (stuck or {}).get("course_magnetic_deg", selection.get("course_magnetic_deg"))
    floor, top = (stuck or {}).get("floor_ft"), (stuck or {}).get("band_ceiling_ft")
    if stuck is None or None in (course, floor, top):
        return {
            "title": (f"No legal VFR cruising altitude fits {between[0]} to {between[1]} in this aircraft" if between
                      else "No legal VFR cruising altitude fits this route in this aircraft"),
            "reasons": [],
            "advice": "Set a cruise altitude of your own to plan it anyway.",
            "class_b": False,
        }
    # The first altitude the band would have taken: the same rule as the
    # band's own (legal_cruising_altitudes) -- any 500 ft under 3,000 ft
    # above the ground, the course's own thousands-plus-500 over it. It
    # said the first westbound altitude whatever the height, 2,500 ft
    # over a 1,700 ft floor by Chicago, where 2,000 ft is legal.
    rule_from = stuck.get("hemispheric_rule_from_ft")
    first = (altitude_module.legal_cruising_altitudes(floor, None, course, rule_from)
             or [altitude_module.lowest_vfr_cruising_altitude(floor, course)])[0]
    under_rule = rule_from is not None and first < rule_from
    heading = "eastbound" if stuck.get("eastbound") else "westbound"
    first_line = (f"The lowest altitude above that is {first:,.0f} ft." if under_rule
                  else f"The first {heading} VFR altitude above that is {first:,.0f} ft.")
    advice = "Route around the high ground, or set a cruise altitude of your own to plan it anyway."
    class_b = False
    if top == stuck.get("service_ceiling_ft"):
        stops = f"The aircraft's service ceiling stops at {top:,.0f} ft."
    elif top == stuck.get("airspace_ceiling_ft"):
        # The Class B by name, and what it takes: "The airspace over it
        # stops at 0 ft" was Midway to Duluth's straight line over O'Hare.
        bravo = f"The {_class_b_over(selection, stuck)}"
        stops = (f"{bravo} reaches the ground there; going through it needs a clearance." if top <= 0
                 else f"{bravo} over it starts at {top:,.0f} ft; going into it needs a clearance.")
        class_b = True
        advice = (f"Fly via {via['ident']} ({via['added_nm']:.0f} nm further) to stay out of it" if via
                  else "Add a stop to route around it") + ", or plan it with a Class B clearance."
    else:
        stops = f"The cloud base stops at {top:,.0f} ft."
    title = f"No legal VFR cruising altitude {stuck['from_nm']:.0f}-{stuck['to_nm']:.0f} nm " + (
        f"out of {between[0]} toward {between[1]}" if between else "along the route")
    if top <= 0:
        # Airspace from the ground up leaves no altitude whatever the
        # terrain: the floor and the first altitude over it were noise.
        return {"title": title, "reasons": [stops], "advice": advice, "class_b": class_b}
    return {
        "title": title,
        "reasons": [f"The terrain and obstacles there need {floor:,.0f} ft.", first_line, stops],
        "advice": advice,
        "class_b": class_b,
    }


def class_b_detours(selection: dict, start: tuple, end: tuple) -> list[dict]:
    """Where Class B airspace is what leaves a leg of the flight from
    `start` to `end` no altitude, the waypoints that keep both legs out of
    it (vfr.airspace.detour_waypoints), best first -- out of the parts low
    enough to stop the lowest altitude the leg's ground allows; none
    otherwise."""
    stuck = next((s for s in selection.get("segments", []) if not s.get("candidates_ft")), None)
    if stuck is None or stuck.get("airspace_ceiling_ft") is None or stuck.get("band_ceiling_ft") != stuck["airspace_ceiling_ft"]:
        return []
    lowest = altitude_module.legal_cruising_altitudes(
        stuck["floor_ft"], None, stuck.get("course_magnetic_deg", 0.0), stuck.get("hemispheric_rule_from_ft"))
    if not lowest:
        return []
    shp_path = airspace.ensure_class_airspace_shapefile(altitude_module.DEFAULT_FAA_CACHE_DIR)
    return airspace.detour_waypoints(start, end, shp_path, lowest[0])


def _class_b_over(selection: dict, segment: dict) -> str:
    """The Class B a leg is stuck under, as a pilot says it ("Chicago
    Class B"): of the route's Class B transits, the one nearest the leg's
    middle; "Class B airspace" where none is named."""
    middle = (segment["from_nm"] + segment["to_nm"]) / 2
    bravos = [t for t in selection.get("airspace_transits", []) if t.get("class") == "B"]
    if not bravos:
        return "Class B airspace"
    name = min(bravos, key=lambda t: abs(t.get("along_track_nm", 0.0) - middle))["name"]
    return " ".join(word.capitalize() if len(word) > 1 else word for word in name.split())


def no_altitude_detail(selection: dict, between: tuple[str, str] | None = None, via: dict | None = None) -> str:
    """no_altitude as one message, for /api/plan's 422 and the agents
    that read it."""
    parts = no_altitude(selection, between, via)
    reasons = " ".join(parts["reasons"])
    return f"{parts['title']}. {reasons + ' ' if reasons else ''}{parts['advice']}"


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


def route_line(r) -> list:
    """The course line of a route with any number of stops: each hop's
    great circle (course_line) in turn, a stop once where two meet."""
    points: list = []
    for hop in r.hops:
        hop_line = course_line(hop.start, hop.end)
        points += hop_line if not points else hop_line[1:]
    return points


def _least(values):
    known = [v for v in values if v is not None]
    return min(known) if known else None


def _either(values) -> bool | None:
    """True where any is, unknown where any is unknown, False otherwise:
    a hop's "could not be checked" must not read as the route's "fine"."""
    values = list(values)
    return True if any(v is True for v in values) else None if any(v is None for v in values) else False


def join_selections(selections: list[dict], offsets: list[float]) -> dict:
    """One altitude breakdown for a route with stops, from each hop's
    (vfr.altitude.select_cruise_altitude): the hops' segments in turn,
    along the whole route, with what they cross; and the route-wide
    figures the most limiting of the hops', as a hop's are the most
    limiting of its legs' -- the highest floor, the lowest ceilings and
    cloud. Legal for the whole route is what is legal on every hop. The
    magnetic course is the first hop's, the one flown out on."""
    if len(selections) == 1:
        return selections[0]

    def shifted(items, keys, offset):
        return [{**item, **{k: round(item[k] + offset, 1) for k in keys if item.get(k) is not None}} for item in items]

    special_use, legs_before = [], 0
    for sel, offset in zip(selections, offsets):
        for area in sel.get("special_use", []):
            special_use.append({
                **area, "along_track_nm": round(area["along_track_nm"] + offset, 1),
                "legs": [i + legs_before for i in area.get("legs", [])],
            })
        legs_before += len(sel.get("segments", []))
    clouds = [(sel["cloud_base_ft"], sel.get("cloud_station")) for sel in selections if sel.get("cloud_base_ft") is not None]
    cloud_base_ft, cloud_station = min(clouds) if clouds else (None, None)
    candidates = sorted(set.intersection(*(set(sel.get("candidates_ft", [])) for sel in selections)))

    def least(key):
        return _least(sel.get(key) for sel in selections)

    def either(key):
        return _either(sel.get(key) for sel in selections)

    return {
        **selections[0],
        "recommended_ft": candidates[0] if candidates else None,
        "candidates_ft": candidates,
        "hemispheric_rule_from_ft": least("hemispheric_rule_from_ft"),
        "floor_ft": max(sel["floor_ft"] for sel in selections),
        "airspace_ceiling_ft": least("airspace_ceiling_ft"),
        "service_ceiling_ft": least("service_ceiling_ft"),
        "cloud_base_ft": cloud_base_ft,
        "cloud_station": cloud_station,
        "cloud_ceiling_ft": least("cloud_ceiling_ft"),
        "cloud_clearance_kept": all(sel.get("cloud_clearance_kept", True) for sel in selections),
        "airspace_transits": [t for sel, offset in zip(selections, offsets)
                              for t in shifted(sel.get("airspace_transits", []), ("along_track_nm",), offset)],
        "special_use": special_use,
        "freezing_level_ft": least("freezing_level_ft"),
        "freezing_level_at_or_below": any(sel.get("freezing_level_at_or_below") for sel in selections),
        "icing_possible": either("icing_possible"),
        "band_ceiling_ft": least("band_ceiling_ft"),
        "min_ceiling_ft": least("min_ceiling_ft"),
        "min_visibility_sm": least("min_visibility_sm"),
        "hazards": list({h.get("raw") or repr(h): h for sel in selections for h in sel.get("hazards", [])}.values()),
        "low_ceiling_or_visibility": either("low_ceiling_or_visibility"),
        "weather_unavailable": sorted({w for sel in selections for w in sel.get("weather_unavailable", [])}),
        "segments": [seg for sel, offset in zip(selections, offsets)
                     for seg in shifted(sel.get("segments", []), ("from_nm", "to_nm"), offset)],
    }


def route_totals(per_hop: list[dict], hops: list) -> dict:
    """The trip's sums for a route that lands on the way, from each
    flight's own (flight_totals) -- each from one landing to the next --
    and each with its own fuel check: the tanks are filled at every
    stop, so one check over the whole trip would mean nothing -- the
    route's own fuel figures are left out, and `hops` holds each one's.
    A route with no landings on the way is its one flight's."""
    if len(per_hop) == 1:
        return per_hop[0]

    def total(key):
        values = [t[key] for t in per_hop]
        return None if any(v is None for v in values) else round(sum(values), 1)

    return {
        "distance_nm": round(sum(t["distance_nm"] for t in per_hop), 1),
        "ete_min": total("ete_min"),
        "fuel_gal": total("fuel_gal"),
        "unflyable_legs": sum(t["unflyable_legs"] for t in per_hop),
        "legs_without_wind": sum(t["legs_without_wind"] for t in per_hop),
        "night": _either(t.get("night") for t in per_hop),
        "hops": [{"departure": hop.dep_ident, "destination": hop.dest_ident, "totals": t} for hop, t in zip(hops, per_hop)],
    }
