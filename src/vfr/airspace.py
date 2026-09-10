"""Class B/C/D airspace ceilings along a route, from the FAA's own Class
Airspace shapefile -- real polygon geometry via shapely (pyshp reads the
.shp/.dbf; no geopandas/fiona needed), not an approximated circle, so
irregular/non-standard shelves are handled correctly.

Class E is deliberately excluded: VFR overflight through Class E doesn't
require ATC clearance (just cloud clearance/visibility minimums), unlike
B/C/D, so it isn't a "do I need clearance to be at this altitude" ceiling
the way B/C/D are.
"""
import struct
from pathlib import Path

import shapefile
from shapely.geometry import LineString, Point, shape as shapely_shape

from .faa_data import NASR_INDEX_URL, download_and_extract, find_current_cycle_page, find_download_link

CONTROLLED_CLASSES = ("B", "C", "D")


def _shapefile_is_complete(shp_path: Path) -> bool:
    """Whether a cached .shp is whole, not just present.

    A shapefile header stores the file's own total length (in 16-bit
    words, big-endian, at byte 24), so a truncated download is detectable
    without parsing a single shape. Worth checking because the failure
    mode is otherwise baffling and permanent: a partial file still opens,
    still reads its first few hundred shapes, and then raises a KeyError
    on a garbage shape type from somewhere in the middle of the file. Hit
    for real on 2026-09-10 -- a 388,769,780-byte cache against a true
    394,056,164, corrupt from record 178 onward, and since the old code
    only asked whether the path existed, no amount of re-running would
    ever replace it.
    """
    try:
        with shp_path.open("rb") as f:
            header = f.read(100)
        if len(header) < 100 or struct.unpack(">i", header[0:4])[0] != 9994:
            return False
        declared = struct.unpack(">i", header[24:28])[0] * 2
        return declared == shp_path.stat().st_size and shp_path.with_suffix(".shx").exists()
    except OSError:
        return False


def ensure_class_airspace_shapefile(cache_dir) -> Path:
    """Download+extract the current-cycle Class Airspace shapefile into
    cache_dir if not already cached (same 28-day-cycle, cache-once
    convention as vfr.faa_data.ensure_nasr_data).

    A cached file that is present but incomplete is re-downloaded rather
    than trusted -- see _shapefile_is_complete.
    """
    cache_dir = Path(cache_dir)
    shp_path = cache_dir / "Shape_Files" / "Class_Airspace.shp"
    if not shp_path.exists() or not _shapefile_is_complete(shp_path):
        cycle_page = find_current_cycle_page(NASR_INDEX_URL)
        zip_url = find_download_link(cycle_page, r'href="([^"]*class_airspace_shape_files\.zip)"')
        download_and_extract(zip_url, cache_dir)
        if not _shapefile_is_complete(shp_path):
            raise RuntimeError(
                f"Class Airspace shapefile at {shp_path} is still incomplete after "
                "re-downloading -- the download is being truncated rather than cached wrong."
            )
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


def is_own_surface_area(polygon: dict, start_point, end_point) -> bool:
    """Whether this airspace polygon is the departure or destination
    airport's own surface area, rather than something the route has to
    route around.

    Two conditions, and the floor is the load-bearing one: the airspace
    must reach the surface, and must enclose one end of the route. An
    overlying shelf fails the first test however low it sits, which is
    what keeps it a real constraint.
    """
    if polygon["floor_ft_msl"] > 0:
        return False
    return polygon["geometry"].contains(start_point) or polygon["geometry"].contains(end_point)


def max_airspace_altitude_msl(route_start: tuple, route_end: tuple, shp_path) -> float | None:
    """The highest altitude the route can cruise at while staying under
    every Class B/C/D shelf it laterally passes through, in feet MSL --
    i.e. transiting *beneath* controlled airspace rather than requesting
    clearance through it or climbing above it (the standard technique for
    a small GA aircraft crossing under a shelf). Returns None if the
    route doesn't cross any B/C/D airspace at all (no ceiling imposed).

    A *surface area* containing the departure or destination point is
    deliberately excluded: landing at or departing from your own airport
    inherently means transiting its local airspace to reach the runway
    (with whatever clearance or coordination that requires), which isn't
    a *routing* conflict the way an unrelated shelf along the way would
    be. Without the exclusion, a route ending at any towered airport
    trivially produces a ~0 ft "ceiling" from that airport's own
    airspace, and no legal cruising altitude at all.

    What identifies "its own airspace" is the floor being at the surface,
    not the airspace class. This was Class-D-only until 2026-09-10, on
    the reasoning that a compact D ring reliably means "that airport's
    shelf" while B and C are larger and often sit over an unrelated
    field. The second half of that is true but the rule drawn from it was
    wrong: KDSM->KOMA is Class C at both ends, so the route began and
    ended inside surface areas with SFC floors and select_cruise_altitude
    returned None for an ordinary 100 nm cross-country.

    Testing the floor instead keeps every case the class test got right.
    An overlying shelf is still a hard constraint, because its floor is
    not the surface -- C81/Grayslake sits laterally under Chicago's Class
    B, whose floor there is a few thousand feet, so it still imposes a
    ceiling exactly as before.
    """
    from .geo import corridor_bbox

    bbox = corridor_bbox(route_start, route_end, buffer_nm=2.0)
    polygons = load_controlled_airspace(shp_path, bbox)
    if not polygons:
        return None

    route_line = LineString([(route_start[1], route_start[0]), (route_end[1], route_end[0])])
    start_point = Point(route_start[1], route_start[0])
    end_point = Point(route_end[1], route_end[0])

    floors = [
        p["floor_ft_msl"]
        for p in polygons
        if route_line.intersects(p["geometry"])
        and not is_own_surface_area(p, start_point, end_point)
    ]
    return min(floors) if floors else None
