"""vfr.traffic: adsb.lol's answer read into the map's airplanes, with
adsb.lol stubbed in its own shape (readsb's JSON, `ac`)."""
from unittest.mock import Mock, patch

import pytest
import requests

from vfr import traffic

CESSNA = {"hex": "a128b9", "type": "adsr_icao", "flight": "N174HA  ", "r": "N174HA", "t": "C172", "alt_baro": 1200,
          "alt_geom": 1325, "gs": 93.7, "track": 320.19, "baro_rate": -512, "geom_rate": -384, "lat": 42.001282,
          "lon": -88.145246, "seen_pos": 0.291}


@pytest.fixture(autouse=True)
def _fresh_cache(monkeypatch):
    monkeypatch.setattr(traffic, "_CACHE", {})
    monkeypatch.setattr(traffic, "_FAILED", {})


def _answer(entries):
    resp = Mock()
    resp.raise_for_status = Mock()
    resp.json = Mock(return_value={"msg": "No error", "ac": entries})
    return resp


def test_an_airplane_in_the_air_as_the_map_draws_it():
    with patch("vfr.traffic.requests.get", return_value=_answer([CESSNA])) as get:
        (cessna,) = traffic.near(42.3246, -88.0741, 25)
    assert get.call_args.args[0] == "https://api.adsb.lol/v2/point/42.32/-88.07/30"
    assert cessna == {
        "hex": "a128b9", "callsign": "N174HA", "registration": "N174HA", "type": "C172", "lat": 42.00128, "lon": -88.14525,
        # The GNSS height, as the phone's own is, and its climb.
        "altitude_ft": 1325.0, "pressure_altitude": False, "track_deg": 320.19, "speed_kt": 93.7, "vertical_fpm": -384.0,
        "seen_s": 0.291,
    }


def test_on_the_ground_without_a_position_or_with_an_old_one_is_left_out():
    entries = [
        {**CESSNA, "hex": "a1", "alt_baro": "ground"},
        {**CESSNA, "hex": "a2", "lat": None},
        {**CESSNA, "hex": "a3", "seen_pos": 45.0},
        {**CESSNA, "hex": "a4"},
    ]
    with patch("vfr.traffic.requests.get", return_value=_answer(entries)):
        assert [a["hex"] for a in traffic.near(42.3, -88.1, 25)] == ["a4"]


def test_a_pressure_altitude_alone_is_said_to_be_one():
    entry = {k: v for k, v in CESSNA.items() if k not in ("alt_geom", "geom_rate")}
    with patch("vfr.traffic.requests.get", return_value=_answer([entry])):
        (cessna,) = traffic.near(42.3, -88.1, 25)
    assert cessna["altitude_ft"] == 1200.0 and cessna["pressure_altitude"] is True and cessna["vertical_fpm"] == -512.0


def test_one_answer_serves_everyone_near_one_place_for_a_few_seconds():
    with patch("vfr.traffic.requests.get", return_value=_answer([CESSNA])) as get:
        traffic.near(42.3246, -88.0741, 24)
        traffic.near(42.3249, -88.0738, 22)
    assert get.call_count == 1


def test_the_radius_is_kept_within_what_is_asked_of_adsb_lol():
    with patch("vfr.traffic.requests.get", return_value=_answer([])) as get:
        traffic.near(42.3, -88.1, 1)
        traffic.near(42.3, -88.1, 400)
    assert [c.args[0].rsplit("/", 1)[1] for c in get.call_args_list] == ["10", "100"]


def test_adsb_lol_not_answering_is_said():
    with patch("vfr.traffic.requests.get", side_effect=requests.ConnectionError("down")):
        with pytest.raises(traffic.TrafficUnavailable):
            traffic.near(42.3, -88.1, 25)


def test_a_radius_is_rounded_up_to_reach_the_edge_of_the_view():
    with patch("vfr.traffic.requests.get", return_value=_answer([])) as get:
        traffic.near(42.3, -88.1, 25)
        traffic.near(42.4, -88.1, 14)
    assert [c.args[0].rsplit("/", 1)[1] for c in get.call_args_list] == ["30", "20"]


def test_a_failure_is_remembered_for_a_few_seconds():
    with patch("vfr.traffic.requests.get", side_effect=requests.ConnectionError("down")) as get:
        for _ in range(3):
            with pytest.raises(traffic.TrafficUnavailable):
                traffic.near(42.3, -88.1, 25)
    assert get.call_count == 1


def test_askers_at_once_share_one_request():
    import threading
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


def test_a_held_answer_is_older_by_the_time_it_has_been_held():
    plane = dict(CESSNA, seen_pos=2.0)
    with patch("vfr.traffic.requests.get", return_value=_answer([plane])), patch("vfr.traffic.time.monotonic", side_effect=[100.0, 103.0]):
        first = traffic.near(42.3, -88.1, 25)
        second = traffic.near(42.3, -88.1, 25)
    assert first[0]["seen_s"] == 2.0 and second[0]["seen_s"] == 5.0


def test_asks_of_adsb_lol_at_once_are_capped():
    for _ in range(traffic.MAX_UPSTREAM):
        traffic._UPSTREAM.acquire()
    try:
        with patch("vfr.traffic.requests.get") as get:
            with pytest.raises(traffic.TrafficUnavailable):
                traffic.near(42.3, -88.1, 25)
        assert get.call_count == 0
    finally:
        for _ in range(traffic.MAX_UPSTREAM):
            traffic._UPSTREAM.release()
