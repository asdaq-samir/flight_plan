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
        "seen_s": 0.291,
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
