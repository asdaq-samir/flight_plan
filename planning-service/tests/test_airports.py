"""Airports as places: the fields in a box, and one field's card. The
tables, the airspace and the weather are stubbed -- these test what the
router makes of them, not OurAirports or aviationweather.gov."""
from fastapi.testclient import TestClient
from vfr import airports, airspace, faa_data, geocode, pattern, publications, remarks, weather

from app.main import app

client = TestClient(app)

DULUTH = {
    "ident": "KDLH", "source_ident": "KDLH", "name": "Duluth International Airport", "municipality": "Duluth",
    "region": "US-MN", "lat": 46.8421, "lon": -92.1936, "elevation_ft": 1428.0, "kind": "medium",
}


def stub_place(monkeypatch, place=DULUTH, frequencies=(), runways=(), metar=None, surface_class="C"):
    monkeypatch.setattr(airports, "find_place", lambda ident: place if ident.upper() in ("KDLH", "DLH") else None)
    monkeypatch.setattr(airports, "get_frequencies", lambda ident: list(frequencies))
    monkeypatch.setattr(airports, "get_runways", lambda ident: list(runways))
    monkeypatch.setattr(airspace, "ensure_class_airspace_shapefile", lambda cache_dir: "airspace.shp")
    monkeypatch.setattr(airspace, "surface_class_at", lambda lat, lon, shp: surface_class)
    monkeypatch.setattr(remarks, "airport_notes", lambda faa_id: {
        "lighting": ["Activate MIRL runway 09/27 - CTAF."] if faa_id == "DLH" else [],
        "radio": [], "pilot_controlled": faa_id == "DLH", "explicit_clicks": False,
    })
    monkeypatch.setattr(remarks, "runway_turf", lambda faa_id: {})
    if isinstance(metar, Exception):
        def fail(idents):
            raise metar
        monkeypatch.setattr(weather, "metar_for_idents", fail)
    else:
        monkeypatch.setattr(weather, "metar_for_idents", lambda idents: {i: metar for i in idents})


def test_an_airports_card_names_its_class_tower_runways_radio_and_weather(monkeypatch):
    stub_place(
        monkeypatch,
        frequencies=[{"type": "TWR", "description": "Tower", "frequency_mhz": 118.3}],
        runways=[
            {"ends": "09/27", "length_ft": 10162, "width_ft": 150, "surface": "CON", "lighted": True, "closed": False},
            {"ends": "03/21", "length_ft": 5718, "width_ft": 150, "surface": "ASP", "lighted": True, "closed": True},
        ],
        metar={"raw": "KDLH 011853Z 28012KT 10SM CLR", "flight_category": "VFR"},
    )
    body = client.get("/api/airport/kdlh").json()
    assert body["ident"] == "KDLH"
    assert "source_ident" not in body
    assert body["airspace_class"] == "C"
    assert body["towered"] is True
    # A closed runway is not one a pilot can use.
    assert [r["ends"] for r in body["runways"]] == ["09/27"]
    assert body["metar"]["flight_category"] == "VFR"
    assert body["weather_unavailable"] is False
    # Its lights, by the FAA's own identifier (DLH): turned on from the
    # cockpit, with no count of clicks of their own.
    assert body["lighting"] == ["Activate MIRL runway 09/27 - CTAF."]
    assert body["standard_keying"] is True


def test_a_field_with_no_tower_or_station_says_so_rather_than_failing(monkeypatch):
    stub_place(monkeypatch, frequencies=[{"type": "CTAF", "description": None, "frequency_mhz": 122.8}], surface_class=None)
    body = client.get("/api/airport/KDLH").json()
    assert body["towered"] is False
    assert body["airspace_class"] is None
    assert body["metar"] is None
    assert body["weather_unavailable"] is False


def test_a_weather_outage_is_not_a_field_without_weather(monkeypatch):
    stub_place(monkeypatch, metar=weather.WeatherServiceError("aviationweather.gov is down"))
    body = client.get("/api/airport/KDLH").json()
    assert body["metar"] is None
    assert body["weather_unavailable"] is True


def test_an_ident_nobody_uses_is_a_404(monkeypatch):
    stub_place(monkeypatch)
    response = client.get("/api/airport/ZZZZ")
    assert response.status_code == 404
    assert "ZZZZ" in response.json()["detail"]


def test_the_fields_in_view_come_from_the_box_and_the_limit_those_that_report_first(monkeypatch):
    asked = {}

    def places_in(south, west, north, east, limit, first=None):
        asked.update(south=south, west=west, north=north, east=east, limit=limit, first=first)
        return [{**DULUTH}]

    monkeypatch.setattr(airports, "places_in", places_in)
    monkeypatch.setattr(weather, "reporting_idents", lambda: {"KDLH"})
    monkeypatch.setattr(weather, "metar_for_idents", lambda idents: {i: None for i in idents})
    body = client.get("/api/airports/in-view", params={"south": 46, "west": -93, "north": 47, "east": -92, "limit": 50}).json()
    assert asked == {"south": 46, "west": -93, "north": 47, "east": -92, "limit": 50, "first": {"KDLH"}}
    assert body["airports"][0]["ident"] == "KDLH"
    assert "source_ident" not in body["airports"][0]


def test_the_fields_in_view_carry_their_metars_flight_category(monkeypatch):
    # A chip on the map for each field that reports, in its category's
    # colour; nothing for one with no station, or with the weather out.
    no_station = {**DULUTH, "ident": "1D2", "source_ident": "1D2", "name": "A Small Field", "kind": "small"}
    monkeypatch.setattr(airports, "places_in", lambda *args, **kwargs: [{**DULUTH}, no_station])
    monkeypatch.setattr(weather, "reporting_idents", lambda: {"KDLH"})
    monkeypatch.setattr(weather, "metar_for_idents", lambda idents: {"KDLH": {"flight_category": "MVFR"}, "1D2": None})
    body = client.get("/api/airports/in-view", params={"south": 46, "west": -93, "north": 47, "east": -92}).json()
    assert [(a["ident"], a["flight_category"]) for a in body["airports"]] == [("KDLH", "MVFR"), ("1D2", None)]

    def down(*args):
        raise weather.WeatherServiceError("aviationweather.gov is down")
    monkeypatch.setattr(weather, "reporting_idents", down)
    monkeypatch.setattr(weather, "metar_for_idents", down)
    body = client.get("/api/airports/in-view", params={"south": 46, "west": -93, "north": 47, "east": -92}).json()
    assert [a["flight_category"] for a in body["airports"]] == [None, None]


def test_the_fields_in_view_carry_their_surface_class_for_their_marks(monkeypatch):
    # Asked once for all of them, each field's own point.
    small = {**DULUTH, "ident": "1D2", "source_ident": "1D2", "lat": 46.5, "lon": -92.5, "kind": "small"}
    monkeypatch.setattr(airports, "places_in", lambda *args, **kwargs: [{**DULUTH}, small])
    monkeypatch.setattr(weather, "reporting_idents", lambda: set())
    monkeypatch.setattr(weather, "metar_for_idents", lambda idents: {})
    asked = []
    monkeypatch.setattr(airspace, "surface_classes", lambda points, shp: asked.append(points) or ["C", "G"])
    body = client.get("/api/airports/in-view", params={"south": 46, "west": -93, "north": 47, "east": -92}).json()
    assert asked == [[(46.8421, -92.1936), (46.5, -92.5)]]
    assert [(a["ident"], a["airspace_class"]) for a in body["airports"]] == [("KDLH", "C"), ("1D2", "G")]

    # Without the FAA's airspace, the fields all the same, their class unknown.
    def unreachable(cache_dir):
        raise OSError("nfdc.faa.gov is down")
    monkeypatch.setattr(airspace, "ensure_class_airspace_shapefile", unreachable)
    body = client.get("/api/airports/in-view", params={"south": 46, "west": -93, "north": 47, "east": -92}).json()
    assert [(a["ident"], a["airspace_class"]) for a in body["airports"]] == [("KDLH", None), ("1D2", None)]


def test_the_search_may_be_kept_and_the_fields_in_view_with_their_weather_may_not(monkeypatch):
    # The search is the same for every pilot until the tables change, so
    # a browser and the CDN may keep it; the fields in view carry each
    # one's METAR, which changes within the hour, so they say nothing
    # (and the webapp marks them no-store).
    monkeypatch.setattr(airports, "places_in", lambda *args, **kwargs: [{**DULUTH}])
    monkeypatch.setattr(weather, "reporting_idents", lambda: {"KDLH"})
    monkeypatch.setattr(weather, "metar_for_idents", lambda idents: {"KDLH": {"flight_category": "VFR"}})
    in_view = client.get("/api/airports/in-view", params={"south": 46, "west": -93, "north": 47, "east": -92})
    assert "cache-control" not in in_view.headers

    monkeypatch.setattr(airports, "search_airports", lambda q: [])
    search = client.get("/api/airports/search", params={"q": "KD"})
    assert search.headers["cache-control"] == "public, max-age=300, s-maxage=3600"


def test_a_field_the_armed_services_own_is_marked_military_or_joint_use(monkeypatch):
    # From the FAA's airport file (vfr.faa_data.military_fields), by the
    # FAA's ident or the ICAO one: most pilots may not land at the first
    # without permission, and may at the second.
    base = {**DULUTH, "kind": "medium"}
    fields = [{**base, "ident": "KMXF", "source_ident": "KMXF"}, {**base, "ident": "KFHU", "source_ident": "KFHU"}, {**base}]
    monkeypatch.setattr(airports, "places_in", lambda *args, **kwargs: fields)
    monkeypatch.setattr(weather, "reporting_idents", lambda: set())
    monkeypatch.setattr(weather, "metar_for_idents", lambda idents: {})
    monkeypatch.setattr(faa_data, "military_fields", lambda cache_dir: {"MXF": "military", "KMXF": "military", "KFHU": "joint"})
    body = client.get("/api/airports/in-view", params={"south": 30, "west": -100, "north": 47, "east": -80}).json()
    assert [(a["ident"], a["military"]) for a in body["airports"]] == [("KMXF", "military"), ("KFHU", "joint"), ("KDLH", None)]


def test_reporting_asks_for_the_fields_with_a_metar_alone(monkeypatch):
    asked = {}

    def places_in(south, west, north, east, limit, only=None):
        asked["only"] = only
        return [{**DULUTH}]

    monkeypatch.setattr(airports, "places_in", places_in)
    monkeypatch.setattr(weather, "reporting_idents", lambda: {"KDLH", "KMSP"})
    monkeypatch.setattr(weather, "metar_for_idents", lambda idents: {"KDLH": {"flight_category": "VFR"}})
    body = client.get("/api/airports/in-view", params={"south": 44, "west": -94, "north": 47, "east": -92, "reporting": True}).json()
    assert asked["only"] == {"KDLH", "KMSP"}
    assert body["airports"][0]["flight_category"] == "VFR"


def test_a_box_turned_inside_out_is_refused(monkeypatch):
    monkeypatch.setattr(airports, "places_in", lambda *args, **kwargs: [])
    response = client.get("/api/airports/in-view", params={"south": 47, "west": -93, "north": 46, "east": -92})
    assert response.status_code == 422


def test_the_vfr_waypoints_in_view_are_the_sectionals_magenta_flags_only(monkeypatch):
    from vfr import fixes

    monkeypatch.setattr(fixes, "_TABLE", fixes._Table({
        "VPBNG": {"ident": "VPBNG", "lat": 42.0, "lon": -88.0, "vfr": True, "kind": "VFR waypoint"},
        "BEPKE": {"ident": "BEPKE", "lat": 42.0, "lon": -88.1, "vfr": False, "kind": "GPS waypoint"},
        "VPFAR": {"ident": "VPFAR", "lat": 45.0, "lon": -88.0, "vfr": True, "kind": "VFR waypoint"},
    }, {}))
    client = TestClient(app)

    resp = client.get("/api/waypoints/in-view", params={"south": 41.5, "west": -88.5, "north": 42.5, "east": -87.5})

    assert resp.status_code == 200
    assert resp.json() == {"waypoints": [{"ident": "VPBNG", "lat": 42.0, "lon": -88.0, "description": None}]}


def test_the_nearest_fields_are_the_nearest_first_with_their_way_and_runway(monkeypatch):
    monkeypatch.setattr(airports, "nearest", lambda lat, lon, limit: [
        {"ident": "C81", "source_ident": "KC81", "name": "Campbell", "municipality": "Grayslake", "region": "US-IL",
         "lat": 42.32, "lon": -88.07, "elevation_ft": 788.0, "kind": "small", "distance_nm": 2.1, "bearing_deg": 45},
    ])
    monkeypatch.setattr(airports, "get_runways", lambda ident: [
        {"ends": "06/24", "length_ft": 3573, "closed": False}, {"ends": "09/27", "length_ft": 3270, "closed": False},
    ])
    monkeypatch.setattr(weather, "metar_for_idents", lambda idents: {i: None for i in idents})
    body = client.get("/api/airports/nearest", params={"lat": 42.3, "lon": -88.1}).json()
    assert body["airports"][0] == {
        "ident": "C81", "name": "Campbell", "lat": 42.32, "lon": -88.07, "kind": "small", "flight_category": None,
        "municipality": "Grayslake", "elevation_ft": 788.0, "distance_nm": 2.1, "bearing_deg": 45, "longest_runway_ft": 3573,
        "military": None, "airspace_class": "G",
    }


def test_the_card_names_the_cycle_its_diagram_is_drawn_from(monkeypatch):
    stub_place(monkeypatch)
    monkeypatch.setattr(publications, "airport_diagram_url", lambda ident: "https://aeronav.faa.gov/d-tpp/2610/00125AD.PDF")
    monkeypatch.setattr(publications, "airport_diagram_cycle", lambda ident: "2610")
    monkeypatch.setattr(publications, "terminal_charts", lambda ident: [
        {"kind": "IAP", "name": "ILS OR LOC RWY 09", "url": "https://aeronav.faa.gov/d-tpp/2610/00125IL9.PDF"}])
    card = client.get("/api/airport/KDLH").json()
    assert card["airport_diagram_cycle"] == "2610"
    assert card["procedures"] == [{"kind": "IAP", "name": "ILS OR LOC RWY 09", "url": "https://aeronav.faa.gov/d-tpp/2610/00125IL9.PDF"}]


def test_the_diagram_is_a_picture_kept_for_its_cycle_and_none_for_another(monkeypatch, tmp_path):
    picture = tmp_path / "00125AD.png"
    picture.write_bytes(b"\x89PNG\r\n\x1a\n")
    monkeypatch.setattr(publications, "airport_diagram_png",
                        lambda ident, cycle: picture if (ident, cycle) == ("KDLH", "2610") else None)
    answer = client.get("/api/airport-diagram/2610/KDLH.png")
    assert answer.status_code == 200
    assert answer.headers["content-type"] == "image/png"
    assert answer.headers["cache-control"] == "public, max-age=2419200, immutable"
    assert answer.content == b"\x89PNG\r\n\x1a\n"
    assert client.get("/api/airport-diagram/2609/KDLH.png").status_code == 404


def test_the_card_has_the_fields_phone_and_street_address(monkeypatch):
    stub_place(monkeypatch)
    duluth = {"phone": "218-727-2968", "address": "4701 Grinden Drive, Duluth, MN 55811"}
    monkeypatch.setattr(faa_data, "airport_contact",
                        lambda ident, cache_dir: duluth if ident == "KDLH" else {"phone": None, "address": None})
    card = client.get("/api/airport/KDLH").json()
    assert (card["phone"], card["address"]) == ("218-727-2968", "4701 Grinden Drive, Duluth, MN 55811")



def test_an_faa_charts_pages_are_listed_and_drawn_for_its_edition(monkeypatch, tmp_path):
    page = {"source": "dtpp", "edition": "2610", "pdf": "EC3TO.PDF", "page": 33, "width": 1935, "height": 2970}
    monkeypatch.setattr(publications, "chart_pages",
                        lambda url, ident: [page] if (url, ident) == ("https://aeronav.faa.gov/d-tpp/2610/EC3TO.PDF", "KMSN") else None)
    answer = client.get("/api/faa-chart", params={"url": "https://aeronav.faa.gov/d-tpp/2610/EC3TO.PDF", "airport": "KMSN"})
    assert answer.status_code == 200
    assert answer.json() == {"pages": [page]}
    assert answer.headers["cache-control"] == "public, max-age=2419200, immutable"
    assert client.get("/api/faa-chart", params={"url": "https://example.com/x.pdf"}).status_code == 404

    picture = tmp_path / "EC3TO-33.png"
    picture.write_bytes(b"\x89PNG\r\n\x1a\n")
    monkeypatch.setattr(publications, "chart_page_png",
                        lambda source, edition, pdf, n: picture if (source, edition, pdf, n) == ("dtpp", "2610", "EC3TO.PDF", 33) else None)
    drawn = client.get("/api/faa-chart/page/dtpp/2610/EC3TO.PDF/33.png")
    assert drawn.status_code == 200 and drawn.headers["content-type"] == "image/png"
    assert client.get("/api/faa-chart/page/dtpp/2610/EC3TO.PDF/34.png").status_code == 404

    # The FAA not answering is a 502, which the edge does not keep; a bad address is the 404.
    def down(*args):
        raise publications.FaaUnreachable("down")

    monkeypatch.setattr(publications, "chart_pages", down)
    monkeypatch.setattr(publications, "chart_page_png", down)
    assert client.get("/api/faa-chart", params={"url": "https://aeronav.faa.gov/d-tpp/2610/EC3TO.PDF"}).status_code == 502
    assert client.get("/api/faa-chart/page/dtpp/2610/EC3TO.PDF/33.png").status_code == 502



def test_a_place_typed_is_an_airport_a_town_or_an_address_with_where_it_is(monkeypatch):
    stub_place(monkeypatch)
    monkeypatch.setattr(airports, "search_airports", lambda q, limit=8: [{"ident": "KDLH", "name": "Duluth International Airport"}])
    monkeypatch.setattr(geocode, "find_towns", lambda q: [{"label": "Duluth, MN", "lat": 46.78, "lon": -92.1}])
    monkeypatch.setattr(geocode, "find_addresses", lambda q: [])
    found = client.get("/api/places/search", params={"q": "dul"}).json()["places"]
    assert found == [
        {"label": "KDLH · Duluth International Airport", "kind": "airport", "lat": 46.8421, "lon": -92.1936},
        {"label": "Duluth, MN", "kind": "town", "lat": 46.78, "lon": -92.1},
    ]
    assert client.get("/api/places/search", params={"q": "d"}).json() == {"places": []}
def test_the_diagrams_runways_are_its_crop_with_the_fields_ends(monkeypatch, tmp_path):
    stub_place(monkeypatch, runways=[{"ends": "09/27", "end_headings": [("09", 90.0), ("27", 270.0)], "length_ft": 10162,
                                      "width_ft": 150, "surface": "CON", "lighted": True, "closed": False}])
    monkeypatch.setattr(pattern, "end_positions", lambda ident, cache_dir=None: {"9": (46.84, -92.21), "27": (46.84, -92.17)})
    asked = []
    picture = tmp_path / "00125AD-runways.png"
    picture.write_bytes(b"\x89PNG\r\n\x1a\n")
    monkeypatch.setattr(publications, "airport_diagram_runways_png",
                        lambda ident, cycle, ends: asked.append((ident, cycle, ends)) or (picture if cycle == "2610" else None))
    answer = client.get("/api/airport-diagram/2610/runways/KDLH.png")
    assert answer.status_code == 200 and answer.headers["cache-control"] == "public, max-age=2419200, immutable"
    assert asked == [("KDLH", "2610", [(46.84, -92.21), (46.84, -92.17)])]
    assert client.get("/api/airport-diagram/2609/runways/KDLH.png").status_code == 404


def test_a_runway_part_turf_says_which_part_by_its_own_end(monkeypatch):
    # The remarks name its end "06"; OurAirports' runway names it "6".
    stub_place(monkeypatch, runways=[{
        "ends": "6/24", "length_ft": 3573, "width_ft": 40, "surface": "ASPH-TURF", "lighted": False, "closed": False,
        "end_headings": [("6", 58.0), ("24", 238.0)],
    }])
    monkeypatch.setattr(pattern, "end_positions", lambda ident, cache_dir=None: {})
    turf = {"06/24": [{"end": "06", "from_ft": 0, "to_ft": 1000}]}
    monkeypatch.setattr(remarks, "runway_turf", lambda faa_id: turf if faa_id == "DLH" else {})
    runway = client.get("/api/airport/KDLH").json()["runways"][0]
    assert runway["turf"] == [{"end": "6", "from_ft": 0, "to_ft": 1000}]


def test_turf_named_from_the_far_end_keeps_the_runways_own_end_name(monkeypatch):
    # The remarks measure from 24, and OurAirports lists the ends the other way round.
    stub_place(monkeypatch, runways=[{
        "ends": "24/6", "length_ft": 3573, "width_ft": 40, "surface": "ASPH-TURF", "lighted": False, "closed": False,
        "end_headings": [("24", 238.0), ("6", 58.0)],
    }])
    monkeypatch.setattr(pattern, "end_positions", lambda ident, cache_dir=None: {})
    turf = {"06/24": [{"end": "24", "from_ft": 0, "to_ft": 500}]}
    monkeypatch.setattr(remarks, "runway_turf", lambda faa_id: turf if faa_id == "DLH" else {})
    runway = client.get("/api/airport/KDLH").json()["runways"][0]
    assert runway["turf"] == [{"end": "24", "from_ft": 0, "to_ft": 500}]


def test_a_card_without_the_remarks_file_has_its_runways_and_no_turf(monkeypatch):
    stub_place(monkeypatch, runways=[{
        "ends": "6/24", "length_ft": 3573, "width_ft": 40, "surface": "ASPH-TURF", "lighted": False, "closed": False,
        "end_headings": [("6", 58.0), ("24", 238.0)],
    }])
    monkeypatch.setattr(pattern, "end_positions", lambda ident, cache_dir=None: {})

    def missing(faa_id):
        raise OSError("no remarks file")
    monkeypatch.setattr(remarks, "runway_turf", missing)
    runway = client.get("/api/airport/KDLH").json()["runways"][0]
    assert runway["length_ft"] == 3573 and not runway.get("turf")


def test_turf_is_found_under_the_faa_identifier_of_a_k_ident(monkeypatch):
    stub_place(monkeypatch, runways=[{
        "ends": "6/24", "length_ft": 3573, "width_ft": 40, "surface": "ASPH-TURF", "lighted": False, "closed": False,
        "end_headings": [("6", 58.0), ("24", 238.0)],
    }])
    monkeypatch.setattr(pattern, "end_positions", lambda ident, cache_dir=None: {})
    asked = []

    def turf(faa_id):
        asked.append(faa_id)
        return {"06/24": [{"end": "06", "from_ft": 0, "to_ft": 1000}]} if faa_id == "DLH" else {}
    monkeypatch.setattr(remarks, "runway_turf", turf)
    runway = client.get("/api/airport/KDLH").json()["runways"][0]
    assert "DLH" in asked and runway["turf"] == [{"end": "6", "from_ft": 0, "to_ft": 1000}]
