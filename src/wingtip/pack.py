"""The cycle pack: one file per FAA cycle holding what wingtip-engine
(native/engine) reads, so the planner and, later, the phones answer from
the same bytes. Its format is set out in native/engine/src/pack.rs; this
module writes it and reads it in place.

What it holds:

- `airspace`: every Class B, C, D and E volume of the NASR Class Airspace
  shapefile, its rings as the file draws them (as WKB, in the file's
  order and direction) with its box and fields: wingtip.airspace_at's volumes;
- `sua`: the special-use areas as the FAA's feature service gave them
  (wingtip.sua), with when;
- `urban`: the Census urban areas' outlines (wingtip.congested);
- `airports`, `navaids`, `fixes`: the NASR rows a phone needs to find a
  place offline, as CSV columns and rows in JSON;
- `meta`: the cycle, and each source's size and time, so a reader can
  tell the pack still matches the files the planner holds.

The planner builds the pack after its warm-up when the one on disk is
not of the files it has (`ensure`), and its readers turn to it only where
it matches them (`current`), so an answer is the same with or without it.
It lives in data/raw/packs, beside the files it is made from, and is not
committed.

The phones carry packs of their own (`write_phone`): the same format, one
region of REGION_DEG degrees a pack, the rings simplified to
PHONE_TOLERANCE_DEG, with what wingtip-engine's `phone` module reads to
answer the airspace at a point with no network (its sections are set out
there) and what its `view` module reads to draw the map's airspace,
airports and VORs in view as the planner's endpoints answer them. They
are built beside the planner's (`ensure_phone`), in
data/raw/packs/phone/<cycle>, with an index the phone asks for first.
"""
from __future__ import annotations

import csv
import json
import logging
import mmap
import struct
import threading
import time
import zlib
from pathlib import Path

import numpy as np

from .once import once

log = logging.getLogger(__name__)

PACK_DIR = Path(__file__).resolve().parents[2] / "data" / "raw" / "packs"
MAGIC = b"WTPK"
VERSION = 1
HEADER = 64
ENTRY = 32
#: The NASR rows a phone needs to name and find a place, and to draw the
#: map's airports and VORs offline (wingtip-engine's `view`), kept as the
#: FAA writes them (NASR's CSV subscription files, each with its
#: EFF_DATE). OWNERSHIP_TYPE_CODE is the armed services' fields
#: (wingtip.faa_data.military_fields); ALT_CODE and OPER_HOURS a VOR's
#: service volume and hours (wingtip.fixes). A column added here is read by
#: name, so an older pack without it answers that field as unknown.
COLUMNS = {
    "airports": ("APT_BASE.csv", ("ARPT_ID", "ICAO_ID", "SITE_TYPE_CODE", "ARPT_NAME", "CITY", "STATE_CODE",
                                  "LAT_DECIMAL", "LONG_DECIMAL", "ELEV", "MAG_VARN", "MAG_HEMIS", "TPA",
                                  "FACILITY_USE_CODE", "ARPT_STATUS", "TWR_TYPE_CODE", "FUEL_TYPES", "CHART_NAME",
                                  "OWNERSHIP_TYPE_CODE")),
    "navaids": ("NAV_BASE.csv", ("NAV_ID", "NAV_TYPE", "NAME", "CITY", "STATE_CODE", "NAV_STATUS",
                                 "LAT_DECIMAL", "LONG_DECIMAL", "ELEV", "MAG_VARN", "MAG_VARN_HEMIS", "FREQ", "CHAN",
                                 "ALT_CODE", "OPER_HOURS")),
    "fixes": ("FIX_BASE.csv", ("FIX_ID", "ICAO_REGION_CODE", "STATE_CODE", "LAT_DECIMAL", "LONG_DECIMAL",
                               "FIX_USE_CODE", "CHARTS")),
}

#: How far the phones' rings may stray from the FAA's, in degrees: each
#: ring is simplified by Douglas and Peucker's method (shapely's simplify),
#: which keeps every point of the simplified ring within this of the
#: file's and every point of the file's within this of it. A degree of
#: latitude is at most 60.4 nm (NIMA TR8350.2's ellipsoid), so an answer
#: can differ from the planner's only within 0.006 nm (37 ft) of the line
#: the FAA draws -- under a tenth of the width of the line a sectional
#: prints at 1:500,000. The NASR file draws its arcs a point every few
#: feet: 199 MB of airspace becomes 11.6 MB (measured 2026-11-02).
PHONE_TOLERANCE_DEG = 0.0001
PHONE_WORST_NM = round(PHONE_TOLERANCE_DEG * 60.4, 4)
#: A phone pack's region: a square of this many degrees, named by its
#: south-west corner ("n44w096"), so a phone keeps the packs its routes
#: cross as it keeps their chart.
REGION_DEG = 4

_BUILD_LOCK = threading.Lock()


def source_key(path) -> list:
    """A source file as the pack records it: its size and time."""
    stat = Path(path).stat()
    return [stat.st_size, stat.st_mtime]


def cycle_of(cache_dir) -> str | None:
    """The NASR edition's effective date, "YYYY-MM-DD", from the airport
    file's own EFF_DATE."""
    from .faa_data import _effective_date

    date = _effective_date(Path(cache_dir) / "APT_BASE.csv")
    return date.replace("/", "-") if date else None


# --- Reading ------------------------------------------------------------------


class Pack:
    """A pack mapped read-only: its header, its meta and its sections."""

    def __init__(self, path: Path):
        self.path = path
        with open(path, "rb") as f:
            self.mapped = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
        head = self.mapped[:HEADER]
        if head[:4] != MAGIC or struct.unpack_from("<I", head, 4)[0] != VERSION:
            raise ValueError(f"{path} is not a version {VERSION} cycle pack")
        self.cycle = head[8:24].rstrip(b"\0").decode()
        self.built_at, count, self.crc32 = struct.unpack_from("<dII", head, 24)
        self.sections = {}
        for k in range(count):
            name, offset, length = struct.unpack_from("<16sQQ", self.mapped, HEADER + ENTRY * k)
            self.sections[name.rstrip(b"\0").decode()] = (offset, length)
        self.meta = json.loads(bytes(self.section("meta")))

    def section(self, name: str) -> memoryview:
        offset, length = self.sections[name]
        return memoryview(self.mapped)[offset:offset + length]

    def verify(self) -> bool:
        """Every byte after the header as it was written."""
        return zlib.crc32(memoryview(self.mapped)[HEADER:]) == self.crc32

    def boxes(self, layer: str) -> np.ndarray:
        """Each shape's (min lon, min lat, max lon, max lat), in place."""
        return np.frombuffer(self.section(f"{layer}.box"), dtype="<f8").reshape(-1, 4)

    def attrs(self, layer: str) -> list:
        return json.loads(bytes(self.section(f"{layer}.attr")))

    def offsets(self, layer: str) -> np.ndarray:
        """Where each of a layer's shapes starts in its WKB, and the end."""
        return np.frombuffer(self.section(f"{layer}.off"), dtype="<u8")

    def wkb(self, layer: str) -> list[bytes]:
        offsets = np.frombuffer(self.section(f"{layer}.off"), dtype="<u8")
        data = self.section(f"{layer}.wkb")
        return [bytes(data[int(a):int(b)]) for a, b in zip(offsets[:-1], offsets[1:])]

    def geometries(self, layer: str) -> list:
        import shapely

        return list(shapely.from_wkb(self.wkb(layer)))

    def table(self, name: str) -> dict:
        """{"columns", "rows"} of a NASR table."""
        return json.loads(bytes(self.section(name)))


@once(maxsize=2)
def _open(path: str, _mtime: float) -> Pack:
    return Pack(Path(path))


@once(maxsize=4)
def _newest(pack_dir: str, _mtime: float) -> Pack | None:
    found = sorted(Path(pack_dir).glob("wingtip-*.pack"))
    if not found:
        return None
    try:
        return _open(str(found[-1]), found[-1].stat().st_mtime)
    except (OSError, ValueError, KeyError) as err:
        log.warning("Cycle pack %s not read: %s", found[-1], err)
        return None


def current(pack_dir=None) -> Pack | None:
    """The newest pack on disk, mapped; None where there is none, or it
    cannot be read. A reader still checks it matches its own files
    (`matches`). Looked for again only when the folder changes, as a pack
    is put in place whole: a tap asks for it each time."""
    folder = Path(pack_dir or PACK_DIR)
    try:
        mtime = folder.stat().st_mtime
    except OSError:
        return None
    return _newest(str(folder), mtime)


def matches(pack: Pack | None, source: str, path) -> bool:
    """Whether the pack was made from this very file, by size and time."""
    if pack is None:
        return False
    try:
        return pack.meta["sources"].get(source) == source_key(path)
    except (OSError, KeyError, AttributeError):
        return False


# --- Writing ------------------------------------------------------------------


class _Writer:
    """Sections streamed into the file after a header and a table written
    last, the CRC over all of it but the header."""

    def __init__(self, f, names: list[str]):
        self.f, self.names, self.entries = f, names, {}
        f.write(b"\0" * (HEADER + ENTRY * len(names)))

    def _align(self) -> None:
        pad = -self.f.tell() % 8
        if pad:
            self.f.write(b"\0" * pad)

    def begin(self, name: str) -> int:
        self._align()
        start = self.f.tell()
        self.entries[name] = (start, 0)
        return start

    def end(self, name: str) -> None:
        start = self.entries[name][0]
        self.entries[name] = (start, self.f.tell() - start)

    def put(self, name: str, data: bytes) -> None:
        self.begin(name)
        self.f.write(data)
        self.end(name)

    def finish(self, cycle: str, built_at: float) -> None:
        table = b"".join(struct.pack("<16sQQ", n.encode(), *self.entries[n]) for n in self.names)
        self.f.seek(HEADER)
        self.f.write(table)
        self.f.flush()
        self.f.seek(HEADER)
        crc = 0
        while chunk := self.f.read(1 << 22):
            crc = zlib.crc32(chunk, crc)
        header = MAGIC + struct.pack("<I16sdII", VERSION, cycle.encode(), built_at, len(self.names), crc)
        self.f.seek(0)
        self.f.write(header.ljust(HEADER, b"\0"))


def _layer(w: _Writer, name: str, boxes, wkbs, attrs: list | None) -> None:
    w.put(f"{name}.box", np.ascontiguousarray(np.asarray(boxes, dtype="<f8").reshape(-1, 4)).tobytes())
    sizes = [len(b) for b in wkbs]
    w.put(f"{name}.off", np.concatenate([[0], np.cumsum(sizes, dtype=np.int64)]).astype("<u8").tobytes())
    w.begin(f"{name}.wkb")
    for b in wkbs:
        w.f.write(b)
    w.end(f"{name}.wkb")
    if attrs is not None:
        w.put(f"{name}.attr", json.dumps(attrs, default=str, separators=(",", ":")).encode())


def _airspace(shp_path: Path):
    """(boxes, WKB, fields) of every Class B to E record, in the file's
    order: the records wingtip.airspace_at holds, each box the record's own."""
    import shapefile
    import wingtip_native

    shx = np.frombuffer(shp_path.with_suffix(".shx").read_bytes(), dtype=">i4", offset=100).reshape(-1, 2)
    starts, lengths = shx[:, 0].astype(np.int64) * 2 + 8, shx[:, 1].astype(np.int64) * 2
    with open(shp_path, "rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as shp:
        reader = shapefile.Reader(str(shp_path))
        boxes, wkbs, fields = [], [], []
        try:
            for i, record in enumerate(reader.iterRecords()):
                values = record.as_dict()
                if (values.get("CLASS") or "").strip() not in ("B", "C", "D", "E"):
                    continue
                content = shp[int(starts[i]):int(starts[i] + lengths[i])]
                boxes.append(struct.unpack_from("<4d", content, 4))
                wkbs.append(wingtip_native.shape_to_wkb(content))
                fields.append(values)
        finally:
            reader.close()
    return boxes, wkbs, fields


def _table(path: Path, columns: tuple, sizes: dict[str, str] | None = None) -> bytes:
    """The NASR file's rows under `columns`, as JSON; with `sizes`, a
    SIZE column after them: OurAirports' size of each field (large, medium
    or small, as the map draws its pins) by its ICAO or FAA ident, "" for
    a field OurAirports has no landing field by."""
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        rows = [[row.get(c) or "" for c in columns] for row in csv.DictReader(f)]
    names = list(columns)
    if sizes is not None:
        icao, faa = names.index("ICAO_ID"), names.index("ARPT_ID")
        for r in rows:
            r.append(sizes.get(r[icao].strip().upper()) or sizes.get(r[faa].strip().upper()) or "")
        names.append("SIZE")
    return json.dumps({"columns": names, "rows": rows}, separators=(",", ":")).encode()


def airport_sizes() -> dict[str, str]:
    """OurAirports' size of every US landing field (wingtip.airports'
    large, medium and small, which NASR has no column for) by each ident
    it goes by, for the airports table's SIZE: what the phone's map sizes
    a pin by, as the planner's /api/airports/in-view does. Empty where
    OurAirports cannot be had, and every pin is then drawn alike."""
    from . import airports

    try:
        us = airports._us_airports(airports.DEFAULT_CACHE_PATH)
    except Exception:
        log.warning("No OurAirports table for the pack's airport sizes; none written", exc_info=True)
        return {}
    kinds = us["type"].map(airports._FIELD_KINDS)
    found: dict[str, str] = {}
    for column in ("ident", "local_code", "icao_code", "gps_code"):
        if column in us.columns:
            for ident, kind in zip(us[column], kinds):
                if isinstance(kind, str) and isinstance(ident, str) and ident.strip():
                    found.setdefault(ident.strip().upper(), kind)
    return found


def build(cache_dir, pack_dir=None) -> Path:
    """The pack for the files the planner holds now, written whole beside
    them, and any older pack removed."""
    from . import airspace, congested, sua

    cache_dir = Path(cache_dir)
    started = time.monotonic()
    sua_held = sua.everything()
    path = write(Path(pack_dir or PACK_DIR), cycle_of(cache_dir) or time.strftime("%Y-%m-%d", time.gmtime()),
                 shp_path=Path(airspace.ensure_class_airspace_shapefile(cache_dir)),
                 sua_held=sua_held, sua_at=(sua._CACHE.get("all") or (time.time(), None))[0],
                 urban=congested._urban_areas(), urban_path=congested.URBAN_AREAS_PATH,
                 tables={name: (cache_dir / file, columns) for name, (file, columns) in COLUMNS.items()},
                 sizes=airport_sizes())
    log.info("Cycle pack %s built in %.1f s, %.0f MB", path.name, time.monotonic() - started,
             path.stat().st_size / 1e6)
    return path


def write(pack_dir: Path, cycle: str, *, shp_path: Path, sua_held: list, sua_at: float, urban: list,
          urban_path: Path | None, tables: dict, sizes: dict[str, str] | None = None) -> Path:
    """The pack of these sources written to pack_dir, whole or not at all,
    and any other pack there removed. `sizes`, OurAirports' sizes by
    ident (airport_sizes), gives the airports table its SIZE column."""
    import shapely

    sources = {"airspace": source_key(shp_path)}
    if urban_path is not None:
        sources["urban"] = source_key(urban_path)
    meta = {
        "format": VERSION,
        "cycle": cycle,
        "sources": sources,
        "sua_fetched_at": sua_at,
        "airspace": "NASR Class Airspace shapefile, Class B to E, rings as the file draws them",
        "sua": "FAA special use airspace feature service (ADDS)",
        "urban": "Census 2020 urban areas, cartographic boundary 1:500k",
    }
    names = ["meta"]
    for layer, has_attr in (("airspace", True), ("sua", True), ("urban", False)):
        names += [f"{layer}.box", f"{layer}.off", f"{layer}.wkb"] + ([f"{layer}.attr"] if has_attr else [])
    names += list(tables)
    pack_dir.mkdir(parents=True, exist_ok=True)
    path = pack_dir / f"wingtip-{cycle}.pack"
    part = path.with_suffix(".part")
    with _BUILD_LOCK, open(part, "w+b") as f:
        w = _Writer(f, names)
        w.put("meta", json.dumps(meta, separators=(",", ":")).encode())
        _layer(w, "airspace", *_airspace(shp_path))
        _layer(w, "sua", [b for _, _, b in sua_held], list(shapely.to_wkb([g for _, g, _ in sua_held], byte_order=1)),
               [feature.get("properties") for feature, _, _ in sua_held])
        _layer(w, "urban", shapely.bounds(urban) if urban else [], list(shapely.to_wkb(urban, byte_order=1)), None)
        for name, (file, columns) in tables.items():
            w.put(name, _table(file, columns, sizes if name == "airports" else None))
        w.finish(cycle, time.time())
    part.replace(path)
    for old in pack_dir.glob("wingtip-*.pack"):
        if old != path:
            old.unlink(missing_ok=True)
    return path


def ensure(cache_dir, pack_dir=None) -> Path | None:
    """The pack built where the one on disk is not of the files the
    planner holds now: a new NASR cycle, a new airspace file or a new
    urban areas file. None where it already is."""
    from . import airspace, congested

    pack = current(pack_dir)
    shp_path = airspace.ensure_class_airspace_shapefile(cache_dir)
    if (pack is not None and pack.cycle == cycle_of(cache_dir) and matches(pack, "airspace", shp_path)
            and matches(pack, "urban", congested.URBAN_AREAS_PATH)):
        return None
    return build(cache_dir, pack_dir)


# --- The phones' packs ---------------------------------------------------------


def region_of(lat: float, lon: float) -> str:
    """The name of the region holding a point: its south-west corner."""
    south = int(np.floor(lat / REGION_DEG)) * REGION_DEG
    west = int(np.floor(lon / REGION_DEG)) * REGION_DEG
    return f"{'n' if south >= 0 else 's'}{abs(south):02d}{'e' if west >= 0 else 'w'}{abs(west):03d}"


def region_bounds(name: str) -> tuple[float, float, float, float]:
    """(west, south, east, north) of a region by its name."""
    south = int(name[1:3]) * (1 if name[0] == "n" else -1)
    west = int(name[4:7]) * (1 if name[3] == "e" else -1)
    return float(west), float(south), float(west + REGION_DEG), float(south + REGION_DEG)


def _rings(wkb: bytes) -> list[list[np.ndarray]]:
    """A little-endian WKB Polygon's or MultiPolygon's rings, polygon by
    polygon, in their order and direction."""
    def polygon(at: int):
        n = struct.unpack_from("<I", wkb, at + 5)[0]
        at += 9
        rings = []
        for _ in range(n):
            m = struct.unpack_from("<I", wkb, at)[0]
            rings.append(np.frombuffer(wkb, "<f8", 2 * m, at + 4).reshape(-1, 2))
            at += 4 + 16 * m
        return rings, at

    if wkb[0] != 1:
        raise ValueError("a big-endian WKB")
    kind = struct.unpack_from("<I", wkb, 1)[0]
    if kind == 3:
        return [polygon(0)[0]]
    if kind != 6:
        raise ValueError(f"WKB type {kind}, not a polygon")
    polygons, at = [], 9
    for _ in range(struct.unpack_from("<I", wkb, 5)[0]):
        rings, at = polygon(at)
        polygons.append(rings)
    return polygons


def _wkb(polygons: list[list[np.ndarray]]) -> bytes:
    def polygon(rings):
        return struct.pack("<BII", 1, 3, len(rings)) + b"".join(
            struct.pack("<I", len(r)) + np.ascontiguousarray(r, "<f8").tobytes() for r in rings)
    if len(polygons) == 1:
        return polygon(polygons[0])
    return struct.pack("<BII", 1, 6, len(polygons)) + b"".join(polygon(p) for p in polygons)


def simplified(wkb: bytes, tolerance: float = PHONE_TOLERANCE_DEG) -> tuple[bytes, tuple | None]:
    """The shape's rings each simplified (PHONE_TOLERANCE_DEG), in their
    order and direction, and the box of what is left; a ring too small to
    simplify kept as it is. (WKB, None) where no ring has a point."""
    import shapely

    polygons = []
    for rings in _rings(wkb):
        kept = []
        for ring in rings:
            if len(ring) >= 5:
                line = shapely.simplify(shapely.linestrings(ring), tolerance, preserve_topology=False)
                out = shapely.get_coordinates(line)
                ring = out if len(out) >= 4 else ring
            kept.append(ring)
        polygons.append(kept)
    points = [r for rings in polygons for r in rings if len(r)]
    if not points:
        return _wkb(polygons), None
    every = np.concatenate(points)
    return _wkb(polygons), (float(every[:, 0].min()), float(every[:, 1].min()),
                            float(every[:, 0].max()), float(every[:, 1].max()))


def _regions_of(box) -> list[str]:
    """Every region a box (min lon, min lat, max lon, max lat) meets."""
    w, s, e, n = box
    lats = range(int(np.floor(s / REGION_DEG)), int(np.floor(n / REGION_DEG)) + 1)
    lons = range(int(np.floor(w / REGION_DEG)), int(np.floor(e / REGION_DEG)) + 1)
    return [region_of(a * REGION_DEG, o * REGION_DEG) for a in lats for o in lons]


def _strings(texts: list[str]) -> tuple[list[tuple[int, int]], bytes]:
    """Each text's (offset, length) in one UTF-8 run of them all."""
    spans, run = [], bytearray()
    for t in texts:
        b = (t or "").encode()
        spans.append((len(run), len(b)))
        run += b
    return spans, bytes(run)


_FLOOR_REFS = {"SFC": 0, "AGL": 1, "MSL": 2}
#: A special-use area's heights' references in `sua.alt` (0 none given).
_SUA_REFS = {"SFC": 1, "AGL": 2, "MSL": 3}

#: The phones' ground: wingtip.ground_grid's highest ground, a 120th of a
#: degree a cell, pooled to the highest of each POOL by POOL cells -- a
#: 60th of a degree, a nautical mile north to south -- so a region's is
#: 240 by 240 heights (115 KB). Pooling by the highest keeps it never
#: under the grid it is drawn from: over it by 3 ft at the median, 145 ft
#: at the 90th percentile and 755 at the 99th, on the 22 million cells of
#: the lower 48 (2026-11-02).
TERRAIN_POOL = 2


def _terrain(region: str) -> bytes | None:
    """A region's `terrain` section: 32 bytes -- its south and west edges
    (f64), the cells a degree, its rows and columns (u32), four zeros --
    then each cell's highest ground in feet (i16, row 0 the south, the
    grid's NONE where no tile reached), the ground grid's own heights,
    to which a reader adds its RESAMPLED_MARGIN_FT as wingtip.ground_grid
    does. None where the grid is not built or the region is outside it."""
    from . import ground_grid

    grids = ground_grid._grids()
    if grids is None:
        return None
    high = grids[0]
    west, south, east, north = region_bounds(region)
    if south < ground_grid.SOUTH or north > ground_grid.NORTH or west < ground_grid.WEST or east > ground_grid.EAST:
        return None
    per = ground_grid.PER_DEG
    r0, c0 = round((south - ground_grid.SOUTH) * per), round((west - ground_grid.WEST) * per)
    block = np.asarray(high[r0:r0 + REGION_DEG * per, c0:c0 + REGION_DEG * per]).astype(np.int32)
    # A guard, as wingtip.ground_grid now leaves voids and impossible peaks
    # out of its cells: one still above Mount Whitney (a grid built before
    # that, not yet repaired) is no ground known to the phones rather than
    # a 32,000 ft mountain over Florida.
    block[block > ground_grid.HIGHEST_GROUND_FT] = ground_grid.NONE
    rows, cols = block.shape[0] // TERRAIN_POOL, block.shape[1] // TERRAIN_POOL
    tiles = block[:rows * TERRAIN_POOL, :cols * TERRAIN_POOL].reshape(rows, TERRAIN_POOL, cols, TERRAIN_POOL)
    known = tiles != ground_grid.NONE
    pooled = np.where(known, tiles, np.iinfo(np.int32).min).max(axis=(1, 3))
    pooled = np.where(known.any(axis=(1, 3)), pooled, ground_grid.NONE).astype("<i2")
    if (pooled == ground_grid.NONE).all():
        return None
    head = struct.pack("<ddIIII", south, west, per // TERRAIN_POOL, rows, cols, 0)
    return head + pooled.tobytes()


def _sua_alt(areas: list[dict]) -> tuple[bytes, bytes]:
    """`sua.alt`, 32 bytes an area for the alerts ahead (crate::ahead):
    its type (ASCII, NUL-padded to 4: P, R, MOA, W, A), its floor's and
    its ceiling's reference (u8, _SUA_REFS), two zeros, its floor and its
    ceiling in feet (f64, not a number where none is given), and where its
    times of use are in `sua.times` (u32 offset, u32 length)."""
    spans, run = _strings([a.get("times_of_use") or "" for a in areas])
    nan = float("nan")
    rec = b"".join(
        struct.pack("<4sBB2xddII", (a["type"] or "").encode()[:4], _SUA_REFS.get(a["floor_ref"] or "", 0),
                    _SUA_REFS.get(a["ceiling_ref"] or "", 0), nan if a["floor_ft"] is None else float(a["floor_ft"]),
                    nan if a["ceiling_ft"] is None else float(a["ceiling_ft"]), *span)
        for a, span in zip(areas, spans))
    return rec, run


def _controlled_numbers(pack: Pack) -> list[int | None]:
    """Each airspace record's number among the Class B, C and D in the
    national file's order -- what wingtip.airspace_map numbers a volume's
    `id` by, so the phone's map keys a volume as the planner does from
    one box to the next -- and None for a Class E."""
    from . import airspace

    numbers: list[int | None] = []
    for a in pack.attrs("airspace"):
        controlled = (a.get("CLASS") or "").strip() in airspace.CONTROLLED_CLASSES
        numbers.append(sum(n is not None for n in numbers) if controlled else None)
    return numbers


def _volume_drawn(record: dict, number: int | None) -> dict:
    """wingtip.airspace_at's volume, with what the map's volume in view
    (wingtip.airspace_map's AirspaceVolume) says of it besides: its number,
    whether its top is "to but not including" its ceiling (UPPER_DESC
    TNI) and when it is in effect (WKHR_CODE, WKHR_RMK, as wingtip.airspace
    reads them): the phone's `airspace.attr`."""
    from . import airspace, airspace_at

    return {
        **airspace_at._volume(record),
        "number": number,
        "ceiling_excluded": (record.get("UPPER_DESC") or "").strip().upper() == "TNI",
        "hours_code": airspace._text(record.get("WKHR_CODE")),
        "hours_remark": airspace._text(record.get("WKHR_RMK")),
    }


def _phone_shapes(pack: Pack) -> dict:
    """Each layer's shapes for the phones, simplified, with their regions
    and what each region's pack keeps of them."""
    import shapely
    from shapely.geometry.polygon import orient

    from . import sua

    layers = {}
    volumes = [_volume_drawn(a, number) for a, number in zip(pack.attrs("airspace"), _controlled_numbers(pack))]
    shapes = [simplified(w) for w in pack.wkb("airspace")]
    layers["airspace"] = [(w, box, v) for (w, box), v in zip(shapes, volumes)]
    if "sua.attr" in pack.sections:
        # The feature service's polygons, outer rings clockwise and holes
        # counter-clockwise as a shapefile's are: the rule the engine
        # reads rings by (crate::airspace).
        areas = []
        for props, geometry in zip(pack.attrs("sua"), pack.geometries("sua")):
            if geometry.geom_type == "Polygon":
                geometry = orient(geometry, sign=-1.0)
            elif geometry.geom_type == "MultiPolygon":
                geometry = shapely.MultiPolygon([orient(p, sign=-1.0) for p in geometry.geoms])
            else:
                continue
            w, box = simplified(shapely.to_wkb(geometry, byte_order=1))
            areas.append((w, box, sua._area(props or {})))
        layers["sua"] = areas
    if "urban.box" in pack.sections:
        layers["urban"] = [(*simplified(w), None) for w in pack.wkb("urban")]
    return layers


def write_phone(pack: Pack, out_dir: Path, veil: list[dict]) -> dict:
    """The phones' packs of the planner's pack, one a region with
    anything in it, written whole into out_dir/<cycle>, with the index of
    them (what /api/cycle-packs gives); any other cycle's removed."""
    layers = _phone_shapes(pack)
    regions: dict[str, dict[str, list[int]]] = {}
    for name, shapes in layers.items():
        for i, (_, box, _) in enumerate(shapes):
            if box is not None:
                for region in _regions_of(box):
                    regions.setdefault(region, {}).setdefault(name, []).append(i)
    tables = {name: pack.table(name) for name in COLUMNS if name in pack.sections}
    veil_spans, veil_names = _strings([a.get("name") or "" for a in veil])
    veil_pts = b"".join(struct.pack("<dd8sII", a["lat"], a["lon"], a["ident"].encode()[:8], *span)
                        for a, span in zip(veil, veil_spans))
    folder = out_dir / pack.cycle
    part = out_dir / f"{pack.cycle}.part"
    if part.exists():
        for old in part.iterdir():
            old.unlink()
    part.mkdir(parents=True, exist_ok=True)
    index = {"cycle": pack.cycle, "built_at": time.time(), "tolerance_deg": PHONE_TOLERANCE_DEG,
             "worst_nm": PHONE_WORST_NM, "region_deg": REGION_DEG, "terrain_pool": TERRAIN_POOL,
             # The ground grid the terrain was read from: a new one (its voids
             # read as no height, 2026-11-02) builds the phones' packs again.
             "ground_grid": ground_grid_version(), "regions": []}
    for region in sorted(regions):
        west, south, east, north = region_bounds(region)
        held = regions[region]
        names = ["meta"]
        for layer in ("airspace", "sua", "urban"):
            if layer in held:
                names += [f"{layer}.box", f"{layer}.off", f"{layer}.wkb"]
        if "airspace" in held:
            names += ["airspace.vol", "airspace.names", "airspace.attr"]
        if "sua" in held:
            names += ["sua.rec", "sua.json", "sua.names", "sua.alt", "sua.times"]
        ground = _terrain(region)
        if ground is not None:
            names.append("terrain")
        names += ["veil.pts", "veil.names"] + list(tables)
        path = part / f"{region}.pack"
        with open(path, "w+b") as f:
            w = _Writer(f, names)
            w.put("meta", json.dumps({"format": VERSION, "cycle": pack.cycle, "flavour": "phone", "region": region,
                                      "bounds": [west, south, east, north], "tolerance_deg": PHONE_TOLERANCE_DEG,
                                      "worst_nm": PHONE_WORST_NM, "sources": pack.meta.get("sources")},
                                     separators=(",", ":")).encode())
            for layer in ("airspace", "sua", "urban"):
                if layer in held:
                    picked = [layers[layer][i] for i in held[layer]]
                    _layer(w, layer, [box for _, box, _ in picked], [wkb for wkb, _, _ in picked], None)
            if "airspace" in held:
                volumes = [layers["airspace"][i][2] for i in held["airspace"]]
                spans, run = _strings([v["name"] for v in volumes])
                w.put("airspace.vol", b"".join(
                    struct.pack("<BB6xddII", ord((v["class"] or "E")[0]), _FLOOR_REFS[v["floor_ref"]],
                                v["floor_ft"], v["ceiling_ft"], *span) for v, span in zip(volumes, spans)))
                w.put("airspace.names", run)
                # What the map's volume says besides (wingtip.airspace_map), one
                # object a volume, in the layer's order: the engine's `view`
                # reads it, and answers each field null from a pack without it.
                w.put("airspace.attr", json.dumps(
                    [{"ident": v["ident"] or None, "number": v["number"], "ceiling_excluded": v["ceiling_excluded"],
                      "hours_code": v["hours_code"], "hours_remark": v["hours_remark"]} for v in volumes],
                    separators=(",", ":")).encode())
            if "sua" in held:
                areas = [layers["sua"][i][2] for i in held["sua"]]
                blobs = [json.dumps(a, separators=(",", ":")) for a in areas]
                blob_spans, blob_run = _strings(blobs)
                name_spans, name_run = _strings([a["name"] for a in areas])
                w.put("sua.rec", b"".join(
                    struct.pack("<dIIII", float("nan") if a["floor_ft"] is None else a["floor_ft"], *b, *n)
                    for a, b, n in zip(areas, blob_spans, name_spans)))
                w.put("sua.json", blob_run)
                w.put("sua.names", name_run)
                alt, times = _sua_alt(areas)
                w.put("sua.alt", alt)
                w.put("sua.times", times)
            if ground is not None:
                w.put("terrain", ground)
            w.put("veil.pts", veil_pts)
            w.put("veil.names", veil_names)
            for name, table in tables.items():
                columns = table["columns"]
                lat_at, lon_at = columns.index("LAT_DECIMAL"), columns.index("LONG_DECIMAL")

                def inside(row, lat_at=lat_at, lon_at=lon_at):
                    try:
                        lat, lon = float(row[lat_at]), float(row[lon_at])
                    except ValueError:
                        return False
                    return south <= lat < north and west <= lon < east
                w.put(name, json.dumps({"columns": columns, "rows": [r for r in table["rows"] if inside(r)]},
                                       separators=(",", ":")).encode())
            w.finish(pack.cycle, time.time())
            f.seek(36)
            crc = struct.unpack("<I", f.read(4))[0]
        index["regions"].append({"name": region, "west": west, "south": south, "east": east, "north": north,
                                 "bytes": path.stat().st_size, "crc32": crc})
    (part / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    if folder.exists():
        for old in folder.iterdir():
            old.unlink()
        folder.rmdir()
    part.replace(folder)
    for other in out_dir.iterdir():
        if other.is_dir() and other != folder:
            for old in other.iterdir():
                old.unlink()
            other.rmdir()
    return index


def phone_index(pack_dir=None) -> dict | None:
    """The phones' packs of the newest cycle on disk, as written; None
    where there are none."""
    folder = Path(pack_dir or PACK_DIR) / "phone"
    found = sorted(p for p in folder.glob("*/index.json") if not p.parent.name.endswith(".part"))
    if not found:
        return None
    try:
        return json.loads(found[-1].read_text())
    except (OSError, ValueError):
        return None


def phone_pack_path(cycle: str, region: str, pack_dir=None) -> Path | None:
    """A phone pack on disk by its cycle and region; None where there is
    none (or the names are not a cycle's and a region's)."""
    import re

    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", cycle) or not re.fullmatch(r"[ns]\d{2}[ew]\d{3}", region):
        return None
    path = Path(pack_dir or PACK_DIR) / "phone" / cycle / f"{region}.pack"
    return path if path.is_file() else None


def ground_grid_version() -> str | None:
    """The ground grid the phones' terrain is read from, by its version;
    None where it is not built."""
    from . import ground_grid

    return ground_grid.VERSION if ground_grid._grids() is not None else None


def ensure_phone(pack_dir=None) -> dict | None:
    """The phones' packs built from the planner's pack where they are not
    of its cycle; None where they already are, or there is no pack."""
    from . import airspace_at

    pack = current(pack_dir)
    if pack is None:
        return None
    index = phone_index(pack_dir)
    if (index is not None and index.get("cycle") == pack.cycle and index.get("tolerance_deg") == PHONE_TOLERANCE_DEG
            and index.get("terrain_pool") == TERRAIN_POOL and index.get("ground_grid") == ground_grid_version()):
        return None
    started = time.monotonic()
    index = write_phone(pack, Path(pack_dir or PACK_DIR) / "phone", list(airspace_at.mode_c_airports()))
    log.info("Phone packs for %s built in %.1f s: %d regions, %.1f MB", pack.cycle, time.monotonic() - started,
             len(index["regions"]), sum(r["bytes"] for r in index["regions"]) / 1e6)
    return index
