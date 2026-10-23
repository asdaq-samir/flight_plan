"""vfr.nearby: places to eat, sleep and hire a car near a field, from
Overture Maps' places."""
import json

import pytest

from vfr import nearby

RESTAURANT = {"primary": "american_restaurant", "hierarchy": ["food_and_drink", "restaurant", "american_restaurant"]}
BAR = {"primary": "bar", "hierarchy": ["food_and_drink", "alcoholic_beverage_venue", "bar"]}
MOTEL = {"primary": "motel", "hierarchy": ["lodging", "hotel", "motel"]}
HOLDING = {"primary": "lodging", "hierarchy": ["lodging"]}
RENTAL = {"primary": "car_rental_service", "hierarchy": ["services_and_business", "rental_service", "car_rental_service"]}


@pytest.mark.parametrize("taxonomy, basic, kind", [
    (RESTAURANT, "restaurant", "food"),
    # A pilot flying on may not within 8 hours of a drink (14 CFR 91.17).
    (BAR, "bar", None),
    (MOTEL, "hotel", "lodging"),
    # The hotels' holding companies, filed as bare lodging.
    (HOLDING, "lodging", None),
    (RENTAL, "rental_service", "cars"),
    (None, None, None),
])
def test_what_a_place_is_for_a_pilot(taxonomy, basic, kind):
    assert nearby._kind_of(taxonomy, basic) == kind


def test_a_category_in_words():
    assert nearby._words("american_restaurant") == "American restaurant"
    assert nearby._words("car_rental_service") == "Car rental"


def test_a_fields_places_are_read_once_a_release_and_kept(tmp_path, monkeypatch):
    reads = []
    monkeypatch.setattr(nearby, "latest_release", lambda: "2026-10-21.0")
    monkeypatch.setattr(nearby, "_read", lambda lat, lon, release: reads.append(release) or {"food": [], "lodging": [], "cars": []})
    assert nearby.around("khys", 38.8, -99.3, tmp_path) == {"food": [], "lodging": [], "cars": []}
    nearby.around("KHYS", 38.8, -99.3, tmp_path)
    assert reads == ["2026-10-21.0"]
    assert json.loads((tmp_path / "2026-10-21.0" / "KHYS.2.json").read_text()) == {"food": [], "lodging": [], "cars": []}


def test_an_older_releases_answer_where_overture_cannot_be_read(tmp_path, monkeypatch):
    (tmp_path / "2026-09-23.0").mkdir()
    (tmp_path / "2026-09-23.0" / "KHYS.2.json").write_text('{"food": [], "lodging": [], "cars": []}')
    monkeypatch.setattr(nearby, "latest_release", lambda: "2026-10-21.0")

    def unreadable(lat, lon, release):
        raise OSError("S3 is out of reach")
    monkeypatch.setattr(nearby, "_read", unreadable)
    assert nearby.around("KHYS", 38.8, -99.3, tmp_path) == {"food": [], "lodging": [], "cars": []}
    with pytest.raises(nearby.NearbyUnavailable):
        nearby.around("KGCK", 37.9, -100.7, tmp_path)


def place(walk_min):
    return {"name": "X", "kind": "Diner", "distance_m": 300, "walk_min": walk_min, "phone": None, "lat": 0, "lon": 0}


def test_a_fields_appeal_is_its_food_how_near_and_a_way_into_town():
    assert nearby.appeal(None, False) == 0
    assert nearby.appeal({"food": [place(None)], "cars": []}, False) == 1
    assert nearby.appeal({"food": [place(4)], "cars": []}, False) == 3
    assert nearby.appeal({"food": [place(4)], "cars": []}, True) == 4
    assert nearby.appeal({"food": [], "cars": [place(6)]}, False) == 1


def test_a_field_not_read_in_time_counts_its_courtesy_car_alone(monkeypatch):
    import threading
    gate = threading.Event()
    monkeypatch.setattr(nearby, "around", lambda ident, lat, lon: gate.wait(5) and {"food": [place(4)], "cars": []})
    monkeypatch.setattr(nearby, "courtesy_car", lambda ident: ident == "K78")
    assert nearby.appeal_of([("K78", 38.9, -97.2), ("KHYS", 38.8, -99.3)], budget_s=0.05) == {"K78": 1, "KHYS": 0}
    gate.set()


def test_a_field_not_yet_read_is_none_and_read_once_however_often_asked(tmp_path, monkeypatch):
    import threading
    monkeypatch.setattr(nearby, "latest_release", lambda: "2026-10-21.0")
    monkeypatch.setattr(nearby, "CACHE_DIR", tmp_path)
    assert nearby.kept("KHYS", tmp_path) is None
    gate, reads = threading.Event(), []

    def around(ident, lat, lon, cache_dir=tmp_path):
        reads.append(ident)
        gate.wait(5)
        (tmp_path / "2026-10-21.0").mkdir(exist_ok=True)
        (tmp_path / "2026-10-21.0" / f"{ident}.2.json").write_text('{"food": [], "lodging": [], "cars": []}')
    monkeypatch.setattr(nearby, "around", around)
    nearby.read_later("khys", 38.8, -99.3)
    nearby.read_later("KHYS", 38.8, -99.3)
    gate.set()
    nearby._POOL.submit(lambda: None).result(5)
    import time
    for _ in range(50):
        if nearby.kept("KHYS", tmp_path) is not None:
            break
        time.sleep(0.05)
    assert reads == ["KHYS"] and nearby.kept("KHYS", tmp_path) == {"food": [], "lodging": [], "cars": []}
