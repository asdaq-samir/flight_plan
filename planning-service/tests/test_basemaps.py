"""/api/map/google: the deployment's key for Google's map tiles, or none."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_the_key_where_the_deployment_has_one_and_a_404_where_not(monkeypatch):
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "AIza-test")
    assert client.get("/api/map/google").json() == {"key": "AIza-test"}
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", " ")
    assert client.get("/api/map/google").status_code == 404
