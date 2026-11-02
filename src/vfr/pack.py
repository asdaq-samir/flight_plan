"""The cycle pack: one file per FAA cycle holding what wingtip-engine
(native/engine) reads, so the planner and, later, the phones answer from
the same bytes. Its format is set out in native/engine/src/pack.rs; this
module writes it and reads it in place.

What it holds:

- `airspace`: every Class B, C, D and E volume of the NASR Class Airspace
  shapefile, its rings as the file draws them (as WKB, in the file's
  order and direction) with its box and fields: vfr.airspace_at's volumes;
- `sua`: the special-use areas as the FAA's feature service gave them
  (vfr.sua), with when;
- `urban`: the Census urban areas' outlines (vfr.congested);
- `airports`, `navaids`, `fixes`: the NASR rows a phone needs to find a
  place offline, as CSV columns and rows in JSON;
- `meta`: the cycle, and each source's size and time, so a reader can
  tell the pack still matches the files the planner holds.

The planner builds the pack after its warm-up when the one on disk is
not of the files it has (`ensure`), and its readers turn to it only where
it matches them (`current`), so an answer is the same with or without it.
It lives in data/raw/packs, beside the files it is made from, and is not
committed.
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
#: The NASR rows a phone needs to name and find a place, kept as the FAA
#: writes them (NASR's CSV subscription files, each with its EFF_DATE).
COLUMNS = {
    "airports": ("APT_BASE.csv", ("ARPT_ID", "ICAO_ID", "SITE_TYPE_CODE", "ARPT_NAME", "CITY", "STATE_CODE",
                                  "LAT_DECIMAL", "LONG_DECIMAL", "ELEV", "MAG_VARN", "MAG_HEMIS", "TPA",
                                  "FACILITY_USE_CODE", "ARPT_STATUS", "TWR_TYPE_CODE", "FUEL_TYPES", "CHART_NAME")),
    "navaids": ("NAV_BASE.csv", ("NAV_ID", "NAV_TYPE", "NAME", "CITY", "STATE_CODE", "NAV_STATUS",
                                 "LAT_DECIMAL", "LONG_DECIMAL", "ELEV", "MAG_VARN", "MAG_VARN_HEMIS", "FREQ", "CHAN")),
    "fixes": ("FIX_BASE.csv", ("FIX_ID", "ICAO_REGION_CODE", "STATE_CODE", "LAT_DECIMAL", "LONG_DECIMAL",
                               "FIX_USE_CODE", "CHARTS")),
}

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
    order: the records vfr.airspace_at holds, each box the record's own."""
    import shapefile
    import vfr_native

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
                wkbs.append(vfr_native.shape_to_wkb(content))
                fields.append(values)
        finally:
            reader.close()
    return boxes, wkbs, fields


def _table(path: Path, columns: tuple) -> bytes:
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        rows = [[row.get(c) or "" for c in columns] for row in csv.DictReader(f)]
    return json.dumps({"columns": list(columns), "rows": rows}, separators=(",", ":")).encode()


def build(cache_dir, pack_dir=None) -> Path:
    """The pack for the files the planner holds now, written whole beside
    them, and any older pack removed."""
    from . import airspace, congested, sua

    cache_dir = Path(cache_dir)
    started = time.monotonic()
    sua_held = sua._everything()
    path = write(Path(pack_dir or PACK_DIR), cycle_of(cache_dir) or time.strftime("%Y-%m-%d", time.gmtime()),
                 shp_path=Path(airspace.ensure_class_airspace_shapefile(cache_dir)),
                 sua_held=sua_held, sua_at=(sua._CACHE.get("all") or (time.time(), None))[0],
                 urban=congested._urban_areas(), urban_path=congested.URBAN_AREAS_PATH,
                 tables={name: (cache_dir / file, columns) for name, (file, columns) in COLUMNS.items()})
    log.info("Cycle pack %s built in %.1f s, %.0f MB", path.name, time.monotonic() - started,
             path.stat().st_size / 1e6)
    return path


def write(pack_dir: Path, cycle: str, *, shp_path: Path, sua_held: list, sua_at: float, urban: list,
          urban_path: Path | None, tables: dict) -> Path:
    """The pack of these sources written to pack_dir, whole or not at all,
    and any other pack there removed."""
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
            w.put(name, _table(file, columns))
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
