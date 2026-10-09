"""Where a place a pilot names is -- a town, a street address -- for
Nearest to find the fields near it, where it found them near own ship
alone.

Towns come from the Census Bureau's gazetteer of places: every
incorporated place and census-designated place in the US, 32,350 of them,
each with its internal point and its land area (the 2025 edition). It is
downloaded once, a megabyte, and kept. Addresses come from the Census
Bureau's own geocoder, asked when what is typed starts with a number. Both
are the US government's, free and keyless.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import os
import re
import threading
import time
import zipfile

import requests

from .config import DATA_DIR

log = logging.getLogger(__name__)

GAZETTEER_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_place_national.zip"
GEOCODER_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
TOWNS_PATH = DATA_DIR / "raw" / "census" / "places-2025.json"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; vfr-route-learning-project/0.1)"}

#: A gazetteer name ends with what kind of place it is -- "Madison city",
#: "Abanda CDP", "Nashville-Davidson metropolitan government (balance)" --
#: in lower case, or as CDP; the name a pilot types is what comes before.
_KIND_WORDS = re.compile(r"(\s+(?:[a-z()][^\s]*|CDP))+$")
#: What an address typed looks like: a house number first.
_ADDRESS = re.compile(r"^\d+\s+\S")

#: After a failed download, the next try waits this long, so a slow Census
#: host does not queue every search behind a timeout.
RETRY_AFTER_S = 300
DOWNLOAD_TIMEOUT_S = 10

_LOCK = threading.Lock()
_TOWNS: list | None = None
_RETRY_AT = 0.0
#: Addresses already asked, by the text normalised, for ADDRESS_TTL_S: a
#: pilot's typing pauses, and anyone calling the endpoint, do not each
#: reach the Census geocoder. Only answers are kept, not failures.
ADDRESS_TTL_S = 3600
ADDRESS_CACHE_MAX = 512
_ADDRESSES: dict = {}


def _towns_of(zipped: bytes) -> list:
    """[name, state, lat, lon, land area] for each place in the gazetteer,
    the biggest first."""
    with zipfile.ZipFile(io.BytesIO(zipped)) as z:
        member = next(n for n in z.namelist() if n.lower().endswith(".txt"))
        text = z.read(member).decode("utf-8-sig", errors="replace")
    delimiter = "|" if text.split("\n", 1)[0].count("|") > text.split("\n", 1)[0].count("\t") else "\t"
    towns = []
    for row in csv.DictReader(io.StringIO(text), delimiter=delimiter):
        row = {k.strip(): (v or "").strip() for k, v in row.items() if k}
        try:
            lat, lon, land = float(row["INTPTLAT"]), float(row["INTPTLONG"]), float(row.get("ALAND") or 0)
        except (KeyError, ValueError):
            continue
        name = _KIND_WORDS.sub("", row.get("NAME", "")).strip()
        if name:
            towns.append([name, row.get("USPS", ""), lat, lon, land])
    towns.sort(key=lambda t: -t[4])
    return towns


def _towns() -> list:
    """The gazetteer's places, from memory, from disk, or downloaded once;
    none where the Census Bureau cannot be reached (only addresses and
    airports are found then, nothing failed). The download runs outside
    the lock, so a slow host holds up the one search that asked, not every
    search behind it; two at the start may both fetch, and the second
    publishes the same list."""
    global _TOWNS, _RETRY_AT
    with _LOCK:
        if _TOWNS is not None:
            return _TOWNS
        if TOWNS_PATH.exists():
            try:
                _TOWNS = json.loads(TOWNS_PATH.read_text())
                return _TOWNS
            except ValueError as err:
                # A truncated file would fail every search for good; it is
                # downloaded again instead.
                log.warning("The kept Census gazetteer is unreadable, fetching it again: %s", err)
                TOWNS_PATH.unlink(missing_ok=True)
        if time.monotonic() < _RETRY_AT:
            return []
        # Claimed now, so searches arriving during the download return none
        # at once; a success clears it.
        _RETRY_AT = time.monotonic() + DOWNLOAD_TIMEOUT_S
    try:
        resp = requests.get(GAZETTEER_URL, headers=HEADERS, timeout=DOWNLOAD_TIMEOUT_S)
        resp.raise_for_status()
        towns = _towns_of(resp.content)
    except (requests.RequestException, zipfile.BadZipFile, StopIteration) as err:
        log.warning("No Census gazetteer of places: %s", err)
        with _LOCK:
            _RETRY_AT = time.monotonic() + RETRY_AFTER_S
        return []
    TOWNS_PATH.parent.mkdir(parents=True, exist_ok=True)
    partial = TOWNS_PATH.with_name(TOWNS_PATH.name + ".part")
    partial.write_text(json.dumps(towns))
    os.replace(partial, TOWNS_PATH)
    with _LOCK:
        _TOWNS = towns
        _RETRY_AT = 0.0
    return towns


def find_towns(query: str, limit: int = 6) -> list:
    """Towns whose name starts with what is typed -- "madison", or
    "madison, wi" for one state's -- the one named exactly first, then the
    biggest by land area: {"label": "Madison, WI", "lat", "lon"}."""
    name, _, state = query.partition(",")
    name, state = name.strip().lower(), state.strip().upper()
    if len(name) < 2:
        return []
    found = [t for t in _towns() if t[0].lower().startswith(name) and (not state or t[1].startswith(state))]
    found.sort(key=lambda t: t[0].lower() != name)
    return [{"label": f"{t[0]}, {t[1]}", "lat": t[2], "lon": t[3]} for t in found[:limit]]


def _address_label(matched: str) -> str:
    """The geocoder's "4000 INTERNATIONAL LN, MADISON, WI, 53704" as an
    address is written: "4000 International Ln, Madison, WI 53704"."""
    parts = [p.strip() for p in matched.split(",")]
    if len(parts) >= 4:
        street, town, state, zip_code = parts[0], parts[1], parts[2], parts[3]
        return f"{street.title()}, {town.title()}, {state} {zip_code}"
    return matched.title()


def find_addresses(query: str, limit: int = 4) -> list:
    """A street address typed, where the Census Bureau's geocoder places
    it: {"label", "lat", "lon"}; none for what is not an address (no house
    number first) or while the geocoder cannot be reached."""
    if not _ADDRESS.match(query.strip()):
        return []
    key = " ".join(query.lower().split())
    with _LOCK:
        kept = _ADDRESSES.get(key)
    if kept and time.monotonic() < kept[0]:
        return kept[1][:limit]
    try:
        resp = requests.get(GEOCODER_URL, headers=HEADERS, timeout=8, params={
            "address": query.strip(), "benchmark": "Public_AR_Current", "format": "json"})
        resp.raise_for_status()
        matches = resp.json().get("result", {}).get("addressMatches", [])
    except (requests.RequestException, ValueError) as err:
        log.warning("The Census geocoder did not answer for an address: %s", err)
        return []
    found = [
        {"label": _address_label(m["matchedAddress"]), "lat": m["coordinates"]["y"], "lon": m["coordinates"]["x"]}
        for m in matches[:limit] if m.get("matchedAddress") and m.get("coordinates")
    ]
    with _LOCK:
        if len(_ADDRESSES) >= ADDRESS_CACHE_MAX:
            _ADDRESSES.clear()
        _ADDRESSES[key] = (time.monotonic() + ADDRESS_TTL_S, found)
    return found


def preload() -> None:
    """The gazetteer read now, not on a pilot's first search."""
    _towns()
