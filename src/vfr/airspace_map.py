"""The Class B, C and D in the map's view, as the sectional draws them:
each volume's lines and its altitudes, for the map to lay over the chart
(the web's AirspaceLayer).

The lines are the FAA's Class Airspace shapefile itself -- the polygons
vfr.airspace already holds for the altitude planner -- so they sit on the
chart's own printed rings, which are often not circles: the chart is
drawn from the same NASR data. Each volume is sent as its boundary
clipped to the box, not as a polygon clipped to it: a clipped polygon has
new edges along the box, and a map that keeps the last answer while the
next is asked for (keepPreviousData) would draw them as airspace lines
across the chart.

The altitudes are sent as the file has them, the floor and the top in
feet MSL and whether the top is "to but not including"; the web writes
them as the chart does (lib/map/airspaceLabel).
"""
from __future__ import annotations

from pathlib import Path

import shapely
from shapely.geometry import box as shapely_box

from . import airspace
from .once import once

#: The finest a line is simplified to, in degrees: about 30 m north to
#: south, a pixel and a half at zoom 12 -- close in, the line stays on
#: the chart's own ring. A box further out is simplified further
#: (tolerance_for), as its pixels are bigger.
MIN_TOLERANCE_DEG = 0.0003

#: A box is the view and as much again round it (the web's aheadOf),
#: about three screens tall, and a screen is under a thousand pixels: a
#: six-thousandth of the box is under a pixel at any zoom.
TOLERANCE_PER_BOX = 1 / 6000


def tolerance_for(south: float, north: float) -> float:
    """How far a line may be moved in simplifying it, in degrees, for a
    box this tall: under a pixel of the map that asked for it."""
    return max(MIN_TOLERANCE_DEG, (north - south) * TOLERANCE_PER_BOX)


def _lines(geometry) -> list[list[list[float]]]:
    """Every line of a clipped boundary as [lat, lon] points, rounded to
    five places (a metre): the points and empties a clip can leave are
    dropped."""
    lines = []
    for part in shapely.get_parts(geometry):
        if part.geom_type not in ("LineString", "LinearRing") or part.is_empty:
            continue
        coords = shapely.get_coordinates(part)
        if len(coords) >= 2:
            lines.append([[round(float(lat), 5), round(float(lon), 5)] for lon, lat in coords])
    return lines


def volumes_in(shp_path, south: float, west: float, north: float, east: float) -> tuple[dict, ...]:
    """The Class B, C and D volumes inside the box, each one's lines
    clipped to it, simplified under a pixel, and a point for its label.

    Worked out once per box and airspace file: the map asks on a
    half-degree grid (the web's aheadOf), so a pan back over the same
    ground is answered from memory. Callers must treat the answer as
    read-only, since it is shared with every later asker of that box."""
    shp_path = Path(shp_path)
    return _volumes_in(str(shp_path), shp_path.stat().st_mtime, south, west, north, east)


@once(maxsize=64)
def _volumes_in(shp_path: str, _mtime: float, south: float, west: float, north: float, east: float) -> tuple[dict, ...]:
    view = shapely_box(west, south, east, north)
    tolerance = tolerance_for(south, north)
    found = []
    # Numbered by their place in the national file, so a volume keeps its
    # id from one box to the next and the map does not draw it again.
    for number, polygon in enumerate(airspace._load_all_controlled_airspace(shp_path)):
        min_lon, min_lat, max_lon, max_lat = polygon["bbox"]
        if max_lat < south or min_lat > north or max_lon < west or min_lon > east:
            continue
        geometry = shapely.force_2d(polygon["geometry"])
        if not geometry.intersects(view):
            continue
        lines = _lines(geometry.boundary.intersection(view).simplify(tolerance, preserve_topology=False))
        if not lines:
            continue
        # On the volume itself, a shelf's label inside the shelf: the
        # whole volume's point where it is in the box, so it stays put as
        # the map pans; else the point of the part that is.
        label = geometry.representative_point()
        if not view.contains(label):
            label = geometry.intersection(view).representative_point()
        floor = polygon["floor_ft_msl"]
        found.append({
            "id": f"{polygon['ident'] or polygon['class']}-{number}",
            "ident": polygon["ident"] or None,
            "name": polygon["name"],
            "airspace_class": polygon["class"],
            "floor_ft": floor,
            # Every Class B, C and D floor is the surface or a height MSL
            # in the file: SFC where it is the surface (vfr.airspace).
            "floor_sfc": floor == 0,
            "ceiling_ft": polygon["ceiling_ft_msl"],
            "ceiling_excluded": polygon.get("upper_desc") == "TNI",
            "label_lat": round(label.y, 5),
            "label_lon": round(label.x, 5),
            "lines": lines,
        })
    return tuple(found)
