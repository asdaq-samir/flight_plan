"""app.swim: SWIM's STDDS terminal radar messages read into vfr.traffic's
airplanes, from a message in the feed's own shape (TATrackAndFlightPlan)."""
from app import swim

MESSAGE = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><ns2:TATrackAndFlightPlan xmlns:ns2="urn:us:gov:dot:faa'
    ':atm:terminal:entities:v4-0:tais:terminalautomationinformation"><src>C90</src><record><recSeqNum>1</recSeqNum>'
    '<track><trackNum>3891</trackNum><mrtTime>2026-10-20T01:58:25.921Z</mrtTime><status>active</status><acAddress>A'
    '3C858</acAddress><lat>42.58095</lat><lon>-88.24562</lon><vVert>128</vVert><vx>0</vx><vy>87</vy><adsb>1</adsb><'
    'reportedBeaconCode>1200</reportedBeaconCode><reportedAltitude>2700</reportedAltitude></track></record><record>'
    '<track><mrtTime>2026-10-20T01:58:26.000Z</mrtTime><status>active</status><acAddress>a6ed61</acAddress><lat>41.'
    '9</lat><lon>-87.9</lon><vx>-280</vx><vy>0</vy><reportedBeaconCode>7202</reportedBeaconCode><reportedAltitude>8'
    '000</reportedAltitude></track><flightPlan><acid>UAL2197</acid><acType>A21N</acType></flightPlan></record><reco'
    'rd><track><mrtTime>2026-10-20T01:58:26.000Z</mrtTime><status>coasting</status><acAddress>abe28f</acAddress><la'
    't>41.9</lat><lon>-87.9</lon></track></record><record><track><mrtTime>2026-10-20T01:58:26.000Z</mrtTime><status'
    '>active</status><acAddress>000000</acAddress><lat>41.9</lat><lon>-87.9</lon></track></record></ns2:TATrackAndF'
    'lightPlan>'
)


def test_a_radar_message_gives_each_active_tracks_airplane_with_its_flight_plan():
    found = swim.tracks(MESSAGE)
    assert [p["hex"] for p, _ in found] == ["a3c858", "a6ed61"]
    n3429j, at = found[0]
    assert at == 1792461505.921
    assert (n3429j["altitude_ft"], n3429j["pressure_altitude"], n3429j["squawk"]) == (2700.0, True, "1200")
    # North at 87 kt from its ground velocity.
    assert (n3429j["track_deg"], n3429j["speed_kt"], n3429j["vertical_fpm"]) == (0.0, 87.0, 128.0)
    airliner = found[1][0]
    assert (airliner["callsign"], airliner["type"], airliner["track_deg"], airliner["registration"]) == ("UAL2197", "A21N", 270.0, None)


def test_anything_but_a_track_message_gives_nothing():
    assert swim.tracks('<ns2:TAStatus xmlns:ns2="x"><src>HUF</src></ns2:TAStatus>') == []
    assert swim.tracks("not xml") == []


def test_each_feed_is_off_without_its_settings(monkeypatch):
    for name in (*swim.SETTINGS, "SWIM_VPN_STDDS", "SWIM_QUEUE_STDDS", "SWIM_VPN_FNS", "SWIM_QUEUE_FNS"):
        monkeypatch.setenv(name, "set")
    monkeypatch.delenv("SWIM_QUEUE_FNS")
    assert swim.configured("STDDS") and not swim.configured("FNS")
    monkeypatch.delenv("SWIM_PASSWORD")
    assert not swim.configured("STDDS")


class _Message:
    """A message as the Solace client gives it: one that raises when asked
    for its payload as a string, as some of the feed's do, or for bytes."""

    def __init__(self, raw=None, text=None):
        self.raw, self.text = raw, text

    def get_payload_as_bytes(self):
        if self.raw is None:
            raise RuntimeError("Unable to get payload for the message.")
        return self.raw

    def get_payload_as_string(self):
        if self.text is None:
            raise RuntimeError("Unable to get payload for the message.")
        return self.text


def test_a_message_is_read_from_its_bytes_or_its_string_and_one_neither_reads_is_empty():
    assert swim.body(_Message(raw=MESSAGE.encode())) == MESSAGE
    assert swim.body(_Message(text=MESSAGE)) == MESSAGE
    assert swim.body(_Message()) == ""


def test_the_tracks_read_are_those_round_a_view_and_the_followed_ones(monkeypatch):
    heard = []
    monkeypatch.setattr(swim.traffic, "heard_elsewhere", lambda plane, at: heard.append(plane["hex"]))
    # The map on Chicago, 20 nm round O'Hare: the airliner over it, not
    # N3429J 39 nm north-west.
    monkeypatch.setattr(swim.traffic, "radar_wanted", lambda: ([(41.98, -87.9, 20)], set()))
    assert swim._radar(MESSAGE) == 1 and heard == ["a6ed61"]
    # Both views: both airplanes.
    heard.clear()
    monkeypatch.setattr(swim.traffic, "radar_wanted", lambda: ([(41.98, -87.9, 30), (42.6, -88.2, 20)], set()))
    assert swim._radar(MESSAGE) == 2 and heard == ["a3c858", "a6ed61"]
    # Nobody looking: the followed one alone, its address upper case in
    # the message.
    heard.clear()
    monkeypatch.setattr(swim.traffic, "radar_wanted", lambda: ([], {"a3c858"}))
    assert swim._radar(MESSAGE) == 1 and heard == ["a3c858"]
    # The map on Los Angeles, none followed in it: the message not parsed.
    monkeypatch.setattr(swim, "tracks", lambda xml: (_ for _ in ()).throw(AssertionError("parsed")))
    monkeypatch.setattr(swim.traffic, "radar_wanted", lambda: ([(33.94, -118.41, 165)], {"abcdef"}))
    assert swim._radar(MESSAGE) == 0


def test_a_flat_chart_distance_is_near_enough():
    # O'Hare to N3429J's track, 39.2 nm on the ellipsoid (pyproj's WGS84).
    assert abs(swim._nm(41.98, -87.9, 42.58095, -88.24562) - 39.2) < 0.5


def test_tfms_flight_plans_go_to_the_filed_routes_and_the_feed_is_off_without_its_queue(monkeypatch):
    assert swim.HANDLERS["TFMS"] is swim.filed_routes.heard
    for name in (*swim.SETTINGS, "SWIM_VPN_TFMS"):
        monkeypatch.setenv(name, "set")
    monkeypatch.delenv("SWIM_QUEUE_TFMS", raising=False)
    assert not swim.configured("TFMS")
    monkeypatch.setenv("SWIM_QUEUE_TFMS", "set")
    assert swim.configured("TFMS")


def test_a_feed_on_another_broker_connects_there(monkeypatch):
    monkeypatch.setenv("SWIM_HOST", "tcps://ems2.swim.faa.gov:55443")
    monkeypatch.delenv("SWIM_HOST_FNS", raising=False)
    monkeypatch.setenv("SWIM_HOST_TFMS", "tcps://ems1.swim.faa.gov:55443")
    assert swim._host("TFMS") == "tcps://ems1.swim.faa.gov:55443"
    assert swim._host("FNS") == "tcps://ems2.swim.faa.gov:55443"
