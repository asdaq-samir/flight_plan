"""vfr.fixes reads NASR's FIX_BASE.csv: which fixes are VFR waypoints a
pilot has on a chart, and what the rest are."""
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
    assert table["RFD"] == {**table["RFD"], "kind": "DME", "navaid": True, "vfr": False, "name": "Rockford", "freq": "110.8"}
    assert fixes.title(table["RFD"]) == "Rockford DME 110.8"


def test_of_two_navaids_by_one_ident_the_vortac_is_kept_over_the_beacon(tmp_path):
    table = _navaids(
        tmp_path,
        ("AB", "NDB", "BEACON", "OPERATIONAL IFR", 40.0, -90.0, "350"),
        ("AB", "VORTAC", "ABLE", "OPERATIONAL IFR", 41.0, -91.0, "112.1"),
        ("AB", "TACAN", "MILITARY", "OPERATIONAL IFR", 42.0, -92.0, ""),
    )
    assert table["AB"]["kind"] == "VORTAC" and table["AB"]["name"] == "Able"
