"""Controlled airspace along a route, from the FAA's own Class Airspace
shapefile -- real polygon geometry via shapely (pyshp reads the
.shp/.dbf; no geopandas/fiona needed), not an approximated circle, so
irregular/non-standard shelves are handled correctly.

The classes are not interchangeable, and this module stopped treating
them as such on 2026-09-10. Entering Class C or Class D requires only
that two-way radio communication be established -- you call approach or
tower, they answer with your callsign, and you are in. That is routine
VFR practice, not an obstacle, so C and D do not constrain cruising
altitude at all. They are reported instead as airspace to establish
contact with, which is nav-log information a pilot wants.

Class B is different: it takes an explicit clearance ("cleared into the
Bravo"), which may not be granted, and a light aircraft is usually better
off staying beneath the shelf and out of the way of airliners. So Class B
alone imposes a ceiling.

Before this, all of B/C/D imposed one, which forced routes beneath
shelves a pilot would simply have talked their way through -- and for a
Class-C-to-Class-C route left no legal altitude at all.

Class E is excluded entirely: VFR overflight needs neither clearance nor
a radio call, just cloud clearance and visibility minimums.
"""
import pickle
import struct
import threading
from pathlib import Path

import shapefile
from shapely import from_wkb, to_wkb
from shapely.geometry import LineString, Point, shape as shapely_shape

from .faa_data import NASR_INDEX_URL, download_and_extract, find_current_cycle_page, find_download_link

CONTROLLED_CLASSES = ("B", "C", "D")

# Classes that need only two-way radio communication established, not a
# clearance -- so they are reported, never used as a ceiling.
TWO_WAY_COMMS_CLASSES = ("C", "D")

# Class B takes an explicit clearance, which can be refused and which a
# light aircraft is usually better off not asking for. This is the only
# class that pushes a route beneath a shelf.
CLEARANCE_CLASSES = ("B",)


# A shapefile is three files, not one, and all three are needed: .shp
# holds the geometry, .shx indexes it, .dbf holds the attributes (CLASS,
# NAME, the altitude fields). Missing any one of them fails at read time.
SHAPEFILE_SUFFIXES = (".shp", ".shx", ".dbf")


def _is_icloud_evicted(path: Path) -> bool:
    """Whether iCloud has evicted this file, leaving only a placeholder.

    macOS replaces an offloaded file with a hidden sibling named
    ".<filename>.icloud" of a couple of hundred bytes. The original path
    then simply does not exist, so an existence check reports "missing"
    correctly -- but the *reason* matters, because re-downloading a
    394 MB shapefile will not keep it on disk if iCloud is going to
    offload it again, which is exactly what happened here twice in one
    afternoon under Desktop & Documents syncing.

    A file is only evicted if the real path is gone *and* the placeholder
    is there. Testing for the placeholder alone reports a file that iCloud
    is in the middle of restoring as missing.
    """
    return not path.exists() and (path.parent / f".{path.name}.icloud").exists()


def _shapefile_is_complete(shp_path: Path) -> bool:
    """Whether a cached shapefile is whole, not just present.

    Two failure modes, both hit for real on 2026-09-10.

    Truncation: a shapefile header stores the file's own total length (in
    16-bit words, big-endian, at byte 24), so a short download is
    detectable without parsing a single shape. Worth checking because the
    symptom is otherwise baffling -- a partial file opens, reads its first
    177 shapes, then raises KeyError on a garbage shape type from the
    middle of the file. The cached copy was 388,769,780 bytes against a
    true 394,056,164, and since the old code asked only whether the path
    existed, no amount of re-running would ever have replaced it.

    Missing companions: iCloud evicted Class_Airspace.dbf minutes after a
    clean download, which fails much later with pyshp's "DbfReader
    requires a .dbf file" rather than anything about the cache.
    """
    try:
        for suffix in SHAPEFILE_SUFFIXES:
            if not shp_path.with_suffix(suffix).exists():
                return False
        with shp_path.open("rb") as f:
            header = f.read(100)
        if len(header) < 100 or struct.unpack(">i", header[0:4])[0] != 9994:
            return False
        declared = struct.unpack(">i", header[24:28])[0] * 2
        return declared == shp_path.stat().st_size
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
            evicted = [
                shp_path.with_suffix(x).name
                for x in SHAPEFILE_SUFFIXES
                if _is_icloud_evicted(shp_path.with_suffix(x))
            ]
            if evicted:
                raise RuntimeError(
                    f"iCloud evicted {', '.join(evicted)} from {shp_path.parent} right after "
                    "downloading it. Re-downloading will not help while this directory syncs "
                    "to iCloud -- exclude data/raw from syncing (renaming a parent directory "
                    "to end in '.nosync', or keeping the project outside Desktop/Documents)."
                )
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


# The Class B/C/D polygons, parsed once per process and held in memory:
# every altitude selection needs them, and walking Class_Airspace.shp --
# 5,612 PolygonZ records, 394 MB, twelve million vertices -- takes about
# thirty seconds. Held bbox-independent, so every route shares one parse.
_ALL_AIRSPACE_CACHE: dict = {}
_ALL_AIRSPACE_LOCK = threading.Lock()

# The same polygons written beside the shapefile as WKB, so a fresh
# process (every planner restart, every agent run) reads them back in
# about a second instead of re-walking the shapefile. Keyed by the
# shapefile's size and mtime, so a new 28-day cycle rebuilds it.
_CONTROLLED_CACHE_SUFFIX = ".controlled.pkl"


def _load_all_controlled_airspace(shp_path) -> list:
    """Every Class B/C/D polygon in the national shapefile, with its
    Shapely geometry built: from memory, else from the WKB cache beside
    the file, else parsed from the shapefile and cached both ways.

    One loader at a time -- a request arriving while the startup
    warm-up is parsing waits for its result rather than parsing again.
    """
    shp_path = Path(shp_path)
    stat = shp_path.stat()
    key = (str(shp_path), stat.st_size, stat.st_mtime)
    with _ALL_AIRSPACE_LOCK:
        if key not in _ALL_AIRSPACE_CACHE:
            polygons = _read_controlled_cache(shp_path, key)
            if polygons is None:
                polygons = _parse_controlled_airspace(shp_path)
                _write_controlled_cache(shp_path, key, polygons)
            _ALL_AIRSPACE_CACHE[key] = polygons
        return _ALL_AIRSPACE_CACHE[key]


def _parse_controlled_airspace(shp_path: Path) -> list:
    sf = shapefile.Reader(str(shp_path))
    polygons = []
    for sr in sf.iterShapeRecords():
        record = sr.record.as_dict()
        if record["CLASS"] not in CONTROLLED_CLASSES:
            continue
        polygons.append(
            {
                "name": record["NAME"],
                "class": record["CLASS"],
                "floor_ft_msl": _floor_ft_msl(record),
                "geometry": shapely_shape(sr.shape.__geo_interface__),
                "bbox": tuple(sr.shape.bbox),  # (min_lon, min_lat, max_lon, max_lat)
            }
        )
    return polygons


def _controlled_cache_path(shp_path: Path) -> Path:
    return shp_path.with_suffix(_CONTROLLED_CACHE_SUFFIX)


def _read_controlled_cache(shp_path: Path, key: tuple) -> list | None:
    path = _controlled_cache_path(shp_path)
    if not path.exists():
        return None
    try:
        with path.open("rb") as f:
            cached = pickle.load(f)
    except Exception:  # noqa: BLE001 -- a damaged cache is rebuilt, never fatal
        return None
    if cached.get("key") != key:
        return None
    return [
        {
            "name": p["name"], "class": p["class"], "floor_ft_msl": p["floor_ft_msl"],
            "bbox": tuple(p["bbox"]), "geometry": from_wkb(p["wkb"]),
        }
        for p in cached["polygons"]
    ]


def _write_controlled_cache(shp_path: Path, key: tuple, polygons: list) -> None:
    path = _controlled_cache_path(shp_path)
    payload = {
        "key": key,
        "polygons": [
            {
                "name": p["name"], "class": p["class"], "floor_ft_msl": p["floor_ft_msl"],
                "bbox": p["bbox"], "wkb": to_wkb(p["geometry"]),
            }
            for p in polygons
        ],
    }
    part = path.with_suffix(path.suffix + ".part")
    try:
        with part.open("wb") as f:
            pickle.dump(payload, f, protocol=pickle.HIGHEST_PROTOCOL)
        part.replace(path)
    except OSError:
        # A read-only data directory only loses the speed-up, never the
        # answer: the parse just runs again next process.
        part.unlink(missing_ok=True)


def preload(faa_cache_dir) -> None:
    """Parses (or reads back) the controlled-airspace polygons now, so a
    service can pay the cold cost at startup rather than on a pilot's
    first request."""
    _load_all_controlled_airspace(ensure_class_airspace_shapefile(faa_cache_dir))


def load_controlled_airspace(shp_path, bbox: tuple) -> list:
    """Class B/C/D polygons (as shapely geometries, with a floor_ft_msl)
    whose bounding box overlaps bbox. Returns a list of
    {"name", "class", "floor_ft_msl", "geometry"} dicts.

    Callers must treat the result as read-only, since it's filtered
    from the same cached list every other bbox query shares.
    """
    min_lat, min_lon, max_lat, max_lon = bbox
    return [
        p for p in _load_all_controlled_airspace(shp_path)
        if not (
            p["bbox"][3] < min_lat or p["bbox"][1] > max_lat
            or p["bbox"][2] < min_lon or p["bbox"][0] > max_lon
        )
    ]


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
    """The highest altitude the route can cruise at while staying beneath
    every Class B shelf it laterally passes through, in feet MSL -- i.e.
    transiting *under* the Bravo rather than requesting a clearance
    through it, which is the usual choice for a light aircraft. Returns
    None if the route crosses no Class B at all, which is most routes.

    Class C and D impose nothing here. Entering either needs only two-way
    radio communication established, which is routine, so they are
    reported by airspace_transits() rather than treated as a lid. See the
    module docstring for what this used to do and why it was wrong.

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
        if p["class"] in CLEARANCE_CLASSES
        and route_line.intersects(p["geometry"])
        and not is_own_surface_area(p, start_point, end_point)
    ]
    return min(floors) if floors else None


def airspace_ceiling_profile(route_start: tuple, route_end: tuple, fixes: list, shp_path) -> list:
    """max_airspace_altitude_msl for each leg of the nav log -- the lowest
    Class B shelf floor the leg between consecutive `fixes` ((lat, lon)
    pairs, the route's ends included) passes laterally under, or None
    where it passes under none. Where the whole route's ceiling is the
    lowest shelf anywhere along it, this is the shelf over each leg, so
    a route can cruise low under the Bravo by the departure and climb
    once past it. The route's own surface areas are excluded on the
    whole route's ends, as in max_airspace_altitude_msl: a leg that
    starts at the departure begins inside that airport's airspace just
    as the route does.
    """
    from .geo import corridor_bbox

    bbox = corridor_bbox(route_start, route_end, buffer_nm=2.0)
    start_point = Point(route_start[1], route_start[0])
    end_point = Point(route_end[1], route_end[0])
    shelves = [
        p for p in load_controlled_airspace(shp_path, bbox)
        if p["class"] in CLEARANCE_CLASSES and not is_own_surface_area(p, start_point, end_point)
    ]

    ceilings = []
    for (lat1, lon1), (lat2, lon2) in zip(fixes, fixes[1:]):
        leg_line = LineString([(lon1, lat1), (lon2, lat2)])
        floors = [p["floor_ft_msl"] for p in shelves if leg_line.intersects(p["geometry"])]
        ceilings.append(min(floors) if floors else None)
    return ceilings


def airspace_transits(route_start: tuple, route_end: tuple, shp_path) -> list:
    """Controlled airspace the route line passes laterally through, in
    along-route order, as {"name", "class", "floor_ft_msl", "requires"}.

    This is nav-log information rather than a constraint: knowing you will
    cross Des Moines Class C at mile 4 tells you to have approach's
    frequency out and to call before you get there. "requires" says which
    kind of permission it takes -- "two-way radio communication" for C and
    D, "ATC clearance" for B -- because those are meaningfully different
    obligations and only the second one can be refused.

    An airport's own surface area is included: you are going to talk to
    that tower whether or not it constrains the route.
    """
    from .geo import along_track_distance_nm, corridor_bbox

    bbox = corridor_bbox(route_start, route_end, buffer_nm=2.0)
    polygons = load_controlled_airspace(shp_path, bbox)
    route_line = LineString([(route_start[1], route_start[0]), (route_end[1], route_end[0])])

    transits = []
    for p in polygons:
        if not route_line.intersects(p["geometry"]):
            continue
        centre = p["geometry"].centroid
        transits.append(
            {
                "name": p["name"],
                "class": p["class"],
                "floor_ft_msl": p["floor_ft_msl"],
                "requires": (
                    "ATC clearance" if p["class"] in CLEARANCE_CLASSES
                    else "two-way radio communication"
                ),
                "along_track_nm": round(
                    along_track_distance_nm(centre.y, centre.x, route_start, route_end), 1
                ),
            }
        )
    # Deduplicated by name+class: a Bravo is filed as several shelf
    # polygons and the route often clips more than one, which would
    # otherwise read as several separate airspaces to call.
    seen, ordered = set(), []
    for t in sorted(transits, key=lambda t: t["along_track_nm"]):
        key = (t["name"], t["class"])
        if key not in seen:
            seen.add(key)
            ordered.append(t)
    return ordered
