"""The airspace over one point, from the ground up: which class each
altitude is in, its VFR weather minimums (14 CFR 91.155), what it takes
to go in, and the equipment it asks for -- what a pilot is asked of a
point on the chart in the oral exam, read from the same NASR shapefile
the altitude planner uses (wingtip.airspace).

Every Class B, C, D and E volume whose shape holds the point is read
from the file itself: holding every Class E shape in memory was 8 million
vertices and 200 MB for a question asked a tap at a time. What is held is
each volume's box, fields and place in the file, read once
(_volumes_index); a tap reads only the shapes whose box holds the point,
straight from the mapped file, and asks the Rust extension (native/)
whether each holds it. The file's own bbox filter read every shape's
header from the top for each tap, 15 to 56 seconds on the live planner
(2026-10-28); pyshp parsing each candidate's vertices and shapely
building it from lists was 75 to 95 ms a tap and the index 8.5 s at the
start (2026-11-01). Where the cycle pack (wingtip.pack) was made from this very
file, a tap asks the engine of the pack instead: the same rings, kept as
WKB, the boxes and the walk in Rust, and nothing to index at the start.
"""
from __future__ import annotations

import json
import mmap
from pathlib import Path

import numpy as np
import shapefile
import wingtip_native

from . import pack as cycle_pack
from .once import once

#: The shapefile's "up to but not including Class A" ceiling, and one that
#: is not a number, read as Class A's floor (14 CFR 71.33).
CLASS_A_FLOOR_FT = 18000.0
#: Those airports (14 CFR part 91, appendix D, section 1). Not the Class B
#: shapefile's primary airports: it names 30, and BWI, Andrews, Dulles,
#: Hobby, LaGuardia, Newark and Miramar have veils of their own beyond
#: the ones they sit under -- a pilot by Leesburg or Galveston was told no
#: transponder was needed (the aviation check, 2026-10-27).
MODE_C_VEIL_AIRPORTS = (
    "KATL", "KBWI", "KBOS", "KADW", "KIAD", "KCLT", "KORD", "KCLE", "KCVG", "KDFW", "KDEN", "KDTW", "PHNL",
    "KIAH", "KHOU", "KMCI", "KLAS", "KLAX", "KMEM", "KMIA", "KMSP", "KEWR", "KMSY", "KJFK", "KLGA", "KMCO",
    "KPHL", "KPHX", "KPIT", "KSTL", "KSLC", "KNKX", "KSAN", "KSFO", "KSEA", "KTPA", "KDCA",
)
#: The shapefile's UPPER_VAL for "up to but not including Class A".
_TO_CLASS_A = -9998.0


def _floor(record: dict) -> tuple[float, str]:
    """(feet, reference): SFC 0, a number over SFC above the ground
    ("AGL", as a 700 or 1,200 ft Class E5 is drawn), or MSL."""
    try:
        value = float(record.get("LOWER_VAL") or 0)
    except (TypeError, ValueError):
        value = 0.0
    if record.get("LOWER_CODE") == "MSL":
        return value, "MSL"
    return (value, "AGL") if value > 0 else (0.0, "SFC")


def _ceiling(record: dict) -> float:
    """The top in feet MSL; the base of Class A for "up to but not
    including" it, or where it is not a number."""
    try:
        value = float(record.get("UPPER_VAL"))
    except (TypeError, ValueError):
        return CLASS_A_FLOOR_FT
    return CLASS_A_FLOOR_FT if value == _TO_CLASS_A or value <= 0 else value


@once(maxsize=2)
def _volumes_index(path: str, _mtime: float) -> tuple[np.ndarray, list[tuple[int, int, dict]], mmap.mmap]:
    """Each Class B, C, D and E volume's box, (min_lon, min_lat, max_lon,
    max_lat) a row; where its shape's content starts in the .shp and how
    long it is, with its fields; and the .shp mapped. The boxes are each
    record's own (ESRI's shapefile technical description, 1998: the .shx
    gives each record's offset and length in 16-bit words, big-endian, from
    byte 100; a polygon's content is its type and then its box, four
    little-endian doubles), read in one go rather than a shape at a time."""
    shx = np.frombuffer(Path(path).with_suffix(".shx").read_bytes(), dtype=">i4", offset=100).reshape(-1, 2)
    starts, lengths = shx[:, 0].astype(np.int64) * 2 + 8, shx[:, 1].astype(np.int64) * 2
    with open(path, "rb") as f:
        mapped = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
    shp = np.frombuffer(mapped, dtype=np.uint8)
    reader = shapefile.Reader(path)
    keep, volumes = [], []
    try:
        for i, record in enumerate(reader.iterRecords()):
            fields = record.as_dict()
            if (fields.get("CLASS") or "").strip() not in ("B", "C", "D", "E"):
                continue
            keep.append(i)
            volumes.append((int(starts[i]), int(lengths[i]), fields))
    finally:
        reader.close()
    at = starts[keep, None] + 4 + np.arange(32)[None, :]
    boxes = shp[at].copy().view("<f8").reshape(-1, 4) if keep else np.zeros((0, 4))
    return boxes, volumes, mapped


@once(maxsize=2)
def _pack_fields(path: str, _mtime: float) -> list[dict]:
    """Each volume's fields in the pack's airspace layer."""
    return cycle_pack.current().attrs("airspace")


def _packed(shp_path: Path):
    """The cycle pack and its volumes' fields, where it was made from this
    shapefile; None where it was not."""
    pack = cycle_pack.current()
    if not cycle_pack.matches(pack, "airspace", shp_path):
        return None
    return pack, _pack_fields(str(pack.path), pack.path.stat().st_mtime)


def preload(shp_path) -> None:
    """The volumes' boxes read now, at the planner's start, not at a tap:
    the pack's fields, or the shapefile's index where there is no pack."""
    path = Path(shp_path)
    if _packed(path) is None:
        _volumes_index(str(path), path.stat().st_mtime)


def _volume(record: dict) -> dict:
    floor_ft, floor_ref = _floor(record)
    return {
        "class": (record.get("CLASS") or "").strip(),
        "local_type": record.get("LOCAL_TYPE") or "",
        "name": record.get("NAME") or "",
        "ident": (record.get("IDENT") or "").strip().upper(),
        "floor_ft": floor_ft,
        "floor_ref": floor_ref,
        "ceiling_ft": _ceiling(record),
    }


def volumes_at(lat: float, lon: float, shp_path) -> list[dict]:
    """Every Class B, C, D and E volume holding the point: {"class",
    "local_type", "name", "ident", "floor_ft", "floor_ref", "ceiling_ft"}
    with the ceiling in feet MSL."""
    path = Path(shp_path)
    packed = _packed(path)
    if packed is not None:
        pack, fields = packed
        return [_volume(fields[k]) for k in wingtip_native.pack_holding(pack.mapped, "airspace", float(lon), float(lat))]
    boxes, volumes, mapped = _volumes_index(str(path), path.stat().st_mtime)
    near = np.flatnonzero((boxes[:, 0] <= lon) & (boxes[:, 2] >= lon) & (boxes[:, 1] <= lat) & (boxes[:, 3] >= lat))
    return [_volume(volumes[k][2]) for k in near
            if wingtip_native.shape_holds(mapped[volumes[k][0]:volumes[k][0] + volumes[k][1]], float(lon), float(lat))]


def column(lat: float, lon: float, ground_ft: float, volumes: list[dict], in_veil: bool = False) -> list[dict]:
    """The airspace over the point in bands, from the ground to FL600:
    {"floor_ft", "ceiling_ft" (MSL), "class", "name", "minimums" (14 CFR
    91.155(a)), "entry", "equipment" (91.215, 91.225), "speed_kt"
    (91.117)}. The rules -- which class holds each band, where the bands
    split, and what each asks -- are the engine's (rules.rs, its
    `airspace_column`), the phones' very ones; the volumes are this
    module's, read from the shapefile or the cycle pack (volumes_at)."""
    asked = [{k: v[k] for k in ("class", "name", "floor_ft", "floor_ref", "ceiling_ft")} for v in volumes]
    return json.loads(wingtip_native.call("airspace_column", json.dumps({"ground_ft": ground_ft, "volumes": asked, "in_veil": in_veil})))


@once(maxsize=1)
def mode_c_airports() -> tuple[dict, ...]:
    """MODE_C_VEIL_AIRPORTS where they are (wingtip.airports), as
    {"ident", "name", "lat", "lon"}; one the table does not have left out."""
    from . import airports

    found = []
    for ident in MODE_C_VEIL_AIRPORTS:
        try:
            a = airports.get_airport(ident)
        except ValueError:
            continue
        found.append({"ident": ident, "name": a.get("name"), "lat": a["lat"], "lon": a["lon"]})
    return tuple(found)


def mode_c_veil(lat: float, lon: float, class_b_airports) -> dict | None:
    """The nearest Mode C veil airport (mode_c_airports) within 30 nm of
    the point (91.215(b)(2), 91.225(d)(2)), as {"ident", "name",
    "distance_nm"}; None outside every veil. The engine's (rules.rs,
    `mode_c_veil`), as a phone works it out from its pack."""
    airports = [{k: a.get(k) for k in ("ident", "name", "lat", "lon")} for a in class_b_airports]
    return json.loads(wingtip_native.call("mode_c_veil", json.dumps({"lat": lat, "lon": lon, "airports": airports})))
