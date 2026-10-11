"""Traffic near a point, for the map (vfr.traffic): the airplanes ADS-B
receivers hear there now, from adsb.lol's open data."""
from fastapi import APIRouter, HTTPException, Query
from vfr import traffic

from ..schemas import Traffic

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
