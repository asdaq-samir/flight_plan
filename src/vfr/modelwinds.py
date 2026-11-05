"""Winds and temperatures aloft from the GFS model, for when the Winds
and Temperatures Aloft Forecast (FB, the "FD" text product) cannot be
had: on 2026-11-04 aviationweather.gov's windtemp API answered 204 for
every request and the NWS's own copies of the bulletin (tgftp's
fbus31/33/35) were a day old, and the plan flew still air with an error
over the map.

The NWS's Global Forecast System (NCEP GFS, 0.25 degree), its winds,
temperatures and geopotential heights at nine pressure levels from 925
to 200 hPa -- about 2,500 to 39,000 ft, the FB's own range -- over the
lower 48, cut out by NOMADS' grib filter (about two megabytes a run and
forecast hour) and read with gribberish, as vfr.glmp reads GLMP. The
FB's own stations are given the model's levels at their own places, so
the planner reads them exactly as it reads the FB (vfr.weather's
FdStations: nearest station, interpolated by altitude). The FB itself is
made from the GFS (AC 00-45H, the FB section): this is the same model,
unedited and without the FB's rounding, labelled modelled wherever the
plan says which winds it flies.
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
#: The lower 48, with the FB stations' edges inside it.
BOX = {"toplat": 55, "bottomlat": 20, "leftlon": -130, "rightlon": -60}
#: A run is on NOMADS about three and a half hours after its hour; looked
#: for from four.
POSTED_AFTER = timedelta(hours=4)
RUNS_TRIED = 3
#: A copy is asked for again after this; the GFS runs every six hours.
FRESH_S = 3600
NOT_UP_RETRY_S = 300

# The CONUS FB stations (FD1US1, as issued 2026-11-03): the planner finds
# the nearest of these to a leg, as it does in the FB.
FB_STATIONS = (
    "ABI ABQ ABR ACK ACY AGC ALB ALS AMA AST ATL AVP AXN BAM BCE BDL BFF BGR BHM BIH BIL BLH BML BNA BOI BOS BRL BRO "
    "BUF CAE CAR CGI CHS CLE CLL CMH COU CRP CRW CSG CVG CZI DAL DBQ DEN DIK DLH DLN DRT DSM ECK EKN ELP ELY EMI EVV "
    "EYW FAT FLO FMN FOT FSD FSM FWA GAG GCK GEG GFK GGW GJT GLD GPI GRB GRI GSP GTF HAT HOU HSV ICT ILM IMB IND INK "
    "INL JAN JAX JFK JOT LAS LBB LCH LIT LKV LND LOU LRD LSE LWS MBW MCW MEM MGM MIA MKC MKG MLB MLS MOB MOT MQT MRF "
    "MSP MSY OKC OMA ONL ONT ORF OTH PDX PFN PHX PIE PIH PIR PLB PRC PSB PSX PUB PWM RAP RBL RDM RDU RIC RKS RNO ROA "
    "ROW SAC SAN SAT SAV SBA SEA SFO SGF SHV SIY SLC SLN SPI SPS SSM STL SYR TCC TLH TRI TUL TUS TVC TYS WJF YKM ZUN"
).split()

# Each FB period the model stands in for, as hours from now: the hour it
# is valid at, and its "for use" window, so the three run on from one
# another as the FB's do (AC 00-45H, table 5-21: 6-hour for use until
# about 7 hours ahead, 12-hour to about 13 and a half, 24-hour beyond).
_PERIODS = {"06": (3, -1, 7), "12": (10, 7, 13), "24": (19, 13, 31)}


class ModelWindsUnavailable(RuntimeError):
    """NOMADS did not give a GFS run."""


_HELD: dict = {}
_NOT_UP: dict = {}
_LOCK = threading.Lock()


def stations(fcst_hr: str = "06"):
    """The FB's stations with the GFS's levels at each, for `fcst_hr`'s
    period, as vfr.weather.parse_fd_text gives the FB's: an FdStations
    whose `period` is {"valid_at", "use_from", "use_to"} and `modelled`
    True. Held an hour; raises ModelWindsUnavailable."""
    from .weather import FdStations

    now = time.time()
    with _LOCK:
        held = _HELD.get(fcst_hr)
        if held is not None and now - held[0] < FRESH_S:
            return held[1]
        try:
            fields, valid = _fetch(fcst_hr, datetime.fromtimestamp(now, timezone.utc))
        except ModelWindsUnavailable:
            # The copy held served on to the end of its for-use window.
            if held is not None and _iso_s(held[1].period["use_to"]) > now:
                return held[1]
            raise
        out = FdStations(_at_stations(fields))
        hours = _PERIODS.get(fcst_hr, _PERIODS["06"])
        start = datetime.fromtimestamp(now, timezone.utc).replace(minute=0, second=0, microsecond=0)
        out.period = {
            "valid_at": _iso(valid),
            "use_from": _iso(start + timedelta(hours=hours[1])),
            "use_to": _iso(start + timedelta(hours=hours[2])),
        }
        out.modelled = True
        _HELD[fcst_hr] = (now, out)
        return out


def _fetch(fcst_hr: str, now: datetime) -> tuple[dict, datetime]:
    """{(var, hPa): (lats, lons, values)} from the latest run up, at the
    forecast hour nearest the period's valid time, and that time."""
    target = now + timedelta(hours=_PERIODS.get(fcst_hr, _PERIODS["06"])[0])
    latest = (now - POSTED_AFTER).replace(minute=0, second=0, microsecond=0)
    latest -= timedelta(hours=latest.hour % 6)
    for n in range(RUNS_TRIED):
        run = latest - timedelta(hours=6 * n)
        # GFS output is 3-hourly to 120 h.
        step = max(0, min(120, 3 * round((target - run).total_seconds() / 3600 / 3)))
        key = (run, step)
        if time.time() - _NOT_UP.get(key, 0) < NOT_UP_RETRY_S:
            continue
        body = _download(run, step)
        if body is None:
            _NOT_UP[key] = time.time()
            continue
        try:
            return _read(body), run + timedelta(hours=step)
        except (ValueError, RuntimeError, AttributeError) as err:
            raise ModelWindsUnavailable(f"the GFS {run:%d%H}Z f{step:03d} could not be read: {err}") from err
    raise ModelWindsUnavailable(f"no GFS run on NOMADS in the last {6 * RUNS_TRIED} hours")


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


def _read(body: bytes) -> dict:
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
    """Each FB station's levels from the grid point nearest it: {ident:
    {altitude_ft: {"wind_dir_true_deg", "wind_speed_kt", "temp_c"}}}, each
    level at its own geopotential height, which the planner's altitude
    interpolation takes as it does the FB's columns."""
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


def held_at() -> float | None:
    """When the newest copy held was fetched (UNIX seconds), for the
    Status page; None where none is."""
    return max((h[0] for h in _HELD.values()), default=None)


def _iso(at: datetime) -> str:
    return at.strftime("%Y-%m-%dT%H:%M:%SZ")


def _iso_s(text: str) -> float:
    return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
