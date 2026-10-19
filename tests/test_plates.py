"""vfr.plates: an approach's plate placed on the map by its own georeference."""
import pytest

from vfr import plates

DLH = [
    {"kind": "IAP", "name": "ILS OR LOC RWY 09", "url": "u/IL9"},
    {"kind": "IAP", "name": "ILS RWY 09 (SA CAT I)", "url": "u/I9SAC1"},
    {"kind": "IAP", "name": "ILS RWY 09 (CAT II)", "url": "u/I9C2"},
    {"kind": "IAP", "name": "RNAV (GPS) RWY 3", "url": "u/R3"},
    {"kind": "IAP", "name": "RNAV (GPS) Y RWY 27", "url": "u/RY27"},
    {"kind": "IAP", "name": "RNAV (GPS) Z RWY 27", "url": "u/RZ27"},
    {"kind": "DP", "name": "RNAV (GPS) RWY 3 DEPARTURE", "url": "u/DP"},
]


def test_the_cifps_approach_is_the_plate_of_the_same_runway_means_and_letter():
    # "RWY 03" is the plate's "RWY 3"; an ILS is its "ILS OR LOC" plate,
    # not its CAT II one; a letter picks its own.
    assert plates.plate_for("RNAV (GPS) RWY 03", DLH)["url"] == "u/R3"
    assert plates.plate_for("ILS RWY 09", DLH)["url"] == "u/IL9"
    assert plates.plate_for("RNAV (GPS) Z RWY 27", DLH)["url"] == "u/RZ27"
    assert plates.plate_for("RNAV (GPS) RWY 21", DLH) is None
    assert plates.plate_for("VOR RWY 03", DLH) is None


# KRFD ILS RWY 07's viewport (d-TPP 2610), as its page dictionary has it.
KRFD_I07 = (
    b"/Rotate 0/Type/Page/VP[<</BBox[9.18 2.628 378.18 591.372]/Measure<</Bounds[0 0 1 0 1 1 0 1 0 0]"
    b'/GCS<</EPSG 0/Type/PROJCS/WKT(PROJCS["",GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",'
    b'SPHEROID["GRS_1980",6378137.000,298.25722210]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]],'
    b'PROJECTION["Lambert_Conformal_Conic"],PARAMETER["False_Easting",0.000],PARAMETER["False_Northing",0.000],'
    b'PARAMETER["Central_Meridian",-89.21819444444452],PARAMETER["Latitude_Of_Origin",42.15669444444440],'
    b'PARAMETER["Standard_Parallel_1",46.66666666666671],PARAMETER["Standard_Parallel_2",41.33333333333331],'
    b'UNIT["Inch",0.02540005080010]])>>/GPTS[41.68814609406 -89.54178783614 41.68820747524 -88.91618533392 '
    b"42.4365259253 -88.91248437445 42.43646377287 -89.54575329403]/LPTS[0.1 0.1 0.9 0.1 0.9 0.9 0.1 0.9]"
    b"/PDU[(MI)(SQMI)(DEG)]/Subtype/GEO/Type/Measure>>/Type/Viewport>>]>>"
)


def test_a_plate_is_placed_by_its_own_georeference():
    geo = plates.georeference_of(b"%PDF-1.7 ... " + KRFD_I07 + b" ... %%EOF")
    # Its four points are where the viewport says, 0.1 and 0.9 of its box.
    x, y = geo.page_of(41.68814609406, -89.54178783614)
    assert (x, y) == pytest.approx((9.18 + 0.1 * 369, 2.628 + 0.1 * 588.744), abs=0.01)
    assert geo.ground_of(x, y) == pytest.approx((41.68814609406, -89.54178783614), abs=1e-7)
    # Drawn at 1:500,000, as the d-TPP's plan views are: a nm north is
    # 1852 m / 500,000 = 3.70 mm, 10.5 points.
    _, south = geo.page_of(42.0, -89.2)
    _, north = geo.page_of(42.0 + 1 / 60, -89.2)
    assert north - south == pytest.approx(10.5, abs=0.1)


def test_a_plate_without_a_georeference_is_not_placed():
    assert plates.georeference_of(b"%PDF-1.7 no viewport %%EOF") is None
    assert plates.georeference_of(KRFD_I07.replace(b"Lambert_Conformal_Conic", b"Transverse_Mercator")) is None
    assert plates.georeference_of(KRFD_I07.replace(b"/GPTS[41.68814609406 ", b"/GPTS[")) is None


def test_the_plan_view_is_the_box_of_long_lines_round_its_airport():
    across = [(486.0, 17, 370), (190.0, 17, 370), (540.0, 17, 370)]
    down = [(17.0, 190, 486), (370.0, 190, 486)]
    assert plates.plan_view_box(across, down, (225, 340), (387, 594)) == (17.0, 190.0, 370.0, 486.0)


def test_the_plan_views_bottom_line_may_run_along_part_of_it():
    # KORD's RNAV (GPS) RWY 09C: the line under the plan view stops at the
    # profile's box, short of the airport's side of the page; the profile's
    # own divider does not reach up to the airport.
    across = [(452.0, 17, 370), (221.0, 17, 258), (106.0, 18, 257)]
    down = [(257.0, 38, 236)]
    assert plates.plan_view_box(across, down, (329, 319), (387, 594)) == (0.0, 221.0, 387, 452.0)



def test_a_divider_ending_at_the_airports_height_is_not_a_side():
    # KLSE's RNAV (GPS) RWY 18: its airport is drawn at the plan view's
    # foot, level with the top of the profile's divider.
    across = [(450.0, 17, 370), (211.0, 17, 258)]
    down = [(257.0, 38, 236)]
    assert plates.plan_view_box(across, down, (196.4, 236.3), (387, 594)) == (0.0, 211.0, 387, 450.0)


def test_a_plate_kept_as_not_placed_is_none_until_the_placing_changes(tmp_path):
    meta = tmp_path / "R03.json"
    meta.write_text('{"cycle": "2610", "name": "RNAV (GPS) RWY 3", "placed": false, "fit": 2}')
    assert plates._kept(meta) is None
    meta.write_text(f'{{"cycle": "2610", "name": "RNAV (GPS) RWY 3", "placed": false, "fit": {plates.PLACING_VERSION}}}')
    assert plates._kept(meta)["placed"] is False
    meta.write_text('{"cycle": "2610", "name": "RNAV (GPS) RWY 3", "placed": true, "south": 46.6}')
    assert plates._kept(meta)["south"] == 46.6
