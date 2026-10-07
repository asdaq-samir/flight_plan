"""vfr.fixes reads NASR's FIX_BASE.csv: which fixes are VFR waypoints a
pilot has on a chart, and what the rest are."""
import os

import pytest
from vfr import fixes

HEADER = '"FIX_ID","STATE_CODE","LAT_DECIMAL","LONG_DECIMAL","FIX_USE_CODE","CHARTS"\n'


def _table(tmp_path, *rows):
    path = tmp_path / "FIX_BASE.csv"
    path.write_text(HEADER + "".join(f'"{i}","IL",{lat},{lon},"{use}","{charts}"\n' for i, lat, lon, use, charts in rows))
    return fixes._read(path)


def test_a_vfr_waypoint_is_one_on_the_sectional_or_the_terminal_area_chart(tmp_path):
    table = _table(
        tmp_path,
        ("VPBNG", 42.27, -88.13, "VFR  ", "SECTIONAL,VFR TERMINAL AREA"),
        ("VPCJY", 41.9, -87.6, "VFR  ", "VFR FLYWAY PLANNING,VFR TERMINAL AREA"),
        # The helicopter routes' across O'Hare, and one no chart carries.
        ("VPDVA", 41.99, -88.02, "VFR  ", "HELICOPTER ROUTE"),
        ("VPXXX", 41.0, -88.0, "VFR  ", "NOT REQUIRED"),
        ("BEPKE", 41.8, -88.04, "WP   ", "IAP"),
    )

    assert {i for i, f in table.items() if f["vfr"]} == {"VPBNG", "VPCJY"}
    assert table["VPBNG"]["kind"] == "VFR waypoint"
    assert table["VPDVA"]["kind"] == "Helicopter route waypoint"
    assert table["VPXXX"]["kind"] == "Uncharted VFR waypoint"
    assert table["BEPKE"]["kind"] == "GPS waypoint"


NAV_HEADER = '"NAV_ID","NAV_TYPE","NAME","STATE_CODE","NAV_STATUS","LAT_DECIMAL","LONG_DECIMAL","FREQ"\n'


def _navaids(tmp_path, *rows):
    path = tmp_path / "NAV_BASE.csv"
    path.write_text(NAV_HEADER + "".join(
        f'"{i}","{kind}","{name}","IL","{status}",{lat},{lon},"{freq}"\n' for i, kind, name, status, lat, lon, freq in rows))
    return fixes._read_navaids(path)


def test_the_navaids_in_service_are_fixes_a_route_flies_over(tmp_path):
    table = _navaids(
        tmp_path,
        ("RFD", "DME", "ROCKFORD", "OPERATIONAL IFR", 42.2256, -89.1993, "110.8"),
        ("OBK", "VOR/DME", "NORTHBROOK", "OPERATIONAL RESTRICTED", 42.2214, -87.9517, "113"),
        # A test facility and a navaid shut down: none to fly to.
        ("ORD", "VOT", "CHICAGO O'HARE", "OPERATIONAL IFR", 41.98, -87.9, "108.2"),
        ("XYZ", "NDB", "GONE", "SHUTDOWN", 41.0, -88.0, "350"),
    )
    assert set(table) == {"RFD", "OBK"}
    rfd = table["RFD"][0]
    assert rfd == {**rfd, "kind": "DME", "navaid": True, "vfr": False, "name": "Rockford", "freq": "110.8"}
    assert fixes.title(rfd) == "Rockford DME 110.8"


def test_one_facility_filed_as_two_kinds_is_one_and_two_places_are_two(tmp_path):
    table = _navaids(
        tmp_path,
        ("AB", "TACAN", "ABLE", "OPERATIONAL IFR", 41.0, -91.0, ""),
        ("AB", "VORTAC", "ABLE", "OPERATIONAL IFR", 41.001, -91.001, "112.1"),
        ("AB", "NDB", "BEACON", "OPERATIONAL IFR", 33.5, -82.6, "350"),
    )
    assert [(n["kind"], n["name"]) for n in table["AB"]] == [("VORTAC", "Able"), ("NDB", "Beacon")]


@pytest.fixture
def two_abs(monkeypatch, tmp_path):
    """"AB", a VORTAC in Iowa and a beacon in Georgia; VPBNG and VPBNH."""
    navaids = _navaids(
        tmp_path,
        ("AB", "VORTAC", "ABLE", "OPERATIONAL IFR", 41.0, -91.0, "112.1"),
        ("AB", "NDB", "BEACON", "OPERATIONAL IFR", 33.5, -82.6, "350"),
    )
    found = _table(tmp_path, ("VPBNG", 42.27, -88.13, "VFR  ", "SECTIONAL"), ("VPBNH", 42.3, -88.2, "VFR  ", "SECTIONAL"),
                   ("BEPKE", 41.8, -88.04, "WP   ", "IAP"))
    monkeypatch.setattr(fixes, "_TABLE", fixes._Table(found, navaids))


def test_of_two_navaids_by_one_ident_the_one_by_the_route_is_flown_over(two_abs):
    # From Atlanta to Savannah, the Georgia beacon; with nothing to go by,
    # the VORTAC, the likelier kind.
    assert fixes.find_navaid("AB", near=((33.64, -84.43), (32.13, -81.2)))["kind"] == "NDB"
    assert fixes.find_navaid("ab")["kind"] == "VORTAC"
    assert fixes.find_navaid("VPBNG") is None


def test_a_search_finds_every_ident_that_starts_with_it(two_abs):
    assert [f["ident"] for f in fixes.search_fixes("vpbn")] == ["VPBNG", "VPBNH"]
    assert [f["ident"] for f in fixes.search_fixes("VPBNH")] == ["VPBNH"]
    assert fixes.search_fixes("VQ") == [] and fixes.search_fixes("V") == []


def test_a_box_finds_its_fixes_across_cells_and_both_of_an_idents_navaids(two_abs):
    assert {f["ident"] for f in fixes.within(41.5, -88.5, 42.5, -87.9)} == {"VPBNG", "VPBNH", "BEPKE"}
    assert {f["ident"] for f in fixes.within(42.28, -88.25, 42.35, -88.15)} == {"VPBNH"}
    # Each "AB" where it is.
    assert [f["kind"] for f in fixes.within(30.0, -85.0, 35.0, -80.0)] == ["NDB"]
    assert [f["kind"] for f in fixes.within(40.0, -92.0, 42.0, -90.0)] == ["VORTAC"]


def test_a_new_edition_on_disk_is_read_again_where_next_asked_for(monkeypatch, tmp_path):
    (tmp_path / "FIX_BASE.csv").write_text(HEADER + '"VPBNG","IL",42.27,-88.13,"VFR  ","SECTIONAL"\n')
    (tmp_path / "NAV_BASE.csv").write_text(NAV_HEADER)
    monkeypatch.setattr(fixes.faa_data, "ensure_nasr_file", lambda name, cache_dir: tmp_path / name)
    monkeypatch.setattr(fixes, "_TABLE", None)
    assert fixes.find_navaid("RFD") is None
    (tmp_path / "NAV_BASE.csv").write_text(NAV_HEADER + '"RFD","DME","ROCKFORD","IL","OPERATIONAL IFR",42.2256,-89.1993,"110.8"\n')
    os.utime(tmp_path / "NAV_BASE.csv", (1, 1))
    assert fixes.find_navaid("RFD")["name"] == "Rockford"
