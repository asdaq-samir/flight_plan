"""app.gonogo.icing, with web/src/lib/icing.test.ts's cases."""
from app.gonogo.icing import icing_at_altitude, icing_line


def selection(**over) -> dict:
    return {"freezing_level_ft": 5000, "freezing_level_at_or_below": False, "icing_possible": True, **over}


def pirep(icing):
    return {"icing": icing, "along_track_nm": 10}


def test_a_leg_at_or_above_the_freezing_level_in_cloud_with_the_reports_of_icing_near_the_route():
    found = icing_at_altitude(selection(), [4000, 6000], [pirep("MOD"), pirep("NEG"), pirep("NEGclr"), pirep(None), pirep("LGT-MOD")])
    assert found == {"altitude_ft": 6000, "freezing_level_ft": 5000, "at_or_below": False, "reports": 2}
    assert icing_line(found) == ("Icing possible at 6,000 ft: the freezing level at 5,000 ft, in cloud; "
                                 "2 pilot reports of icing near the route")
    assert icing_at_altitude(selection(), [5000], []) is not None


def test_nothing_below_the_freezing_level_without_the_moisture_or_where_the_level_is_not_known():
    assert icing_at_altitude(selection(), [4000, 4999], []) is None
    assert icing_at_altitude(selection(icing_possible=False), [8000], []) is None
    assert icing_at_altitude(selection(icing_possible=None), [8000], []) is None
    assert icing_at_altitude(selection(freezing_level_ft=None), [8000], []) is None


def test_a_freezing_level_at_or_below_the_lowest_forecast_altitude_is_every_altitude():
    found = icing_at_altitude(selection(freezing_level_ft=3000, freezing_level_at_or_below=True), [2000], [])
    assert icing_line(found) == "Icing possible at 2,000 ft: the freezing level at or below 3,000 ft, in cloud"
