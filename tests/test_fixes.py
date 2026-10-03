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
