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
from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import FileResponse
from vfr import airports, airspace, altitude, faa_data, fixes, geocode, pattern, places, publications, remarks, runway_wind, weather

from ..common import DIAGRAM_CACHE
from ..schemas import AirportPlace, AirportsInView, ChartPages, NearestAirports, PlacesFound, WaypointsInView

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


def _military(place: dict) -> str | None:
    """Whether the armed services own the field, as _owners has it."""
    return _owners([place])[0][0]


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


@router.get("/api/airports/nearest", response_model=NearestAirports)
def nearest_airports(
    lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180),
    limit: int = Query(default=10, ge=1, le=25),
) -> NearestAirports:
    """The landing fields nearest a position -- own ship's, for the map's
    Nearest -- the nearest first: how far and which way, each one's
    longest open runway, its flight category where it reports, and its
    class of airspace at the surface, as the map's marks have it."""
    found = airports.nearest(lat, lon, limit)
    try:
        metars = weather.metar_for_idents([p["source_ident"] for p in found])
    except weather.WeatherServiceError:
        metars = {}
    out = []
    for p, cls, (military, private) in zip(found, _surface_classes(found), _owners(found)):
        lengths = [r["length_ft"] for r in airports.get_runways(p["source_ident"]) if not r["closed"] and r["length_ft"]]
        out.append({
            **p, "longest_runway_ft": max(lengths) if lengths else None,
            "flight_category": (metars.get(p["source_ident"]) or {}).get("flight_category"), "military": military,
            "private": private, "airspace_class": cls,
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
    return {
        **{key: value for key, value in place.items() if key != "source_ident"},
        "airspace_class": airspace.surface_class_at(place["lat"], place["lon"], shp_path),
        "military": _military(place),
        "towered": any(f["type"] == "TWR" for f in frequencies),
        **_notes(place["ident"]),
        "pattern": pattern.pattern_at(place["ident"], place["elevation_ft"]),
        "runways": _with_turf(pattern.with_traffic(runway_wind.with_winds(
            [r for r in airports.get_runways(source) if not r["closed"]], metar, place["lat"], place["lon"]),
            place["ident"], place["lat"], place["lon"]), place["ident"]),
        "frequencies": frequencies,
        "metar": metar,
        "weather_unavailable": unavailable,
        # Its phone and street address, for the card's Call and Address.
        **faa_data.airport_contact(place["ident"], altitude.DEFAULT_FAA_CACHE_DIR),
        "airport_diagram_url": publications.airport_diagram_url(place["ident"]),
        "airport_diagram_cycle": publications.airport_diagram_cycle(place["ident"]),
        "chart_supplement_url": publications.chart_supplement_url(place["ident"]),
        "procedures": publications.terminal_charts(place["ident"]),
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
