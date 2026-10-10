"""/api/airspace/at: the airspace over a point, with the ground, the
shapefile and both feeds stubbed."""
import requests
from fastapi.testclient import TestClient
from vfr import airspace, airspace_at, classb, elevation, sua, tfr

from app.main import app

client = TestClient(app)


def _point(monkeypatch, sua_at=lambda lat, lon: [], tfr_at=lambda lat, lon: [], ground=lambda lat, lon: 238.0):
    monkeypatch.setattr(airspace, "ensure_class_airspace_shapefile", lambda cache_dir: "Class_Airspace.shp")
    monkeypatch.setattr(airspace_at, "volumes_at", lambda lat, lon, shp: [
        {"class": "E", "local_type": "CLASS_E5", "name": "CHICAGO CLASS E5", "ident": "",
         "floor_ft": 700.0, "floor_ref": "AGL", "ceiling_ft": 18000.0},
        {"class": "B", "local_type": "CLASS_B", "name": "CHICAGO CLASS B", "ident": "ORD",
         "floor_ft": 3600.0, "floor_ref": "MSL", "ceiling_ft": 10000.0},
    ])
    monkeypatch.setattr(elevation, "ground_m", ground)
    monkeypatch.setattr(classb, "class_b_airports", lambda shp: [{"ident": "KORD", "name": "O'Hare", "lat": 41.9786, "lon": -87.9048}])
    monkeypatch.setattr(sua, "at_point", sua_at)
    monkeypatch.setattr(tfr, "at_point", tfr_at)


def test_the_column_over_a_point_from_the_ground_up(monkeypatch):
    _point(monkeypatch)
    body = client.get("/api/airspace/at", params={"lat": 42.3172, "lon": -88.0905}).json()
    assert body["ground_ft"] == 780.0
    assert [(b["class"], b["floor_ft"], b["ceiling_ft"]) for b in body["bands"]] == [
        ("G", 780.0, 1480.0), ("E", 1480.0, 3600.0), ("B", 3600.0, 10000.0), ("E", 10000.0, 18000.0), ("A", 18000.0, 60000.0),
    ]
    assert body["bands"][2]["name"] == "CHICAGO CLASS B"
    assert body["bands"][0]["minimums"]["night"]["visibility_sm"] == 3.0
    assert body["mode_c_veil"]["ident"] == "KORD"
    assert body["special_use_unavailable"] is False and body["tfrs_unavailable"] is False


def test_a_feed_that_does_not_answer_is_said_so(monkeypatch):
    def sua_down(lat, lon):
        raise sua.SpecialUseUnavailable("down")

    def tfr_down(lat, lon):
        raise tfr.TfrUnavailable("down")

    def no_tiles(lat, lon):
        raise requests.ConnectionError("no tiles")

    _point(monkeypatch, sua_at=sua_down, tfr_at=tfr_down, ground=no_tiles)
    monkeypatch.setattr("vfr.airports.nearest", lambda lat, lon, limit: [{"ident": "C81", "elevation_ft": 869.0}])
    body = client.get("/api/airspace/at", params={"lat": 42.3172, "lon": -88.0905}).json()
    # The nearest field's elevation, where the tiles could not be read.
    assert body["ground_ft"] == 869.0
    assert body["special_use_unavailable"] is True and body["tfrs_unavailable"] is True


def test_a_point_off_the_earth_is_refused():
    assert client.get("/api/airspace/at", params={"lat": 95, "lon": 0}).status_code == 422


def test_what_is_ahead_of_own_ship(monkeypatch):
    from shapely.geometry import box

    _point(monkeypatch)
    monkeypatch.setattr(airspace, "load_controlled_airspace", lambda shp, bbox: [
        {"name": "ROCKFORD CLASS C", "class": "C", "ident": "RFD", "floor_ft_msl": 0.0, "ceiling_ft_msl": 4700.0,
         "geometry": box(-87.9, 41.9, -87.8, 42.1), "bbox": (-87.9, 41.9, -87.8, 42.1)},
    ])
    monkeypatch.setattr(sua, "areas_in", lambda bbox: [])
    monkeypatch.setattr(tfr, "all_tfrs", lambda: [])
    monkeypatch.setattr("vfr.faa_data.ensure_nasr_file", lambda name, cache_dir: "DOF.DAT")
    monkeypatch.setattr("vfr.faa_data.load_obstacles", lambda path, bbox, min_agl_ft=0: __import__("pandas").DataFrame(
        columns=["lat", "lon", "city", "type", "agl_ft", "amsl_ft", "lit"]))
    monkeypatch.setattr("vfr.airports.nearest", lambda lat, lon, limit=1: [{"ident": "C81", "distance_nm": 20.0}])
    body = client.get("/api/airspace/ahead", params={"lat": 42.0, "lon": -88.0, "track": 90, "gs": 120, "alt": 3000}).json()
    (alert,) = body["alerts"]
    assert alert["class"] == "C" and alert["kind"] == "airspace" and alert["level"] == "caution"
    assert body["unavailable"] == []


def test_nothing_is_ahead_on_the_ground(monkeypatch):
    _point(monkeypatch)
    body = client.get("/api/airspace/ahead", params={"lat": 42.0, "lon": -88.0, "track": 90, "gs": 10}).json()
    assert body == {"alerts": [], "unavailable": []}
