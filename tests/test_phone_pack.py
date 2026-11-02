"""The phones' cycle packs (vfr.pack's write_phone) and the engine's answer
from them with no network (wingtip-engine's phone and rules modules,
through vfr_native), held to the planner's own code: vfr.airspace_at's
volumes, column and Mode C veil on the NASR shapefile itself, and
vfr.sua's areas.

- At Chicago's real taps the answer is the planner's, band for band.
- At random points round Chicago it is too, but where a point is within
  PHONE_WORST_NM of a line the FAA draws, which the simplified rings may
  put on the other side.
- The packs committed for the iOS app's tests (tests/fixtures/native/phone)
  answer as the planner does, so its tests, which read them through the
  engine's C functions, hold Swift to the planner's code too.

The Chicago cut and its taps are tests/test_native.py's."""
import gzip
import json
import math
import shutil
import struct
from pathlib import Path

import numpy as np
import pytest
import shapely
from shapely.geometry import Point, Polygon

import vfr_native
from vfr import airspace_at, geo, sua
from vfr import pack as cycle_pack

FIXTURES = Path(__file__).parent / "fixtures" / "native"
PHONE = FIXTURES / "phone"
#: O'Hare, the Mode C veil airport round the Chicago taps (14 CFR part 91
#: appendix D section 1), where NASR's APT_BASE puts its reference point.
VEIL = [{"ident": "KORD", "name": "CHICAGO O'HARE INTL", "lat": 41.9769403, "lon": -87.9081497}]


@pytest.fixture(scope="module")
def chicago(tmp_path_factory) -> Path:
    where = tmp_path_factory.mktemp("airspace") / "chicago_airspace.shp"
    for part in ("shp", "dbf"):
        where.with_suffix(f".{part}").write_bytes(gzip.decompress((FIXTURES / f"chicago_airspace.{part}.gz").read_bytes()))
    shutil.copy(FIXTURES / "chicago_airspace.shx", where.with_suffix(".shx"))
    return where


def _restricted_area():
    """A restricted area as the FAA's feature service gives one: GeoJSON's
    counter-clockwise outer ring, a clockwise hole."""
    outer = [(-88.3, 41.5), (-88.1, 41.5), (-88.1, 41.7), (-88.3, 41.7), (-88.3, 41.5)]
    hole = [(-88.22, 41.58), (-88.22, 41.62), (-88.18, 41.62), (-88.18, 41.58), (-88.22, 41.58)]
    geometry = Polygon(outer, [hole])
    props = {"NAME": "R-9999 TEST", "TYPE_CODE": "R", "LOWER_VAL": "0", "LOWER_UOM": "FT", "LOWER_CODE": "SFC",
             "UPPER_VAL": "5000", "UPPER_UOM": "FT", "UPPER_CODE": "MSL", "TIMESOFUSE": "0700-2200 MON-FRI",
             "GMTOFFSET": "-6", "DST_CODE": "1", "CONT_AGENT": "CHICAGO TRACON"}
    return {"properties": props}, geometry, geometry.bounds


AREA = [_restricted_area()]


@pytest.fixture()
def phone(chicago, tmp_path):
    """The planner's pack of the Chicago cut and a restricted area, and the
    phones' packs of it."""
    server = cycle_pack.write(tmp_path, "2026-10-29", shp_path=chicago, sua_held=AREA, sua_at=0.0,
                              urban=[], urban_path=None, tables={})
    index = cycle_pack.write_phone(cycle_pack.Pack(server), tmp_path / "phone", VEIL)
    return tmp_path / "phone" / "2026-10-29", index


def _pack_at(folder: Path, lat: float, lon: float):
    path = folder / f"{vfr_native.region_of(lat, lon)}.pack"
    return cycle_pack.Pack(path).mapped if path.exists() else None


def _engine(folder: Path, lat: float, lon: float, ground_ft=None) -> dict:
    return json.loads(vfr_native.airspace_at_json(_pack_at(folder, lat, lon), lat, lon, ground_ft))


def _planner(chicago: Path, lat: float, lon: float, ground_ft=None, areas=()) -> dict:
    """What /api/airspace/at answers from the same files, but for what a
    pack does not hold: vfr.airspace_at's own code on the shapefile."""
    volumes = airspace_at.volumes_at(lat, lon, chicago)
    veil = airspace_at.mode_c_veil(lat, lon, VEIL)
    found = {}
    for feature, geometry, _ in areas:
        if geometry.contains(Point(lon, lat)):
            area = sua._area(feature["properties"])
            found.setdefault(area["name"], area)
    return {
        "lat": lat, "lon": lon, "ground_ft": ground_ft,
        "bands": airspace_at.column(lat, lon, ground_ft or 0.0, volumes, in_veil=veil is not None),
        "mode_c_veil": veil,
        "special_use": sorted(found.values(), key=lambda a: (a["floor_ft"] is None, a["floor_ft"] or 0)),
        "special_use_unavailable": False, "tfrs": [], "tfrs_unavailable": True, "point": None,
    }


def test_the_regions_are_named_alike_in_python_and_rust():
    rng = np.random.default_rng(7)
    points = [(0.0, 0.0), (-4.0, -4.0), (41.99999, -88.0), (44.0, -96.0), (-0.0001, 179.9999), (71.3, -156.8)]
    points += list(zip(rng.uniform(-89, 89, 2000), rng.uniform(-180, 180, 2000)))
    for lat, lon in points:
        name = cycle_pack.region_of(lat, lon)
        assert vfr_native.region_of(lat, lon) == name, (lat, lon)
        west, south, east, north = cycle_pack.region_bounds(name)
        assert south <= lat < north and west <= lon < east, (lat, lon, name)


def test_the_engines_distance_is_vfr_geos():
    rng = np.random.default_rng(11)
    for lat, lon in zip(rng.uniform(20, 65, 500), rng.uniform(-160, -65, 500)):
        lat2, lon2 = lat + rng.uniform(-3, 3), lon + rng.uniform(-4, 4)
        assert abs(vfr_native.distance_nm(lat, lon, lat2, lon2) - geo.distance_nm(lat, lon, lat2, lon2)) < 1e-9


def test_the_real_taps_answer_as_the_planner_at_any_ground(chicago, phone):
    folder, _ = phone
    taps = json.loads((FIXTURES / "chicago_airspace.json").read_text())
    for name, tap in taps.items():
        lat, lon = tap["at"]
        for ground in (None, 0.0, 650.0, 4200.0, 13800.0):
            assert _engine(folder, lat, lon, ground) == _planner(chicago, lat, lon, ground, AREA), (name, ground)


def test_random_points_answer_as_the_planner_but_on_a_line(chicago, phone):
    """Points over the whole cut, at three grounds: every answer the
    planner's, but where the point is within PHONE_WORST_NM of a volume's
    line (the rings simplified to PHONE_TOLERANCE_DEG)."""
    folder, _ = phone
    server = cycle_pack.Pack(next(folder.parent.parent.glob("wingtip-*.pack")))
    boxes = server.boxes("airspace")
    lines = shapely.MultiLineString([ring for shape in server.wkb("airspace") for rings in cycle_pack._rings(shape)
                                     for ring in rings if len(ring) >= 2])
    rng = np.random.default_rng(13)
    w, s = boxes[:, 0].min(), boxes[:, 1].min()
    e, n = boxes[:, 2].max(), boxes[:, 3].max()
    asked = differing = 0
    for lat, lon in zip(rng.uniform(s, n, 1500), rng.uniform(w, e, 1500)):
        for ground in (None, 700.0, 9000.0):
            asked += 1
            if _engine(folder, lat, lon, ground) != _planner(chicago, lat, lon, ground, AREA):
                differing += 1
                ends = shapely.get_coordinates(shapely.shortest_line(lines, Point(lon, lat)))
                off_nm = math.hypot((ends[1][0] - ends[0][0]) * 60 * math.cos(math.radians(lat)),
                                    (ends[1][1] - ends[0][1]) * 60)
                assert off_nm <= cycle_pack.PHONE_WORST_NM, (lat, lon, ground, off_nm)
    assert asked == 4500 and differing <= 10


def test_a_special_use_area_is_the_planners_and_its_hole_is_not_held(chicago, phone):
    folder, _ = phone
    inside, hole, outside = (41.52, -88.28), (41.60, -88.20), (41.80, -88.20)
    for lat, lon in (inside, hole, outside):
        assert _engine(folder, lat, lon) == _planner(chicago, lat, lon, areas=AREA), (lat, lon)
    assert [a["name"] for a in _engine(folder, *inside)["special_use"]] == ["R-9999 TEST"]
    assert _engine(folder, *hole)["special_use"] == []


def test_a_region_with_no_pack_has_the_rules_alone():
    """Nothing drawn: Class G to 14,500 ft, E above it, A from 18,000 ft
    (vfr.airspace_at's column with no volumes)."""
    for ground in (None, 3000.0):
        answer = json.loads(vfr_native.airspace_at_json(None, 30.0, -140.0, ground))
        assert answer["bands"] == airspace_at.column(30.0, -140.0, ground or 0.0, [], in_veil=False)
        assert answer["mode_c_veil"] is None and answer["special_use"] == [] and answer["tfrs_unavailable"]


def test_the_index_and_the_packs_are_as_written(phone, monkeypatch):
    folder, index = phone
    assert index["cycle"] == "2026-10-29" and index["tolerance_deg"] == cycle_pack.PHONE_TOLERANCE_DEG
    assert {r["name"] for r in index["regions"]} == {p.stem for p in folder.glob("*.pack")}
    for region in index["regions"]:
        pack = cycle_pack.Pack(folder / f"{region['name']}.pack")
        assert pack.verify() and pack.crc32 == region["crc32"]
        assert pack.meta["flavour"] == "phone" and pack.meta["region"] == region["name"]
    monkeypatch.setattr(cycle_pack, "PACK_DIR", folder.parent.parent)
    assert cycle_pack.phone_index() == index
    name = index["regions"][0]["name"]
    assert cycle_pack.phone_pack_path("2026-10-29", name) == folder / f"{name}.pack"
    assert cycle_pack.phone_pack_path("2026-10-29", "../../etc") is None
    assert cycle_pack.phone_pack_path("latest", name) is None


def test_the_ios_apps_fixture_packs_answer_as_the_planner(chicago):
    """tests/fixtures/native/phone: the Chicago cut's phone packs and the
    planner's answer at each tap, which the iOS app's tests ask the engine
    for through its C functions (CyclePackTests)."""
    expected = json.loads((PHONE / "chicago_airspace_at.json").read_text())
    taps = json.loads((FIXTURES / "chicago_airspace.json").read_text())
    assert set(expected) == set(taps)
    for name, tap in taps.items():
        lat, lon = tap["at"]
        assert _engine(PHONE, lat, lon) == expected[name] == _planner(chicago, lat, lon), name


# --- The alerts ahead with no network (wingtip_engine::ahead) -------------

def _ground_pack(tmp_path, monkeypatch, heights) -> bytes:
    """A region's pack holding only its ground, written by vfr.pack's own
    `_terrain` from a ground grid of two cells a degree over n40w088
    (`heights`, 8 by 8 feet, row 0 the south), and a special-use area."""
    from vfr import ground_grid

    grid = np.asarray(heights, dtype="<i2")
    monkeypatch.setattr(ground_grid, "SOUTH", 40.0)
    monkeypatch.setattr(ground_grid, "NORTH", 44.0)
    monkeypatch.setattr(ground_grid, "WEST", -88.0)
    monkeypatch.setattr(ground_grid, "EAST", -84.0)
    monkeypatch.setattr(ground_grid, "PER_DEG", 2)
    monkeypatch.setattr(ground_grid, "_grids", lambda: (grid, grid))
    ground = cycle_pack._terrain("n40w088")
    area = Polygon([(-87.0, 42.4), (-87.0, 42.6), (-86.6, 42.6), (-86.6, 42.4)])
    wkb = shapely.to_wkb(shapely.geometry.polygon.orient(area, sign=-1.0), byte_order=1)
    record = {"name": "R-9999", "type": "R", "floor_ft": None, "floor_ref": "SFC", "ceiling_ft": 18000.0,
              "ceiling_ref": "MSL", "times_of_use": "0800-1700 MON-FRI"}
    path = tmp_path / "n40w088.pack"
    with open(path, "w+b") as f:
        w = cycle_pack._Writer(f, ["meta", "sua.box", "sua.off", "sua.wkb", "sua.rec", "sua.json", "sua.names",
                                   "sua.alt", "sua.times", "terrain"])
        w.put("meta", b"{}")
        cycle_pack._layer(w, "sua", [area.bounds], [wkb], None)
        w.put("sua.rec", struct.pack("<dIIII", float("nan"), 0, 0, 0, 6))
        w.put("sua.json", b"")
        w.put("sua.names", b"R-9999")
        alt, times = cycle_pack._sua_alt([record])
        w.put("sua.alt", alt)
        w.put("sua.times", times)
        w.put("terrain", ground)
        w.finish("2026-11-02", 0.0)
    return path.read_bytes()


def test_the_ground_is_pooled_by_its_highest_and_a_misread_cell_is_none(tmp_path, monkeypatch):
    heights = np.full((8, 8), 1000)
    heights[0, 1] = 1500                 # pooled with three 1,000s: the cell is 1,500
    heights[4:6, 4:6] = 32000            # tiles misread: no ground known
    heights[6, 6] = 32000                # one misread among three read: theirs
    pack = _ground_pack(tmp_path, monkeypatch, heights)
    raw = cycle_pack._terrain("n40w088")
    south, west, per, rows, cols, _ = struct.unpack("<ddIIII", raw[:32])
    cells = np.frombuffer(raw[32:], dtype="<i2").reshape(rows, cols)
    assert (south, west, per, rows, cols) == (40.0, -88.0, 1, 4, 4)
    assert cells[0, 0] == 1500 and cells[2, 2] == np.iinfo(np.int16).min and cells[3, 3] == 1000
    # Over the 1,500 ft cell at 1,700 ft: the grid's margin makes it 1,650,
    # 50 ft under the airplane, a warning; well over it, nothing.
    low = json.loads(vfr_native.ahead_json([pack], 40.2, -87.7, 90.0, 100.0, 1700.0, 0.0, 0))
    terrain = [a for a in low["alerts"] if a["kind"] == "terrain"]
    assert terrain and terrain[0]["level"] == "warning" and terrain[0]["top_ft"] == 1650.0
    assert "obstacles" in low["unavailable"] and "TFRs" in low["unavailable"]
    high = json.loads(vfr_native.ahead_json([pack], 40.2, -87.7, 90.0, 100.0, 4000.0, 0.0, 0))
    assert not [a for a in high["alerts"] if a["kind"] == "terrain"]
    # Over the misread cell the ground is not known: said, not alerted.
    unknown = json.loads(vfr_native.ahead_json([pack], 42.2, -85.5, 0.0, 100.0, 3000.0, 0.0, 0))
    assert "terrain" in unknown["unavailable"]


def test_a_restricted_area_and_a_tfr_ahead(tmp_path, monkeypatch):
    pack = _ground_pack(tmp_path, monkeypatch, np.full((8, 8), 600))
    # Eastbound at 120 kt, two minutes from the area: 4 nm.
    lat, lon = 42.5, -87.0 - 4.0 / (60.0 * math.cos(math.radians(42.5)))
    ring = "-86.95 42.45,-86.9 42.45,-86.9 42.55,-86.95 42.55,-86.95 42.45"
    tfr = f"6/1234\tA stadium\tspecial security instructions (99.7)\t0\tAGL\t3000\tAGL\t\t\t{ring}"
    found = json.loads(vfr_native.ahead_json([pack], lat, lon, 90.0, 120.0, 3500.0, 0.0, 1_793_628_000, tfr, 1_793_620_000))
    by_id = {a["id"]: a for a in found["alerts"]}
    restricted = by_id["special_use:R-9999"]
    assert (restricted["level"], restricted["class"], restricted["times_of_use"]) == ("caution", "R", "0800-1700 MON-FRI")
    assert 115 <= restricted["seconds"] <= 125
    stadium = by_id["tfr:6/1234"]
    # 3,000 ft over ground of 750 (600 and the margin): to 3,750, and the airplane at 3,500.
    assert (stadium["level"], stadium["ceiling_ft"]) == ("warning", 3750.0)
    assert stadium["need"].endswith("(special security instructions (99.7)).")
    assert found["tfrs_as_of"] == 1_793_620_000
