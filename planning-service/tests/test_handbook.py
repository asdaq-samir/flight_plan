"""The handbook page read (app.handbook): the figures the page gives, for
the pilot to check and save; nothing where it cannot be read."""
from fastapi.testclient import TestClient

from app import handbook
from app.main import app

client = TestClient(app)


def test_a_pages_figures_come_back_with_its_own_words(monkeypatch):
    monkeypatch.setattr(handbook, "read", lambda image, media: {
        "model": "Cherokee 140 'D'",
        "cruise_tas_kt": {"value": 114.7, "page_words": "Optimum Cruising Speed (75% power, 7000 ft, mph) 132"},
        "service_ceiling_ft": {"value": 14300, "page_words": "Service Ceiling (ft) 14,300"},
    })
    resp = client.post("/api/handbook/read", json={"image_base64": "aGVsbG8=", "media_type": "image/jpeg"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["service_ceiling_ft"]["value"] == 14300 and body["fuel_burn_gph"] is None


def test_a_page_that_cannot_be_read_says_so(monkeypatch):
    def fail(image, media):
        raise handbook.HandbookUnreadable("no key")
    monkeypatch.setattr(handbook, "read", fail)
    assert client.post("/api/handbook/read", json={"image_base64": "aGVsbG8="}).status_code == 502


def test_a_photo_past_the_limit_is_refused():
    big = "A" * (8_000_001)
    assert client.post("/api/handbook/read", json={"image_base64": big}).status_code == 413
