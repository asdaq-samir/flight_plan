"""Airports as places on the map, the way a maps app has places: the
fields in view, for the chart's own airport symbols to be tapped, and
one field's card -- its name, the airspace over it, its runways and
radio, and the weather there now.

Everything here is already in memory on this side: the OurAirports
tables are read once per process (vfr.airports), the airspace polygons
are parsed once at startup (vfr.airspace), and the METARs are the
national cache vfr.weather keeps for minutes at a time. A card costs a
few table lookups and a point-in-polygon test.
"""
from fastapi import APIRouter, HTTPException, Query
from vfr import airports, airspace, altitude, weather

from ..schemas import AirportPlace, AirportsInView

router = APIRouter()


@router.get("/api/airports/in-view", response_model=AirportsInView)
def airports_in_view(
    south: float = Query(ge=-90, le=90), west: float = Query(ge=-180, le=180),
    north: float = Query(ge=-90, le=90), east: float = Query(ge=-180, le=180),
    limit: int = Query(default=300, ge=1, le=1000),
) -> AirportsInView:
    """The landing fields inside the map's view, the biggest first --
    at most `limit` of them, since a whole state holds thousands and the
    map only lays a tap target over each -- with each one's flight
    category from its METAR, for a weather chip on the ones that report.
    The METARs are the national cache already in memory; with the
    weather service out the fields come back without, as fields with no
    station do."""
    if south > north or west > east:
        raise HTTPException(422, "The box's south is above its north, or its west east of its east.")
    places = airports.places_in(south, west, north, east, limit)
    try:
        metars = weather.metar_for_idents([p["source_ident"] for p in places])
    except weather.WeatherServiceError:
        metars = {}
    return {"airports": [
        {**p, "flight_category": (metars.get(p["source_ident"]) or {}).get("flight_category")} for p in places
    ]}


@router.get("/api/airport/{ident}", response_model=AirportPlace)
def airport_place(ident: str) -> AirportPlace:
    """One US airport's card, by any ident it goes by (C81, KC81, KDLH).

    `airspace_class` is the class of the controlled airspace reaching
    the surface at the field (B, C or D), None where none does.
    `towered` is whether it lists a tower frequency. A field with no
    reporting station has no `metar`; `weather_unavailable` is set only
    when the weather service could not be asked."""
    place = airports.find_place(ident)
    if place is None:
        raise HTTPException(404, f"No US airport goes by {ident.strip().upper()!r}.")
    source = place["source_ident"]
    frequencies = airports.get_frequencies(source)
    shp_path = airspace.ensure_class_airspace_shapefile(altitude.DEFAULT_FAA_CACHE_DIR)
    unavailable = False
    try:
        metar = weather.metar_for_idents([source]).get(source)
    except weather.WeatherServiceError:
        metar, unavailable = None, True
    return {
        **{key: value for key, value in place.items() if key != "source_ident"},
        "airspace_class": airspace.surface_class_at(place["lat"], place["lon"], shp_path),
        "towered": any(f["type"] == "TWR" for f in frequencies),
        "runways": [r for r in airports.get_runways(source) if not r["closed"]],
        "frequencies": frequencies,
        "metar": metar,
        "weather_unavailable": unavailable,
    }
