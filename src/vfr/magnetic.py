"""Magnetic variation (declination), for converting true course/heading to
magnetic in the dead-reckoning nav-log math (vfr.navlog). From NOAA NCEI's
public World Magnetic Model calculator -- no local geomagnetic model
bundled, same "hit the authoritative live source" pattern as vfr.weather/
vfr.faa_data.

Sign convention (matches NOAA's own): positive = easterly variation,
negative = westerly. To go from true to magnetic: magnetic = true -
declination (this falls out of "east is least, west is best" automatically
once the sign is applied consistently -- see vfr.navlog.magnetic_heading_deg).

Declination changes slowly (a fraction of a degree per year), so unlike
vfr.weather's live conditions, this is cached to disk indefinitely, same
pattern as vfr.elevation.
"""
import csv
import time
from pathlib import Path

import requests

DECLINATION_URL = "https://www.ngdc.noaa.gov/geomag-web/calculators/calculateDeclination"
REQUEST_HEADERS = {"User-Agent": "vfr-route-learning-project/0.1"}
DEFAULT_CACHE_PATH = Path(__file__).resolve().parents[2] / "data" / "raw" / "magnetic_variation_cache.csv"


def _fetch_declination_deg(lat: float, lon: float, retries: int = 3) -> float:
    params = {"lat1": lat, "lon1": lon, "resultFormat": "json", "key": "zNEw7"}
    last_err = None
    for attempt in range(retries):
        try:
            resp = requests.get(DECLINATION_URL, params=params, headers=REQUEST_HEADERS, timeout=30)
            resp.raise_for_status()
            return float(resp.json()["result"][0]["declination"])
        except (requests.RequestException, KeyError, IndexError, ValueError, TypeError) as err:
            last_err = err
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"NOAA declination query failed for ({lat}, {lon}) after {retries} attempts") from last_err


def _load_cache(cache_path: Path) -> dict:
    if not cache_path.exists():
        return {}
    with cache_path.open() as f:
        return {(round(float(r["lat"]), 2), round(float(r["lon"]), 2)): float(r["declination_deg"]) for r in csv.DictReader(f)}


def _save_cache(cache: dict, cache_path: Path) -> None:
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with cache_path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["lat", "lon", "declination_deg"])
        for (lat, lon), declination in cache.items():
            writer.writerow([lat, lon, declination])


def magnetic_variation_deg(lat: float, lon: float, cache_path: Path = DEFAULT_CACHE_PATH) -> float:
    """Magnetic declination at (lat, lon), positive east / negative west.
    Cached to disk keyed by lat/lon rounded to ~1km -- plenty of precision
    for a value that varies smoothly over tens of miles.
    """
    cache = _load_cache(cache_path)
    key = (round(lat, 2), round(lon, 2))
    if key not in cache:
        cache[key] = _fetch_declination_deg(lat, lon)
        _save_cache(cache, cache_path)
    return cache[key]
