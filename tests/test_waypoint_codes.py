"""vfr.waypoint_codes: a route's points as a panel GPS finds them, their
Garmin type and ICAO region, from lines of the FAA's own CIFP (cycle
2610-29) and NASR's FIX_BASE.csv."""
from pathlib import Path

import pytest

from vfr import waypoint_codes

CIFP = Path(__file__).parent / "fixtures" / "avionics" / "FAACIFP18"


@pytest.fixture
def fix_base(tmp_path):
    path = tmp_path / "FIX_BASE.csv"
    path.write_text(
        "FIX_ID,ICAO_REGION_CODE,FIX_USE_CODE,LAT_DECIMAL,LONG_DECIMAL\n"
        "VPBNG,K5,VFR,42.26733888,-88.13105\n"
        "VPLAT,K3,VFR,39.54777777,-94.33333333\n")
    return path


def code(ident, airport, lat, lon, fix_base):
    return waypoint_codes.code_of(ident, airport, lat, lon, cifp=CIFP, fix_base=fix_base)


def test_an_airport_and_a_navaid_by_their_cifp_records(fix_base):
    assert code("KDLH", True, 46.8421, -92.1936, fix_base) == {"ident": "KDLH", "type": "AIRPORT", "region": "K3"}
    # DLH the VOR, not the airport, where the route names a navaid.
    assert code("dlh", False, 46.80, -92.20, fix_base) == {"ident": "DLH", "type": "VOR", "region": "K3"}
    assert code("AMLIY", False, 46.77, -92.25, fix_base)["type"] == "INT"


def test_one_identifier_in_two_places_is_the_one_nearest_the_route(fix_base):
    # AA is an NDB at Kenie, North Dakota (K3), and at Cedar, Georgia (K7).
    assert code("AA", False, 47.0, -96.8, fix_base)["region"] == "K3"
    assert code("AA", False, 33.5, -82.6, fix_base)["region"] == "K7"


def test_a_vfr_waypoint_from_nasr(fix_base):
    assert code("VPBNG", False, 42.267, -88.131, fix_base) == {"ident": "VPBNG", "type": "INT-VRP", "region": "K5"}


def test_none_where_nothing_of_that_name_is_near(fix_base):
    # The identifier a long way from where the route has it is not it.
    assert code("VPBNG", False, 46.0, -92.0, fix_base) == {"ident": "VPBNG", "type": None, "region": None}
    assert code("ZZZZZ", False, 0, 0, fix_base)["type"] is None


def test_arinc_coordinates():
    assert waypoint_codes._coordinate("N46480779") == pytest.approx(46 + 48 / 60 + 7.79 / 3600)
    assert waypoint_codes._coordinate("W092121033") == pytest.approx(-(92 + 12 / 60 + 10.33 / 3600))
    assert waypoint_codes._coordinate("         ") is None
