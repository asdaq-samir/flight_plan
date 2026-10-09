"""Where a town or an address a pilot types is, for Nearest: the Census
Bureau's gazetteer of places and its geocoder, stubbed."""
import io
import zipfile

import requests

from vfr import geocode

GAZETTEER = (
    "USPS|GEOID|GEOIDFQ|ANSICODE|NAME|LSAD|FUNCSTAT|ALAND|AWATER|ALAND_SQMI|AWATER_SQMI|INTPTLAT|INTPTLONG\n"
    "AL|0145784|x|x|Madison city|25|A|78000000|0|0|0|34.70|-86.74\n"
    "WI|5548000|x|x|Madison city|25|A|200000000|0|0|0|43.08|-89.39\n"
    "SD|4640220|x|x|Madison city|25|A|12000000|0|0|0|44.00|-97.11\n"
    "WI|5548025|x|x|Madison Heights CDP|57|S|1000|0|0|0|43.1|-89.4\n"
    "IL|1741183|x|x|Lake in the Hills village|47|A|26000000|0|0|0|42.18|-88.34\n"
    "TN|4752006|x|x|Nashville-Davidson metropolitan government (balance)|00|F|1300000000|0|0|0|36.17|-86.78\n"
)


def _zipped(text: str) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("2025_Gaz_place_national.txt", text)
    return out.getvalue()


def test_a_places_name_is_what_comes_before_its_kind():
    names = [t[0] for t in geocode._towns_of(_zipped(GAZETTEER))]
    assert set(names) == {"Madison", "Madison Heights", "Lake in the Hills", "Nashville-Davidson"}


def test_towns_typed_are_found_the_named_one_first_then_the_biggest_and_by_state(monkeypatch):
    monkeypatch.setattr(geocode, "_TOWNS", geocode._towns_of(_zipped(GAZETTEER)))
    assert [t["label"] for t in geocode.find_towns("madison")] == ["Madison, WI", "Madison, AL", "Madison, SD", "Madison Heights, WI"]
    assert [t["label"] for t in geocode.find_towns("Madison, sd")] == ["Madison, SD"]
    assert geocode.find_towns("lake in")[0] == {"label": "Lake in the Hills, IL", "lat": 42.18, "lon": -88.34}
    assert geocode.find_towns("m") == []


class _Answer:
    def __init__(self, body):
        self.body = body

    def raise_for_status(self):
        pass

    def json(self):
        return self.body


def test_an_address_is_where_the_census_geocoder_places_it(monkeypatch):
    monkeypatch.setattr(geocode, "_ADDRESSES", {})
    asked = []

    def get(url, **kwargs):
        asked.append(kwargs["params"]["address"])
        return _Answer({"result": {"addressMatches": [
            {"matchedAddress": "4000 INTERNATIONAL LN, MADISON, WI, 53704", "coordinates": {"x": -89.349, "y": 43.134}}]}})

    monkeypatch.setattr(geocode.requests, "get", get)
    assert geocode.find_addresses("4000 International Ln Madison WI") == [
        {"label": "4000 International Ln, Madison, WI 53704", "lat": 43.134, "lon": -89.349}]
    # Not an address -- no house number first -- and not asked.
    assert geocode.find_addresses("Madison") == []
    assert asked == ["4000 International Ln Madison WI"]
    # The same text again, in other case and spacing, is the kept answer.
    assert len(geocode.find_addresses("4000  international ln madison wi")) == 1
    assert len(asked) == 1


def test_a_geocoder_that_does_not_answer_finds_nothing_and_fails_nothing(monkeypatch):
    monkeypatch.setattr(geocode, "_ADDRESSES", {})
    def down(url, **kwargs):
        raise requests.ConnectionError("down")
    monkeypatch.setattr(geocode.requests, "get", down)
    assert geocode.find_addresses("4000 International Ln") == []


def _no_kept_gazetteer(monkeypatch, tmp_path):
    monkeypatch.setattr(geocode, "TOWNS_PATH", tmp_path / "places.json")
    monkeypatch.setattr(geocode, "_TOWNS", None)
    monkeypatch.setattr(geocode, "_RETRY_AT", 0.0)


def test_a_failed_download_is_not_tried_again_at_once(monkeypatch, tmp_path):
    _no_kept_gazetteer(monkeypatch, tmp_path)
    calls = []

    def down(url, **kwargs):
        calls.append(url)
        raise requests.ConnectionError("down")
    monkeypatch.setattr(geocode.requests, "get", down)
    assert geocode.find_towns("madison") == []
    assert geocode.find_towns("madison") == []
    assert len(calls) == 1


def test_a_corrupt_kept_gazetteer_is_downloaded_again(monkeypatch, tmp_path):
    _no_kept_gazetteer(monkeypatch, tmp_path)
    geocode.TOWNS_PATH.write_text('[["Madison", "WI", 43.')

    class Resp:
        content = _zipped(GAZETTEER)

        def raise_for_status(self):
            pass
    monkeypatch.setattr(geocode.requests, "get", lambda url, **kwargs: Resp())
    assert geocode.find_towns("madison")[0]["label"] == "Madison, WI"
