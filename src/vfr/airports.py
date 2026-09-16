"""Airport identifier -> coordinates lookup, plus runway and frequency
data -- all backed by OurAirports' free, no-API-key-required dataset
(three sibling CSVs from the same host).
"""
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


_TABLE_CACHE: dict = {}


def _load_table(url: str, cache_path: Path) -> pd.DataFrame:
    path = _ensure_cached(url, cache_path)
    key = (str(path), path.stat().st_mtime)
    if key not in _TABLE_CACHE:
        _TABLE_CACHE[key] = pd.read_csv(path, low_memory=False)
    return _TABLE_CACHE[key]


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


def get_runways(ident: str, cache_path: Path = RUNWAYS_CACHE_PATH) -> list[dict]:
    """This airport's runways, for the Flight Briefing page's own
    airport-information section. Keyed by `airport_ident` directly --
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
