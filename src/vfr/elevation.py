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

from .geo import destination_point
from .retry import with_retries
from .routecsv import locked

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
    """The file's points. A line another process is still writing at its
    end is left for the next read."""
    if not cache_path.exists():
        return {}
    cache = {}
    with cache_path.open() as f:
        for r in csv.DictReader(f):
            try:
                cache[(round(float(r["lat"]), 5), round(float(r["lon"]), 5))] = float(r["elevation_m"])
            except (TypeError, ValueError):
                continue
    return cache


# The file's points held in memory, by path, as of its last change: every
# lookup read the whole file (21,000 points, 0.7 MB, for every route) and
# every one that fetched wrote it whole again. Read again only when the
# file has changed since (another process's points).
_HELD: dict = {}
_HELD_LOCK = threading.Lock()


def _cache_of(cache_path: Path) -> dict:
    try:
        stamp = cache_path.stat().st_mtime_ns
    except OSError:
        stamp = None
    with _HELD_LOCK:
        held = _HELD.get(str(cache_path))
        if held is not None and held[0] == stamp:
            return held[1]
    cache = _load_cache(cache_path)
    with _HELD_LOCK:
        _HELD[str(cache_path)] = (stamp, cache)
    return cache


def _save_cache(fetched: dict, cache_path: Path) -> None:
    """Adds `fetched` to the file, a line a point, under its lock: two
    requests at once each add their own, and none is dropped. It was
    rewritten whole for every lookup, then whole beside it and renamed
    over it once two at once were found dropping each other's points."""
    with locked(cache_path):
        new = not cache_path.exists()
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with cache_path.open("a", newline="") as f:
            writer = csv.writer(f)
            if new:
                writer.writerow(["lat", "lon", "elevation_m"])
            writer.writerows([lat, lon, elev] for (lat, lon), elev in fetched.items())
        with _HELD_LOCK:
            held = _HELD.get(str(cache_path))
            if held is not None:
                held[1].update(fetched)
                _HELD[str(cache_path)] = (cache_path.stat().st_mtime_ns, held[1])


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


# The same heights from USGS 3DEP's 1 arc-second elevation (about 30 m),
# which EPQS answers from too -- 238.577 m at C81 from both -- read from
# the cloud-optimised GeoTIFFs USGS stages on AWS, one 1-degree tile a
# file: a few range requests a tile -- the blocks a route's points are
# in, some hundreds of kilobytes -- where EPQS took 3 to 5 s a point (a
# route's ground was 4 to 9 s of its nav log, measured 2026-10-07). Not
# the whole tile, 50 MB, for one route's few dozen points: what is read
# is kept a point at a time beside EPQS's answers (above), and a tile put
# in DEM_DIR is read from disk instead. EPQS answers whatever the tiles
# do not: a point outside them, a read that fails. Checked against EPQS
# at twelve places across the country: within 0.3 m at the airports, and
# 2.5 m lower on the summits of Mount Mitchell and Pikes Peak, where the
# 30 m cells average the top -- far inside the floor's 1,000 ft margin
# (vfr.terrain, 14 CFR 91.119), and less than the 2 nm between samples
# along the route already misses between them.
DEM_URL = "https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1/TIFF/current/{name}/USGS_1_{name}.tif"
DEM_DIR = Path(__file__).resolve().parents[2] / "data" / "raw" / "dem"


def _dem_name(lat: float, lon: float) -> str | None:
    """The 1-degree tile a point is in, by its north-west corner
    ("n43w089" for C81), or None outside the north and west, which the
    tiles' names do not cover."""
    if lat <= 0 or lon >= 0:
        return None
    return f"n{math.ceil(lat):02d}w{math.ceil(-lon):03d}"


def _dem_heights(name: str, points: list) -> dict:
    """The points' heights from one tile, in metres -- from disk where the
    tile is in DEM_DIR, else from the cloud copy. A point with no height
    there is left out, for EPQS. Empty where rasterio is not installed
    (the pipeline's images have no GDAL)."""
    try:
        import rasterio
    except ImportError:
        return {}
    path = DEM_DIR / f"USGS_1_{name}.tif"
    local = path.exists()
    source = str(path) if local else "/vsicurl/" + DEM_URL.format(name=name)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"):
        with rasterio.open(source) as ds:
            nodata = ds.nodata
            values = [float(v[0]) for v in ds.sample([(lon, lat) for lat, lon in points])]
    return {p: v for p, v in zip(points, values) if (nodata is None or v != nodata) and v > -500}


def _from_tiles(keys: list) -> dict:
    """Every key the tiles can answer, each tile read on a thread of its
    own; a tile that cannot be read answers none of its points."""
    by_tile: dict = {}
    for key in keys:
        name = _dem_name(*key)
        if name is not None:
            by_tile.setdefault(name, []).append(key)
    found: dict = {}
    if not by_tile:
        return found
    with ThreadPoolExecutor(max_workers=min(8, len(by_tile))) as ex:
        futures = [ex.submit(_dem_heights, name, tile_keys) for name, tile_keys in by_tile.items()]
        for future in as_completed(futures):
            try:
                found.update(future.result())
            except Exception:  # noqa: BLE001 -- rasterio's errors are many kinds; EPQS answers instead
                continue
    return found


def get_elevations_m(points: list, cache_path: Path = DEFAULT_CACHE_PATH, max_workers: int = 20) -> dict:
    """Look up elevation (meters) for a list of (lat, lon) points, using an
    on-disk cache so repeat notebook runs don't re-hit the network for
    points already seen. Returns {(lat, lon): elevation_m} for every input
    point (exact keys passed in, not the rounded cache keys). From the
    elevation tiles where they answer (above), and EPQS where they do not.
    """
    cache = _cache_of(cache_path)
    keys = [(round(lat, 5), round(lon, 5)) for lat, lon in points]
    to_fetch = sorted(set(k for k in keys if k not in cache))

    if to_fetch:
        fetched = _from_tiles(to_fetch)
        rest = [k for k in to_fetch if k not in fetched]
        if rest:
            fetched.update(_fetch_many(rest, max_workers))
        _save_cache(fetched, cache_path)
        cache = {**cache, **fetched}

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
    # Pillow only here, where a tile is decoded: the planner's airspace
    # column is its one caller, and Pillow comes with the planner's chart
    # requirements. vfr.pipeline imports this module for its elevation
    # cache, in pipeline images that have no Pillow -- imported at the top,
    # it took both down at build (2026-10-05).
    from PIL import Image

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
