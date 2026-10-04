"""The reported wind on the end of a runway it favours."""
import pytest

from vfr import runway_wind

NINE_27 = [("9", 88.0), ("27", 268.0)]


def test_the_end_into_the_wind_is_favoured_its_crosswind_signed_from_the_right():
    # 300 at 12 on 27 (268 true): 32 degrees off the nose, from the right.
    wind = runway_wind.favoured_end(NINE_27, {"wind_dir_true_deg": 300.0, "wind_speed_kt": 12.0}, -3.0)
    assert wind == {"end": "27", "headwind_kt": 10, "crosswind_kt": 6, "gust_crosswind_kt": None}


def test_a_wind_from_the_left_is_a_negative_crosswind_and_a_gust_has_its_own():
    # 040 on 9 (088 true): 48 degrees off the nose, from the left.
    wind = runway_wind.favoured_end(NINE_27, {"wind_dir_true_deg": 40.0, "wind_speed_kt": 10.0, "wind_gust_kt": 20.0}, 0.0)
    assert wind["end"] == "9" and wind["crosswind_kt"] == -7 and wind["gust_crosswind_kt"] == -15


def test_an_end_with_no_heading_takes_its_number_turned_true():
    # Runway 18 at 3 degrees west: 177 true; a wind from 177 is all headwind.
    assert runway_wind.end_heading_true_deg("18L", None, -3.0) == pytest.approx(177.0)
    wind = runway_wind.favoured_end([("18L", None), ("36R", None)], {"wind_dir_true_deg": 177.0, "wind_speed_kt": 8.0}, -3.0)
    assert wind == {"end": "18L", "headwind_kt": 8, "crosswind_kt": 0, "gust_crosswind_kt": None}


@pytest.mark.parametrize("metar, ends", [
    (None, NINE_27),                                                    # no report
    ({"wind_dir_true_deg": None, "wind_speed_kt": 4.0}, NINE_27),       # variable
    ({"wind_dir_true_deg": 300.0, "wind_speed_kt": 12.0}, [("H1", None)]),  # a helipad
])
def test_no_wind_without_a_report_a_direction_or_a_runway_heading(metar, ends):
    assert runway_wind.favoured_end(ends, metar, 0.0) is None


def test_calm_is_nothing_on_the_first_end():
    wind = runway_wind.favoured_end(NINE_27, {"wind_dir_true_deg": 0.0, "wind_speed_kt": 0.0}, 0.0)
    assert wind == {"end": "9", "headwind_kt": 0.0, "crosswind_kt": 0.0, "gust_crosswind_kt": None}
