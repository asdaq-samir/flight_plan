"""/api/traffic: the airplanes near a point, adsb.lol stubbed."""
import datetime as dt

from fastapi.testclient import TestClient
from vfr import traffic

from app.main import app

client = TestClient(app)


def test_the_airplanes_near_a_point_with_their_source_and_licence(monkeypatch):
    plane = {"hex": "a128b9", "callsign": "N174HA", "registration": "N174HA", "type": "C172", "lat": 42.0, "lon": -88.1,
             "altitude_ft": 1325.0, "pressure_altitude": False, "track_deg": 320.0, "speed_kt": 94.0, "vertical_fpm": -384.0,
             "seen_s": 0.3, "squawk": "1200", "emergency": None}
    monkeypatch.setattr(traffic, "near", lambda lat, lon, radius: {"aircraft": [plane], "age_s": 2.5})
    body = client.get("/api/traffic", params={"lat": 42.3, "lon": -88.1, "radius": 25}).json()
    assert body == {"aircraft": [plane], "age_s": 2.5, "source": "adsb.lol", "license": "ODbL 1.0"}


def test_adsb_lol_out_is_a_503(monkeypatch):
    def down(lat, lon, radius):
        raise traffic.TrafficUnavailable("down")

    monkeypatch.setattr(traffic, "near", down)
    response = client.get("/api/traffic", params={"lat": 42.3, "lon": -88.1})
    assert response.status_code == 503 and "adsb.lol" in response.json()["detail"]


def test_an_airplane_named_is_found_and_its_flight_given(monkeypatch):
    plane = {"hex": "a0b7d8", "callsign": "UAL2088", "lat": 42.0, "lon": -88.1, "squawk": "3324"}
    monkeypatch.setattr(traffic, "find", lambda q: [plane] if q == "UAL2088" else [])
    assert client.get("/api/traffic/find", params={"q": "UAL2088"}).json()["aircraft"][0]["callsign"] == "UAL2088"
    monkeypatch.setattr(traffic, "flight", lambda hex_id: {"hex": hex_id, "registration": "N14511", "departed": None,
                                                           "trail": [{"t": 1.0, "lat": 42.0, "lon": -88.0, "alt_ft": None}]})
    body = client.get("/api/traffic/flight/a0b7d8").json()
    assert body["registration"] == "N14511" and body["trail"][0]["alt_ft"] is None
    # Not an ICAO address: refused, nothing asked of adsb.lol.
    assert client.get("/api/traffic/flight/nothex").status_code == 422


def test_a_flights_faa_registration_and_its_flight_numbers_route(monkeypatch):
    faa = {"n_number": "N14511", "mode_s_hex": "a0b7d8", "manufacturer": "Airbus S A S", "model": "A321-271NX",
           "owner": "United Airlines Inc", "city": "Chicago", "state": "IL", "status": "Valid", "standing": "valid"}
    monkeypatch.setattr(traffic, "flight", lambda hex_id: {"hex": hex_id, "faa": faa, "registration": "N14511", "trail": []})
    body = client.get("/api/traffic/flight/a0b7d8").json()
    assert body["faa"]["owner"] == "United Airlines Inc" and body["faa"]["standing"] == "valid" and body["faa"]["co_owners"] == 0
    monkeypatch.setattr(traffic, "route", lambda callsign, lat, lon: {
        "airports": [{"ident": "TJSJ", "name": "Luis Munoz Marin International Airport", "location": "San Juan"},
                     {"ident": "KORD", "name": "Chicago O'Hare International Airport", "location": "Chicago"}],
        "plausible": lat is not None} if callsign == "UAL2088" else None)
    route = client.get("/api/traffic/route", params={"callsign": "UAL2088", "lat": 37.5, "lon": -84.9}).json()
    assert [a["ident"] for a in route["airports"]] == ["TJSJ", "KORD"] and route["plausible"] is True
    assert client.get("/api/traffic/route", params={"callsign": "N174HA"}).json() is None


def test_an_airplane_not_in_the_air_is_found_in_the_faa_registry(monkeypatch):
    faa = {"n_number": "N654FL", "mode_s_hex": "a89c1e", "manufacturer": "Piper", "model": "PA-28-140", "status": "Valid",
           "standing": "valid"}
    monkeypatch.setattr(traffic, "find", lambda q: [])
    monkeypatch.setattr(traffic, "registered", lambda q: faa if q == "N654FL" else None)
    body = client.get("/api/traffic/find", params={"q": "N654FL"}).json()
    assert body["aircraft"] == [] and body["registered"]["mode_s_hex"] == "a89c1e"
    assert client.get("/api/traffic/find", params={"q": "UAL2088"}).json()["registered"] is None


def test_adsb_lol_busy_still_gives_the_faa_record_unchecked(monkeypatch):
    faa = {"n_number": "N654FL", "mode_s_hex": "a89c1e", "manufacturer": "Piper", "model": "PA-28-140", "status": "Valid",
           "standing": "valid"}

    def busy(q):
        raise traffic.TrafficUnavailable("turned away")

    monkeypatch.setattr(traffic, "find", busy)
    monkeypatch.setattr(traffic, "registered", lambda q: faa if q == "N654FL" else None)
    response = client.get("/api/traffic/find", params={"q": "N654FL"})
    assert response.status_code == 200
    body = response.json()
    assert body["checked"] is False and body["aircraft"] == [] and body["registered"]["n_number"] == "N654FL"
    # Nothing the registry knows: still an answer, unchecked, for the page to ask again.
    body = client.get("/api/traffic/find", params={"q": "UAL2088"}).json()
    assert body == {"aircraft": [], "registered": None, "checked": False}


def test_an_airplanes_past_flights_and_one_of_them(monkeypatch):
    lci = {"ident": "LCI", "name": "Laconia Municipal Airport", "city": "Laconia", "region": "US-NH"}
    lwm = {"ident": "LWM", "name": "Lawrence Municipal Airport", "city": "Lawrence", "region": "US-MA"}
    asked = []
    monkeypatch.setattr(traffic, "history", lambda hex_id, until=None, before=None: asked.append((until, before)) or {
        "hex": hex_id, "registration": "N654FL", "type": "P28A", "next_until": "2026-10-04", "flights": [
        {"id": 1791723840, "origin": lci, "destination": lwm, "off": 1791723840.0, "on": 1791731820.0, "landed": True,
         "in_air": False, "max_alt_ft": 5400.0}]})
    body = client.get("/api/traffic/flight/a89c1e/history").json()
    assert body["flights"][0]["origin"]["ident"] == "LCI" and body["flights"][0]["destination"]["city"] == "Lawrence"
    assert body["next_until"] == "2026-10-04"
    # The ones before: from a day, before a takeoff.
    client.get("/api/traffic/flight/a89c1e/history?until=2026-10-04&before=1791723840")
    assert asked[-1] == (dt.date(2026, 10, 4), 1791723840.0)
    point = {"t": 1791723840.0, "lat": 43.57, "lon": -71.42, "alt_ft": 800.0, "gs_kt": 90.0, "track_deg": 250.0, "vrate_fpm": 844.0}
    monkeypatch.setattr(traffic, "past_flight", lambda hex_id, flight_id: {"id": flight_id, "points": [point]}
                        if flight_id == 1791723840 else None)
    assert client.get("/api/traffic/flight/a89c1e/history/1791723840").json()["points"][0]["vrate_fpm"] == 844.0
    assert client.get("/api/traffic/flight/a89c1e/history/123").status_code == 404
    assert client.get("/api/traffic/flight/nothex/history").status_code == 422
