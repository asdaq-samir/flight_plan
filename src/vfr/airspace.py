"""Class B/C/D airspace ceilings along a route, from the FAA's own Class
Airspace shapefile -- real polygon geometry via shapely (pyshp reads the
.shp/.dbf; no geopandas/fiona needed), not an approximated circle, so
irregular/non-standard shelves are handled correctly.

Class E is deliberately excluded: VFR overflight through Class E doesn't
require ATC clearance (just cloud clearance/visibility minimums), unlike
B/C/D, so it isn't a "do I need clearance to be at this altitude" ceiling
the way B/C/D are.
"""
from pathlib import Path

import shapefile
from shapely.geometry import LineString, Point, shape as shapely_shape

from .faa_data import FAA_HEADERS, NASR_INDEX_URL, download_and_extract, find_current_cycle_page, find_download_link

CONTROLLED_CLASSES = ("B", "C", "D")


def ensure_class_airspace_shapefile(cache_dir) -> Path:
    """Download+extract the current-cycle Class Airspace shapefile into
    cache_dir if not already cached (same 28-day-cycle, cache-once
    convention as vfr.faa_data.ensure_nasr_data).
    """
    cache_dir = Path(cache_dir)
    shp_path = cache_dir / "Shape_Files" / "Class_Airspace.shp"
    if not shp_path.exists():
        cycle_page = find_current_cycle_page(NASR_INDEX_URL)
        zip_url = find_download_link(cycle_page, r'href="([^"]*class_airspace_shape_files\.zip)"')
        download_and_extract(zip_url, cache_dir)
    return shp_path


def _floor_ft_msl(record: dict) -> float:
    """LOWER_VAL/LOWER_CODE -> floor altitude in feet MSL. SFC (surface)
    floors are 0 MSL; anything not plain feet MSL (rare for B/C/D, mostly
    an E-airspace concern) is treated as 0 -- conservative, since a
    lower/unknown floor only makes a shelf a *more* restrictive ceiling
    for us, never a less restrictive one.
    """
    code = record["LOWER_CODE"]
    if code == "SFC":
        return 0.0
    if code == "MSL":
        try:
            return float(record["LOWER_VAL"])
        except (TypeError, ValueError):
            return 0.0
    return 0.0


def load_controlled_airspace(shp_path, bbox: tuple) -> list:
    """Class B/C/D polygons (as shapely geometries, with a floor_ft_msl)
    whose bounding box overlaps bbox. Returns a list of
    {"name", "class", "floor_ft_msl", "geometry"} dicts.
    """
    min_lat, min_lon, max_lat, max_lon = bbox
    sf = shapefile.Reader(str(shp_path))
    polygons = []
    for sr in sf.iterShapeRecords():
        record = sr.record.as_dict()
        if record["CLASS"] not in CONTROLLED_CLASSES:
            continue
        shp_min_lon, shp_min_lat, shp_max_lon, shp_max_lat = sr.shape.bbox
        if shp_max_lat < min_lat or shp_min_lat > max_lat or shp_max_lon < min_lon or shp_min_lon > max_lon:
            continue
        polygons.append(
            {
                "name": record["NAME"],
                "class": record["CLASS"],
                "floor_ft_msl": _floor_ft_msl(record),
                "geometry": shapely_shape(sr.shape.__geo_interface__),
            }
        )
    return polygons


def max_airspace_altitude_msl(route_start: tuple, route_end: tuple, shp_path) -> float | None:
    """The highest altitude the route can cruise at while staying under
    every Class B/C/D shelf it laterally passes through, in feet MSL --
    i.e. transiting *beneath* controlled airspace rather than requesting
    clearance through it or climbing above it (the standard technique for
    a small GA aircraft crossing under a shelf). Returns None if the
    route doesn't cross any B/C/D airspace at all (no ceiling imposed).

    A Class D shelf containing the departure or destination point itself
    is deliberately excluded: landing at or departing from your own
    destination/departure airport inherently means transiting its local
    airspace to get to the runway (with whatever clearance/coordination
    that requires), which isn't a *routing* conflict the way an
    unrelated shelf along the way would be -- without this exclusion, a
    route ending at any Class D airport would trivially always produce a
    ~0ft/SFC "ceiling" from its own destination shelf. This exclusion is
    Class-D-only, not B/C: Class D is a compact ring around exactly one
    (typically small, non-towered-adjacent) airport, so "contains the
    endpoint" reliably means "this is that airport's own shelf." Class B
    outer rings are much larger and commonly sit *over* an unrelated
    smaller departure/destination field a route starts or ends at (e.g.
    C81/Grayslake sits laterally under Chicago's Class B) -- that's a
    real constraint on the route, not the endpoint's "own" airspace, so
    B/C polygons are never excluded this way.
    """
    from .geo import corridor_bbox

    bbox = corridor_bbox(route_start, route_end, buffer_nm=2.0)
    polygons = load_controlled_airspace(shp_path, bbox)
    if not polygons:
        return None

    route_line = LineString([(route_start[1], route_start[0]), (route_end[1], route_end[0])])
    start_point = Point(route_start[1], route_start[0])
    end_point = Point(route_end[1], route_end[0])

    def is_own_class_d_shelf(p: dict) -> bool:
        return p["class"] == "D" and (p["geometry"].contains(start_point) or p["geometry"].contains(end_point))

    floors = [
        p["floor_ft_msl"]
        for p in polygons
        if route_line.intersects(p["geometry"]) and not is_own_class_d_shelf(p)
    ]
    return min(floors) if floors else None
