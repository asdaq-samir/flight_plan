"""What a pilot landing for a break can find on the ground near a field:
somewhere to eat, somewhere to sleep, a car to hire and a flight school,
at the owner's ask for food, fuel and rest stops on a long cross-country
(2026-10-22) and for training among the map's Stops (2026-10-27).

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
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path

import requests

from . import remarks
from .config import DATA_DIR
from .geo import distance_nm
from .units import M_PER_NM

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
#: A company's registered name filed under restaurants -- "Team Advantage
#: Inc", "Kobev International Inc" at Aurora, "Tailwind Eri Llc" at Erie
#: (the owner's screenshot, 2026-10-26) -- not somewhere to eat.
_COMPANY = re.compile(r"\b(inc|llc|l\.l\.c|corp|corporation|co|ltd|lp|llp|pllc|holdings|enterprises)\.?$", re.IGNORECASE)
#: The least Overture's own confidence that a place exists as listed:
#: under it, the listings near Hays were LLCs and stale entries.
MIN_CONFIDENCE = 0.7
#: The most of each kind offered, nearest first.
MOST = {"food": 5, "lodging": 3, "cars": 2, "training": 3}

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
#: A flight school: the places theme's own category under education >
#: place_of_learning > specialty_school (Leading Edge Flying Club and ATP
#: Flight School at Chicago Executive, Citywings at Schaumburg, read from
#: the 2026-10-21.0 release). Not "specialty_school" alone, which is
#: nursing, music and language schools as well.
TRAINING = {"flight_school"}

#: Each field's answer's file name after its ident: ".6.json" since it
#: holds the flight schools too (and places to eat and schools say whether
#: they are on the field), so those kept before are read again.
KEPT_SUFFIX = ".6.json"
#: A place to eat is on the field inside Overture's outline of the airport
#: (its base theme's infrastructure, subtype airport: OpenStreetMap's
#: aerodrome); where the field has no outline, this near its reference
#: point, metres -- Pilot Pete's at Schaumburg is 199 m from it and
#: inside, the Cubano Bros across the road 13 m outside (the owner's
#: "food at the airport itself, like Pete's diner at Schaumburg",
#: 2026-10-25; 10 m of slack let the Cubano Bros in).
ON_FIELD_NO_OUTLINE_M = 250.0
#: The parts of an airport's outline that are not the airport itself.
_NOT_OUTLINE = {"taxiway", "taxilane", "runway", "stopway", "apron", "helipad", "windsock", "airport_gate", "tower", "beacon"}

_COLUMNS = ["id", "names", "taxonomy", "basic_category", "confidence", "bbox", "operating_status", "phones", "websites"]
_LOCK = threading.Lock()
_releases: dict[str, tuple[float, str]] = {}
# Eight at a time: each field is two small reads of S3, a second apart
# (its places and its outline), so the fly-in food along a route of forty
# fields was the half minute the owner waited on (2026-10-26).
_POOL = ThreadPoolExecutor(max_workers=8, thread_name_prefix="nearby")
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
def _infrastructure(release: str):
    import pyarrow.dataset as ds
    import pyarrow.fs as pfs

    fs = pfs.S3FileSystem(anonymous=True, region=REGION)
    return ds.dataset(f"{BUCKET}/release/{release}/theme=base/type=infrastructure/", filesystem=fs, format="parquet")


def _outline(lat: float, lon: float, release: str):
    """The field's outline (a shapely geometry) from Overture's airport
    infrastructure round it, None where it has none."""
    import pyarrow.dataset as ds
    import shapely

    half = 0.04
    box = ((ds.field("bbox", "xmin") >= lon - half) & (ds.field("bbox", "xmin") <= lon + half)
           & (ds.field("bbox", "ymin") >= lat - half) & (ds.field("bbox", "ymin") <= lat + half)
           & (ds.field("subtype") == "airport"))
    rows = _infrastructure(release).to_table(columns=["class", "geometry"], filter=box).to_pylist()
    shapes = [shapely.from_wkb(r["geometry"]) for r in rows if r.get("class") not in _NOT_OUTLINE and r.get("geometry")]
    shapes = [g for g in shapes if g.geom_type in ("Polygon", "MultiPolygon")]
    if not shapes:
        return None
    # The outline round the field's own point, else the nearest: a box can
    # hold a neighbour's too.
    here = shapely.Point(lon, lat)
    return min(shapes, key=lambda g: g.distance(here))


@lru_cache(maxsize=2)
def _dataset(release: str):
    # Imported here: only a card or a stop asks, and pyarrow's S3 is a
    # second of the planner's start otherwise.
    import pyarrow.dataset as ds
    import pyarrow.fs as pfs

    fs = pfs.S3FileSystem(anonymous=True, region=REGION)
    return ds.dataset(f"{BUCKET}/release/{release}/theme=places/type=place/", filesystem=fs, format="parquet")


def _kind_of(taxonomy: dict | None, basic: str | None) -> str | None:
    """"food", "lodging", "cars" or "training", or None for a place of
    none of them, by the places theme's taxonomy (its hierarchy, then its
    own category)."""
    hierarchy = (taxonomy or {}).get("hierarchy") or []
    primary = (taxonomy or {}).get("primary")
    if len(hierarchy) > 1 and hierarchy[0] == "food_and_drink" and hierarchy[1] in FOOD:
        return "food"
    if primary in CARS:
        return "cars"
    if primary in TRAINING or TRAINING & set(hierarchy):
        return "training"
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


def _on_field(outline, lat: float, lon: float, metres: float) -> bool:
    """Whether a place is at the airport itself: inside its outline."""
    if outline is None:
        return metres <= ON_FIELD_NO_OUTLINE_M
    import shapely

    return bool(outline.covers(shapely.Point(lon, lat)))


def _read(lat: float, lon: float, release: str) -> dict:
    import pyarrow.dataset as ds

    dlat = REACH_M / 111_320.0
    dlon = dlat / max(0.2, math.cos(math.radians(lat)))
    box = ((ds.field("bbox", "xmin") >= lon - dlon) & (ds.field("bbox", "xmin") <= lon + dlon)
           & (ds.field("bbox", "ymin") >= lat - dlat) & (ds.field("bbox", "ymin") <= lat + dlat))
    rows = _dataset(release).to_table(columns=_COLUMNS, filter=box).to_pylist()
    try:
        outline = _outline(lat, lon, release)
    except Exception:  # noqa: BLE001 -- pyarrow's own errors; the places stand without it
        log.warning("Overture's airport outline could not be read at %.3f,%.3f", lat, lon, exc_info=True)
        outline = None
    found: dict[str, list[dict]] = {kind: [] for kind in MOST}
    for row in rows:
        if (row.get("confidence") or 0.0) < MIN_CONFIDENCE or row.get("operating_status") in ("permanently_closed", "temporarily_closed"):
            continue
        kind = _kind_of(row.get("taxonomy"), row.get("basic_category"))
        name = ((row.get("names") or {}).get("primary") or "").strip()
        if not kind or not name or (kind == "food" and _COMPANY.search(name.rstrip(" ,"))):
            continue
        bbox = row["bbox"]
        plat, plon = (bbox["ymin"] + bbox["ymax"]) / 2, (bbox["xmin"] + bbox["xmax"]) / 2
        metres = float(distance_nm(lat, lon, plat, plon)) * M_PER_NM
        if metres > REACH_M:
            continue
        found[kind].append({
            "name": name, "kind": _words((row.get("taxonomy") or {}).get("primary") or row.get("basic_category")),
            "distance_m": round(metres), "walk_min": math.ceil(metres / WALK_M_PER_MIN) if metres <= WALK_M else None,
            "phone": (row.get("phones") or [None])[0], "website": (row.get("websites") or [None])[0],
            "lat": round(plat, 6), "lon": round(plon, 6),
            # On the field for food and schools alike: a school is the
            # field's own as its restaurant is (the Stops' Training).
            "on_field": _on_field(outline, plat, plon, metres) if kind in ("food", "training") else False,
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
    """The places to eat, sleep and hire a car and the flight schools
    within REACH_M of a field, nearest first: {"food": [...], "lodging":
    [...], "cars": [...], "training": [...]}, each
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


@lru_cache(maxsize=8192)
def courtesy_car(ident: str) -> bool:
    """Whether the FAA's remarks offer a courtesy car at the field: kept, as
    the remarks change by the cycle (40 fields' were 0.8 s a Stops list)."""
    ident = ident.strip().upper()
    faa_ids = [ident[1:], ident] if len(ident) == 4 and ident[0] in "KP" else [ident]
    try:
        return any(remarks.service_notes(faa_id)["courtesy_car"] for faa_id in faa_ids)
    except (OSError, RuntimeError):
        return False


def kept(ident: str, cache_dir: Path = CACHE_DIR) -> dict | None:
    """A field's places where they have been read for the newest release,
    without asking Overture: None where they have not (read_later)."""
    try:
        return json.loads((Path(cache_dir) / latest_release() / f"{ident.strip().upper()}{KEPT_SUFFIX}").read_text())
    except (OSError, ValueError, NearbyUnavailable):
        return None


def food_at(ident: str, cache_dir: Path = CACHE_DIR) -> bool | None:
    """Whether there is somewhere to eat at the field: a place on it, or a
    walk from it (WALK_M), as its kept places say; None where they have
    not been read yet (read_later)."""
    places = kept(ident, cache_dir)
    if places is None:
        return None
    return any(p.get("on_field") or p.get("walk_min") is not None for p in places.get("food", []))


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
