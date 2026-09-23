"""FD (winds/temps aloft) group decoding -- formalizes the ad-hoc checks
run while building wind_at_altitude.

metar_for_idents and the WeatherServiceError wrapping below cover the
other half: every aviationweather.gov call in this module was
unhandled until this pass, so a mocked network failure is worth a test
of its own, not just the pure decoding helpers.
"""
import gzip
from datetime import datetime, timezone
from unittest.mock import Mock, patch

import pytest
import requests

from vfr import weather
from vfr.weather import (
    WeatherServiceError,
    _decode_temp_c,
    _decode_wind,
    ceiling_visibility_along_route,
    hazards_along_route,
    metar_for_idents,
)


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


# --- the cache files -------------------------------------------------------

C81, KDLH = (42.3172, -88.0905), (46.8421, -92.1936)
T0200Z = datetime(2026, 9, 20, 2, 0, tzinfo=timezone.utc).timestamp()


def _cache_file(body: str) -> Mock:
    """What requests.get returns for one of aviationweather.gov's gzipped
    XML cache files, in the schema the real files use."""
    xml = f'<?xml version="1.0" encoding="UTF-8"?><response version="2.0"><data>{body}</data></response>'
    resp = Mock()
    resp.raise_for_status = Mock()
    resp.content = gzip.compress(xml.encode())
    return resp


METARS = _cache_file(
    # KDLH twice: an older report and a newer SPECI, to prove the newest wins.
    '<METAR><raw_text>KDLH 200053Z 30012KT 10SM SCT018 BKN023 11/10 A3005</raw_text><station_id>KDLH</station_id>'
    '<observation_time>2026-09-20T00:53:00.000Z</observation_time><temp_c>11</temp_c><dewpoint_c>10</dewpoint_c>'
    '<wind_dir_degrees>300</wind_dir_degrees><wind_speed_kt>12</wind_speed_kt><visibility_statute_mi>10+</visibility_statute_mi>'
    '<sky_condition sky_cover="SCT" cloud_base_ft_agl="1800"/><sky_condition sky_cover="BKN" cloud_base_ft_agl="2300"/>'
    '<flight_category>MVFR</flight_category></METAR>'
    '<METAR><raw_text>SPECI KDLH 200153Z VRB03KT 10SM CLR 10/09 A3006</raw_text><station_id>KDLH</station_id>'
    '<observation_time>2026-09-20T01:53:00.000Z</observation_time><temp_c>10</temp_c><dewpoint_c>9</dewpoint_c>'
    '<wind_dir_degrees>VRB</wind_dir_degrees><wind_speed_kt>3</wind_speed_kt><visibility_statute_mi>10+</visibility_statute_mi>'
    '<flight_category>VFR</flight_category></METAR>'
    '<METAR><raw_text>KORD 200151Z 09008KT 2SM BR OVC006 14/13 A2998</raw_text><station_id>KORD</station_id>'
    '<observation_time>2026-09-20T01:51:00.000Z</observation_time><visibility_statute_mi>2</visibility_statute_mi>'
    '<sky_condition sky_cover="OVC" cloud_base_ft_agl="600"/><flight_category>IFR</flight_category></METAR>'
)

TAFS = _cache_file(
    # Periods listed newest-first, as the real file does.
    '<TAF><raw_text>TAF KDLH 200000Z 2000/2024 ...</raw_text><station_id>KDLH</station_id>'
    '<issue_time>2026-09-20T00:00:00.000Z</issue_time><latitude>46.8421</latitude><longitude>-92.1936</longitude>'
    '<forecast><fcst_time_from>2026-09-20T06:00:00.000Z</fcst_time_from><fcst_time_to>2026-09-20T12:00:00.000Z</fcst_time_to>'
    '<change_indicator>FM</change_indicator><visibility_statute_mi>6+</visibility_statute_mi>'
    '<sky_condition sky_cover="BKN" cloud_base_ft_agl="4000"/></forecast>'
    '<forecast><fcst_time_from>2026-09-20T00:00:00.000Z</fcst_time_from><fcst_time_to>2026-09-20T06:00:00.000Z</fcst_time_to>'
    '<visibility_statute_mi>3</visibility_statute_mi><sky_condition sky_cover="OVC" cloud_base_ft_agl="1500"/></forecast></TAF>'
    # Far off the route: must be ignored however bad it is.
    '<TAF><station_id>KLAX</station_id><issue_time>2026-09-20T00:00:00.000Z</issue_time>'
    '<latitude>33.9425</latitude><longitude>-118.408</longitude>'
    '<forecast><fcst_time_from>2026-09-20T00:00:00.000Z</fcst_time_from><fcst_time_to>2026-09-20T12:00:00.000Z</fcst_time_to>'
    '<visibility_statute_mi>1</visibility_statute_mi><sky_condition sky_cover="OVC" cloud_base_ft_agl="200"/></forecast></TAF>'
)


def _sigmet(name: str, valid_to: str, points: list) -> str:
    area = "".join(f"<point><longitude>{lon}</longitude><latitude>{lat}</latitude></point>" for lat, lon in points)
    return (
        f'<AIRSIGMET><raw_text>{name}</raw_text><valid_time_from>2026-09-20T00:55:00.000Z</valid_time_from>'
        f'<valid_time_to>{valid_to}</valid_time_to><altitude max_ft_msl="43000"/><hazard type="CONVECTIVE" severity="SEV"/>'
        f'<airsigmet_type>SIGMET</airsigmet_type><area num_points="{len(points)}">{area}</area></AIRSIGMET>'
    )


ON_ROUTE = [(43.0, -91.0), (43.0, -89.0), (46.0, -89.0), (46.0, -91.0), (43.0, -91.0)]
FLORIDA = [(29.3, -79.2), (24.4, -78.8), (24.6, -83.5), (29.3, -79.2)]
AIRSIGMETS = _cache_file(
    _sigmet("CONVECTIVE SIGMET 1C", "2026-09-20T02:55:00.000Z", ON_ROUTE)
    + _sigmet("CONVECTIVE SIGMET 1E", "2026-09-20T02:55:00.000Z", FLORIDA)
    + _sigmet("CONVECTIVE SIGMET 9C (expired)", "2026-09-20T01:00:00.000Z", ON_ROUTE)
)


@pytest.fixture(autouse=True)
def _fresh_datasets(monkeypatch):
    monkeypatch.setattr(weather, "_DATASETS", {})


@patch("vfr.weather.requests.get", return_value=METARS)
def test_metar_for_idents_reads_the_newest_report_per_station_from_the_cache_file(mock_get):
    result = metar_for_idents(["KDLH", "KORD", "C81"])

    mock_get.assert_called_once()
    assert mock_get.call_args.args[0] == "https://aviationweather.gov/data/cache/metars.cache.xml.gz"
    assert result["KDLH"]["flight_category"] == "VFR"        # the 0153Z SPECI, not the 0053Z METAR
    assert result["KDLH"]["ceiling_ft"] is None              # CLR
    assert result["KDLH"]["wind_dir_true_deg"] is None       # VRB
    assert result["KDLH"]["wind_speed_kt"] == 3.0
    assert result["KORD"] == {
        "raw": "KORD 200151Z 09008KT 2SM BR OVC006 14/13 A2998", "flight_category": "IFR",
        "ceiling_ft": 600, "visibility_sm": 2.0, "wind_dir_true_deg": None, "wind_speed_kt": None,
        "temp_c": None, "dewpoint_c": None,
    }
    assert result["C81"] is None


@patch("vfr.weather.requests.get", return_value=METARS)
def test_one_download_serves_every_call_within_the_ttl(mock_get):
    metar_for_idents(["KDLH"])
    metar_for_idents(["KORD"])

    assert mock_get.call_count == 1


@patch("vfr.weather.time.sleep")
@patch("vfr.weather.requests.get")
def test_a_failed_refresh_serves_the_previous_copy_until_it_is_too_old(mock_get, mock_sleep):
    mock_get.return_value = METARS
    with patch("vfr.weather.time.time", return_value=T0200Z):
        assert metar_for_idents(["KORD"])["KORD"]["flight_category"] == "IFR"

    mock_get.side_effect = requests.ConnectionError("no route to host")
    with patch("vfr.weather.time.time", return_value=T0200Z + 10 * 60):
        assert metar_for_idents(["KORD"])["KORD"]["flight_category"] == "IFR"   # ten minutes old: served
    with patch("vfr.weather.time.time", return_value=T0200Z + 4 * 3600):
        with pytest.raises(WeatherServiceError):
            metar_for_idents(["KORD"])                                          # four hours old: not


@patch("vfr.weather.time.sleep")
@patch("vfr.weather.requests.get")
def test_a_certificate_failure_is_not_retried(mock_get, mock_sleep):
    """An expired or untrusted certificate fails the same way every time;
    the back-off would only delay the same answer by six seconds."""
    mock_get.side_effect = requests.exceptions.SSLError("certificate has expired")

    with pytest.raises(WeatherServiceError, match="certificate has expired"):
        metar_for_idents(["C81"])

    assert mock_get.call_count == 1
    mock_sleep.assert_not_called()


@patch("vfr.weather.time.sleep")
@patch("vfr.weather.requests.get")
def test_metar_for_idents_wraps_a_network_failure(mock_get, mock_sleep):
    mock_get.side_effect = requests.ConnectionError("no route to host")

    with pytest.raises(WeatherServiceError):
        metar_for_idents(["C81"])


@patch("vfr.weather.time.time", return_value=T0200Z)
@patch("vfr.weather.requests.get", return_value=TAFS)
def test_forecast_along_the_route_reads_each_nearby_stations_current_period(mock_get, mock_time):
    forecast = ceiling_visibility_along_route(C81, KDLH)

    assert forecast["stations"] == [{"icaoId": "KDLH", "ceiling_ft": 1500, "visibility_sm": 3.0}]
    assert forecast["min_ceiling_ft"] == 1500 and forecast["min_visibility_sm"] == 3.0


@patch("vfr.weather.time.time", return_value=T0200Z)
@patch("vfr.weather.requests.get", return_value=AIRSIGMETS)
def test_hazards_along_the_route_are_the_current_sigmets_the_line_crosses(mock_get, mock_time):
    hazards = hazards_along_route(C81, KDLH)

    assert hazards == [{
        "hazard": "CONVECTIVE", "type": "SIGMET", "altitude_low_ft": None, "altitude_high_ft": 43000.0,
        "raw": "CONVECTIVE SIGMET 1C",
    }]


# --- the basic VFR minimums, and the briefing's "VFR not recommended" ---


def test_the_minimums_are_under_1000_ft_or_3_sm_and_unknown_is_not_below():
    assert weather.below_vfr_minimums(900, 10)
    assert weather.below_vfr_minimums(5000, 2.5)
    assert not weather.below_vfr_minimums(1000, 3)
    assert not weather.below_vfr_minimums(None, None)


def test_vfr_not_recommended_names_each_reason_in_briefing_order():
    metars = {"C81": {"flight_category": "VFR"}, "KDLH": {"flight_category": "LIFR"}}
    forecast = {"min_ceiling_ft": 800.0, "min_visibility_sm": 2.5}
    assert weather.vfr_not_recommended_reasons(["C81", "KDLH"], metars, forecast) == [
        "KDLH currently reporting LIFR",
        "forecast ceiling as low as 800 ft along the route",
        "forecast visibility as low as 2.5 sm along the route",
    ]


def test_vfr_not_recommended_is_empty_when_nothing_warrants_it():
    metars = {"C81": None, "KDLH": {"flight_category": "MVFR"}}
    forecast = {"min_ceiling_ft": 1200.0, "min_visibility_sm": None}
    assert weather.vfr_not_recommended_reasons(["C81", "KDLH"], metars, forecast) == []
