"""FD (winds/temps aloft) group decoding -- formalizes the ad-hoc checks
run while building wind_at_altitude.

metar_for_idents and the WeatherServiceError wrapping below cover the
other half: every aviationweather.gov call in this module was
unhandled until this pass, so a mocked network failure is worth a test
of its own, not just the pure decoding helpers.
"""
from unittest.mock import Mock, patch

import pytest
import requests

from vfr.weather import WeatherServiceError, _decode_temp_c, _decode_wind, metar_for_idents


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


def _mock_metar_response(reports: list) -> Mock:
    resp = Mock()
    resp.raise_for_status = Mock()
    resp.json.return_value = reports
    return resp


@patch("vfr.weather.requests.get")
def test_metar_for_idents_fetches_all_idents_in_one_request(mock_get):
    mock_get.return_value = _mock_metar_response([
        {"icaoId": "C81", "rawOb": "C81 METAR", "fltCat": "VFR"},
        {"icaoId": "KDLH", "rawOb": "KDLH METAR", "fltCat": "MVFR"},
    ])

    result = metar_for_idents(["C81", "KDLH"])

    mock_get.assert_called_once()
    assert mock_get.call_args.kwargs["params"]["ids"] == "C81,KDLH"
    assert result["C81"]["flight_category"] == "VFR"
    assert result["KDLH"]["flight_category"] == "MVFR"


@patch("vfr.weather.requests.get")
def test_metar_for_idents_returns_none_for_an_ident_with_no_current_report(mock_get):
    mock_get.return_value = _mock_metar_response([{"icaoId": "KDLH", "rawOb": "KDLH METAR", "fltCat": "VFR"}])

    result = metar_for_idents(["C81", "KDLH"])

    assert result["C81"] is None
    assert result["KDLH"] is not None


@patch("vfr.weather.requests.get")
def test_metar_for_idents_wraps_a_network_failure(mock_get):
    mock_get.side_effect = requests.ConnectionError("no route to host")

    with pytest.raises(WeatherServiceError):
        metar_for_idents(["C81"])
