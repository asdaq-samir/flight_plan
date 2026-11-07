"""Live weather for VFR altitude selection and dead-reckoning nav-log math:
winds/temps aloft (freezing level for icing avoidance, and wind_at_altitude
for wind-correction-angle math), forecast ceiling/visibility along the
route, current METARs, and SIGMET hazard advisories -- from
aviationweather.gov, but for the winds and temperatures aloft, which are
the GFS model's (wingtip.modelwinds) since the FB ended with the NAM (NWS
Service Change Notice 26-47).

METARs, TAFs and SIGMETs come from the site's cache files -- the complete
current national dataset, gzipped, regenerated every minute (TAFs every
ten) -- rather than per-route API queries. That is what their API terms
ask heavy users to do: a bounding-box query per route is exactly the
"large query" the rate limit and the results cap exist for, and one
download every few minutes replaces all of them. Every one of them is a
source in _SOURCES, held by one rule (see _dataset): parsed as it is
fetched, kept for its own time, a failed refresh serving the previous
copy for as long as that product itself is still valid (a TAF to the end
of its valid period, an advisory to the end of its own) -- so an outage degrades to "the last forecast issued"
rather than a failure per request, and the copy's fetch time
(dataset_status) tells the page how old it is -- and a failure with
nothing to serve remembered for a minute rather than tried again by
every caller.

Unlike the FAA NASR/DOF data in wingtip.faa_data, none of this is cached to
disk: it's live/current-conditions data, and a copy past its product's
own validity is stale, not "the current cycle".
"""
import gzip
import json
import logging
import re
import threading
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from itertools import pairwise
from typing import NamedTuple

import numpy as np
import requests
import wingtip_native

from .config import REQUEST_HEADERS as HEADERS
from .performance import isa_temp_c
from .retry import with_retries
from .units import M_TO_FT

log = logging.getLogger(__name__)

CACHE_BASE_URL = "https://aviationweather.gov/data/cache"


class WeatherServiceError(RuntimeError):
    """aviationweather.gov didn't respond, timed out, or returned an
    error status. Every function in this module that calls it raises
    this instead of letting requests' own exception (ConnectionError,
    Timeout, HTTPError -- a wide, transport-specific family) propagate
    raw, so callers (planning-service's route handlers, nav-log-agent)
    have one exception type to catch regardless of which call failed or
    why.
    """


#: The client errors that can pass: 408 Request Timeout, 429 Too Many Requests.
RETRIED_CLIENT_ERRORS = (408, 429)


def _get(url: str, params: dict, retries: int = 3, validators: dict | None = None) -> requests.Response:
    """A transient blip (a slow bbox query 504ing, seen 2026-09-18) used
    to raise WeatherServiceError on the first and only attempt instead of
    quietly succeeding on a retry a few seconds later. `validators`, the
    held copy's ETag and Last-Modified, ask for it only if it has changed
    (a 304 otherwise).

    A request refused as asked (a 4xx but a time-out or too many
    requests) is not tried again: it is refused the same way each time.
    The windtemp API answered 400 on 2026-11-06, its tables discontinued
    with the NAM (NWS Service Change Notice 26-47), and three tries and
    their back-off put 6.5 s on a plan once a minute before the modelled
    winds were read (the planner's log, freezing_level 6.46 s)."""
    headers = {**HEADERS, **(validators or {})}

    def attempt() -> requests.Response:
        resp = requests.get(url, params=params, headers=headers, timeout=30)
        status = getattr(resp, "status_code", None)
        if isinstance(status, int) and 400 <= status < 500 and status not in RETRIED_CLIENT_ERRORS:
            raise WeatherServiceError(f"aviationweather.gov request to {url} refused: {status} {str(resp.text)[:200]}")
        resp.raise_for_status()
        return resp

    return with_retries(
        attempt, describe=f"aviationweather.gov request to {url}", retries=retries, error=WeatherServiceError,
    )


# --- Winds and temperatures aloft, and the freezing level, from the GFS ---


def _fd_stations(fcst_hr: str = "06") -> dict:
    """The winds and temperatures aloft for one period, read once and held
    (wingtip.modelwinds): the GFS's levels at the old FB stations. The
    three altitude plans look the winds up at every legal altitude of
    every leg -- well over a hundred lookups for one route -- so it is
    never read per lookup. The FB itself is gone (NWS Service Change
    Notice 26-47: its bulletins ended with the NAM at 1200Z on 3 Nov
    2026), so these are the winds aloft, said to be modelled wherever
    they are shown. WeatherServiceError, in a pilot's words, where no
    copy inside its own window is held and NOMADS gives none."""
    from . import modelwinds

    try:
        return modelwinds.stations(fcst_hr)
    except modelwinds.ModelWindsUnavailable as err:
        log.warning("modelled winds for the %s-hour period unavailable: %s", fcst_hr, err)
        raise WeatherServiceError("Winds aloft (GFS model) unavailable from NOAA just now") from err


class FdStations(dict):
    """The winds and temperatures aloft at each station ({station_id:
    {altitude_ft: {"wind_dir_true_deg", "wind_speed_kt", "temp_c"}}}), and
    the period they are for: `period` is {"valid_at", "use_from",
    "use_to", "run", "forecast_hour"}, ISO UTC and the GFS forecast hour
    (wingtip.modelwinds.period_of)."""

    period: dict | None = None
    #: Model output, not an issued forecast: always so since the FB ended.
    modelled: bool = False


# The FD stations' own rows of the airports table, per set of station
# ids: filtering 80,000 rows for the same two hundred stations on every
# wind lookup was the other half of what a plan cost.
_STATION_ROWS: dict = {}


def _station_rows(station_ids, airports_df):
    key = (frozenset(station_ids), id(airports_df))
    rows = _STATION_ROWS.get(key)
    if rows is None:
        # local_code isn't globally unique (e.g. "MSP" also matches
        # airports in Argentina and Colombia by coincidence) -- FD
        # stations are US-only, so restrict the match accordingly.
        candidates = airports_df[airports_df["local_code"].isin(station_ids) & (airports_df["iso_country"] == "US")]
        rows = (
            candidates["local_code"].to_numpy(),
            np.radians(candidates["latitude_deg"].to_numpy(dtype=float)),
            np.radians(candidates["longitude_deg"].to_numpy(dtype=float)),
        )
        _STATION_ROWS[key] = rows
    return rows


def _nearest_station(lat: float, lon: float, station_ids, airports_df) -> str | None:
    codes, lats, lons = _station_rows(station_ids, airports_df)
    if len(codes) == 0:
        return None
    # Great-circle distance to every station at once, the same formula
    # as wingtip.geo.distance_nm; the radius cancels out of an argmin.
    lat0, lon0 = np.radians(lat), np.radians(lon)
    a = np.sin((lats - lat0) / 2) ** 2 + np.cos(lat0) * np.cos(lats) * np.sin((lons - lon0) / 2) ** 2
    return str(codes[int(np.argmin(a))])


def temperatures_aloft(lat: float, lon: float, fcst_hr: str = "06") -> list:
    """The nearest station's forecast temperatures, [(altitude_ft,
    temp_c)] from the lowest level up -- the GFS's 925 hPa, about 2,500 ft
    (wingtip.modelwinds), each at its own height. Empty where no station
    is found or it reports no temperature."""
    from . import airports

    stations = _fd_stations(fcst_hr)
    station_id = _nearest_station(lat, lon, set(stations.keys()), airports.load_airports())
    if station_id is None:
        return []
    return sorted((float(alt), v["temp_c"]) for alt, v in stations[station_id].items() if v["temp_c"] is not None)


def temperature_at(profile: list, altitude_ft: float) -> float | None:
    """The temperature at `altitude_ft` from a temperatures_aloft
    profile: interpolated between the reported altitudes either side of
    it, and past the ends the nearest one's difference from a standard
    day kept -- the standard lapse rate, all there is to go on below the
    lowest report. None for an empty profile."""
    if not profile:
        return None
    if altitude_ft <= profile[0][0] or altitude_ft >= profile[-1][0]:
        alt, temp = profile[0] if altitude_ft <= profile[0][0] else profile[-1]
        return temp + isa_temp_c(altitude_ft) - isa_temp_c(alt)
    for (alt1, t1), (alt2, t2) in pairwise(profile):
        if alt1 <= altitude_ft <= alt2:
            return t1 + (altitude_ft - alt1) / (alt2 - alt1) * (t2 - t1)
    return None


def temperature_at_altitude(lat: float, lon: float, altitude_ft: float, fcst_hr: str = "06") -> float | None:
    """The forecast temperature at `altitude_ft` near (lat, lon), from
    the nearest station (temperature_at). None where there is none: a
    standard day then, assumed rather than known."""
    return temperature_at(temperatures_aloft(lat, lon, fcst_hr), altitude_ft)


def freezing_level(lat: float, lon: float, fcst_hr: str = "06") -> dict | None:
    """Where the nearest station's forecast temperature profile crosses
    0 degC: {"ft", "at_or_below"}, by linear interpolation between the two
    bracketing reported altitudes. None if the whole reported profile
    stays above freezing (no icing concern in range) -- "no freezing
    level in range", not "unknown".

    `at_or_below` is true when it is already at or below 0 degC at the
    lowest level (the GFS's 925 hPa) -- so the freezing level is that
    altitude or lower, somewhere the data cannot say. This used to return
    the lowest altitude as though it were the freezing level and call it
    conservative, which let everything under it pass as above freezing on
    exactly the coldest days.
    """
    profile = temperatures_aloft(lat, lon, fcst_hr)
    if not profile:
        return None
    if profile[0][1] <= 0:
        return {"ft": float(profile[0][0]), "at_or_below": True}

    for (alt1, t1), (alt2, t2) in zip(profile, profile[1:]):
        if t1 > 0 and t2 <= 0:
            frac = t1 / (t1 - t2)
            return {"ft": alt1 + frac * (alt2 - alt1), "at_or_below": False}
    return None


def _interp_circular_deg(d1: float, d2: float, frac: float) -> float:
    """Interpolate a compass direction between d1 and d2 the short way
    around the circle (e.g. 350deg -> 010deg goes through 000, not back
    through 180) -- a plain linear interpolation would get that wrong.
    """
    diff = ((d2 - d1 + 180) % 360) - 180
    return (d1 + frac * diff) % 360


def winds_period(fcst_hr: str = "06") -> dict | None:
    """The period the winds a plan flies are for (FdStations.period), with
    `modelled`, for the screens to say whose winds they are: None where
    they cannot be had."""
    try:
        stations = _fd_stations(fcst_hr)
    except WeatherServiceError:
        return None
    period = getattr(stations, "period", None)
    return {**period, "modelled": stations.modelled} if period else None


def wind_at_altitude(lat: float, lon: float, altitude_ft: float, fcst_hr: str = "06") -> dict | None:
    """Wind (true direction/speed) at altitude_ft, from the nearest FD
    station's reported profile -- linearly interpolated between the two
    bracketing reported altitudes, or clamped to the nearest end if
    altitude_ft falls outside the reported range. "Light and variable"
    (direction not meaningful) reports are excluded from the profile
    rather than guessed; if that leaves no usable profile, or no station
    is found nearby, returns None -- callers should treat that as "no
    wind data available," not "calm."
    """
    from . import airports

    stations = _fd_stations(fcst_hr)
    airports_df = airports.load_airports()
    station_id = _nearest_station(lat, lon, set(stations.keys()), airports_df)
    if station_id is None:
        return None
    return wind_in_levels(stations[station_id], altitude_ft)


def wind_stations(fcst_hr: str = "06") -> tuple:
    """Every FD station's levels and where it is: (ids, lats, lons in
    degrees, [levels]) -- for reading the winds over a whole grid at once
    (wingtip.route_options), where wind_at_altitude finds the nearest station
    for one point."""
    from . import airports

    stations = _fd_stations(fcst_hr)
    codes, lats, lons = _station_rows(set(stations.keys()), airports.load_airports())
    return codes, np.degrees(lats), np.degrees(lons), [stations[str(c)] for c in codes]


def wind_in_levels(levels: dict, altitude_ft: float) -> dict | None:
    """One FD station's wind at altitude_ft from its levels ({altitude:
    {"wind_dir_true_deg", "wind_speed_kt", ...}}), as wind_at_altitude
    reads it: interpolated between the levels either side, clamped at the
    ends, light and variable left out; None with no usable level."""
    profile = sorted(
        (alt, v["wind_dir_true_deg"], v["wind_speed_kt"])
        for alt, v in levels.items()
        if v["wind_dir_true_deg"] is not None
    )
    if not profile:
        return None

    if altitude_ft <= profile[0][0]:
        _, d, s = profile[0]
        return {"wind_dir_true_deg": d, "wind_speed_kt": s}
    if altitude_ft >= profile[-1][0]:
        _, d, s = profile[-1]
        return {"wind_dir_true_deg": d, "wind_speed_kt": s}

    for (alt1, d1, s1), (alt2, d2, s2) in zip(profile, profile[1:]):
        if alt1 <= altitude_ft <= alt2:
            frac = (altitude_ft - alt1) / (alt2 - alt1) if alt2 != alt1 else 0.0
            return {
                "wind_dir_true_deg": _interp_circular_deg(d1, d2, frac),
                "wind_speed_kt": s1 + frac * (s2 - s1),
            }
    return None


# --- Every source, held by one rule ---

_DATASET_TTL_S = 300
# How old a copy may be and still be served when a refresh fails, for a
# product whose copy says nothing of its own validity (an empty set of
# advisories): what every source
# was held to before each was held to its own (2026-11-04).
_DATASET_STALE_MAX_S = 3 * 3600
# How long to wait before trying a failed refresh again -- every weather
# call during an outage must not be a fresh download attempt, with its
# own retries and time-outs. Holds whether or not a copy is being served.
_DATASET_RETRY_AFTER_S = 60
# How long a caller with no copy at all waits for someone else's download.
_DATASET_WAIT_S = 120


# --- How long each product's held copy stays good when a refresh fails ---
# Each takes the parsed copy and when it was fetched, and gives the UNIX
# time it may be served to. Worked out once, when the copy is fetched, and
# kept on its _Record: a TAF set's is a pass over every station's periods.


def _expires_at(product: str, valid_to: float | None) -> float | None:
    """When a forecast stops counting, from the end of its valid time: the
    engine's (validity.rs, `weather_expires_at`), the rule the web's and
    the phones' readers ask."""
    if valid_to is None:
        return None
    return json.loads(wingtip_native.call("weather_expires_at", json.dumps({"product": product, "valid_to": valid_to})))


def _metars_until(metars, fetched: float) -> float:
    """A METAR is an observation, not a forecast: AC 00-45H (METAR) gives
    it no period of validity, only the time it was made, and every report
    carries that time ("observed_at"), which the page shows beside it and
    the map's layer ages say how old the set is (/api/map/ages). So the
    last set heard is served however long the outage, as "the latest
    reports, made at ..." -- the owner's call of 2026-11-04 -- rather than
    none."""
    return float("inf")


def _tafs_until(stations, fetched: float) -> float:
    """A TAF is valid to the end of its valid period, 24 or 30 hours from
    issue (AC 00-45H, Terminal Aerodrome Forecast (TAF)): the set is
    served to the end of the latest period in it. Every reader takes the
    period covering the time it asks about (_current_forecast_period,
    _periods_in_window), so a station whose own TAF has run out says
    nothing rather than reading an expired forecast as current."""
    ends = [_expires_at("taf", p["timeTo"]) for s in stations for p in s.get("fcsts", ()) if p.get("timeTo") is not None]
    return max(ends) if ends else fetched + _DATASET_STALE_MAX_S


def _airsigmets_until(advisories, fetched: float) -> float:
    """A SIGMET or AIRMET is valid to the "valid until" time it is issued
    with -- up to 4 hours for a SIGMET (6 for volcanic ash or a tropical
    cyclone), 2 for a convective SIGMET, 6 for an AIRMET (AC 00-45H,
    SIGMET, Convective SIGMET and AIRMET): the set
    is served to the latest of them. hazards_along_route leaves out each
    one past its own end. A set with none in force says nothing of how
    long that holds, so is held as any other source."""
    ends = [_expires_at("advisory", a["valid_to"]) for a in advisories if a.get("valid_to") is not None]
    return max(ends) if ends else fetched + _DATASET_STALE_MAX_S


def _pireps_until(reports, fetched: float) -> float:
    """A PIREP has no period of validity (AIM chapter 7, section 1, Pilot
    Weather Reports, asks for them; AC 00-45H describes them); the
    briefing tells one for PIREP_MAX_AGE_S
    after it was made, so the set is served until its newest report is
    that old. Past then a held set would read as "no reports along the
    route" when the truth is "none could be had"."""
    observed = [r["observed"] for r in reports if r.get("observed") is not None]
    return max(observed) + PIREP_MAX_AGE_S if observed else fetched + _DATASET_STALE_MAX_S


def _gairmets_until(advisories, fetched: float) -> float:
    """A G-AIRMET is a set of snapshots, each valid at its own time, three
    hours apart out to 12 hours from issue (AC 00-45H, Graphical AIRMET
    (G-AIRMET)); the briefing tells one within GAIRMET_SNAPSHOT_S of its
    time. The set is served until its last snapshot is past that."""
    valid = [a["valid"] for a in advisories if a.get("valid") is not None]
    return max(valid) + GAIRMET_SNAPSHOT_S if valid else fetched + _DATASET_STALE_MAX_S


# Each source as a pilot knows it, for the line said when it cannot be had.
_PRODUCT_WORDS = {
    "metars": "METARs", "tafs": "TAFs", "airsigmets": "AIRMETs and SIGMETs", "pireps": "PIREPs",
    "gairmets": "G-AIRMETs",
}


# name -> (url, params, parse(response), fresh for, held_until(copy,
# fetched at) -- to when a held copy is served when a refresh fails).
_SOURCES = {
    "metars": (f"{CACHE_BASE_URL}/metars.cache.xml.gz", {},
               lambda resp: _parse_metars(gzip.decompress(resp.content)), _DATASET_TTL_S, _metars_until),
    "tafs": (f"{CACHE_BASE_URL}/tafs.cache.xml.gz", {},
             lambda resp: _parse_tafs(gzip.decompress(resp.content)), _DATASET_TTL_S, _tafs_until),
    "airsigmets": (f"{CACHE_BASE_URL}/airsigmets.cache.xml.gz", {},
                   lambda resp: _parse_airsigmets(gzip.decompress(resp.content)), _DATASET_TTL_S, _airsigmets_until),
    "pireps": (f"{CACHE_BASE_URL}/aircraftreports.cache.xml.gz", {},
               lambda resp: _parse_pireps(gzip.decompress(resp.content)), _DATASET_TTL_S, _pireps_until),
    "gairmets": (f"{CACHE_BASE_URL}/gairmets.cache.xml.gz", {},
                 lambda resp: _parse_gairmets(gzip.decompress(resp.content)), _DATASET_TTL_S, _gairmets_until),
}


class _Record(NamedTuple):
    """What is known about one source, replaced whole and never changed
    in place, so a reader needs no lock to look at it. `at` is when the
    held copy was fetched (None when there is none); `error`, the last
    attempt's failure, None once one succeeds; `validators`, the held
    copy's ETag and Last-Modified, for the next fetch to ask whether it
    has changed; `until`, the time to which the held copy may still be
    served when a refresh fails, by the product's own validity (the
    source's held_until)."""
    at: float | None
    data: object
    attempted: float
    error: WeatherServiceError | None
    validators: dict | None = None
    until: float | None = None


def _validators_of(resp) -> dict | None:
    """What to ask the next fetch with: If-None-Match and If-Modified-Since
    from the answer's ETag and Last-Modified, where it gave them."""
    headers = getattr(resp, "headers", None)
    if headers is None:
        return None
    asked = {}
    etag, modified = headers.get("ETag"), headers.get("Last-Modified")
    if isinstance(etag, str):
        asked["If-None-Match"] = etag
    if isinstance(modified, str):
        asked["If-Modified-Since"] = modified
    return asked or None


# When a request last asked for any source: the server's periodic refresh
# (refresh(), from the planner's warm-up loop) downloads them only while
# the planner is in use -- it fetched all eight every four minutes round
# the clock, nobody planning, about 300 MB a day.
_LAST_ASKED = 0.0


def in_use(within_s: float = 900) -> bool:
    """Whether a request has asked for weather in the last `within_s`."""
    return time.time() - _LAST_ASKED < within_s


_DATASETS: dict[str, _Record] = {}
_DATASET_LOCKS = {name: threading.Lock() for name in _SOURCES}
# name -> an Event set when the download in flight for it ends.
_DATASET_FETCHING: dict = {}
_DUE = object()


def _servable(record: _Record | None, now: float) -> bool:
    """Whether a record holds a copy still valid by its product's own
    rule, to be served when a refresh fails or one is in flight."""
    return record is not None and record.at is not None and record.until is not None and now < record.until


def _serve(record: _Record | None, now: float, ttl_s: float):
    """What a record can answer now: its data, the remembered failure
    (raised), or _DUE when a fetch should start."""
    if record is None:
        return _DUE
    servable = _servable(record, now)
    if record.at is not None and now - record.at < ttl_s:
        return record.data
    if now - record.attempted < _DATASET_RETRY_AFTER_S:
        if servable:
            return record.data
        if record.error is not None:
            raise record.error
    return _DUE


def _dataset(name: str, force: bool = False):
    """Source `name`, parsed, held for its own time. A refresh that fails
    keeps serving the previous copy for as long as the source allows -- a
    briefing from conditions a few minutes old beats none -- and raises
    WeatherServiceError only when there is nothing to serve; that failure
    is remembered for _DATASET_RETRY_AFTER_S, so the callers after it get
    the same answer at once rather than each running a retry cycle of
    their own. `force` fetches now whatever the held copy's age (the
    server's own periodic refresh), still falling back to it if the fetch
    fails. Only a parsed product is ever held: a body that does not parse
    is a failed fetch.

    Readers take no lock -- the record is replaced whole -- and one
    download at a time runs per source: a caller finding one in flight is
    handed the held copy, and only one with nothing to serve waits, for
    at most _DATASET_WAIT_S. The lock used to be held for the whole
    download, up to a minute and a half on a bad day, so every briefing,
    nav log and Class B marker stood in line behind the server's own
    periodic refresh."""
    url, params, parse, ttl_s, held_until = _SOURCES[name]
    if not force:
        global _LAST_ASKED
        _LAST_ASKED = time.time()
        served = _serve(_DATASETS.get(name), time.time(), ttl_s)
        if served is not _DUE:
            return served
    while True:
        with _DATASET_LOCKS[name]:
            record = _DATASETS.get(name)
            now = time.time()
            if not force:
                served = _serve(record, now, ttl_s)
                if served is not _DUE:
                    return served
            in_flight = _DATASET_FETCHING.get(name)
            if in_flight is None:
                done = threading.Event()
                _DATASET_FETCHING[name] = done
                break
            if _servable(record, now):
                return record.data
        if not in_flight.wait(timeout=_DATASET_WAIT_S):
            raise WeatherServiceError(f"aviationweather.gov {name} is still downloading")
        # Someone else's download just ended: serve what it left.
        force = False

    # Asked only if it has changed since the copy held: an unchanged one
    # (the SIGMETs and G-AIRMETs most of the time) is a 304, neither downloaded nor parsed again.
    held = record if record is not None and record.at is not None else None
    try:
        resp = _get(url, params=params, validators=held.validators if held else None)
        unchanged = held is not None and getattr(resp, "status_code", None) == 304
        data = held.data if unchanged else parse(resp)
        validators = held.validators if unchanged else _validators_of(resp)
    except (WeatherServiceError, OSError, ET.ParseError) as err:
        # The pilot reads this line (the map's problem banner, a stream's
        # last line), so it names the product in a pilot's words; the
        # cause, which only a developer can act on, goes to the log.
        log.warning("aviationweather.gov %s unavailable: %s", name, err)
        error = WeatherServiceError(f"{_PRODUCT_WORDS.get(name, name)} unavailable from aviationweather.gov just now")
        with _DATASET_LOCKS[name]:
            _DATASETS[name] = _Record(
                at=record.at if record else None, data=record.data if record else None, attempted=now, error=error,
                validators=record.validators if record else None, until=record.until if record else None,
            )
            _DATASET_FETCHING.pop(name, None)
        done.set()
        if _servable(record, now):
            log.warning("%s refresh failed (%s); serving the copy from %.0f minutes ago, valid to %s",
                        name, err, (now - record.at) / 60,
                        datetime.fromtimestamp(record.until, timezone.utc).isoformat()
                        if record.until != float("inf") else "its reports' own times")
            return record.data
        raise error from err
    try:
        until = held_until(data, now)
    except (KeyError, TypeError, ValueError):
        # A copy whose validity cannot be read is held as long as one that
        # does not say.
        until = now + _DATASET_STALE_MAX_S
    with _DATASET_LOCKS[name]:
        _DATASETS[name] = _Record(at=now, data=data, attempted=now, error=None, validators=validators, until=until)
        _DATASET_FETCHING.pop(name, None)
    done.set()
    return data


def dataset_status() -> dict[str, float | None]:
    """When each source's held copy was fetched, None for one not held --
    what the Dev console (/api/status) and the map's layer ages
    (/api/map/ages) show as the weather's age. A copy served on through
    an outage keeps its own fetch time, so the age said grows with it. The
    winds aloft, the GFS's (wingtip.modelwinds), are "winds-06", "winds-12"
    and "winds-24", by period."""
    from . import modelwinds

    out = {name: (record.at if (record := _DATASETS.get(name)) else None) for name in _SOURCES}
    for hr in modelwinds.PERIODS:
        held = modelwinds.held(hr)
        out[f"winds-{hr}"] = held[0] if held else None
    return out


def sources_status() -> list[dict]:
    """Each aviationweather.gov source as the pilot's Status page lists
    it: its name in a pilot's words, when the copy held was fetched, to
    when that copy may still be served (its product's own validity, the
    record's `until`), and whether the last ask for a newer one failed --
    the planner then serving the held copy on (UNIX seconds; None where
    there is none)."""
    out = []
    for name in _SOURCES:
        record = _DATASETS.get(name)
        out.append({
            "name": _PRODUCT_WORDS.get(name, name),
            "fetched_at": record.at if record else None,
            # No limit (METARs, each carrying its own time) is None.
            "kept_until": record.until if record and record.until != float("inf") else None,
            "failing": bool(record and record.error is not None),
        })
    from . import modelwinds

    # The winds aloft, the GFS's, each period held to the end of its own
    # window (wingtip.modelwinds).
    for hr in modelwinds.PERIODS:
        held = modelwinds.held(hr)
        out.append({
            "name": f"Winds aloft, modelled (GFS), {int(hr)}-hour",
            "fetched_at": held[0] if held else None,
            "kept_until": _unix(held[1]["use_to"]) if held else None,
            "failing": modelwinds.failing(hr),
        })
    return out


def _float(text: str | None) -> float | None:
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _int(text: str | None) -> int | None:
    try:
        return int(text)
    except (TypeError, ValueError):
        return None


def _unix(iso: str | None) -> float | None:
    """2026-09-20T01:41:00.000Z -> seconds since the epoch."""
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _period(el) -> dict:
    """A METAR, or one TAF forecast period, as the {"clouds", "visib",
    "vert_vis"} shape _ceiling_ft/_visibility_sm read."""
    return {
        "clouds": [
            {"cover": sc.get("sky_cover"), "base": _int(sc.get("cloud_base_ft_agl"))}
            for sc in el.findall("sky_condition")
        ],
        "visib": el.findtext("visibility_statute_mi"),
        "vert_vis": _int(el.findtext("vert_vis_ft")),
    }


def _sky_ceiling(period: dict) -> tuple[float | None, bool]:
    """The ceiling and whether it is not known: the lowest broken,
    overcast or obscured layer -- FEW/SCT don't count as a ceiling by the
    FAA's own definition (14 CFR 1.1) -- an obscured sky's at its vertical
    visibility: the engine's (metar.rs `sky_ceiling_of`, its
    `sky_ceiling`). The feed marks an obscured layer `OVX`, with the
    height as the layer's base in a METAR and only as `vert_vis_ft` in a
    TAF.

    A layer the station could not measure ("OVC///", "VV///") comes in
    the AWC's data API with no base (its `sky_condition` has no
    `cloud_base_ft_agl`; the JSON gives `"base": null`). Where that is
    the lowest broken, overcast or obscured layer the ceiling is not
    known -- it could be on the ground -- so it is (None, True), never
    (None, False), which would read as no ceiling at all and let an
    "OVC/// 10SM" station pass as VFR."""
    layers = [{"cover": c.get("cover"), "base_ft": c.get("base")} for c in period.get("clouds", [])]
    found = json.loads(wingtip_native.call("sky_ceiling", json.dumps({"layers": layers, "vert_vis_ft": period.get("vert_vis")})))
    ceiling = found["ceiling_ft"]
    # A base as the feed gives it, whole feet.
    return (int(ceiling) if isinstance(ceiling, float) and ceiling.is_integer() else ceiling), found["ceiling_unknown"]


def _ceiling_ft(period: dict) -> float | None:
    """The ceiling (_sky_ceiling), None where there is none or it is not
    known."""
    return _sky_ceiling(period)[0]


def _report_category(ceiling_ft: float | None, ceiling_unknown: bool, visibility_sm: float | None) -> str | None:
    """A report's flight category, the engine's (AC 00-45H; metar.rs
    `flight_category_of`): with the ceiling not known only what the
    visibility settles -- LIFR under a mile -- else None."""
    return json.loads(wingtip_native.call("report_flight_category", json.dumps(
        {"ceiling_ft": ceiling_ft, "ceiling_unknown": ceiling_unknown, "visibility_sm": visibility_sm})))


def _visibility_sm(period: dict) -> float | None:
    visib = period.get("visib")
    if visib is None:
        return None
    try:
        return float(str(visib).rstrip("+"))
    except ValueError:
        return None


# --- METAR ---


def _parse_metars(xml_bytes: bytes) -> dict:
    """{station_id: report} -- the newest report per station in the file."""
    latest: dict = {}
    for el in ET.fromstring(xml_bytes).iter("METAR"):
        ident = el.findtext("station_id")
        if not ident:
            continue
        observed = el.findtext("observation_time") or ""
        if ident in latest and latest[ident][0] >= observed:
            continue
        period = _period(el)
        ceiling, ceiling_unknown = _sky_ceiling(period)
        visibility = _visibility_sm(period)
        category = el.findtext("flight_category")
        if ceiling_unknown:
            # The AWC's own category takes a layer it has no height for as
            # no ceiling, and calls "OVC/// 10SM" VFR; the ceiling is not
            # known (14 CFR 1.1), so the category is only what the
            # visibility settles.
            category = _report_category(None, True, visibility)
        latest[ident] = (observed, {
            "raw": el.findtext("raw_text"),
            # When the report was made, so a page can say how old it is:
            # the server keeps serving a copy for hours when a refresh
            # fails, and a colour alone says nothing about its age.
            "observed_at": observed or None,
            "flight_category": category,
            # The weather itself, "-TSRA BR", as reported: a thunderstorm
            # at or near the field (TS, VCTS) is one to keep away from
            # (wingtip.route_options).
            "wx": el.findtext("wx_string") or "",
            "ceiling_ft": ceiling,
            # A broken or overcast layer reported with no height is the
            # lowest: the ceiling is not known, not absent (_sky_ceiling).
            "ceiling_unknown": ceiling_unknown,
            "visibility_sm": visibility,
            # "VRB" is a direction the arithmetic can't use.
            "wind_dir_true_deg": _float(el.findtext("wind_dir_degrees")),
            "wind_speed_kt": _float(el.findtext("wind_speed_kt")),
            "wind_gust_kt": _float(el.findtext("wind_gust_kt")),
            "altimeter_in_hg": _float(el.findtext("altim_in_hg")),
            "temp_c": _float(el.findtext("temp_c")),
            "dewpoint_c": _float(el.findtext("dewpoint_c")),
            # Where the station is, for a field with no report of its own
            # (nearest_report).
            "lat": _float(el.findtext("latitude")),
            "lon": _float(el.findtext("longitude")),
        })
    return {ident: report for ident, (_, report) in latest.items()}


def reporting_idents() -> set:
    """Every station with a current METAR -- the fields a map can colour
    by their weather."""
    return set(_dataset("metars"))


def metar_for_idents(idents: list) -> dict:
    """{ident: {...}} for the latest METAR at each ident, or {ident: None}
    for one with nothing current (a small field with no reporting
    station)."""
    metars = _dataset("metars")
    return {ident: metars.get(ident) for ident in idents}


METAR_URL = "https://aviationweather.gov/api/data/metar"
#: How far back a field's own METARs are read for the last wind it had, h.
RECENT_WIND_HOURS = 3
#: How long a field's last wind is kept, s: METARs come hourly.
RECENT_WIND_TTL_S = 600.0
_RECENT_WIND: dict[str, tuple[float, dict | None]] = {}


def recent_wind(ident: str) -> dict | None:
    """The wind of the newest of a field's own METARs of the last
    RECENT_WIND_HOURS with a direction and some speed, {"wind_dir_true_deg",
    "wind_speed_kt"}: the runway it favoured is the one in use when the wind
    has since dropped calm (wingtip.runway_wind.favoured_end), at the owner's
    ask ("when winds are calm just pick the currently used ... runway"). A
    design choice: a tower keeps its runway as the wind goes calm, and none
    of the FAA's data sets says a field's calm-wind runway. None with no
    such report, or the reports not to be had."""
    now = time.time()
    held = _RECENT_WIND.get(ident)
    if held and now - held[0] < RECENT_WIND_TTL_S:
        return held[1]
    try:
        resp = requests.get(METAR_URL, params={"ids": ident, "hours": RECENT_WIND_HOURS, "format": "json"},
                            headers=HEADERS, timeout=10)
        resp.raise_for_status()
        reports = resp.json() or []
    except (requests.RequestException, ValueError):
        return None
    found = None
    for report in sorted(reports, key=lambda r: r.get("obsTime") or 0, reverse=True):
        direction, speed = report.get("wdir"), report.get("wspd")
        if isinstance(direction, (int, float)) and isinstance(speed, (int, float)) and speed > 0:
            found = {"wind_dir_true_deg": float(direction), "wind_speed_kt": float(speed)}
            break
    if len(_RECENT_WIND) > 512:
        _RECENT_WIND.clear()
    _RECENT_WIND[ident] = (now, found)
    return found


#: How far a station's report is said of a field, approximately: a design
#: choice, not a rule. AC 00-45H (Aviation Weather Services) takes a METAR's
#: "VC" to be 5 to 10 statute miles from the station for the phenomena it
#: reports, and does not say a station's flight category holds at another
#: field; the top of that range is where the card's "≈" chip stops, and
#: farther only the report and how far it is are given.
NEAR_REPORT_SM = 10.0
#: The oldest report given as the nearest: METARs come hourly, so this
#: allows one missed cycle; the server keeps a held copy for hours when a
#: refresh fails, and an older report is not "current".
NEAREST_REPORT_MAX_AGE_S = 2 * 3600
#: How far the nearest report is looked for at all, as an EFB lists a
#: field's nearest METAR: about a quarter hour's flight in a light
#: airplane.
NEAREST_REPORT_NM = 30.0
_NM_PER_SM = 0.868976


def nearest_report(lat: float, lon: float, exclude: str | None = None, within_nm: float = NEAREST_REPORT_NM) -> dict | None:
    """The nearest station with a current METAR within `within_nm` of a
    point, for a field with no report of its own, as {"ident",
    "distance_nm", "bearing_deg" (true, from the point), "near" (within
    NEAR_REPORT_SM, close enough to say the field's weather by it,
    approximately), "metar"}; None with none that close."""
    best = None
    coslat = np.cos(np.radians(lat))
    for ident, report in _dataset("metars").items():
        s_lat, s_lon = report.get("lat"), report.get("lon")
        if ident == exclude or s_lat is None or s_lon is None:
            continue
        # Before the distance test, so an old near station does not hide a
        # current farther one; a report with no readable time is not known
        # to be current.
        observed = _unix(report.get("observed_at"))
        if observed is None or time.time() - observed > NEAREST_REPORT_MAX_AGE_S:
            continue
        # Flat-earth nautical miles: within thirty the error is yards.
        north, east = (s_lat - lat) * 60, (s_lon - lon) * 60 * coslat
        nm = float(np.hypot(north, east))
        if nm <= within_nm and (best is None or nm < best[0]):
            best = (nm, ident, report, float(np.degrees(np.arctan2(east, north))) % 360)
    if best is None:
        return None
    nm, ident, report, bearing = best
    return {
        "ident": ident, "distance_nm": round(nm, 1), "bearing_deg": round(bearing),
        "near": nm <= NEAR_REPORT_SM * _NM_PER_SM, "metar": report,
    }


# --- Ceiling/visibility, from the TAFs ---

# Within one start time, the base forecast (FM, or the TAF's own first
# line) sorts first; BECMG/TEMPO/PROB lines modify it.
_CHANGE_ORDER = {"": 0, "FM": 0, "BECMG": 1, "TEMPO": 2, "PROB": 3}


def _parse_tafs(xml_bytes: bytes) -> list:
    """[{"icaoId", "lat", "lon", "elevation_ft", "fcsts": [...]}] -- one
    entry per station, its latest issue, periods in time order with the
    base forecast first. The field's elevation turns a ceiling, which a
    TAF gives above the field, into the altitude a pilot keeps below it
    (wingtip.altitude's cloud clearance)."""
    latest: dict = {}
    for el in ET.fromstring(xml_bytes).iter("TAF"):
        ident = el.findtext("station_id")
        lat, lon = _float(el.findtext("latitude")), _float(el.findtext("longitude"))
        if not ident or lat is None or lon is None:
            continue
        issued = el.findtext("issue_time") or ""
        if ident in latest and latest[ident][0] >= issued:
            continue
        fcsts = []
        for forecast in el.findall("forecast"):
            start, end = _unix(forecast.findtext("fcst_time_from")), _unix(forecast.findtext("fcst_time_to"))
            if start is None or end is None:
                continue
            fcsts.append({
                "timeFrom": start, "timeTo": end,
                "change": forecast.findtext("change_indicator") or "",
                **_period(forecast),
                # The weather forecast, "TSRA", "VCTS": thunderstorms in a
                # period are one to keep away from (wingtip.route_options).
                "wx": forecast.findtext("wx_string") or "",
                # Its wind, from true north as a TAF gives it (AC 00-45H,
                # the TAF; a METAR's too), for the runway a flight will
                # find in use when it gets there. VRB has no direction.
                "wind_dir_true_deg": _float(forecast.findtext("wind_dir_degrees")),
                "wind_speed_kt": _float(forecast.findtext("wind_speed_kt")),
                "wind_gust_kt": _float(forecast.findtext("wind_gust_kt")),
            })
        fcsts.sort(key=lambda p: (p["timeFrom"], _CHANGE_ORDER.get(p["change"][:5], 3)))
        elevation_m = _float(el.findtext("elevation_m"))
        latest[ident] = (issued, {
            "icaoId": ident, "lat": lat, "lon": lon,
            "elevation_ft": None if elevation_m is None else round(elevation_m * M_TO_FT),
            # The forecast as issued. The derived ceiling and visibility
            # below are what a go/no-go reads; the text is what a pilot
            # reads, and only one of the two can be shown on a phone.
            "raw": el.findtext("raw_text"),
            "fcsts": fcsts,
        })
    return [station for _, station in latest.values()]


def taf_for_idents(idents: list) -> dict:
    """{ident: {...}} for the current forecast period at each ident, or
    {ident: None} where no TAF is issued -- most fields have none.

    The mirror of metar_for_idents, and read the same way: the METAR is
    what it is doing now, this is what it is forecast to do. Both come
    out of the national cache files already in memory, so asking for
    thirty stations costs no more than asking for one.
    """
    wanted = {i.upper() for i in idents}
    now = time.time()
    stations = {
        s["icaoId"]: s for s in _dataset("tafs") if s["icaoId"] in wanted
    }
    answer = {}
    for ident in idents:
        station = stations.get(ident.upper())
        period = _current_forecast_period(station["fcsts"], now) if station else None
        worst = _worst_in_window(station["fcsts"], now, now) if station else None
        answer[ident] = None if station is None else {
            "raw": station.get("raw"),
            "ceiling_ft": worst["ceiling_ft"] if worst else None,
            "ceiling_unknown": bool(worst and worst["ceiling_unknown"]),
            "visibility_sm": worst["visibility_sm"] if worst else None,
            "change": (period or {}).get("change") or "",
            "valid_from": (period or {}).get("timeFrom"),
            "valid_to": (period or {}).get("timeTo"),
        }
    return answer


def forecast_wind(lat: float, lon: float, at_unix: float, ident: str | None = None,
                  within_nm: float = NEAREST_REPORT_NM) -> dict | None:
    """The wind forecast at a field for a time, from its own TAF (`ident`)
    or else the nearest station's within `within_nm` -- the reach the card
    takes a nearby METAR from (nearest_report) -- as {"ident",
    "distance_nm", "dir_true_deg" (None for VRB), "speed_kt", "gust_kt",
    "valid_from", "valid_to"}: the prevailing forecast then, the base or
    FM period covering it, or a BECMG that has begun by then (it lasts to
    the next change), never a TEMPO or PROB group. None where no TAF in
    reach covers that time, or the forecast gives no wind then."""
    stations = _dataset("tafs")
    own = next((s for s in stations if ident and s["icaoId"] == ident.upper()), None)
    if own is not None:
        best = (0.0, own)
    else:
        best = None
        coslat = np.cos(np.radians(lat))
        for station in stations:
            nm = float(np.hypot((station["lat"] - lat) * 60, (station["lon"] - lon) * 60 * coslat))
            if nm <= within_nm and (best is None or nm < best[0]):
                best = (nm, station)
    if best is None:
        return None
    nm, station = best
    prevailing = [
        p for p in station["fcsts"]
        if p["timeFrom"] <= at_unix and (
            (p["change"][:5] in ("", "FM") and at_unix < p["timeTo"]) or p["change"][:5] == "BECMG")
    ]
    if not prevailing or not any(p["timeFrom"] <= at_unix < p["timeTo"] for p in station["fcsts"]):
        return None
    period = max(prevailing, key=lambda p: p["timeFrom"])
    if period.get("wind_speed_kt") is None:
        return None
    return {
        "ident": station["icaoId"], "distance_nm": round(nm, 1),
        "dir_true_deg": period.get("wind_dir_true_deg"), "speed_kt": period["wind_speed_kt"],
        "gust_kt": period.get("wind_gust_kt"), "valid_from": period["timeFrom"], "valid_to": period["timeTo"],
    }


def _current_forecast_period(fcsts: list, now_unix: float) -> dict | None:
    """The base period covering `now_unix`, or None when the TAF has none
    covering it -- expired, or not valid yet. It used to fall back to the
    first period, which read an expired forecast as the current one."""
    for period in fcsts:
        if period["timeFrom"] <= now_unix < period["timeTo"]:
            return period
    return None


def _periods_in_window(fcsts: list, start: float, end: float) -> list:
    """Every period that says something about [start, end]: the base
    periods and TEMPO/PROB groups overlapping it, and a BECMG group that
    began before its end -- a BECMG's change lasts past its own window,
    to the next FM, and the feed carries no base period after it."""
    overlapping = [p for p in fcsts if p["timeFrom"] <= end and p["timeTo"] > start]
    bases = [p for p in overlapping if (p.get("change") or "")[:5] in ("", "FM")]
    since = min((p["timeFrom"] for p in bases), default=start)
    becoming = [
        p for p in fcsts
        if (p.get("change") or "").startswith("BECMG") and since <= p["timeFrom"] <= end and p not in overlapping
    ]
    return overlapping + becoming


def _worst_in_window(fcsts: list, start: float, end: float) -> dict | None:
    """The lowest ceiling and visibility the TAF forecasts anywhere in
    [start, end], TEMPO and PROB groups included: a go/no-go read is the
    worst the forecast allows, and taking only the base forecast let
    `TEMPO 1/2SM FG` read as VFR. None when the TAF says nothing about
    the window at all. `ceiling_unknown` where any period forecasts a
    ceiling with no height (_sky_ceiling): the lowest known ceiling is
    then not the worst the forecast allows."""
    periods = _periods_in_window(fcsts, start, end)
    if not periods:
        return None
    skies = [_sky_ceiling(p) for p in periods]
    ceilings = [c for c, _ in skies if c is not None]
    visibilities = [v for v in (_visibility_sm(p) for p in periods) if v is not None]
    return {
        "ceiling_ft": min(ceilings) if ceilings else None,
        "ceiling_unknown": any(unknown for _, unknown in skies),
        "visibility_sm": min(visibilities) if visibilities else None,
    }


def ceiling_visibility_along_route(
    route_start: tuple, route_end: tuple, corridor_buffer_nm: float = 10.0, window: tuple | None = None,
) -> dict:
    """Lowest forecast ceiling/visibility among TAF stations near the
    route, over `window` -- (start, end) in unix seconds, the flight from
    departure to arrival; now when not given -- TEMPO and PROB groups
    included (see _worst_in_window). A station whose TAF says nothing
    about the window is left out rather than read at some other time.
    It used to read every TAF at the moment of asking, so a plan for
    tomorrow morning paired tomorrow's winds with today's ceilings. TAFs are only
    issued for towered/larger airports, so this searches a wider
    corridor (corridor_buffer_nm) than the tight pilotage corridor used
    elsewhere in this project -- a small departure/destination field
    often has no TAF of its own at all.

    Returns {"min_ceiling_ft", "min_visibility_sm", "ceiling_unknown_at",
    "stations"} -- the first two are the worst (most restrictive) values
    found nearby, for a conservative go/no-go read; "ceiling_unknown_at"
    the stations forecasting a ceiling with no height, where the worst is
    not known (_sky_ceiling); "stations" is the per-station detail,
    where each is and its field's elevation with its own worst ceiling
    and visibility, which wingtip.altitude keeps each leg's altitudes under
    the clouds with (14 CFR 91.155).
    """
    from .geo import corridor_bbox

    min_lat, min_lon, max_lat, max_lon = corridor_bbox(route_start, route_end, corridor_buffer_nm)
    stations = [
        # The held copy: a second argument here was `force`, and with the
        # parser passed as it every call downloaded and parsed the whole
        # TAF set again -- 0.9 s of every briefing and altitude plan.
        s for s in _dataset("tafs")
        if min_lat <= s["lat"] <= max_lat and min_lon <= s["lon"] <= max_lon
    ]

    start, end = window if window else (time.time(), time.time())
    per_station, ceilings, visibilities, unknown_at = [], [], [], []
    for station in stations:
        worst = _worst_in_window(station["fcsts"], start, end)
        if worst is None:
            continue
        ceiling = worst["ceiling_ft"]
        visibility = worst["visibility_sm"]
        per_station.append({
            "icaoId": station["icaoId"], "lat": station["lat"], "lon": station["lon"],
            "elevation_ft": station.get("elevation_ft"), "ceiling_ft": ceiling,
            "ceiling_unknown": worst["ceiling_unknown"], "visibility_sm": visibility,
        })
        if worst["ceiling_unknown"]:
            unknown_at.append(station["icaoId"])
        if ceiling is not None:
            ceilings.append(ceiling)
        if visibility is not None:
            visibilities.append(visibility)

    return {
        "min_ceiling_ft": min(ceilings) if ceilings else None,
        "min_visibility_sm": min(visibilities) if visibilities else None,
        "ceiling_unknown_at": unknown_at,
        "stations": per_station,
    }


def tafs_over(windows: dict) -> dict:
    """Each station's TAF read over a window of its own -- {icaoId:
    (start, end)} in unix seconds, around when the flight gets there --
    as {icaoId: {"ceiling_ft", "ceiling_unknown", "visibility_sm", "raw"}}: the worst it
    forecasts then (TEMPO and PROB groups included, as _worst_in_window
    reads them) and the forecast as issued. The route's forecast reads
    every station over the whole flight, the right read for go/no-go; a
    pilot reading one place wants it for when they are there. Figures
    None where the TAF says nothing about its window; a station with no
    TAF held is left out."""
    if not windows:
        return {}
    found = {}
    for station in _dataset("tafs"):
        window = windows.get(station["icaoId"])
        if window is None:
            continue
        worst = _worst_in_window(station["fcsts"], *window) or {
            "ceiling_ft": None, "ceiling_unknown": False, "visibility_sm": None}
        found[station["icaoId"]] = {**worst, "raw": station.get("raw")}
    return found


# --- Go/no-go: the basic VFR weather minimums ---

# 14 CFR 91.155(c) and (d): below a 1,000 ft ceiling or 3 statute miles'
# visibility in a surface area of controlled airspace,
# VFR flight is not the default answer. The figures are the engine's
# (rules.rs, `vfr_basic_minimums`); wingtip.altitude's go/no-go flag, the
# briefing's "VFR flight not recommended" and the route options all read
# them from here, and the page shows what they decided.
_VFR_MINIMUMS = json.loads(wingtip_native.call("vfr_basic_minimums", "{}"))
VFR_MIN_CEILING_FT = int(_VFR_MINIMUMS["ceiling_ft"])
VFR_MIN_VISIBILITY_SM = int(_VFR_MINIMUMS["visibility_sm"])


def below_vfr_minimums(ceiling_ft: float | None, visibility_sm: float | None) -> bool:
    """Whether either figure is under 14 CFR 91.155's basic minimums. A
    missing figure is not below anything: unknown is reported as
    unknown by the caller, not decided here."""
    return (ceiling_ft is not None and ceiling_ft < VFR_MIN_CEILING_FT) or (
        visibility_sm is not None and visibility_sm < VFR_MIN_VISIBILITY_SM
    )


def vfr_not_recommended_reasons(idents: list, metars: dict, forecast: dict) -> list[str]:
    """"VFR flight not recommended" -- its own named element of an FAA
    standard briefing (AIM 7-1-5), stated plainly whenever conditions
    warrant it -- as the reasons, in briefing order: either end of the
    route currently reporting IFR or LIFR, then the along-route forecast
    ceiling or visibility under the basic VFR minimums. `metars` is
    metar_for_idents()'s answer, `forecast`
    ceiling_visibility_along_route()'s. Empty when nothing warrants it.

    A ceiling reported or forecast with no height ("OVC///") is said too:
    it could be at any height, the ground included, which is a condition
    that makes VFR flight doubtful (AIM 7-1-5), and saying nothing would
    pass it as no ceiling."""
    reasons = []
    for ident in idents:
        metar = metars.get(ident) or {}
        category = metar.get("flight_category")
        if category in ("IFR", "LIFR"):
            reasons.append(f"{ident} currently reporting {category}")
        elif metar.get("ceiling_unknown"):
            reasons.append(f"{ident} currently reporting a ceiling of unknown height")
    ceiling, visibility = forecast.get("min_ceiling_ft"), forecast.get("min_visibility_sm")
    if ceiling is not None and ceiling < VFR_MIN_CEILING_FT:
        reasons.append(f"forecast ceiling as low as {ceiling:,.0f} ft along the route")
    unknown_at = forecast.get("ceiling_unknown_at") or []
    if unknown_at:
        reasons.append(f"forecast ceiling of unknown height at {', '.join(unknown_at)}")
    if visibility is not None and visibility < VFR_MIN_VISIBILITY_SM:
        reasons.append(f"forecast visibility as low as {visibility:g} sm along the route")
    return reasons


# --- SIGMET hazards ---


#: A bulletin's WMO abbreviated heading, "WSUS32 KKCI 261655": its last
#: group, YYGGgg, is the day of the month, hour and minute (UTC) it was
#: issued (WMO-No. 386, Manual on the Global Telecommunication System,
#: Attachment II-5). The SIGMET file gives no issue time of its own.
_WMO_HEADING = re.compile(r"\b[A-Z]{4}\d{2}\s+[A-Z]{4}\s+(\d{2})(\d{2})(\d{2})\b")


def _wmo_issued(raw: str | None, near: float | None) -> str | None:
    """When a bulletin was issued (ISO UTC), from its WMO heading's
    day-hour-minute, put in the month of `near` (its valid time, UNIX
    seconds) -- or the month before, for a heading of the 31st read on
    the 1st. None where the text has no heading."""
    m = _WMO_HEADING.search(raw or "")
    if not m or near is None:
        return None
    day, hour, minute = (int(g) for g in m.groups())
    base = datetime.fromtimestamp(near, timezone.utc)
    for months_back in (0, 1):
        year, month = base.year, base.month - months_back
        if month == 0:
            year, month = year - 1, 12
        try:
            issued = datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
        except ValueError:
            continue
        if issued.timestamp() <= near + 86400:
            return issued.isoformat().replace("+00:00", "Z")
    return None


def _parse_airsigmets(xml_bytes: bytes) -> list:
    advisories = []
    for el in ET.fromstring(xml_bytes).iter("AIRSIGMET"):
        altitude, hazard = el.find("altitude"), el.find("hazard")
        points = [(_float(p.findtext("latitude")), _float(p.findtext("longitude"))) for p in el.iter("point")]
        advisories.append({
            "hazard": hazard.get("type") if hazard is not None else None,
            "type": el.findtext("airsigmet_type"),
            "altitude_low_ft": _float(altitude.get("min_ft_msl")) if altitude is not None else None,
            "altitude_high_ft": _float(altitude.get("max_ft_msl")) if altitude is not None else None,
            "raw": el.findtext("raw_text"),
            "valid_from": _unix(el.findtext("valid_time_from")),
            "valid_to": _unix(el.findtext("valid_time_to")),
            "issued": _wmo_issued(el.findtext("raw_text"), _unix(el.findtext("valid_time_from"))),
            "coords": [(lat, lon) for lat, lon in points if lat is not None and lon is not None],
        })
    return advisories


def hazards_along_route(route_start: tuple, route_end: tuple, corridor_buffer_nm: float = 25.0) -> list:
    """SIGMETs whose hazard polygon the route line actually crosses, among
    those valid right now. The bbox is a coarse prefilter (convective
    SIGMETs commonly span several states); the real filter is the
    route/polygon intersection. CONUS AIRMETs were discontinued in
    January 2025 in favour of G-AIRMETs: gairmet_snapshots_along_route reads them.
    Each keeps its valid times ("valid_from", "valid_to"; UNIX seconds),
    when it was issued ("issued") and its area ("coords", [(lat, lon)]),
    for the briefing to say where and when the flight meets it.
    """
    from shapely.geometry import LineString, Polygon

    from .geo import corridor_bbox

    min_lat, min_lon, max_lat, max_lon = corridor_bbox(route_start, route_end, corridor_buffer_nm)
    now = time.time()
    route_line = LineString([(route_start[1], route_start[0]), (route_end[1], route_end[0])])
    hits = []
    for advisory in _dataset("airsigmets"):
        if advisory["valid_to"] is not None and advisory["valid_to"] <= now:
            continue
        if advisory["valid_from"] is not None and advisory["valid_from"] > now:
            continue
        coords = advisory["coords"]
        if len(coords) < 3:
            continue
        lats, lons = [lat for lat, _ in coords], [lon for _, lon in coords]
        if max(lats) < min_lat or min(lats) > max_lat or max(lons) < min_lon or min(lons) > max_lon:
            continue
        polygon = Polygon([(lon, lat) for lat, lon in coords])
        if not polygon.is_valid:
            polygon = polygon.buffer(0)
        if route_line.intersects(polygon):
            hits.append({key: advisory.get(key) for key in (
                "hazard", "type", "altitude_low_ft", "altitude_high_ft", "raw", "valid_from", "valid_to", "issued", "coords")})
    return hits


# --- PIREPs ---

#: How old a PIREP is still told: the conditions it reports move on.
PIREP_MAX_AGE_S = 90 * 60
#: The highest a PIREP is told for: a light aeroplane's sky, not the
#: airliners' reports from the flight levels.
PIREP_MAX_ALT_FT = 18000.0
#: How far either side of the route a PIREP is told.
PIREP_CORRIDOR_NM = 30.0


def _parse_pireps(xml_bytes: bytes) -> list:
    """The pilot reports in the aircraft reports file -- routine and urgent
    (UUA) -- leaving out the AIREPs, airliners' position reports from the
    ocean routes, which are most of it."""
    reports = []
    for el in ET.fromstring(xml_bytes).iter("AircraftReport"):
        kind = el.findtext("report_type") or ""
        if "PIREP" not in kind:
            continue
        lat, lon = _float(el.findtext("latitude")), _float(el.findtext("longitude"))
        if lat is None or lon is None:
            continue
        turbulence = [t.get("turbulence_intensity") for t in el.iter("turbulence_condition") if t.get("turbulence_intensity")]
        icing = [i.get("icing_intensity") for i in el.iter("icing_condition") if i.get("icing_intensity")]
        reports.append({
            "observed_at": el.findtext("observation_time"),
            "observed": _unix(el.findtext("observation_time")),
            "lat": lat, "lon": lon,
            "altitude_ft": _float(el.findtext("altitude_ft_msl")),
            "aircraft": el.findtext("aircraft_ref"),
            "urgent": kind.startswith("Urgent"),
            "turbulence": turbulence[0] if turbulence else None,
            "icing": icing[0] if icing else None,
            "raw": el.findtext("raw_text"),
        })
    return reports


def pireps_along_route(path: list, corridor_nm: float = PIREP_CORRIDOR_NM) -> list:
    """The pilot reports of the last PIREP_MAX_AGE_S within `corridor_nm`
    of the route flown through `path` [(lat, lon)], at or under
    PIREP_MAX_ALT_FT, in along-route order, urgent ones first: each
    {"observed_at", "lat", "lon", "altitude_ft", "aircraft", "urgent",
    "turbulence", "icing", "raw", "along_track_nm"}."""
    from .geo import along_track_distance_nm, cross_track_distance_nm, distance_nm

    now = time.time()
    found = []
    for report in _dataset("pireps"):
        if report["observed"] is None or now - report["observed"] > PIREP_MAX_AGE_S:
            continue
        if report["altitude_ft"] is not None and report["altitude_ft"] > PIREP_MAX_ALT_FT:
            continue
        nearest = None
        offset = 0.0
        for a, b in pairwise(path):
            along = along_track_distance_nm(report["lat"], report["lon"], a, b)
            leg_nm = distance_nm(*a, *b)
            beside = abs(cross_track_distance_nm(report["lat"], report["lon"], a, b)) <= corridor_nm
            if -corridor_nm <= along <= leg_nm + corridor_nm and beside:
                nearest = offset + max(0.0, min(along, leg_nm))
                break
            offset += leg_nm
        if nearest is None:
            continue
        found.append({**{k: v for k, v in report.items() if k != "observed"}, "along_track_nm": round(nearest, 1)})
    return sorted(found, key=lambda r: (not r["urgent"], r["along_track_nm"]))


# --- G-AIRMETs ---

#: The G-AIRMET hazards a VFR flight is told of, in words. High-level
#: turbulence (TURB-HI, above FL180) and the freezing-level contours are
#: not: the one is above it, the others lines, not areas.
GAIRMET_HAZARDS = {
    "IFR": "IFR conditions",
    "MT_OBSC": "Mountains obscured",
    "TURB-LO": "Turbulence",
    "ICE": "Icing",
    "LLWS": "Low-level wind shear",
    "SFC_WND": "Strong surface winds",
}
#: A G-AIRMET is a snapshot valid at its time, three hours apart: one is
#: told when it is valid within this of some time of the flight.
GAIRMET_SNAPSHOT_S = 90 * 60


def _parse_gairmets(xml_bytes: bytes) -> list:
    advisories = []
    for el in ET.fromstring(xml_bytes).iter("GAIRMET"):
        hazard = el.find("hazard")
        kind = hazard.get("type") if hazard is not None else None
        if kind not in GAIRMET_HAZARDS or el.findtext("geometry_type") != "AREA":
            continue
        altitude = el.find("altitude")
        low = altitude.get("min_ft_msl") if altitude is not None else None
        points = [(_float(p.findtext("latitude")), _float(p.findtext("longitude"))) for p in el.iter("point")]
        advisories.append({
            "hazard": GAIRMET_HAZARDS[kind],
            "severity": (hazard.get("severity") or None) if hazard is not None else None,
            "due_to": el.findtext("due_to"),
            "valid_at": el.findtext("valid_time"),
            "valid": _unix(el.findtext("valid_time")),
            "issued": el.findtext("issue_time") or None,
            # "FZL": from the freezing level, which the advisory gives
            # beside it.
            "altitude_low_ft": None if low in (None, "", "FZL", "SFC") else _float(low),
            "from_freezing_level": low == "FZL",
            "altitude_high_ft": _float(altitude.get("max_ft_msl")) if altitude is not None else None,
            "coords": [(lat, lon) for lat, lon in points if lat is not None and lon is not None],
        })
    return advisories


def gairmet_snapshots_along_route(path: list, window: tuple) -> list:
    """Every G-AIRMET snapshot (IFR, mountain obscuration, low-level
    turbulence, icing, wind shear, strong surface winds) whose area the
    route flown through `path` [(lat, lon)] crosses, valid at some time of
    the flight `window` (start, end; UNIX seconds) give or take
    GAIRMET_SNAPSHOT_S: _parse_gairmets' dicts, with their "valid" (UNIX
    seconds) and their area ("coords"), for the briefing to pick each
    hazard's snapshot for when the flight is in it."""
    from shapely.geometry import LineString, Polygon

    line = LineString([(lon, lat) for lat, lon in path])
    start, end = window
    found = []
    for advisory in _dataset("gairmets"):
        valid = advisory["valid"]
        if valid is None or valid < start - GAIRMET_SNAPSHOT_S or valid > end + GAIRMET_SNAPSHOT_S:
            continue
        if len(advisory["coords"]) < 3:
            continue
        polygon = Polygon([(lon, lat) for lat, lon in advisory["coords"]])
        if not polygon.is_valid:
            polygon = polygon.buffer(0)
        if line.intersects(polygon):
            found.append(advisory)
    return found


def _fetch_each(names, force: bool = False) -> None:
    """Every one of `names` attempted, all at once, then the first failure
    (in `names`' order) raised -- one source down must not keep the others
    from being fetched. At once, not one after another: they are
    separate files, and a route's read ahead (read_ahead) waits on the
    slowest of them rather than on their sum."""
    def fetch(name: str) -> WeatherServiceError | None:
        try:
            _dataset(name, force=force)
        except WeatherServiceError as err:
            return err
        return None

    with ThreadPoolExecutor(max_workers=max(1, len(names))) as pool:
        failures = list(pool.map(fetch, names))
    first = next((err for err in failures if err is not None), None)
    if first is not None:
        raise first


#: The reports and advisories, each a cache file of aviationweather.gov's.
_CACHE_SOURCES = ("metars", "tafs", "airsigmets", "pireps", "gairmets")


def preload() -> None:
    """Fetches the cache files and the winds aloft now -- a briefing's
    worth of data for every route -- so a service's first pilot after a
    restart doesn't wait on the downloads. The winds for every period,
    whether asked for yet or not: a plan for later in the day reads the
    12- or 24-hour period, and the first such plan after a restart waited
    on its download (5.9 s of a route's altitudes, 2026-10-23)."""
    _warm_winds(force=True)
    _fetch_each(_CACHE_SOURCES)


def refresh() -> None:
    """The same fetched again now, whatever their age, for the server's
    own periodic refresh, so the held copies never expire on a pilot's
    request: the first plan after an expiry used to pay for the
    downloads, on a slow aviationweather.gov day close to a minute. The
    winds are read again once their copy nears its hour (modelwinds.warm).
    A fetch that fails leaves the held copy in place, to be served while
    its product is still valid."""
    _warm_winds(force=False)
    _fetch_each(_CACHE_SOURCES, force=True)


def _warm_winds(force: bool) -> None:
    from . import modelwinds

    modelwinds.warm(force=force)


def read_ahead(fcst_hr: str = "06") -> threading.Thread:
    """What a route's plan reads, fetched now on a thread of its own where
    a held copy has run out -- the reports and advisories, and the winds
    for `fcst_hr`, the GFS's (_fd_stations) -- and nothing where none has. Asked for as the route
    is entered (app.prefetch), so a planner left alone past in_use's
    quarter of an hour, which its own refresh then leaves alone too,
    downloads them while the chart is read along the route rather than
    after it, on the plan's way. Each is held by its own rule as ever
    (_dataset); this only starts the download sooner."""
    def run() -> None:
        try:
            _fetch_each(_CACHE_SOURCES)
        except WeatherServiceError:
            pass  # the plan's own reads say what could not be had
        try:
            _fd_stations(fcst_hr)
        except WeatherServiceError:
            pass  # the plan's own reads say what could not be had

    thread = threading.Thread(target=run, name="weather-read-ahead", daemon=True)
    thread.start()
    return thread


def forecast_hour(hours_ahead: float | None) -> str:
    """Which winds period fits a departure `hours_ahead` hours from now,
    where no period's window can be read to say: the 6-hour period up to
    six hours out, the 12-hour period to fifteen, the 24-hour period
    beyond -- where their windows end (wingtip.modelwinds' _PERIODS).
    None (no departure time) is now."""
    if hours_ahead is None or hours_ahead <= 6:
        return "06"
    if hours_ahead <= 15:
        return "12"
    return "24"
