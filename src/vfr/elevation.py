"""USGS 3DEP point elevation queries (no API key needed), used to estimate
local elevation prominence -- how much a candidate stands above its
immediate surroundings, a rough proxy for "sticks up and is easy to spot
from the air."

The public EPQS endpoint is slow and occasionally times out under a single
sequential connection, so lookups are parallelized with a thread pool and
cached to disk (keyed by lat/lon rounded to ~1m) -- a fresh run over ~230
candidates takes several minutes the first time and is instant after.
"""
import csv
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

from .geo import destination_point

EPQS_URL = "https://epqs.nationalmap.gov/v1/json"
REQUEST_HEADERS = {"User-Agent": "vfr-route-learning-project/0.1"}
DEFAULT_CACHE_PATH = Path(__file__).resolve().parents[2] / "data" / "raw" / "elevation_cache.csv"

RING_RADIUS_NM = 1.0
RING_BEARINGS_DEG = (0, 90, 180, 270)  # N, E, S, W


def _fetch_elevation_m(lat: float, lon: float, retries: int = 3) -> float:
    params = {"x": lon, "y": lat, "units": "Meters", "wkid": 4326, "includeDate": "false"}
    last_err = None
    for attempt in range(retries):
        try:
            resp = requests.get(EPQS_URL, params=params, headers=REQUEST_HEADERS, timeout=30)
            resp.raise_for_status()
            return float(resp.json()["value"])
        except (requests.RequestException, KeyError, ValueError, TypeError) as err:
            last_err = err
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"EPQS query failed for ({lat}, {lon}) after {retries} attempts") from last_err


def _load_cache(cache_path: Path) -> dict:
    if not cache_path.exists():
        return {}
    with cache_path.open() as f:
        return {
            (round(float(r["lat"]), 5), round(float(r["lon"]), 5)): float(r["elevation_m"])
            for r in csv.DictReader(f)
        }


def _save_cache(cache: dict, cache_path: Path) -> None:
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with cache_path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["lat", "lon", "elevation_m"])
        for (lat, lon), elev in cache.items():
            writer.writerow([lat, lon, elev])


def get_elevations_m(points: list, cache_path: Path = DEFAULT_CACHE_PATH, max_workers: int = 20) -> dict:
    """Look up elevation (meters) for a list of (lat, lon) points, using an
    on-disk cache so repeat notebook runs don't re-hit the network for
    points already seen. Returns {(lat, lon): elevation_m} for every input
    point (exact keys passed in, not the rounded cache keys).
    """
    cache = _load_cache(cache_path)
    keys = [(round(lat, 5), round(lon, 5)) for lat, lon in points]
    to_fetch = sorted(set(k for k in keys if k not in cache))

    if to_fetch:
        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            fetched = list(ex.map(lambda k: _fetch_elevation_m(*k), to_fetch))
        cache.update(dict(zip(to_fetch, fetched)))
        _save_cache(cache, cache_path)

    return {point: cache[key] for point, key in zip(points, keys)}


def elevation_prominence_m(
    candidates: list,
    radius_nm: float = RING_RADIUS_NM,
    bearings_deg: tuple = RING_BEARINGS_DEG,
    cache_path: Path = DEFAULT_CACHE_PATH,
) -> list:
    """For each (lat, lon) in `candidates`, return elevation at that point
    minus the mean elevation of a ring of points `radius_nm` away in
    `bearings_deg` directions. Positive means the candidate sticks up above
    its immediate surroundings (a bluff, a hill) -- a reasonable proxy for
    "easy to pick out from the air"; near-zero or negative is flat terrain
    or a low spot (which is fine for a lake, less so for a tower).
    """
    all_points = []
    for lat, lon in candidates:
        all_points.append((lat, lon))
        for bearing in bearings_deg:
            all_points.append(destination_point(lat, lon, bearing, radius_nm))

    elevations = get_elevations_m(all_points, cache_path=cache_path)

    n_ring = len(bearings_deg)
    results = []
    for i, point in enumerate(candidates):
        base = elevations[all_points[i * (n_ring + 1)]]
        ring_points = all_points[i * (n_ring + 1) + 1 : i * (n_ring + 1) + 1 + n_ring]
        ring_mean = sum(elevations[p] for p in ring_points) / n_ring
        results.append(base - ring_mean)
    return results
