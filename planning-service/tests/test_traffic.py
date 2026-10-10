"""/api/traffic: the airplanes near a point, adsb.lol stubbed."""
from fastapi.testclient import TestClient
from vfr import traffic

from app.main import app

client = TestClient(app)


def test_the_airplanes_near_a_point_with_their_source_and_licence(monkeypatch):
    plane = {"hex": "a128b9", "callsign": "N174HA", "registration": "N174HA", "type": "C172", "lat": 42.0, "lon": -88.1,
             "altitude_ft": 1325.0, "pressure_altitude": False, "track_deg": 320.0, "speed_kt": 94.0, "vertical_fpm": -384.0,
             "seen_s": 0.3}
    monkeypatch.setattr(traffic, "near", lambda lat, lon, radius: [plane])
    body = client.get("/api/traffic", params={"lat": 42.3, "lon": -88.1, "radius": 25}).json()
    assert body == {"aircraft": [plane], "source": "adsb.lol", "license": "ODbL 1.0"}


def test_adsb_lol_out_is_a_503(monkeypatch):
    def down(lat, lon, radius):
        raise traffic.TrafficUnavailable("down")

    monkeypatch.setattr(traffic, "near", down)
    response = client.get("/api/traffic", params={"lat": 42.3, "lon": -88.1})
    assert response.status_code == 503 and "adsb.lol" in response.json()["detail"]
