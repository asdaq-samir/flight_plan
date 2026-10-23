"""Pictures of an airport for its card, at the owner's ask ("airport
photos swipe behind the airport diagram thumbnail", 2026-10-23).

- An aerial photo of every US field, from the USGS National Map's
  orthoimagery (USGSImageryOnly, public domain as the work of the US
  Government), framed on the field's runways. Kept on disk: the imagery
  is years apart, not days.
- A photo from the ground where the field's Wikipedia article has one
  (OurAirports' wikipedia_link): the article's lead image when it is on
  Wikimedia Commons, which is free to show with its photographer and
  licence credited. A file kept on Wikipedia alone is fair use, not free,
  and is not shown. About one small field in eight has one.
"""
from __future__ import annotations

import html
import json
import logging
import math
import re
import time
from pathlib import Path
from urllib.parse import unquote

import requests

from .config import DATA_DIR

log = logging.getLogger(__name__)

USGS_EXPORT = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/export"
WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
#: Wikimedia asks every client to name itself.
HEADERS = {"User-Agent": "WingtipMaps/1.0 (VFR flight planner; airport photos)"}

AERIAL_DIR = DATA_DIR / "raw" / "airport_aerials"
PHOTO_DIR = DATA_DIR / "raw" / "airport_photos"
#: The aerial's size, pixels: 3:2, sharp on a phone at three times.
AERIAL_PX = (900, 600)
#: Around the runways, a share of their extent each side, and the least
#: width a field with no surveyed ends is framed at, metres (a mile).
AERIAL_MARGIN = 0.25
AERIAL_MIN_M = 1600.0
#: How long a field's Wikipedia answer is kept, and asked again after: a
#: new photo or article is rare.
PHOTO_KEEP_S = 30 * 24 * 3600


class PhotoUnavailable(RuntimeError):
    """The aerial could not be had from the USGS."""


def aerial_box(lat: float, lon: float, ends: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    """(west, south, east, north) round the runways' ends with a margin, or
    round the field's point where none are surveyed, widened to the
    picture's 3:2 so the runways are not stretched."""
    m_lat = 111_320.0
    m_lon = m_lat * max(0.2, math.cos(math.radians(lat)))
    if ends:
        lats, lons = [e[0] for e in ends], [e[1] for e in ends]
        cy, cx = (min(lats) + max(lats)) / 2, (min(lons) + max(lons)) / 2
        w = (max(lons) - min(lons)) * m_lon * (1 + 2 * AERIAL_MARGIN)
        h = (max(lats) - min(lats)) * m_lat * (1 + 2 * AERIAL_MARGIN)
    else:
        cy, cx, w, h = lat, lon, 0.0, 0.0
    w, h = max(w, AERIAL_MIN_M), max(h, AERIAL_MIN_M * AERIAL_PX[1] / AERIAL_PX[0])
    ratio = AERIAL_PX[0] / AERIAL_PX[1]
    if w / h < ratio:
        w = h * ratio
    else:
        h = w / ratio
    dx, dy = w / 2 / m_lon, h / 2 / m_lat
    return (round(cx - dx, 6), round(cy - dy, 6), round(cx + dx, 6), round(cy + dy, 6))


def aerial(ident: str, lat: float, lon: float, ends: list[tuple[float, float]], cache_dir: Path = AERIAL_DIR) -> Path:
    """The field's aerial photo, a JPEG on disk: asked of the USGS the first
    time and kept. Raises PhotoUnavailable where it cannot be had."""
    path = Path(cache_dir) / f"{ident.strip().upper()}.jpg"
    if path.exists() and path.stat().st_size > 0:
        return path
    west, south, east, north = aerial_box(lat, lon, ends)
    try:
        response = requests.get(USGS_EXPORT, params={
            "bbox": f"{west},{south},{east},{north}", "bboxSR": 4326, "imageSR": 3857,
            "size": f"{AERIAL_PX[0]},{AERIAL_PX[1]}", "format": "jpg", "f": "image",
        }, headers=HEADERS, timeout=20)
        response.raise_for_status()
    except requests.RequestException as err:
        raise PhotoUnavailable(f"The USGS imagery could not be had for {ident}: {err}") from err
    if not response.headers.get("content-type", "").startswith("image/"):
        raise PhotoUnavailable(f"The USGS answered {ident} with {response.headers.get('content-type')!r}, not a picture")
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".part")
    partial.write_bytes(response.content)
    partial.replace(path)
    return path


def _plain(value: str | None) -> str:
    """Commons' HTML credit as words: its links and tags gone."""
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", value or ""))).strip()


def _ask_ground_photo(wikipedia_link: str) -> dict | None:
    title = unquote(wikipedia_link.rstrip("/").rsplit("/", 1)[-1]).replace("_", " ")
    pages = requests.get(WIKIPEDIA_API, params={
        "action": "query", "format": "json", "prop": "pageimages", "piprop": "name", "titles": title, "redirects": 1,
    }, headers=HEADERS, timeout=10).json().get("query", {}).get("pages", {})
    name = next((p.get("pageimage") for p in pages.values() if p.get("pageimage")), None)
    if not name:
        return None
    files = requests.get(COMMONS_API, params={
        "action": "query", "format": "json", "titles": f"File:{name}", "prop": "imageinfo",
        "iiprop": "url|extmetadata", "iiurlwidth": AERIAL_PX[0],
    }, headers=HEADERS, timeout=10).json().get("query", {}).get("pages", {})
    for page in files.values():
        # A file not on Commons comes back "missing": Wikipedia's own, fair use.
        info = (page.get("imageinfo") or [None])[0]
        if "missing" in page or not info:
            continue
        meta = info.get("extmetadata") or {}
        return {
            "url": info.get("thumburl") or info.get("url"),
            "width": int(info.get("thumbwidth") or info.get("width") or AERIAL_PX[0]),
            "height": int(info.get("thumbheight") or info.get("height") or AERIAL_PX[1]),
            "credit": _plain((meta.get("Artist") or {}).get("value")) or "Wikimedia Commons",
            "license": _plain((meta.get("LicenseShortName") or {}).get("value")),
            "source_url": info.get("descriptionurl"),
        }
    return None


def ground_photo_file(ident: str, url: str, cache_dir: Path = PHOTO_DIR) -> Path:
    """The ground photo as a JPEG on disk, fetched from Commons once and
    kept: served from the planner, as the aerial is, so the page shows it
    under its own image policy and a route kept for the air has it.
    Raises PhotoUnavailable where it cannot be had."""
    path = Path(cache_dir) / f"{ident.strip().upper()}.jpg"
    if path.exists() and path.stat().st_size > 0:
        return path
    try:
        response = requests.get(url, headers=HEADERS, timeout=20)
        response.raise_for_status()
    except requests.RequestException as err:
        raise PhotoUnavailable(f"Commons' photo could not be had for {ident}: {err}") from err
    if not response.headers.get("content-type", "").startswith("image/"):
        raise PhotoUnavailable(f"Commons answered {ident}'s photo with {response.headers.get('content-type')!r}")
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".part")
    partial.write_bytes(response.content)
    partial.replace(path)
    return path


def ground_photo(ident: str, wikipedia_link: str | None, cache_dir: Path = PHOTO_DIR) -> dict | None:
    """The field's photo from the ground, where its Wikipedia article has a
    free one: {url, credit, license, source_url}, else None. Each field's
    answer kept PHOTO_KEEP_S, a none too; where Wikipedia cannot be asked,
    None for now and asked again next time."""
    if not wikipedia_link:
        return None
    path = Path(cache_dir) / f"{ident.strip().upper()}.json"
    try:
        if time.time() - path.stat().st_mtime < PHOTO_KEEP_S:
            return json.loads(path.read_text()).get("photo")
    except (OSError, ValueError):
        pass
    try:
        photo = _ask_ground_photo(wikipedia_link)
    except (requests.RequestException, ValueError):
        log.warning("Wikipedia could not be asked for %s's photo", ident, exc_info=True)
        return None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"photo": photo}))
    except OSError:
        log.warning("Could not keep %s's photo", ident, exc_info=True)
    return photo
