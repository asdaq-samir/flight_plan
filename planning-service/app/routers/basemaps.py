"""What a map can be drawn over the FAA's chart with besides its own
layers: Google's map tiles (the Map Tiles API), where the deployment has
a key for them."""
import os

from fastapi import APIRouter, HTTPException

from ..schemas import GoogleMaps

router = APIRouter()


@router.get("/api/map/google", response_model=GoogleMaps)
def google_maps() -> GoogleMaps:
    """The deployment's Google Maps Platform key for the Map Tiles API,
    for the browser's own session and tile requests (a browser key,
    restricted to this site's address in Google Cloud); a 404 where there
    is none, and the map offers no Google overlay."""
    key = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
    if not key:
        raise HTTPException(404, "No Google Maps key is set for this deployment.")
    return GoogleMaps(key=key)
