"""Winds and temperatures aloft from the GFS model: the planner's winds
aloft since the Winds and Temperatures Aloft Forecast (FB, the "FD" text
product) ended. NWS Service Change Notice 26-47 (updated 5 Nov 2026)
discontinued the NAM at 1200Z on 3 Nov 2026 and with it the FB bulletins
(its WMO headers "FB(US|AK|HW)3[135789] KWNO"); aviationweather.gov's
windtemp API has answered 400 since, "Wind/temp tables have been
discontinued with the retirement of the NAM model". The owner made the
GFS the primary source on 2026-11-07, and nothing asks for the FB now.

The NWS's Global Forecast System (NCEP GFS, 0.25 degree), its winds,
temperatures and geopotential heights at nine pressure levels from 925
to 200 hPa -- about 2,500 to 39,000 ft, the FB's own range -- over the
lower 48, cut out by NOMADS' grib filter (about two megabytes a run and
forecast hour) and read with gribberish, as wingtip.glmp reads GLMP. The
FB's old stations are given the model's levels at their own places, so
the planner reads them as it read the FB (wingtip.weather's FdStations:
nearest station, interpolated by altitude). This is model output,
unedited: every screen that shows these winds says they are modelled,
with the GFS run and forecast hour.

The GFS runs four times a day (00, 06, 12 and 18Z); NOMADS posts each
run's 0.25-degree files hourly to 120 hours and three-hourly after that
(its directory gfs.YYYYMMDD/HH/atmos: f000 to f120, then f123, f126...).

Held, not fetched per plan: each period's copy is read at the planner's
start and on its refresh (warm), and a copy past FRESH_S that is still
inside its own window is served at once while a newer one downloads on a
thread of its own, so a plan waits on NOMADS only when nothing valid is
held.
"""
from __future__ import annotations

import logging
import math
import threading
import time
from datetime import datetime, timedelta, timezone

import gribberish
import numpy as np
import requests

from .config import REQUEST_HEADERS as HEADERS
from .units import M_TO_FT

log = logging.getLogger(__name__)

FILTER_URL = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"
#: hPa levels asked for: the FB's 3,000 to 39,000 ft in the standard
#: atmosphere (925 hPa is about 2,500 ft, 200 hPa about 38,700 ft).
LEVELS_HPA = (925, 850, 700, 600, 500, 400, 300, 250, 200)
#: The lower 48, with the stations' edges inside it.
BOX = {"toplat": 55, "bottomlat": 20, "leftlon": -130, "rightlon": -60}
#: A run is on NOMADS about three and a half hours after its hour; looked
#: for from four.
POSTED_AFTER = timedelta(hours=4)
RUNS_TRIED = 3
#: The last forecast hour NOMADS posts hourly; three-hourly after it.
HOURLY_TO = 120
#: A copy is asked for again after this: the hour the periods' windows
#: move on by, and a new run every six.
FRESH_S = 3600
#: The planner's refresh reads a copy again once it is this old, so the
#: hourly read happens there rather than under a pilot's plan.
REFRESH_AFTER_S = FRESH_S - 15 * 60
NOT_UP_RETRY_S = 300
#: A failed read with nothing valid to serve is remembered this long, so
#: every lookup of an outage is not a download of its own.
FAILED_RETRY_S = 60

# The stations the planner finds the nearest of to a leg: the CONUS FB
# stations (FD1US1, as issued 2026-11-03), kept as the places the model
# is read at.
FB_STATIONS = (
    "ABI ABQ ABR ACK ACY AGC ALB ALS AMA AST ATL AVP AXN BAM BCE BDL BFF BGR BHM BIH BIL BLH BML BNA BOI BOS BRL BRO "
    "BUF CAE CAR CGI CHS CLE CLL CMH COU CRP CRW CSG CVG CZI DAL DBQ DEN DIK DLH DLN DRT DSM ECK EKN ELP ELY EMI EVV "
    "EYW FAT FLO FMN FOT FSD FSM FWA GAG GCK GEG GFK GGW GJT GLD GPI GRB GRI GSP GTF HAT HOU HSV ICT ILM IMB IND INK "
    "INL JAN JAX JFK JOT LAS LBB LCH LIT LKV LND LOU LRD LSE LWS MBW MCW MEM MGM MIA MKC MKG MLB MLS MOB MOT MQT MRF "
    "MSP MSY OKC OMA ONL ONT ORF OTH PDX PFN PHX PIE PIH PIR PLB PRC PSB PSX PUB PWM RAP RBL RDM RDU RIC RKS RNO ROA "
    "ROW SAC SAN SAT SAV SBA SEA SFO SGF SHV SIY SLC SLN SPI SPS SSM STL SYR TCC TLH TRI TUL TUS TVC TYS WJF YKM ZUN"
).split()

# Each period a plan reads: the forecast hour it is valid at, as hours
# from the current hour, and the window around that valid time it is for
# use in, hours before and after. The windows are the FB's own for its
# 6-, 12- and 24-hour forecasts (FAA Order JO 7110.10, Flight Services,
# 9-3-1, TBL 9-3-1: valid 1800Z for use 1400-2100Z, valid 0000Z for use
# 2100-0600Z, valid 1200Z for use 0600-1800Z), a forecast hour standing
# where the FB's valid time did. Each valid time is put so the three run
# on from one another from the current hour: 06 from an hour ago to six
# hours ahead, 12 to fifteen, 24 to twenty-seven. A forecast hour is
# never used outside its window (stations, _in_window).
_PERIODS = {"06": (3, 4, 3), "12": (9, 3, 6), "24": (21, 6, 6)}
#: The periods, in order, as wingtip.weather reads them.
PERIODS = tuple(_PERIODS)


class ModelWindsUnavailable(RuntimeError):
    """NOMADS did not give a GFS run."""


_HELD: dict = {}
_NOT_UP: dict = {}
_FAILED: dict = {}
#: One download at a time for each period, not for all three: a plan for
#: now does not wait on the 24-hour period's download.
_LOCKS = {hr: threading.Lock() for hr in _PERIODS}


def stations(fcst_hr: str = "06"):
    """The stations with the GFS's levels at each, for `fcst_hr`'s period:
    an FdStations whose `period` is {"valid_at", "use_from", "use_to",
    "run", "forecast_hour"} and `modelled` True. A copy held is served
    while it is inside its own window; one past FRESH_S is read again on
    a thread of its own meanwhile. Raises ModelWindsUnavailable where no
    valid copy is held and none can be had."""
    now = time.time()
    held = _HELD.get(fcst_hr)
    if held is not None and _in_window(held[1], now):
        if now - held[0] >= FRESH_S:
            _read_behind(fcst_hr)
        return held[1]
    return _read(fcst_hr, force=False)


def warm(force: bool = False) -> None:
    """Every period read now where its copy is past REFRESH_AFTER_S (all of
    them with `force`): the planner's start and its periodic refresh, so a
    pilot's plan finds them held. A period NOMADS cannot give is logged;
    its copy held, if still in its window, is served on."""
    for fcst_hr in _PERIODS:
        held = _HELD.get(fcst_hr)
        if not force and held is not None and time.time() - held[0] < REFRESH_AFTER_S:
            continue
        try:
            _read(fcst_hr, force=True)
        except ModelWindsUnavailable as err:
            log.warning("modelled winds for the %s-hour period not read: %s", fcst_hr, err)


def _read_behind(fcst_hr: str) -> None:
    lock = _LOCKS.setdefault(fcst_hr, threading.Lock())
    if lock.locked():
        return

    def run() -> None:
        try:
            _read(fcst_hr, force=True)
        except ModelWindsUnavailable as err:
            log.warning("modelled winds for the %s-hour period not refreshed: %s", fcst_hr, err)

    threading.Thread(target=run, name=f"modelwinds-{fcst_hr}", daemon=True).start()


def _read(fcst_hr: str, force: bool):
    """The period read from NOMADS under its lock, and held. Without
    `force` a copy someone else has just read is served instead, and a
    failure remembered for FAILED_RETRY_S is raised again. A read that
    fails serves the copy held while it is still in its window."""
    from .weather import FdStations

    with _LOCKS.setdefault(fcst_hr, threading.Lock()):
        now = time.time()
        held = _HELD.get(fcst_hr)
        if not force:
            if held is not None and now - held[0] < FRESH_S and _in_window(held[1], now):
                return held[1]
            failed = _FAILED.get(fcst_hr)
            if failed is not None and now - failed[0] < FAILED_RETRY_S:
                raise failed[1]
        at = datetime.fromtimestamp(now, timezone.utc)
        try:
            fields, run, step = _fetch(fcst_hr, at)
        except ModelWindsUnavailable as err:
            _FAILED[fcst_hr] = (now, err)
            if held is not None and _in_window(held[1], now):
                return held[1]
            raise
        out = FdStations(_at_stations(fields))
        out.period = period_of(run, step, fcst_hr)
        out.modelled = True
        _HELD[fcst_hr] = (now, out)
        _FAILED.pop(fcst_hr, None)
        return out


def period_of(run: datetime, step: int, fcst_hr: str) -> dict:
    """A forecast hour's period: valid at the run's hour plus `step`, for
    use in the window round that valid time _PERIODS gives `fcst_hr`'s
    period (TBL 9-3-1's), with the run and the forecast hour the pilot is
    told."""
    valid = run + timedelta(hours=step)
    _, before, after = _PERIODS.get(fcst_hr, _PERIODS["06"])
    return {
        "valid_at": _iso(valid),
        "use_from": _iso(valid - timedelta(hours=before)),
        "use_to": _iso(valid + timedelta(hours=after)),
        "run": _iso(run),
        "forecast_hour": step,
    }


def _in_window(stations_held, now: float) -> bool:
    """Whether a copy held may still be served: not past the end of its
    window, by the engine's rule for when a winds forecast stops counting
    (validity.rs, `weather_expires_at`). Its later periods are for later
    flights, so it is served before its window starts as the FB's 12- and
    24-hour forecasts were."""
    from .weather import _expires_at

    period = getattr(stations_held, "period", None) or {}
    until = _expires_at("winds", _iso_s(period["use_to"])) if period.get("use_to") else None
    return until is not None and now < until


def _fetch(fcst_hr: str, now: datetime) -> tuple[dict, datetime, int]:
    """{(var, hPa): (lats, lons, values)} from the latest run up at the
    forecast hour valid at the period's hour, that run and that hour."""
    hour = now.replace(minute=0, second=0, microsecond=0)
    target = hour + timedelta(hours=_PERIODS.get(fcst_hr, _PERIODS["06"])[0])
    latest = (now - POSTED_AFTER).replace(minute=0, second=0, microsecond=0)
    latest -= timedelta(hours=latest.hour % 6)
    for n in range(RUNS_TRIED):
        run = latest - timedelta(hours=6 * n)
        step = forecast_step(run, target)
        key = (run, step)
        if time.time() - _NOT_UP.get(key, 0) < NOT_UP_RETRY_S:
            continue
        body = _download(run, step)
        if body is None:
            _NOT_UP[key] = time.time()
            continue
        try:
            return _read_grib(body), run, step
        except (ValueError, RuntimeError, AttributeError) as err:
            raise ModelWindsUnavailable(f"the GFS {run:%d%H}Z f{step:03d} could not be read: {err}") from err
    raise ModelWindsUnavailable(f"no GFS run on NOMADS in the last {6 * RUNS_TRIED} hours")


def forecast_step(run: datetime, target: datetime) -> int:
    """The forecast hour of `run` nearest `target`: every hour to
    HOURLY_TO, every third after it (NOMADS' 0.25-degree files)."""
    hours = (target - run).total_seconds() / 3600
    if hours <= HOURLY_TO:
        return max(0, round(hours))
    return min(384, HOURLY_TO + 3 * round((hours - HOURLY_TO) / 3))


def _download(run: datetime, step: int) -> bytes | None:
    params = {
        "dir": f"/gfs.{run:%Y%m%d}/{run:%H}/atmos",
        "file": f"gfs.t{run:%H}z.pgrb2.0p25.f{step:03d}",
        **{f"var_{v}": "on" for v in ("HGT", "TMP", "UGRD", "VGRD")},
        **{f"lev_{p}_mb": "on" for p in LEVELS_HPA},
        "subregion": "", **BOX,
    }
    try:
        resp = requests.get(FILTER_URL, params=params, headers=HEADERS, timeout=30)
    except requests.RequestException as err:
        raise ModelWindsUnavailable(f"NOMADS did not answer: {err}") from err
    # A run not posted yet is a 404, or an HTML page saying so.
    if resp.status_code == 404 or not resp.content.startswith(b"GRIB"):
        return None
    if not resp.ok:
        raise ModelWindsUnavailable(f"NOMADS answered {resp.status_code}")
    return resp.content


def _read_grib(body: bytes) -> dict:
    fields = {}
    offset = 0
    while offset < len(body):
        message = gribberish.parse_grib_message(body, offset)
        meta = message.metadata
        lats, lons = (np.asarray(a, dtype=np.float64) for a in meta.latlng())
        values = np.asarray(message.data(), dtype=np.float32).reshape(len(lats), len(lons))
        fields[(meta.var_abbrev, round(meta.level_value / 100))] = (lats, lons, values)
        offset += meta.message_size
    missing = [(v, p) for v in ("HGT", "TMP", "UGRD", "VGRD") for p in LEVELS_HPA if (v, p) not in fields]
    if missing:
        raise ValueError(f"missing {missing[:3]}")
    return fields


def _at_stations(fields: dict) -> dict:
    """Each station's levels from the grid point nearest it: {ident:
    {altitude_ft: {"wind_dir_true_deg", "wind_speed_kt", "temp_c"}}}, each
    level at its own geopotential height, which the planner's altitude
    interpolation takes as it did the FB's columns."""
    from . import airports
    from .weather import _station_rows

    codes, lats, lons = _station_rows(set(FB_STATIONS), airports.load_airports())
    out = {}
    for code, lat, lon in zip(codes, np.degrees(lats), np.degrees(lons)):
        levels = {}
        for hpa in LEVELS_HPA:
            height_m = _at(fields[("HGT", hpa)], lat, lon)
            temp_k = _at(fields[("TMP", hpa)], lat, lon)
            u, v = _at(fields[("UGRD", hpa)], lat, lon), _at(fields[("VGRD", hpa)], lat, lon)
            if None in (height_m, temp_k, u, v):
                continue
            speed_kt = math.hypot(u, v) * 1.943844  # m/s to kt
            # Where the wind blows from, true: u, v are toward east, north.
            direction = (math.degrees(math.atan2(-u, -v)) + 360) % 360
            levels[int(round(height_m * M_TO_FT))] = {
                "wind_dir_true_deg": round(direction), "wind_speed_kt": round(speed_kt),
                "temp_c": round(temp_k - 273.15),
            }
        if levels:
            out[str(code)] = levels
    return out


def _at(field: tuple, lat: float, lon: float) -> float | None:
    lats, lons, values = field
    i = int(round((lat - lats[0]) / (lats[1] - lats[0])))
    j = int(round(((lon % 360) - (lons[0] % 360)) / (lons[1] - lons[0])))
    if not (0 <= i < len(lats) and 0 <= j < len(lons)):
        return None
    value = float(values[i, j])
    return None if math.isnan(value) else value


def held(fcst_hr: str) -> tuple[float, dict] | None:
    """When `fcst_hr`'s copy held was read (UNIX seconds) and its period,
    for the Status page; None where none is."""
    got = _HELD.get(fcst_hr)
    return (got[0], got[1].period) if got is not None else None


def failing(fcst_hr: str) -> bool:
    """Whether the last read of `fcst_hr`'s period failed."""
    return fcst_hr in _FAILED


def _iso(at: datetime) -> str:
    return at.strftime("%Y-%m-%dT%H:%M:%SZ")


def _iso_s(text: str) -> float:
    return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
