"""The map's overlay tiles (wingtip.vector_tiles), built from a small cut
of the FAA's own data round Chicago: the NASR Class Airspace shapefile's
Chicago cut (tests/fixtures/native, as tests/test_phone_pack.py reads it),
a restricted area with a hole as the special-use feature service gives
one, and rows of the 29 Oct 2026 NASR CSVs (APT_BASE, APT_RWY,
APT_RWY_END, NAV_BASE, FIX_BASE) copied as the FAA wrote them, the columns
the tiles read.

- Each layer's features carry the FAA's fields, and start at their zoom.
- With tippecanoe (the planner's image has it; elsewhere those tests are
  skipped): the archive is PMTiles v3 of vector tiles from zoom 4 to 12,
  its layers and fields declared, each feature first in the tiles of its
  zoom, and Chicago's Class B drawn within TOLERANCE_M of the FAA's line,
  both ways round, in every zoom-12 tile it crosses."""
import csv
import gzip
import json
import math
import shutil
import struct
import subprocess
from pathlib import Path

import pytest
import shapely
from shapely.geometry import Polygon

from wingtip import pack as cycle_pack
from wingtip import vector_tiles

FIXTURES = Path(__file__).parent / "fixtures" / "native"
NEEDS_TIPPECANOE = pytest.mark.skipif(
    shutil.which("tippecanoe") is None or shutil.which("tippecanoe-decode") is None,
    reason="no tippecanoe here: the planner's image has it")
#: The cut a test builds: Chicago's Class B and round it.
BBOX = (-88.6, 41.4, -87.2, 42.5)

APT_BASE = [
    {"SITE_NO": "04508.", "SITE_TYPE_CODE": "A", "ARPT_ID": "ORD", "ICAO_ID": "KORD", "ARPT_NAME": "CHICAGO O'HARE INTL",
     "OWNERSHIP_TYPE_CODE": "PU", "FACILITY_USE_CODE": "PU", "LAT_DECIMAL": "41.97694027", "LONG_DECIMAL": "-87.90814972",
     "ELEV": "680", "ARPT_STATUS": "O", "FUEL_TYPES": "100LL,A", "TWR_TYPE_CODE": "ATCT"},
    {"SITE_NO": "04518.8", "SITE_TYPE_CODE": "A", "ARPT_ID": "06C", "ICAO_ID": "", "ARPT_NAME": "SCHAUMBURG RGNL",
     "OWNERSHIP_TYPE_CODE": "PU", "FACILITY_USE_CODE": "PU", "LAT_DECIMAL": "41.98934083", "LONG_DECIMAL": "-88.10124277",
     "ELEV": "801", "ARPT_STATUS": "O", "FUEL_TYPES": "100LL,A", "TWR_TYPE_CODE": "NON-ATCT"},
    {"SITE_NO": "04588.2", "SITE_TYPE_CODE": "A", "ARPT_ID": "LL22", "ICAO_ID": "", "ARPT_NAME": "BROOKERIDGE AIR PARK",
     "OWNERSHIP_TYPE_CODE": "PR", "FACILITY_USE_CODE": "PR", "LAT_DECIMAL": "41.73277777", "LONG_DECIMAL": "-87.99941666",
     "ELEV": "749.4", "ARPT_STATUS": "O", "FUEL_TYPES": "", "TWR_TYPE_CODE": "NON-ATCT"},
    {"SITE_NO": "04382.4", "SITE_TYPE_CODE": "H", "ARPT_ID": "7IL4", "ICAO_ID": "",
     "ARPT_NAME": "NORTHWEST COMMUNITY HOSPITAL", "OWNERSHIP_TYPE_CODE": "PR", "FACILITY_USE_CODE": "PR",
     "LAT_DECIMAL": "42.06774722", "LONG_DECIMAL": "-87.99348888", "ELEV": "758", "ARPT_STATUS": "O", "FUEL_TYPES": "",
     "TWR_TYPE_CODE": "NON-ATCT"},
    # Closed indefinitely (ARPT_STATUS CI): no field to draw. Its place is
    # moved into the cut, so it is left out for its status alone.
    {"SITE_NO": "04500.01", "SITE_TYPE_CODE": "A", "ARPT_ID": "IL63", "ICAO_ID": "", "ARPT_NAME": "MAYS AVIATION",
     "OWNERSHIP_TYPE_CODE": "PR", "FACILITY_USE_CODE": "PR", "LAT_DECIMAL": "41.9", "LONG_DECIMAL": "-88.0",
     "ELEV": "720", "ARPT_STATUS": "CI", "FUEL_TYPES": "", "TWR_TYPE_CODE": "NON-ATCT"},
]
APT_RWY = [
    {"SITE_NO": "04508.", "RWY_ID": "04L/22R", "RWY_LEN": "7500", "SURFACE_TYPE_CODE": "ASPH"},
    {"SITE_NO": "04508.", "RWY_ID": "09C/27C", "RWY_LEN": "11245", "SURFACE_TYPE_CODE": "CONC"},
    {"SITE_NO": "04508.", "RWY_ID": "10L/28R", "RWY_LEN": "13000", "SURFACE_TYPE_CODE": "ASPH-CONC"},
    {"SITE_NO": "04508.", "RWY_ID": "10X", "RWY_LEN": "0", "SURFACE_TYPE_CODE": ""},
    {"SITE_NO": "04508.", "RWY_ID": "H1", "RWY_LEN": "200", "SURFACE_TYPE_CODE": "CONC"},
    {"SITE_NO": "04518.8", "RWY_ID": "11/29", "RWY_LEN": "3800", "SURFACE_TYPE_CODE": "CONC"},
    {"SITE_NO": "04588.2", "RWY_ID": "09/27", "RWY_LEN": "2813", "SURFACE_TYPE_CODE": "ASPH"},
    {"SITE_NO": "04588.2", "RWY_ID": "18/36", "RWY_LEN": "1940", "SURFACE_TYPE_CODE": "TURF"},
    {"SITE_NO": "04382.4", "RWY_ID": "H1", "RWY_LEN": "50", "SURFACE_TYPE_CODE": "CONC"},
]
APT_RWY_END = [
    {"SITE_NO": "04508.", "RWY_ID": "10L/28R", "RWY_END_ID": "10L", "TRUE_ALIGNMENT": "90"},
    {"SITE_NO": "04508.", "RWY_ID": "10L/28R", "RWY_END_ID": "28R", "TRUE_ALIGNMENT": "270"},
    {"SITE_NO": "04518.8", "RWY_ID": "11/29", "RWY_END_ID": "11", "TRUE_ALIGNMENT": ""},
]
NAV_BASE = [
    {"NAV_ID": "DPA", "NAV_TYPE": "VOR/DME", "NAME": "DUPAGE", "NAV_STATUS": "OPERATIONAL RESTRICTED",
     "LAT_DECIMAL": "41.89037147", "LONG_DECIMAL": "-88.35017747", "ELEV": "801.6", "MAG_VARN": "2",
     "MAG_VARN_HEMIS": "E", "FREQ": "114.55", "CHAN": "92Y", "ALT_CODE": "VL", "OPER_HOURS": "24", "STATE_CODE": "IL"},
    {"NAV_ID": "CGT", "NAV_TYPE": "VORTAC", "NAME": "CHICAGO HEIGHTS", "NAV_STATUS": "OPERATIONAL RESTRICTED",
     "LAT_DECIMAL": "41.51000658", "LONG_DECIMAL": "-87.57154611", "ELEV": "633.6", "MAG_VARN": "2",
     "MAG_VARN_HEMIS": "E", "FREQ": "114.2", "CHAN": "89X", "ALT_CODE": "L", "OPER_HOURS": "24", "STATE_CODE": "IL"},
]
FIX_BASE = [
    {"FIX_ID": "VPAON", "STATE_CODE": "IL", "LAT_DECIMAL": "42.07806388", "LONG_DECIMAL": "-87.86358888",
     "FIX_USE_CODE": "VFR  ", "CHARTS": "SECTIONAL,VFR TERMINAL AREA"},
    {"FIX_ID": "VPDVA", "STATE_CODE": "IL", "LAT_DECIMAL": "41.99245", "LONG_DECIMAL": "-88.02363888",
     "FIX_USE_CODE": "VFR  ", "CHARTS": "HELICOPTER ROUTE"},
    {"FIX_ID": "ACCRA", "STATE_CODE": "IL", "LAT_DECIMAL": "41.93333333", "LONG_DECIMAL": "-88.01944444",
     "FIX_USE_CODE": "WP   ", "CHARTS": "CONTROLLER,ENROUTE HIGH,ENROUTE LOW,SID"},
    {"FIX_ID": "EVRSN", "STATE_CODE": "IL", "LAT_DECIMAL": "41.94477222", "LONG_DECIMAL": "-87.95461666",
     "FIX_USE_CODE": "WP   ", "CHARTS": "IAP"},
]
#: A restricted area as the feature service gives one, as
#: tests/test_phone_pack.py's: a counter-clockwise outer ring, a hole.
AREA_OUTER = [(-88.3, 41.5), (-88.1, 41.5), (-88.1, 41.7), (-88.3, 41.7), (-88.3, 41.5)]
AREA_HOLE = [(-88.22, 41.58), (-88.22, 41.62), (-88.18, 41.62), (-88.18, 41.58), (-88.22, 41.58)]
AREA_PROPS = {"NAME": "R-9999 TEST", "TYPE_CODE": "R", "LOWER_VAL": "0", "LOWER_UOM": "FT", "LOWER_CODE": "SFC",
              "UPPER_VAL": "5000", "UPPER_UOM": "FT", "UPPER_CODE": "MSL", "TIMESOFUSE": "0700-2200 MON-FRI",
              "GMTOFFSET": "-6", "DST_CODE": "1", "CONT_AGENT": "CHICAGO TRACON"}


def _csv(path: Path, rows: list[dict]) -> Path:
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["EFF_DATE", *rows[0]], quoting=csv.QUOTE_ALL)
        writer.writeheader()
        for row in rows:
            writer.writerow({"EFF_DATE": "2026/10/29", **row})
    return path


@pytest.fixture(scope="module")
def sources(tmp_path_factory):
    """The planner's pack of the Chicago cut and the restricted area, and
    a NASR folder of the rows above."""
    root = tmp_path_factory.mktemp("overlays")
    shp = root / "chicago_airspace.shp"
    for part in ("shp", "dbf"):
        shp.with_suffix(f".{part}").write_bytes(gzip.decompress((FIXTURES / f"chicago_airspace.{part}.gz").read_bytes()))
    shutil.copy(FIXTURES / "chicago_airspace.shx", shp.with_suffix(".shx"))
    area = Polygon(AREA_OUTER, [AREA_HOLE])
    packed = cycle_pack.write(root / "packs", "2026-10-29", shp_path=shp, sua_held=[({"properties": AREA_PROPS}, area, area.bounds)],
                              sua_at=0.0, urban=[], urban_path=None, tables={})
    nasr = root / "nasr"
    nasr.mkdir()
    for name, rows in (("APT_BASE.csv", APT_BASE), ("APT_RWY.csv", APT_RWY), ("APT_RWY_END.csv", APT_RWY_END),
                       ("NAV_BASE.csv", NAV_BASE), ("FIX_BASE.csv", FIX_BASE)):
        _csv(nasr / name, rows)
    return cycle_pack.Pack(packed), nasr


def _lines(lines) -> list[dict]:
    return [json.loads(line) for line in lines]


def test_the_airspace_carries_the_shapefiles_fields_and_its_shape_unchanged(sources):
    pack, _ = sources
    features = _lines(vector_tiles.airspace_features(pack))
    assert len(features) == len(pack.attrs("airspace")) == 21
    floors = sorted(f["properties"]["floor_ft"] for f in features if f["properties"]["class"] == "B")
    # The Chicago Class B's six shelves, from the surface to 4,000 ft MSL,
    # all to 10,000 ft (LOWER_VAL, UPPER_VAL).
    assert floors == [0, 1900, 3000, 3600, 4000, 4000]
    b = next(f for f in features if f["properties"]["class"] == "B" and f["properties"]["floor_ft"] == 0)
    expected = {"class": "B", "local_type": "CLASS_B", "name": "CHICAGO CLASS B", "ident": "ORD", "floor_ft": 0.0,
                "floor_ref": "SFC", "ceiling_ft": 10000.0, "ceiling_excluded": False}
    assert {k: b["properties"].get(k) for k in expected} == expected
    assert isinstance(b["properties"]["number"], int)
    assert b["tippecanoe"] == {"minzoom": 4}
    # The shape as the pack holds it, only wound as GeoJSON winds it.
    held = [g for a, g in zip(pack.attrs("airspace"), pack.geometries("airspace"))
            if a["CLASS"] == "B" and float(a["LOWER_VAL"]) == 0][0]
    drawn = shapely.from_geojson(json.dumps(b["geometry"]))
    assert drawn.equals(held)
    assert all(p.exterior.is_ccw for p in getattr(drawn, "geoms", [drawn]))
    zooms = {(f["properties"]["class"], f["properties"]["local_type"]): f["tippecanoe"]["minzoom"] for f in features}
    assert zooms == {("B", "CLASS_B"): 4, ("C", "CLASS_C"): 5, ("D", "CLASS_D"): 6, ("E", "CLASS_E2"): 7,
                     ("E", "CLASS_E5"): 8}


def test_the_special_use_area_keeps_its_hole_and_fields(sources):
    pack, _ = sources
    [area] = _lines(vector_tiles.special_use_features(pack))
    expected = {"type": "R", "kind": "restricted area", "name": "R-9999 TEST", "floor_ft": 0.0, "floor_ref": "SFC",
                "ceiling_ft": 5000.0, "ceiling_ref": "MSL", "times_of_use": "0700-2200 MON-FRI",
                "controlling_agency": "CHICAGO TRACON"}
    assert {k: area["properties"].get(k) for k in expected} == expected
    assert area["tippecanoe"] == {"minzoom": 5}
    geometry = shapely.from_geojson(json.dumps(area["geometry"]))
    assert len(geometry.interiors) == 1 and geometry.exterior.is_ccw and not geometry.interiors[0].is_ccw


def test_the_airports_as_nasr_files_them(sources):
    _, nasr = sources
    found = {f["properties"]["faa_id"]: f for f in _lines(vector_tiles.airport_features(
        nasr / "APT_BASE.csv", nasr / "APT_RWY.csv", nasr / "APT_RWY_END.csv"))}
    # The closed field is not drawn as a field.
    assert set(found) == {"ORD", "06C", "LL22", "7IL4"}
    assert found["ORD"]["properties"] == {
        "ident": "KORD", "faa_id": "ORD", "name": "CHICAGO O'HARE INTL", "type": "airport", "use": "public",
        "towered": True, "elevation_ft": 680.0, "longest_ft": 13000, "hard_ft": 13000, "runway_true": 90,
        "fuel": "100LL,A", "rank": 0,
    }
    assert found["ORD"]["geometry"] == {"type": "Point", "coordinates": [-87.90814972, 41.97694027]}
    assert found["06C"]["properties"]["rank"] == 1 and "runway_true" not in found["06C"]["properties"]
    # 2,813 ft of asphalt and 1,940 ft of turf: hard, but under 3,000 ft.
    assert {k: found["LL22"]["properties"][k] for k in ("use", "longest_ft", "hard_ft", "rank")} == {
        "use": "private", "longest_ft": 2813, "hard_ft": 2813, "rank": 3}
    # A helipad is no runway.
    assert found["7IL4"]["properties"]["type"] == "heliport" and "longest_ft" not in found["7IL4"]["properties"]
    assert {k: f["tippecanoe"]["minzoom"] for k, f in found.items()} == {"ORD": 5, "06C": 6, "LL22": 9, "7IL4": 10}


@pytest.mark.parametrize(("surface", "hard"), [
    ("ASPH", True), ("CONC", True), ("ASPH-CONC", True), ("ASPH-TRTD", True), ("PEM", True),
    ("ASPH-TURF", False), ("TURF", False), ("GRVL", False), ("TRTD", False), ("WATER", False), ("", False),
])
def test_a_hard_surface_is_one_paved_all_through(surface, hard):
    assert vector_tiles._hard(surface) is hard


def test_the_navaids_and_every_fix(sources):
    _, nasr = sources
    navaids = {f["properties"]["ident"]: f for f in _lines(vector_tiles.navaid_features(nasr / "NAV_BASE.csv"))}
    assert navaids["DPA"]["properties"] == {
        "ident": "DPA", "name": "Dupage", "kind": "VOR/DME", "freq": "114.55", "channel": "92Y", "service_volume": "VL",
        "mag_var": 2.0, "elevation_ft": 801.6, "hours": "24", "restricted": True,
    }
    assert navaids["DPA"]["tippecanoe"] == {"minzoom": 5}
    fixes = {f["properties"]["ident"]: f for f in _lines(vector_tiles.fix_features(nasr / "FIX_BASE.csv"))}
    assert fixes["VPAON"]["properties"] == {"ident": "VPAON", "kind": "VFR waypoint", "vfr": True, "enroute_low": False}
    assert fixes["VPDVA"]["properties"]["kind"] == "Helicopter route waypoint"
    assert {k: f["tippecanoe"]["minzoom"] for k, f in fixes.items()} == {"VPAON": 8, "VPDVA": 10, "ACCRA": 8, "EVRSN": 10}


def test_a_box_keeps_only_what_meets_it(sources):
    _, nasr = sources
    north_of_ohare = (-88.2, 42.0, -87.8, 42.3)
    assert [json.loads(f)["properties"]["faa_id"] for f in vector_tiles.airport_features(
        nasr / "APT_BASE.csv", None, None, north_of_ohare)] == ["7IL4"]


# --- The archive, with tippecanoe ------------------------------------------------


@pytest.fixture(scope="module")
def built(sources, tmp_path_factory):
    pack, nasr = sources
    out = tmp_path_factory.mktemp("tiles")
    index = vector_tiles.build(pack, nasr, out, bbox=BBOX)
    return index, out / f"{index['name']}.pmtiles"


def _tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2 ** z
    return (int((lon + 180) / 360 * n),
            int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n))


def _tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    n = 2 ** z

    def lat(row):
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * row / n))))
    return x / n * 360 - 180, lat(y + 1), (x + 1) / n * 360 - 180, lat(y)


def _decode(path: Path, z: int, x: int, y: int) -> dict[str, list[dict]]:
    """Each layer's features in one tile, as tippecanoe-decode gives them (lon, lat)."""
    run = subprocess.run(["tippecanoe-decode", str(path), str(z), str(x), str(y)], capture_output=True, text=True)
    if run.returncode != 0 or not run.stdout.strip():
        return {}
    return {layer["properties"]["layer"]: layer["features"] for layer in json.loads(run.stdout)["features"]}


@NEEDS_TIPPECANOE
def test_the_archive_is_pmtiles_of_vector_tiles_with_its_layers_and_fields(built, sources):
    index, path = built
    data = path.read_bytes()
    assert data[:8] == b"PMTiles\x03"
    meta_at, meta_len = struct.unpack_from("<QQ", data, 24)
    internal, tile_compression, tile_type, min_zoom, max_zoom = struct.unpack_from("<BBBBB", data, 97)
    assert (tile_type, min_zoom, max_zoom) == (1, 4, 12)  # 1: Mapbox vector tiles
    raw = data[meta_at:meta_at + meta_len]
    meta = json.loads(gzip.decompress(raw) if internal == 2 else raw)
    layers = {layer["id"]: layer for layer in meta["vector_layers"]}
    assert set(layers) == set(vector_tiles.LAYERS)
    assert {"class", "local_type", "floor_ft", "floor_ref", "ceiling_ft", "name", "ident"} <= set(layers["airspace"]["fields"])
    assert {"type", "name", "floor_ft", "ceiling_ft", "times_of_use"} <= set(layers["special_use"]["fields"])
    assert {"ident", "name", "towered", "hard_ft", "longest_ft", "use", "rank"} <= set(layers["airports"]["fields"])
    assert {"ident", "kind", "freq"} <= set(layers["navaids"]["fields"])
    assert {"ident", "kind", "vfr", "enroute_low"} <= set(layers["fixes"]["fields"])
    assert "FAA" in meta["attribution"]
    assert index["bytes"] == len(data) and index["tolerance_m"] == vector_tiles.TOLERANCE_M
    # Every feature that meets the box, and nothing else.
    pack, nasr = sources
    assert {layer["name"]: layer["features"] for layer in index["layers"]} == {
        "airspace": len(list(vector_tiles.airspace_features(pack, BBOX))), "special_use": 1, "airports": 4,
        "navaids": 2, "fixes": 4}


@NEEDS_TIPPECANOE
def test_each_feature_starts_at_its_zoom(built, sources):
    _, path = built
    pack, _ = sources

    def at(z: int, layer: str, key: str, lon: float, lat: float) -> set:
        return {f["properties"].get(key) for f in _decode(path, z, *_tile(lon, lat, z)).get(layer, [])}

    def anywhere(z: int) -> set:
        """Each airspace's LOCAL_TYPE in any tile of the cut at zoom z."""
        (x0, y0), (x1, y1) = _tile(BBOX[0], BBOX[3], z), _tile(BBOX[2], BBOX[1], z)
        return {f["properties"]["local_type"] for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)
                for f in _decode(path, z, x, y).get("airspace", [])}

    starts = {}
    for line in vector_tiles.airspace_features(pack, BBOX):
        f = json.loads(line)
        starts[f["properties"]["local_type"]] = f["tippecanoe"]["minzoom"]
    assert set(starts) >= {"CLASS_B", "CLASS_D", "CLASS_E2", "CLASS_E5"}
    for local_type, z in starts.items():
        assert local_type not in anywhere(z - 1) and local_type in anywhere(z), local_type

    def first(layer: str, ident: str, key: str, lon: float, lat: float, z: int) -> None:
        assert ident not in at(z - 1, layer, key, lon, lat) and ident in at(z, layer, key, lon, lat), ident

    first("airports", "ORD", "faa_id", -87.90814972, 41.97694027, 5)
    first("airports", "06C", "faa_id", -88.10124277, 41.98934083, 6)
    first("airports", "LL22", "faa_id", -87.99941666, 41.73277777, 9)
    first("airports", "7IL4", "faa_id", -87.99348888, 42.06774722, 10)
    first("navaids", "DPA", "ident", -88.35017747, 41.89037147, 5)
    first("fixes", "VPAON", "ident", -87.86358888, 42.07806388, 8)
    first("fixes", "ACCRA", "ident", -88.01944444, 41.93333333, 8)
    first("fixes", "EVRSN", "ident", -87.95461666, 41.94477222, 10)
    # Drawn still at the deepest zoom.
    assert "ORD" in at(12, "airports", "faa_id", -87.90814972, 41.97694027)
    # The restricted area's hole is a hole in the tiles too.
    [area] = _decode(path, 12, *_tile(-88.2, 41.6, 12)).get("special_use", [])
    assert not shapely.from_geojson(json.dumps(area["geometry"])).contains(shapely.Point(-88.2, 41.6))


def _metres(lon_lat, lat0: float):
    """(lon, lat) to metres east and north of the meridian and equator,
    near lat0: plenty for a few metres' distances."""
    return shapely.transform(lon_lat, lambda c: c * [111_320 * math.cos(math.radians(lat0)), 110_574])


@NEEDS_TIPPECANOE
def test_the_class_b_is_drawn_within_tolerance_of_the_faas_line(built, sources):
    """Every point of every Chicago Class B shelf in every zoom-12 tile it
    crosses is within TOLERANCE_M of the FAA's line, and every point of
    the FAA's line in those tiles within it of the drawn one."""
    _, path = built
    pack, _ = sources
    lat0 = 42.0
    shelves: dict[float, list] = {}
    for a, g in zip(pack.attrs("airspace"), pack.geometries("airspace")):
        if a["CLASS"] == "B":
            shelves.setdefault(float(a["LOWER_VAL"]), []).append(g)
    faa = {floor: _metres(shapely.union_all([g.boundary for g in gs]), lat0) for floor, gs in shelves.items()}
    west, south, east, north = shapely.MultiPolygon([p for gs in shelves.values() for g in gs for p in getattr(g, "geoms", [g])]).bounds
    (x0, y0), (x1, y1) = _tile(west, north, 12), _tile(east, south, 12)
    worst, compared = 0.0, 0
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            box = shapely.box(*_tile_bounds(12, x, y))
            # A little inside the tile, past where tippecanoe's clip draws
            # its own edge along the tile's buffer.
            inner = _metres(box, lat0).buffer(-1.0)
            drawn: dict[float, list] = {}
            for f in _decode(path, 12, x, y).get("airspace", []):
                if f["properties"]["class"] == "B":
                    drawn.setdefault(f["properties"]["floor_ft"], []).append(shapely.from_geojson(json.dumps(f["geometry"])))
            for floor, line in faa.items():
                mine = _metres(shapely.union_all([g.boundary for g in drawn.get(floor, [])]), lat0)
                theirs = line.intersection(inner)
                for points, other in ((shapely.get_coordinates(mine.intersection(inner)), line),
                                      (shapely.get_coordinates(theirs.segmentize(5.0)), mine)):
                    if len(points):
                        assert not other.is_empty
                        d = shapely.distance(shapely.points(points), other)
                        worst, compared = max(worst, float(d.max())), compared + len(points)
    print(f"Class B worst {worst:.2f} m over {compared} points, tolerance {vector_tiles.TOLERANCE_M} m")
    assert compared > 1000
    assert worst <= vector_tiles.TOLERANCE_M
