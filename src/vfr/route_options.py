"""Ways to fly a route, for the pilot to pick from: the fastest, the one
in the best weather and the one with the fewest stops, each kept clear of
what an airplane under VFR must keep clear of, at the owner's ask ("smart
to reroute for fastest time along safe weather, over terrain, best
tailwinds, refueling and giving pilot flexibility to make changes as they
please", 2026-10-23).

A grid of cells round the route is read once:

- the ground, as vfr.terrain_detour reads it, a cell closed where its
  highest ground and 14 CFR 91.119's 1,000 ft (with the coarse read's
  margin) is over the highest VFR cruising altitude the airplane reaches;
- the weather over the flight's time: a TAF's worst in the window, and a
  METAR for a flight leaving soon, under the pilot's minimums -- never
  under 91.155's basic ones -- closes the cells round its field, and one
  in MVFR marks them marginal;
- the G-AIRMETs between the fields: IFR and mountains obscured closed,
  low-level turbulence, icing and wind shear marginal;
- thunderstorms, by AIM 7-1-27's "avoid by at least 20 miles": a TAF or a
  METAR with TS or VCTS, and a convective SIGMET's area, close the cells
  within 20 nm; any other SIGMET under 18,000 ft (severe turbulence or
  icing, IFR, obscuration, ash) closes its own area;
- prohibited areas (91.133) and the TFRs in force over the flight
  (91.137 to 91.145) close their cells; restricted areas, MOAs and warning
  areas, whose times of use are not read here, mark them marginal;
- large water (vfr.water): the share of each cell out of a glide's
  reach of dry land, dearer for the way that keeps over land;
- the winds aloft (the FD product for the flight's hour), the best
  groundspeed in each direction at the legal cruising altitudes (91.159)
  over the cell's ground.

The quickest way over open cells (A*, in minutes) is the fastest; the same
with marginal cells costing more is the best weather's. Each is
straightened where a straight line keeps to open cells and loses no more
than a minute, and its turns named as points of the pilot's own off the
nearest fix (vfr.fixes.frd_near). The fuel stops along it are the fields
with 100LL on a paved runway (vfr.fuelstops' fields) that land with the
reserve (91.151) each time: fewest minutes, each stop the owner's 30 on
the ground, for those two; fewest landings for the third.

It only suggests. A way picked is planned as any route is, its altitudes,
cloud clearance, airspace and fuel checked leg by leg at full resolution;
the coarse read here can be wrong, and the plan says so where it is.
"""
from __future__ import annotations

import heapq
import math
import re
import time
from datetime import datetime, timezone

import logging

import numpy as np

from . import fixes, fuelstops, geo, navlog, sun, terrain_detour, water, weather

logger = logging.getLogger(__name__)

#: The grid's cells, degrees: about 15 nm, as the terrain way round's.
CELL_DEG = 0.25
#: How far round the route the grid reaches, a share of its length,
#: degrees at least and at most: room to go round a line of storms.
REACH_SHARE = 0.3
REACH_MIN_DEG, REACH_MAX_DEG = 1.0, 3.0
#: AIM 7-1-27, Thunderstorm Flying: "avoid by at least 20 miles any
#: thunderstorm identified as severe or giving an intense radar echo" --
#: kept for every one forecast or reported, as a light airplane has no
#: radar to tell which.
STORM_NM = 20.0
#: How far round a field its report or forecast is taken to hold: a TAF
#: is for 5 sm round the field (AC 00-45H), twice that here.
FIELD_WX_NM = 10.0
#: And how far round a field in MVFR the cells are marginal: the planner's
#: own figure, not a rule's -- a reporting field is some 30 nm from the
#: next in most of the country, so a marginal report colours the way to it.
MARGINAL_NM = 30.0
#: 14 CFR 91.155(a) and (c): 3 sm in Class E under 10,000 ft, and no VFR
#: under a ceiling below 1,000 ft in a surface area -- the least any
#: minimums here come to, whatever the pilot's own.
LEGAL_CEILING_FT = 1000.0
LEGAL_VISIBILITY_SM = 3.0
#: AC 00-45H's flight categories: under these, MVFR.
MVFR_CEILING_FT = 3000.0
MVFR_VISIBILITY_SM = 5.0
#: A METAR is read for a flight leaving within this long, s; later, the
#: TAFs alone, as a report is of now.
METAR_AHEAD_S = 2 * 3600
#: SIGMETs reaching below this, ft, are a light airplane's (Class A from
#: 18,000 ft, 14 CFR 71.33).
SIGMET_BELOW_FT = 18000.0
#: What a marginal cell costs more, a share of its minutes, for the best
#: weather's way; and a restricted area's, for every way.
MARGINAL_COST = 1.0
SPECIAL_USE_COST = 0.5
#: A straight line taken over the grid's way when it is no more than this
#: many minutes slower; more, a step at a time, for a way of more than
#: MAX_TURNS turns, which a pilot would not fly.
STRAIGHTEN_MIN = 1.0
STRAIGHTEN_STEPS_MIN = (1.0, 3.0, 6.0, 12.0, 24.0)
MAX_TURNS = 8
#: Where no way keeps clear of everything -- the Rockies in an airplane
#: that cannot top them, a field under a G-AIRMET -- the way that crosses
#: least of it, a closed cell costing this many times its minutes more:
#: offered with what it crosses said, the owner's rule ("I don't want to
#: put hard limits on anything. A warning tick or a label is enough",
#: 2026-10-23).
CLOSED_COST = 20.0
#: The fields with fuel looked at for a stop, nm off the way.
STOP_FIELD_NM = 15.0
#: Minutes on the ground at each stop: the owner's 30-minute turnaround
#: (2026-10-20), the planner's own (app.routers.plan.TURNAROUND_MIN).
TURNAROUND_MIN = 30.0
#: The airplane is taken to climb to cruise from no lower than this, ft:
#: the planner's own figure, the lowest a cross-country is flown over
#: level ground (91.119(c)'s 500 ft and the altitudes the plan picks).
LOWEST_CRUISE_FT = 2500.0
#: The kinds of way, in the order they are offered.
KINDS = ("fastest", "weather", "stops", "land")
TITLES = {"fastest": "Fastest", "weather": "Best weather", "stops": "Fewest stops", "land": "Over land"}
#: How much dearer a cell out of glide of dry land is for the way that
#: keeps over land, a share of its own minutes: eleven times as dear, so
#: it goes round Lake Michigan from Milwaukee to Muskegon (an hour and a
#: quarter more; at four times as dear it crossed the 51 nm of water), and
#: only crosses where going round is the longer by hours (the owner's
#: ask, 2026-10-25: "for engine failure emergency, landing is feasible on
#: a dry land"; vfr.water).
WATER_COST = 10.0

#: How many minutes more a fuel stop in marginal weather costs than one in
#: the clear, three times that for the best weather's way: the planner's
#: own figure, half an hour's flying past one to a field in VFR.
MARGINAL_STOP_MIN = 30.0

#: The eight ways out of a cell: (rows, columns).
_STEPS = [(dr, dc) for dr in (-1, 0, 1) for dc in (-1, 0, 1) if dr or dc]


class _Grid:
    """The cells round a route: where each is, its ground, what closes it
    and what makes it marginal, and its best groundspeed each way."""

    def __init__(self, start: tuple, end: tuple, via: list[tuple] | tuple = ()):
        span = float(geo.distance_nm(start[0], start[1], end[0], end[1])) / 60.0
        reach = min(REACH_MAX_DEG, max(REACH_MIN_DEG, span * REACH_SHARE))
        # Round the pilot's own points too (`via`): a point outside the grid
        # was clamped to its edge, and the route read against cells it never
        # flew (the audit of 2026-10-24).
        points = [start, end, *via]
        lats, lons = [p[0] for p in points], [p[1] for p in points]
        self.lat0 = min(lats) - reach
        self.lon0 = min(lons) - reach / max(0.2, math.cos(math.radians((start[0] + end[0]) / 2)))
        self.rows = int(math.ceil((max(lats) + reach - self.lat0) / CELL_DEG))
        lon_reach = (min(lons) - self.lon0)
        self.cols = int(math.ceil((max(lons) + lon_reach - self.lon0) / CELL_DEG))
        self.lats = self.lat0 + (np.arange(self.rows) + 0.5) * CELL_DEG
        self.lons = self.lon0 + (np.arange(self.cols) + 0.5) * CELL_DEG
        self.lat_grid, self.lon_grid = np.meshgrid(self.lats, self.lons, indexing="ij")
        #: The hazard (an index into `hazards`) that closes each cell, -1 open.
        self.closed = np.full((self.rows, self.cols), -1, dtype=int)
        #: The hazard that makes each cell marginal, -1 none.
        self.marginal = np.full((self.rows, self.cols), -1, dtype=int)
        #: What costs more to cross, for every way: special-use airspace.
        self.dear = np.zeros((self.rows, self.cols))
        #: The share of each cell out of glide of dry land, 0 to 1 (vfr.water).
        self.offshore = np.zeros((self.rows, self.cols))
        self.hazards: list[dict] = []
        #: Each cell's floor, ft (_ground), once read.
        self.floor: np.ndarray | None = None
        self.ends: set = {self.cell(start), self.cell(end)}

    def bbox(self) -> tuple:
        return (self.lat0, self.lon0, self.lat0 + self.rows * CELL_DEG, self.lon0 + self.cols * CELL_DEG)

    def cell(self, point: tuple) -> tuple[int, int]:
        r = int((point[0] - self.lat0) / CELL_DEG)
        c = int((point[1] - self.lon0) / CELL_DEG)
        return min(max(r, 0), self.rows - 1), min(max(c, 0), self.cols - 1)

    def centre(self, cell: tuple[int, int]) -> tuple[float, float]:
        return float(self.lats[cell[0]]), float(self.lons[cell[1]])

    def hazard(self, kind: str, name: str) -> int:
        """The index of a hazard, the same one for the same words."""
        for i, h in enumerate(self.hazards):
            if h["kind"] == kind and h["name"] == name:
                return i
        self.hazards.append({"kind": kind, "name": name})
        return len(self.hazards) - 1

    def close(self, mask: np.ndarray, kind: str, name: str) -> None:
        if mask.any():
            self.closed[mask & (self.closed < 0)] = self.hazard(kind, name)

    def mark(self, mask: np.ndarray, kind: str, name: str) -> None:
        if mask.any():
            self.marginal[mask & (self.marginal < 0)] = self.hazard(kind, name)

    def near(self, lat: float, lon: float, nm: float) -> np.ndarray:
        return geo.distance_nm(lat, lon, self.lat_grid, self.lon_grid) <= nm

    def open(self, cell: tuple[int, int]) -> bool:
        return self.closed[cell] < 0 or cell in self.ends

    def line_cells(self, a: tuple, b: tuple) -> list[tuple[int, int]]:
        # Sampled a third of a cell apart, all at once: a point at a time,
        # with a call per point, was a long route's second and a half.
        steps = max(2, int(max(abs(b[0] - a[0]), abs(b[1] - a[1])) / (CELL_DEG / 3)) + 1)
        t = np.linspace(0.0, 1.0, steps)
        rows = np.clip(((a[0] + (b[0] - a[0]) * t - self.lat0) / CELL_DEG).astype(int), 0, self.rows - 1)
        cols = np.clip(((a[1] + (b[1] - a[1]) * t - self.lon0) / CELL_DEG).astype(int), 0, self.cols - 1)
        keep = np.ones(steps, dtype=bool)
        keep[1:] = (rows[1:] != rows[:-1]) | (cols[1:] != cols[:-1])
        return list(zip(rows[keep].tolist(), cols[keep].tolist()))

    def line_open(self, a: tuple, b: tuple) -> bool:
        return all(self.open(c) for c in self.line_cells(a, b))


# --- What closes a cell ---


def _ground(grid: _Grid, top_ft: float) -> np.ndarray:
    """Each cell's floor, ft: its highest ground and 91.119's 1,000 ft,
    with the coarse read's margin (vfr.terrain_detour); cells whose floor
    is over `top_ft` closed."""
    step = CELL_DEG / 5
    lats = grid.lat0 + (np.arange(grid.rows * 5) + 0.5) * step
    lons = grid.lon0 + (np.arange(grid.cols * 5) + 0.5) * step
    heights = terrain_detour._heights_ft(*np.meshgrid(lats, lons, indexing="ij"))
    highest = heights.reshape(grid.rows, 5, grid.cols, 5).max(axis=(1, 3))
    floor = highest + terrain_detour.TERRAIN_MARGIN_FT + terrain_detour.COARSE_MARGIN_FT
    grid.close(floor > top_ft, "terrain", "High ground above the airplane's ceiling")
    return floor


def _storm(wx: str) -> bool:
    """Whether a report's or a forecast's weather has a thunderstorm in
    it, at the field or in its vicinity (TS, VCTS, TSRA, +TSGR ...)."""
    return "TS" in (wx or "").upper()


def _weather(grid: _Grid, window: tuple, ceiling_ft: float, visibility_sm: float) -> None:
    """The fields' TAFs over the flight's time, and their METARs for a
    flight leaving soon: under the minimums closes the cells round them,
    MVFR marks them, a thunderstorm closes STORM_NM round."""
    s, w, n, e = grid.bbox()
    start, end = window
    seen = set()
    for station in weather._dataset("tafs"):
        lat, lon = station["lat"], station["lon"]
        if not (s <= lat <= n and w <= lon <= e):
            continue
        periods = weather._periods_in_window(station["fcsts"], start, end)
        if not periods:
            continue
        seen.add(station["icaoId"])
        ident = station["icaoId"]
        if any(_storm(p.get("wx")) for p in periods):
            grid.close(grid.near(lat, lon, STORM_NM), "storm", f"Thunderstorms forecast at {ident}")
        worst = weather._worst_in_window(station["fcsts"], start, end) or {}
        _field_weather(grid, ident, lat, lon, worst.get("ceiling_ft"), worst.get("visibility_sm"),
                       ceiling_ft, visibility_sm, "forecast")
    if start - time.time() > METAR_AHEAD_S:
        return
    for ident, report in weather._dataset("metars").items():
        lat, lon = report.get("lat"), report.get("lon")
        if lat is None or lon is None or not (s <= lat <= n and w <= lon <= e):
            continue
        if _storm(report.get("wx")):
            grid.close(grid.near(lat, lon, STORM_NM), "storm", f"Thunderstorm reported at {ident}")
        if ident in seen:
            continue
        _field_weather(grid, ident, lat, lon, report.get("ceiling_ft"), report.get("visibility_sm"),
                       ceiling_ft, visibility_sm, "reported")


def _field_weather(grid: _Grid, ident: str, lat: float, lon: float, ceiling, visibility,
                   min_ceiling_ft: float, min_visibility_sm: float, how: str) -> None:
    low = (ceiling is not None and ceiling < min_ceiling_ft) or (visibility is not None and visibility < min_visibility_sm)
    words = ", ".join(w for w in (
        f"ceiling {int(ceiling):,} ft" if ceiling is not None else "",
        f"visibility {visibility:g} sm" if visibility is not None else "",
    ) if w)
    if low:
        grid.close(grid.near(lat, lon, FIELD_WX_NM), "weather", f"{ident} {how} under minimums ({words})")
    # Inclusive: AIM 7-1-7's MVFR is a ceiling of 1,000 to 3,000 ft and/or
    # visibility 3 to 5 miles, so exactly 3,000 ft or 5 miles is marginal.
    elif (ceiling is not None and ceiling <= MVFR_CEILING_FT) or (visibility is not None and visibility <= MVFR_VISIBILITY_SM):
        grid.mark(grid.near(lat, lon, MARGINAL_NM), "marginal", f"{ident} {how} marginal ({words})")


def _sigmets(grid: _Grid, window: tuple) -> None:
    """SIGMETs over the flight's time: a convective one's area and
    STORM_NM round it closed, any other reaching under SIGMET_BELOW_FT its
    own area."""
    import shapely
    from shapely.geometry import Polygon

    start, end = window
    for advisory in weather._dataset("airsigmets"):
        if advisory.get("valid_to") is not None and advisory["valid_to"] <= start:
            continue
        if advisory.get("valid_from") is not None and advisory["valid_from"] > end:
            continue
        coords = advisory.get("coords") or []
        if len(coords) < 3:
            continue
        low = advisory.get("altitude_low_ft")
        if low is not None and low >= SIGMET_BELOW_FT:
            continue
        hazard = (advisory.get("hazard") or "").upper()
        area = Polygon([(lon, lat) for lat, lon in coords])
        if not area.is_valid:
            area = area.buffer(0)
        convective = hazard.startswith("CONVECTIVE")
        if convective:
            # Degrees of latitude: a cell's own size is the read's limit.
            area = area.buffer(STORM_NM / 60.0)
        mask = shapely.contains_xy(area, grid.lon_grid, grid.lat_grid)
        raw = (advisory.get("raw") or "").split("\n")[0][:60].strip()
        if convective:
            grid.close(mask, "storm", f"Convective SIGMET {raw}".strip())
        else:
            grid.close(mask, "sigmet", f"SIGMET for {hazard.lower() or 'a hazard'} {raw}".strip())


#: The G-AIRMETs that close cells -- IFR and mountains obscured, where VFR
#: is not to be had (AIM 7-1-6, the G-AIRMET) -- and those that mark them
#: marginal.
GAIRMET_CLOSES = {"IFR conditions", "Mountains obscured"}
GAIRMET_MARKS = {"Turbulence", "Icing", "Low-level wind shear"}


def _gairmets(grid: _Grid, window: tuple, top_ft: float) -> None:
    """The G-AIRMETs valid over the flight (each a snapshot, three hours
    apart, taken within GAIRMET_SNAPSHOT_S of it): the weather between the
    fields that report, which their TAFs and METARs alone left open. IFR
    and mountain obscuration close their areas; low-level turbulence,
    icing reaching under the airplane's top and wind shear mark theirs."""
    import shapely
    from shapely.geometry import Polygon

    start, end = window
    for advisory in weather._dataset("gairmets"):
        valid = advisory.get("valid")
        if valid is None or valid < start - weather.GAIRMET_SNAPSHOT_S or valid > end + weather.GAIRMET_SNAPSHOT_S:
            continue
        coords = advisory.get("coords") or []
        hazard = advisory.get("hazard")
        if len(coords) < 3 or hazard not in GAIRMET_CLOSES | GAIRMET_MARKS:
            continue
        low = advisory.get("altitude_low_ft")
        if hazard == "Icing" and low is not None and low >= top_ft:
            continue
        area = Polygon([(lon, lat) for lat, lon in coords])
        if not area.is_valid:
            area = area.buffer(0)
        mask = shapely.contains_xy(area, grid.lon_grid, grid.lat_grid)
        # "IFR conditions" as it is, "Mountains obscured" in the line.
        words = hazard if hazard[:2].isupper() else hazard[0].lower() + hazard[1:]
        name = f"G-AIRMET for {words}"
        if hazard in GAIRMET_CLOSES:
            grid.close(mask, "weather", name)
        else:
            grid.mark(mask, "marginal", name)


def _airspace(grid: _Grid, window: tuple) -> list[str]:
    """Prohibited areas and the TFRs in force over the flight closed;
    restricted, MOA, warning and alert areas dearer. What could not be
    read, named, so the page says it was not checked."""
    import shapely
    from shapely.geometry import shape

    from . import sua, tfr

    unread = []
    margin = 1.0 / 60.0
    try:
        for area, geometry in sua.areas_in(grid.bbox()):
            kind = area.get("type") or ""
            if kind == "P":
                mask = shapely.contains_xy(geometry.buffer(margin), grid.lon_grid, grid.lat_grid)
                grid.close(mask, "prohibited", f"Prohibited area {area.get('name')}")
            elif kind in ("R", "MOA", "W", "A"):
                mask = shapely.contains_xy(geometry, grid.lon_grid, grid.lat_grid)
                grid.dear[mask] = np.maximum(grid.dear[mask], SPECIAL_USE_COST)
    except Exception:  # noqa: BLE001 -- a source down is said, not raised
        unread.append("special-use airspace")
    try:
        start = datetime.fromtimestamp(window[0], timezone.utc)
        end = datetime.fromtimestamp(window[1], timezone.utc)
        for one in tfr.all_tfrs():
            if not tfr.in_force(one, start, end):
                continue
            geometry = shape(one["geometry"]).buffer(margin)
            mask = shapely.contains_xy(geometry, grid.lon_grid, grid.lat_grid)
            grid.close(mask, "tfr", f"TFR {one.get('notam_id') or ''} {one.get('title') or ''}".strip())
    except Exception:  # noqa: BLE001
        unread.append("TFRs")
    return unread


# --- The winds ---


def _cruising_altitudes(top_ft: float) -> np.ndarray:
    """Every VFR cruising altitude to the airplane's top (91.159: odd
    thousands plus 500 eastbound, even westbound), from 3,500 ft."""
    return np.arange(3500.0, top_ft + 1.0, 1000.0)


def _groundspeeds(grid: _Grid, floor: np.ndarray, top_ft: float, tas_kt: float, fcst_hr: str) -> np.ndarray:
    """Each cell's best groundspeed, kt, out each of the eight ways
    (_STEPS), at the legal cruising altitudes over its floor -- the
    direction's own thousands (91.159, by the true course here: the plan
    picks the altitudes by the magnetic one) -- in the nearest FD station's
    winds. TAS where there are no winds."""
    altitudes = _cruising_altitudes(top_ft)
    out = np.full((grid.rows, grid.cols, len(_STEPS)), float(tas_kt))
    if len(altitudes) == 0:
        return out
    try:
        codes, lats, lons, levels = weather.wind_stations(fcst_hr)
    except weather.WeatherServiceError:
        return out
    if len(codes) == 0:
        return out
    # Each station's wind at each altitude, as (from-direction, speed).
    wd = np.zeros((len(codes), len(altitudes)))
    ws = np.zeros((len(codes), len(altitudes)))
    for i, station in enumerate(levels):
        for j, alt in enumerate(altitudes):
            wind = weather.wind_in_levels(station, float(alt))
            if wind:
                wd[i, j], ws[i, j] = wind["wind_dir_true_deg"], wind["wind_speed_kt"]
    flat_lat, flat_lon = grid.lat_grid.ravel(), grid.lon_grid.ravel()
    nearest = np.empty(flat_lat.size, dtype=int)
    for k in range(0, flat_lat.size, 2048):
        d = geo.distance_nm(flat_lat[k:k + 2048, None], flat_lon[k:k + 2048, None], lats[None, :], lons[None, :])
        nearest[k:k + 2048] = np.argmin(d, axis=1)
    nearest = nearest.reshape(grid.rows, grid.cols)
    cell_wd, cell_ws = wd[nearest], ws[nearest]          # rows x cols x altitudes
    allowed = altitudes[None, None, :] >= np.maximum(floor, LOWEST_CRUISE_FT)[:, :, None]
    for k, (dr, dc) in enumerate(_STEPS):
        course = np.degrees(np.arctan2(dc * np.cos(np.radians(grid.lat_grid)), dr)) % 360.0
        east = (course < 180.0)[:, :, None]
        odd = ((altitudes // 1000) % 2 == 1)[None, None, :]
        legal = allowed & (east == odd)
        angle = np.radians(cell_wd - course[:, :, None])
        head = cell_ws * np.cos(angle)
        cross = cell_ws * np.sin(angle)
        along = np.sqrt(np.maximum(tas_kt ** 2 - cross ** 2, 1.0)) - head
        gs = np.where(legal, np.maximum(along, 1.0), -np.inf).max(axis=2)
        out[:, :, k] = np.where(np.isfinite(gs), gs, float(tas_kt))
    return out


# --- The ways ---


def _step_index(dr: int, dc: int) -> int:
    return _STEPS.index((dr, dc))


#: The earth's radius for the search's guess, nm: the mean radius
#: (3,440.07 nm) less 1 %, under the WGS 84 geodesic everywhere (the
#: sphere's error is under 0.6 %), so the guess never overestimates.
HAVERSINE_NM = 3440.07 * 0.99


def _way(grid: _Grid, gs: np.ndarray, start: tuple, end: tuple, marginal_cost: float,
         closed_cost: float | None = None, water_cost: float = 0.0) -> list[tuple[int, int]] | None:
    """The quickest way over open cells from start's cell to end's (A*,
    minutes), marginal cells costing `marginal_cost` more of theirs and
    special-use airspace its own; with `closed_cost`, over closed cells
    too, each that much the dearer."""
    s, e = grid.cell(start), grid.cell(end)
    fastest = float(gs.max())
    # A step's miles hang on its row and its way alone: worked out once,
    # eight calls in all, where each step asked the geodesic again -- 50,000
    # of them for a 900 nm route, most of its seconds (measured 2026-10-25).
    lats = grid.lat0 + (np.arange(grid.rows) + 0.5) * CELL_DEG
    step_nm = np.stack([np.asarray(geo.distance_nm(lats, 0.0, lats + dr * CELL_DEG, dc * CELL_DEG), dtype=float)
                        for dr, dc in _STEPS], axis=1)
    end_lat, end_lon = grid.centre(e)
    cos_end = math.cos(math.radians(end_lat))
    weight = 1.0 + grid.dear + np.where(grid.marginal >= 0, marginal_cost, 0.0) + water_cost * grid.offshore
    if closed_cost is not None:
        weight = weight + np.where(grid.closed >= 0, closed_cost, 0.0)

    def minutes(a, b) -> float:
        k = _step_index(b[0] - a[0], b[1] - a[1])
        return float(step_nm[a[0], k]) / gs[a[0], a[1], k] * 60.0 * weight[b]

    def guess(a) -> float:
        # The great circle on a sphere a little small (HAVERSINE_NM): never
        # more than the way's geodesic miles, so the search stays exact.
        la, lo = grid.centre(a)
        dlat, dlon = math.radians(end_lat - la), math.radians(end_lon - lo)
        h = math.sin(dlat / 2) ** 2 + math.cos(math.radians(la)) * cos_end * math.sin(dlon / 2) ** 2
        return 2.0 * HAVERSINE_NM * math.asin(min(1.0, math.sqrt(h))) / fastest * 60.0

    frontier = [(0.0, s)]
    came: dict = {s: None}
    spent = {s: 0.0}
    while frontier:
        _, here = heapq.heappop(frontier)
        if here == e:
            path = [here]
            while came[path[-1]] is not None:
                path.append(came[path[-1]])
            return path[::-1]
        for dr, dc in _STEPS:
            nxt = (here[0] + dr, here[1] + dc)
            if not (0 <= nxt[0] < grid.rows and 0 <= nxt[1] < grid.cols):
                continue
            if closed_cost is None and not grid.open(nxt):
                continue
            g = spent[here] + minutes(here, nxt)
            if g < spent.get(nxt, math.inf):
                spent[nxt], came[nxt] = g, here
                heapq.heappush(frontier, (g + guess(nxt), nxt))
    return None


def _line_minutes(grid: _Grid, gs: np.ndarray, a: tuple, b: tuple, marginal_cost: float = 0.0,
                  water_cost: float = 0.0) -> float:
    """The minutes from a to b in a straight line, at each cell's best
    groundspeed the way nearest the line's, marginal cells and those out
    of glide of land the dearer."""
    nm = float(geo.distance_nm(a[0], a[1], b[0], b[1]))
    if nm == 0:
        return 0.0
    bearing = math.atan2((b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2)), b[0] - a[0])
    # The nearest of the eight ways: |cos| or |sin| is at least 0.71, so
    # one of the two rounds to a whole step.
    k = _step_index(round(math.cos(bearing)), round(math.sin(bearing)))
    cells = grid.line_cells(a, b)
    rate = [(1.0 + grid.dear[c] + (marginal_cost if grid.marginal[c] >= 0 else 0.0) + water_cost * grid.offshore[c]) / gs[c[0], c[1], k]
            for c in cells]
    return nm * float(np.mean(rate)) * 60.0


def _straightened(grid: _Grid, gs: np.ndarray, points: list[tuple], marginal_cost: float,
                  slower_min: float = STRAIGHTEN_MIN, water_cost: float = 0.0) -> list[tuple]:
    """The way's turns: from each point the farthest on along it a straight
    line reaches over open cells -- over no more closed ones than the way
    itself crossed, where it had to -- no more than `slower_min` slower."""
    out, i = [points[0]], 0
    legs = [_line_minutes(grid, gs, points[k], points[k + 1], marginal_cost, water_cost) for k in range(len(points) - 1)]

    def marginal_cells(a, b) -> int:
        return sum(1 for c in grid.line_cells(a, b) if grid.marginal[c] >= 0)

    def closed_cells(a, b) -> int:
        return sum(1 for c in grid.line_cells(a, b) if not grid.open(c))

    # Each leg's closed cells, once: asked again for every pair of points.
    leg_closed = [{c for c in grid.line_cells(points[k], points[k + 1]) if not grid.open(c)} for k in range(len(points) - 1)]

    def clear_enough(i: int, j: int) -> bool:
        # The way's closed cells as a set: the cell at a turn is on both
        # its legs, and counted twice let a shortcut through one more.
        crossed = set().union(*leg_closed[i:j])
        return grid.line_open(points[i], points[j]) or closed_cells(points[i], points[j]) <= len(crossed)

    while i < len(points) - 1:
        j = len(points) - 1
        while j > i + 1:
            # The best weather's way kept off marginal cells its own way
            # kept off: a short cut across the corner of one is the
            # weather it was drawn round.
            if clear_enough(i, j) and \
                    _line_minutes(grid, gs, points[i], points[j], marginal_cost, water_cost) <= sum(legs[i:j]) + slower_min and \
                    (not marginal_cost or marginal_cells(points[i], points[j])
                     <= sum(marginal_cells(points[k], points[k + 1]) for k in range(i, j))):
                break
            j -= 1
        out.append(points[j])
        i = j
    return out


def _crossed(grid: _Grid, points: list[tuple], marginal: bool = False) -> list[int]:
    """The hazards a way through `points` crosses -- those that close a
    cell, or (`marginal`) those that make one marginal -- in order, each
    once."""
    out: list[int] = []
    over = grid.marginal if marginal else grid.closed
    for a, b in zip(points, points[1:]):
        for c in grid.line_cells(a, b):
            h = over[c]
            if h >= 0 and c not in grid.ends and h not in out:
                out.append(int(h))
    return out


def _stops(grid: _Grid, gs: np.ndarray, way: list[tuple], profile: dict, fields, reserve_gal: float,
           fewest: bool, marginal_stop_min: float = MARGINAL_STOP_MIN) -> list[dict] | None:
    """The fields to land at for fuel along the way: those with 100LL on a
    paved runway (vfr.fuelstops) within STOP_FIELD_NM of it, in open
    cells, each flight landing with `reserve_gal` (91.151) -- the fewest
    minutes, TURNAROUND_MIN at each, or the fewest landings (`fewest`).
    Not a field whose way in or out from the way crosses a closed cell, nor
    one closed itself; one in marginal weather costing `marginal_stop_min`
    more, so a field in the clear a little further on is landed at instead
    (the owner's "Or even a different fuel stop to avoid weather?",
    2026-10-25). [] where the tanks reach; None where no chain of fields does (or no
    table of fields could be had)."""
    tas = max(float(profile["cruise_tas_kt"]), 1.0)
    gph = float(profile["fuel_burn_gph"])
    usable = float(profile.get("usable_fuel_gal") or 0.0)
    taxi = float(profile.get("taxi_fuel_gal") or 0.0)
    reach_gal = usable - taxi - reserve_gal
    if usable <= 0 or gph <= 0 or reach_gal <= 0:
        return []
    # The way as distance and minutes along it, at each turn.
    along_nm, along_min = [0.0], [0.0]
    for a, b in zip(way, way[1:]):
        along_nm.append(along_nm[-1] + float(geo.distance_nm(a[0], a[1], b[0], b[1])))
        along_min.append(along_min[-1] + _line_minutes(grid, gs, a, b))
    total_min = along_min[-1]
    if total_min / 60.0 * gph <= reach_gal:
        return []
    if fields is None or len(fields) == 0:
        return None
    # Only the fields round the way: the whole country's, asked their
    # distance at every sample, were a 900 nm route's two seconds.
    lats_w, lons_w = [p[0] for p in way], [p[1] for p in way]
    pad_lat = STOP_FIELD_NM / 60.0 + 0.1
    pad_lon = pad_lat / max(0.2, math.cos(math.radians(max(abs(min(lats_w)), abs(max(lats_w))) + pad_lat)))
    near = fields[(fields["lat"] >= min(lats_w) - pad_lat) & (fields["lat"] <= max(lats_w) + pad_lat)
                  & (fields["lon"] >= min(lons_w) - pad_lon) & (fields["lon"] <= max(lons_w) + pad_lon)]
    if len(near) == 0:
        return None
    fields = near
    # Each field's nearest point on the way: how far along, how far off.
    lat_f, lon_f = fields["lat"].to_numpy(float), fields["lon"].to_numpy(float)
    best_off = np.full(len(lat_f), np.inf)
    best_at = np.zeros(len(lat_f))
    # Where on the way each is nearest, for its way in and out.
    best_lat = np.zeros(len(lat_f))
    best_lon = np.zeros(len(lat_f))
    for k, (a, b) in enumerate(zip(way, way[1:])):
        seg = along_nm[k + 1] - along_nm[k]
        for t in np.linspace(0.0, 1.0, max(2, int(seg / 5) + 1)):
            lat, lon = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            off = geo.distance_nm(lat, lon, lat_f, lon_f)
            closer = off < best_off
            best_off[closer] = off[closer]
            best_at[closer] = along_min[k] + (along_min[k + 1] - along_min[k]) * t
            best_lat[closer], best_lon[closer] = lat, lon
    nodes = [{"at": 0.0, "off": 0.0}]
    for i in np.argsort(best_at):
        if best_off[i] > STOP_FIELD_NM or not (0.0 < best_at[i] < total_min):
            continue
        row = fields.iloc[int(i)]
        cell = grid.cell((lat_f[i], lon_f[i]))
        if grid.closed[cell] >= 0:
            continue
        # Its way in and out from the way: not through a storm or weather
        # under the minimums the way itself went round.
        if not grid.line_open((float(best_lat[i]), float(best_lon[i])), (float(lat_f[i]), float(lon_f[i]))):
            continue
        runway = max(fuelstops.paved_runway_ft(row["ident"]), fuelstops.paved_runway_ft(row["faa_ident"]))
        if runway < fuelstops.MIN_RUNWAY_FT:
            continue
        nodes.append({"at": float(best_at[i]), "off": float(best_off[i]), "ident": str(row["ident"]),
                      "name": str(row["name"]), "lat": float(lat_f[i]), "lon": float(lon_f[i]),
                      "dear": marginal_stop_min if grid.marginal[cell] >= 0 else 0.0})
    nodes.append({"at": total_min, "off": 0.0})
    count = len(nodes)
    best = [math.inf] * count
    prev: list = [None] * count
    best[0] = 0.0
    for j in range(1, count):
        for i in range(j):
            if not math.isfinite(best[i]):
                continue
            minutes = nodes[j]["at"] - nodes[i]["at"] + (nodes[i]["off"] + nodes[j]["off"]) / tas * 60.0
            if minutes / 60.0 * gph > reach_gal:
                continue
            landing = 0.0 if j == count - 1 else (1e6 if fewest else 0.0) + TURNAROUND_MIN + nodes[j]["dear"]
            cost = best[i] + minutes + landing
            if cost < best[j]:
                best[j], prev[j] = cost, i
    if not math.isfinite(best[-1]):
        return None
    chain, at = [], prev[-1]
    while at not in (None, 0):
        chain.append(nodes[at])
        at = prev[at]
    return chain[::-1]


def options(dep: dict, dest: dict, profile: dict, *, depart: datetime | None = None, fcst_hr: str = "06",
            min_ceiling_ft: float | None = None, min_visibility_sm: float | None = None,
            current: list[tuple] | None = None, current_idents: list[str] | None = None,
            current_landed: list[bool] | None = None, fields=None) -> dict:
    """The ways to fly from `dep` to `dest` ({"ident", "lat", "lon"}) in
    an airplane of `profile` (vfr.aircraft's: cruise_tas_kt, fuel_burn_gph,
    usable_fuel_gal, service_ceiling_ft): {"options": [{"kind", "title",
    "stops" (the route's points between its ends, in order), "fuel" (those
    of them landed at for fuel), "path" [[lat, lon]], "distance_nm",
    "air_min", "ground_min", "fuel_gal", "landings", "crosses", "marginal",
    "kinds"}], "direct" (the hazards the straight line crosses), "ends"
    (those at the departure or the destination themselves), "hazards"
    (each {"kind", "name"}, indexed by the lists), "current" and
    "current_marginal" (what the pilot's own route through `current`,
    [(lat, lon)] from end to end, crosses and passes: the pilot's way is
    kept, and what it meets said), "unchecked" (the sources that could
    not be read)}. Weather is held to the pilot's minimums
    where given, never under 91.155's (LEGAL_*)."""
    start, end = (dep["lat"], dep["lon"]), (dest["lat"], dest["lon"])
    # A naive time is UTC, as the plan's API takes it.
    leave = (depart.replace(tzinfo=depart.tzinfo or timezone.utc) if depart else datetime.now(timezone.utc)).timestamp()
    tas = max(float(profile["cruise_tas_kt"]), 1.0)
    direct_nm = float(geo.distance_nm(start[0], start[1], end[0], end[1]))
    # The flight's time, for the forecasts read: the straight line's with
    # an hour's room for stops and a way round.
    window = (leave, leave + (direct_nm / tas * 1.3 + 1.0) * 3600.0)
    top = terrain_detour.highest_cruise_ft(float(profile.get("service_ceiling_ft") or 12000.0))
    ceiling = max(LEGAL_CEILING_FT, float(min_ceiling_ft or 0.0))
    visibility = max(LEGAL_VISIBILITY_SM, float(min_visibility_sm or 0.0))

    grid = _Grid(start, end, current or ())
    unchecked: list[str] = []
    try:
        floor = _ground(grid, top)
    except (OSError, ValueError) as error:
        # The terrain tiles not to be had (requests' errors are OSErrors):
        # the ways offered over level ground, and the pilot told, as the
        # weather is -- it was the one source that failed the whole answer.
        logger.warning("route options: terrain not read (%s)", error)
        floor = np.zeros((grid.rows, grid.cols))
        unchecked.append("terrain")
    grid.floor = floor
    try:
        grid.offshore = water.out_of_glide(grid.lat0, grid.lon0, grid.rows, grid.cols, CELL_DEG)
    except (water.WaterUnavailable, OSError, ValueError) as error:
        # The shores not to be had: no way kept over land, and the pilot told.
        logger.warning("route options: water not read (%s)", error)
        unchecked.append("water")
    try:
        _weather(grid, window, ceiling, visibility)
    except weather.WeatherServiceError:
        unchecked.append("forecasts and reports")
    try:
        _sigmets(grid, window)
    except weather.WeatherServiceError:
        unchecked.append("SIGMETs")
    try:
        _gairmets(grid, window, top)
    except weather.WeatherServiceError:
        unchecked.append("G-AIRMETs")
    unchecked += _airspace(grid, window)
    gs = _groundspeeds(grid, floor, top, tas, fcst_hr)

    # 91.151: 30 minutes by day, 45 at night, judged at both ends.
    night = sun.is_night(start[0], start[1], datetime.fromtimestamp(window[0], timezone.utc)) or \
        sun.is_night(end[0], end[1], datetime.fromtimestamp(window[1], timezone.utc))
    reserve_min = navlog.NIGHT_RESERVE_MIN if night else navlog.DAY_RESERVE_MIN
    reserve_gal = reserve_min / 60.0 * float(profile["fuel_burn_gph"])
    try:
        table = fields if fields is not None else fuelstops.fields_with_fuel()
    except (OSError, ValueError) as error:
        logger.warning("route options: fuel fields not read (%s)", error)
        table = None
        unchecked.append("fuel fields")
    # Not the route's own fields: a landing the pilot makes is not a stop to add.
    if table is not None:
        table = table[~table["ident"].isin({dep.get("ident"), dest.get("ident"), *(current_idents or [])})]

    found: list[dict] = []
    for kind in KINDS:
        marginal_cost = MARGINAL_COST if kind == "weather" else 0.0
        water_cost = WATER_COST if kind == "land" else 0.0
        # Clear of everything where there is a way, else crossing least.
        cells = _way(grid, gs, start, end, marginal_cost, water_cost=water_cost) or \
            _way(grid, gs, start, end, marginal_cost, CLOSED_COST, water_cost=water_cost)
        if cells is None:
            continue
        points = [start] + [grid.centre(c) for c in cells[1:-1]] + [end]
        for slower in STRAIGHTEN_STEPS_MIN:
            turns = _straightened(grid, gs, points, marginal_cost, slower, water_cost)
            if len(turns) - 2 <= MAX_TURNS:
                break
        stops = _stops(grid, gs, turns, profile, table, reserve_gal, fewest=kind == "stops",
                       marginal_stop_min=MARGINAL_STOP_MIN * (3 if kind == "weather" else 1))
        # No chain of fields reaches: the way offered all the same, with
        # that said (the owner's rule: no hard limits, only warnings).
        option = _option(kind, grid, gs, turns, stops or [], profile, no_fuel=stops is None)
        # A way that is also another's best is one option with both names.
        same = next((o for o in found if o["stops"] == option["stops"]), None)
        if same is not None:
            same["kinds"].append(kind)
            continue
        found.append(option)
    found = _named_by_what_they_are(grid, found)
    own = _own(grid, gs, current or [start, end], current_idents or [], current_landed or [], profile, table, reserve_gal)
    return {
        "options": found,
        "own": own,
        # The pilot's own route as it is flown, end to end, for the map to
        # draw beside the ways (the owner's "all routes drawn including
        # mine", 2026-10-25).
        "current_path": [[round(lat, 5), round(lon, 5)] for lat, lon in (current or [start, end])],
        "direct": _crossed(grid, [start, end]),
        # The ends' own weather, which no way round can change: said, as
        # the briefing says it, for the pilot to judge.
        "ends": [int(h) for h in dict.fromkeys(grid.closed[c] for c in (grid.cell(start), grid.cell(end))) if h >= 0],
        "current": _crossed(grid, current) if current else [],
        # What the pilot's own route meets, as each way's (`_along`): its
        # weather strip, wind and floor.
        "current_along": _along(grid, gs, current or [start, end], tas),
        "current_marginal": _crossed(grid, current, marginal=True) if current else [],
        "hazards": grid.hazards,
        "unchecked": unchecked,
    }


def _own(grid: _Grid, gs: np.ndarray, path: list[tuple], idents: list[str], landed: list[bool], profile: dict, table,
         reserve_gal: float) -> dict:
    """The pilot's own route with the fuel stops it needs put in where they
    fall along it -- its own points kept, in order -- for FPL's card of it
    before anything is planned (the owner's "Don't plan anything unless a
    route is picked", 2026-10-24): its points, the fuel stops among them,
    its miles, minutes and fuel, and what it meets. Each hop between the
    fields the pilot lands at (`landed`, one per point between the ends)
    is a flight of its own, refuelled there: a landing already made was
    taken as flown over, and its own field offered as the stop to add
    (the audit of 2026-10-24). Where no chain of fields reaches a hop,
    the route is offered as it is with that said (crosses)."""
    inner = list(zip(idents, path[1:-1], landed if len(landed) == len(idents) else [False] * len(idents)))
    # The hops: the path split at each field landed at.
    hops: list[list[tuple]] = [[path[0]]]
    for _, p, lands in inner:
        hops[-1].append(p)
        if lands:
            hops.append([p])
    hops[-1].append(path[-1])
    stops: list[dict] = []
    no_fuel = False
    at = 0.0
    for hop in hops:
        found = _stops(grid, gs, hop, profile, table, reserve_gal, fewest=False)
        if found is None:
            no_fuel = True
        else:
            stops += [{**stop, "at": at + stop["at"]} for stop in found]
        at += sum(_line_minutes(grid, gs, a, b) for a, b in zip(hop, hop[1:]))
    along = [0.0]
    for a, b in zip(path, path[1:]):
        along.append(along[-1] + _line_minutes(grid, gs, a, b))
    points = [(at, {"ident": ident, "lat": p[0], "lon": p[1], "fuel": False})
              for at, (ident, p, _) in zip(along[1:-1], inner)]
    points += [(stop["at"], {"ident": stop["ident"], "lat": stop["lat"], "lon": stop["lon"], "fuel": True}) for stop in stops]
    points.sort(key=lambda p: p[0])
    way = [path[0]] + [(p["lat"], p["lon"]) for _, p in points] + [path[-1]]
    distance = sum(float(geo.distance_nm(a[0], a[1], b[0], b[1])) for a, b in zip(way, way[1:]))
    air = sum(_line_minutes(grid, gs, a, b) for a, b in zip(way, way[1:]))
    landings = len(stops) + sum(1 for _, _, lands in inner if lands)
    return {
        "kind": "own", "kinds": ["own"], "title": "Your Route",
        "stops": [p["ident"] for _, p in points],
        "fuel": [p["ident"] for _, p in points if p["fuel"]],
        "path": [[round(lat, 5), round(lon, 5)] for lat, lon in way],
        "distance_nm": round(distance, 1),
        "air_min": round(air, 1),
        "ground_min": TURNAROUND_MIN * landings,
        "fuel_gal": round(air / 60.0 * float(profile["fuel_burn_gph"]), 1),
        "landings": landings,
        "crosses": _crossed(grid, way) + ([_no_fuel(grid)] if no_fuel else []),
        "marginal": _crossed(grid, way, marginal=True),
        **_along(grid, gs, way, float(profile["cruise_tas_kt"])),
    }


#: The weather a cell is, for a way's strip of the weather met along it:
#: its closing hazard's kind, else marginal, else VFR.
_WEATHER_OF = {"storm": "storm", "weather": "ifr", "sigmet": "ifr", "marginal": "mvfr"}


def _along(grid: _Grid, gs: np.ndarray, path: list[tuple], tas_kt: float) -> dict:
    """What a way through `path` meets, cell by cell in the order it flies
    them: the weather as a strip of runs ({"kind": vfr|mvfr|ifr|storm,
    "min"}), for the page to lay out by the time it is met; the mean wind
    along it, kt (positive a tailwind); its floor, the highest cell's
    ground with 91.119's 1,000 ft, ft; and its miles out of glide of dry
    land (vfr.water), nm."""
    runs: list[dict] = []
    wind_min = 0.0
    total = 0.0
    floor = 0.0
    water_nm = 0.0
    for a, b in zip(path, path[1:]):
        cells = grid.line_cells(a, b)
        minutes = _line_minutes(grid, gs, a, b)
        if not cells or minutes <= 0:
            continue
        each = minutes / len(cells)
        water_nm += float(geo.distance_nm(a[0], a[1], b[0], b[1])) / len(cells) * sum(float(grid.offshore[c]) for c in cells)
        bearing = math.atan2((b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2)), b[0] - a[0])
        k = _step_index(round(math.cos(bearing)), round(math.sin(bearing)))
        for c in cells:
            h = grid.closed[c]
            kind = _WEATHER_OF.get(grid.hazards[h]["kind"], "vfr") if h >= 0 else ("mvfr" if grid.marginal[c] >= 0 else "vfr")
            if runs and runs[-1]["kind"] == kind:
                runs[-1]["min"] += each
            else:
                runs.append({"kind": kind, "min": each})
            wind_min += (float(gs[c[0], c[1], k]) - tas_kt) * each
            total += each
            if grid.floor is not None:
                floor = max(floor, float(grid.floor[c]))
    return {
        "bands": [{"kind": r["kind"], "min": round(r["min"], 1)} for r in runs],
        "tail_kt": round(wind_min / total, 1) if total else 0.0,
        # The highest ground with 91.119's 1,000 ft alone: the coarse read's
        # own margin is the planner's to keep, not a figure for the pilot.
        "floor_ft": int(math.ceil(max(0.0, floor - terrain_detour.COARSE_MARGIN_FT) / 100.0) * 100),
        # Its miles out of glide of dry land (vfr.water.GLIDE_NM).
        "water_nm": round(water_nm),
    }


#: How far from a turn a fix is looked for to turn at instead, nm, and
#: how many minutes it may add: the planner's own figures, a fix a pilot
#: can load beating a point of their own off one for a few miles more.
SNAP_NM = 8.0
SNAP_MIN = 3.0


def _fix_for_turn(grid: _Grid, gs: np.ndarray, before: tuple, turn: tuple, after: tuple) -> dict | None:
    """The nearest fix within SNAP_NM of a turn -- a navaid, a VFR or GPS
    waypoint -- that keeps the two legs either side of it over no more
    closed, marginal or offshore cells than the turn's own, and no more
    than SNAP_MIN slower; None where none does."""
    dlat = SNAP_NM / 60.0
    dlon = SNAP_NM / (60.0 * max(0.1, math.cos(math.radians(turn[0]))))
    near = [f for f in fixes.within(turn[0] - dlat, turn[1] - dlon, turn[0] + dlat, turn[1] + dlon)
            if re.fullmatch(r"[A-Z0-9]{2,5}", f["ident"])]
    if not near:
        return None

    def cost(points: list[tuple]) -> tuple:
        cells = [c for a, b in zip(points, points[1:]) for c in grid.line_cells(a, b)]
        return (sum(1 for c in cells if not grid.open(c)), sum(1 for c in cells if grid.marginal[c] >= 0),
                sum(float(grid.offshore[c]) for c in cells))

    own = cost([before, turn, after])
    minutes = _line_minutes(grid, gs, before, turn) + _line_minutes(grid, gs, turn, after)
    ranked = sorted(near, key=lambda f: float(geo.distance_nm(turn[0], turn[1], f["lat"], f["lon"])))
    for fix in ranked:
        at = (fix["lat"], fix["lon"])
        if float(geo.distance_nm(turn[0], turn[1], at[0], at[1])) > SNAP_NM:
            break
        closed, marginal, offshore = cost([before, at, after])
        if closed > own[0] or marginal > own[1] or offshore > own[2] + 0.5:
            continue
        if _line_minutes(grid, gs, before, at) + _line_minutes(grid, gs, at, after) > minutes + SNAP_MIN:
            continue
        return fix
    return None


def _named_by_what_they_are(grid: _Grid, found: list[dict]) -> list[dict]:
    """Each kind's name given to the way that is it, among those found:
    the fastest the least time end to end, the best weather the fewest
    hazards crossed (the want of fuel aside), then the fewest marginal
    cells, then the time. Each kind's search finds its own way, but where
    nothing keeps clear (CLOSED_COST) a search crossing least can come out
    slower than another's -- KSEA to KSFO's "fastest" went 605 nm out over
    the Pacific round the mountains obscured, 110 minutes slower than the
    best weather's (2026-10-25). A way left with no name is dropped; each
    keeps its first name as its key."""
    if not found:
        return found

    def minutes(o: dict) -> float:
        return o["air_min"] + o["ground_min"]

    def weather(o: dict) -> tuple:
        hazards = [i for i in o["crosses"] if grid.hazards[i]["kind"] != "fuel"]
        return (len(hazards), len(o["marginal"]), minutes(o))

    # A way no fuel field reaches lands nowhere and so looks quickest and
    # clearest: not any kind's best while another way can be flown.
    fuelled = [o for o in found if not any(grid.hazards[i]["kind"] == "fuel" for i in o["crosses"])] or found
    best = {
        "fastest": min(fuelled, key=minutes),
        "weather": min(fuelled, key=weather),
        "stops": min(fuelled, key=lambda o: (o["landings"], minutes(o))),
    }
    for option in found:
        option["kinds"] = [k for k in option["kinds"] if k not in best or best[k] is option]
    for kind, option in best.items():
        if kind not in option["kinds"]:
            option["kinds"].append(kind)
    kept = [o for o in found if o["kinds"]]
    for option in kept:
        if option["kind"] not in option["kinds"]:
            option["kind"] = option["kinds"][0]
            option["title"] = TITLES[option["kind"]]
    return kept


def _no_fuel(grid: _Grid) -> int:
    """The hazard said on a way no chain of fields with fuel reaches."""
    return grid.hazard("fuel", f"No field with fuel within {STOP_FIELD_NM:.0f} nm reaches")


def _option(kind: str, grid: _Grid, gs: np.ndarray, turns: list[tuple], stops: list[dict], profile: dict, *,
            no_fuel: bool = False) -> dict:
    """One way as the page offers it: its turns named off the nearest fix
    -- or, with none near enough, as a position (@lat,lon), which the
    route takes as a point of its own -- and its fuel stops in order
    along it, with its distance, minutes and fuel."""
    # The turns, and the stops between them, in order along the way.
    along = [0.0]
    for a, b in zip(turns, turns[1:]):
        along.append(along[-1] + _line_minutes(grid, gs, a, b))
    points: list[tuple[float, dict]] = []
    for i, (at, turn) in enumerate(zip(along[1:-1], turns[1:-1]), start=1):
        # A fix a pilot can load near the turn, where one keeps the way as
        # clear and nearly as quick, the turn moved onto it; else a point
        # of the pilot's own off the nearest fix (the owner's "Isn't there
        # a gps fix nearby pos1, 2, 3 etc that we can use?", 2026-10-25).
        fix = _fix_for_turn(grid, gs, turns[i - 1], turn, turns[i + 1])
        if fix is not None:
            turns[i] = (fix["lat"], fix["lon"])
            points.append((at, {"ident": fix["ident"], "lat": fix["lat"], "lon": fix["lon"], "fuel": False}))
            continue
        named = fixes.frd_near(turn[0], turn[1])
        ident = named["ident"] if named is not None else f"@{turn[0]:.4f},{turn[1]:.4f}"
        points.append((at, {"ident": ident, "lat": turn[0], "lon": turn[1], "fuel": False}))
    for stop in stops:
        points.append((stop["at"], {"ident": stop["ident"], "lat": stop["lat"], "lon": stop["lon"], "fuel": True}))
    points.sort(key=lambda p: p[0])
    path = [turns[0]] + [(p["lat"], p["lon"]) for _, p in points] + [turns[-1]]
    distance = sum(float(geo.distance_nm(a[0], a[1], b[0], b[1])) for a, b in zip(path, path[1:]))
    air = sum(_line_minutes(grid, gs, a, b) for a, b in zip(path, path[1:]))
    return {
        "kind": kind,
        #: Every kind of way this one is the best of.
        "kinds": [kind],
        "title": TITLES[kind],
        "stops": [p["ident"] for _, p in points],
        "fuel": [p["ident"] for _, p in points if p["fuel"]],
        "path": [[round(lat, 5), round(lon, 5)] for lat, lon in path],
        "distance_nm": round(distance, 1),
        "air_min": round(air, 1),
        "ground_min": TURNAROUND_MIN * len(stops),
        "fuel_gal": round(air / 60.0 * float(profile["fuel_burn_gph"]), 1),
        "landings": len(stops),
        "crosses": _crossed(grid, path) + ([_no_fuel(grid)] if no_fuel else []),
        "marginal": _crossed(grid, path, marginal=True),
        **_along(grid, gs, path, float(profile["cruise_tas_kt"])),
    }
