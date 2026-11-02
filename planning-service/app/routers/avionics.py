"""What a panel GPS needs of a route's points to find them in its own
database (vfr.waypoint_codes): each one's Garmin type and ICAO region, for
the flight plan files the web app writes for the panel (lib/avionics)."""
from fastapi import APIRouter, HTTPException, Query
from vfr import waypoint_codes

from ..schemas import WaypointCode, WaypointCodes

router = APIRouter()

#: A route's points at most: Garmin's navigators take 99 (190-01007-F0),
#: and a few over that is still answered, so the file can say it is long.
MAX_POINTS = 120


@router.get("/api/waypoint-codes", response_model=WaypointCodes)
def waypoint_codes_of(
    points: str = Query(..., max_length=6000, description=(
        "The route's points in order, comma-separated, each A or F (an airport or any other point), "
        "its identifier and where the route has it: A:KDLH:46.8421:-92.1936,F:GEP:45.1455:-93.3732")),
) -> WaypointCodes:
    """Each point's Garmin type (AIRPORT, VOR, NDB, INT, INT-VRP) and ICAO
    region ("K3"), in the order asked; both null where the FAA's data has
    no point of that identifier within 5 nm of it."""
    parsed = []
    for part in points.split(","):
        bits = part.split(":")
        try:
            kind, ident, lat, lon = bits[0], bits[1], float(bits[2]), float(bits[3])
        except (IndexError, ValueError):
            raise HTTPException(422, f"not a point: {part!r} (A or F, an identifier, a latitude and a longitude)") from None
        if kind not in ("A", "F") or not 1 <= len(ident) <= 7 or not ident.isalnum():
            raise HTTPException(422, f"not a point: {part!r}")
        parsed.append((ident, kind == "A", lat, lon))
    if len(parsed) > MAX_POINTS:
        raise HTTPException(422, f"at most {MAX_POINTS} points")
    return WaypointCodes(points=[WaypointCode(**waypoint_codes.code_of(*p)) for p in parsed])
