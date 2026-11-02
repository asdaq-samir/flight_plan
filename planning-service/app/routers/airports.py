"""Airports as places on the map, the way a maps app has places: the
fields in view, for the chart's own airport symbols to be tapped, and
one field's card -- its name, the airspace over it, its runways and
radio, and the weather there now.

Everything here is already in memory on this side: the OurAirports
tables are read once per process (vfr.airports), the airspace polygons
are parsed once at startup (vfr.airspace), and the METARs are the
national cache vfr.weather keeps for minutes at a time; a field with
no report of its own has the weather modelled there for the hour, from
the gridded LAMP vfr.glmp holds an hour at a time. A card costs a few
table lookups and a point-in-polygon test.
"""
import logging
from datetime import datetime, timezone

import numpy as np
from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import FileResponse
from vfr import (
    airport_photos, airports, airspace, altitude, faa_data, fixes, fuelstops, geo, geocode, glmp, nearby, pattern, places, plates,
    procedures,
    publications, remarks, runway_wind, weather,
)

from ..common import DIAGRAM_CACHE, load_route
from ..schemas import (
    AirportPhotos, AirportPlace, AirportServices, ForecastWind, AirportsInView, ChartPages, NavaidsInView, NearestAirports,
    PlacesFound,
    PlateOverlay,
    ProcedureDrawing, ProcedureList, StopFields, WaypointsInView,
)

log = logging.getLogger(__name__)

router = APIRouter()


def _owners(places: list[dict]) -> list[tuple]:
    """Each field's (military, private) from the FAA's airport file
    (vfr.faa_data), by either ident (KDLH, C81, KC81). The file's sets are
    fetched once for all the fields, not once each: with the file missing
    each fetch retries the download, and a zoomed-out map has hundreds."""
    owned = faa_data.military_fields(altitude.DEFAULT_FAA_CACHE_DIR)
    closed = faa_data.private_fields(altitude.DEFAULT_FAA_CACHE_DIR)
    return [
        (
            owned.get(p["ident"].upper()) or owned.get(p.get("source_ident", "").upper()),
            p["ident"].upper() in closed or p.get("source_ident", "").upper() in closed,
        )
        for p in places
    ]


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
    show, never a chip a pilot saw a zoom further out -- and each one's
    class of airspace at its surface, for its mark.
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
    classes = _surface_classes(places)
    return {"airports": [
        {**p, "flight_category": (metars.get(p["source_ident"]) or {}).get("flight_category"), "military": military,
         "private": private, "airspace_class": cls}
        for p, cls, (military, private) in zip(places, classes, _owners(places))
    ]}


def _surface_classes(places: list[dict]) -> list:
    """Each field's class of airspace at its surface, for its mark on the
    map (vfr.airspace.surface_classes, all of them at once); None for each
    where the FAA's airspace cannot be had, the marks drawn without it."""
    try:
        shp_path = airspace.ensure_class_airspace_shapefile(altitude.DEFAULT_FAA_CACHE_DIR)
        return airspace.surface_classes([(p["lat"], p["lon"]) for p in places], shp_path)
    except (OSError, RuntimeError):
        return [None] * len(places)


@router.get("/api/places/search", response_model=PlacesFound)
def places_search(q: str = "") -> PlacesFound:
    """Where a place typed is, for Nearest to find the fields near it
    rather than near own ship: the airports whose ident or name starts
    with it, the towns that do (the Census gazetteer), and a street
    address where it starts with a house number (the Census geocoder) --
    each with where it is (vfr.geocode)."""
    q = q.strip()
    if len(q) < 2:
        return {"places": []}
    found = []
    for row in airports.search_airports(q, limit=3):
        place = airports.find_place(row["ident"])
        if place:
            found.append({"label": f"{place['ident']} · {place['name']}", "kind": "airport", "lat": place["lat"], "lon": place["lon"]})
    found += [{**t, "kind": "town"} for t in geocode.find_towns(q)]
    found += [{**a, "kind": "address"} for a in geocode.find_addresses(q)]
    return {"places": found}


#: The one of a field's listed frequencies to show on its row: its
#: tower's where it has one, else its CTAF, else UNICOM -- OurAirports'
#: frequencies, as the card's Freq. tab lists them (vfr.airports). It is
#: a listing, not advice on whom to call: a tower open part of the day
#: hands the field to its CTAF when closed (AIM 4-1-9), and inbound to a
#: Class B or C field a pilot calls approach control first (14 CFR
#: 91.130(c), 91.131(a)). The row names the kind, so the pilot sees which.
_INBOUND = (("TWR", "TWR"), ("CTAF", "CTAF"), ("UNIC", "UNICOM"))


def _inbound_radio(frequencies: list[dict]) -> dict | None:
    """The frequency to list for a field, of its frequencies."""
    for listed, kind in _INBOUND:
        for f in frequencies:
            if f["type"] == listed and f["frequency_mhz"]:
                return {"kind": kind, "mhz": f["frequency_mhz"]}
    return None


@router.get("/api/airports/nearest", response_model=NearestAirports)
def nearest_airports(
    lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180),
    limit: int = Query(default=10, ge=1, le=25),
) -> NearestAirports:
    """The landing fields nearest a position -- own ship's, for the map's
    Nearest -- the nearest first: how far and which way, each one's
    longest open runway, a frequency listed for it, its flight category
    where it reports, and its class of airspace at the surface, as the
    map's marks have it."""
    found = airports.nearest(lat, lon, limit)
    try:
        metars = weather.metar_for_idents([p["source_ident"] for p in found])
    except weather.WeatherServiceError:
        metars = {}
    # Read once for the list, and like the weather, a list without it: the
    # frequency is on the row for convenience, the fields are the answer.
    try:
        frequencies = airports.get_frequencies_for([p["source_ident"] for p in found])
    except (OSError, RuntimeError, ValueError):
        frequencies = {}
    out = []
    for p, cls, (military, private) in zip(found, _surface_classes(found), _owners(found)):
        lengths = [r["length_ft"] for r in airports.get_runways(p["source_ident"]) if not r["closed"] and r["length_ft"]]
        out.append({
            **p, "longest_runway_ft": max(lengths) if lengths else None,
            "flight_category": (metars.get(p["source_ident"]) or {}).get("flight_category"), "military": military,
            "private": private, "airspace_class": cls, "radio": _inbound_radio(frequencies.get(p["source_ident"].upper(), [])),
        })
    return {"airports": out}


#: The most of the nearest fields looked at round the pilot: a hundred
#: miles round Chicago hold some three hundred, each's places read once.
STOP_FIELDS = 150


def _places_of(field: dict) -> dict | None:
    """A field's places to eat and flight schools at the airport, None
    while they are still to be read (read on the pool): food inside its
    outline (vfr.nearby's), as Pilot Pete's is at Schaumburg (the owner's
    "food at the airport itself", 2026-10-25), not a walk across the road;
    a school on the field or a walk from it (WALK_M, 15 minutes), as a
    school's office can be across the field's own road."""
    places = nearby.kept(field["ident"])
    if places is None:
        nearby.read_later(field["ident"], field["lat"], field["lon"])
        return None
    return {
        "food": [f for f in places.get("food") or [] if f.get("on_field")],
        "training": [t for t in places.get("training") or [] if t.get("on_field") or t.get("walk_min") is not None],
    }


def _stop(field: dict, places: dict | None) -> dict | None:
    """A field as one of the map's Stops, with what it has of the four
    kinds -- fuel, food, repair, training -- and its phone; None where it
    has none of them that is known yet. The fuel it sells and its airframe
    and engine repair are its Chart Supplement entry's (NASR's APT_BASE:
    FUEL_TYPES, AIRFRAME_REPAIR_SER_CODE and PWR_PLANT_REPAIR_SER, MAJOR or
    MINOR), its phone the manager's, else the owner's (NASR's APT_CON:
    PHONE_NO), each by its FAA or ICAO identifier (vfr.faa_data)."""
    services = faa_data.airport_services(field["ident"], altitude.DEFAULT_FAA_CACHE_DIR)
    food = (places or {}).get("food") or []
    training = (places or {}).get("training") or []
    if not (services["fuel_types"] or services["airframe_repair"] or services["powerplant_repair"] or food or training):
        return None
    return {
        "ident": field["ident"], "name": field["name"], "city": field.get("city") or None, "lat": field["lat"], "lon": field["lon"],
        "phone": faa_data.airport_contact(field["ident"], altitude.DEFAULT_FAA_CACHE_DIR)["phone"],
        "fuel_types": services["fuel_types"], "airframe_repair": services["airframe_repair"],
        "powerplant_repair": services["powerplant_repair"], "food": food, "training": training,
        "places_known": places is not None,
    }


@router.get("/api/stops/near", response_model=StopFields)
def stops_near(
    lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180),
    nm: float = Query(default=25.0, ge=5, le=250),
) -> StopFields:
    """The public fields round a position with fuel, food, repair or a
    flight school, nearest first, for the map's Stops (the owner's one
    sheet for them near the pilot and along a route, 2026-10-27), within
    `nm` (the sheet's 10, 25, 50 or 100). A field's places are Overture's
    (vfr.nearby), read on the planner's pool where they have not been and
    counted in `pending`; a field selling fuel or with a repair shop is
    listed at once, its places to come (`places_known`), and the page
    asks again until none is pending."""
    found = [p for p in airports.nearest(lat, lon, STOP_FIELDS) if p["distance_nm"] <= nm]
    out, pending = [], 0
    for p, (military, private) in zip(found, _owners(found)):
        # Not the airline airports: O'Hare's food is a smoothie in the
        # terminal, past security, not a fly-in lunch (its first answer),
        # and its fuel and repair are the airlines' FBOs' at airline fees.
        if military or private or p.get("kind") == "large":
            continue
        places = _places_of(p)
        pending += places is None
        stop = _stop({**p, "city": p.get("municipality")}, places)
        if stop:
            out.append({**stop, "distance_nm": p["distance_nm"], "bearing_deg": p["bearing_deg"]})
    return StopFields(fields=out, pending=pending)


def _off_course_nm(start: tuple, end: tuple, lat: float, lon: float) -> float:
    """How far a point is off the straight course from start to end, nm:
    its least distance to the line, read every hundredth of the way."""
    t = np.linspace(0.0, 1.0, 101)
    lats = start[0] + (end[0] - start[0]) * t
    lons = start[1] + (end[1] - start[1]) * t
    return float(np.min(geo.distance_nm(lats, lons, lat, lon)))


#: How far off the course a field is offered along a route, nm: a short
#: turn off the way for lunch, the owner's pick (2026-10-26, "10-15 nm off
#: course"), where vfr.fuelstops' corridor reached 30.
STOP_OFF_COURSE_NM = 15.0


@router.get("/api/stops/along", response_model=StopFields)
def stops_along(dep: str, dest: str, stops: str = "") -> StopFields:
    """The public fields along a route with fuel, food, repair or a flight
    school, in route order, for the map's Stops while a course is drawn:
    those no more than STOP_OFF_COURSE_NM off each flight's line, each
    with its miles from its flight's departure, those it adds and how far
    off the course it is; what they have as round the pilot."""
    r = load_route(dep, dest, stops)
    flights = [(f.dep_ident, f.start, f.end) for f in r.flights]
    found = fuelstops.along(flights, skip=set(r.idents))
    out, pending = [], 0
    for field in found:
        # Not the airline airports, as round the pilot: Detroit's food is
        # past security, not a fly-in lunch (its first answer along a route).
        if (airports.find_place(field["ident"]) or {}).get("kind") == "large":
            continue
        _, start, end = flights[field["flight"]]
        # Off course first: a field too far off is not read for its places.
        off = _off_course_nm(start, end, field["lat"], field["lon"])
        if off > STOP_OFF_COURSE_NM:
            continue
        places = _places_of(field)
        pending += places is None
        stop = _stop(field, places)
        if stop:
            out.append({
                **stop, "distance_nm": field["from_nm"], "bearing_deg": 0,
                "departure": field["departure"], "added_nm": field["added_nm"], "off_nm": round(off, 1),
            })
    return StopFields(fields=out, pending=pending)


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


#: What a VOR's card shows of it (VorPin), from NAV_BASE.
VOR_FIELDS = ("ident", "name", "kind", "freq", "lat", "lon", "mag_var", "elevation_ft", "channel", "service_volume", "hours")


@router.get("/api/navaids/in-view", response_model=NavaidsInView)
def navaids_in_view(
    south: float = Query(ge=-90, le=90), west: float = Query(ge=-180, le=180),
    north: float = Query(ge=-90, le=90), east: float = Query(ge=-180, le=180),
    with_fixes: bool = Query(default=False, alias="fixes"),
    limit: int = Query(default=500, ge=1, le=2000),
) -> NavaidsInView:
    """The VORs inside the map's view, and with `fixes` the fixes of the
    low-altitude enroute chart there too (vfr.fixes), at most `limit` of
    each: the hexagons and the triangles the map draws over the chart.
    The map asks for the fixes only close in, where they do not scatter
    over the whole chart."""
    if south > north or west > east:
        raise HTTPException(422, "The box's south is above its north, or its west east of its east.")
    vors = fixes.vors_within(south, west, north, east)[:limit]
    found = fixes.enroute_fixes_within(south, west, north, east)[:limit] if with_fixes else []
    return {
        "vors": [{
            **{k: v.get(k) for k in VOR_FIELDS},
            "restricted": bool(v.get("restricted")),
            "remarks": fixes.navaid_remarks(v["ident"], v["kind"]),
        } for v in vors],
        "fixes": [{"ident": f["ident"], "lat": f["lat"], "lon": f["lon"]} for f in found],
    }


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


def _with_turf(runways: list[dict], ident: str) -> list[dict]:
    """Each runway with the part of it that is turf where the FAA's
    remarks say which (vfr.remarks.runway_turf), by the FAA's own
    identifier as `_notes` takes it, each part's end named as the runway's
    own are: C81's 06/24 the 1,000 ft from its south-west end, 06. None
    where the remarks file cannot be had."""
    try:
        turf = next((found for faa_id in pattern.faa_ids(ident) if (found := remarks.runway_turf(faa_id))), {})
    except (OSError, RuntimeError):
        return runways
    # A runway is the same either way round: OurAirports may list 24/06.
    by_ends = {frozenset(map(pattern.end_key, ends.split("/"))): parts for ends, parts in turf.items()}
    with_turf = []
    for runway in runways:
        own = {pattern.end_key(end["ident"]): end["ident"] for end in runway.get("runway_ends", [])}
        parts = by_ends.get(frozenset(map(pattern.end_key, (runway.get("ends") or "").split("/"))), [])
        with_turf.append({**runway, "turf": [{**part, "end": own.get(pattern.end_key(part["end"]), part["end"])} for part in parts]})
    return with_turf


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
    # Its own forecast, the TAF as issued, for the card's hours: none for
    # most fields, and none asked for where the weather service is out.
    taf = None
    if not unavailable:
        try:
            taf = (weather.taf_for_idents([source]).get(source) or {}).get("raw")
        except weather.WeatherServiceError:
            taf = None
    military, private = _owners([place])[0]
    # No report of its own: the nearest station's, close enough to say
    # its weather approximately (vfr.weather.nearest_report).
    nearby = None
    if metar is None and not unavailable:
        try:
            nearby = weather.nearest_report(place["lat"], place["lon"], exclude=source)
        except weather.WeatherServiceError:
            nearby = None
    # And the weather modelled at the field itself for the hour (vfr.glmp),
    # whatever the reports' service said: its own source.
    modelled = None
    if metar is None:
        try:
            modelled = glmp.at(place["lat"], place["lon"])
        except glmp.GlmpUnavailable as err:
            log.warning("modelled weather at %s: %s", place["ident"], err)
    return {
        **{key: value for key, value in place.items() if key != "source_ident"},
        "airspace_class": airspace.surface_class_at(place["lat"], place["lon"], shp_path),
        "military": military,
        "private": private,
        "towered": any(f["type"] == "TWR" for f in frequencies),
        **_notes(place["ident"]),
        "pattern": pattern.pattern_at(place["ident"], place["elevation_ft"]),
        # Calm now, the field's last wind for the runway in use.
        "runways": _with_turf(pattern.with_traffic(runway_wind.with_winds(
            [r for r in airports.get_runways(source) if not r["closed"]], metar, place["lat"], place["lon"],
            weather.recent_wind(place["ident"]) if metar and metar.get("wind_speed_kt") == 0 else None),
            place["ident"], place["lat"], place["lon"]), place["ident"]),
        "frequencies": frequencies,
        "metar": metar,
        "nearby_metar": nearby,
        "modelled_weather": modelled,
        "taf": taf,
        "weather_unavailable": unavailable,
        # Its phone and street address, for the card's Call and Address.
        **faa_data.airport_contact(place["ident"], altitude.DEFAULT_FAA_CACHE_DIR),
        "airport_diagram_url": publications.airport_diagram_url(place["ident"]),
        "airport_diagram_cycle": publications.airport_diagram_cycle(place["ident"]),
        "chart_supplement_url": publications.chart_supplement_url(place["ident"]),
        "procedures": publications.terminal_charts(place["ident"]),
    }


@router.get("/api/airport/{ident}/services", response_model=AirportServices)
def airport_services(ident: str, response: Response) -> dict:
    """What a field offers a pilot who lands there, for a stop's card: its
    fuel, fees, parking, repair and oxygen and its courtesy car from the
    FAA's airport file and remarks (vfr.faa_data.airport_services,
    vfr.remarks.service_notes), and the places to eat, sleep and hire a
    car near it (vfr.nearby). Its own request, not the card's: Overture's
    first read of a field is a second or two, which the card's weather
    and runways do not wait on."""
    place = airports.find_place(ident)
    if place is None:
        raise HTTPException(404, f"No US airport goes by {ident.strip().upper()!r}.")
    faa_ids = pattern.faa_ids(place["ident"])
    try:
        notes = next((found for faa_id in faa_ids if (found := remarks.service_notes(faa_id))["fuel"] or found["ground"]),
                     {"fuel": [], "ground": [], "courtesy_car": False})
    except (OSError, RuntimeError):
        notes = {"fuel": [], "ground": [], "courtesy_car": False}
    try:
        near = nearby.around(place["ident"], place["lat"], place["lon"])
        unavailable = False
    except nearby.NearbyUnavailable as err:
        log.warning("nearby places at %s: %s", place["ident"], err)
        near, unavailable = {}, True
    # Kept six hours by the browser: the airport file changes by the FAA's
    # 28-day cycle and the places near a field by the month, and the card
    # asked for them afresh on every opening (0.3 to 0.8 s, the 23 Oct
    # timings). Not where the places could not be had: asked again.
    if not unavailable:
        response.headers["Cache-Control"] = "public, max-age=21600"
    return {
        "ident": place["ident"],
        **faa_data.airport_services(place["ident"], altitude.DEFAULT_FAA_CACHE_DIR),
        "fuel_notes": notes["fuel"], "courtesy_car": notes["courtesy_car"], "ground_notes": notes["ground"],
        **near, "nearby_unavailable": unavailable,
    }


def _runway_ends(source: str) -> list[tuple[float, float]]:
    return [pos for r in airports.get_runways(source) if not r["closed"] for pos in (r.get("end_positions") or {}).values() if pos]


@router.get("/api/airport/{ident}/photos", response_model=AirportPhotos)
def airport_photos_of(ident: str, response: Response) -> dict:
    """The pictures an airport's card swipes through behind its diagram, at
    the owner's ask ("airport photos swipe behind the airport diagram
    thumbnail", 2026-10-23): its aerial (/api/airport-aerial, every US
    field's, from the USGS) and its Wikipedia article's photo where there
    is a free one (vfr.airport_photos)."""
    place = airports.find_place(ident)
    if place is None:
        raise HTTPException(404, f"No US airport goes by {ident.strip().upper()!r}.")
    try:
        link = airports.wikipedia_link(place["source_ident"])
    except (OSError, ValueError):
        link = None
    photo = airport_photos.ground_photo(place["ident"], link)
    # A day in the browser: the article's photo changes in years.
    response.headers["Cache-Control"] = "public, max-age=86400"
    # Served from here, as the aerial is (/api/airport-photo): the page's
    # image policy does not reach Wikimedia, and a route kept for the air
    # keeps it.
    return {"aerial_url": f"/api/planner/airport-aerial/{place['ident']}.jpg",
            "photo": photo and {**photo, "url": f"/api/planner/airport-photo/{place['ident']}.jpg"}}


@router.get("/api/airport-photo/{ident}.jpg", response_class=FileResponse,
            responses={200: {"content": {"image/jpeg": {}}}, 404: {"description": "No such field, or no free photo of it"},
                       503: {"description": "Wikimedia could not be reached"}})
def airport_photo(ident: str) -> FileResponse:
    """The field's photo from the ground (`airport_photos_of`), fetched from
    Wikimedia Commons once and kept, a week in the browser."""
    place = airports.find_place(ident)
    if place is None:
        raise HTTPException(404, f"No US airport goes by {ident.strip().upper()!r}.")
    try:
        link = airports.wikipedia_link(place["source_ident"])
    except (OSError, ValueError):
        link = None
    photo = airport_photos.ground_photo(place["ident"], link)
    if photo is None:
        raise HTTPException(404, f"No free photo of {place['ident']}.")
    try:
        path = airport_photos.ground_photo_file(place["ident"], photo["url"])
    except airport_photos.PhotoUnavailable as err:
        raise HTTPException(503, str(err)) from err
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=604800"})


@router.get("/api/airport-aerial/{ident}.jpg", response_class=FileResponse,
            responses={200: {"content": {"image/jpeg": {}}}, 404: {"description": "No such field"},
                       503: {"description": "The USGS imagery could not be had"}})
def airport_aerial(ident: str) -> FileResponse:
    """The field's aerial photo from the USGS National Map's imagery
    (public domain), framed on its runways (vfr.airport_photos.aerial):
    asked of the USGS once and kept, a week in the browser."""
    place = airports.find_place(ident)
    if place is None:
        raise HTTPException(404, f"No US airport goes by {ident.strip().upper()!r}.")
    try:
        path = airport_photos.aerial(place["ident"], place["lat"], place["lon"], _runway_ends(place["source_ident"]))
    except airport_photos.PhotoUnavailable as err:
        raise HTTPException(503, str(err)) from err
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=604800"})


@router.get("/api/airport/{ident}/forecast-wind", response_model=ForecastWind | None)
def airport_forecast_wind(ident: str, at: datetime = Query(..., description="When, ISO 8601; a naive time is UTC.")) -> dict | None:
    """The wind forecast at a field for a time -- a flight's arrival, for
    the runway it will find in use then, at the owner's pick (2026-10-20):
    its own TAF's prevailing wind, else the nearest TAF's within 30 nm.
    Null where none covers that time; a 503 where the forecasts cannot be
    had."""
    place = airports.find_place(ident)
    if place is None:
        raise HTTPException(404, f"No US airport goes by {ident.strip().upper()!r}.")
    when = (at if at.tzinfo else at.replace(tzinfo=timezone.utc)).timestamp()
    try:
        return weather.forecast_wind(place["lat"], place["lon"], when, place["source_ident"])
    except weather.WeatherServiceError as err:
        raise HTTPException(503, f"The forecasts could not be had: {err}") from err


@router.get("/api/airport/{ident}/procedures", response_model=ProcedureList,
            responses={503: {"description": "The FAA's procedure file could not be had"}})
def airport_procedures(ident: str) -> ProcedureList:
    """The field's instrument procedures -- its approaches, arrivals and
    departures, with the transitions of each -- from the FAA's CIFP for
    the AIRAC cycle in force (vfr.procedures), for the route's Procedures
    to offer. None for a field the CIFP has none for, as most small ones."""
    try:
        found = procedures.procedures_at(ident)
    except RuntimeError as err:
        raise HTTPException(503, f"The FAA's procedure file could not be had: {err}") from err
    if found:
        return found
    path = procedures.cifp_path()
    return {"airport": ident.strip().upper(), "cycle": procedures.cifp_cycle(path),
            "stale": procedures.cifp_stale(path), "procedures": []}


@router.get("/api/airport/{ident}/procedures/{procedure}", response_model=ProcedureDrawing,
            responses={404: {"description": "No such procedure at the field"},
                       503: {"description": "The FAA's procedure file could not be had"}})
def airport_procedure(ident: str, procedure: str, transition: str | None = None) -> ProcedureDrawing:
    """One of the field's procedures drawn for the map, with the
    transition picked (`transition`, one of its `transitions`; none for an
    approach from vectors): its lines, holds and fixes, each fix with the
    altitudes and speed it is crossed at (vfr.procedures.procedure_drawing)."""
    try:
        drawn = procedures.procedure_drawing(ident, procedure, transition)
    except RuntimeError as err:
        raise HTTPException(503, f"The FAA's procedure file could not be had: {err}") from err
    if drawn is None:
        raise HTTPException(404, f"No procedure {procedure.strip().upper()!r} at {ident.strip().upper()!r}.")
    return drawn


@router.get("/api/airport/{ident}/procedures/{procedure}/plate", response_model=PlateOverlay,
            responses={404: {"description": "No plate for the approach, or its plate's fixes do not place it"},
                       503: {"description": "The FAA's procedure file could not be had"}})
def airport_procedure_plate(ident: str, procedure: str) -> PlateOverlay:
    """An approach's plate's plan view placed on the map for the approach
    picked (vfr.plates): where its picture goes, made once a cycle from the
    FAA's d-TPP plate and its own georeference, and whether it publishes
    circling minimums. 404 where the field has no plate for it, the plate
    has no georeference, or the FAA cannot be reached."""
    try:
        found = plates.plate_overlay(ident, procedure)
    except RuntimeError as err:
        raise HTTPException(503, f"The FAA's procedure file could not be had: {err}") from err
    if found is None:
        raise HTTPException(404, f"No plate placed for {procedure.strip().upper()!r} at {ident.strip().upper()!r}.")
    return {k: found[k] for k in ("cycle", "name", "south", "west", "north", "east", "fixes", "circling")}


@router.get("/api/approach-plate/{cycle}/{ident}/{procedure}.png", response_class=FileResponse,
            responses={200: {"content": {"image/png": {}}}, 404: {"description": "No plate placed for it in that cycle"}})
def approach_plate(cycle: str, ident: str, procedure: str) -> FileResponse:
    """The plan view of an approach's plate placed on the map
    (`airport_procedure_plate`), as a picture: black on clear, north up,
    for the cycle in force."""
    if cycle != publications.dtpp_cycle():
        raise HTTPException(404, f"Not the d-TPP cycle in force: {cycle}.")
    found = plates.plate_overlay(ident, procedure)
    if found is None:
        raise HTTPException(404, f"No plate placed for {procedure.strip().upper()!r} at {ident.strip().upper()!r}.")
    return FileResponse(found["png"], media_type="image/png", headers={"Cache-Control": DIAGRAM_CACHE})


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


@router.get("/api/airport-diagram/{cycle}/runways/{ident}.png", response_class=FileResponse,
            responses={200: {"content": {"image/png": {}}}, 404: {"description": "No diagram, or its runways not found on it"}})
def airport_diagram_runways(cycle: str, ident: str) -> FileResponse:
    """The airport diagram cropped to its runways, for the card's
    thumbnail: where the field's runway ends are (vfr.pattern's, NASR's
    surveyed thresholds) placed on the diagram by its own latitude and
    longitude labels, else its runway-thick strokes (vfr.publications).
    404 where it has none, or its runways cannot be found on it -- the
    card draws its own sketch then."""
    place = airports.find_place(ident)
    if place is None:
        raise HTTPException(404, f"No US airport goes by {ident.strip().upper()!r}.")
    runways = pattern.with_traffic(airports.get_runways(place["source_ident"]), place["ident"], place["lat"], place["lon"])
    ends = [(e["lat"], e["lon"]) for r in runways if not r["closed"] for e in r["runway_ends"] if e.get("lat") is not None]
    path = publications.airport_diagram_runways_png(place["ident"], cycle, ends)
    if path is None:
        raise HTTPException(404, f"No airport diagram's runways for {ident.strip().upper()!r} in d-TPP cycle {cycle}.")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": DIAGRAM_CACHE})


@router.get("/api/faa-chart", response_model=ChartPages)
def faa_chart(url: str, response: Response, airport: str | None = None) -> ChartPages:
    """The pages of one of the FAA's charts in force -- by its address on
    aeronav.faa.gov, as a card lists it (`procedures`, the Chart
    Supplement's) -- for the app to show them itself rather than leave for
    the FAA's site: every page of an approach or a departure, of one of
    the FAA's booklets (a region's takeoff minimums) the pages naming
    `airport`, of a Chart Supplement entry each of its pages. 404 for any
    other address; 502 while the FAA cannot be reached, which the edge
    does not keep as it keeps a 404."""
    try:
        pages = publications.chart_pages(url, airport)
    except publications.FaaUnreachable:
        raise HTTPException(502, "The FAA could not be reached.") from None
    if pages is None:
        raise HTTPException(404, "Not one of the FAA's charts in force.")
    # The address names the chart's edition: the same answer for the whole of it.
    response.headers["Cache-Control"] = DIAGRAM_CACHE
    return {"pages": pages}


@router.get("/api/faa-chart/page/{source}/{edition}/{pdf}/{page}.png", response_class=FileResponse,
            responses={200: {"content": {"image/png": {}}}, 404: {"description": "No such page in force"},
                       502: {"description": "The FAA could not be reached"}})
def faa_chart_page(source: str, edition: str, pdf: str, page: int) -> FileResponse:
    """One page of one of the FAA's charts in force as a picture, drawn
    once and kept for its edition, as the airport diagram's is."""
    try:
        path = publications.chart_page_png(source, edition, pdf, page)
    except publications.FaaUnreachable:
        raise HTTPException(502, "The FAA could not be reached.") from None
    if path is None:
        raise HTTPException(404, f"No page {page} of {pdf} in {source} {edition}.")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": DIAGRAM_CACHE})
