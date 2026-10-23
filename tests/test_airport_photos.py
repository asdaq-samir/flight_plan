"""vfr.airport_photos: an airport's aerial from the USGS and its photo from
the ground from Wikipedia."""
import json

import pytest

from vfr import airport_photos


def test_the_aerial_is_framed_on_the_runways_at_three_by_two():
    # KIOW's 07/25 and its crosswind runway's ends.
    ends = [(41.6389, -91.555), (41.6429, -91.540), (41.632, -91.545), (41.645, -91.548)]
    west, south, east, north = airport_photos.aerial_box(41.639, -91.546, ends)
    assert west < -91.555 and east > -91.540 and south < 41.632 and north > 41.645
    m_lon = 111_320 * 0.7470  # cos 41.64
    assert ((east - west) * m_lon) / ((north - south) * 111_320) == pytest.approx(1.5, rel=0.01)


def test_a_field_with_no_surveyed_ends_is_framed_a_mile_wide():
    west, _, east, _ = airport_photos.aerial_box(0.0, 0.0, [])
    assert (east - west) * 111_320 == pytest.approx(1600, rel=0.01)


def test_a_ground_photo_is_asked_once_and_kept(tmp_path, monkeypatch):
    asked = []
    photo = {"url": "https://upload.wikimedia.org/x.jpg", "credit": "A. Pilot", "license": "CC BY-SA 4.0", "source_url": None}
    monkeypatch.setattr(airport_photos, "_ask_ground_photo", lambda link: asked.append(link) or photo)
    link = "https://en.wikipedia.org/wiki/Sylacauga_Municipal_Airport"
    assert airport_photos.ground_photo("KSCD", link, tmp_path) == photo
    assert airport_photos.ground_photo("KSCD", link, tmp_path) == photo
    assert asked == [link]
    assert json.loads((tmp_path / "KSCD.json").read_text()) == {"photo": photo}
    # No article, no photo, and nothing asked.
    assert airport_photos.ground_photo("KZZZ", None, tmp_path) is None


def test_commons_credit_is_its_words():
    assert airport_photos._plain('<a href="//x">Jane Doe</a>\n (talk)') == "Jane Doe (talk)"


def test_the_ground_photo_is_fetched_once_and_kept(tmp_path, monkeypatch):
    fetched = []

    class Answer:
        headers = {"content-type": "image/jpeg"}
        content = b"\xff\xd8jpeg"

        def raise_for_status(self):
            pass

    monkeypatch.setattr(airport_photos.requests, "get", lambda url, **kw: fetched.append(url) or Answer())
    path = airport_photos.ground_photo_file("KSCD", "https://upload.wikimedia.org/x.jpg", tmp_path)
    assert path.read_bytes() == b"\xff\xd8jpeg"
    airport_photos.ground_photo_file("KSCD", "https://upload.wikimedia.org/x.jpg", tmp_path)
    assert fetched == ["https://upload.wikimedia.org/x.jpg"]
