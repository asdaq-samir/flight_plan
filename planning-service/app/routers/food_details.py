"""A restaurant's pictures, stars and reviews for the map's fly-in food,
at the owner's ask ("Can we get images, and ratings, and reviews for these
listings?", 2026-10-26; Google Places their pick), from Google's Places
API (New) with the deployment's key.

One Text Search a restaurant, biased to a few hundred metres round where
Overture places it, asking only the fields shown (Google bills by the
fields asked): its id, name, stars and their count, up to three reviews
and three photos, and its Maps link. Each photo's address is asked for
once (`skipHttpRedirect`), so the device fetches the picture from Google
itself. Nothing is kept: Google's terms allow keeping a place's id alone,
and the page asks again each time it is opened.
"""
from __future__ import annotations

import logging
import os

import requests
from fastapi import APIRouter, HTTPException, Query

from ..schemas import FoodDetails

log = logging.getLogger(__name__)

router = APIRouter()

SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
#: Only what the card shows, so the search is billed as no more.
FIELDS = ",".join([
    "places.id", "places.displayName", "places.rating", "places.userRatingCount",
    "places.reviews", "places.photos", "places.googleMapsUri", "places.location",
])
#: How far round Overture's point Google's place is looked for, metres:
#: a field's diner is its building, Overture's point and Google's a few
#: score metres apart.
BIAS_M = 300.0
MOST_PHOTOS = 3
MOST_REVIEWS = 3
TIMEOUT_S = 8.0
#: How far Google's place may be from Overture's and still be the same
#: restaurant, metres: a field's buildings and car park.
NEAR_M = 1000.0


def _metres(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres (haversine; a short hop, so plenty)."""
    from math import asin, cos, radians, sin, sqrt
    dlat, dlon = radians(lat2 - lat1), radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * 6_371_000 * asin(sqrt(a))


def _key() -> str:
    """A server key for the Places API: its own where the deployment has
    one, else the Maps key (a browser key restricted to the site's address
    refuses a server's call; Google Cloud says so in its error)."""
    return (os.environ.get("GOOGLE_PLACES_API_KEY") or os.environ.get("GOOGLE_MAPS_API_KEY") or "").strip()


def _photo_uri(name: str, key: str) -> str | None:
    """A photo's own address on Google's servers, for the device to fetch."""
    try:
        resp = requests.get(
            f"https://places.googleapis.com/v1/{name}/media",
            params={"maxWidthPx": 480, "skipHttpRedirect": "true", "key": key}, timeout=TIMEOUT_S,
        )
        resp.raise_for_status()
        return resp.json().get("photoUri")
    except (requests.RequestException, ValueError):
        log.warning("Places photo %s could not be had", name, exc_info=True)
        return None


@router.get("/api/food-details", response_model=FoodDetails)
def food_details(
    name: str = Query(min_length=1, max_length=120),
    lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180),
) -> FoodDetails:
    """A restaurant's stars, reviews and photos from Google Places, by its
    name where Overture places it; a 404 where the deployment has no key,
    or Google finds no place there, and the card shows the row as it is."""
    key = _key()
    if not key:
        raise HTTPException(404, "No Google Places key is set for this deployment.")
    try:
        resp = requests.post(
            SEARCH_URL, timeout=TIMEOUT_S,
            headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS},
            json={"textQuery": name, "maxResultCount": 1,
                  "locationBias": {"circle": {"center": {"latitude": lat, "longitude": lon}, "radius": BIAS_M}}},
        )
        resp.raise_for_status()
        places = resp.json().get("places") or []
    except (requests.RequestException, ValueError) as err:
        log.warning("Places search for %r failed: %s", name, err)
        raise HTTPException(502, "Google Places could not be reached.") from err
    # The bias only leans the search: "Subway" can come back from the next
    # town, its stars then shown on this field's row. Not further than
    # NEAR_M from where Overture places it.
    place = places[0] if places else None
    at = (place or {}).get("location") or {}
    if place and at.get("latitude") is not None and at.get("longitude") is not None:
        if _metres(lat, lon, at["latitude"], at["longitude"]) > NEAR_M:
            place = None
    if place is None:
        raise HTTPException(404, f"Google Places has no {name} there.")
    photos = []
    for photo in (place.get("photos") or [])[:MOST_PHOTOS]:
        uri = _photo_uri(photo["name"], key)
        if uri:
            # Each photo's own credit, as Google's terms ask it shown.
            credit = ", ".join(a.get("displayName", "") for a in photo.get("authorAttributions") or [] if a.get("displayName"))
            photos.append({"url": uri, "credit": credit or None})
    reviews = [
        {
            "author": (r.get("authorAttribution") or {}).get("displayName") or "A Google user",
            "rating": r.get("rating"),
            "text": ((r.get("originalText") or r.get("text") or {}).get("text") or "").strip(),
            "when": r.get("relativePublishTimeDescription"),
        }
        for r in (place.get("reviews") or [])[:MOST_REVIEWS]
    ]
    return FoodDetails(
        place_id=place.get("id"), name=(place.get("displayName") or {}).get("text") or name,
        rating=place.get("rating"), ratings=place.get("userRatingCount"),
        photos=photos, reviews=[r for r in reviews if r["text"]], maps_url=place.get("googleMapsUri"),
    )
