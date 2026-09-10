"""Airport identifier -> coordinates lookup, backed by OurAirports' free,
no-API-key-required dataset.
"""
from pathlib import Path

import pandas as pd
import requests

OURAIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"
REQUEST_HEADERS = {"User-Agent": "vfr-route-learning-project/0.1"}
DEFAULT_CACHE_PATH = Path(__file__).resolve().parents[2] / "data" / "raw" / "airports.csv"


def _ensure_cached(cache_path: Path = DEFAULT_CACHE_PATH) -> Path:
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    if not cache_path.exists():
        resp = requests.get(OURAIRPORTS_URL, headers=REQUEST_HEADERS, timeout=30)
        resp.raise_for_status()
        cache_path.write_bytes(resp.content)
    return cache_path


_TABLE_CACHE: dict = {}


def load_airports(cache_path: Path = DEFAULT_CACHE_PATH) -> pd.DataFrame:
    """Load the full OurAirports table (downloads + caches on first call).

    Held in memory after the first read. vfr.weather looks up the nearest
    winds-aloft station through this, once per nav-log leg, and re-parsing
    an 80,000-row CSV each time was a measurable part of what made
    planning a route slow. Callers must treat the frame as read-only.
    """
    path = _ensure_cached(cache_path)
    key = (str(path), path.stat().st_mtime)
    if key not in _TABLE_CACHE:
        _TABLE_CACHE[key] = pd.read_csv(path, low_memory=False)
    return _TABLE_CACHE[key]


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
    return {
        "ident": row["ident"],
        "name": row["name"],
        "lat": float(row["latitude_deg"]),
        "lon": float(row["longitude_deg"]),
        "municipality": row.get("municipality", ""),
        "region": row.get("iso_region", ""),
    }
