"""The weather drawn on the map (wingtip.weather_map): the SIGMETs and
G-AIRMETs, the pilot reports and the winds aloft in the part of the chart
in sight, at the owner's pick of the canvas's map weather (2026-10-20)."""
import time
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from wingtip import weather_map

from ..planning import forecast_hour_for
from ..schemas import WeatherMap

router = APIRouter()

#: The widest box asked for at once, degrees: the lower 48 is about 25 by
#: 58, and a phone zoomed out to it asks for that.
MAX_SPAN_DEG = 70.0


@router.get("/api/weather/map", response_model=WeatherMap, response_model_by_alias=True)
def weather_on_the_map(
    south: float = Query(ge=-90, le=90), west: float = Query(ge=-180, le=180),
    north: float = Query(ge=-90, le=90), east: float = Query(ge=-180, le=180),
    at: float | None = Query(default=None, ge=0, le=4102444800, allow_inf_nan=False,
                      description="The time the advisories and winds are for, UNIX seconds; now when none"),
    altitude_ft: float | None = Query(default=None, ge=1000, le=45000, description="The winds aloft's altitude; none, no winds"),
) -> WeatherMap:
    """The SIGMETs valid at `at` and the G-AIRMETs nearest it, the PIREPs
    of the last 90 minutes up to 18,000 ft, and -- with `altitude_ft` --
    the FD stations' winds and temperatures there for the period that
    holds `at` (planning.forecast_hour_for, AC 00-45H's for-use windows),
    in the box; and when the radar mosaic was made."""
    if north < south or east < west or north - south > MAX_SPAN_DEG or east - west > MAX_SPAN_DEG:
        raise HTTPException(422, "The box is south to north and west to east, at most 70 degrees each way.")
    box = (south, west, north, east)
    when = time.time() if at is None else at
    winds = None
    if altitude_ft is not None:
        winds = weather_map.winds_in(box, altitude_ft, forecast_hour_for(datetime.fromtimestamp(when, timezone.utc)))
    return WeatherMap(
        at=when, advisories=weather_map.advisories_in(box, when), pireps=weather_map.pireps_in(box),
        winds=winds, radar_valid=weather_map.radar_valid(),
    )
