"""A restaurant's stars, reviews and photos from Google Places (/api/food-details)."""

from fastapi.testclient import TestClient

from app.main import app
from app.routers import food_details as router

client = TestClient(app)


class _Answer:
    def __init__(self, body):
        self.body = body

    def raise_for_status(self):
        pass

    def json(self):
        return self.body


PLACE = {
    "id": "ChIJpilotpete", "displayName": {"text": "Pilot Pete's"}, "rating": 4.4, "userRatingCount": 1312,
    "googleMapsUri": "https://maps.google.com/?cid=1",
    "photos": [{"name": "places/ChIJpilotpete/photos/a", "authorAttributions": [{"displayName": "A. Pilot"}]}],
    "reviews": [{"rating": 5, "text": {"text": "Great burgers, watch the planes."}, "relativePublishTimeDescription": "a month ago",
                 "authorAttribution": {"displayName": "Sam"}}],
}


def test_a_restaurants_stars_reviews_and_photos_from_google(monkeypatch):
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "AIza-test")
    asked = {}

    def post(url, headers, json, timeout):
        asked.update(headers=headers, json=json)
        return _Answer({"places": [PLACE]})
    monkeypatch.setattr(router.requests, "post", post)
    monkeypatch.setattr(router.requests, "get", lambda url, params, timeout: _Answer({"photoUri": "https://lh3.googleusercontent.com/p"}))
    body = client.get("/api/food-details", params={"name": "Pilot Pete's", "lat": 41.99, "lon": -88.10}).json()
    assert body["rating"] == 4.4 and body["ratings"] == 1312
    assert body["photos"] == [{"url": "https://lh3.googleusercontent.com/p", "credit": "A. Pilot"}]
    assert body["reviews"][0]["text"] == "Great burgers, watch the planes." and body["reviews"][0]["author"] == "Sam"
    # Only the fields shown asked for, near where Overture places it.
    assert "places.rating" in asked["headers"]["X-Goog-FieldMask"] and "places.priceLevel" not in asked["headers"]["X-Goog-FieldMask"]
    assert asked["json"]["locationBias"]["circle"]["radius"] == router.BIAS_M


def test_no_key_no_details(monkeypatch):
    monkeypatch.delenv("GOOGLE_MAPS_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_PLACES_API_KEY", raising=False)
    assert client.get("/api/food-details", params={"name": "Pilot Pete's", "lat": 41.99, "lon": -88.1}).status_code == 404
