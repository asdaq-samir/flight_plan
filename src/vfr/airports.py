"""Airport identifier -> coordinates lookup, plus runway and frequency
data -- all backed by OurAirports' free, no-API-key-required dataset
(three sibling CSVs from the same host).
"""
from functools import lru_cache
from pathlib import Path

import pandas as pd
import requests

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
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    if not cache_path.exists():
        resp = requests.get(url, headers=REQUEST_HEADERS, timeout=30)
        resp.raise_for_status()
        cache_path.write_bytes(resp.content)
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


def get_airport(ident: str, cache_path: Path = DEFAULT_CACHE_PATH) -> dict:
    """Look up one airport by FAA local identifier or ICAO ident.

    Raises ValueError if not found.
    """
    ident = ident.strip().upper()
    df = load_airports(cache_path)
    match = df[(df["ident"].str.upper() == ident) | (df["local_code"].astype(str).str.upper() == ident)]
    if match.empty:
        raise ValueError(f"Airport identifier {ident!r} not found in OurAirports data")
    row = match.iloc[0]
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


_US_AIRPORTS_CACHE: dict[int, pd.DataFrame] = {}


def _us_airports(cache_path: Path) -> pd.DataFrame:
    """The US-only, pre-uppercased slice `search_airports` filters --
    keyed by `id()` of `load_airports`'s own cached frame (itself
    already keyed by path+mtime), so this is built once per process,
    not on every keystroke. Building it fresh each call -- filtering
    the full 80,000-row table to US-only, then `.str.upper()` over
    three string columns of the result -- was cheap in isolation but
    added up to real, measurable CPU under a burst of concurrent
    searches (every DEP/DEST field firing one on mount), which is
    exactly the kind of load a page full of Playwright tests, or a
    pilot just loading the app, produces.
    """
    df = load_airports(cache_path)
    key = id(df)
    if key not in _US_AIRPORTS_CACHE:
        # This app plans against FAA sectional charts and
        # aviationweather.gov data alone -- there's no route it could
        # actually fly outside the US, so a non-US match here would
        # just be a dead end once picked, not a real suggestion.
        us = df[df["iso_country"] == "US"].copy()
        us["_ident_upper"] = us["ident"].astype(str).str.upper()
        us["_local_upper"] = us["local_code"].astype(str).str.upper()
        us["_name_upper"] = us["name"].astype(str).str.upper()
        # OurAirports' own `ident` column is a synthesized ICAO-style
        # code (usually "K" + `local_code`) it assigns even to airports
        # that were never actually issued one -- C81 (a real, local-use
        # FAA identifier, no K) shows up there as "KC81". `icao_code` is
        # how OurAirports itself marks the difference: populated when
        # `ident` is a real, assigned code (KDLH, a towered airport
        # pilots do call that), empty when `ident` is its own guess --
        # `local_code` (the one pilots, and the rest of this app, use
        # for those) wins only in that second case.
        has_icao = us["icao_code"].notna() & (us["icao_code"] != "")
        has_local = us["local_code"].notna() & (us["local_code"] != "")
        us["_display_ident"] = us["ident"].where(has_icao, us["local_code"].where(has_local, us["ident"]))
        _US_AIRPORTS_CACHE[key] = us
    return _US_AIRPORTS_CACHE[key]


def search_airports(query: str, limit: int = 8, cache_path: Path = DEFAULT_CACHE_PATH) -> list[dict]:
    """Airports whose ident, local code, or name starts with `query` --
    the DEP/DEST inputs' own autocomplete, so a pilot who doesn't have
    an ident memorized can find it by typing the airport's name instead.

    Ident/local-code matches sort first and name matches second, each
    group alphabetical by ident within itself -- typing "KDL" is almost
    always hunting for an ident, not a name that happens to start the
    same way, so those should never be buried under name matches.
    """
    query = query.strip().upper()
    if not query:
        return []
    df = _us_airports(cache_path)
    ident_hit = df["_ident_upper"].str.startswith(query) | df["_local_upper"].str.startswith(query)
    name_hit = ~ident_hit & df["_name_upper"].str.startswith(query)
    matches = pd.concat([df[ident_hit].assign(_rank=0), df[name_hit].assign(_rank=1)])
    matches = matches.sort_values(["_rank", "_display_ident"]).head(limit)
    return [
        {
            "ident": row["_display_ident"],
            "name": row["name"],
            "municipality": row["municipality"] if pd.notna(row.get("municipality")) else None,
            "region": row["iso_region"] if pd.notna(row.get("iso_region")) else None,
        }
        for _, row in matches.iterrows()
    ]


def get_runways(ident: str, cache_path: Path = RUNWAYS_CACHE_PATH) -> list[dict]:
    """This airport's runways, for the briefing's own airport-
    information section. Keyed by `airport_ident` directly --
    OurAirports' runways.csv carries the ident string alongside its own
    numeric `airport_ref`, so no join against airports.csv is needed.
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
