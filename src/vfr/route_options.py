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
- thunderstorms, by AIM 7-1-29's "avoid by at least 20 miles": a TAF or a
  METAR with TS or VCTS, and a convective SIGMET's area, close the cells
  within 20 nm; any other SIGMET under 18,000 ft (severe turbulence or
  icing, IFR, obscuration, ash) closes its own area;
- prohibited areas (91.133) and the TFRs in force over the flight
  (91.137 to 91.145) close their cells; restricted areas, MOAs and warning
  areas, whose times of use are not read here, mark them marginal;
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
import time
from datetime import datetime, timezone

import numpy as np

from . import fixes, fuelstops, geo, navlog, sun, terrain_detour, weather

#: The grid's cells, degrees: about 15 nm, as the terrain way round's.
CELL_DEG = 0.25
#: How far round the route the grid reaches, a share of its length,
#: degrees at least and at most: room to go round a line of storms.
REACH_SHARE = 0.3
REACH_MIN_DEG, REACH_MAX_DEG = 1.0, 3.0
#: AIM 7-1-29, Thunderstorm Flying: "avoid by at least 20 miles any
#: thunderstorm identified as severe or giving an intense radar echo" --
#: kept for every one forecast or reported, as a light airplane has no
#: radar to tell which.
STORM_NM = 20.0
#: How far round a field its report or forecast is taken to hold: a TAF
#: is for 5 sm round the field (AC 00-45H), twice that here.
FIELD_WX_NM = 10.0
#: And how far round a field in MVFR the cells are marginal.
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
#: The airplane is taken to climb to cruise from no lower than this, ft.
LOWEST_CRUISE_FT = 2500.0
#: The kinds of way, in the order they are offered.
KINDS = ("fastest", "weather", "stops")
TITLES = {"fastest": "Fastest", "weather": "Best weather", "stops": "Fewest stops"}

#: The eight ways out of a cell: (rows, columns).
_STEPS = [(dr, dc) for dr in (-1, 0, 1) for dc in (-1, 0, 1) if dr or dc]


class _Grid:
    """The cells round a route: where each is, its ground, what closes it
    and what makes it marginal, and its best groundspeed each way."""

    def __init__(self, start: tuple, end: tuple):
        span = float(geo.distance_nm(start[0], start[1], end[0], end[1])) / 60.0
        reach = min(REACH_MAX_DEG, max(REACH_MIN_DEG, span * REACH_SHARE))
        self.lat0 = min(start[0], end[0]) - reach
        self.lon0 = min(start[1], end[1]) - reach / max(0.2, math.cos(math.radians((start[0] + end[0]) / 2)))
        self.rows = int(math.ceil((max(start[0], end[0]) + reach - self.lat0) / CELL_DEG))
        lon_reach = (min(start[1], end[1]) - self.lon0)
        self.cols = int(math.ceil((max(start[1], end[1]) + lon_reach - self.lon0) / CELL_DEG))
        self.lats = self.lat0 + (np.arange(self.rows) + 0.5) * CELL_DEG
        self.lons = self.lon0 + (np.arange(self.cols) + 0.5) * CELL_DEG
        self.lat_grid, self.lon_grid = np.meshgrid(self.lats, self.lons, indexing="ij")
        #: The hazard (an index into `hazards`) that closes each cell, -1 open.
        self.closed = np.full((self.rows, self.cols), -1, dtype=int)
        #: The hazard that makes each cell marginal, -1 none.
        self.marginal = np.full((self.rows, self.cols), -1, dtype=int)
        #: What costs more to cross, for every way: special-use airspace.
        self.dear = np.zeros((self.rows, self.cols))
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
        steps = max(2, int(max(abs(b[0] - a[0]), abs(b[1] - a[1])) / (CELL_DEG / 3)) + 1)
        out: list = []
        for t in np.linspace(0.0, 1.0, steps):
            cell = self.cell((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
            if not out or out[-1] != cell:
                out.append(cell)
        return out

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
    elif (ceiling is not None and ceiling < MVFR_CEILING_FT) or (visibility is not None and visibility < MVFR_VISIBILITY_SM):
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


def _way(grid: _Grid, gs: np.ndarray, start: tuple, end: tuple, marginal_cost: float,
         closed_cost: float | None = None) -> list[tuple[int, int]] | None:
    """The quickest way over open cells from start's cell to end's (A*,
    minutes), marginal cells costing `marginal_cost` more of theirs and
    special-use airspace its own; with `closed_cost`, over closed cells
    too, each that much the dearer."""
    s, e = grid.cell(start), grid.cell(end)
    fastest = float(gs.max())
    weight = 1.0 + grid.dear + np.where(grid.marginal >= 0, marginal_cost, 0.0)
    if closed_cost is not None:
        weight = weight + np.where(grid.closed >= 0, closed_cost, 0.0)

    def minutes(a, b) -> float:
        la, lb = grid.centre(a), grid.centre(b)
        nm = float(geo.distance_nm(la[0], la[1], lb[0], lb[1]))
        k = _step_index(b[0] - a[0], b[1] - a[1])
        return nm / gs[a[0], a[1], k] * 60.0 * weight[b]

    def guess(a) -> float:
        la, le = grid.centre(a), grid.centre(e)
        return float(geo.distance_nm(la[0], la[1], le[0], le[1])) / fastest * 60.0

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


def _line_minutes(grid: _Grid, gs: np.ndarray, a: tuple, b: tuple, marginal_cost: float = 0.0) -> float:
    """The minutes from a to b in a straight line, at each cell's best
    groundspeed the way nearest the line's, marginal cells the dearer."""
    nm = float(geo.distance_nm(a[0], a[1], b[0], b[1]))
    if nm == 0:
        return 0.0
    bearing = math.atan2((b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2)), b[0] - a[0])
    # The nearest of the eight ways: |cos| or |sin| is at least 0.71, so
    # one of the two rounds to a whole step.
    k = _step_index(round(math.cos(bearing)), round(math.sin(bearing)))
    cells = grid.line_cells(a, b)
    rate = [(1.0 + grid.dear[c] + (marginal_cost if grid.marginal[c] >= 0 else 0.0)) / gs[c[0], c[1], k] for c in cells]
    return nm * float(np.mean(rate)) * 60.0


def _straightened(grid: _Grid, gs: np.ndarray, points: list[tuple], marginal_cost: float,
                  slower_min: float = STRAIGHTEN_MIN) -> list[tuple]:
    """The way's turns: from each point the farthest on along it a straight
    line reaches over open cells -- over no more closed ones than the way
    itself crossed, where it had to -- no more than `slower_min` slower."""
    out, i = [points[0]], 0
    legs = [_line_minutes(grid, gs, points[k], points[k + 1], marginal_cost) for k in range(len(points) - 1)]

    def marginal_cells(a, b) -> int:
        return sum(1 for c in grid.line_cells(a, b) if grid.marginal[c] >= 0)

    def closed_cells(a, b) -> int:
        return sum(1 for c in grid.line_cells(a, b) if not grid.open(c))

    def clear_enough(i: int, j: int) -> bool:
        return grid.line_open(points[i], points[j]) or \
            closed_cells(points[i], points[j]) <= sum(closed_cells(points[k], points[k + 1]) for k in range(i, j))

    while i < len(points) - 1:
        j = len(points) - 1
        while j > i + 1:
            # The best weather's way kept off marginal cells its own way
            # kept off: a short cut across the corner of one is the
            # weather it was drawn round.
            if clear_enough(i, j) and \
                    _line_minutes(grid, gs, points[i], points[j], marginal_cost) <= sum(legs[i:j]) + slower_min and \
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
           fewest: bool) -> list[dict] | None:
    """The fields to land at for fuel along the way: those with 100LL on a
    paved runway (vfr.fuelstops) within STOP_FIELD_NM of it, in open
    cells, each flight landing with `reserve_gal` (91.151) -- the fewest
    minutes, TURNAROUND_MIN at each, or the fewest landings (`fewest`).
    [] where the tanks reach; None where no chain of fields does."""
    tas = float(profile["cruise_tas_kt"])
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
    # Each field's nearest point on the way: how far along, how far off.
    lat_f, lon_f = fields["lat"].to_numpy(float), fields["lon"].to_numpy(float)
    best_off = np.full(len(lat_f), np.inf)
    best_at = np.zeros(len(lat_f))
    for k, (a, b) in enumerate(zip(way, way[1:])):
        seg = along_nm[k + 1] - along_nm[k]
        for t in np.linspace(0.0, 1.0, max(2, int(seg / 5) + 1)):
            lat, lon = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            off = geo.distance_nm(lat, lon, lat_f, lon_f)
            closer = off < best_off
            best_off[closer] = off[closer]
            best_at[closer] = along_min[k] + (along_min[k + 1] - along_min[k]) * t
    nodes = [{"at": 0.0, "off": 0.0}]
    for i in np.argsort(best_at):
        if best_off[i] > STOP_FIELD_NM or not (0.0 < best_at[i] < total_min):
            continue
        row = fields.iloc[int(i)]
        cell = grid.cell((lat_f[i], lon_f[i]))
        if grid.closed[cell] >= 0:
            continue
        runway = max(fuelstops.paved_runway_ft(row["ident"]), fuelstops.paved_runway_ft(row["faa_ident"]))
        if runway < fuelstops.MIN_RUNWAY_FT:
            continue
        nodes.append({"at": float(best_at[i]), "off": float(best_off[i]), "ident": str(row["ident"]),
                      "name": str(row["name"]), "lat": float(lat_f[i]), "lon": float(lon_f[i])})
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
            landing = 0.0 if j == count - 1 else (1e6 if fewest else 0.0) + TURNAROUND_MIN
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
            current: list[tuple] | None = None, current_idents: list[str] | None = None, fields=None) -> dict:
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

    grid = _Grid(start, end)
    unchecked: list[str] = []
    floor = _ground(grid, top)
    grid.floor = floor
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
    table = fields if fields is not None else fuelstops.fields_with_fuel()
    table = table[~table["ident"].isin({dep.get("ident"), dest.get("ident")})]

    found: list[dict] = []
    for kind in KINDS:
        marginal_cost = MARGINAL_COST if kind == "weather" else 0.0
        # Clear of everything where there is a way, else crossing least.
        cells = _way(grid, gs, start, end, marginal_cost) or _way(grid, gs, start, end, marginal_cost, CLOSED_COST)
        if cells is None:
            continue
        points = [start] + [grid.centre(c) for c in cells[1:-1]] + [end]
        for slower in STRAIGHTEN_STEPS_MIN:
            turns = _straightened(grid, gs, points, marginal_cost, slower)
            if len(turns) - 2 <= MAX_TURNS:
                break
        stops = _stops(grid, gs, turns, profile, table, reserve_gal, fewest=kind == "stops")
        if stops is None:
            continue
        option = _option(kind, grid, gs, turns, stops, profile)
        if option is None:
            continue
        # A way that is also another's best is one option with both names.
        same = next((o for o in found if o["stops"] == option["stops"]), None)
        if same is not None:
            same["kinds"].append(kind)
            continue
        found.append(option)
    own = _own(grid, gs, current or [start, end], current_idents or [], profile, table, reserve_gal)
    return {
        "options": found,
        "own": own,
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


def _own(grid: _Grid, gs: np.ndarray, path: list[tuple], idents: list[str], profile: dict, table, reserve_gal: float) -> dict | None:
    """The pilot's own route with the fuel stops it needs put in where they
    fall along it -- its own points kept, in order -- for FPL's card of it
    before anything is planned (the owner's "Don't plan anything unless a
    route is picked", 2026-10-24): its points, the fuel stops among them,
    its miles, minutes and fuel, and what it meets. None where no chain of
    fields with fuel reaches."""
    stops = _stops(grid, gs, path, profile, table, reserve_gal, fewest=False)
    if stops is None:
        return None
    along = [0.0]
    for a, b in zip(path, path[1:]):
        along.append(along[-1] + _line_minutes(grid, gs, a, b))
    points = [(at, {"ident": ident, "lat": p[0], "lon": p[1], "fuel": False})
              for at, ident, p in zip(along[1:-1], idents, path[1:-1])]
    points += [(stop["at"], {"ident": stop["ident"], "lat": stop["lat"], "lon": stop["lon"], "fuel": True}) for stop in stops]
    points.sort(key=lambda p: p[0])
    way = [path[0]] + [(p["lat"], p["lon"]) for _, p in points] + [path[-1]]
    distance = sum(float(geo.distance_nm(a[0], a[1], b[0], b[1])) for a, b in zip(way, way[1:]))
    air = sum(_line_minutes(grid, gs, a, b) for a, b in zip(way, way[1:]))
    return {
        "kind": "own", "kinds": ["own"], "title": "Your Route",
        "stops": [p["ident"] for _, p in points],
        "fuel": [p["ident"] for _, p in points if p["fuel"]],
        "path": [[round(lat, 5), round(lon, 5)] for lat, lon in way],
        "distance_nm": round(distance, 1),
        "air_min": round(air, 1),
        "ground_min": TURNAROUND_MIN * len(stops),
        "fuel_gal": round(air / 60.0 * float(profile["fuel_burn_gph"]), 1),
        "landings": len(stops),
        "crosses": _crossed(grid, way),
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
    along it, kt (positive a tailwind); and its floor, the highest cell's
    ground with 91.119's 1,000 ft and the coarse read's margin, ft."""
    runs: list[dict] = []
    wind_min = 0.0
    total = 0.0
    floor = 0.0
    for a, b in zip(path, path[1:]):
        cells = grid.line_cells(a, b)
        minutes = _line_minutes(grid, gs, a, b)
        if not cells or minutes <= 0:
            continue
        each = minutes / len(cells)
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
        "floor_ft": int(math.ceil(floor / 100.0) * 100),
    }


def _option(kind: str, grid: _Grid, gs: np.ndarray, turns: list[tuple], stops: list[dict], profile: dict) -> dict | None:
    """One way as the page offers it: its turns named off the nearest fix
    and its fuel stops in order along it, with its distance, minutes and
    fuel. None where a turn has no fix near enough to be named."""
    # The turns, and the stops between them, in order along the way.
    along = [0.0]
    for a, b in zip(turns, turns[1:]):
        along.append(along[-1] + _line_minutes(grid, gs, a, b))
    points: list[tuple[float, dict]] = []
    for at, turn in zip(along[1:-1], turns[1:-1]):
        named = fixes.frd_near(turn[0], turn[1])
        if named is None:
            return None
        points.append((at, {"ident": named["ident"], "lat": turn[0], "lon": turn[1], "fuel": False}))
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
        "crosses": _crossed(grid, path),
        "marginal": _crossed(grid, path, marginal=True),
        **_along(grid, gs, path, float(profile["cruise_tas_kt"])),
    }
