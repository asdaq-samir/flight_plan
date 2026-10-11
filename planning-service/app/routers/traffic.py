"""Traffic near a point, for the map (vfr.traffic): the airplanes ADS-B
receivers hear there now, from adsb.lol's open data."""
from fastapi import APIRouter, HTTPException, Path, Query
from vfr import traffic

from ..schemas import FlightDetail, FlightRoute, Traffic, TrafficFound

router = APIRouter()


@router.get("/api/traffic", response_model=Traffic)
def traffic_near(
    lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180),
    radius: float = Query(default=25, gt=0, le=250, description="Nautical miles"),
) -> Traffic:
    """The airplanes in the air within `radius` nm of a point (at most 60),
    from adsb.lol (Open Database License 1.0), and how many seconds old
    the answer is: for knowing what is about, not for avoiding it. A 503
    where adsb.lol has not answered for a minute."""
    try:
        found = traffic.near(lat, lon, radius)
    except traffic.TrafficUnavailable as err:
        raise HTTPException(503, "Traffic isn't available right now: adsb.lol has not answered for a minute.") from err
    return Traffic(**found)


@router.get("/api/traffic/find", response_model=TrafficFound)
def traffic_find(q: str = Query(min_length=2, max_length=12, description="Callsign, registration or ICAO address")) -> TrafficFound:
    """The airplanes in the air a pilot names -- UAL2088, N174HA, a0b7d8 --
    to track one. A 503 where adsb.lol cannot be asked now."""
    try:
        return TrafficFound(aircraft=traffic.find(q))
    except traffic.TrafficUnavailable as err:
        raise HTTPException(503, "Traffic isn't available right now: adsb.lol could not be asked.") from err


@router.get("/api/traffic/flight/{hex_id}", response_model=FlightDetail)
def traffic_flight(hex_id: str = Path(pattern=r"^~?[0-9a-fA-F]{6}$")) -> FlightDetail:
    """An airplane being tracked: what it is, the field it took off from
    and its track today (vfr.traffic.flight); no track where its trace
    cannot be had."""
    return FlightDetail(**traffic.flight(hex_id))


@router.get("/api/traffic/route", response_model=FlightRoute | None)
def traffic_route(
    callsign: str = Query(min_length=2, max_length=10),
    lat: float | None = Query(default=None, ge=-90, le=90), lon: float | None = Query(default=None, ge=-180, le=180),
) -> FlightRoute | None:
    """The route a flight number is scheduled to fly -- TJSJ to KORD for
    UAL2088 -- and whether the airplane at lat/lon is on or near it, from
    Virtual Radar Server's route database (CC0); null for a callsign that
    is not an airline's flight number or one it does not know; a 503 where
    the database could not be asked. Not the
    flight plan filed for today's flight."""
    try:
        found = traffic.route(callsign, lat, lon)
    except traffic.TrafficUnavailable as err:
        raise HTTPException(503, "The route isn't available right now: the route database could not be asked.") from err
    return FlightRoute(**found) if found else None
