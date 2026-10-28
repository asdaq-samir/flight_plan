"""The airspace over one point, from the ground up: which class each
altitude is in, its VFR weather minimums (14 CFR 91.155), what it takes
to go in, and the equipment it asks for -- what a pilot is asked of a
point on the chart in the oral exam, read from the same NASR shapefile
the altitude planner uses (vfr.airspace).

Every Class B, C, D and E volume whose shape holds the point is read
from the file itself: holding every Class E shape in memory was 8 million
vertices and 200 MB for a question asked a tap at a time. What is held is
each volume's box and fields, read once (_volumes_index); a tap reads
only the shapes whose box holds the point, by their number in the file.
The file's own bbox filter read every shape's header from the top for
each tap, 15 to 56 seconds on the live planner (2026-10-28).
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import shapefile
from shapely.geometry import Point
from shapely.geometry import shape as shapely_shape

from .geo import distance_nm
from .once import once

#: Class A, from here to FL600 (71.33): IFR only.
CLASS_A_FLOOR_FT = 18000.0
#: Class E from here up wherever nothing lower is designated, but not within
#: 1,500 ft of the surface (71.71(b)): over ground above 13,000 ft the band
#: under that is Class G.
CLASS_E_EVERYWHERE_FT = 14500.0
#: Where 91.155's minimums, 91.117's speed and 91.215's transponder rule change.
TEN_THOUSAND_FT = 10000.0
#: Class G's minimums differ at and below this height (91.155(a)).
G_LOW_AGL_FT = 1200.0
#: The Mode C veil's radius round each airport of 14 CFR part 91 appendix D
#: section 1 (91.215(b)(2), 91.225(d)(2)), surface to 10,000 ft MSL.
MODE_C_VEIL_NM = 30.0
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
#: Above 10,000 ft MSL a transponder and ADS-B Out are asked for, but not
#: at or below this height above the ground (91.215(b)(5), 91.225(d)(4)).
TRANSPONDER_EXEMPT_AGL_FT = 2500.0

#: The shapefile's UPPER_VAL for "up to but not including Class A".
_TO_CLASS_A = -9998.0

_RESTRICTIVENESS = {"B": 0, "C": 1, "D": 2, "E": 3, "G": 4}


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
def _volumes_index(path: str, _mtime: float) -> tuple[np.ndarray, list[tuple[int, dict]]]:
    """Each Class B, C, D and E volume's box, (min_lon, min_lat, max_lon,
    max_lat) a row, and its number in the file with its fields."""
    boxes, volumes = [], []
    reader = shapefile.Reader(path)
    try:
        for i, record in enumerate(reader.iterRecords()):
            klass = (record.as_dict().get("CLASS") or "").strip()
            if klass not in ("B", "C", "D", "E"):
                continue
            boxes.append(tuple(reader.shape(i).bbox))
            volumes.append((i, record.as_dict()))
    finally:
        reader.close()
    return np.array(boxes, dtype=float).reshape(-1, 4), volumes


def preload(shp_path) -> None:
    """The volumes' boxes read now, at the planner's start, not at a tap."""
    path = Path(shp_path)
    _volumes_index(str(path), path.stat().st_mtime)


def volumes_at(lat: float, lon: float, shp_path) -> list[dict]:
    """Every Class B, C, D and E volume holding the point: {"class",
    "local_type", "name", "ident", "floor_ft", "floor_ref", "ceiling_ft"}
    with the ceiling in feet MSL."""
    path = Path(shp_path)
    boxes, volumes = _volumes_index(str(path), path.stat().st_mtime)
    near = np.flatnonzero((boxes[:, 0] <= lon) & (boxes[:, 2] >= lon) & (boxes[:, 1] <= lat) & (boxes[:, 3] >= lat))
    point = Point(lon, lat)
    found = []
    reader = shapefile.Reader(str(path))
    try:
        for k in near:
            number, record = volumes[k]
            if not shapely_shape(reader.shape(number).__geo_interface__).contains(point):
                continue
            floor_ft, floor_ref = _floor(record)
            found.append({
                "class": (record.get("CLASS") or "").strip(),
                "local_type": record.get("LOCAL_TYPE") or "",
                "name": record.get("NAME") or "",
                "ident": (record.get("IDENT") or "").strip().upper(),
                "floor_ft": floor_ft,
                "floor_ref": floor_ref,
                "ceiling_ft": _ceiling(record),
            })
    finally:
        reader.close()
    return found


def minimums(klass: str, floor_msl: float, agl: float) -> dict | None:
    """91.155(a)'s basic VFR weather minimums for a band of `klass`
    airspace whose bottom is `floor_msl`, `agl` above the ground there:
    {"day": ..., "night": ...}, each {"visibility_sm", "clear_of_clouds",
    "below_ft", "above_ft", "horizontal_ft"}. None in Class A, which has
    no VFR."""
    def rule(vis, below=None, above=None, horizontal=None):
        return {"visibility_sm": vis, "clear_of_clouds": below is None,
                "below_ft": below, "above_ft": above, "horizontal_ft": horizontal}

    standard = rule(3, 500, 1000, 2000)
    high = rule(5, 1000, 1000, 5280)
    if klass == "A":
        return None
    if klass == "B":
        return {"day": rule(3), "night": rule(3)}
    if klass in ("C", "D"):
        return {"day": standard, "night": standard}
    if klass == "E":
        return {"day": high, "night": high} if floor_msl >= TEN_THOUSAND_FT else {"day": standard, "night": standard}
    # Class G.
    if agl < G_LOW_AGL_FT:
        return {"day": rule(1), "night": standard}
    if floor_msl >= TEN_THOUSAND_FT:
        return {"day": high, "night": high}
    return {"day": rule(1, 500, 1000, 2000), "night": standard}


ENTRY = {
    "A": "IFR only: an instrument rating, an IFR flight plan and a clearance (91.135).",
    "B": "An ATC clearance into the Class B, and a private pilot certificate or a student's endorsement for it (91.131).",
    "C": "Two-way radio communication with ATC established before entering (91.130).",
    "D": "Two-way radio communication with the tower established before entering (91.129).",
    "E": "Nothing for VFR.",
    "G": "Nothing.",
}


def equipment(klass: str, floor_msl: float, agl: float, in_veil: bool, above_bc: bool = False) -> str | None:
    """What the aeroplane must carry to be there (91.215, 91.225), or
    None where nothing is asked beyond the basics. `above_bc`: over a Class
    B's or C's ceiling, inside its lateral limits."""
    transponder = "A transponder with altitude reporting and ADS-B Out (91.215, 91.225)."
    if klass == "A":
        # IFR only: the instrument flight asks for far more than this.
        return None
    if klass in ("B", "C"):
        return transponder
    if klass == "D":
        # 91.215(b)(2) asks for the transponder in "all airspace" within 30 nm
        # of a Class B primary airport, surface to 10,000 ft MSL, a Class D
        # (Addison or Arlington under DFW's veil) included.
        if in_veil and floor_msl < TEN_THOUSAND_FT:
            return ("A two-way radio, and a transponder with altitude reporting and ADS-B Out: "
                    "inside a 30 nm Mode C veil (91.215(b)(2), 91.225(d)(2)).")
        return "A two-way radio."
    if floor_msl >= TEN_THOUSAND_FT and agl >= TRANSPONDER_EXEMPT_AGL_FT:
        return transponder
    # Above a Class B or C, within its lateral limits, up to 10,000 ft MSL
    # (91.215(b)(4), 91.225(d)(3)): a Class E band over a Class C was
    # said to need nothing (the aviation check, 2026-10-27).
    if above_bc and floor_msl < TEN_THOUSAND_FT:
        return ("A transponder with altitude reporting and ADS-B Out: above a Class B or C, "
                "within its lateral limits, to 10,000 ft MSL (91.215(b)(4), 91.225(d)(3)).")
    if in_veil and floor_msl < TEN_THOUSAND_FT:
        return "A transponder with altitude reporting and ADS-B Out: inside a 30 nm Mode C veil (91.215(b)(2), 91.225(d)(2))."
    return None


def speed_kt(klass: str, floor_msl: float, under_b: bool, agl: float = TRANSPONDER_EXEMPT_AGL_FT) -> int | None:
    """The 91.117 speed limit, where one applies: 200 kt under a Class
    B's shelf (91.117(c)), 200 kt at or below 2,500 ft above the surface
    in a Class C or D, and 250 kt below 10,000 ft MSL (91.117(a)).

    91.117(b) holds the 200 kt "within 4 nautical miles of the primary
    airport" of a Class C or D, and a point here does not know its
    distance from the airport. The whole surface band is given 200 kt:
    the lower speed is the safe error where the area reaches past 4 nm.
    A band's bottom decides, as the bands are split at 2,500 ft above the
    ground (TRANSPONDER_EXEMPT_AGL_FT)."""
    if klass == "A" or floor_msl >= TEN_THOUSAND_FT:
        return None
    if under_b or (klass in ("C", "D") and agl < TRANSPONDER_EXEMPT_AGL_FT):
        return 200
    return 250


def column(lat: float, lon: float, ground_ft: float, volumes: list[dict], in_veil: bool = False) -> list[dict]:
    """The airspace over the point in bands, from the ground to FL600:
    {"floor_ft", "ceiling_ft" (MSL), "class", "name", "minimums",
    "entry", "equipment", "speed_kt"}. A B, C or D holds its band where
    it is drawn, the most restrictive where they overlap; E from its
    floor (or 14,500 ft where nothing lower is drawn); G under it all;
    A from 18,000 ft. Bands are split where the rules change -- 1,200 ft
    above the ground in G, 10,000 ft MSL -- and joined where nothing
    does."""
    def floor_msl(v):
        return ground_ft + v["floor_ft"] if v["floor_ref"] == "AGL" else (ground_ft if v["floor_ref"] == "SFC" else v["floor_ft"])

    layered = [(floor_msl(v), max(v["ceiling_ft"], floor_msl(v)), v) for v in volumes]
    controlled = [(f, c, v) for f, c, v in layered if v["class"] in ("B", "C", "D")]
    class_e = [(f, c, v) for f, c, v in layered if v["class"] == "E"]
    b_shelves = [(f, c) for f, c, v in controlled if v["class"] == "B"]

    edges = {ground_ft, ground_ft + G_LOW_AGL_FT, ground_ft + TRANSPONDER_EXEMPT_AGL_FT,
             TEN_THOUSAND_FT, CLASS_E_EVERYWHERE_FT, CLASS_A_FLOOR_FT}
    for f, c, _ in layered:
        edges.update((f, c))
    edges = sorted(e for e in edges if ground_ft <= e <= CLASS_A_FLOOR_FT)

    bands = []
    for bottom, top in zip(edges, edges[1:]):
        if top <= bottom:
            continue
        middle = (bottom + top) / 2
        holding = [(f, c, v) for f, c, v in controlled if f <= middle < c]
        if holding:
            _, _, volume = min(holding, key=lambda h: _RESTRICTIVENESS[h[2]["class"]])
            klass, name = volume["class"], volume["name"]
        elif any(f <= middle < c for f, c, _ in class_e) or (middle >= CLASS_E_EVERYWHERE_FT and middle >= ground_ft + 1500):
            klass, name = "E", None
        else:
            klass, name = "G", None
        agl = bottom - ground_ft
        under_b = klass != "B" and any(f > middle for f, _ in b_shelves)
        band = {
            "floor_ft": bottom, "ceiling_ft": top, "class": klass, "name": name,
            "minimums": minimums(klass, bottom, agl), "entry": ENTRY[klass],
            "equipment": equipment(klass, bottom, agl, in_veil, above_bc=any(
                v["class"] in ("B", "C") and c <= bottom for _, c, v in controlled)), "speed_kt": speed_kt(klass, bottom, under_b, agl),
        }
        previous = bands[-1] if bands else None
        if previous and all(previous[k] == band[k] for k in ("class", "name", "minimums", "equipment", "speed_kt")):
            previous["ceiling_ft"] = top
        else:
            bands.append(band)
    bands.append({
        "floor_ft": CLASS_A_FLOOR_FT, "ceiling_ft": 60000.0, "class": "A", "name": None, "minimums": None,
        "entry": ENTRY["A"], "equipment": equipment("A", CLASS_A_FLOOR_FT, CLASS_A_FLOOR_FT - ground_ft, in_veil),
        "speed_kt": None,
    })
    return bands


@once(maxsize=1)
def mode_c_airports() -> tuple[dict, ...]:
    """MODE_C_VEIL_AIRPORTS where they are (vfr.airports), as
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
    """The nearest Mode C veil airport (mode_c_airports) within
    MODE_C_VEIL_NM of the point, as {"ident", "name", "distance_nm"}; None
    outside every veil."""
    near = [
        (distance_nm(lat, lon, a["lat"], a["lon"]), a) for a in class_b_airports
        if a.get("lat") is not None and a.get("lon") is not None
    ]
    near = [(d, a) for d, a in near if d <= MODE_C_VEIL_NM]
    if not near:
        return None
    d, airport = min(near, key=lambda n: n[0])
    return {"ident": airport["ident"], "name": airport.get("name"), "distance_nm": round(d, 1)}
