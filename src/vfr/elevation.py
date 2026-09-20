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
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

from .geo import destination_point
from .retry import with_retries

EPQS_URL = "https://epqs.nationalmap.gov/v1/json"
REQUEST_HEADERS = {"User-Agent": "vfr-route-learning-project/0.1"}
DEFAULT_CACHE_PATH = Path(__file__).resolve().parents[2] / "data" / "raw" / "elevation_cache.csv"

RING_RADIUS_NM = 1.0
RING_BEARINGS_DEG = (0, 90, 180, 270)  # N, E, S, W


def _fetch_elevation_m(lat: float, lon: float, retries: int = 3) -> float:
    params = {"x": lon, "y": lat, "units": "Meters", "wkid": 4326, "includeDate": "false"}

    def attempt() -> float:
        resp = requests.get(EPQS_URL, params=params, headers=REQUEST_HEADERS, timeout=30)
        resp.raise_for_status()
        return float(resp.json()["value"])

    return with_retries(
        attempt, describe=f"EPQS query for ({lat}, {lon})", retries=retries,
        transient=(requests.RequestException, KeyError, ValueError, TypeError),
    )


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


def _fetch_many(keys: list, max_workers: int) -> dict:
    """Fetches every key's elevation, collecting all results even if some
    fail -- unlike ThreadPoolExecutor.map, which raises (abandoning every
    still-in-flight lookup) as soon as it reaches a failed one in submit
    order, discarding whatever the other workers had already fetched. A
    burst of `max_workers` concurrent requests against a public,
    unauthenticated EPQS endpoint can transiently rate-limit or drop one
    request among many that otherwise succeed (this is the terrain-floor
    analogue of the aviationweather.gov 504 fixed in vfr.altitude --
    except unlike weather, a route's terrain floor is not optional
    context, so the fix here cannot be "proceed without it"). Points that
    fail get one more attempt, serially, outside the burst, before this
    gives up -- only then does it raise, naming exactly which point(s)
    never resolved.
    """
    results: dict = {}
    failed: dict = {}
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        future_to_key = {ex.submit(_fetch_elevation_m, *k): k for k in keys}
        for future in as_completed(future_to_key):
            key = future_to_key[future]
            try:
                results[key] = future.result()
            except RuntimeError as err:
                failed[key] = err

    for key in list(failed):
        try:
            results[key] = _fetch_elevation_m(*key)
            del failed[key]
        except RuntimeError as err:
            failed[key] = err

    if failed:
        points = ", ".join(f"({lat}, {lon})" for lat, lon in failed)
        raise RuntimeError(
            f"EPQS elevation lookup failed for {len(failed)} point(s) after retry: {points}"
        ) from next(iter(failed.values()))

    return results


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
        cache.update(_fetch_many(to_fetch, max_workers))
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
