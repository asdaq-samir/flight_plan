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
import io
import math
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import requests
from cachetools import LRUCache
from PIL import Image

from .geo import destination_point
from .retry import with_retries
from .routecsv import locked, write_rows

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


def _save_cache(fetched: dict, cache_path: Path) -> None:
    """Adds `fetched` to the file: read again under its lock and written
    whole beside it, then renamed over it. It was rewritten in place from
    the copy read before the lookups -- two requests at once dropped each
    other's points, and a reader mid-write met half a file."""
    with locked(cache_path):
        cache = {**_load_cache(cache_path), **fetched}
        write_rows(cache_path, ["lat", "lon", "elevation_m"], (
            {"lat": lat, "lon": lon, "elevation_m": elev} for (lat, lon), elev in cache.items()
        ))


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
        fetched = _fetch_many(to_fetch, max_workers)
        cache.update(fetched)
        _save_cache(fetched, cache_path)

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


# One point's ground at once, for a tap on the chart (vfr.airspace_at):
# EPQS took 4 to 8 s a point, the elevation tiles AWS publishes
# (Terrain Tiles, from USGS 3DEP and SRTM) a third of a second for a
# tile ten kilometres across, then nothing. Zoom 12: about 38 m a pixel,
# well inside what an AGL floor needs.
TERRAIN_TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
TERRAIN_TILE_ZOOM = 12
TERRAIN_TILE_DIR = Path(__file__).resolve().parents[2] / "data" / "raw" / "terrain-tiles"
_TERRAIN_TILES: LRUCache = LRUCache(maxsize=64)
_TERRAIN_LOCK = threading.Lock()


def _terrain_tile(z: int, x: int, y: int) -> np.ndarray:
    """A terrarium tile's heights in metres, from disk or fetched once."""
    with _TERRAIN_LOCK:
        held = _TERRAIN_TILES.get((z, x, y))
    if held is not None:
        return held
    path = TERRAIN_TILE_DIR / str(z) / str(x) / f"{y}.png"
    if path.exists():
        data = path.read_bytes()
    else:
        resp = requests.get(TERRAIN_TILE_URL.format(z=z, x=x, y=y), headers=REQUEST_HEADERS, timeout=20)
        resp.raise_for_status()
        data = resp.content
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    rgb = np.asarray(Image.open(io.BytesIO(data)).convert("RGB")).astype(np.float64)
    heights = rgb[:, :, 0] * 256 + rgb[:, :, 1] + rgb[:, :, 2] / 256 - 32768
    with _TERRAIN_LOCK:
        _TERRAIN_TILES[(z, x, y)] = heights
    return heights


def ground_m(lat: float, lon: float, zoom: int = TERRAIN_TILE_ZOOM) -> float:
    """The ground's height at a point, in metres, from the terrain tiles.
    Raises requests.RequestException where they cannot be fetched."""
    n = 2 ** zoom
    fx = (lon + 180.0) / 360.0 * n
    fy = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    x, y = int(fx), int(fy)
    heights = _terrain_tile(zoom, x, y)
    size = heights.shape[0]
    col = min(size - 1, int((fx - x) * size))
    row = min(size - 1, int((fy - y) * size))
    return float(heights[row, col])
