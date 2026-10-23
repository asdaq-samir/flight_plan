"""What a pilot landing for a break can find on the ground near a field:
somewhere to eat, somewhere to sleep and a car to hire, at the owner's
ask for food, fuel and rest stops on a long cross-country (2026-10-22).

The places are Overture Maps' (the places theme, CDLA Permissive 2.0:
free to use and show, with its credit), read straight from its public
Parquet files on S3 with pyarrow: a field's box of them is a few row
groups of the release, 0.3 s once the files' footers are in and 2.5 s
for the first. OpenStreetMap's Overpass was tried first and answered
504s and timeouts from every public mirror on the day (vfr.osm keeps it
for the training pipeline, where a retry can wait).

Each field's answer is kept on disk for its release, which Overture
publishes monthly: a card opened again, or a stop suggested again,
reads the file and asks nothing.
"""
from __future__ import annotations

import json
import logging
import math
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, wait
from functools import lru_cache
from pathlib import Path

import requests

from . import remarks
from .config import DATA_DIR
from .geo import distance_nm

log = logging.getLogger(__name__)

BUCKET = "overturemaps-us-west-2"
REGION = "us-west-2"
#: The bucket's own listing of its releases, newest last ("2026-10-21.0/").
RELEASES_URL = f"https://{BUCKET}.s3.amazonaws.com/?list-type=2&prefix=release/&delimiter=/"
CACHE_DIR = DATA_DIR / "raw" / "overture_places"

#: How far from the field a place is offered, metres: 8 km, about five
#: miles, a courtesy car's or a taxi's short ride into town.
REACH_M = 8000.0
#: How far is a walk, metres, and the pace it is timed at: 1.2 km at
#: 80 m a minute, fifteen minutes.
WALK_M = 1200.0
WALK_M_PER_MIN = 80.0
#: The least Overture's own confidence that a place exists as listed:
#: under it, the listings near Hays were LLCs and stale entries.
MIN_CONFIDENCE = 0.7
#: The most of each kind offered, nearest first.
MOST = {"food": 5, "lodging": 3, "cars": 2}

#: Somewhere to eat: the places theme's restaurants, casual eateries
#: (diners, cafés, delis) and coffee and juice shops -- its second level
#: under food_and_drink. Not its bars, breweries and wineries: a pilot
#: flying on may not within 8 hours of a drink (14 CFR 91.17(a)(1)).
FOOD = {"restaurant", "casual_eatery", "non_alcoholic_beverage_venue"}
#: Somewhere to sleep, under the theme's lodging: hotels and motels, inns
#: and B&Bs, and resorts (Rodeway, Fort Hays Inn are filed as those). Not
#: holiday rentals, booked ahead, nor the bare "lodging", which near Hays
#: was the hotels' holding companies.
LODGING = {"hotel", "bed_and_breakfast", "resort", "inn", "motel"}
#: A car to hire.
CARS = {"car_rental_service"}

#: Each field's answer's file name after its ident: ".2.json" since
#: places carry their websites, so those kept before are read again.
KEPT_SUFFIX = ".2.json"

#: How long a plan waits on the places near the fields it is choosing a
#: stop among (appeal_of), seconds: a field's first read is about 0.3 s once
#: the files' footers are in (warm), four at a time. Those not in by then
#: count as nothing known, and are read on and kept for the next plan.
APPEAL_BUDGET_S = 1.5

_COLUMNS = ["id", "names", "taxonomy", "basic_category", "confidence", "bbox", "operating_status", "phones", "websites"]
_LOCK = threading.Lock()
_releases: dict[str, tuple[float, str]] = {}
_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="nearby")
_READING: set[str] = set()


class NearbyUnavailable(RuntimeError):
    """Overture could not be read, nor had a field's answer been kept."""


def latest_release(timeout_s: float = 10.0) -> str:
    """The newest release's name, "2026-10-21.0", asked of the bucket once
    a day; the last one asked where the bucket cannot be reached."""
    now = time.time()
    with _LOCK:
        seen = _releases.get("latest")
        if seen and now - seen[0] < 24 * 3600:
            return seen[1]
    try:
        response = requests.get(RELEASES_URL, timeout=timeout_s)
        response.raise_for_status()
        names = re.findall(r"<Prefix>release/([0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+)/</Prefix>", response.text)
        if not names:
            raise NearbyUnavailable("Overture's release listing named no release")
        release = max(names)
    except (requests.RequestException, NearbyUnavailable) as err:
        if seen:
            return seen[1]
        kept = sorted(p.name for p in CACHE_DIR.glob("*") if p.is_dir()) if CACHE_DIR.exists() else []
        if kept:
            return kept[-1]
        raise NearbyUnavailable(f"Overture's releases could not be listed: {err}") from err
    with _LOCK:
        _releases["latest"] = (now, release)
    return release


@lru_cache(maxsize=2)
def _dataset(release: str):
    # Imported here: only a card or a stop asks, and pyarrow's S3 is a
    # second of the planner's start otherwise.
    import pyarrow.dataset as ds
    import pyarrow.fs as pfs

    fs = pfs.S3FileSystem(anonymous=True, region=REGION)
    return ds.dataset(f"{BUCKET}/release/{release}/theme=places/type=place/", filesystem=fs, format="parquet")


def _kind_of(taxonomy: dict | None, basic: str | None) -> str | None:
    """"food", "lodging" or "cars", or None for a place of none of them,
    by the places theme's taxonomy (its hierarchy, then its own category)."""
    hierarchy = (taxonomy or {}).get("hierarchy") or []
    primary = (taxonomy or {}).get("primary")
    if len(hierarchy) > 1 and hierarchy[0] == "food_and_drink" and hierarchy[1] in FOOD:
        return "food"
    if primary in CARS:
        return "cars"
    if hierarchy[:1] == ["lodging"] and (basic in LODGING or primary in LODGING):
        return "lodging"
    return None


def _words(category: str | None) -> str:
    """The theme's category in words: "american_restaurant" "American
    restaurant", "car_rental_service" "Car rental"."""
    if not category:
        return ""
    text = category.removesuffix("_service").replace("_", " ")
    return text[:1].upper() + text[1:]


def _read(lat: float, lon: float, release: str) -> dict:
    import pyarrow.dataset as ds

    dlat = REACH_M / 111_320.0
    dlon = dlat / max(0.2, math.cos(math.radians(lat)))
    box = ((ds.field("bbox", "xmin") >= lon - dlon) & (ds.field("bbox", "xmin") <= lon + dlon)
           & (ds.field("bbox", "ymin") >= lat - dlat) & (ds.field("bbox", "ymin") <= lat + dlat))
    rows = _dataset(release).to_table(columns=_COLUMNS, filter=box).to_pylist()
    found: dict[str, list[dict]] = {kind: [] for kind in MOST}
    for row in rows:
        if (row.get("confidence") or 0.0) < MIN_CONFIDENCE or row.get("operating_status") in ("permanently_closed", "temporarily_closed"):
            continue
        kind = _kind_of(row.get("taxonomy"), row.get("basic_category"))
        name = ((row.get("names") or {}).get("primary") or "").strip()
        if not kind or not name:
            continue
        bbox = row["bbox"]
        plat, plon = (bbox["ymin"] + bbox["ymax"]) / 2, (bbox["xmin"] + bbox["xmax"]) / 2
        metres = float(distance_nm(lat, lon, plat, plon)) * 1852.0
        if metres > REACH_M:
            continue
        found[kind].append({
            "name": name, "kind": _words((row.get("taxonomy") or {}).get("primary") or row.get("basic_category")),
            "distance_m": round(metres), "walk_min": math.ceil(metres / WALK_M_PER_MIN) if metres <= WALK_M else None,
            "phone": (row.get("phones") or [None])[0], "website": (row.get("websites") or [None])[0],
            "lat": round(plat, 6), "lon": round(plon, 6),
        })
    out = {}
    for kind, places in found.items():
        # One of a chain listed twice (two Hertz desks) kept once, the nearer.
        seen, kept = set(), []
        for place in sorted(places, key=lambda p: p["distance_m"]):
            if place["name"].lower() in seen:
                continue
            seen.add(place["name"].lower())
            kept.append(place)
        out[kind] = kept[:MOST[kind]]
    return out


def around(ident: str, lat: float, lon: float, cache_dir: Path = CACHE_DIR) -> dict:
    """The places to eat, sleep and hire a car within REACH_M of a field,
    nearest first: {"food": [...], "lodging": [...], "cars": [...]}, each
    with its name, its kind in words, how far (metres, and the minutes'
    walk where it is a walk), its phone and where. Raises
    NearbyUnavailable where Overture cannot be read and the field's
    answer was never kept."""
    release = latest_release()
    path = Path(cache_dir) / release / f"{ident.strip().upper()}{KEPT_SUFFIX}"
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        pass
    try:
        found = _read(lat, lon, release)
    except Exception as err:  # pyarrow's own errors are OSError and ArrowException, among others
        kept = sorted(Path(cache_dir).glob(f"*/{ident.strip().upper()}{KEPT_SUFFIX}"))
        if kept:
            return json.loads(kept[-1].read_text())
        raise NearbyUnavailable(f"Overture's places could not be read for {ident}: {err}") from err
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(found))
    except OSError:
        log.warning("Could not keep %s's nearby places", ident, exc_info=True)
    return found


def warm() -> None:
    """Every release file's footer read once, at the planner's start: the
    first field's places were 2.5 s, the next 0.3 s. A box of open ocean
    (0, 0), so nothing is kept."""
    _read(0.0, 0.0, latest_release())


def courtesy_car(ident: str) -> bool:
    """Whether the FAA's remarks offer a courtesy car at the field."""
    ident = ident.strip().upper()
    faa_ids = [ident[1:], ident] if len(ident) == 4 and ident[0] in "KP" else [ident]
    try:
        return any(remarks.service_notes(faa_id)["courtesy_car"] for faa_id in faa_ids)
    except (OSError, RuntimeError):
        return False


def appeal(found: dict | None, courtesy_car: bool) -> int:
    """How good a field is to stop at for a meal or a rest, 0 to 4: food
    near it (1), and a walk away (2 more), and a way into town -- a
    courtesy car, or a car to hire a walk away (1)."""
    food, cars = (found or {}).get("food") or [], (found or {}).get("cars") or []
    score = 1 if food else 0
    if any(p.get("walk_min") is not None for p in food):
        score += 2
    if courtesy_car or any(p.get("walk_min") is not None for p in cars):
        score += 1
    return score


def appeal_of(fields: list[tuple[str, float, float]], budget_s: float = APPEAL_BUDGET_S) -> dict[str, int]:
    """Each field's appeal (ident, lat, lon), for a plan choosing among
    stops: its places read four at a time for at most `budget_s`, a field's
    not in by then counted on its courtesy car alone, and read on and kept
    for the next plan."""
    asked = {ident: _POOL.submit(around, ident, lat, lon) for ident, lat, lon in fields}
    wait(list(asked.values()), timeout=budget_s)
    out = {}
    for ident, future in asked.items():
        found = None
        if future.done() and not future.exception():
            found = future.result()
        out[ident] = appeal(found, courtesy_car(ident))
    return out


def kept(ident: str, cache_dir: Path = CACHE_DIR) -> dict | None:
    """A field's places where they have been read for the newest release,
    without asking Overture: None where they have not (read_later)."""
    try:
        return json.loads((Path(cache_dir) / latest_release() / f"{ident.strip().upper()}{KEPT_SUFFIX}").read_text())
    except (OSError, ValueError, NearbyUnavailable):
        return None


def read_later(ident: str, lat: float, lon: float) -> None:
    """A field's places read on the pool and kept, once however often it
    is asked while it is read: the map's Stops (along) asks for the
    fields not yet read and is asked again until they are."""
    key = ident.strip().upper()
    with _LOCK:
        if key in _READING:
            return
        _READING.add(key)

    def read() -> None:
        try:
            around(key, lat, lon)
        except NearbyUnavailable:
            log.warning("nearby places at %s could not be read", key)
        finally:
            with _LOCK:
                _READING.discard(key)

    _POOL.submit(read)
