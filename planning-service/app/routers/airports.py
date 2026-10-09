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
from fastapi.responses import FileResponse
from vfr import airports, airspace, altitude, faa_data, fixes, pattern, places, publications, remarks, runway_wind, weather

from ..common import DIAGRAM_CACHE
from ..schemas import AirportPlace, AirportsInView, NearestAirports, WaypointsInView

router = APIRouter()


def _military(place: dict) -> str | None:
    """Whether the armed services own the field (vfr.faa_data), by the
    ident pilots use or OurAirports' own (KDLH, C81, KC81)."""
    owned = faa_data.military_fields(altitude.DEFAULT_FAA_CACHE_DIR)
    return owned.get(place["ident"].upper()) or owned.get(place.get("source_ident", "").upper())


@router.get("/api/airports/in-view", response_model=AirportsInView)
def airports_in_view(
    south: float = Query(ge=-90, le=90), west: float = Query(ge=-180, le=180),
    north: float = Query(ge=-90, le=90), east: float = Query(ge=-180, le=180),
    limit: int = Query(default=300, ge=1, le=1000),
    reporting: bool = False,
) -> AirportsInView:
    """The landing fields inside the map's view, the ones that report
    first and then the biggest -- at most `limit` of them, since a whole
    state holds thousands and the map only lays a tap target over each --
    with each one's flight category from its METAR, for a weather chip on
    the ones that report: the limit drops small fields with nothing to
    show, never a chip a pilot saw a zoom further out.
    The METARs are the national cache already in memory; with the
    weather service out the fields come back without, as fields with no
    station do. With `reporting`, only the fields that report, before
    the limit: what the map asks once for a whole route's box, so its
    chips are there before the pilot zooms in on any of it."""
    if south > north or west > east:
        raise HTTPException(422, "The box's south is above its north, or its west east of its east.")
    try:
        stations = weather.reporting_idents()
    except weather.WeatherServiceError:
        stations = set()
    if reporting:
        places = airports.places_in(south, west, north, east, limit, only=stations)
    else:
        places = airports.places_in(south, west, north, east, limit, first=stations)
    try:
        metars = weather.metar_for_idents([p["source_ident"] for p in places])
    except weather.WeatherServiceError:
        metars = {}
    return {"airports": [
        {**p, "flight_category": (metars.get(p["source_ident"]) or {}).get("flight_category"), "military": _military(p)}
        for p in places
    ]}


@router.get("/api/airports/nearest", response_model=NearestAirports)
def nearest_airports(
    lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180),
    limit: int = Query(default=10, ge=1, le=25),
) -> NearestAirports:
    """The landing fields nearest a position -- own ship's, for the map's
    Nearest -- the nearest first: how far and which way, each one's
    longest open runway and its flight category where it reports."""
    found = airports.nearest(lat, lon, limit)
    try:
        metars = weather.metar_for_idents([p["source_ident"] for p in found])
    except weather.WeatherServiceError:
        metars = {}
    out = []
    for p in found:
        lengths = [r["length_ft"] for r in airports.get_runways(p["source_ident"]) if not r["closed"] and r["length_ft"]]
        out.append({
            **p, "longest_runway_ft": max(lengths) if lengths else None,
            "flight_category": (metars.get(p["source_ident"]) or {}).get("flight_category"), "military": _military(p),
        })
    return {"airports": out}


@router.get("/api/waypoints/in-view", response_model=WaypointsInView)
def waypoints_in_view(
    south: float = Query(ge=-90, le=90), west: float = Query(ge=-180, le=180),
    north: float = Query(ge=-90, le=90), east: float = Query(ge=-180, le=180),
    limit: int = Query(default=500, ge=1, le=1000),
) -> WaypointsInView:
    """The VFR waypoints inside the map's view (vfr.fixes), at most
    `limit`: the magenta flags the sectional prints round busy airspace,
    for the map to mark each with a diamond a pilot can tap and route
    through. GPS waypoints and the rest of NASR's fixes are left out:
    they are not on a VFR chart."""
    if south > north or west > east:
        raise HTTPException(422, "The box's south is above its north, or its west east of its east.")
    found = sorted((f for f in fixes.within(south, west, north, east) if f["vfr"]), key=lambda f: f["ident"])
    return {"waypoints": [
        {"ident": f["ident"], "lat": f["lat"], "lon": f["lon"], "description": places.describe(f["lat"], f["lon"])}
        for f in found[:limit]
    ]}


def _notes(ident: str) -> dict:
    """The lighting and mic-click remarks (vfr.remarks), by the FAA's own
    identifier: KRFD's are RFD's, as are Alaska's and Hawaii's P-idents'.
    None where the remarks file cannot be had: a card without them."""
    candidates = [ident[1:], ident] if len(ident) == 4 and ident[0] in "KP" else [ident]
    try:
        for faa_id in candidates:
            notes = remarks.airport_notes(faa_id)
            if notes["lighting"] or notes["radio"]:
                break
    except (OSError, RuntimeError):
        return {}
    return {
        "lighting": notes["lighting"], "radio_notes": notes["radio"],
        "standard_keying": notes["pilot_controlled"] and not notes["explicit_clicks"],
    }


@router.get("/api/airport/{ident}", response_model=AirportPlace)
def airport_place(ident: str) -> AirportPlace:
    """One US airport's card, by any ident it goes by (C81, KC81, KDLH).

    `airspace_class` is the class of the airspace at the surface at the
    field: B, C or D, E in a Class E surface area, G where the ground is
    uncontrolled (vfr.airspace.surface_class_at).
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
        "military": _military(place),
        "towered": any(f["type"] == "TWR" for f in frequencies),
        **_notes(place["ident"]),
        "pattern": pattern.pattern_at(place["ident"], place["elevation_ft"]),
        "runways": pattern.with_traffic(runway_wind.with_winds(
            [r for r in airports.get_runways(source) if not r["closed"]], metar, place["lat"], place["lon"]),
            place["ident"], place["lat"], place["lon"]),
        "frequencies": frequencies,
        "metar": metar,
        "weather_unavailable": unavailable,
        # Its phone and street address, for the card's Call and Address.
        **faa_data.airport_contact(place["ident"], altitude.DEFAULT_FAA_CACHE_DIR),
        "airport_diagram_url": publications.airport_diagram_url(place["ident"]),
        "airport_diagram_cycle": publications.airport_diagram_cycle(place["ident"]),
        "chart_supplement_url": publications.chart_supplement_url(place["ident"]),
    }


@router.get("/api/airport-diagram/{cycle}/{ident}.png", response_class=FileResponse,
            responses={200: {"content": {"image/png": {}}}, 404: {"description": "No diagram for the field in that cycle"}})
def airport_diagram(cycle: str, ident: str) -> FileResponse:
    """The FAA's airport diagram for the field, from the d-TPP cycle in
    force (`airport_diagram_cycle` on its card), as a picture for the card
    to show and a finger to pinch in on: its PDF drawn once and kept for
    the cycle (vfr.publications). 404 for a field with none -- most small
    ones -- for any cycle but the one in force, and while the FAA cannot
    be reached."""
    path = publications.airport_diagram_png(ident, cycle)
    if path is None:
        raise HTTPException(404, f"No airport diagram for {ident.strip().upper()!r} in d-TPP cycle {cycle}.")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": DIAGRAM_CACHE})
