"""FD (winds/temps aloft) group decoding -- formalizes the ad-hoc checks
run while building wind_at_altitude (see [[project-navlog-dr-math]]).
"""
from vfr.weather import _decode_temp_c, _decode_wind


def test_decode_wind_normal_group():
    assert _decode_wind("2712") == (270.0, 12.0)


def test_decode_wind_speed_offset_above_100kt():
    # dir_code 70 >= 51 -> actual dir (70-50)*10=200, actual speed 20+100=120
    assert _decode_wind("7020") == (200.0, 120.0)


def test_decode_wind_light_and_variable():
    assert _decode_wind("9900") == (None, 0.0)


def test_decode_wind_from_a_temp_bearing_group():
    # first 4 chars are still a valid wind code even when a temp follows
    assert _decode_wind("3028+18") == (300.0, 28.0)


def test_decode_wind_too_short_returns_none():
    assert _decode_wind("12") is None


def test_decode_temp_c_signed_seven_char_group():
    assert _decode_temp_c("3028+18") == 18.0
    assert _decode_temp_c("3028-05") == -5.0


def test_decode_temp_c_unsigned_six_char_group_is_always_negative():
    # header states "TEMPS NEG ABV 24000" -- sign is implied, not written
    assert _decode_temp_c("270162") == -62.0


def test_decode_temp_c_wind_only_four_char_group_has_no_temp():
    assert _decode_temp_c("2712") is None
