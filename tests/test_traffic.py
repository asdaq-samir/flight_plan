"""vfr.traffic: adsb.lol's answer read into the map's airplanes, and how
often adsb.lol is asked, with adsb.lol stubbed in its own shape (readsb's
JSON, `ac`) and the clock stood in for."""
import threading
from unittest.mock import Mock, patch

import pytest
import requests

from vfr import traffic

CESSNA = {"hex": "a128b9", "type": "adsr_icao", "flight": "N174HA  ", "r": "N174HA", "t": "C172", "alt_baro": 1200,
          "alt_geom": 1325, "gs": 93.7, "track": 320.19, "baro_rate": -512, "geom_rate": -384, "lat": 42.301282,
          "lon": -88.145246, "seen_pos": 0.291}


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


@pytest.fixture
def clock(monkeypatch):
    clock = Clock()
    monkeypatch.setattr(traffic, "_REGIONS", {})
    monkeypatch.setattr(traffic, "_STATE", {"next_ask": 0.0})
    monkeypatch.setattr(traffic, "_FLIGHTS", {})
    monkeypatch.setattr(traffic, "_clock", clock)
    monkeypatch.setattr(traffic, "_sleep", clock.sleep)
    return clock


def _answer(entries):
    resp = Mock()
    resp.raise_for_status = Mock()
    resp.json = Mock(return_value={"msg": "No error", "ac": entries})
    return resp


def _turned_away():
    resp = Mock()
    resp.raise_for_status = Mock(side_effect=requests.HTTPError("429 Too Many Requests"))
    return resp


def test_an_airplane_in_the_air_as_the_map_draws_it(clock):
    with patch("vfr.traffic.requests.get", return_value=_answer([CESSNA])) as get:
        found = traffic.near(42.3246, -88.0741, 25)
    # Its region's middle, out to 80 nm.
    assert get.call_args.args[0] == "https://api.adsb.lol/v2/point/42.50/-88.00/80"
    assert found == {"age_s": 0.0, "aircraft": [{
        "hex": "a128b9", "callsign": "N174HA", "registration": "N174HA", "type": "C172", "lat": 42.30128, "lon": -88.14525,
        # The GNSS height, as the phone's own is, and its climb.
        "altitude_ft": 1325.0, "pressure_altitude": False, "track_deg": 320.19, "speed_kt": 93.7, "vertical_fpm": -384.0,
        "seen_s": 0.291, "squawk": None, "emergency": None,
    }]}


def test_on_the_ground_without_a_position_or_with_an_old_one_is_left_out(clock):
    entries = [
        {**CESSNA, "hex": "a1", "alt_baro": "ground"},
        {**CESSNA, "hex": "a2", "lat": None},
        {**CESSNA, "hex": "a3", "seen_pos": 45.0},
        {**CESSNA, "hex": "a4"},
    ]
    with patch("vfr.traffic.requests.get", return_value=_answer(entries)):
        assert [a["hex"] for a in traffic.near(42.3, -88.1, 25)["aircraft"]] == ["a4"]


def test_a_pressure_altitude_alone_is_said_to_be_one(clock):
    entry = {k: v for k, v in CESSNA.items() if k not in ("alt_geom", "geom_rate")}
    with patch("vfr.traffic.requests.get", return_value=_answer([entry])):
        (cessna,) = traffic.near(42.3, -88.1, 25)["aircraft"]
    assert cessna["altitude_ft"] == 1200.0 and cessna["pressure_altitude"] is True and cessna["vertical_fpm"] == -512.0


def test_a_view_is_given_the_airplanes_within_it_from_its_regions_answer(clock):
    far = {**CESSNA, "hex": "far", "lat": 42.9}           # 36 nm north of 42.3
    with patch("vfr.traffic.requests.get", return_value=_answer([CESSNA, far])) as get:
        near_view = traffic.near(42.3, -88.1, 20)["aircraft"]
        wide_view = traffic.near(42.35, -88.05, 50)["aircraft"]
    assert [a["hex"] for a in near_view] == ["a128b9"]
    assert [a["hex"] for a in wide_view] == ["a128b9", "far"]
    # One request for both: the same region, within five seconds.
    assert get.call_count == 1


def test_a_region_is_asked_again_after_five_seconds_and_says_how_old_it_is(clock):
    with patch("vfr.traffic.requests.get", return_value=_answer([CESSNA])) as get:
        traffic.near(42.3, -88.1, 25)
        clock.now += 3
        assert traffic.near(42.3, -88.1, 25)["age_s"] == 3.0
        clock.now += 3
        assert traffic.near(42.3, -88.1, 25)["age_s"] == 0.0
    assert get.call_count == 2


def test_two_requests_are_never_closer_than_five_seconds(clock):
    asked_at = []

    def get(*args, **kwargs):
        asked_at.append(clock.now)
        return _answer([])

    with patch("vfr.traffic.requests.get", side_effect=get):
        traffic.near(42.3, -88.1, 25)
        clock.now += 1
        # Another region, with nothing of its own yet: it waits its turn.
        traffic.near(45.0, -93.0, 25)
    assert asked_at == [1000.0, 1005.0]


def test_turned_away_the_last_answer_is_given_and_nothing_asked_for_fifteen_seconds(clock):
    with patch("vfr.traffic.requests.get", return_value=_answer([CESSNA])):
        traffic.near(42.3, -88.1, 25)
    clock.now += 6
    with patch("vfr.traffic.requests.get", return_value=_turned_away()) as get:
        assert traffic.near(42.3, -88.1, 25)["age_s"] == 6.0
        clock.now += 10
        assert traffic.near(42.3, -88.1, 25)["age_s"] == 16.0
    assert get.call_count == 1


def test_with_nothing_for_a_minute_traffic_is_unavailable(clock):
    with patch("vfr.traffic.requests.get", return_value=_answer([CESSNA])):
        traffic.near(42.3, -88.1, 25)
    with patch("vfr.traffic.requests.get", side_effect=requests.ConnectionError("down")):
        for _ in range(4):
            clock.now += 16
            try:
                traffic.near(42.3, -88.1, 25)
            except traffic.TrafficUnavailable:
                break
        else:
            pytest.fail("an answer over a minute old was still given")
    assert clock.now - 1000.0 >= traffic.KEEP_S


def test_askers_at_once_share_one_request(clock):
    import time

    def slow(*args, **kwargs):
        time.sleep(0.2)
        return _answer([])

    with patch("vfr.traffic.requests.get", side_effect=slow) as get:
        threads = [threading.Thread(target=traffic.near, args=(42.3, -88.1, 25)) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
    assert get.call_count == 1


def test_a_region_with_an_answer_is_not_kept_behind_another_regions_request(clock):
    with patch("vfr.traffic.requests.get", return_value=_answer([CESSNA])):
        traffic.near(42.3, -88.1, 25)
    started, release = threading.Event(), threading.Event()

    def slow(*args, **kwargs):
        started.set()
        release.wait(5)
        return _answer([])

    with patch("vfr.traffic.requests.get", side_effect=slow):
        clock.now += 6
        other = threading.Thread(target=traffic.near, args=(45.0, -93.0, 25))
        other.start()
        assert started.wait(5)
        # Its own answer is a second old, fresh: given while the other asks.
        traffic.near(42.3, -88.1, 25)
        release.set()
        other.join()


def _routed(answers):
    """requests.get answering each URL from `answers` (a substring to an
    answer), and the URLs asked."""
    asked = []

    def get(url, *args, **kwargs):
        asked.append(url)
        for part, answer in answers.items():
            if part in url:
                return answer
        raise AssertionError(f"unexpected {url}")
    return get, asked


def test_an_airplane_is_found_by_its_callsign_registration_or_address(clock):
    get, asked = _routed({"/callsign/UAL2088": _answer([{**CESSNA, "flight": "UAL2088 ", "squawk": "3324"}]),
                          "/reg/N174HA": _answer([CESSNA]), "/hex/a128b9": _answer([CESSNA])})
    with patch("vfr.traffic.requests.get", side_effect=get):
        (ual,) = traffic.find("ual 2088")
        assert ual["callsign"] == "UAL2088" and ual["squawk"] == "3324" and ual["emergency"] is None
        assert [a["hex"] for a in traffic.find("N174HA")] == ["a128b9"]
        assert [a["hex"] for a in traffic.find("A128B9")] == ["a128b9"]
    assert [u.rsplit("v2/", 1)[1] for u in asked] == ["callsign/UAL2088", "reg/N174HA", "hex/a128b9"]


def test_a_search_takes_its_turn_between_requests(clock):
    get, asked = _routed({"/point/": _answer([]), "/callsign/": _answer([]), "/reg/": _answer([])})
    asked_at = []
    with patch("vfr.traffic.requests.get", side_effect=lambda url, **kw: (asked_at.append(clock.now), get(url))[1]):
        traffic.near(42.3, -88.1, 25)
        # A callsign with nothing, then the same as a registration: each
        # five seconds after the one before.
        assert traffic.find("FOO123") == []
    assert asked_at == [1000.0, 1005.0, 1010.0]


TRACE = {
    "icao": "a0b7d8", "r": "N14511", "t": "A21N", "desc": "AIRBUS A-321neo", "ownOp": "UNITED AIRLINES INC", "year": "2024",
    "timestamp": 1791656000.0,
    "trace": [
        # Yesterday's leg into the field, then this one: on the ground at
        # O'Hare, off, and climbing out west.
        [0.0, 20.17, -67.03, 33600, 466.7, 127.9, 2, -3136, None, "adsb_icao", 35825],
        [600.0, 41.97, -87.90, "ground", 12.0, 270.0, 0, 0, None, "adsb_icao", None],
        [660.0, 41.976, -87.93, 400, 150.0, 270.0, 0, 2000, None, "adsb_icao", 525],
        [720.0, 41.98, -88.00, 2500, 220.0, 270.0, 0, 2000, None, "adsb_icao", 2650],
    ],
}


def test_a_tracked_flight_is_what_it_is_where_it_took_off_and_its_track_since(clock, monkeypatch):
    monkeypatch.setattr(traffic, "_TRACES", {})
    monkeypatch.setattr(traffic.airports, "nearest", lambda lat, lon, limit=1: [
        {"ident": "KORD", "name": "Chicago O'Hare International Airport", "distance_nm": 0.4}])
    with patch("vfr.traffic.requests.get", return_value=Mock(status_code=200, json=Mock(return_value=TRACE))) as get:
        found = traffic.flight("A0B7D8")
        traffic.flight("a0b7d8")
    assert get.call_args.args[0] == "https://globe.adsb.lol/data/traces/d8/trace_full_a0b7d8.json"
    assert get.call_count == 1
    assert {k: found[k] for k in ("registration", "type", "description", "operator", "year")} == {
        "registration": "N14511", "type": "A21N", "description": "AIRBUS A-321neo", "operator": "UNITED AIRLINES INC", "year": "2024"}
    # Off the ground at its first point in the air, 660 s in.
    assert found["departed"] == {"ident": "KORD", "name": "Chicago O'Hare International Airport", "at": 1791656660}
    # This leg alone, from the ground; GNSS heights as the live reports'.
    assert [(p["lat"], p["alt_ft"]) for p in found["trail"]] == [(41.97, None), (41.976, 525.0), (41.98, 2650.0)]


def test_a_flight_whose_track_begins_in_the_air_or_away_from_a_field_says_no_departure(clock, monkeypatch):
    monkeypatch.setattr(traffic, "_TRACES", {})
    monkeypatch.setattr(traffic.airports, "nearest", lambda lat, lon, limit=1: [{"ident": "C81", "distance_nm": 7.0}])
    airborne = {**TRACE, "trace": [TRACE["trace"][0], TRACE["trace"][3]]}
    with patch("vfr.traffic.requests.get", return_value=Mock(status_code=200, json=Mock(return_value=airborne))):
        assert traffic.flight("a0b7d8")["departed"] is None
    monkeypatch.setattr(traffic, "_TRACES", {})
    with patch("vfr.traffic.requests.get", return_value=Mock(status_code=200, json=Mock(return_value=TRACE))):
        # On the ground seven miles from the nearest field: no airport.
        assert traffic.flight("a0b7d8")["departed"] is None


def test_a_flight_with_no_trace_is_drawn_without_its_past(clock, monkeypatch):
    monkeypatch.setattr(traffic, "_TRACES", {})
    with patch("vfr.traffic.requests.get", return_value=Mock(status_code=404)):
        found = traffic.flight("a0b7d8")
    assert found["trail"] == [] and found["departed"] is None and found["registration"] is None
