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
    """Every airport's remarks, by its FAA identifier: (column, text)
    pairs in the file's order."""
    by_airport: dict[str, list[tuple[str, str]]] = {}
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            by_airport.setdefault(row["ARPT_ID"].strip().upper(), []).append((row["REF_COL_NAME"], row["REMARK"].strip()))
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
    lighting = [text for column, text in remarks if column in LIGHTING]
    radio = [text for column, text in remarks if column not in LIGHTING and _CLICKS.search(text.upper())]
    return {
        "lighting": [plain(t) for t in lighting],
        "radio": [plain(t) for t in radio],
        "pilot_controlled": any(_ACTIVATED.search(t.upper()) for t in lighting),
        "explicit_clicks": any(_EXPLICIT_CLICKS.search(t.upper()) for t in lighting),
    }
