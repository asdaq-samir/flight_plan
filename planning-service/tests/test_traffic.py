"""/api/traffic: the airplanes near a point, adsb.lol stubbed."""
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
