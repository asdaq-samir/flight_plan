import pytest

from vfr import faa_data, pattern

RWY_END = (
    '"ARPT_ID","RWY_ID","RWY_END_ID","RIGHT_HAND_TRAFFIC_PAT_FLAG","LAT_DECIMAL","LONG_DECIMAL"\n'
    '"UGN","05/23","05","N","42.4176","-87.8742"\n'
    '"UGN","05/23","23","Y","42.4268","-87.8593"\n'
    '"UGN","14/32","14","","",""\n'
    '"RFD","07/25","07","Y","",""\n'
)


def _files(tmp_path, apt_base="ARPT_ID,ICAO_ID,TPA\nUGN,KUGN,\nRFD,KRFD,800\n"):
    (tmp_path / "APT_RWY_END.csv").write_text(RWY_END)
    (tmp_path / "APT_BASE.csv").write_text(apt_base)
    pattern._ends_of.cache_clear()
    faa_data._patterns_of.cache_clear()
    faa_data._read_apt_base_cached.cache_clear()


def test_an_end_is_right_traffic_only_where_the_faa_flags_it(tmp_path):
    """91.126(b)(1): left unless the FAA says right; a blank flag is left."""
    _files(tmp_path)
    assert pattern.right_traffic_ends("KUGN", tmp_path) == {"23"}
    assert pattern.right_traffic_ends("UGN", tmp_path) == {"23"}
    assert pattern.right_traffic_ends("C81", tmp_path) == set()


def test_each_runway_end_carries_its_heading_and_its_side(tmp_path):
    """OurAirports' "7" is NASR's "07"."""
    _files(tmp_path)
    runways = [{"ends": "7/25", "end_headings": [("7", 65.0), ("25", None)]}]

    ends = pattern.with_traffic(runways, "KRFD", 42.2, -89.1, tmp_path)[0]["runway_ends"]

    assert [(e["ident"], e["traffic"]) for e in ends] == [("7", "right"), ("25", "left")]
    assert ends[0]["heading_true_deg"] == 65.0
    # No table heading: the number's magnetic heading, turned true.
    assert 245 < ends[1]["heading_true_deg"] < 250


def test_the_pattern_is_the_faas_where_published_and_1000_ft_where_not(tmp_path):
    _files(tmp_path)
    assert pattern.pattern_at("KRFD", 742.0, tmp_path) == {"agl_ft": 800.0, "altitude_ft": 1542, "published": True}
    assert pattern.pattern_at("UGN", 727.0, tmp_path) == {"agl_ft": 1000.0, "altitude_ft": 1727, "published": False}
    assert pattern.pattern_at("UGN", None, tmp_path)["altitude_ft"] is None


def test_no_runway_end_file_is_left_traffic_not_a_failure(monkeypatch, tmp_path):
    def unreachable(name, cache_dir):
        raise RuntimeError("the FAA is down")
    monkeypatch.setattr(faa_data, "ensure_nasr_file", unreachable)
    assert pattern.right_traffic_ends("KUGN", tmp_path) == set()


def test_each_end_is_where_the_faa_surveyed_it_else_where_ourairports_has_it(tmp_path):
    _files(tmp_path)
    runways = [
        {"ends": "5/23", "end_headings": [("5", 50.0), ("23", 230.0)]},
        {"ends": "14/32", "end_headings": [("14", 140.0), ("32", 320.0)], "end_positions": {"14": (42.43, -87.87)}},
    ]
    ends = [e for r in pattern.with_traffic(runways, "KUGN", 42.42, -87.87, tmp_path) for e in r["runway_ends"]]
    assert [(e["ident"], e["lat"], e["lon"]) for e in ends] == [
        ("5", 42.4176, -87.8742), ("23", 42.4268, -87.8593), ("14", 42.43, -87.87), ("32", None, None)]


# UGN's runway 5/23 as with_traffic gives it: 23 right traffic, 5 left.
UGN_5_23 = {"runway_ends": [
    {"ident": "05", "heading_true_deg": 49.0, "traffic": "left", "lat": 42.4176, "lon": -87.8742},
    {"ident": "23", "heading_true_deg": 229.0, "traffic": "right", "lat": 42.4268, "lon": -87.8593},
]}


def _side_of(runway_end: tuple, along: float, p: tuple) -> float:
    """Which side of the runway's line a point is: positive to the right
    of the direction landed in."""
    from vfr import geo
    return ((geo.bearing_deg(*runway_end, *p) - along) % 360 + 540) % 360 - 180


def test_the_arrival_comes_in_at_45_to_the_downwind_and_lands_on_the_threshold():
    """AIM 4-3-3: in at 45° abeam midfield, downwind, base, final; level
    at the pattern altitude to the base, down to the field at the end."""
    from vfr import geo
    flown = pattern.arrival_circuit(UGN_5_23, "5", 1700, 727)
    entry, midfield, downwind_end, final_start, threshold = flown["points"]
    assert threshold == (42.4176, -87.8742)
    along = geo.bearing_deg(42.4176, -87.8742, 42.4268, -87.8593)
    # Left traffic on 5: the downwind is to the left of the runway.
    assert _side_of(threshold, along, midfield) < 0
    # The entry meets the downwind at 45°, flown the way the downwind is.
    downwind = geo.bearing_deg(*midfield, *downwind_end)
    entering = geo.bearing_deg(*entry, *midfield)
    assert abs(((entering - downwind) % 360 + 540) % 360 - 180) == pytest.approx(45, abs=1)
    assert flown["ft"] == [1700, 1700, 1700, None, 727]


def test_right_traffic_puts_the_downwind_to_the_right():
    from vfr import geo
    flown = pattern.arrival_circuit(UGN_5_23, "23", 1700, 727)
    threshold, midfield = flown["points"][-1], flown["points"][1]
    along = geo.bearing_deg(42.4268, -87.8593, 42.4176, -87.8742)
    assert _side_of(threshold, along, midfield) > 0


def test_the_departure_leaves_straight_out_or_at_45_toward_the_way_on():
    """AIM 4-3-3: straight out, or a 45° turn to the pattern's side."""
    from vfr import geo
    along = geo.bearing_deg(42.4176, -87.8742, 42.4268, -87.8593)
    ahead = geo.destination_point(42.4268, -87.8593, along, 30)
    left = geo.destination_point(42.4268, -87.8593, (along - 60) % 360, 30)
    straight = pattern.departure_circuit(UGN_5_23, "5", ahead)
    turned = pattern.departure_circuit(UGN_5_23, "5", left)
    assert straight["points"][0] == (42.4176, -87.8742)
    assert straight["exit_deg"] == pytest.approx(along, abs=0.2)
    assert turned["exit_deg"] == pytest.approx((along - 45) % 360, abs=0.2)


def test_an_end_with_no_threshold_has_no_pattern_to_fly():
    runway = {"runway_ends": [{"ident": "14", "heading_true_deg": 140.0, "traffic": "left", "lat": None, "lon": None}]}
    assert pattern.arrival_circuit(runway, "14", 1700, 727) is None
    assert pattern.departure_circuit(runway, "14", (42.0, -88.0)) is None
