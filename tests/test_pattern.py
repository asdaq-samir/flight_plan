from vfr import faa_data, pattern

RWY_END = (
    '"ARPT_ID","RWY_ID","RWY_END_ID","RIGHT_HAND_TRAFFIC_PAT_FLAG"\n'
    '"UGN","05/23","05","N"\n'
    '"UGN","05/23","23","Y"\n'
    '"UGN","14/32","14",""\n'
    '"RFD","07/25","07","Y"\n'
)


def _files(tmp_path, apt_base="ARPT_ID,ICAO_ID,TPA\nUGN,KUGN,\nRFD,KRFD,800\n"):
    (tmp_path / "APT_RWY_END.csv").write_text(RWY_END)
    (tmp_path / "APT_BASE.csv").write_text(apt_base)
    pattern._right_ends_of.cache_clear()
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
