"""A way round high ground for an airplane that cannot climb over it: the
fields with fuel to fly by, in order, so that every leg between them keeps
clear of the ground at an altitude the airplane can reach.

The planner says when a route has no legal altitude because the terrain
under its straight line needs more than the airplane's service ceiling
allows (app.planning.no_altitude): "the terrain and obstacles there need
13,600 ft; the aircraft's service ceiling stops at 9,500". A pilot then
goes round, by the passes and the low country. This finds such a way:

- The ground is read off the terrain tiles (vfr.elevation's terrarium
  tiles, at a coarse zoom) as the highest point in each cell of a grid
  round the route.
- A cell can be flown over where its highest ground, plus 14 CFR 91.119's
  1,000 ft and a margin for the coarse read (COARSE_MARGIN_FT), is under
  the highest VFR cruising altitude the airplane can reach either way
  (91.159's thousands plus 500 under its ceiling, the lower of the
  eastbound and westbound).
- The shortest way over such cells (A*), straightened where a straight
  line keeps to them, gives the turns; each turn is the field with fuel
  nearest it (vfr.fuelstops' fields) that keeps both its legs clear.

It only suggests: the route through the fields is planned as any route
is, its floor read along each leg at full resolution (vfr.terrain), so a
way this coarse read got wrong is said to have no altitude like any other.
"""
from __future__ import annotations

import heapq
import math

import numpy as np

from . import elevation, fixes, fuelstops, geo

M_TO_FT = 3.28084

#: 14 CFR 91.119(b)'s 1,000 ft over the ground, as vfr.terrain keeps it.
TERRAIN_MARGIN_FT = 1000
#: The tiles at this zoom are an average of the ground they cover; the
#: peaks in a cell stand higher than its pixels say.
COARSE_MARGIN_FT = 1000
#: The terrarium tiles' zoom read: a pixel about 0.02 degrees, 1.3 nm.
ZOOM = 6
#: The grid's cells, degrees, and how far round the route it reaches.
CELL_DEG = 0.25
REACH_DEG = 5.0
#: The fields near the way round that may be flown by, nm from it.
FIELD_NM = 40.0
#: The longest leg between two of them looked at, nm: none in effect --
#: the planner adds fuel stops where the tanks do not reach (vfr.fuelstops),
#: and a route makes 8 stops at most (app.common.MAX_STOPS).
LEG_NM = 3000.0
#: Miles added for each field flown by, so fewer turns win where near,
#: and more for a point of the pilot's own, so a field is had where one will do.
TURN_NM = 20.0
OWN_POINT_NM = 30.0


def highest_cruise_ft(ceiling_ft: float) -> float:
    """The highest VFR cruising altitude the airplane reaches either way:
    91.159's odd thousands plus 500 eastbound, even westbound, under its
    ceiling and under 18,000 ft (Class A, 71.33) -- the lower of the two,
    so the way works whichever way its legs go."""
    top = min(ceiling_ft, 17_999)
    east = max((a for a in range(3500, 18_000, 2000) if a <= top), default=0)
    west = max((a for a in range(4500, 18_000, 2000) if a <= top), default=0)
    return float(min(east, west))


def _heights_ft(lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    """The ground's height at each point, feet, from the terrain tiles."""
    n = 2 ** ZOOM
    fx = (lons + 180.0) / 360.0 * n
    fy = (1.0 - np.arcsinh(np.tan(np.radians(lats))) / np.pi) / 2.0 * n
    tx, ty = np.floor(fx).astype(int), np.floor(fy).astype(int)
    out = np.zeros(lats.shape, dtype=np.float64)
    for x, y in set(zip(tx.ravel().tolist(), ty.ravel().tolist())):
        tile = elevation._terrain_tile(ZOOM, x, y)
        size = tile.shape[0]
        at = (tx == x) & (ty == y)
        col = np.minimum(size - 1, ((fx[at] - x) * size).astype(int))
        row = np.minimum(size - 1, ((fy[at] - y) * size).astype(int))
        out[at] = tile[row, col]
    return np.maximum(out, 0.0) * M_TO_FT


class _Grid:
    """The cells round a route and which can be flown over."""

    def __init__(self, start: tuple, end: tuple, top_ft: float):
        self.lat0 = min(start[0], end[0]) - REACH_DEG
        self.lon0 = min(start[1], end[1]) - REACH_DEG
        rows = int(math.ceil((max(start[0], end[0]) + REACH_DEG - self.lat0) / CELL_DEG))
        cols = int(math.ceil((max(start[1], end[1]) + REACH_DEG - self.lon0) / CELL_DEG))
        # Five points a side in each cell, its highest the cell's.
        step = CELL_DEG / 5
        lats = self.lat0 + (np.arange(rows * 5) + 0.5) * step
        lons = self.lon0 + (np.arange(cols * 5) + 0.5) * step
        heights = _heights_ft(*np.meshgrid(lats, lons, indexing="ij"))
        highest = heights.reshape(rows, 5, cols, 5).max(axis=(1, 3))
        self.clear = highest + TERRAIN_MARGIN_FT + COARSE_MARGIN_FT <= top_ft
        self.rows, self.cols = rows, cols

    def cell(self, point: tuple) -> tuple[int, int]:
        r = int((point[0] - self.lat0) / CELL_DEG)
        c = int((point[1] - self.lon0) / CELL_DEG)
        return min(max(r, 0), self.rows - 1), min(max(c, 0), self.cols - 1)

    def centre(self, cell: tuple[int, int]) -> tuple[float, float]:
        return self.lat0 + (cell[0] + 0.5) * CELL_DEG, self.lon0 + (cell[1] + 0.5) * CELL_DEG

    def line_clear(self, a: tuple, b: tuple, ends: set) -> bool:
        """Whether the straight line from a to b keeps to clear cells, the
        route's own ends excepted (a field in a high valley)."""
        steps = max(2, int(max(abs(b[0] - a[0]), abs(b[1] - a[1])) / (CELL_DEG / 3)) + 1)
        for t in np.linspace(0.0, 1.0, steps):
            cell = self.cell((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
            if not self.clear[cell] and cell not in ends:
                return False
        return True


def _shortest(grid: _Grid, start: tuple, end: tuple) -> list[tuple[int, int]] | None:
    """The shortest way over clear cells from start's cell to end's (A*)."""
    s, e = grid.cell(start), grid.cell(end)
    ends = {s, e}

    def cost(a, b):
        la, lb = grid.centre(a), grid.centre(b)
        return geo.distance_nm(la[0], la[1], lb[0], lb[1])

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
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if not dr and not dc:
                    continue
                nxt = (here[0] + dr, here[1] + dc)
                if not (0 <= nxt[0] < grid.rows and 0 <= nxt[1] < grid.cols):
                    continue
                if not grid.clear[nxt] and nxt not in ends:
                    continue
                g = spent[here] + cost(here, nxt)
                if g < spent.get(nxt, math.inf):
                    spent[nxt], came[nxt] = g, here
                    heapq.heappush(frontier, (g + cost(nxt, e), nxt))
    return None


def way_round(start: tuple, end: tuple, ceiling_ft: float, fields=None) -> list[dict] | None:
    """The fields with fuel to fly by, in order, from `start` to `end`
    ((lat, lon)), keeping every leg clear of the ground at an altitude an
    airplane with this service ceiling can reach: each a dict of ident,
    name, lat and lon. None where there is no such way in reach, or the
    straight line is clear already ([] then)."""
    top = highest_cruise_ft(ceiling_ft)
    grid = _Grid(start, end, top)
    ends = {grid.cell(start), grid.cell(end)}
    if grid.line_clear(start, end, ends):
        return []
    path = _shortest(grid, start, end)
    if path is None:
        return None
    # The fields with fuel near that way are the stepping stones: of them,
    # the shortest chain whose every leg keeps clear (Dijkstra), a few miles
    # added for each field flown by, so a way with fewer turns is taken
    # where it is near as short.
    table = fields if fields is not None else fuelstops.fields_with_fuel()
    lats, lons = table["lat"].to_numpy(float), table["lon"].to_numpy(float)
    way = np.array([grid.centre(c) for c in path])
    near = np.full(len(lats), np.inf)
    for lat, lon in way[:: max(1, len(way) // 200)]:
        near = np.minimum(near, geo.distance_nm(lat, lon, lats, lons))
    picked = np.flatnonzero(near <= FIELD_NM)
    # And the way's own turns, where a straight line from one to the next
    # keeps clear: where no field will do, a point of the pilot's own off
    # the nearest fix (vfr.fixes.frd_near), so a chain is always there.
    points = [start] + [grid.centre(c) for c in path[1:-1]] + [end]
    turns, i = [], 0
    while i < len(points) - 1:
        j = len(points) - 1
        while j > i + 1 and not grid.line_clear(points[i], points[j], ends):
            j -= 1
        if j < len(points) - 1:
            turns.append(points[j])
        i = j
    nodes = [start] + [(float(lats[i]), float(lons[i])) for i in picked] + turns + [end]
    fields_end = 1 + len(picked)
    count = len(nodes)
    best = [math.inf] * count
    prev: list = [None] * count
    best[0] = 0.0
    frontier = [(0.0, 0)]
    while frontier:
        spent, here = heapq.heappop(frontier)
        if here == count - 1:
            break
        if spent > best[here]:
            continue
        for nxt in range(1, count):
            if nxt == here:
                continue
            leg = float(geo.distance_nm(nodes[here][0], nodes[here][1], nodes[nxt][0], nodes[nxt][1]))
            if leg > LEG_NM:
                continue
            g = spent + leg + (0.0 if nxt == count - 1 else TURN_NM if nxt < fields_end else TURN_NM + OWN_POINT_NM)
            if g >= best[nxt]:
                continue
            if not grid.line_clear(nodes[here], nodes[nxt], ends | {grid.cell(nodes[here]), grid.cell(nodes[nxt])}):
                continue
            best[nxt], prev[nxt] = g, here
            heapq.heappush(frontier, (g, nxt))
    if not math.isfinite(best[-1]):
        return None
    chain, at = [], prev[-1]
    while at not in (None, 0):
        chain.append(at)
        at = prev[at]
    out = []
    for node in reversed(chain):
        if node < fields_end:
            i = int(picked[node - 1])
            out.append({"ident": str(table.iloc[i]["ident"]), "name": str(table.iloc[i]["name"]), "lat": float(lats[i]), "lon": float(lons[i])})
            continue
        lat, lon = nodes[node]
        own = fixes.frd_near(lat, lon)
        if own is None:
            return None
        out.append({"ident": own["ident"], "name": own["name"], "lat": float(lat), "lon": float(lon)})
    return out
