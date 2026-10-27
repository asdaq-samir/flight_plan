"""vfr.nearby: places to eat, sleep and hire a car and flight schools near a field, from
Overture Maps' places."""
import json

import pytest

from vfr import nearby

RESTAURANT = {"primary": "american_restaurant", "hierarchy": ["food_and_drink", "restaurant", "american_restaurant"]}
BAR = {"primary": "bar", "hierarchy": ["food_and_drink", "alcoholic_beverage_venue", "bar"]}
MOTEL = {"primary": "motel", "hierarchy": ["lodging", "hotel", "motel"]}
HOLDING = {"primary": "lodging", "hierarchy": ["lodging"]}
RENTAL = {"primary": "car_rental_service", "hierarchy": ["services_and_business", "rental_service", "car_rental_service"]}
FLIGHT_SCHOOL = {"primary": "flight_school", "hierarchy": ["education", "place_of_learning", "specialty_school", "flight_school"]}
MUSIC_SCHOOL = {"primary": "music_school", "hierarchy": ["education", "place_of_learning", "specialty_school", "music_school"]}


@pytest.mark.parametrize("taxonomy, basic, kind", [
    (RESTAURANT, "restaurant", "food"),
    # A pilot flying on may not within 8 hours of a drink (14 CFR 91.17).
    (BAR, "bar", None),
    (MOTEL, "hotel", "lodging"),
    # The hotels' holding companies, filed as bare lodging.
    (HOLDING, "lodging", None),
    (RENTAL, "rental_service", "cars"),
    # The Stops' Training: a flight school, not every specialty school.
    (FLIGHT_SCHOOL, "specialty_school", "training"),
    (MUSIC_SCHOOL, "specialty_school", None),
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
    assert json.loads((tmp_path / "2026-10-21.0" / f"KHYS{nearby.KEPT_SUFFIX}").read_text()) == {"food": [], "lodging": [], "cars": []}


def test_an_older_releases_answer_where_overture_cannot_be_read(tmp_path, monkeypatch):
    (tmp_path / "2026-09-23.0").mkdir()
    (tmp_path / "2026-09-23.0" / f"KHYS{nearby.KEPT_SUFFIX}").write_text('{"food": [], "lodging": [], "cars": []}')
    monkeypatch.setattr(nearby, "latest_release", lambda: "2026-10-21.0")

    def unreadable(lat, lon, release):
        raise OSError("S3 is out of reach")
    monkeypatch.setattr(nearby, "_read", unreadable)
    assert nearby.around("KHYS", 38.8, -99.3, tmp_path) == {"food": [], "lodging": [], "cars": []}
    with pytest.raises(nearby.NearbyUnavailable):
        nearby.around("KGCK", 37.9, -100.7, tmp_path)


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
        (tmp_path / "2026-10-21.0" / f"{ident}{nearby.KEPT_SUFFIX}").write_text('{"food": [], "lodging": [], "cars": []}')
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


def test_a_place_to_eat_is_on_the_field_inside_its_outline_not_across_the_road():
    # Schaumburg (06C): Pilot Pete's inside the field's outline, the
    # Cubano Bros across the road 13 m outside (the owner's "food at the
    # airport itself", 2026-10-25); with no outline, near its point.
    from shapely.geometry import box
    outline = box(-88.104, 41.985, -88.0957, 41.993)
    assert nearby._on_field(outline, 41.990866, -88.102364, 199.0)
    assert not nearby._on_field(outline, 41.989803, -88.09545, 462.0)
    assert nearby._on_field(None, 41.99, -88.10, 199.0)
    assert not nearby._on_field(None, 41.99, -88.10, 462.0)


def test_a_companys_registered_name_is_not_somewhere_to_eat():
    for name in ["Team Advantage Inc", "Kobev International Inc.", "Tailwind Eri Llc", "Sky Holdings, LLC"]:
        assert nearby._COMPANY.search(name.rstrip(" ,")), name
    for name in ["Pilot Pete's", "Kitty Hawk Cafe", "The Inc Diner", "Bessie's Diner"]:
        assert not nearby._COMPANY.search(name), name


def test_food_at_the_field_is_a_place_on_it_or_a_walk_from_it(tmp_path, monkeypatch):
    import json

    from vfr import nearby
    monkeypatch.setattr(nearby, "latest_release", lambda timeout_s=10.0: "2026-10-21.0")
    (tmp_path / "2026-10-21.0").mkdir()

    def keep(ident, food):
        (tmp_path / "2026-10-21.0" / f"{ident}{nearby.KEPT_SUFFIX}").write_text(json.dumps({"food": food, "lodging": [], "cars": []}))

    keep("KPWK", [{"name": "Pete's", "on_field": True, "walk_min": 3}])
    keep("KDLH", [{"name": "Across the road", "on_field": False, "walk_min": 12}])
    keep("KOSH", [{"name": "In town", "on_field": False, "walk_min": None}])
    assert nearby.food_at("KPWK", tmp_path) is True
    assert nearby.food_at("KDLH", tmp_path) is True
    assert nearby.food_at("KOSH", tmp_path) is False
    assert nearby.food_at("KMSN", tmp_path) is None
