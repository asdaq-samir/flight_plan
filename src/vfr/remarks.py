"""What the FAA says about an airport in words, in plain English: the
remarks behind its Chart Supplement entry (NASR's APT_RMK, the same
text) that a pilot acts on from the cockpit -- the runway lights turned
on by keying the mic on the CTAF, and the weather some fields read out
on so many clicks of it.

3CK, Lake in the Hills, for one: "ACTVT REIL RWY 08 & 26; PAPI RWY 08
& 26; MIRL RWY 08/26 - CTAF." and "WX ADZY - CTAF 5 CLICKS OR
815-444-1729." -- here "Activate REIL runway 08 & 26; PAPI runway 08 &
26; MIRL runway 08/26 - CTAF." and "Weather advisory - CTAF 5 clicks or
815-444-1729."
"""
from __future__ import annotations

import csv
import re
import threading
from functools import lru_cache
from pathlib import Path

from . import faa_data
from .config import DATA_DIR

FAA_CACHE_DIR = DATA_DIR / "raw" / "faa_nasr"

# The remarks' own contractions, in words. The lighting systems' names
# (MIRL, REIL, PAPI, MALSR...) and the radio's (CTAF, UNICOM, AWOS) are
# what a pilot reads on the chart and hears on the radio, so they stay.
WORDS = {
    "ACTVT": "activate", "ACTVTD": "activated", "RWY": "runway", "RY": "runway", "RWYS": "runways", "RYS": "runways",
    "LGT": "light", "LGTS": "lights", "LGTD": "lighted", "LGTG": "lighting", "INTST": "intensity", "INTS": "intensity",
    "INCR": "increase", "DECR": "decrease", "CONSLY": "continuously", "CONT": "continuous", "BCN": "beacon",
    "OPR": "operates", "OPER": "operates", "OPRS": "operates", "OPS": "operations", "CLSD": "closed", "ATCT": "the tower",
    "TWR": "tower", "ROTG": "rotating", "RTG": "rotating", "SS": "sunset", "SR": "sunrise", "TWY": "taxiway",
    "TWYS": "taxiways", "PERI": "perimeter", "HR": "hour", "HRS": "hours", "MIN": "minute", "MINS": "minutes",
    "SECS": "seconds", "AVBL": "available", "UNAVBL": "unavailable", "MED": "medium", "AFT": "after", "NSTD": "non-standard",
    "REQ": "request", "AMGR": "the airport manager", "ARPT": "airport", "FREQ": "frequency", "CTC": "contact",
    "OTS": "out of service", "CTL": "control", "PCL": "pilot-controlled lighting", "WX": "weather", "RDO": "radio",
    "DALGT": "daylight", "DURG": "during", "DRG": "during", "OTR": "other", "PPR": "prior permission required",
    "NGT": "night", "FM": "from", "EXTN": "extension", "LCL": "local", "ADZY": "advisory", "INDEFLY": "indefinitely",
    "WI": "within", "TEMP": "temperature", "ALT": "altitude", "BTN": "between", "ANNC": "announce", "TKOFF": "takeoff",
    "INFO": "information", "REBCST": "rebroadcast", "THLD": "threshold", "APCH": "approach", "PRESET": "preset",
}
KEEP = {
    "CTAF", "UNICOM", "AWOS", "ASOS", "ATIS", "MIRL", "MIRLS", "HIRL", "LIRL", "REIL", "REILS", "PAPI", "PAPIS", "VASI",
    "MALSR", "MALSF", "MALS", "ODALS", "ALSF", "SSALR", "RLLS", "PCL", "FSS", "ATC", "GCO", "AIM", "AGL", "MSL", "VFR", "IFR",
}

# Which of an airport's remarks are about its lights, and which about the
# radio: a remark on the lighting schedule, and a click count anywhere.
LIGHTING = ("LGT_SKED", "BCN_LGT_SKED")
_CLICKS = re.compile(r"\bCLICKS?\b")
# A light the pilot turns on: "ACTVT ... - CTAF" or "... - 122.8".
_ACTIVATED = re.compile(r"\b(ACTVT|ACTIVATE|PCL|KEY)\b|\bCLICKS?\b")
_EXPLICIT_CLICKS = re.compile(r"\b(\d+|THREE|FOUR|FIVE|SEVEN)[ -]CLICKS?\b")

_LOCK = threading.Lock()


@lru_cache(maxsize=2)
def _remarks_of(path: str, _mtime: float) -> dict:
    """Every airport's remarks, by its FAA identifier: (column, text,
    element) in the file's order, the element what the remark is on -- a
    runway's "06/24", an end's "24", blank for the airport's own."""
    by_airport: dict[str, list[tuple[str, str, str]]] = {}
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            by_airport.setdefault(row["ARPT_ID"].strip().upper(), []).append(
                (row["REF_COL_NAME"], row["REMARK"].strip(), (row.get("ELEMENT") or "").strip().upper()))
    return by_airport


def _all_remarks(cache_dir=FAA_CACHE_DIR) -> dict:
    with _LOCK:
        path = faa_data.ensure_nasr_file("APT_RMK.csv", cache_dir)
        return _remarks_of(str(path), Path(path).stat().st_mtime)


def plain(remark: str) -> str:
    """A remark in plain English: its contractions spelled out, the rest
    in lower case but for the names a pilot reads and hears as they are,
    each sentence started with a capital."""
    def word(match: re.Match) -> str:
        token = match.group(0)
        if token in WORDS:
            return WORDS[token]
        return token if token in KEEP or not token.isalpha() else token.lower()

    text = re.sub(r"[A-Za-z][A-Za-z']*", word, remark.strip().upper())
    text = re.sub(r"\s+", " ", text)
    return re.sub(r"(^|[.!?]\s+)([a-z])", lambda m: m.group(1) + m.group(2).upper(), text)


def airport_notes(faa_id: str, cache_dir=FAA_CACHE_DIR) -> dict:
    """What an airport's remarks say about its lights and its radio, in
    plain English (`plain`): `lighting`, its lighting schedule; `radio`,
    every other remark that counts mic clicks (the weather read out on
    the CTAF, a radio check); `pilot_controlled`, whether a light is
    turned on from the cockpit; and `explicit_clicks`, whether the
    remarks say how many clicks -- where they do not, the standard
    keying (AIM 4-1-9) is what applies."""
    remarks = _all_remarks(cache_dir).get(faa_id.strip().upper(), [])
    lighting = [text for column, text, _ in remarks if column in LIGHTING]
    radio = [text for column, text, _ in remarks if column not in LIGHTING and _CLICKS.search(text.upper())]
    return {
        "lighting": [plain(t) for t in lighting],
        "radio": [plain(t) for t in radio],
        "pilot_controlled": any(_ACTIVATED.search(t.upper()) for t in lighting),
        "explicit_clicks": any(_EXPLICIT_CLICKS.search(t.upper()) for t in lighting),
    }


# Which part of a runway is turf, where the remarks say: the Chart
# Supplement's free text on a runway of two surfaces (APT_RWY's
# SURFACE_TYPE_CODE ASPH-TURF and its like) -- C81's 06/24 "SW 1000 FT
# TURF-GRVL." -- in the wordings most of them use, each part of a remark
# split at its commas and semicolons: "SW 1200 FT TURF", "1200 FT TURF ON
# RWY 27 END", "581 FT BY 100 FT TURF ON S END", "FIRST 300 FT RY 33
# LENGTH IS TURF", and "2000 FT ASPH ON RWY 36 END, REMAINDER TURF".
_TURF = r"TURF(?:-(?:GRVL|DIRT))?|GRASS|SOD"
_SURFACE = rf"(?P<surface>{_TURF}|ASPH(?:ALT)?|CONC(?:RETE)?|GRVL|GRAVEL|DIRT)\b"
#: The compass points a remark names an end of a runway by.
_POINTS = {"N": 0, "NORTH": 0, "NE": 45, "E": 90, "EAST": 90, "SE": 135, "S": 180, "SOUTH": 180, "SW": 225,
           "W": 270, "WEST": 270, "NW": 315}
_POINT = "|".join(sorted(_POINTS, key=len, reverse=True))
_LENGTH = r"(?P<length>\d[\d,]*)\s*FT(?:\s*(?:X|BY)\s*\d+\s*FT)?"
_END = rf"(?:(?:RWY|RY)\s+(?P<end>\d{{1,2}}[LRC]?)|(?P<point>{_POINT}))"
_PARTS = (
    re.compile(rf"^(?P<point>{_POINT})\s+{_LENGTH}\s+{_SURFACE}"),
    re.compile(rf"^(?:FIRST|FST)\s+{_LENGTH}\s+(?:OF\s+)?(?:RWY|RY)\s+(?P<end>\d{{1,2}}[LRC]?)\s+(?:LENGTH\s+)?IS\s+{_SURFACE}"),
    re.compile(rf"^{_LENGTH}\s+{_SURFACE}(?:\s+\w+)*?\s+(?:ON\s+)?(?:THE\s+)?{_END}\s+END\b"),
)
_REMAINDER = re.compile(rf"^(?:REMAINDER|RMNDR)\s+(?:IS\s+)?{_SURFACE}")


def _end_at(point: str, ends: list[str]) -> str | None:
    """The end of a runway a compass point names: the one whose threshold
    lies that way from the runway's middle -- runway 06's at its south-west
    end, its number's heading turned round -- within 67.5 degrees."""
    best, best_off = None, 67.5
    for end in ends:
        number = re.match(r"\d{1,2}", end)
        if not number:
            continue
        off = abs((int(number.group()) * 10 + 180 - _POINTS[point]) % 360)
        off = min(off, 360 - off)
        if off <= best_off:
            best, best_off = end, off
    return best


def _turf_of(remark: str, ends: list[str]) -> list[dict]:
    """The turf a runway's remark puts at its ends (the module's notes on
    `_TURF`): each part as how far along the runway from which end, its far
    edge None where it runs on to the other end."""
    known = []
    rest = None
    for clause in re.split(r"[;,]", remark.upper()):
        clause = re.sub(r"^\s*(?:RWY|RY)\s+[\dLRC]+/?[\dLRC]*\s+", "", clause.strip()).strip(" .")
        if (rest_match := _REMAINDER.match(clause)):
            rest = rest_match.group("surface")
            continue
        for pattern in _PARTS:
            found = pattern.match(clause)
            if not found:
                continue
            groups = found.groupdict()
            end = groups.get("end")
            end = next((e for e in ends if e.lstrip("0") == end.lstrip("0")), None) if end else _end_at(groups["point"], ends)
            if end:
                known.append((end, int(groups["length"].replace(",", "")), re.fullmatch(_TURF, groups["surface"]) is not None))
            break
    parts = [{"end": end, "from_ft": 0, "to_ft": length} for end, length, turf in known if turf]
    # The rest turf after a length paved from one end: from there on.
    paved = [(end, length) for end, length, turf in known if not turf]
    if rest and re.fullmatch(_TURF, rest) and len(paved) == 1 and not parts:
        parts.append({"end": paved[0][0], "from_ft": paved[0][1], "to_ft": None})
    return parts


def runway_turf(faa_id: str, cache_dir=FAA_CACHE_DIR) -> dict[str, list[dict]]:
    """Which part of each of an airport's runways is turf where the FAA's
    remarks say (`_turf_of`), by the runway's ends as the remarks name it
    ("06/24"): each part from `from_ft` to `to_ft` feet along it from
    `end`, `to_ft` None to the far end. Only the runways it can be read
    for: a runway of one surface has its own (APT_RWY's), and most remarks
    on two surfaces are in these few wordings."""
    turf: dict[str, list[dict]] = {}
    for _column, text, element in _all_remarks(cache_dir).get(faa_id.strip().upper(), []):
        if "/" not in element:
            continue
        parts = _turf_of(text, element.split("/"))
        if parts:
            turf.setdefault(element, []).extend(parts)
    return turf


def preload(cache_dir=FAA_CACHE_DIR) -> None:
    """Reads the remarks now -- 90,000 rows, half a second -- so the first
    airport card after a start does not wait on them."""
    _all_remarks(cache_dir)
