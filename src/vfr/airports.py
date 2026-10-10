"""Airport identifier -> coordinates lookup, plus runway and frequency
data -- all backed by OurAirports' free, no-API-key-required dataset
(three sibling CSVs from the same host).
"""
import bisect
import gzip
import json
import os
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from . import geo
from .routecsv import locked

OURAIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"
RUNWAYS_URL = "https://davidmegginson.github.io/ourairports-data/runways.csv"
FREQUENCIES_URL = "https://davidmegginson.github.io/ourairports-data/airport-frequencies.csv"
REQUEST_HEADERS = {"User-Agent": "vfr-route-learning-project/0.1"}
_RAW_DIR = Path(__file__).resolve().parents[2] / "data" / "raw"
DEFAULT_CACHE_PATH = _RAW_DIR / "airports.csv"
RUNWAYS_CACHE_PATH = _RAW_DIR / "runways.csv"
FREQUENCIES_CACHE_PATH = _RAW_DIR / "airport-frequencies.csv"

# CTAF/UNICOM first -- the one a VFR pilot actually needs before
# anything else -- then tower/ground/approach/departure, then the
# rest. Anything not listed here sorts after, in whatever order the
# source data had it.
_FREQUENCY_TYPE_ORDER = ["CTAF", "UNIC", "TWR", "GND", "APP", "DEP", "ATIS", "AWOS"]


def _ensure_cached(url: str, cache_path: Path) -> Path:
    """The table on disk, downloaded once if it is not there yet.

    One download at a time per file, and the file whole or absent: a
    briefing asks for the runways from two of its stages at once, and
    on a cold cache each stage downloaded the table and one read the
    other's half-written file -- "No columns to parse from file", a
    500 for the first briefing after a fresh start.
    """
    # On disk already, it is whole (a download is renamed into place), so
    # there is no lock to take: each read of a table took it -- a lock
    # file opened and flocked on the data's mount, a millisecond a time --
    # and a nav log reads the airports table for each leg's temperatures
    # aloft at each altitude it weighs, a fifth of its time once its
    # checkpoints were known (profiled 2026-10-10).
    if cache_path.exists():
        return cache_path
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with locked(cache_path):
        if not cache_path.exists():
            resp = requests.get(url, headers=REQUEST_HEADERS, timeout=30)
            resp.raise_for_status()
            partial = cache_path.with_name(cache_path.name + ".part")
            partial.write_bytes(resp.content)
            os.replace(partial, cache_path)
    return cache_path


@lru_cache(maxsize=8)
def _read_table(path: str, _mtime: float) -> pd.DataFrame:
    """One read per file per process. `_mtime` is not used in the body:
    it is in the signature so a file replaced on disk is a different
    cache entry, which is what the hand-rolled dict this replaced used
    its key for."""
    return pd.read_csv(path, low_memory=False)


def _load_table(url: str, cache_path: Path) -> pd.DataFrame:
    path = _ensure_cached(url, cache_path)
    return _read_table(str(path), path.stat().st_mtime)


def load_airports(cache_path: Path = DEFAULT_CACHE_PATH) -> pd.DataFrame:
    """Load the full OurAirports table (downloads + caches on first call).

    Held in memory after the first read. vfr.weather looks up the nearest
    winds-aloft station through this, once per nav-log leg, and re-parsing
    an 80,000-row CSV each time was a measurable part of what made
    planning a route slow. Callers must treat the frame as read-only.
    """
    return _load_table(OURAIRPORTS_URL, cache_path)


@lru_cache(maxsize=4)
def _airport_rows(path: str, _mtime: float) -> dict:
    """Each ident and local code in the table, upper-cased, to its first
    row's position: the row a scan of both columns found first, in the
    table's order. Made once per table read (keyed as _read_table is);
    the scan it replaces was 8 ms a lookup, and every request about a
    route looks up its airports."""
    df = _read_table(path, _mtime)
    rows: dict = {}
    for i, (ident, local) in enumerate(zip(df["ident"].astype(str).str.upper(), df["local_code"].astype(str).str.upper())):
        rows.setdefault(ident, i)
        rows.setdefault(local, i)
    return rows


def preload_lookup(cache_path: Path = DEFAULT_CACHE_PATH) -> None:
    """get_airport's index made now (the planner's warm-up), not by the
    first route asked for after a restart: a quarter of a second."""
    path = _ensure_cached(OURAIRPORTS_URL, cache_path)
    _airport_rows(str(path), path.stat().st_mtime)


def get_airport(ident: str, cache_path: Path = DEFAULT_CACHE_PATH) -> dict:
    """Look up one airport by FAA local identifier or ICAO ident.

    Raises ValueError if not found.
    """
    ident = ident.strip().upper()
    path = _ensure_cached(OURAIRPORTS_URL, cache_path)
    mtime = path.stat().st_mtime
    at = _airport_rows(str(path), mtime).get(ident)
    if at is None:
        raise ValueError(f"Airport identifier {ident!r} not found in OurAirports data")
    row = _read_table(str(path), mtime).iloc[at]
    elevation = row.get("elevation_ft")
    return {
        "ident": row["ident"],
        "name": row["name"],
        "lat": float(row["latitude_deg"]),
        "lon": float(row["longitude_deg"]),
        "elevation_ft": float(elevation) if pd.notna(elevation) else None,
        "municipality": row.get("municipality", ""),
        "region": row.get("iso_region", ""),
    }


def _us_airports(cache_path: Path) -> pd.DataFrame:
    path = _ensure_cached(OURAIRPORTS_URL, cache_path)
    return _us_airports_of(str(path), path.stat().st_mtime)


@lru_cache(maxsize=2)
def _us_airports_of(path: str, _mtime: float) -> pd.DataFrame:
    """The US-only, pre-uppercased slice `search_airports` filters --
    keyed by path and mtime like `_read_table` (a replaced file is a
    new entry, and the old one is dropped rather than kept for ever
    under an `id()` Python may hand to another frame), so this is
    built once per file, not on every keystroke. Building it fresh
    each call -- filtering the full 80,000-row table to US-only, then
    `.str.upper()` over three string columns of the result -- was
    cheap in isolation but
    added up to real, measurable CPU under a burst of concurrent
    searches (every DEP/DEST field firing one on mount), which is
    exactly the kind of load a page full of Playwright tests, or a
    pilot just loading the app, produces.
    """
    df = _read_table(path, _mtime)
    # This app plans against FAA sectional charts and
    # aviationweather.gov data alone -- there's no route it could
    # actually fly outside the US, so a non-US match here would
    # just be a dead end once picked, not a real suggestion.
    us = df[df["iso_country"] == "US"].copy()
    us["_ident_upper"] = us["ident"].astype(str).str.upper()
    us["_local_upper"] = us["local_code"].astype(str).str.upper()
    us["_name_upper"] = us["name"].astype(str).str.upper()
    # Every word of the name and the town, each after a space, so a
    # search finds a word's start anywhere: "oshkosh" is Wittman
    # Regional's town, not the start of its name.
    us["_words_upper"] = " " + us["_name_upper"] + " " + us["municipality"].fillna("").astype(str).str.upper()
    us["_size_rank"] = us["type"].map({"large_airport": 0, "medium_airport": 1, "small_airport": 2}).fillna(3)
    # OurAirports' own `ident` column is a synthesized ICAO-style
    # code (usually "K" + `local_code`) it assigns even to airports
    # that were never actually issued one -- C81 (a real, local-use
    # FAA identifier, no K) shows up there as "KC81". `icao_code` is
    # how OurAirports itself marks the difference: populated when
    # `ident` is a real, assigned code (KDLH, a towered airport
    # pilots do call that), empty when `ident` is its own guess --
    # `local_code` (the one pilots, and the rest of this app, use
    # for those) wins only in that second case. Except that it leaves
    # `icao_code` empty for some real ones too -- KPWK, KBUU, KDKB, each
    # with a METAR under that name, came out PWK, BUU, DKB beside KMDW
    # and KMWC on the map -- so a three-letter FAA identifier, which a
    # US field's ICAO code is K and, counts as one when `ident` is that
    # K form. One with a digit in it (C81, 57C, 1D2) never has one.
    has_icao = us["icao_code"].notna() & (us["icao_code"] != "")
    has_local = us["local_code"].notna() & (us["local_code"] != "")
    k_form = us["local_code"].astype(str).str.fullmatch(r"[A-Z]{3}") & (us["ident"] == "K" + us["local_code"].astype(str))
    us["_display_ident"] = us["ident"].where(has_icao | k_form, us["local_code"].where(has_local, us["ident"]))
    return us


def search_airports(query: str, limit: int = 8, cache_path: Path = DEFAULT_CACHE_PATH) -> list[dict]:
    """Airports whose ident or local code starts with `query`, or a word of
    whose name or town does -- the route form's pickers and the panel's
    search bar, so a pilot who doesn't have an ident memorized can find
    it by the airport's name, or its town's.

    An ident typed whole comes first, then idents that start with it,
    then the names and towns -- typing "KDL" is almost always hunting
    for an ident, not a name that happens to start the same way. Within
    each, the bigger fields first, then by ident: "oshkosh" is Wittman
    Regional (KOSH) before a private strip named for the town, which
    was the only answer while names had to start with what was typed.
    """
    query = query.strip().upper()
    if not query:
        return []
    df = _us_airports(cache_path)
    if " " not in query:
        # One word -- every keystroke of an ident or a town -- from the index
        # (_search_index_of), not a scan of 20,000 rows' strings per letter.
        path = _ensure_cached(OURAIRPORTS_URL, cache_path)
        return _rows(df, _indexed_matches(_search_index_of(str(path), path.stat().st_mtime), query, limit))
    exact = (df["_ident_upper"] == query) | (df["_local_upper"] == query) | (df["_display_ident"] == query)
    ident_hit = ~exact & (df["_ident_upper"].str.startswith(query) | df["_local_upper"].str.startswith(query))
    word_hit = ~exact & ~ident_hit & df["_words_upper"].str.contains(" " + query, regex=False)
    matches = pd.concat([df[exact].assign(_rank=0), df[ident_hit].assign(_rank=1), df[word_hit].assign(_rank=2)])
    matches = matches.sort_values(["_rank", "_size_rank", "_display_ident"]).head(limit)
    return _rows(df, [df.index.get_loc(i) for i in matches.index])


def search_index(cache_path: Path = DEFAULT_CACHE_PATH) -> bytes:
    """Every US airport `search_airports` can answer with, as the phone's
    own copy for searching as a pilot types (web lib/airportIndex), gzipped
    JSON: `{"airports": [[ident, name, town, state, size, *other idents]]}`
    -- the ident pilots use, the name and town every word of which is
    searched, the state without "US-", the size rank the answers are
    ordered by (0 large to 3 other), and OurAirports' ident and the local
    code where either is not the ident shown (KC81 for C81). 32,600 rows,
    about 530 KB. Made once per file."""
    path = _ensure_cached(OURAIRPORTS_URL, cache_path)
    return _search_index_bytes(str(path), path.stat().st_mtime)


@lru_cache(maxsize=2)
def _search_index_bytes(path: str, _mtime: float) -> bytes:
    us = _us_airports_of(path, _mtime)
    rows = []
    columns = zip(us["_display_ident"].astype(str), us["_ident_upper"], us["_local_upper"], us["name"],
                  us["municipality"], us["iso_region"], us["_size_rank"])
    for display, ident, local, name, town, region, size in columns:
        # A missing local code is "NAN" once upper-cased (_us_airports_of).
        others = sorted({key for key in (ident, local) if isinstance(key, str) and key not in ("NAN", display.upper())})
        rows.append([
            display, name if isinstance(name, str) else "", town if isinstance(town, str) else "",
            region.removeprefix("US-") if isinstance(region, str) else "", int(size), *others,
        ])
    return gzip.compress(json.dumps({"airports": rows}, separators=(",", ":")).encode(), mtime=0)


def _rows(df: pd.DataFrame, positions: list[int]) -> list[dict]:
    """The search's answers, in order, from the US table's rows."""
    rows = df.iloc[positions]
    return [
        {
            "ident": row["_display_ident"],
            "name": row["name"],
            "municipality": row["municipality"] if pd.notna(row.get("municipality")) else None,
            "region": row["iso_region"] if pd.notna(row.get("iso_region")) else None,
        }
        for _, row in rows.iterrows()
    ]


@lru_cache(maxsize=2)
def _search_index_of(path: str, _mtime: float) -> dict:
    """The US table's idents and words, sorted, for `search_airports` to
    find a prefix by bisection: an ident or local code whole (`exact`),
    every ident and local code, and every word of a name and its town,
    each with its row. Built once per file, as the table is. The scan it
    replaced -- three string columns' startswith and contains over 20,000
    rows -- was 50 to 100 ms of every keystroke's answer."""
    us = _us_airports_of(path, _mtime)
    exact: dict[str, set[int]] = {}
    idents: list[tuple[str, int]] = []
    words: list[tuple[str, int]] = []
    columns = zip(us["_ident_upper"], us["_local_upper"], us["_display_ident"].astype(str), us["_words_upper"])
    # A missing local code is a missing value, not a string (pandas keeps
    # it one through astype(str)): nothing to find it by.
    known = lambda *keys: {key for key in keys if isinstance(key, str)}  # noqa: E731
    for row, (ident, local, display, text) in enumerate(columns):
        for key in known(ident, local, display):
            exact.setdefault(key, set()).add(row)
        idents.extend((key, row) for key in known(ident, local))
        words.extend((word, row) for word in set(text.split()) if isinstance(text, str))
    idents.sort()
    words.sort()
    return {
        "exact": exact, "idents": idents, "words": words,
        "size": us["_size_rank"].tolist(), "display": us["_display_ident"].astype(str).tolist(),
    }


def _indexed_matches(index: dict, query: str, limit: int) -> list[int]:
    """The rows `search_airports` answers a one-word query with, in its
    order: the ident whole, then idents that start with it, then names and
    towns with a word that does; the bigger fields first in each, then by
    ident."""
    def prefixed(keys: list[tuple[str, int]]) -> set[int]:
        found, at = set(), bisect.bisect_left(keys, (query,))
        while at < len(keys) and keys[at][0].startswith(query):
            found.add(keys[at][1])
            at += 1
        return found

    exact = index["exact"].get(query, set())
    ident = prefixed(index["idents"]) - exact
    word = prefixed(index["words"]) - exact - ident
    ranked = [(rank, index["size"][row], index["display"][row], row)
              for rank, rows in enumerate((exact, ident, word)) for row in rows]
    return [row for *_, row in sorted(ranked)[:limit]]


# The airports a map draws a place for: fields a pilot can land at. No
# heliports, balloonports or seaplane bases, and nothing closed.
_FIELD_KINDS = {"large_airport": "large", "medium_airport": "medium", "small_airport": "small"}


def _place_of(row) -> dict:
    """A US airport as the map names it: the ident pilots use (see
    `_us_airports_of`), OurAirports' own (what its runways, frequencies
    and the weather are keyed by), where it is, and what size of field."""
    elevation = row.get("elevation_ft")
    return {
        "ident": row["_display_ident"],
        "source_ident": row["ident"],
        "name": row["name"],
        "municipality": row["municipality"] if pd.notna(row.get("municipality")) else None,
        "region": row["iso_region"] if pd.notna(row.get("iso_region")) else None,
        "lat": float(row["latitude_deg"]),
        "lon": float(row["longitude_deg"]),
        "elevation_ft": float(elevation) if pd.notna(elevation) else None,
        "kind": _FIELD_KINDS.get(row["type"], "other"),
    }


#: The columns _place_of reads.
_PLACE_COLUMNS = ("_display_ident", "ident", "name", "municipality", "iso_region",
                  "latitude_deg", "longitude_deg", "elevation_ft", "type")


def _places_of(frame: pd.DataFrame) -> list[dict]:
    """_place_of for each row of a frame, read a column at a time: row by
    row (iterrows) it was 14 ms of the 149 fields in a box of Minnesota,
    this a tenth of that (pandas 3, measured 2026-10-10)."""
    columns = [c for c in _PLACE_COLUMNS if c in frame.columns]
    return [_place_of(dict(zip(columns, values))) for values in zip(*(frame[c].tolist() for c in columns))]


def _among(idents: pd.Series, chosen: set) -> pd.Series:
    """Whether each ident is one of `chosen`, by the set's own lookup:
    pandas' isin made an array of the set at each call, 39 ms for the
    5,066 stations that report against the few hundred fields in a box
    (pandas 3, measured 2026-10-10) -- the most of what the map's fields
    in view cost -- where this is half a millisecond."""
    return pd.Series(np.fromiter((i in chosen for i in idents), bool, len(idents)), index=idents.index)


def find_place(ident: str, cache_path: Path = DEFAULT_CACHE_PATH) -> dict | None:
    """One US airport by any ident it goes by -- the one pilots use
    (C81, KDLH), its local code, or OurAirports' own (KC81) -- or None.
    The display ident wins a tie, so KC81 never shadows a real KC81."""
    ident = ident.strip().upper()
    if not ident:
        return None
    df = _us_airports(cache_path)
    for column in ("_display_ident", "_ident_upper", "_local_upper"):
        match = df[df[column].astype(str).str.upper() == ident]
        if not match.empty:
            return _place_of(match.iloc[0])
    return None


def places_in(south: float, west: float, north: float, east: float, limit: int = 300,
              cache_path: Path = DEFAULT_CACHE_PATH, only: set | None = None,
              first: set | None = None) -> list[dict]:
    """The landing fields inside a box, the biggest first, at most
    `limit` of them -- what the map lays its tap targets over, so a tap
    on an airport printed on the chart opens its card. Zoomed out the
    box holds thousands, and the small ones are what the limit drops.
    `only`, OurAirports idents, keeps those alone before the limit: the
    fields that report their weather, along a whole route. `first` puts
    those ahead of the rest before the limit: the fields that report,
    so a busy box's limit drops small fields with no weather to show,
    never a small field's weather chip."""
    df = _us_airports(cache_path)
    inside = df[
        df["type"].isin(list(_FIELD_KINDS))
        & df["latitude_deg"].between(south, north)
        & df["longitude_deg"].between(west, east)
    ]
    if only is not None:
        inside = inside[_among(inside["ident"], only)]
    rank = inside["type"].map({kind: i for i, kind in enumerate(_FIELD_KINDS)})
    behind = ~_among(inside["ident"], first) if first else False
    # One per ident: OurAirports lists a few fields twice under the same
    # local code (an old record and its successor), and the map keys its
    # targets on it.
    ordered = inside.assign(_behind=behind, _rank=rank).sort_values(["_behind", "_rank", "_display_ident"])
    chosen = ordered.drop_duplicates("_display_ident").head(limit)
    return _places_of(chosen)


#: How far round a position the nearest fields are looked for first, in
#: degrees: a box a few minutes' flight across, widened where it is empty.
_NEAREST_BOX_DEG = (0.75, 2.0, 6.0)


def nearest(lat: float, lon: float, limit: int = 10, cache_path: Path = DEFAULT_CACHE_PATH) -> list[dict]:
    """The landing fields nearest a position, the nearest first: each a
    place (as find_place's) with `distance_nm` and `bearing_deg`, true,
    from the position to it -- what a pilot with an engine running rough
    looks for. Asked in a box round the position, widened until it holds
    `limit` of them."""
    df = _us_airports(cache_path)
    fields = df[df["type"].isin(list(_FIELD_KINDS))]
    for half in _NEAREST_BOX_DEG:
        box = fields[fields["latitude_deg"].between(lat - half, lat + half)
                     & fields["longitude_deg"].between(lon - half * 1.5, lon + half * 1.5)]
        if len(box) >= limit:
            break
    lats, lons = box["latitude_deg"].to_numpy(dtype=float), box["longitude_deg"].to_numpy(dtype=float)
    distances = geo.distance_nm(lat, lon, lats, lons)
    bearings = geo.bearing_deg(lat, lon, lats, lons)
    ordered = box.assign(_d=distances, _b=bearings).sort_values("_d").drop_duplicates("_display_ident").head(limit)
    return [
        {**_place_of(row), "distance_nm": round(float(row["_d"]), 1), "bearing_deg": round(float(row["_b"])) % 360}
        for _, row in ordered.iterrows()
    ]


def get_runways(ident: str, cache_path: Path = RUNWAYS_CACHE_PATH) -> list[dict]:
    """This airport's runways, for the briefing's own airport-
    information section. Keyed by `airport_ident` directly --
    OurAirports' runways.csv carries the ident string alongside its own
    numeric `airport_ref`, so no join against airports.csv is needed.
    Each runway's `ends` are its two ends' idents, and `end_headings` each
    end's ident and true heading, None where the table has none
    (vfr.runway_wind turns its number true then).
    """
    ident = ident.strip().upper()
    df = _load_table(RUNWAYS_URL, cache_path)
    rows = df[df["airport_ident"].str.upper() == ident]
    runways = []
    for _, row in rows.iterrows():
        le, he = row.get("le_ident"), row.get("he_ident")
        ends = "/".join(str(e) for e in (le, he) if pd.notna(e)) or None
        length, width = row.get("length_ft"), row.get("width_ft")
        runways.append({
            "ends": ends,
            "end_headings": [
                (str(end), float(row.get(f"{side}_heading_degT")) if pd.notna(row.get(f"{side}_heading_degT")) else None)
                for side, end in (("le", le), ("he", he)) if pd.notna(end)
            ],
            # Where each end is, where the table has it (four runways in ten
            # at a small US field): vfr.pattern's fallback to NASR's own.
            "end_positions": {
                str(end): (float(row.get(f"{side}_latitude_deg")), float(row.get(f"{side}_longitude_deg")))
                for side, end in (("le", le), ("he", he))
                if pd.notna(end) and pd.notna(row.get(f"{side}_latitude_deg")) and pd.notna(row.get(f"{side}_longitude_deg"))
            },
            "length_ft": int(length) if pd.notna(length) else None,
            "width_ft": int(width) if pd.notna(width) else None,
            "surface": row.get("surface") if pd.notna(row.get("surface")) else None,
            "lighted": bool(row.get("lighted")),
            "closed": bool(row.get("closed")),
        })
    return runways


def get_frequencies(ident: str, cache_path: Path = FREQUENCIES_CACHE_PATH) -> list[dict]:
    """This airport's radio frequencies (CTAF, tower, ATIS, ...), sorted
    with CTAF/UNICOM first since that's what a VFR pilot needs before
    anything else."""
    ident = ident.strip().upper()
    df = _load_table(FREQUENCIES_URL, cache_path)
    rows = df[df["airport_ident"].str.upper() == ident]

    def sort_key(freq_type: str) -> int:
        try:
            return _FREQUENCY_TYPE_ORDER.index(freq_type)
        except ValueError:
            return len(_FREQUENCY_TYPE_ORDER)

    frequencies = [
        {
            "type": row.get("type") if pd.notna(row.get("type")) else None,
            "description": row.get("description") if pd.notna(row.get("description")) else None,
            "frequency_mhz": float(row["frequency_mhz"]) if pd.notna(row.get("frequency_mhz")) else None,
        }
        for _, row in rows.iterrows()
    ]
    return sorted(frequencies, key=lambda f: sort_key(f["type"] or ""))
