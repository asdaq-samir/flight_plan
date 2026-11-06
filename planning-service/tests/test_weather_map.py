"""/api/weather/map: the areas, the pilot reports and the winds aloft in
the part of the chart in sight, from wingtip.weather's held products, stubbed."""
import time

from fastapi.testclient import TestClient
from wingtip import weather, weather_map

from app.main import app

client = TestClient(app)

NOW = time.time()
BOX = {"south": 40.0, "west": -92.0, "north": 46.0, "east": -84.0}
SQUARE = [(42.0, -90.0), (44.0, -90.0), (44.0, -87.0), (42.0, -87.0)]


def _datasets(monkeypatch):
    held = {
        "airsigmets": [
            {"hazard": "CONVECTIVE", "type": "SIGMET", "altitude_low_ft": None, "altitude_high_ft": 45000.0, "raw": "CONVECTIVE SIGMET 12C",
             "valid_from": NOW - 600, "valid_to": NOW + 3000, "coords": SQUARE},
            # Expired, and one in Texas: neither drawn.
            {"hazard": "TURB", "type": "SIGMET", "altitude_low_ft": 20000.0, "altitude_high_ft": 34000.0, "raw": "old",
             "valid_from": NOW - 9000, "valid_to": NOW - 60, "coords": SQUARE},
            {"hazard": "ICE", "type": "SIGMET", "altitude_low_ft": 8000.0, "altitude_high_ft": 16000.0, "raw": "texas",
             "valid_from": NOW - 600, "valid_to": NOW + 3000, "coords": [(30, -100), (31, -100), (31, -99)]},
        ],
        "gairmets": [
            # Two snapshots of icing: the nearer to now is drawn.
            {"hazard": "Icing", "severity": "MOD", "due_to": None, "valid_at": "", "valid": NOW + 600,
             "altitude_low_ft": None, "from_freezing_level": True, "altitude_high_ft": 16000.0, "coords": SQUARE},
            {"hazard": "Icing", "severity": "MOD", "due_to": None, "valid_at": "", "valid": NOW + 3 * 3600,
             "altitude_low_ft": None, "from_freezing_level": True, "altitude_high_ft": 16000.0, "coords": SQUARE},
        ],
        "pireps": [
            {"observed_at": "", "observed": NOW - 600, "lat": 43.0, "lon": -89.5, "altitude_ft": 6500.0, "aircraft": "C172",
             "urgent": False, "turbulence": "MOD", "icing": None, "raw": "UA /OV MSN310012/TM 1412/FL065/TP C172/TB MOD"},
            # An airliner's at FL350 and an old one: neither drawn.
            {"observed_at": "", "observed": NOW - 600, "lat": 43.0, "lon": -89.5, "altitude_ft": 35000.0, "aircraft": "B738",
             "urgent": False, "turbulence": None, "icing": None, "raw": "high"},
            {"observed_at": "", "observed": NOW - 3 * 3600, "lat": 43.0, "lon": -89.5, "altitude_ft": 5000.0, "aircraft": "PA28",
             "urgent": False, "turbulence": None, "icing": None, "raw": "old"},
        ],
    }
    monkeypatch.setattr(weather, "_dataset", lambda name, force=False: held[name])
    monkeypatch.setattr(weather_map, "radar_valid", lambda: "2026-10-20T21:15:00Z")


def test_the_areas_valid_now_and_the_reports_in_sight_are_drawn(monkeypatch):
    _datasets(monkeypatch)
    body = client.get("/api/weather/map", params={**BOX, "at": NOW}).json()
    assert [(a["kind"], a["hazard"]) for a in body["advisories"]] == [("convective", "CONVECTIVE"), ("gairmet", "Icing")]
    icing = body["advisories"][1]
    assert icing["from_freezing_level"] and icing["high_ft"] == 16000.0 and icing["valid_from"] == NOW + 600
    assert [p["aircraft"] for p in body["pireps"]] == ["C172"]
    assert body["winds"] is None and body["radar_valid"] == "2026-10-20T21:15:00Z"


def test_a_box_wider_than_the_country_or_upside_down_is_refused():
    assert client.get("/api/weather/map", params={**BOX, "north": 30.0}).status_code == 422
    assert client.get("/api/weather/map", params={"south": -40, "west": -170, "north": 50, "east": -60}).status_code == 422


def test_the_winds_aloft_are_the_fd_stations_at_the_altitude_asked_for(monkeypatch):
    import numpy as np
    from wingtip import airports

    _datasets(monkeypatch)
    product = weather.FdStations({"MSN": {}, "DLH": {}})
    product.period = {"valid_at": "2026-10-20T18:00:00Z", "use_from": "2026-10-20T14:00:00Z", "use_to": "2026-10-20T21:00:00Z"}
    monkeypatch.setattr(weather, "_fd_stations", lambda fcst_hr="06": product)
    monkeypatch.setattr(airports, "load_airports", lambda: None)
    # Madison in the box, Duluth north of it.
    monkeypatch.setattr(weather, "_station_rows", lambda ids, df: (
        np.array(["MSN", "DLH"]), np.radians(np.array([43.14, 46.84])), np.radians(np.array([-89.34, -92.19]))))
    wind = {"wind_dir_true_deg": 265.4, "wind_speed_kt": 33.6}
    monkeypatch.setattr(weather, "wind_at_altitude", lambda lat, lon, alt, fcst_hr="06": wind)
    monkeypatch.setattr(weather, "temperatures_aloft", lambda lat, lon, fcst_hr="06": [])
    monkeypatch.setattr(weather, "temperature_at", lambda profile, alt: -6.2)
    body = client.get("/api/weather/map", params={**BOX, "at": NOW, "altitude_ft": 9000}).json()
    winds = body["winds"]
    assert winds["altitude_ft"] == 9000 and winds["period"]["use_to"] == "2026-10-20T21:00:00Z"
    assert winds["stations"] == [{"ident": "MSN", "lat": 43.14, "lon": -89.34, "dir_true_deg": 265, "speed_kt": 34, "temp_c": -6}]
