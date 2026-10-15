"""vfr.airways: an airway flown from one of its fixes to another, either
way along it, each segment with the published altitudes for the way
flown -- a directional MEA's own -- and an airway that cannot be flown
as written refused in a pilot's words. A NASR AWY_SEG_ALT.csv of a few
rows, its header the FAA's own."""
import pytest

from vfr import airways, faa_data

HEADER = (
    '"EFF_DATE","REGULATORY","AWY_LOCATION","AWY_ID","POINT_SEQ","FROM_POINT","FROM_PT_TYPE","NAV_NAME","NAV_CITY",'
    '"ARTCC","ICAO_REGION_CODE","STATE_CODE","COUNTRY_CODE","TO_POINT","MAG_COURSE","OPP_MAG_COURSE","MAG_COURSE_DIST",'
    '"CHGOVR_PT","CHGOVR_PT_NAME","CHGOVR_PT_DIST","AWY_SEG_GAP_FLAG","SIGNAL_GAP_FLAG","DOGLEG","NEXT_MEA_PT",'
    '"MIN_ENROUTE_ALT","MIN_ENROUTE_ALT_DIR","MIN_ENROUTE_ALT_OPPOSITE","MIN_ENROUTE_ALT_OPPOSITE_DIR",'
    '"GPS_MIN_ENROUTE_ALT","GPS_MIN_ENROUTE_ALT_DIR","GPS_MIN_ENROUTE_ALT_OPPOSITE","GPS_MEA_OPPOSITE_DIR","DD_IRU_MEA",'
    '"DD_IRU_MEA_DIR","DD_I_MEA_OPPOSITE","DD_I_MEA_OPPOSITE_DIR","MIN_OBSTN_CLNC_ALT","MIN_CROSS_ALT",'
    '"MIN_CROSS_ALT_DIR","MIN_CROSS_ALT_NAV_PT","MIN_CROSS_ALT_OPPOSITE","MIN_CROSS_ALT_OPPOSITE_DIR","MIN_RECEP_ALT",'
    '"MAX_AUTH_ALT","MEA_GAP","REQD_NAV_PERFORMANCE","REMARK"\n'
)


def _row(awy, seq, frm, to, mea="", mea_dir="", opp="", opp_dir="", gps="", moca="", maa="17500", gap="N", mea_gap=""):
    return (
        f'"2026/10/01","Y","C","{awy}",{seq},"{frm}","VORTAC","","","ZMP","","WI","US","{to}",0,180,20,"","",,'
        f'"{gap}","N","N","{to}",{mea},"{mea_dir}",{opp},"{opp_dir}",{gps},"",,"",,"",,"",{moca},,"","",,"",,{maa},'
        f'"{mea_gap}",,""\n'
    )


# Four fixes in a line due north, a degree of latitude apart.
WHERE = {"AAA": (44.0, -90.0), "BBB": (45.0, -90.0), "CCC": (46.0, -90.0), "DDD": (47.0, -90.0)}


@pytest.fixture
def awy(tmp_path, monkeypatch):
    path = tmp_path / "AWY_SEG_ALT.csv"
    path.write_text(HEADER + "".join([
        _row("V900", 10, "AAA", "BBB", mea=4000, moca=2600),
        _row("V900", 20, "BBB", "CCC", mea=5000, mea_dir="N BND", opp=7000, opp_dir="S BND"),
        _row("V900", 30, "CCC", "DDD", mea=6000, mea_gap="U"),
        _row("T900", 10, "AAA", "BBB", gps=3500),
    ]))
    monkeypatch.setattr(faa_data, "ensure_nasr_file", lambda name, cache_dir: path)
    monkeypatch.setattr(airways, "_TABLE", None)
    monkeypatch.setattr(airways, "_where", lambda ident, near=(): WHERE.get(ident))


def test_an_airway_is_flown_segment_by_segment_with_its_published_altitudes(awy):
    first, second = airways.along("V900", "AAA", "CCC")
    assert (first.from_ident, first.to_ident, first.mea_ft, first.moca_ft, first.maa_ft) == ("AAA", "BBB", 4000, 2600, 17500)
    # Northbound: the northbound MEA.
    assert (second.from_ident, second.to_ident, second.mea_ft) == ("BBB", "CCC", 5000)


def test_the_other_way_along_it_takes_the_other_ways_mea(awy):
    second, first = airways.along("V900", "CCC", "AAA")
    assert (second.from_ident, second.to_ident, second.mea_ft) == ("CCC", "BBB", 7000)
    assert (first.from_ident, first.to_ident, first.mea_ft) == ("BBB", "AAA", 4000)


def test_a_t_routes_gnss_mea_is_kept(awy):
    (segment,) = airways.along("T900", "AAA", "BBB")
    assert segment.mea_ft is None and segment.gnss_mea_ft == 3500


@pytest.mark.parametrize(("airway", "frm", "to", "says"), [
    ("V901", "AAA", "BBB", "No airway V901 is published."),
    ("V900", "XXX", "BBB", "XXX is not on V900: an airway is joined at one of its own fixes."),
    ("V900", "AAA", "XXX", "XXX is not on V900: an airway is left at one of its own fixes."),
    ("V900", "BBB", "BBB", "V900 from BBB to itself goes nowhere."),
    ("V900", "BBB", "DDD", "V900 from CCC to DDD is not usable as published."),
])
def test_an_airway_that_cannot_be_flown_as_written_says_why(awy, airway, frm, to, says):
    with pytest.raises(airways.AirwayError, match=f"^{says}$"):
        airways.along(airway, frm, to)


def test_an_airway_is_known_by_its_form_and_by_nasr(awy):
    assert airways.is_airway("v900") and airways.is_airway("T900")
    assert not airways.is_airway("V901") and not airways.is_airway("VPBNG") and not airways.is_airway("KDLH")


def test_a_directional_pair_is_the_nearer_bound_and_the_higher_where_a_bound_is_missing():
    assert airways._for_the_way(40.0, 2100, "NE", 5000, "SW") == 2100
    assert airways._for_the_way(220.0, 2100, "NE", 5000, "SW") == 5000
    assert airways._for_the_way(40.0, 2100, "", 5000, "SW") == 5000
