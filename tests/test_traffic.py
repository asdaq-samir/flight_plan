"""vfr.traffic: adsb.lol's answer read into the map's airplanes, and how
often adsb.lol is asked, with adsb.lol stubbed in its own shape (readsb's
JSON, `ac`) and the clock stood in for."""
import json
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
    monkeypatch.setattr(traffic, "_STATE", {"next_ask": 0.0, "last_ask": -1e9, "search_at": -1e9, "blocked_until": -1e9})
    monkeypatch.setattr(traffic, "_FLIGHTS", {})
    monkeypatch.setattr(traffic, "_FOUND", traffic.TTLCache(maxsize=256, ttl=traffic.FOUND_TTL_S, timer=clock))
    monkeypatch.setattr(traffic, "_FIND_GATES", {})
    monkeypatch.setattr(traffic, "_RECENT", traffic.TTLCache(maxsize=256, ttl=traffic.RECENT_TTL_S, timer=clock))
    # The FAA's registry, wherever a copy is on disk, is not this module's.
    monkeypatch.setattr(traffic.registry, "lookup", lambda **kwargs: None)
    # Nor the world's fields, which a past flight's ends fall back to.
    monkeypatch.setattr(traffic.airports, "nearest_abroad", lambda lat, lon, limit=3: [])
    monkeypatch.setattr(traffic, "_clock", clock)
    monkeypatch.setattr(traffic, "_sleep", clock.sleep)
    monkeypatch.setattr(traffic, "_WATCHED", {})
    monkeypatch.setattr(traffic, "_WATCH_ASKED", {})
    monkeypatch.setattr(traffic, "_RECORDED", {})
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
        "seen_s": 0.291, "squawk": None, "emergency": None, "category": None,
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
    # The recent trace cannot be read here, so an address is asked of the API too.
    get, asked = _routed({"/callsign/UAL2088": _answer([{**CESSNA, "flight": "UAL2088 ", "squawk": "3324"}]),
                          "/reg/N174HA": _answer([CESSNA]), "/hex/a128b9": _answer([CESSNA]), "trace_recent_": _status(503)})
    with patch("vfr.traffic.requests.get", side_effect=get):
        (ual,) = traffic.find("ual 2088")
        assert ual["callsign"] == "UAL2088" and ual["squawk"] == "3324" and ual["emergency"] is None
        assert [a["hex"] for a in traffic.find("N174HA")] == ["a128b9"]
        assert [a["hex"] for a in traffic.find("A128B9")] == ["a128b9"]
    assert [u.rsplit("/", 2)[-2:] for u in asked] == [
        ["callsign", "UAL2088"], ["reg", "N174HA"], ["b9", "trace_recent_a128b9.json"], ["hex", "a128b9"]]


def _status(code, body=None):
    resp = Mock()
    resp.status_code = code
    resp.json = Mock(return_value=body)
    return resp


#: A Cessna's last minutes as adsb.lol's globe writes them: its callsign
#: and squawk in the one point that carries details, the last 4 s old.
RECENT = {
    "icao": "a128b9", "r": "N174HA", "t": "C172", "timestamp": 1791800000.0,
    "trace": [
        [100.0, 42.29, -88.14, 1300, 92.0, 321.0, 0, -320, {"flight": "N174HA  ", "squawk": "1200", "emergency": "none"},
         "adsb_icao", 1425, -256],
        [116.0, 42.301282, -88.145246, 1200, 93.7, 320.19, 0, -512, None, "adsb_icao", 1325, -384],
    ],
}


def test_an_airplane_named_by_its_address_or_n_number_is_found_from_its_recent_trace_without_the_api(clock, monkeypatch):
    """The owner's searches waited behind the map's requests to the API
    (2026-10-12): by address, or an N-number the registry gives one, the
    globe's recent trace answers instead, a static file that takes no turn."""
    monkeypatch.setattr(traffic, "_wall", lambda: 1791800120.0)
    monkeypatch.setattr(traffic.registry, "lookup", lambda **kw: {"n_number": "N174HA", "mode_s_hex": "A128B9"})
    # Behind a refusal's back-off, where the API would not be asked at all.
    traffic._STATE["blocked_until"] = clock.now + 60
    get, asked = _routed({"trace_recent_a128b9": _status(200, RECENT)})
    with patch("vfr.traffic.requests.get", side_effect=get):
        (plane,) = traffic.find("N174HA")
        assert traffic.find("a128b9") == [plane]
    assert plane["hex"] == "a128b9" and plane["callsign"] == "N174HA" and plane["squawk"] == "1200"
    assert (plane["lat"], plane["lon"], plane["altitude_ft"], plane["speed_kt"]) == (42.30128, -88.14525, 1325, 93.7)
    assert plane["vertical_fpm"] == -384 and plane["seen_s"] == 4.0
    # The trace read once: the address's search found the N-number's answer kept.
    assert asked == ["https://adsb.lol/data/traces/b9/trace_recent_a128b9.json"]


@pytest.mark.parametrize("answer", [
    _status(404),
    # On the ground at its last point.
    _status(200, {**RECENT, "trace": [[116.0, 42.3, -88.1, "ground", 3.0, 90.0, 0, 0, None, "adsb_icao", None]]}),
    # Last heard a minute ago: somewhere else by now.
    _status(200, {**RECENT, "timestamp": 1791800000.0 - 60}),
])
def test_an_airplane_whose_recent_trace_has_it_down_or_gone_is_not_in_the_air(clock, monkeypatch, answer):
    monkeypatch.setattr(traffic, "_wall", lambda: 1791800120.0)
    get, asked = _routed({"trace_recent_a128b9": answer})
    with patch("vfr.traffic.requests.get", side_effect=get):
        assert traffic.find("A128B9") == []
    assert len(asked) == 1


def test_a_search_takes_its_turn_between_requests(clock):
    get, asked = _routed({"/point/": _answer([]), "/callsign/": _answer([]), "/reg/": _answer([])})
    asked_at = []
    with patch("vfr.traffic.requests.get", side_effect=lambda url, **kw: (asked_at.append(clock.now), get(url))[1]):
        traffic.near(42.3, -88.1, 25)
        # A callsign with nothing, then the same as a registration: each
        # five seconds after the one before.
        assert traffic.find("FOO123") == []
    assert asked_at == [1000.0, 1005.0, 1010.0]


def test_an_airplane_heard_about_a_region_is_found_there_at_once(clock):
    with patch("vfr.traffic.requests.get", return_value=_answer([CESSNA])):
        traffic.near(42.3, -88.1, 25)
    clock.now += 20
    with patch("vfr.traffic.requests.get") as get:
        (by_reg,) = traffic.find("N174HA")
        (by_hex,) = traffic.find("a128b9")
        (by_callsign,) = traffic.find("n174ha")
    assert get.call_count == 0
    assert by_reg["hex"] == by_hex["hex"] == by_callsign["hex"] == "a128b9"
    # How old its position is, counted from now: the region's answer is 20 s old.
    assert by_reg["seen_s"] == 20.3


def test_a_search_goes_ahead_of_the_regions_turns(clock):
    get, asked = _routed({"/point/": _answer([]), "/callsign/": _answer([]), "/reg/": _answer([])})
    asked_at = []
    def timed(url, **kwargs):
        asked_at.append((clock.now, url.split("/v2/")[1].split("/")[0]))
        return get(url)

    with patch("vfr.traffic.requests.get", side_effect=timed):
        traffic.near(42.3, -88.1, 25)
        clock.now += 1
        assert traffic.find("FOO123") == []
        # A region with nothing of its own takes the turn after the search's.
        traffic.near(45.0, -93.0, 25)
    assert asked_at == [(1000.0, "point"), (1005.0, "callsign"), (1010.0, "reg"), (1015.0, "point")]


def test_a_region_whose_turn_a_search_took_gives_way(clock, monkeypatch):
    with patch("vfr.traffic.requests.get", return_value=_answer([CESSNA])):
        traffic.near(42.3, -88.1, 25)
    asked_at = []
    sleeps = []

    def sleep(seconds):
        # While the region waits for its turn, a search takes one a second after it.
        if not sleeps:
            traffic._STATE["search_at"] = clock.now + seconds + 1
        sleeps.append(seconds)
        clock.sleep(seconds)

    monkeypatch.setattr(traffic, "_sleep", sleep)
    with patch("vfr.traffic.requests.get", side_effect=lambda *a, **kw: (asked_at.append(clock.now), _answer([]))[1]):
        clock.now += 1
        # Another region, with no answer to give: it waits for a turn after the search's.
        traffic.near(45.0, -93.0, 25)
    assert asked_at == [1011.0]


def test_a_search_answer_is_given_again_for_a_few_seconds(clock):
    with patch("vfr.traffic.requests.get", return_value=_answer([{**CESSNA, "flight": "UAL2088 ", "r": "N14511", "hex": "a0b7d8"}])) as get:
        assert [a["hex"] for a in traffic.find("UAL2088")] == ["a0b7d8"]
        clock.now += 10
        assert [a["hex"] for a in traffic.find("UAL2088")] == ["a0b7d8"]
        assert get.call_count == 1
        clock.now += traffic.FOUND_TTL_S
        traffic.find("UAL2088")
        assert get.call_count == 2


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
    assert get.call_args.args[0] == "https://adsb.lol/data/traces/d8/trace_full_a0b7d8.json"
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


def test_a_flight_that_has_landed_is_its_flight_to_the_landing_not_the_parked_tail(clock, monkeypatch):
    monkeypatch.setattr(traffic, "_TRACES", {})
    monkeypatch.setattr(traffic.airports, "nearest", lambda lat, lon, limit=1: [
        {"ident": "KORD", "name": "Chicago O'Hare International Airport", "distance_nm": 0.4}])
    parked = {**TRACE, "trace": TRACE["trace"] + [
        [800.0, 41.97, -87.90, "ground", 10.0, 90.0, 0, 0, None, "adsb_icao", None],
        [900.0, 41.97, -87.90, "ground", 0.0, 90.0, 0, 0, None, "adsb_icao", None]]}
    with patch("vfr.traffic.requests.get", return_value=Mock(status_code=200, json=Mock(return_value=parked))):
        found = traffic.flight("a0b7d8")
    # Departed when it left the ground, 660 s in; the trail ends at its landing.
    assert found["departed"]["at"] == 1791656660
    assert [p["t"] for p in found["trail"]] == [1791656600.0, 1791656660.0, 1791656720.0, 1791656800.0]


def test_a_trace_that_could_not_be_had_is_asked_again_not_kept(clock, monkeypatch):
    monkeypatch.setattr(traffic, "_TRACES", {})
    # The trace's reads alone: a card with no trail also asks for the
    # airplane itself (`_watch`, its own test below).
    monkeypatch.setattr(traffic, "_watch", lambda hex_id: None)
    with patch("vfr.traffic.requests.get", side_effect=requests.Timeout("slow")) as get:
        assert traffic.flight("a0b7d8")["trail"] == []
        assert traffic.flight("a0b7d8")["trail"] == []
    assert get.call_count == 2
    with patch("vfr.traffic.requests.get", return_value=Mock(status_code=429)) as get:
        traffic.flight("a0b7d8")
        traffic.flight("a0b7d8")
    assert get.call_count == 2


def test_a_trace_that_is_not_an_object_or_has_short_points_is_drawn_without_its_past(clock, monkeypatch):
    monkeypatch.setattr(traffic, "_TRACES", {})
    with patch("vfr.traffic.requests.get", return_value=Mock(status_code=200, json=Mock(return_value=[1, 2]))):
        assert traffic.flight("a0b7d8")["trail"] == []
    monkeypatch.setattr(traffic, "_TRACES", {})
    monkeypatch.setattr(traffic.airports, "nearest", lambda lat, lon, limit=1: [])
    short = {**TRACE, "trace": [[0.0, 41.9, -87.9], *TRACE["trace"]]}
    with patch("vfr.traffic.requests.get", return_value=Mock(status_code=200, json=Mock(return_value=short))):
        assert len(traffic.flight("a0b7d8")["trail"]) == 3


UAL2088_ROUTE = {
    "callsign": "UAL2088", "airport_codes": "TJSJ-KORD",
    "_airports": [
        {"name": "Luis Munoz Marin International Airport", "icao": "TJSJ", "iata": "SJU", "location": "San Juan",
         "lat": 18.4394, "lon": -66.001801},
        {"name": "Chicago O'Hare International Airport", "icao": "KORD", "iata": "ORD", "location": "Chicago",
         "lat": 41.9786, "lon": -87.9048},
    ],
}


def test_a_flight_numbers_route_and_whether_the_airplane_is_on_it(clock, monkeypatch):
    monkeypatch.setattr(traffic, "_ROUTES", traffic.TTLCache(maxsize=16, ttl=60, timer=clock))
    asked = []

    def get(url, *args, **kwargs):
        asked.append(url.rsplit("/routes/", 1)[1])
        resp = Mock(status_code=404 if "DAL1" in url else 200)
        resp.raise_for_status = Mock()
        resp.json = Mock(return_value=UAL2088_ROUTE)
        return resp

    with patch("vfr.traffic.requests.get", side_effect=get):
        # Over Kentucky, near the great circle from San Juan to O'Hare.
        on = traffic.route("ual 2088", 37.5, -84.9)
        assert [a["ident"] for a in on["airports"]] == ["TJSJ", "KORD"] and on["plausible"] is True
        # Over Denver it is not flying that route today.
        assert traffic.route("UAL2088", 39.86, -104.67)["plausible"] is False
        assert traffic.route("UAL2088")["plausible"] is None
        # Not an airline's flight number, or one the database does not know.
        assert traffic.route("N174HA", 42.3, -88.1) is None
        assert traffic.route("DAL1") is None
        assert traffic.route("DAL1") is None
    # Each asked once: the route kept, and a 404 too.
    assert asked == ["UA/UAL2088.json", "DA/DAL1.json"]


def test_the_faa_record_of_an_airplane_named_by_its_n_number_or_address(clock, monkeypatch):
    asked = []
    monkeypatch.setattr(traffic.registry, "lookup", lambda **kw: asked.append(kw) or {"n_number": "N654FL"})
    assert traffic.registered("n654fl") == {"n_number": "N654FL"}
    assert traffic.registered("A89C1E") == {"n_number": "N654FL"}
    # Not an N-number or an address: a callsign has no registration to look up.
    assert traffic.registered("UAL2088") is None
    # adsb.lol's "~" pseudo-address goes on unstripped, for registry.lookup to refuse.
    traffic.registered("~a89c1e")
    assert asked == [{"n_number": "N654FL"}, {"hex_id": "a89c1e"}, {"hex_id": "~a89c1e"}]


def test_a_view_zoomed_out_further_than_sixty_nm_is_asked_of_a_wide_region(clock):
    """The traffic wherever the map is panned, the owner's ask: a view of
    a state, out to 165 nm, from a region two degrees square asked for out
    to 250 nm, adsb.lol's furthest; and kept apart from the near regions'."""
    far = {**CESSNA, "hex": "far", "lat": 44.3}           # 120 nm north of 42.3
    with patch("vfr.traffic.requests.get", return_value=_answer([CESSNA, far])) as get:
        wide = traffic.near(42.3, -88.1, 150)["aircraft"]
        widest = traffic.near(42.3, -88.1, 400)["aircraft"]
    assert get.call_args_list[0].args[0] == "https://api.adsb.lol/v2/point/42.00/-88.00/250"
    assert [a["hex"] for a in wide] == ["a128b9", "far"] and [a["hex"] for a in widest] == ["a128b9", "far"]
    # The same wide region for both, within five seconds: one request.
    assert get.call_count == 1
    clock.now += traffic.MIN_GAP_S
    with patch("vfr.traffic.requests.get", return_value=_answer([CESSNA])) as get:
        traffic.near(42.3, -88.1, 40)
    assert get.call_args.args[0] == "https://api.adsb.lol/v2/point/42.50/-88.00/80"


# --- Past flights ---

def _trace_of(base: float, rows: list) -> dict:
    """A readsb trace: [seconds, lat, lon, altitude, gs, track, flags, vrate, ...]."""
    return {"icao": "a89c1e", "r": "N654FL", "t": "P28A", "timestamp": base, "trace": rows}


def _fly(t0: float, t1: float, start: tuple, end: tuple, low: float, high: float, track: float) -> list:
    """A flight heard each minute from `start` to `end`: climbing from `low`
    to `high` in its first quarter and down to `low` in its last."""
    rows, n = [], int((t1 - t0) // 60)
    for i in range(n + 1):
        f = i / n
        alt = low + (high - low) * min(1.0, f * 4, (1 - f) * 4)
        rows.append([t0 + i * 60, start[0] + (end[0] - start[0]) * f, start[1] + (end[1] - start[1]) * f,
                     round(alt), 100, track, 0, 0])
    return rows


LACONIA = {"ident": "LCI", "name": "Laconia Municipal Airport", "municipality": "Laconia", "region": "US-NH",
           "elevation_ft": 545.0, "distance_nm": 0.6, "bearing_deg": 0}
LAWRENCE = {"ident": "LWM", "name": "Lawrence Municipal Airport", "municipality": "Lawrence", "region": "US-MA",
            "elevation_ft": 148.0, "distance_nm": 1.1, "bearing_deg": 0}


def _nearest(lat, lon, limit=3):
    """LCI near 43.57 N, LWM near 42.72 N, nothing between."""
    if lat > 43.4:
        return [LACONIA]
    if lat < 42.9:
        return [LAWRENCE]
    return [{**LACONIA, "distance_nm": 40.0}]


def test_an_airplanes_flights_are_its_trace_cut_where_it_went_unheard_and_named_by_their_fields(clock, monkeypatch):
    """N654FL's morning as FlightAware lists it: LWM to LCI, an hour on the
    ground unheard at Laconia, then LCI back to LWM; each heard first and last
    low by its field, newest first."""
    import datetime as dt

    base = 1791676800.0                                  # 2026-10-11 00:00 UTC
    lwm, lci = (42.72, -71.12), (43.57, -71.42)
    rows = _fly(11 * 3600 + 21 * 60, 12 * 3600 + 8 * 60, lwm, lci, 600, 4500, 10) \
        + _fly(13 * 3600 + 4 * 60, 15 * 3600 + 17 * 60, lci, lwm, 800, 5000, 190)
    monkeypatch.setattr(traffic, "_trace", lambda hex_id: _trace_of(base, rows))
    monkeypatch.setattr(traffic, "_day_trace", lambda hex_id, day: None)
    monkeypatch.setattr(traffic.airports, "nearest", _nearest)
    monkeypatch.setattr(traffic.time, "time", lambda: base + 20 * 3600)
    found = traffic.history("A89C1E", today=dt.date(2026, 10, 11))
    assert found["registration"] == "N654FL" and found["type"] == "P28A"
    assert [(f["origin"]["ident"], f["destination"]["ident"]) for f in found["flights"]] == [("LCI", "LWM"), ("LWM", "LCI")]
    newest = found["flights"][0]
    assert newest["off"] == base + 13 * 3600 + 4 * 60 and newest["on"] == base + 15 * 3600 + 17 * 60
    assert newest["landed"] is True and newest["in_air"] is False and newest["max_alt_ft"] == 5000
    # Its points, for the track log and the replay.
    flight = traffic.past_flight("a89c1e", newest["id"], today=dt.date(2026, 10, 11))
    assert flight["points"][0]["t"] == newest["off"] and flight["points"][-1]["t"] == newest["on"]
    assert max(p["alt_ft"] for p in flight["points"]) == 5000
    assert flight["points"][0]["gs_kt"] == 100 and flight["points"][1]["track_deg"] == 190
    assert traffic.past_flight("a89c1e", 123, today=dt.date(2026, 10, 11)) is None


def test_a_flight_heard_last_high_on_its_way_has_no_arrival_and_one_heard_now_is_in_the_air(clock, monkeypatch):
    import datetime as dt

    base = 1791676800.0
    lwm, lci, between = (42.72, -71.12), (43.57, -71.42), (43.10, -71.30)
    # Last heard between the fields, high; then one from LCI heard now.
    rows = _fly(3600, 3600 + 30 * 60, lwm, between, 600, 4500, 10)[:24] \
        + _fly(6 * 3600, 6 * 3600 + 20 * 60, lci, between, 800, 5000, 190)[:12]
    monkeypatch.setattr(traffic, "_trace", lambda hex_id: _trace_of(base, rows))
    monkeypatch.setattr(traffic, "_day_trace", lambda hex_id, day: None)
    monkeypatch.setattr(traffic.airports, "nearest", _nearest)
    monkeypatch.setattr(traffic.time, "time", lambda: base + 6 * 3600 + 13 * 60)
    flights = traffic.history("a89c1e", today=dt.date(2026, 10, 11))["flights"]
    assert flights[0]["in_air"] is True and flights[0]["destination"] is None and flights[0]["origin"]["ident"] == "LCI"
    assert flights[1]["destination"] is None and flights[1]["landed"] is False and flights[1]["origin"]["ident"] == "LWM"


def test_a_past_days_trace_is_read_from_the_archive_once(clock):
    import datetime as dt

    traffic._DAYS.clear()
    day = dt.date(2026, 10, 10)
    with patch("vfr.traffic.requests.get", return_value=_answer([])) as get:
        get.return_value.status_code = 200
        get.return_value.json = Mock(return_value=_trace_of(1791590400.0, []))
        assert traffic._day_trace("a89c1e", day)["r"] == "N654FL"
        traffic._day_trace("a89c1e", day)
    assert get.call_count == 1
    assert get.call_args.args[0] == "https://adsb.lol/globe_history/2026/10/10/traces/1e/trace_full_a89c1e.json"


def test_a_flight_last_heard_heading_down_to_a_field_further_out_landed_there(clock, monkeypatch):
    """N654FL's LWM to LCI, 2026-10-11: last heard 6 nm out and 1,600 ft over
    Laconia, levelled off for the pattern but headed straight at it."""
    monkeypatch.setattr(traffic.airports, "nearest", lambda lat, lon, limit=3: [
        {**LACONIA, "distance_nm": 6.1, "bearing_deg": 247}])
    last = {"lat": 43.6127, "lon": -71.2897, "alt_ft": 2175.0, "track_deg": 246.2, "vrate_fpm": -64.0}
    assert traffic._field_at(last, landing=True)["ident"] == "LCI"
    # Headed away from it, or high over it, it is only passing.
    assert traffic._field_at({**last, "track_deg": 66.0}, landing=True) is None
    assert traffic._field_at({**last, "alt_ft": 6000.0}, landing=True) is None


def test_a_past_day_that_could_not_be_read_is_counted_not_taken_for_no_flights(clock, monkeypatch):
    import datetime as dt

    traffic._DAYS.clear()
    monkeypatch.setattr(traffic, "_trace", lambda hex_id: None)
    with patch("vfr.traffic.requests.get", side_effect=requests.Timeout("slow")):
        found = traffic.history("a89c1e", today=dt.date(2026, 10, 11))
    # A fortnight asked for, today's from the recent trace and thirteen days before.
    assert found["flights"] == [] and found["unread_days"] == traffic.HISTORY_DAYS_PER_ASK - 1
    # And asked again next time, not kept as a day without a trace.
    assert not traffic._DAYS


def _days_of_flights(per_day: int):
    """`_day_trace` for an airplane that flies `per_day` hops LWM-LCI every
    day, each an hour, from 08:00 UTC; and the days asked for."""
    import datetime as dt

    asked = []
    lwm, lci = (42.72, -71.12), (43.57, -71.42)

    def day_trace(hex_id, day):
        asked.append(day)
        base = dt.datetime(day.year, day.month, day.day, tzinfo=dt.timezone.utc).timestamp()
        rows = []
        for n in range(per_day):
            there, back = (lwm, lci) if n % 2 == 0 else (lci, lwm)
            rows += _fly(8 * 3600 + n * 7200, 9 * 3600 + n * 7200, there, back, 600, 4500, 10)
        return _trace_of(base, rows)
    return day_trace, asked


def test_the_last_ten_flights_found_and_the_ten_before_them_from_where_it_left_off(clock, monkeypatch):
    """The owner's ask: the last ten flights found, whatever the days, and
    more on asking, from where the list ends."""
    import datetime as dt

    day_trace, asked = _days_of_flights(3)
    monkeypatch.setattr(traffic, "_day_trace", day_trace)
    monkeypatch.setattr(traffic, "_trace", lambda hex_id: None)
    monkeypatch.setattr(traffic.airports, "nearest", _nearest)
    today = dt.date(2026, 10, 11)
    first = traffic.history("a89c1e", today=today)
    assert len(first["flights"]) == traffic.HISTORY_FLIGHTS
    # Newest first, three a day back from yesterday: the tenth on the 7th.
    offs = [f["off"] for f in first["flights"]]
    assert offs == sorted(offs, reverse=True)
    last = first["flights"][-1]
    assert dt.datetime.fromtimestamp(last["id"], dt.timezone.utc).date() == dt.date(2026, 10, 7)
    # Read a week side by side, not more than it took.
    assert min(asked) >= today - dt.timedelta(days=traffic.HISTORY_BATCH)
    assert first["next_until"] == "2026-10-07"
    # The ten before: none of the first ten again, and in order after them.
    more = traffic.history("a89c1e", until=dt.date.fromisoformat(first["next_until"]), before=last["id"], today=today)
    assert len(more["flights"]) == traffic.HISTORY_FLIGHTS
    assert max(f["off"] for f in more["flights"]) < last["off"]
    assert not {f["id"] for f in more["flights"]} & {f["id"] for f in first["flights"]}


def test_an_airplane_that_seldom_flies_is_looked_for_a_fortnight_at_a_time(clock, monkeypatch):
    import datetime as dt

    day_trace, asked = _days_of_flights(0)
    monkeypatch.setattr(traffic, "_day_trace", day_trace)
    monkeypatch.setattr(traffic, "_trace", lambda hex_id: None)
    today = dt.date(2026, 10, 11)
    found = traffic.history("a89c1e", today=today)
    assert found["flights"] == [] and len(asked) == traffic.HISTORY_DAYS_PER_ASK - 1
    assert found["next_until"] == (today - dt.timedelta(days=traffic.HISTORY_DAYS_PER_ASK)).isoformat()
    # A date picked: from that day back.
    asked.clear()
    traffic.history("a89c1e", until=dt.date(2026, 9, 20), today=today)
    assert max(asked) == dt.date(2026, 9, 20)
    # And past the archive's reach nothing is asked, and nothing is said to be older.
    asked.clear()
    old = traffic.history("a89c1e", until=today - dt.timedelta(days=traffic.ARCHIVE_DAYS + 5), today=today)
    assert asked == [] and old["next_until"] is None


def test_a_view_panned_into_a_new_region_while_adsb_lol_waits_is_given_a_region_that_holds_it(clock):
    """Over Indiana zoomed out, then in on Lafayette while adsb.lol was
    turning the planner away: the wide region's answer, not a 503."""
    with patch("vfr.traffic.requests.get", return_value=_answer([CESSNA])):
        traffic.near(40.0, -86.0, 150)                      # the wide region, out to 250 nm
    clock.now += traffic.MIN_GAP_S
    with patch("vfr.traffic.requests.get", return_value=_turned_away()):
        with pytest.raises(traffic.TrafficUnavailable):
            traffic._region_answer(traffic._region(41.0, -87.0, 150))   # another wide region, refused
    # Now in the back-off: a near view by Lafayette is held by the first wide region's answer.
    with patch("vfr.traffic.requests.get") as get:
        found = traffic.near(40.4, -86.9, 30)
    assert get.call_count == 0 and found["age_s"] == traffic.MIN_GAP_S
    # One no answer holds still says so.
    with pytest.raises(traffic.TrafficUnavailable):
        traffic.near(30.0, -97.0, 30)


def test_a_flight_abroad_is_named_by_its_own_airports(clock, monkeypatch):
    """A Vueling A320 over Spain: no US field near, so Barcelona's."""
    monkeypatch.setattr(traffic.airports, "nearest", lambda lat, lon, limit=3: [{**LACONIA, "distance_nm": 3000.0}])
    monkeypatch.setattr(traffic.airports, "nearest_abroad", lambda lat, lon, limit=3: [
        {"ident": "LEBL", "name": "Josep Tarradellas Barcelona-El Prat Airport", "municipality": "Barcelona", "region": "ES-CT",
         "elevation_ft": 12.0, "distance_nm": 1.5, "bearing_deg": 70}])
    landing = {"lat": 41.29, "lon": 2.05, "alt_ft": 900.0, "track_deg": 70.0, "vrate_fpm": -700.0}
    assert traffic._field_at(landing, landing=True)["ident"] == "LEBL"


def test_an_airplane_is_based_where_most_of_its_flights_begin_and_end(clock, monkeypatch):
    lci, lwm, mht = ({"ident": i, "name": i, "city": None, "region": None} for i in ("LCI", "LWM", "MHT"))
    hop = lambda a, b: {"origin": a, "destination": b, "landed": True}  # noqa: E731
    # Out and back from Lawrence, one trip to Laconia.
    assert traffic._base_of([hop(lwm, lci), hop(lci, lwm), hop(lwm, mht), hop(mht, lwm)])["ident"] == "LWM"
    # Too few flights to say, or no field it keeps to.
    assert traffic._base_of([hop(lwm, lci)]) is None
    assert traffic._base_of([hop(lwm, lci), hop(mht, {"ident": "BOS"}), hop({"ident": "ORH"}, {"ident": "PVD"})]) is None


def test_the_bases_asked_for_are_given_as_they_are_found(clock, monkeypatch):
    lwm = {"ident": "LWM", "name": "Lawrence", "city": None, "region": None}
    monkeypatch.setattr(traffic, "_BASED", traffic.TTLCache(maxsize=16, ttl=60))
    monkeypatch.setattr(traffic, "_BASED_PENDING", set())
    looked = []

    class Now:
        """The pool, run at once."""
        def submit(self, fn, *args):
            looked.append(args[0])
            fn(*args)

    monkeypatch.setattr(traffic, "_BASED_POOL", Now())
    monkeypatch.setattr(traffic, "history", lambda hex_id: {"flights": [
        {"origin": lwm, "destination": lwm, "landed": True}] * 3})
    first = traffic.based(["A89C1E", "~abcdef", "nothex"])
    # Not known yet: looked up (the address only, not a pseudo-address or
    # what is not one), and said to be pending.
    assert first == {"based": {}, "pending": ["a89c1e"]}
    # Kept: the next ask is answered from what was found, not looked up again.
    again = traffic.based(["a89c1e"])
    assert again == {"based": {"a89c1e": lwm}, "pending": []}
    assert looked == ["a89c1e"]


@pytest.fixture
def adsbx(clock, monkeypatch, tmp_path):
    """ADS-B Exchange keyed, its month's count kept in a scratch file."""
    monkeypatch.setenv("ADSBX_RAPIDAPI_KEY", "test-key")
    monkeypatch.setattr(traffic, "ADSBX_USAGE_FILE", tmp_path / "adsbx_usage.json")
    monkeypatch.setattr(traffic, "_ADSBX", {"last": -1e9})
    monkeypatch.setattr(traffic, "_FROM_ADSBX", set())
    monkeypatch.setattr(traffic, "_wall", lambda: 1791800000.0)
    return tmp_path / "adsbx_usage.json"


def test_where_adsb_lol_turns_us_away_ads_b_exchange_answers_and_is_credited(adsbx, clock):
    get, asked = _routed({"api.adsb.lol": _turned_away(), "adsbexchange-com1": _answer([CESSNA])})
    with patch("vfr.traffic.requests.get", side_effect=get):
        found = traffic.near(42.3246, -88.0741, 25)
    assert [a["hex"] for a in found["aircraft"]] == ["a128b9"]
    assert found["source"] == "ADS-B Exchange"
    assert asked[-1] == "https://adsbexchange-com1.p.rapidapi.com/v2/lat/42.50/lon/-88.00/dist/80/"
    # Counted against the month, on disk.
    assert json.loads(adsbx.read_text()) == {"2026-10": 1}


def test_ads_b_exchange_is_asked_no_more_than_its_gap_and_its_month_allow(adsbx, clock, monkeypatch):
    get, asked = _routed({"api.adsb.lol": _turned_away(), "adsbexchange-com1": _answer([CESSNA])})
    with patch("vfr.traffic.requests.get", side_effect=get):
        traffic.near(42.3, -88.1, 25)
        # Another region at once: within the gap, not asked; nothing to give.
        with pytest.raises(traffic.TrafficUnavailable):
            traffic.near(45.0, -93.0, 25)
        clock.now += traffic.ADSBX_MIN_GAP_S
        # The month spent: not asked either.
        adsbx.write_text(json.dumps({"2026-10": traffic.ADSBX_MONTHLY}))
        with pytest.raises(traffic.TrafficUnavailable):
            traffic.near(45.0, -93.0, 25)
    assert sum("adsbexchange" in u for u in asked) == 1


def test_a_search_adsb_lol_cannot_take_now_is_asked_of_ads_b_exchange_at_once(adsbx, clock):
    traffic._STATE["blocked_until"] = clock.now + 60
    # A region asked of it a moment ago: a search is not held to that gap.
    traffic._ADSBX["last"] = clock.now
    get, asked = _routed({"adsbexchange-com1.p.rapidapi.com/v2/callsign/UAL2088": _answer([{**CESSNA, "flight": "UAL2088 "}])})
    with patch("vfr.traffic.requests.get", side_effect=get):
        (ual,) = traffic.find("UAL2088")
    assert ual["callsign"] == "UAL2088"
    assert asked == ["https://adsbexchange-com1.p.rapidapi.com/v2/callsign/UAL2088/"]


def test_without_a_key_ads_b_exchange_is_never_asked(clock, monkeypatch):
    monkeypatch.delenv("ADSBX_RAPIDAPI_KEY", raising=False)
    get, asked = _routed({"api.adsb.lol": _turned_away()})
    with patch("vfr.traffic.requests.get", side_effect=get), pytest.raises(traffic.TrafficUnavailable):
        traffic.near(42.3, -88.1, 25)
    assert not any("adsbexchange" in u for u in asked)


def test_a_search_is_asked_of_ads_b_exchange_first_by_what_the_name_is_and_credited(adsbx, clock, monkeypatch):
    # The owner's ask: ADS-B Exchange for a search, so it is fast -- one
    # request, by the address an N-number has in the FAA's registry, by a
    # callsign for a flight number, by registration for another country's.
    monkeypatch.setattr(traffic.registry, "lookup", lambda **kw: {"mode_s_hex": "A128B9"} if kw.get("n_number") == "N174HA" else None)
    get, asked = _routed({
        "adsbexchange-com1.p.rapidapi.com/v2/icao/a128b9": _answer([CESSNA]),
        "adsbexchange-com1.p.rapidapi.com/v2/callsign/UAL2088": _answer([{**CESSNA, "hex": "a0b7d8", "flight": "UAL2088 "}]),
        "adsbexchange-com1.p.rapidapi.com/v2/registration/G-ABCD": _answer([{**CESSNA, "hex": "400abc", "r": "G-ABCD"}]),
    })
    with patch("vfr.traffic.requests.get", side_effect=get):
        found, credit = traffic.find_credited("N174HA")
        assert [a["hex"] for a in found] == ["a128b9"] and credit == traffic.ADSBX_SOURCE
        assert [a["hex"] for a in traffic.find("UAL2088")] == ["a0b7d8"]
        assert [a["hex"] for a in traffic.find("G-ABCD")] == ["400abc"]
    assert asked == [
        "https://adsbexchange-com1.p.rapidapi.com/v2/icao/a128b9/",
        "https://adsbexchange-com1.p.rapidapi.com/v2/callsign/UAL2088/",
        "https://adsbexchange-com1.p.rapidapi.com/v2/registration/G-ABCD/",
    ]
    assert json.loads(adsbx.read_text()) == {"2026-10": 3}


def test_an_address_ads_b_exchange_does_not_have_is_read_from_the_free_recent_trace(adsbx, clock):
    get, asked = _routed({
        "adsbexchange-com1.p.rapidapi.com/v2/icao/a128b9": _answer([]),
        "adsb.lol/data/traces/b9/trace_recent_a128b9.json": _status(200, RECENT),
    })
    with patch("vfr.traffic.requests.get", side_effect=get):
        found, credit = traffic.find_credited("a128b9")
    assert credit == traffic.ADSB_LOL_SOURCE
    assert [u.split("/")[2] for u in asked] == ["adsbexchange-com1.p.rapidapi.com", "adsb.lol"]
    assert [a["hex"] for a in found] == ["a128b9"]


def test_with_the_months_requests_spent_a_search_goes_to_adsb_lol_as_before(adsbx, clock):
    adsbx.write_text(json.dumps({"2026-10": traffic.ADSBX_MONTHLY}))
    get, asked = _routed({"api.adsb.lol/v2/callsign/UAL2088": _answer([{**CESSNA, "flight": "UAL2088 "}])})
    with patch("vfr.traffic.requests.get", side_effect=get):
        found, credit = traffic.find_credited("UAL2088")
    assert credit == traffic.ADSB_LOL_SOURCE and len(found) == 1
    assert not any("adsbexchange" in u for u in asked)


def test_the_months_count_follows_what_rapidapi_says_the_key_has_used(adsbx, clock):
    # The key spent elsewhere too: RapidAPI's own count, on each answer.
    answer = _answer([CESSNA])
    answer.headers = {"x-ratelimit-api-requests-limit": "10000", "x-ratelimit-api-requests-remaining": "950"}
    get, asked = _routed({"adsbexchange-com1.p.rapidapi.com/v2/callsign/UAL2088": answer})
    with patch("vfr.traffic.requests.get", side_effect=get):
        traffic.find("UAL2088")
    assert json.loads(adsbx.read_text()) == {"2026-10": 9050}
    # Past the month's own budget now: the next search goes to adsb.lol.
    assert not traffic._adsbx_spend(search=True)


#: Galt Field, where a school's 172s fly the pattern, as the airports'
#: index answers a point near it.
GALT = {"ident": "10C", "name": "Galt Field Airport", "municipality": "Greenwood/Wonder Lake", "region": "US-IL",
        "elevation_ft": 875.0}


def _near_galt(distance_nm, bearing_deg=270.0):
    return lambda lat, lon, limit=3: [{**GALT, "distance_nm": distance_nm, "bearing_deg": bearing_deg}]


#: A 172's recent trace: on the ground at Galt, off, and climbing out west
#: in the pattern, its last report 4 s old at 1791800120.
CLIMBING_OUT = {
    "icao": "a06d40", "r": "N12661", "t": "C172", "timestamp": 1791800000.0,
    "trace": [
        [60.0, 42.4027, -88.3751, "ground", 8.0, 270.0, 0, 0, {"flight": "N12661  ", "squawk": "1200"}, "adsr_icao", None],
        [80.0, 42.4029, -88.3830, 1300, 62.0, 270.0, 0, 700, None, "adsr_icao", 1225],
        [116.0, 42.4031, -88.3990, 1700, 74.0, 271.0, 0, 640, None, "adsr_icao", 1625],
    ],
}


def test_an_airplane_in_the_air_is_airborne_from_where_it_took_off(clock, monkeypatch):
    """Its alerts' state, from the recent trace: in the air as the map draws
    it, and the field its stretch on the ground before it was at."""
    monkeypatch.setattr(traffic, "_wall", lambda: 1791800120.0)
    monkeypatch.setattr(traffic.airports, "nearest", _near_galt(0.1))
    get, asked = _routed({"trace_recent_a06d40": _status(200, CLIMBING_OUT)})
    with patch("vfr.traffic.requests.get", side_effect=get):
        state = traffic.status("A06D40")
        traffic.status("a06d40")
    assert state["airborne"] is True and state["heard_s"] == 4.0 and state["arrived"] is None
    assert state["aircraft"]["hex"] == "a06d40" and state["aircraft"]["altitude_ft"] == 1625
    assert state["departed"] == {"ident": "10C", "name": "Galt Field Airport", "city": "Greenwood/Wonder Lake", "region": "US-IL"}
    # Read once in its five seconds: a second ask is given the same.
    assert asked == ["https://adsb.lol/data/traces/40/trace_recent_a06d40.json"]


def test_an_airplane_on_the_ground_at_a_field_has_landed_there_at_once(clock, monkeypatch):
    monkeypatch.setattr(traffic, "_wall", lambda: 1791800120.0)
    monkeypatch.setattr(traffic.airports, "nearest", _near_galt(0.2))
    landed = {**CLIMBING_OUT, "trace": [
        [100.0, 42.4030, -88.3600, 1100, 60.0, 270.0, 0, -500, None, "adsr_icao", 1025],
        [116.0, 42.4027, -88.3740, "ground", 40.0, 270.0, 0, 0, None, "adsr_icao", None],
    ]}
    with patch("vfr.traffic.requests.get", return_value=_status(200, landed)):
        state = traffic.status("a06d40")
    assert state["airborne"] is False and state["aircraft"] is None and state["departed"] is None
    assert state["arrived"] == {"ident": "10C", "name": "Galt Field Airport", "city": "Greenwood/Wonder Lake",
                                "region": "US-IL", "at": 1791800116.0}


@pytest.mark.parametrize(("unheard_s", "arrived"), [(60.0, None), (130.0, "10C")])
def test_one_last_heard_low_by_a_field_has_landed_only_once_unheard_for_two_minutes(clock, monkeypatch, unheard_s, arrived):
    """In the pattern a small airplane drops out of the receivers' hearing
    for half a minute and comes back: gone a minute, it has not landed yet
    (nor is it in the air, as the map would draw it); gone over two, it has."""
    monkeypatch.setattr(traffic, "_wall", lambda: 1791800116.0 + unheard_s)
    monkeypatch.setattr(traffic.airports, "nearest", _near_galt(1.2, bearing_deg=90.0))
    low = {**CLIMBING_OUT, "trace": [[116.0, 42.4027, -88.4000, 1300, 65.0, 90.0, 0, -500, None, "adsr_icao", 1250]]}
    with patch("vfr.traffic.requests.get", return_value=_status(200, low)):
        state = traffic.status("a06d40")
    assert state["airborne"] is False and state["aircraft"] is None
    assert (state["arrived"] or {}).get("ident") == arrived


def test_one_last_heard_high_far_from_any_field_has_not_landed(clock, monkeypatch):
    monkeypatch.setattr(traffic, "_wall", lambda: 1791800116.0 + 600)
    monkeypatch.setattr(traffic.airports, "nearest", _near_galt(40.0))
    away = {**CLIMBING_OUT, "trace": [[116.0, 43.0, -89.0, 5500, 110.0, 300.0, 0, 0, None, "adsr_icao", 5600]]}
    with patch("vfr.traffic.requests.get", return_value=_status(200, away)):
        state = traffic.status("a06d40")
    assert state["airborne"] is False and state["arrived"] is None and state["heard_s"] == 600.0


def test_with_no_recent_trace_today_s_trace_says_where_it_landed(clock, monkeypatch):
    monkeypatch.setattr(traffic, "_TRACES", {})
    monkeypatch.setattr(traffic, "_wall", lambda: 1791800116.0 + 3600)
    monkeypatch.setattr(traffic.airports, "nearest", _near_galt(0.2))
    today = {**CLIMBING_OUT, "trace": [[116.0, 42.4027, -88.3740, "ground", 5.0, 270.0, 0, 0, None, "adsr_icao", None]]}
    get, asked = _routed({"trace_recent_a06d40": _status(404), "trace_full_a06d40": _status(200, today)})
    with patch("vfr.traffic.requests.get", side_effect=get):
        state = traffic.status("a06d40")
    assert state["arrived"]["ident"] == "10C" and state["airborne"] is False
    # Neither trace: nothing known, and nothing made up.
    get, _ = _routed({"trace_recent_a12345": _status(404), "trace_full_a12345": _status(404)})
    with patch("vfr.traffic.requests.get", side_effect=get):
        assert traffic.status("a12345") == {"hex": "a12345", "heard_s": None, "airborne": False, "aircraft": None,
                                            "departed": None, "arrived": None}


def test_a_recent_trace_that_cannot_be_read_is_unavailable_not_landed(clock):
    with patch("vfr.traffic.requests.get", return_value=_status(503)), pytest.raises(traffic.TrafficUnavailable):
        traffic.status("a06d40")


def test_an_airplane_whose_card_is_open_and_adsb_lol_does_not_hear_is_recorded_from_ads_b_exchange(clock, monkeypatch):
    """N3429J on 2026-10-19: a UAT airplane, rebroadcast by ADS-R, that
    ADS-B Exchange had and adsb.lol did not; and adsb.lol's globe turning
    the planner's trace reads away. Its card open, it is asked for by its
    address, its track kept, and it is on the map and in its alerts' state."""
    wall = {"now": 1791800000.0}
    monkeypatch.setattr(traffic, "_wall", lambda: wall["now"])
    monkeypatch.setattr(traffic, "_TRACES", {})
    monkeypatch.setattr(traffic, "_paced", lambda url: {"ac": []})
    asked = []

    def adsbx(path, search=False):
        asked.append(path)
        return [traffic._aircraft(CESSNA)]
    monkeypatch.setattr(traffic, "_adsbx", adsbx)
    monkeypatch.setattr(traffic, "_recent_trace", lambda hex_id: None)
    with patch("vfr.traffic.requests.get", return_value=Mock(status_code=403)):
        first = traffic.flight("a128b9")
        assert asked == ["icao/a128b9"] and [p["lat"] for p in first["trail"]] == [42.30128]
        # Asked again only after WATCH_GAP_S, its new place recorded.
        clock.now += 5
        traffic.flight("a128b9")
        assert len(asked) == 1
        clock.now += traffic.WATCH_GAP_S
        wall["now"] += 25
        moved = traffic._aircraft({**CESSNA, "lat": 42.4})
        monkeypatch.setattr(traffic, "_adsbx", lambda path, search=False: asked.append(path) or [moved])
        assert len(traffic.flight("a128b9")["trail"]) == 2
    # The map round it has it, which adsb.lol's region answer left out.
    monkeypatch.setattr(traffic, "_region_answer", lambda region: (clock.now, []))
    seen = traffic.near(42.35, -88.15, 30)
    assert [p["hex"] for p in seen["aircraft"]] == ["a128b9"] and "ADS-B Exchange" in seen["source"]
    # Its alerts' state: in the air, from the recorded track.
    state = traffic.status("a128b9")
    assert state["airborne"] and state["aircraft"]["lat"] == 42.4


def test_a_recorded_airplane_unheard_for_two_minutes_low_over_a_field_has_landed(clock, monkeypatch):
    monkeypatch.setattr(traffic, "_wall", lambda: 1791800000.0)
    monkeypatch.setattr(traffic, "_recent_trace", lambda hex_id: None)
    traffic._record("a128b9", traffic._aircraft(CESSNA))
    monkeypatch.setattr(traffic, "_wall", lambda: 1791800000.0 + traffic.LANDED_UNHEARD_S + 5)
    c81 = {"ident": "C81", "name": "Campbell", "city": None, "region": None}
    monkeypatch.setattr(traffic, "_field_at", lambda point, landing: c81 if landing else None)
    state = traffic.status("a128b9")
    assert not state["airborne"] and state["arrived"]["ident"] == "C81"

