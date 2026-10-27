"""vfr.filed_routes: the routes pilots file between two fields, from
TFMS's flight data messages in the shape TFMData sends them (a NASA RACE
test message, race-air-test tfmdata.xml, of 2016-01-28)."""

import pytest

from vfr import filed_routes

NS = ('xmlns:ds="urn:us:gov:dot:faa:atm:tfm:tfmdataservice" xmlns:fdm="urn:us:gov:dot:faa:atm:tfm:flightdata" '
      'xmlns:nxce="urn:us:gov:dot:faa:atm:tfm:tfmdatacoreelements" '
      'xmlns:nxcm="urn:us:gov:dot:faa:atm:tfm:flightdatacommonmessages"')


def message(gufi, dep, dest, route, aircraft="C172", kind="flightPlanAmendmentInformation"):
    return (
        f'<fdm:fltdMessage msgType="{kind}" flightRef="1"><fdm:{kind}><nxcm:qualifiedAircraftId>'
        f'<nxce:aircraftId>N1</nxce:aircraftId><nxce:gufi>{gufi}</nxce:gufi>'
        f'<nxce:departurePoint><nxce:airport>{dep}</nxce:airport></nxce:departurePoint>'
        f'<nxce:arrivalPoint><nxce:airport>{dest}</nxce:airport></nxce:arrivalPoint></nxcm:qualifiedAircraftId>'
        f'<nxcm:amendmentData><nxcm:newFlightAircraftSpecs equipmentQualifier="G">{aircraft}</nxcm:newFlightAircraftSpecs>'
        f'<nxcm:newRouteOfFlight legacyFormat="{route}"/></nxcm:amendmentData></fdm:{kind}></fdm:fltdMessage>'
    )


def service(*messages):
    return f'<ds:tfmDataService {NS}><fltdOutput>{"".join(messages)}</fltdOutput></ds:tfmDataService>'


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(filed_routes, "STORE", tmp_path / "filed.sqlite")
    filed_routes.reset()
    yield
    filed_routes.reset()


def test_a_route_of_flight_in_the_nass_dots_is_the_route_boxs_stops():
    # The NASA sample's amendment: its SID and STAR are picked in the route
    # box as procedures, their transition fixes kept as points.
    assert filed_routes.route_stops("KIAD.RNLDI4.OTTTO..COLNS.GAVNN4.KCVG/2348", "KIAD", "KCVG") == ["OTTTO", "COLNS"]
    # Victor and T airways kept; a small field's FAA ident is its ICAO one.
    assert filed_routes.route_stops("C81..BAE.V100.OBH..LWD", "C81", "KLWD") == ["BAE", "V100", "OBH"]
    assert filed_routes.route_stops("KUES..T254..KMSN", "UES", "KMSN") == ["T254"]
    assert filed_routes.route_stops("KAAA..KBBB", "KAAA", "KBBB") == []


def test_a_route_on_a_jet_or_q_route_or_a_point_the_box_cant_take_is_not_kept():
    # Jet routes: 18,000 ft MSL up, Class A (AIM 5-3-4, 14 CFR 71.33, 91.135).
    sample = "MUHG./.URSUS..LAL.J73.SZW..VUZ.J151.FAM..IRK.J45.DSM..FOD..ABR..MOT.J483.VLN..CYQR"
    assert filed_routes.route_stops(sample, "MUHG", "CYQR") is None
    assert filed_routes.route_stops("KAAA..Q120..KBBB", "KAAA", "KBBB") is None
    assert filed_routes.route_stops("KAAA..4020N/07300W..KBBB", "KAAA", "KBBB") is None


def test_a_tfmdata_message_gives_each_flight_with_a_route():
    xml = service(
        message("KW1", "KIAD", "KCVG", "KIAD.RNLDI4.OTTTO..COLNS.GAVNN4.KCVG/2348", "E45X"),
        # A track update carries no route: nothing.
        '<fdm:fltdMessage msgType="trackInformation"><fdm:trackInformation><nxcm:qualifiedAircraftId>'
        '<nxce:gufi>KN2</nxce:gufi></nxcm:qualifiedAircraftId></fdm:trackInformation></fdm:fltdMessage>')
    assert filed_routes.filings(xml) == [{"gufi": "KW1", "dep": "KIAD", "dest": "KCVG",
                                          "route": "KIAD.RNLDI4.OTTTO..COLNS.GAVNN4.KCVG/2348", "aircraft": "E45X"}]
    assert filed_routes.filings("<x>no routes here</x>") == []
    assert filed_routes.filings("routeOfFlight but not xml <") == []


def test_the_most_filed_route_is_the_one_most_flights_last_had(store):
    now = 1_800_000_000.0
    filed_routes.record(filed_routes.filings(service(
        message("A", "C81", "LWD", "C81..BAE.V100.OBH..LWD"),
        message("B", "C81", "KLWD", "C81..BAE.V100.OBH..LWD"),
        message("C", "C81", "LWD", "C81..JVL..LWD"),
        message("D", "C81", "LWD", "C81..JVL..LWD"),
    )), now=now)
    # D amended onto the airway: it counts once, by its last route.
    filed_routes.record(filed_routes.filings(service(message("D", "C81", "LWD", "C81..BAE.V100.OBH..LWD"))), now=now)
    assert filed_routes.most_filed("C81", "KLWD", now=now) == [{"stops": ["BAE", "V100", "OBH"], "flights": 3}]
    # One flight's route is not "most filed".
    assert filed_routes.most_filed("LWD", "C81", now=now) == []
    # A year on, the flights have aged out.
    assert filed_routes.most_filed("C81", "LWD", now=now + filed_routes.KEEP_S + 1) == []


def test_no_store_yet_is_no_route(tmp_path, monkeypatch):
    monkeypatch.setattr(filed_routes, "STORE", tmp_path / "none" / "filed.sqlite")
    filed_routes.reset()
    assert filed_routes.most_filed("C81", "LWD") == []
    assert not (tmp_path / "none").exists()


def test_a_message_with_no_route_is_not_decoded_and_one_with_a_route_is_kept(store):
    assert filed_routes.heard(b"<ds:tfmDataService><fdm:trackInformation/></ds:tfmDataService>") == 0
    xml = service(message("B1", "C81", "LWD", "C81..BAE.V100.OBH..LWD"))
    assert filed_routes.heard(xml.encode()) == 1
