"""The map's FAA overlays as vector tiles, one PMTiles archive a cycle: the
Class B, C, D and E airspace, the special-use areas, the airports, the
navaids and the fixes, for a MapLibre map (the web's, Android's, iOS's) to
draw crisp at every zoom, at once and with no network once it holds the
file. The same for every pilot for the cycle, so it is built once, beside
the cycle pack (wingtip.pack), and served whole with byte ranges
(/api/overlay-tiles).

Where each layer comes from -- every feature is a row or a shape of the
FAA's own data set, its attributes the fields named below:

- `airspace`: the NASR Class Airspace shapefile (class_airspace_shape_files.zip,
  Class_Airspace.shp, Class B to E), as the cycle pack holds it: CLASS,
  LOCAL_TYPE, NAME, IDENT, LOWER_VAL/LOWER_CODE (floor, read as
  wingtip.airspace_at reads it), UPPER_VAL (ceiling, ft MSL; the floor of
  Class A, 18,000 ft MSL per 14 CFR 71.33, for "up to but not including"
  it), UPPER_DESC TNI, WKHR_CODE and WKHR_RMK.
- `special_use`: the FAA's special use airspace feature service (ADDS),
  as the cycle pack holds it: NAME, TYPE_CODE, LOWER_*/UPPER_*, TIMESOFUSE,
  GMTOFFSET/DST_CODE and CONT_AGENT, read as wingtip.sua reads them.
- `airports`: NASR's APT_BASE.csv (ARPT_ID, ICAO_ID, ARPT_NAME,
  SITE_TYPE_CODE, FACILITY_USE_CODE, OWNERSHIP_TYPE_CODE, TWR_TYPE_CODE,
  ELEV, FUEL_TYPES, LAT_DECIMAL/LONG_DECIMAL; ARPT_STATUS O only), with
  each field's runways from APT_RWY.csv (RWY_ID, RWY_LEN,
  SURFACE_TYPE_CODE) and APT_RWY_END.csv (TRUE_ALIGNMENT), by SITE_NO.
- `navaids`: NASR's NAV_BASE.csv, read as wingtip.fixes reads it (in
  service, the kinds a route flies to).
- `fixes`: NASR's FIX_BASE.csv, read as wingtip.fixes reads it, every row.

The tiles are made by tippecanoe (felt/tippecanoe, built into the
planner's image at a pinned tag) into PMTiles, the single-file archive a
browser reads by HTTP range requests (protomaps' pmtiles, spec v3). How
true the lines stay to the FAA's is TOLERANCE_M's comment.
"""
from __future__ import annotations

import csv
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from . import pack as cycle_pack

log = logging.getLogger(__name__)

#: The tippecanoe to run: the planner's image has it on its PATH.
TIPPECANOE = os.environ.get("TIPPECANOE", "tippecanoe")
#: Where the archives live: beside the cycle packs, not committed.
TILES_DIR = cycle_pack.PACK_DIR / "tiles"
INDEX = "overlays.json"
#: What the tiles hold and how, as a number: a change to a layer's
#: attributes, zooms or tolerances bumps it, and the archive is built again
#: under a new name (its address is kept a cycle by every cache).
VERSION = 1

#: The zooms there are tiles of (XYZ zooms, 256-pixel tiles: MapLibre,
#: whose tiles are 512, draws tile z at its own zoom z). From 4, a
#: country on a phone, to 12, where a tile is 9.8 km at the equator;
#: closer in, the map draws zoom 12's tiles larger (overzoom).
MIN_ZOOM = 4
MAX_ZOOM = 12
#: Tile units across a tile (tippecanoe's --detail, its default).
DETAIL = 12

#: How far a drawn line may be from the FAA's, in metres on the ground at
#: the deepest zoom. tippecanoe keeps every simplified line within one
#: tile unit of the line it is given (Douglas-Peucker, --simplification=1,
#: its default) and then puts each point on the tile's grid, at most half
#: a unit each way, 0.71 of a unit off: 1.71 units of a 4096-unit tile.
#: At zoom 12 a tile is 40,075,017 m / 2^12 = 9,784 m across at the
#: equator (WGS 84's equator, web mercator), so a unit is 2.39 m and the
#: worst 4.1 m. Measured on Chicago's Class B at 42 N (every point of its
#: six shelves in every zoom-12 tile, both ways round): 3.6 m at worst,
#: a little over the 1.71 units there (3.0 m), as tippecanoe also nudges
#: the shared borders it detects -- so the bound kept and tested is the
#: equator's 4.1 m. At any zoom below 12 the worst is the same two units
#: or so of that zoom's tile, which MapLibre draws 512 px across: about a
#: quarter of a pixel, at every zoom there are tiles of. Overzoomed past
#: 12 it stays 4.1 m, under 2 px at MapLibre's zoom 15. The phones' packs keep their rings
#: within 0.0001 degree, 11 m (wingtip.pack.PHONE_TOLERANCE_DEG); a
#: sectional's printed airspace line is itself some 100 m wide at
#: 1:500,000. tests/test_vector_tiles.py measures it on Chicago's Class B.
TOLERANCE_M = round((1 + 0.5 * 2**0.5) * 40_075_016.686 / 2**MAX_ZOOM / 2**DETAIL, 1)

#: Each layer's first zoom, by what the feature is. Below it a feature is
#: left out of the tiles; from it on, it is in every tile it touches, and
#: none is ever dropped for a tile's size (--no-feature-limit,
#: --no-tile-size-limit, -r1, --no-tiny-polygon-reduction).
AIRSPACE_MIN_ZOOM = {"B": 4, "C": 5, "D": 6}
#: Class E by its LOCAL_TYPE: at the surface (E2), the extensions of a
#: Class C's or D's surface area (E3, E4), from 700 or 1,200 ft (E5), and
#: the en route and offshore areas (E6, E7). 14 CFR 71.71, 71.79.
CLASS_E_MIN_ZOOM = {"CLASS_E2": 7, "CLASS_E3": 7, "CLASS_E4": 7}
CLASS_E_OTHER_MIN_ZOOM = 8
SPECIAL_USE_MIN_ZOOM = 5
#: Airports by `rank` (airport_rank): towered, public with a hard runway
#: of 3,000 ft or more, other public, private, then heliports and the rest.
AIRPORT_MIN_ZOOM = (5, 6, 7, 9, 10)
#: The VORs (wingtip.fixes.VOR_KINDS) a zoom out; the rest closer in.
VOR_MIN_ZOOM = 5
NAVAID_MIN_ZOOM = 7
#: VFR waypoints and the low enroute chart's fixes; every other fix
#: (RNAV and approach fixes) closer in.
CHARTED_FIX_MIN_ZOOM = 8
FIX_MIN_ZOOM = 10

LAYERS = ("airspace", "special_use", "airports", "navaids", "fixes")
ATTRIBUTION = "FAA NASR and special use airspace (ADDS), cycle {cycle}"

#: NASR's SITE_TYPE_CODE (APT_BASE).
SITE_TYPES = {"A": "airport", "H": "heliport", "C": "seaplane", "G": "gliderport", "U": "ultralight",
              "B": "balloonport"}
#: The runway surfaces the sectional's airport symbol counts as hard
#: (FAA Aeronautical Chart User's Guide, VFR Terms and Symbols, Airports:
#: "hard-surfaced runways"), by NASR's SURFACE_TYPE_CODE (APT_RWY):
#: asphalt, concrete, PEM (partially concrete, asphalt or bitumen-bound
#: macadam), porous friction courses and brick. A mixed surface
#: ("ASPH-TURF") counts only when every part is hard ("ASPH-CONC"); TRTD
#: (treated) goes with a hard one and is not one alone.
HARD_SURFACES = frozenset({"ASPH", "CONC", "PEM", "PFC", "BRICK"})
#: The rank a field must reach for its tier: what `rank` sorts symbols by.
LONG_HARD_FT = 3000


def _orient(geometry):
    """Polygons with their outer rings counter-clockwise and holes
    clockwise, as RFC 7946 GeoJSON has them and tippecanoe reads them:
    the shapefile's are the other way round."""
    import shapely
    from shapely.geometry.polygon import orient

    if geometry.geom_type == "Polygon":
        return orient(geometry, sign=1.0)
    if geometry.geom_type == "MultiPolygon":
        return shapely.MultiPolygon([orient(p, sign=1.0) for p in geometry.geoms])
    return None


def _meets(box, bbox) -> bool:
    """Whether a (west, south, east, north) box meets bbox; any without one."""
    return bbox is None or not (box[2] < bbox[0] or box[0] > bbox[2] or box[3] < bbox[1] or box[1] > bbox[3])


def _feature(properties: dict, geometry: str, minzoom: int) -> str:
    """One line of GeoJSON for tippecanoe, its first zoom in its own
    `tippecanoe` member; fields with no value left out, as a vector tile
    has no null."""
    props = {k: v for k, v in properties.items() if v is not None and v != ""}
    return (f'{{"type":"Feature","tippecanoe":{{"minzoom":{minzoom}}},'
            f'"properties":{json.dumps(props, separators=(",", ":"))},"geometry":{geometry}}}\n')


def airspace_features(pack, bbox=None):
    """The `airspace` layer's lines of GeoJSON from the cycle pack: each
    Class B, C, D and E volume as wingtip.pack's phone packs describe it."""
    import shapely

    numbers = cycle_pack._controlled_numbers(pack)
    for record, number, geometry in zip(pack.attrs("airspace"), numbers, pack.geometries("airspace")):
        geometry = _orient(geometry)
        if geometry is None or geometry.is_empty or not _meets(geometry.bounds, bbox):
            continue
        volume = cycle_pack._volume_drawn(record, number)
        cls = volume["class"]
        minzoom = AIRSPACE_MIN_ZOOM.get(cls) or CLASS_E_MIN_ZOOM.get(volume["local_type"], CLASS_E_OTHER_MIN_ZOOM)
        yield _feature({
            "class": cls, "local_type": volume["local_type"], "name": volume["name"], "ident": volume["ident"],
            "floor_ft": volume["floor_ft"], "floor_ref": volume["floor_ref"], "ceiling_ft": volume["ceiling_ft"],
            "ceiling_excluded": volume["ceiling_excluded"], "number": number,
            "hours_code": volume["hours_code"], "hours_remark": volume["hours_remark"],
        }, shapely.to_geojson(geometry), minzoom)


def special_use_features(pack, bbox=None):
    """The `special_use` layer's lines: each area as wingtip.sua reads it."""
    import shapely

    from . import sua

    if "sua.attr" not in pack.sections:
        return
    for props, geometry in zip(pack.attrs("sua"), pack.geometries("sua")):
        geometry = _orient(geometry)
        if geometry is None or geometry.is_empty or not _meets(geometry.bounds, bbox):
            continue
        area = sua._area(props or {})
        yield _feature({
            "type": area["type"], "kind": area["kind"], "name": area["name"],
            "floor_ft": area["floor_ft"], "floor_ref": area["floor_ref"],
            "ceiling_ft": area["ceiling_ft"], "ceiling_ref": area["ceiling_ref"],
            "times_of_use": area["times_of_use"], "time_zone": area["time_zone"],
            "controlling_agency": area["controlling_agency"],
        }, shapely.to_geojson(geometry), SPECIAL_USE_MIN_ZOOM)


def _rows(path: Path):
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        yield from csv.DictReader(f)


def _number(text) -> float | None:
    try:
        return float((text or "").strip())
    except ValueError:
        return None


def _hard(surface: str) -> bool:
    parts = [p for p in re.split(r"[-/]", (surface or "").strip().upper()) if p]
    return bool(parts) and all(p in HARD_SURFACES or p == "TRTD" for p in parts) and any(p in HARD_SURFACES for p in parts)


def runways_by_site(rwy_path: Path, rwy_end_path: Path | None) -> dict[str, dict]:
    """Each field's runways, by NASR's SITE_NO: its longest (RWY_LEN, ft),
    its longest hard-surfaced one (HARD_SURFACES), and the true alignment
    of its longest's first end (APT_RWY_END's TRUE_ALIGNMENT, degrees).
    Helipads (RWY_ID H1 and the like) are no runways here."""
    found: dict[str, dict] = {}
    for row in _rows(rwy_path):
        site, rwy = (row.get("SITE_NO") or "").strip(), (row.get("RWY_ID") or "").strip().upper()
        length = _number(row.get("RWY_LEN"))
        if not site or not rwy or rwy.startswith("H") or not length:
            continue
        held = found.setdefault(site, {"longest_ft": 0, "hard_ft": 0, "longest_id": None})
        if length > held["longest_ft"]:
            held["longest_ft"], held["longest_id"] = int(length), rwy
        if _hard(row.get("SURFACE_TYPE_CODE") or "") and length > held["hard_ft"]:
            held["hard_ft"] = int(length)
    if rwy_end_path is not None:
        for row in _rows(rwy_end_path):
            held = found.get((row.get("SITE_NO") or "").strip())
            if held is None or "runway_true" in held or (row.get("RWY_ID") or "").strip().upper() != held["longest_id"]:
                continue
            alignment = _number(row.get("TRUE_ALIGNMENT"))
            if alignment is not None:
                held["runway_true"] = int(alignment) % 360
    return found


def airport_rank(site_type: str, use: str, towered: bool, hard_ft: int) -> int:
    """What a field's symbol is sorted and first shown by (AIRPORT_MIN_ZOOM):
    0 towered, 1 public with a hard runway of LONG_HARD_FT or more, 2 other
    public airports, 3 private airports, 4 heliports and the rest."""
    if site_type not in ("A", "C", "G", "U", "B"):
        return 4
    if towered:
        return 0
    if use == "PU":
        return 1 if hard_ft >= LONG_HARD_FT and site_type == "A" else 2
    return 3


def airport_features(apt_path: Path, rwy_path: Path | None, rwy_end_path: Path | None, bbox=None):
    """The `airports` layer's lines: every operational field in APT_BASE
    (ARPT_STATUS O; the closed ones, CI and CP, are not drawn as fields),
    with its runways (runways_by_site)."""
    from .faa_data import MILITARY_OWNERS

    runways = runways_by_site(rwy_path, rwy_end_path) if rwy_path is not None else {}
    for row in _rows(apt_path):
        if (row.get("ARPT_STATUS") or "").strip() != "O":
            continue
        lat, lon = _number(row.get("LAT_DECIMAL")), _number(row.get("LONG_DECIMAL"))
        if lat is None or lon is None or not _meets((lon, lat, lon, lat), bbox):
            continue
        faa_id = (row.get("ARPT_ID") or "").strip().upper()
        icao = (row.get("ICAO_ID") or "").strip().upper()
        site_type = (row.get("SITE_TYPE_CODE") or "").strip()
        use = (row.get("FACILITY_USE_CODE") or "").strip()
        # ATCT, ATCT-A/C, ATCT-TRACON and the rest; NON-ATCT is none.
        towered = (row.get("TWR_TYPE_CODE") or "").strip().upper().startswith("ATCT")
        ways = runways.get((row.get("SITE_NO") or "").strip(), {})
        military = (row.get("OWNERSHIP_TYPE_CODE") or "").strip() in MILITARY_OWNERS
        rank = airport_rank(site_type, use, towered, ways.get("hard_ft", 0))
        yield _feature({
            "ident": icao or faa_id, "faa_id": faa_id, "name": (row.get("ARPT_NAME") or "").strip(),
            "type": SITE_TYPES.get(site_type, site_type.lower()),
            "use": {"PU": "public", "PR": "private"}.get(use, use.lower()),
            # As wingtip.faa_data.military_fields: a field the armed services
            # own, "joint" where it is open to the public as well.
            "military": ("joint" if use == "PU" else "military") if military else None,
            "towered": towered, "elevation_ft": _number(row.get("ELEV")),
            "longest_ft": ways.get("longest_ft"), "hard_ft": ways.get("hard_ft"),
            "runway_true": ways.get("runway_true"),
            "fuel": (row.get("FUEL_TYPES") or "").strip(), "rank": rank,
        }, f'{{"type":"Point","coordinates":[{lon},{lat}]}}', AIRPORT_MIN_ZOOM[rank])


def navaid_features(nav_path: Path, bbox=None):
    """The `navaids` layer's lines: wingtip.fixes's navaids in service."""
    from . import fixes

    for found in fixes._read_navaids(nav_path).values():
        for n in found:
            if not _meets((n["lon"], n["lat"], n["lon"], n["lat"]), bbox):
                continue
            yield _feature({
                "ident": n["ident"], "name": n["name"], "kind": n["kind"], "freq": n["freq"], "channel": n["channel"],
                "service_volume": n["service_volume"], "mag_var": n["mag_var"], "elevation_ft": n["elevation_ft"],
                "hours": n["hours"], "restricted": n["restricted"],
            }, f'{{"type":"Point","coordinates":[{n["lon"]},{n["lat"]}]}}',
                VOR_MIN_ZOOM if n["kind"] in fixes.VOR_KINDS else NAVAID_MIN_ZOOM)


def fix_features(fix_path: Path, bbox=None):
    """The `fixes` layer's lines: every row of FIX_BASE (wingtip.fixes.read_rows)."""
    from . import fixes

    for f in fixes.read_rows(fix_path):
        if not _meets((f["lon"], f["lat"], f["lon"], f["lat"]), bbox):
            continue
        yield _feature({
            "ident": f["ident"], "kind": f["kind"], "vfr": f["vfr"], "enroute_low": f["enroute_low"],
        }, f'{{"type":"Point","coordinates":[{f["lon"]},{f["lat"]}]}}',
            CHARTED_FIX_MIN_ZOOM if f["vfr"] or f["enroute_low"] else FIX_MIN_ZOOM)


def write_layers(folder: Path, pack, *, apt_path: Path, rwy_path: Path | None, rwy_end_path: Path | None,
                 nav_path: Path, fix_path: Path, bbox=None) -> dict[str, int]:
    """Each layer's GeoJSON, a feature a line, into folder/<layer>.geojsonl;
    how many features each holds."""
    sources = {
        "airspace": airspace_features(pack, bbox),
        "special_use": special_use_features(pack, bbox),
        "airports": airport_features(apt_path, rwy_path, rwy_end_path, bbox),
        "navaids": navaid_features(nav_path, bbox),
        "fixes": fix_features(fix_path, bbox),
    }
    counts = {}
    for layer, lines in sources.items():
        n = 0
        with open(folder / f"{layer}.geojsonl", "w") as out:
            for line in lines:
                out.write(line)
                n += 1
        counts[layer] = n
    return counts


def tippecanoe_args(folder: Path, out: Path, cycle: str, tippecanoe: str = TIPPECANOE) -> list[str]:
    """tippecanoe's command for the layers in folder. Nothing is dropped
    to keep a tile small, a polygon too small to see included; adjacent
    volumes' shared borders (a Class B's shelves) simplified alike, so no
    sliver opens between them; each feature an id, for the map's state
    (hover, the one tapped)."""
    args = [
        tippecanoe, "-o", str(out), "--force", "--quiet",
        "-Z", str(MIN_ZOOM), "-z", str(MAX_ZOOM), "--full-detail", str(DETAIL), "--low-detail", str(DETAIL),
        "--simplification", "1",
        "--no-feature-limit", "--no-tile-size-limit", "--no-tiny-polygon-reduction", "--drop-rate", "1",
        "--detect-shared-borders", "--generate-ids", "--read-parallel",
        "--temporary-directory", str(folder),
        "--name", f"Wingtip FAA overlays {cycle}",
        "--description", f"Airspace, special use, airports, navaids and fixes, FAA cycle {cycle}",
        "--attribution", ATTRIBUTION.format(cycle=cycle),
    ]
    for layer in LAYERS:
        args += ["-L", f"{layer}:{folder / f'{layer}.geojsonl'}"]
    return args


def archive_name(pack) -> str:
    """The archive's name: its cycle, VERSION and the pack's own CRC, so a
    pack rebuilt inside a cycle (a new airspace file, the special-use
    areas fetched again) gets an address no cache holds yet."""
    return f"{pack.cycle}-v{VERSION}-{pack.crc32:08x}"


def build(pack, cache_dir, out_dir=None, *, bbox=None, tippecanoe: str = TIPPECANOE) -> dict:
    """The archive of the pack's shapes and the NASR files in cache_dir,
    written whole into out_dir with its index (what /api/overlay-tiles
    gives), and any older archive removed. With bbox, (west, south, east,
    north), only the features that meet it: a sample."""
    from . import faa_data

    cache_dir, out_dir = Path(cache_dir), Path(out_dir or TILES_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)
    name = archive_name(pack)
    path = out_dir / f"{name}.pmtiles"
    started = time.monotonic()

    def nasr(file: str) -> Path:
        return faa_data.ensure_nasr_file(file, cache_dir)

    with tempfile.TemporaryDirectory(dir=out_dir, prefix=".build-") as tmp:
        folder = Path(tmp)
        counts = write_layers(folder, pack, apt_path=nasr("APT_BASE.csv"), rwy_path=nasr("APT_RWY.csv"),
                              rwy_end_path=nasr("APT_RWY_END.csv"), nav_path=nasr("NAV_BASE.csv"),
                              fix_path=nasr("FIX_BASE.csv"), bbox=bbox)
        part = folder / "out.pmtiles"
        run = subprocess.run(tippecanoe_args(folder, part, pack.cycle, tippecanoe), capture_output=True, text=True)
        if run.returncode != 0:
            raise RuntimeError(f"tippecanoe failed ({run.returncode}): {run.stderr[-2000:]}")
        os.replace(part, path)
    index = {
        "cycle": pack.cycle, "name": name, "version": VERSION, "bytes": path.stat().st_size, "built_at": time.time(),
        "min_zoom": MIN_ZOOM, "max_zoom": MAX_ZOOM, "tolerance_m": TOLERANCE_M,
        "layers": [{"name": layer, "features": counts[layer]} for layer in LAYERS],
    }
    (out_dir / f"{INDEX}.part").write_text(json.dumps(index, separators=(",", ":")))
    os.replace(out_dir / f"{INDEX}.part", out_dir / INDEX)
    for old in out_dir.glob("*.pmtiles"):
        if old != path:
            old.unlink(missing_ok=True)
    log.info("Overlay tiles %s built in %.1f s, %.1f MB: %s", name, time.monotonic() - started,
             index["bytes"] / 1e6, ", ".join(f"{k} {v}" for k, v in counts.items()))
    return index


def tiles_index(out_dir=None) -> dict | None:
    """The archive on disk, as its index says; None where there is none."""
    folder = Path(out_dir or TILES_DIR)
    try:
        index = json.loads((folder / INDEX).read_text())
    except (OSError, ValueError):
        return None
    return index if (folder / f"{index.get('name')}.pmtiles").is_file() else None


def tiles_path(name: str, out_dir=None) -> Path | None:
    """An archive on disk by its name (archive_name); None where there is
    none, or the name is not one."""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}-v\d+-[0-9a-f]{8}", name):
        return None
    path = Path(out_dir or TILES_DIR) / f"{name}.pmtiles"
    return path if path.is_file() else None


def ensure(cache_dir, pack_dir=None, out_dir=None) -> dict | None:
    """The archive built where the one on disk is not of the cycle pack
    the planner holds now (archive_name); None where it already is, there
    is no pack, or no tippecanoe to build with (a planner run outside its
    image: the map then has no overlay tiles, and asks the in-view
    endpoints as before)."""
    pack = cycle_pack.current(pack_dir)
    if pack is None:
        return None
    held = tiles_index(out_dir)
    if held is not None and held.get("name") == archive_name(pack):
        return None
    if shutil.which(TIPPECANOE) is None:
        log.warning("No %s on the PATH: the overlay tiles are not built", TIPPECANOE)
        return None
    return build(pack, cache_dir, out_dir)
