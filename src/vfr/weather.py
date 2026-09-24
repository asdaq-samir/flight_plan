"""Live weather for VFR altitude selection and dead-reckoning nav-log math:
winds/temps aloft (freezing level for icing avoidance, and wind_at_altitude
for wind-correction-angle math), forecast ceiling/visibility along the
route, current METARs, and SIGMET hazard advisories -- all from
aviationweather.gov.

METARs, TAFs and SIGMETs come from the site's cache files -- the complete
current national dataset, gzipped, regenerated every minute (TAFs every
ten) -- rather than per-route API queries. That is what their API terms
ask heavy users to do: a bounding-box query per route is exactly the
"large query" the rate limit and the results cap exist for, and one
download every few minutes replaces all of them. The winds/temps product
is small and stays a direct request, one per forecast period. Every one
of them is a source in _SOURCES, held by one rule (see _dataset): parsed
as it is fetched, kept for its own time, a failed refresh serving the
previous copy for a while -- so an outage degrades to "conditions from a
few minutes ago" rather than a failure per request -- and a failure with
nothing to serve remembered for a minute rather than tried again by
every caller.

Unlike the FAA NASR/DOF data in vfr.faa_data, none of this is cached to
disk: it's live/current-conditions data, and a copy older than an hour
or two is stale, not "the current cycle".
"""
import gzip
import logging
import re
import threading
import time
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import NamedTuple

import numpy as np
import requests

from .retry import with_retries

log = logging.getLogger(__name__)

HEADERS = {"User-Agent": "vfr-route-learning-project/0.1"}
WINDTEMP_URL = "https://aviationweather.gov/api/data/windtemp"
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


def _get(url: str, params: dict, retries: int = 3) -> requests.Response:
    """A transient blip (a slow bbox query 504ing, seen 2026-09-18) used
    to raise WeatherServiceError on the first and only attempt instead of
    quietly succeeding on a retry a few seconds later."""
    def attempt() -> requests.Response:
        resp = requests.get(url, params=params, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        return resp

    return with_retries(
        attempt, describe=f"aviationweather.gov request to {url}", retries=retries, error=WeatherServiceError,
    )


# --- Freezing level, from the winds/temps-aloft ("FD") text product ---


def _fd_stations(fcst_hr: str = "06") -> dict:
    """The winds/temps product for one forecast period, parsed: the three
    altitude plans look the winds up at every legal altitude of every leg
    -- well over a hundred lookups for one route -- so it is fetched and
    parsed once and held (the "winds-NN" sources below), not per lookup."""
    return _dataset(f"winds-{fcst_hr}")


def _parse_fd_station_row(row: str, alt_positions: list) -> tuple:
    """A station's wind/temp groups aren't fixed-width at the byte level
    -- a group for an altitude below the station's own elevation is
    omitted entirely (not blank-padded), which shifts every later token
    left. So tokens are matched to altitude columns by nearest character
    position to the header's own column position, not by slice or
    token-count -- verified against real FD output including rows with
    skipped low-altitude columns (e.g. a high-elevation station with no
    3000ft/6000ft groups at all).
    """
    station_id = row[0:3].strip()
    groups = {}
    for m in re.finditer(r"\S+", row[3:]):
        pos = m.start() + 3
        nearest_alt = min(alt_positions, key=lambda ap: abs(ap[0] - pos))[1]
        groups[nearest_alt] = m.group()
    return station_id, groups


def _decode_temp_c(group: str) -> float | None:
    """Extract the temperature from a wind/temp group. The 3000ft column
    is wind-only (4 chars, e.g. "3220") when the station itself is near
    that altitude -- no temp to extract. 6000-24000ft groups are 7 chars
    with an explicit sign (e.g. "3028+18"). 30000ft+ groups are 6 chars,
    unsigned, and always negative (the product's own header states
    "TEMPS NEG ABV 24000" -- the sign is omitted because it's implied).
    """
    if len(group) == 7 and group[4] in "+-":
        return float(group[4:7])
    if len(group) == 6 and group[4:6].isdigit():
        return -float(group[4:6])
    return None


def _decode_wind(group: str) -> tuple[float | None, float | None] | None:
    """(wind_dir_true_deg, wind_speed_kt) from a group's first 4 chars
    (DDFF -- direction in tens of degrees true, speed in knots); None if
    the group's too short to contain a wind code at all. "9900" is the
    product's own light-and-variable convention -- direction isn't
    meaningful, so it's returned as None rather than guessed, with speed
    treated as calm (0kt). Wind >=100kt is encoded by adding 50 to the
    direction code and subtracting 100 from the speed code -- both undone
    here (e.g. "7520" -> 250 deg / 120kt).
    """
    if len(group) < 4 or not group[:4].isdigit():
        return None
    wind_part = group[:4]
    if wind_part == "9900":
        return None, 0.0
    dir_code, speed_code = int(wind_part[:2]), int(wind_part[2:4])
    if dir_code >= 51:
        return float((dir_code - 50) * 10), float(speed_code + 100)
    return float(dir_code * 10), float(speed_code)


def parse_fd_text(text: str) -> dict:
    """{station_id: {altitude_ft: {"wind_dir_true_deg", "wind_speed_kt", "temp_c"}}}
    for every station/altitude group in the FD text with a decodable wind
    (temp_c is None for wind-only groups, e.g. the 3000ft column near a
    station's own elevation).
    """
    lines = text.splitlines()
    header_idx = next((i for i, line in enumerate(lines) if line.startswith("FT ")), None)
    if header_idx is None:
        # A body with no altitude header -- an error page, a truncated
        # answer -- is not a product. It used to escape as StopIteration,
        # which no caller catches.
        raise WeatherServiceError("the winds/temps product has no altitude header")
    alt_positions = [(m.start(), int(m.group())) for m in re.finditer(r"\d+", lines[header_idx])]

    stations = {}
    for line in lines[header_idx + 1 :]:
        if not line.strip():
            continue
        station_id, groups = _parse_fd_station_row(line, alt_positions)
        if not station_id:
            continue
        decoded = {}
        for alt, g in groups.items():
            wind = _decode_wind(g)
            if wind is None:
                continue
            wind_dir, wind_speed = wind
            decoded[alt] = {"wind_dir_true_deg": wind_dir, "wind_speed_kt": wind_speed, "temp_c": _decode_temp_c(g)}
        if decoded:
            stations[station_id] = decoded
    return stations


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
    # as vfr.geo.distance_nm; the radius cancels out of an argmin.
    lat0, lon0 = np.radians(lat), np.radians(lon)
    a = np.sin((lats - lat0) / 2) ** 2 + np.cos(lat0) * np.cos(lats) * np.sin((lons - lon0) / 2) ** 2
    return str(codes[int(np.argmin(a))])


def freezing_level(lat: float, lon: float, fcst_hr: str = "06") -> dict | None:
    """Where the nearest station's forecast temperature profile crosses
    0 degC: {"ft", "at_or_below"}, by linear interpolation between the two
    bracketing reported altitudes. None if the whole reported profile
    stays above freezing (no icing concern in range) -- "no freezing
    level in range", not "unknown".

    `at_or_below` is true when it is already at or below 0 degC at the
    lowest reported altitude -- 6,000 ft, since the winds-aloft product
    gives no temperature at 3,000 -- so the freezing level is that
    altitude or lower, somewhere the data cannot say. This used to return
    the lowest altitude as though it were the freezing level and call it
    conservative, which let everything under it pass as above freezing on
    exactly the coldest days.
    """
    from . import airports

    stations = _fd_stations(fcst_hr)
    airports_df = airports.load_airports()
    station_id = _nearest_station(lat, lon, set(stations.keys()), airports_df)
    if station_id is None:
        return None

    profile = sorted((alt, v["temp_c"]) for alt, v in stations[station_id].items() if v["temp_c"] is not None)
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

    profile = sorted(
        (alt, v["wind_dir_true_deg"], v["wind_speed_kt"])
        for alt, v in stations[station_id].items()
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
# How old a copy may be and still be served when a refresh fails.
_DATASET_STALE_MAX_S = 3 * 3600
# The winds are issued a few times a day but held only this long, and
# served no older when a refresh fails: the nav log's wind triangle is
# only as good as its winds, and a plan says when it has none.
_WINDS_TTL_S = 900
# How long to wait before trying a failed refresh again -- every weather
# call during an outage must not be a fresh download attempt, with its
# own retries and time-outs. Holds whether or not a copy is being served.
_DATASET_RETRY_AFTER_S = 60
# How long a caller with no copy at all waits for someone else's download.
_DATASET_WAIT_S = 120


def _winds_source(fcst_hr: str) -> tuple:
    return (WINDTEMP_URL, {"region": "us", "level": "low", "fcst": fcst_hr},
            lambda resp: parse_fd_text(resp.text), _WINDS_TTL_S, _WINDS_TTL_S)


# name -> (url, params, parse(response), fresh for, served stale up to).
_SOURCES = {
    "metars": (f"{CACHE_BASE_URL}/metars.cache.xml.gz", {},
               lambda resp: _parse_metars(gzip.decompress(resp.content)), _DATASET_TTL_S, _DATASET_STALE_MAX_S),
    "tafs": (f"{CACHE_BASE_URL}/tafs.cache.xml.gz", {},
             lambda resp: _parse_tafs(gzip.decompress(resp.content)), _DATASET_TTL_S, _DATASET_STALE_MAX_S),
    "airsigmets": (f"{CACHE_BASE_URL}/airsigmets.cache.xml.gz", {},
                   lambda resp: _parse_airsigmets(gzip.decompress(resp.content)), _DATASET_TTL_S, _DATASET_STALE_MAX_S),
    **{f"winds-{hr}": _winds_source(hr) for hr in ("06", "12", "24")},
}


class _Record(NamedTuple):
    """What is known about one source, replaced whole and never changed
    in place, so a reader needs no lock to look at it. `at` is when the
    held copy was fetched (None when there is none); `error`, the last
    attempt's failure, None once one succeeds."""
    at: float | None
    data: object
    attempted: float
    error: WeatherServiceError | None


_DATASETS: dict[str, _Record] = {}
_DATASET_LOCKS = {name: threading.Lock() for name in _SOURCES}
# name -> an Event set when the download in flight for it ends.
_DATASET_FETCHING: dict = {}
_DUE = object()


def _serve(record: _Record | None, now: float, ttl_s: float, stale_max_s: float):
    """What a record can answer now: its data, the remembered failure
    (raised), or _DUE when a fetch should start."""
    if record is None:
        return _DUE
    servable = record.at is not None and now - record.at < stale_max_s
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
    url, params, parse, ttl_s, stale_max_s = _SOURCES[name]
    if not force:
        served = _serve(_DATASETS.get(name), time.time(), ttl_s, stale_max_s)
        if served is not _DUE:
            return served
    while True:
        with _DATASET_LOCKS[name]:
            record = _DATASETS.get(name)
            now = time.time()
            if not force:
                served = _serve(record, now, ttl_s, stale_max_s)
                if served is not _DUE:
                    return served
            in_flight = _DATASET_FETCHING.get(name)
            if in_flight is None:
                done = threading.Event()
                _DATASET_FETCHING[name] = done
                break
            if record is not None and record.at is not None and now - record.at < stale_max_s:
                return record.data
        if not in_flight.wait(timeout=_DATASET_WAIT_S):
            raise WeatherServiceError(f"aviationweather.gov {name} is still downloading")
        # Someone else's download just ended: serve what it left.
        force = False

    try:
        data = parse(_get(url, params=params))
    except (WeatherServiceError, OSError, ET.ParseError) as err:
        error = WeatherServiceError(f"aviationweather.gov {name} unavailable: {err}")
        with _DATASET_LOCKS[name]:
            _DATASETS[name] = _Record(
                at=record.at if record else None, data=record.data if record else None, attempted=now, error=error,
            )
            _DATASET_FETCHING.pop(name, None)
        done.set()
        if record is not None and record.at is not None and now - record.at < stale_max_s:
            log.warning("%s refresh failed (%s); serving the copy from %.0f minutes ago",
                        name, err, (now - record.at) / 60)
            return record.data
        raise error from err
    with _DATASET_LOCKS[name]:
        _DATASETS[name] = _Record(at=now, data=data, attempted=now, error=None)
        _DATASET_FETCHING.pop(name, None)
    done.set()
    return data


def dataset_status() -> dict[str, float | None]:
    """When each source's held copy was fetched, None for one not held --
    what the Dev console shows as the weather's age."""
    return {name: (record.at if (record := _DATASETS.get(name)) else None) for name in _SOURCES}


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


def _ceiling_ft(period: dict) -> float | None:
    """The lowest broken, overcast or obscured layer -- FEW/SCT don't count
    as a ceiling by the FAA's own definition.

    An obscured sky is a ceiling at its vertical visibility (14 CFR 1.1).
    The feed marks it `OVX`, with the height as the layer's base in a
    METAR and only as `vert_vis_ft` in a TAF; counting BKN and OVC alone
    left fog at the surface -- VV002, the lowest ceiling there is -- as
    no ceiling at all.
    """
    bases = [
        c["base"] for c in period.get("clouds", [])
        if c.get("cover") in ("BKN", "OVC", "OVX") and c.get("base") is not None
    ]
    if period.get("vert_vis") is not None:
        bases.append(period["vert_vis"])
    return min(bases) if bases else None


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
        latest[ident] = (observed, {
            "raw": el.findtext("raw_text"),
            # When the report was made, so a page can say how old it is:
            # the server keeps serving a copy for hours when a refresh
            # fails, and a colour alone says nothing about its age.
            "observed_at": observed or None,
            "flight_category": el.findtext("flight_category"),
            "ceiling_ft": _ceiling_ft(period),
            "visibility_sm": _visibility_sm(period),
            # "VRB" is a direction the arithmetic can't use.
            "wind_dir_true_deg": _float(el.findtext("wind_dir_degrees")),
            "wind_speed_kt": _float(el.findtext("wind_speed_kt")),
            "temp_c": _float(el.findtext("temp_c")),
            "dewpoint_c": _float(el.findtext("dewpoint_c")),
        })
    return {ident: report for ident, (_, report) in latest.items()}


def metar_for_idents(idents: list) -> dict:
    """{ident: {...}} for the latest METAR at each ident, or {ident: None}
    for one with nothing current (a small field with no reporting
    station)."""
    metars = _dataset("metars")
    return {ident: metars.get(ident) for ident in idents}


# --- Ceiling/visibility, from the TAFs ---

# Within one start time, the base forecast (FM, or the TAF's own first
# line) sorts first; BECMG/TEMPO/PROB lines modify it.
_CHANGE_ORDER = {"": 0, "FM": 0, "BECMG": 1, "TEMPO": 2, "PROB": 3}


def _parse_tafs(xml_bytes: bytes) -> list:
    """[{"icaoId", "lat", "lon", "fcsts": [...]}] -- one entry per station,
    its latest issue, periods in time order with the base forecast
    first."""
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
            })
        fcsts.sort(key=lambda p: (p["timeFrom"], _CHANGE_ORDER.get(p["change"][:5], 3)))
        latest[ident] = (issued, {
            "icaoId": ident, "lat": lat, "lon": lon,
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
            "visibility_sm": worst["visibility_sm"] if worst else None,
            "change": (period or {}).get("change") or "",
            "valid_from": (period or {}).get("timeFrom"),
            "valid_to": (period or {}).get("timeTo"),
        }
    return answer


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
    the window at all."""
    periods = _periods_in_window(fcsts, start, end)
    if not periods:
        return None
    ceilings = [c for c in (_ceiling_ft(p) for p in periods) if c is not None]
    visibilities = [v for v in (_visibility_sm(p) for p in periods) if v is not None]
    return {
        "ceiling_ft": min(ceilings) if ceilings else None,
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

    Returns {"min_ceiling_ft", "min_visibility_sm", "stations"} -- the
    first two are the worst (most restrictive) values found nearby, for
    a conservative go/no-go read; "stations" is the per-station detail.
    This is about *whether* conditions support VFR flight at all, not
    *what altitude* to fly at -- kept separate from the altitude-band
    constraints (terrain/airspace/aircraft/freezing-level) for that reason.
    """
    from .geo import corridor_bbox

    min_lat, min_lon, max_lat, max_lon = corridor_bbox(route_start, route_end, corridor_buffer_nm)
    stations = [
        s for s in _dataset("tafs", _parse_tafs)
        if min_lat <= s["lat"] <= max_lat and min_lon <= s["lon"] <= max_lon
    ]

    start, end = window if window else (time.time(), time.time())
    per_station, ceilings, visibilities = [], [], []
    for station in stations:
        worst = _worst_in_window(station["fcsts"], start, end)
        if worst is None:
            continue
        ceiling = worst["ceiling_ft"]
        visibility = worst["visibility_sm"]
        per_station.append({"icaoId": station["icaoId"], "ceiling_ft": ceiling, "visibility_sm": visibility})
        if ceiling is not None:
            ceilings.append(ceiling)
        if visibility is not None:
            visibilities.append(visibility)

    return {
        "min_ceiling_ft": min(ceilings) if ceilings else None,
        "min_visibility_sm": min(visibilities) if visibilities else None,
        "stations": per_station,
    }


# --- Go/no-go: the basic VFR weather minimums ---

# 14 CFR 91.155: below a 1,000 ft ceiling or 3 statute miles' visibility,
# VFR flight is not the default answer. The one place these numbers
# live -- vfr.altitude's go/no-go flag and the briefing's "VFR flight not
# recommended" both read them, and the page shows what they decided.
VFR_MIN_CEILING_FT = 1000
VFR_MIN_VISIBILITY_SM = 3


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
    ceiling_visibility_along_route()'s. Empty when nothing warrants it."""
    reasons = []
    for ident in idents:
        category = (metars.get(ident) or {}).get("flight_category")
        if category in ("IFR", "LIFR"):
            reasons.append(f"{ident} currently reporting {category}")
    ceiling, visibility = forecast.get("min_ceiling_ft"), forecast.get("min_visibility_sm")
    if ceiling is not None and ceiling < VFR_MIN_CEILING_FT:
        reasons.append(f"forecast ceiling as low as {ceiling:,.0f} ft along the route")
    if visibility is not None and visibility < VFR_MIN_VISIBILITY_SM:
        reasons.append(f"forecast visibility as low as {visibility:g} sm along the route")
    return reasons


# --- SIGMET hazards ---


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
            "coords": [(lat, lon) for lat, lon in points if lat is not None and lon is not None],
        })
    return advisories


def hazards_along_route(route_start: tuple, route_end: tuple, corridor_buffer_nm: float = 25.0) -> list:
    """SIGMETs whose hazard polygon the route line actually crosses, among
    those valid right now. The bbox is a coarse prefilter (convective
    SIGMETs commonly span several states); the real filter is the
    route/polygon intersection. CONUS AIRMETs were discontinued in
    January 2025 in favour of G-AIRMETs, which this does not read yet.
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
            hits.append({key: advisory[key] for key in ("hazard", "type", "altitude_low_ft", "altitude_high_ft", "raw")})
    return hits


def _fetch_each(names, force: bool = False) -> None:
    """Every one of `names` attempted, then the first failure raised --
    one source down must not keep the others from being fetched."""
    first = None
    for name in names:
        try:
            _dataset(name, force=force)
        except WeatherServiceError as err:
            first = first or err
    if first is not None:
        raise first


def preload() -> None:
    """Fetches the three cache files and the current winds now -- a
    briefing's worth of data for every route -- so a service's first
    pilot after a restart doesn't wait on the downloads."""
    _fetch_each(("metars", "tafs", "airsigmets", "winds-06"))


def refresh() -> None:
    """The same fetched again now, whatever their age -- the winds for
    each forecast period already held -- for the server's own periodic
    refresh, so the held copies never expire on a pilot's request: the
    first plan after an expiry used to pay for the downloads, on a slow
    aviationweather.gov day close to a minute. A fetch that fails leaves
    the held copy in place, to be served stale as before; the winds used
    to be written here by hand, and had no such fallback."""
    winds = [name for name in _DATASETS if name.startswith("winds-")] or ["winds-06"]
    _fetch_each(("metars", "tafs", "airsigmets", *winds), force=True)


def forecast_hour(hours_ahead: float | None) -> str:
    """Which FD forecast period fits a departure `hours_ahead` hours from
    now: the 6-hour product up to nine hours out, the 12-hour product
    to eighteen, the 24-hour product beyond -- each period's own valid
    time sits mid-way to the next. None (no departure time) is now."""
    if hours_ahead is None or hours_ahead <= 9:
        return "06"
    if hours_ahead <= 18:
        return "12"
    return "24"
