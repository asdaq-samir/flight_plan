"""vfr.fixes reads NASR's FIX_BASE.csv: which fixes are VFR waypoints a
pilot has on a chart, and what the rest are."""
import os

import pytest
from vfr import fixes, geo, magnetic

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


def test_the_map_has_the_vors_and_the_enroute_charts_fixes(monkeypatch, tmp_path):
    navaids = _navaids(
        tmp_path,
        ("OBK", "VOR/DME", "NORTHBROOK", "OPERATIONAL RESTRICTED", 42.2214, -87.9517, "113"),
        ("RFD", "DME", "ROCKFORD", "OPERATIONAL IFR", 42.2256, -89.1993, "110.8"),
    )
    found = _table(
        tmp_path,
        ("KUBBS", 42.1, -88.2, "RP   ", "CONTROLLER LOW,ENROUTE LOW"),
        ("BEPKE", 41.8, -88.04, "WP   ", "IAP"),
        ("VPBNG", 42.27, -88.13, "VFR  ", "SECTIONAL,ENROUTE LOW"),
    )
    monkeypatch.setattr(fixes, "_TABLE", fixes._Table(found, navaids))
    assert [v["ident"] for v in fixes.vors_within(41.5, -89.5, 42.5, -87.5)] == ["OBK"]
    # Not an approach's fix, nor a VFR waypoint, which has its diamond.
    assert [f["ident"] for f in fixes.enroute_fixes_within(41.5, -89.5, 42.5, -87.5)] == ["KUBBS"]


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


def test_a_point_off_a_fix_is_written_as_a_flight_plan_writes_one():
    assert fixes.parse_frd("VPBNG/090/30") == ("VPBNG", 90, 30.0)
    assert fixes.parse_frd("dlh090030") == ("DLH", 90, 30.0)
    assert fixes.parse_frd("VPBNG/360/4.5") == ("VPBNG", 0, 4.5)
    # No course past 360, no point at the fix itself, and a fix's own
    # ident is no point off it.
    assert fixes.parse_frd("VPBNG/400/30") is None
    assert fixes.parse_frd("VPBNG/090/0") is None
    assert fixes.parse_frd("VPBNG") is None
    assert fixes.frd_ident("vpbng", 90, 30.0) == "VPBNG/090/30"


def test_a_vors_radial_is_turned_to_true_by_its_own_variation_and_a_waypoints_course_by_the_model(monkeypatch):
    # DLH's VORTAC as NASR files it, 5 E (MAG_VARN, set in 1965): its 090
    # radial runs 095 true. VPBNG's 090 is turned by the World Magnetic
    # Model's variation there now, about 3 W near Chicago in 2026.
    dlh = {"ident": "DLH", "lat": 46.8021, "lon": -92.2039, "kind": "VORTAC", "vfr": False, "navaid": True, "mag_var": 5.0}
    vpbng = {"ident": "VPBNG", "lat": 42.27, "lon": -88.13, "kind": "VFR waypoint", "vfr": True}
    monkeypatch.setattr(fixes, "_TABLE", fixes._Table({"VPBNG": vpbng}, {"DLH": [dlh]}))
    off_dlh = fixes.frd_point("DLH/090/30")
    assert off_dlh["radial"] and off_dlh["ident"] == "DLH/090/30"
    assert geo.distance_nm(dlh["lat"], dlh["lon"], off_dlh["lat"], off_dlh["lon"]) == pytest.approx(30, abs=0.01)
    assert geo.bearing_deg(dlh["lat"], dlh["lon"], off_dlh["lat"], off_dlh["lon"]) == pytest.approx(95, abs=0.05)
    assert fixes.frd_title(off_dlh) == "30 nm on the 090 radial of DLH"

    off_vpbng = fixes.frd_point("VPBNG/090/30")
    variation = magnetic.magnetic_variation_deg(vpbng["lat"], vpbng["lon"])
    assert -6 < variation < 0
    assert geo.bearing_deg(vpbng["lat"], vpbng["lon"], off_vpbng["lat"], off_vpbng["lon"]) == pytest.approx(90 + variation, abs=0.05)
    assert fixes.frd_title(off_vpbng) == "30 nm on 090° from VPBNG"
    # None off a fix NASR does not have.
    assert fixes.frd_point("NOPE/090/30") is None


def test_a_navaids_own_variation_is_read_east_positive(tmp_path):
    assert fixes._station_variation({"MAG_VARN": "5", "MAG_VARN_HEMIS": "E"}) == 5
    assert fixes._station_variation({"MAG_VARN": "3", "MAG_VARN_HEMIS": "W"}) == -3
    assert fixes._station_variation({"MAG_VARN": "", "MAG_VARN_HEMIS": ""}) is None


def test_a_point_off_an_airport_is_found_by_what_locates_the_airport(monkeypatch):
    monkeypatch.setattr(fixes, "_TABLE", fixes._Table({}, {}))
    point = fixes.frd_point("KMSN/360/10", locate=lambda base: (43.14, -89.34) if base == "KMSN" else None)
    assert point["lat"] > 43.14 + 0.15 and not point["radial"]
    assert fixes.frd_point("KMSN/360/10") is None


def test_a_dropped_point_is_named_off_the_nearest_fix_a_pilot_knows_and_comes_back_to_where_it_was(monkeypatch):
    vpbng = {"ident": "VPBNG", "lat": 42.27, "lon": -88.13, "kind": "VFR waypoint", "vfr": True}
    gps = {"ident": "BEPKE", "lat": 42.4, "lon": -87.9, "kind": "GPS waypoint", "vfr": False}
    monkeypatch.setattr(fixes, "_TABLE", fixes._Table({"VPBNG": vpbng, "BEPKE": gps}, {}))
    lat, lon = geo.destination_point(42.27, -88.13, 92.0, 14.2)
    near = fixes.frd_near(lat, lon)
    # VPBNG, a VFR waypoint, though the GPS fix is nearer.
    assert near["base"] == "VPBNG" and near["distance_nm"] == 14.2
    assert near["ident"] == f"VPBNG/{near['course_deg']:03d}/14.2"
    back = fixes.frd_point(near["ident"])
    assert geo.distance_nm(lat, lon, back["lat"], back["lon"]) < 0.3
    assert fixes.frd_near(10.0, 10.0) is None
