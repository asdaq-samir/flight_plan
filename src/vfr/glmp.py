"""Modelled ceiling and visibility anywhere in the lower 48, for a field
with no weather report of its own: the National Weather Service's Gridded
LAMP (GLMP), its analysis hour ("hr00"), on the National Blend of Models'
2.5 km CONUS grid.

GLMP blends the latest observations into a statistical model and is
issued every hour at half past, from NOMADS
(nomads.ncep.noaa.gov/pub/data/nccf/com/glmp/prod), each field a GRIB2
file of about half a megabyte (MDL's GLMP v2.7 file names). It is
planning guidance, not an observation: the card says the weather is
modelled, and the pilot still reads the nearest reports and asks Flight
Service.

The two grids are read once an issue (gribberish, a GRIB2 reader of
two megabytes: ECMWF's eccodes is a hundred, with a PROJ of its own that
crashed the interpreter at exit beside pyproj's) and held as float32,
twelve megabytes each; a point is found on them through the grid's own
Lambert conformal projection, as eccodes' nearest-point search finds it
(checked at six points across the grid, 2026-10-10).
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta, timezone

import gribberish
import numpy as np
import requests
from pyproj import Proj

log = logging.getLogger(__name__)

URL = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/glmp/prod/glmp.{day}/glmp.t{hour}30z.hr00_{field}.g.co.grib2"
HEADERS = {"User-Agent": "vfr-route-learning-project/0.1"}
#: An issue is up on NOMADS a few minutes after its half past (the hr00
#: files at about HH:32 in the listing, 2026-10-10); looked for from then.
POSTED_AFTER = timedelta(minutes=5)
#: An issue not up yet is asked for again after this, not at every card.
NOT_UP_RETRY = timedelta(minutes=2)
#: How many issues back are tried before saying there is none: one late
#: issue is common, three missing is NOMADS out.
ISSUES_TRIED = 3

_M_TO_FT = 3.28084
_M_PER_SM = 1609.344
#: GLMP's ceiling where there is none: no layer broken or overcast.
_NO_CEILING_M = -100.0


class GlmpUnavailable(RuntimeError):
    """NOMADS did not give a recent issue."""


class _Grid:
    """One field's values on the NBM CONUS grid, and how to find a point
    on it."""

    def __init__(self, message: bytes):
        parsed = gribberish.parse_grib_message(message, 0)
        meta = parsed.metadata
        # The cells' centres along each axis in the projection's metres,
        # south and west first as GLMP's are; a point is found from the
        # first and the spacing.
        x, y = meta.xy()
        self.ny, self.nx = meta.grid_shape
        if len(x) != self.nx or len(y) != self.ny or self.nx < 2 or self.ny < 2:
            raise ValueError("not a regular projected grid")
        self.x0, self.dx = float(x[0]), float(x[1] - x[0])
        self.y0, self.dy = float(y[0]), float(y[1] - y[0])
        self.proj = Proj(meta.proj)
        self.valid = meta.forecast_date
        # Missing points are NaN.
        self.values = np.asarray(parsed.data(), dtype=np.float32).reshape(self.ny, self.nx)

    def at(self, lat: float, lon: float) -> float | None:
        """The value at the grid point nearest (lat, lon); None off the
        grid or where it has none."""
        x, y = self.proj(lon, lat)
        i, j = round((x - self.x0) / self.dx), round((y - self.y0) / self.dy)
        if not (0 <= i < self.nx and 0 <= j < self.ny):
            return None
        value = float(self.values[j, i])
        return None if np.isnan(value) else value


_HELD: dict = {}
#: When each issue was last found not up yet.
_NOT_UP: dict = {}
_LOCK = threading.Lock()


def _issues(now: datetime) -> list[datetime]:
    """The issues to try, the newest first: the half past most recently
    posted, and the ones before it."""
    latest = (now - POSTED_AFTER).replace(minute=30, second=0, microsecond=0)
    if latest > now - POSTED_AFTER:
        latest -= timedelta(hours=1)
    return [latest - timedelta(hours=n) for n in range(ISSUES_TRIED)]


def _fetch(issued: datetime, field: str) -> bytes | None:
    """An issue's file for `field` ("cig" or "vis"); None where it is not
    up (yet). Raises GlmpUnavailable where NOMADS does not answer."""
    url = URL.format(day=issued.strftime("%Y%m%d"), hour=issued.strftime("%H"), field=field)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
    except requests.RequestException as err:
        raise GlmpUnavailable(f"NOMADS did not answer: {err}") from err
    if resp.status_code == 404:
        return None
    if not resp.ok:
        raise GlmpUnavailable(f"NOMADS answered {resp.status_code} for {url}")
    return resp.content


def _grids(now: datetime) -> tuple[_Grid, _Grid]:
    """The latest issue's ceiling and visibility, read once an issue."""
    with _LOCK:
        issues = _issues(now)
        for gone in [issued for issued in _NOT_UP if issued not in issues]:
            del _NOT_UP[gone]
        for issued in issues:
            held = _HELD.get("issue")
            if held is not None and held[0] == issued:
                return held[1], held[2]
            if now - _NOT_UP.get(issued, datetime.min.replace(tzinfo=timezone.utc)) < NOT_UP_RETRY:
                continue
            ceiling, visibility = _fetch(issued, "cig"), _fetch(issued, "vis")
            if ceiling is None or visibility is None:
                _NOT_UP[issued] = now
                continue
            try:
                grids = _Grid(ceiling), _Grid(visibility)
            except (ValueError, RuntimeError, AttributeError) as err:
                raise GlmpUnavailable(f"GLMP's {issued:%H%M}Z issue could not be read: {err}") from err
            _HELD["issue"] = (issued, *grids)
            return grids
    raise GlmpUnavailable(f"no GLMP issue in the last {ISSUES_TRIED} hours")


def flight_category(ceiling_ft: float | None, visibility_sm: float) -> str:
    """AIM 7-1-7's categories: LIFR under a 500 ft ceiling or 1 sm; IFR
    under 1,000 ft or 3 sm; MVFR at 3,000 ft or 5 sm and under; VFR above
    both. No ceiling is no limit by ceiling."""
    ceiling = float("inf") if ceiling_ft is None else ceiling_ft
    if ceiling < 500 or visibility_sm < 1:
        return "LIFR"
    if ceiling < 1000 or visibility_sm < 3:
        return "IFR"
    if ceiling <= 3000 or visibility_sm <= 5:
        return "MVFR"
    return "VFR"


def at(lat: float, lon: float, now: datetime | None = None) -> dict | None:
    """The modelled weather at a point: {"ceiling_ft" (above the ground,
    None with no ceiling), "visibility_sm", "flight_category", "valid_at"
    (ISO, UTC)}; None off the grid. Raises GlmpUnavailable where no
    recent issue can be had."""
    ceiling_grid, visibility_grid = _grids(now or datetime.now(timezone.utc))
    ceiling_m, visibility_m = ceiling_grid.at(lat, lon), visibility_grid.at(lat, lon)
    if ceiling_m is None or visibility_m is None:
        return None
    ceiling_ft = None if ceiling_m <= _NO_CEILING_M else ceiling_m * _M_TO_FT
    visibility_sm = visibility_m / _M_PER_SM
    # The category from the figures as modelled, before they are rounded
    # to say: 3,040 ft is VFR, though it reads 3,000.
    return {
        "ceiling_ft": None if ceiling_ft is None else round(ceiling_ft, -2),
        "visibility_sm": round(visibility_sm, 1),
        "flight_category": flight_category(ceiling_ft, visibility_sm),
        "valid_at": ceiling_grid.valid.isoformat().replace("+00:00", "Z"),
    }
