"""Traffic near a point, for the map (vfr.traffic): the airplanes ADS-B
receivers hear there now, from adsb.lol's open data."""
import datetime as dt

from fastapi import APIRouter, HTTPException, Path, Query
from vfr import traffic

from ..schemas import AircraftBases, FlightDetail, FlightRoute, PastFlight, PastFlights, Traffic, TrafficFound

router = APIRouter()


@router.get("/api/traffic", response_model=Traffic)
def traffic_near(
    lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180),
    radius: float = Query(default=25, gt=0, le=250, description="Nautical miles"),
) -> Traffic:
    """The airplanes in the air within `radius` nm of a point (at most 165),
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
    to track one; with none in the air or heard now, the FAA's record of a
    US airplane named by its N-number or address, its card opened all the
    same (`registered`). Where adsb.lol cannot be asked now, what can be
    shown all the same, `checked` false: the FAA's record of the one named,
    which needs no asking. It was a 503, which the pilot read as "Couldn't
    search" for an airplane the registry knew (N654FL, 2026-10-11)."""
    try:
        found, credit = traffic.find_credited(q)
    except traffic.TrafficUnavailable:
        return TrafficFound(aircraft=[], registered=traffic.registered(q), checked=False)
    return TrafficFound(aircraft=found, registered=None if found else traffic.registered(q), **credit)


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
    is not an airline's flight number or one it does not know. Not the
    flight plan filed for today's flight."""
    found = traffic.route(callsign, lat, lon)
    return FlightRoute(**found) if found else None


@router.get("/api/traffic/flight/{hex_id}/history", response_model=PastFlights)
def traffic_history(
    hex_id: str = Path(pattern=r"^~?[0-9a-fA-F]{6}$"),
    until: dt.date | None = Query(None, description="From this UTC day back (a date picked, or the last answer's next_until)"),
    before: float | None = Query(None, gt=0, description="Only flights that took off before this, s since 1970: the last one listed"),
) -> PastFlights:
    """An airplane's last ten flights found, newest first, as FlightAware
    lists them (vfr.traffic.history): from adsb.lol's recent trace and its
    archive of past days', about six weeks, a fortnight at a time. With
    `until` and `before`, the ones before those listed; with `until` alone,
    those on and before a day picked. A day that cannot be had now is left
    out and counted."""
    return PastFlights(**traffic.history(hex_id, until=until, before=before))


@router.get("/api/traffic/flight/{hex_id}/history/{flight_id}", response_model=PastFlight)
def traffic_past_flight(hex_id: str = Path(pattern=r"^~?[0-9a-fA-F]{6}$"), flight_id: int = Path(gt=0)) -> PastFlight:
    """One of those flights' reports, for its track log and its replay
    (vfr.traffic.past_flight); 404 where it is not one of them."""
    found = traffic.past_flight(hex_id, flight_id)
    if found is None:
        raise HTTPException(404, "No such flight of this airplane in adsb.lol's archive.")
    return PastFlight(**found)


@router.get("/api/traffic/based", response_model=AircraftBases)
def traffic_based(
    hex: str = Query(min_length=6, max_length=7 * 60, description="ICAO addresses, comma-separated, 60 at most"),
) -> AircraftBases:
    """Where each airplane is based, for the Aircraft tab's "based at"
    filter (vfr.traffic.based): the field its last flights begin and end at
    most; the ones not known yet looked up in the background, pending."""
    hexes = [h.strip() for h in hex.split(",") if h.strip()][:60]
    return AircraftBases(**traffic.based(hexes))
