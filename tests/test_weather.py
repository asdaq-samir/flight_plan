"""The weather the planner reads: the winds aloft as looked up
(wind_at_altitude, the freezing level), the GFS's since the FB ended
(wingtip.modelwinds, tests/test_modelwinds.py).

metar_for_idents and the WeatherServiceError wrapping below cover the
other half: every aviationweather.gov call in this module was
unhandled until this pass, so a mocked network failure is worth a test
of its own, not just the pure decoding helpers.
"""
import gzip
import time
from datetime import datetime, timezone
from unittest.mock import Mock, patch

import pytest
import requests

from wingtip import weather
from wingtip.weather import (
    WeatherServiceError,
    ceiling_visibility_along_route,
    hazards_along_route,
    metar_for_idents,
)


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
    '<elevation_m>434.0</elevation_m>'
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
    monkeypatch.setattr(weather, "_DATASET_FETCHING", {})
    # The winds aloft are the GFS's, read from NOMADS (tests/test_modelwinds.py):
    # none of these tests downloads them.
    from wingtip import modelwinds
    monkeypatch.setattr(modelwinds, "warm", lambda force=False: None)
    monkeypatch.setattr(modelwinds, "_HELD", {})
    monkeypatch.setattr(modelwinds, "_FAILED", {})


@patch("wingtip.weather.requests.get", return_value=METARS)
def test_metar_for_idents_reads_the_newest_report_per_station_from_the_cache_file(mock_get):
    result = metar_for_idents(["KDLH", "KORD", "C81"])

    mock_get.assert_called_once()
    assert mock_get.call_args.args[0] == "https://aviationweather.gov/data/cache/metars.cache.xml.gz"
    assert result["KDLH"]["flight_category"] == "VFR"        # the 0153Z SPECI, not the 0053Z METAR
    assert result["KDLH"]["ceiling_ft"] is None              # CLR
    assert result["KDLH"]["wind_dir_true_deg"] is None       # VRB
    assert result["KDLH"]["wind_speed_kt"] == 3.0
    assert result["KORD"] == {
        "raw": "KORD 200151Z 09008KT 2SM BR OVC006 14/13 A2998", "observed_at": "2026-09-20T01:51:00.000Z",
        "flight_category": "IFR", "wx": "", "ceiling_ft": 600, "ceiling_unknown": False, "visibility_sm": 2.0, "wind_dir_true_deg": None,
        "wind_speed_kt": None, "wind_gust_kt": None, "altimeter_in_hg": None, "temp_c": None, "dewpoint_c": None,
        "lat": None, "lon": None,
    }
    assert result["C81"] is None


@patch("wingtip.weather.requests.get", return_value=METARS)
def test_one_download_serves_every_call_within_the_ttl(mock_get):
    metar_for_idents(["KDLH"])
    metar_for_idents(["KORD"])

    assert mock_get.call_count == 1


@patch("wingtip.weather.time.sleep")
@patch("wingtip.weather.requests.get")
def test_a_failed_refresh_serves_the_held_metars_however_old(mock_get, mock_sleep):
    """Each METAR carries its own observation time, which the pilot sees,
    so the held copy is served through an outage of any length (AC
    00-45H; since 2026-11-04, when the copy was dropped after a fixed
    time). The products with a validity of their own run out: the TAF and
    SIGMET tests below."""
    mock_get.return_value = METARS
    with patch("wingtip.weather.time.time", return_value=T0200Z):
        assert metar_for_idents(["KORD"])["KORD"]["flight_category"] == "IFR"

    mock_get.side_effect = requests.ConnectionError("no route to host")
    with patch("wingtip.weather.time.time", return_value=T0200Z + 10 * 60):
        assert metar_for_idents(["KORD"])["KORD"]["flight_category"] == "IFR"   # ten minutes old: served
    with patch("wingtip.weather.time.time", return_value=T0200Z + 4 * 3600):
        assert metar_for_idents(["KORD"])["KORD"]["flight_category"] == "IFR"   # four hours old: still served


@patch("wingtip.weather.time.sleep")
@patch("wingtip.weather.requests.get")
def test_a_certificate_failure_is_not_retried(mock_get, mock_sleep):
    """An expired or untrusted certificate fails the same way every time;
    the back-off would only delay the same answer by six seconds."""
    mock_get.side_effect = requests.exceptions.SSLError("certificate has expired")

    # The pilot reads the product's name; the cause is the developer's.
    with pytest.raises(WeatherServiceError, match="METARs unavailable") as raised:
        metar_for_idents(["C81"])
    assert "certificate has expired" in str(raised.value.__cause__)

    assert mock_get.call_count == 1
    mock_sleep.assert_not_called()


@patch("wingtip.weather.time.sleep")
@patch("wingtip.weather.requests.get")
def test_a_request_refused_as_asked_is_not_retried_and_one_too_many_is(mock_get, mock_sleep):
    """The windtemp API's 400 since its tables were discontinued (NWS SCN
    26-47) is the same answer on every try: three tries and their back-off
    put 6.5 s on a plan. A 429 asks to be tried later, and is."""
    refused = Mock(status_code=400, text='{"status":"error","error":"Wind/temp tables have been discontinued"}')
    mock_get.return_value = refused
    with pytest.raises(WeatherServiceError, match="refused: 400"):
        weather._get("https://aviationweather.gov/api/data/windtemp", {"fcst": "06"})
    assert mock_get.call_count == 1
    mock_sleep.assert_not_called()

    mock_get.reset_mock()
    busy = Mock(status_code=429, text="slow down")
    busy.raise_for_status.side_effect = requests.HTTPError("429 Client Error")
    mock_get.return_value = busy
    with pytest.raises(WeatherServiceError, match="after 3 attempts"):
        weather._get("https://aviationweather.gov/api/data/windtemp", {"fcst": "06"})
    assert mock_get.call_count == 3


def test_a_routes_weather_is_read_ahead_off_the_request_and_a_failure_is_left_to_the_plan():
    fetched = []

    def fetch(names, force=False):
        fetched.append((names, force))
        raise WeatherServiceError("METARs unavailable from aviationweather.gov just now")

    winds = []
    with patch("wingtip.weather._fetch_each", side_effect=fetch), \
            patch("wingtip.weather._fd_stations", side_effect=winds.append):
        weather.read_ahead("12").join(timeout=5)
    # Not forced: a held copy still good is not downloaded again. The
    # winds are the GFS's (_fd_stations), read even when a report fails.
    assert fetched == [(("metars", "tafs", "airsigmets", "pireps", "gairmets"), False)]
    assert winds == ["12"]


@patch("wingtip.weather.time.sleep")
@patch("wingtip.weather.requests.get")
def test_metar_for_idents_wraps_a_network_failure(mock_get, mock_sleep):
    mock_get.side_effect = requests.ConnectionError("no route to host")

    with pytest.raises(WeatherServiceError):
        metar_for_idents(["C81"])


@patch("wingtip.weather.time.time", return_value=T0200Z)
@patch("wingtip.weather.requests.get", return_value=TAFS)
def test_the_forecast_along_the_route_reads_the_held_taf_set_not_a_fresh_download(mock_get, mock_time):
    # Twice: one download. It downloaded and parsed the whole set on every
    # call, its parser passed where `force` goes -- 0.9 s of each briefing.
    ceiling_visibility_along_route(C81, KDLH)
    ceiling_visibility_along_route(C81, KDLH)
    assert mock_get.call_count == 1


@patch("wingtip.weather.time.time", return_value=T0200Z)
@patch("wingtip.weather.requests.get", return_value=TAFS)
def test_forecast_along_the_route_reads_each_nearby_stations_current_period(mock_get, mock_time):
    forecast = ceiling_visibility_along_route(C81, KDLH)

    # Where each station is and how high its field: a ceiling is above
    # the field, and wingtip.altitude keeps a leg under the clouds in MSL.
    assert forecast["stations"] == [{
        "icaoId": "KDLH", "lat": 46.8421, "lon": -92.1936, "elevation_ft": 1424, "ceiling_ft": 1500, "ceiling_unknown": False,
        "visibility_sm": 3.0,
    }]
    assert forecast["min_ceiling_ft"] == 1500 and forecast["min_visibility_sm"] == 3.0


@patch("wingtip.weather.time.time", return_value=T0200Z)
@patch("wingtip.weather.requests.get", return_value=AIRSIGMETS)
def test_hazards_along_the_route_are_the_current_sigmets_the_line_crosses(mock_get, mock_time):
    hazards = hazards_along_route(C81, KDLH)

    assert [{k: h[k] for k in ("hazard", "type", "altitude_low_ft", "altitude_high_ft", "raw")} for h in hazards] == [{
        "hazard": "CONVECTIVE", "type": "SIGMET", "altitude_low_ft": None, "altitude_high_ft": 43000.0,
        "raw": "CONVECTIVE SIGMET 1C",
    }]
    # With its valid times and its area, for the briefing to say where
    # and when the flight meets it; no WMO heading here, so no issue time.
    start = datetime(2026, 9, 20, 0, 55, tzinfo=timezone.utc).timestamp()
    assert (hazards[0]["valid_from"], hazards[0]["valid_to"]) == (start, start + 2 * 3600)
    assert hazards[0]["coords"] == ON_ROUTE and hazards[0]["issued"] is None


def test_a_sigmets_issue_time_is_its_wmo_headings_day_hour_and_minute():
    """WSUS32 KKCI 261655: issued the 26th at 1655Z (WMO-No. 386's
    abbreviated heading), in the month of its valid time -- the month
    before for the 31st read on the 1st."""
    valid = datetime(2026, 10, 26, 16, 55, tzinfo=timezone.utc).timestamp()
    assert weather._wmo_issued("WSUS32 KKCI 261655\nSIGC\nCONVECTIVE SIGMET 45C", valid) == "2026-10-26T16:55:00Z"
    first = datetime(2026, 11, 1, 0, 55, tzinfo=timezone.utc).timestamp()
    assert weather._wmo_issued("WSUS31 KKCI 312355 SIGE", first) == "2026-10-31T23:55:00Z"
    assert weather._wmo_issued("CONVECTIVE SIGMET 1C", valid) is None


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


# --- reading a TAF over the flight's own hours ------------------------------

def _taf(periods: str) -> Mock:
    return _cache_file(
        '<TAF><raw_text>TAF KDLH ...</raw_text><station_id>KDLH</station_id>'
        '<issue_time>2026-09-20T00:00:00.000Z</issue_time><latitude>46.8421</latitude><longitude>-92.1936</longitude>'
        f'{periods}</TAF>'
    )


def _fcst(start: str, end: str, change: str = "", vis: str = "6+", sky: str = "", vv: str = "") -> str:
    return (
        f'<forecast><fcst_time_from>2026-09-20T{start}:00:00.000Z</fcst_time_from>'
        f'<fcst_time_to>2026-09-20T{end}:00:00.000Z</fcst_time_to>'
        + (f"<change_indicator>{change}</change_indicator>" if change else "")
        + f"<visibility_statute_mi>{vis}</visibility_statute_mi>{sky}"
        + (f"<vert_vis_ft>{vv}</vert_vis_ft>" if vv else "")
        + "</forecast>"
    )


def _at(hour: int) -> float:
    return datetime(2026, 9, 20, hour, tzinfo=timezone.utc).timestamp()


FOG_IN_A_TEMPO = _taf(
    _fcst("00", "12", sky='<sky_condition sky_cover="SCT" cloud_base_ft_agl="5000"/>')
    + _fcst("04", "06", change="TEMPO", vis="0.5", sky='<sky_condition sky_cover="OVX"/>', vv="200")
)


@patch("wingtip.weather.requests.get", return_value=FOG_IN_A_TEMPO)
def test_a_tempo_group_counts_toward_the_worst_the_forecast_allows(mock_get):
    """TEMPO 1/2SM FG VV002 inside an otherwise VFR period: a go/no-go read
    is the worst the forecast allows, and vertical visibility is a ceiling."""
    during = ceiling_visibility_along_route(C81, KDLH, window=(_at(3), _at(5)))
    assert during["min_ceiling_ft"] == 200 and during["min_visibility_sm"] == 0.5

    before = ceiling_visibility_along_route(C81, KDLH, window=(_at(1), _at(2)))
    assert before["min_ceiling_ft"] is None and before["min_visibility_sm"] == 6.0


@patch("wingtip.weather.requests.get", return_value=_taf(_fcst("00", "06", vis="3")))
def test_a_forecast_that_does_not_cover_the_flight_says_nothing_about_it(mock_get):
    """It used to fall back to the TAF's first period -- an expired
    forecast read as current."""
    later = ceiling_visibility_along_route(C81, KDLH, window=(_at(8), _at(10)))
    assert later == {"min_ceiling_ft": None, "min_visibility_sm": None, "ceiling_unknown_at": [], "stations": []}


@patch("wingtip.weather.requests.get", return_value=_taf(
    _fcst("00", "12", vis="6+")
    + _fcst("02", "03", change="BECMG", vis="2", sky='<sky_condition sky_cover="BKN" cloud_base_ft_agl="800"/>')))
def test_a_becmg_change_lasts_past_its_own_window(mock_get):
    """BECMG 0203 ... 2SM BKN008 still holds at 0600: the feed carries no
    base period after it, so taking only what overlaps 0600 read VFR."""
    later = ceiling_visibility_along_route(C81, KDLH, window=(_at(6), _at(7)))
    assert later["min_ceiling_ft"] == 800 and later["min_visibility_sm"] == 2.0


# A layer a station could not measure ("OVC///", "VV///") comes in the
# AWC's data API with no base: its sky_condition has no cloud_base_ft_agl.
UNMEASURED = _cache_file(
    # OVC/// with ten miles: the AWC's own category says VFR.
    '<METAR><raw_text>KAAA 200153Z AUTO 00000KT 10SM OVC/// 10/09 A3006</raw_text><station_id>KAAA</station_id>'
    '<observation_time>2026-09-20T01:53:00.000Z</observation_time><visibility_statute_mi>10+</visibility_statute_mi>'
    '<sky_condition sky_cover="OVC"/><flight_category>VFR</flight_category></METAR>'
    # BKN/// above a measured broken layer: the lower one is the ceiling.
    '<METAR><raw_text>KBBB 200153Z AUTO 00000KT 10SM BKN012 OVC/// 10/09 A3006</raw_text><station_id>KBBB</station_id>'
    '<observation_time>2026-09-20T01:53:00.000Z</observation_time><visibility_statute_mi>10+</visibility_statute_mi>'
    '<sky_condition sky_cover="BKN" cloud_base_ft_agl="1200"/><sky_condition sky_cover="OVC"/>'
    '<flight_category>MVFR</flight_category></METAR>'
    # BKN/// under a measured overcast: the ceiling is not known.
    '<METAR><raw_text>KCCC 200153Z AUTO 00000KT 10SM FEW008 BKN/// OVC025 10/09 A3006</raw_text><station_id>KCCC</station_id>'
    '<observation_time>2026-09-20T01:53:00.000Z</observation_time><visibility_statute_mi>10+</visibility_statute_mi>'
    '<sky_condition sky_cover="FEW" cloud_base_ft_agl="800"/><sky_condition sky_cover="BKN"/>'
    '<sky_condition sky_cover="OVC" cloud_base_ft_agl="2500"/><flight_category>MVFR</flight_category></METAR>'
    # VV/// in fog: the visibility settles LIFR whatever the ceiling.
    '<METAR><raw_text>KDDD 200153Z AUTO 00000KT 1/4SM FG VV/// 10/10 A3006</raw_text><station_id>KDDD</station_id>'
    '<observation_time>2026-09-20T01:53:00.000Z</observation_time><visibility_statute_mi>0.25</visibility_statute_mi>'
    '<sky_condition sky_cover="OVX"/><flight_category>LIFR</flight_category></METAR>'
)


@patch("wingtip.weather.requests.get", return_value=UNMEASURED)
def test_a_ceiling_reported_with_no_height_is_not_known(mock_get):
    """14 CFR 1.1: the ceiling is the lowest broken, overcast or obscured
    layer, so one reported with no height leaves it not known -- not
    none, and so not VFR."""
    found = metar_for_idents(["KAAA", "KBBB", "KCCC", "KDDD"])
    sky = {i: (m["ceiling_ft"], m["ceiling_unknown"], m["flight_category"]) for i, m in found.items()}
    assert sky == {
        "KAAA": (None, True, None),
        "KBBB": (1200, False, "MVFR"),
        "KCCC": (None, True, None),
        "KDDD": (None, True, "LIFR"),
    }


@patch("wingtip.weather.requests.get", return_value=UNMEASURED)
def test_vfr_not_recommended_says_a_ceiling_of_unknown_height(mock_get):
    metars = metar_for_idents(["KAAA", "KBBB"])
    forecast = {"min_ceiling_ft": None, "min_visibility_sm": 6.0, "ceiling_unknown_at": ["KDLH"], "stations": []}
    assert weather.vfr_not_recommended_reasons(["KAAA", "KBBB"], metars, forecast) == [
        "KAAA currently reporting a ceiling of unknown height",
        "forecast ceiling of unknown height at KDLH",
    ]


@patch("wingtip.weather.requests.get", return_value=_taf(
    _fcst("00", "12", vis="6+", sky='<sky_condition sky_cover="BKN" cloud_base_ft_agl="4000"/>')
    + _fcst("04", "06", change="TEMPO", vis="6+", sky='<sky_condition sky_cover="OVC"/>')))
def test_a_forecast_ceiling_with_no_height_is_not_known(mock_get):
    """TEMPO OVC/// under a BKN040 forecast: the worst ceiling the forecast
    allows is not known, so 4,000 ft is not the whole of it."""
    during = ceiling_visibility_along_route(C81, KDLH, window=(_at(3), _at(5)))
    assert (during["min_ceiling_ft"], during["ceiling_unknown_at"]) == (4000, ["KDLH"])
    assert during["stations"][0]["ceiling_unknown"] is True
    before = ceiling_visibility_along_route(C81, KDLH, window=(_at(1), _at(2)))
    assert (before["min_ceiling_ft"], before["ceiling_unknown_at"]) == (4000, [])
    assert weather.tafs_over({"KDLH": (_at(4), _at(5))})["KDLH"]["ceiling_unknown"] is True


def test_a_freezing_level_below_the_lowest_reading_says_so(monkeypatch):
    """Below 0 degC already at 6,000 ft, the winds-aloft product's lowest
    temperature: the freezing level is there or lower, not at 6,000."""
    from wingtip import airports, weather
    monkeypatch.setattr(weather, "_fd_stations", lambda fcst_hr: {"DLH": {6000: {"temp_c": -2}, 9000: {"temp_c": -8}}})
    monkeypatch.setattr(weather, "_nearest_station", lambda lat, lon, ids, df: "DLH")
    monkeypatch.setattr(airports, "load_airports", lambda: None)

    assert weather.freezing_level(46.8, -92.2) == {"ft": 6000.0, "at_or_below": True}


def test_a_freezing_level_between_readings_is_interpolated(monkeypatch):
    from wingtip import airports, weather
    monkeypatch.setattr(weather, "_fd_stations", lambda fcst_hr: {"DLH": {6000: {"temp_c": 4}, 9000: {"temp_c": -2}}})
    monkeypatch.setattr(weather, "_nearest_station", lambda lat, lon, ids, df: "DLH")
    monkeypatch.setattr(airports, "load_airports", lambda: None)

    assert weather.freezing_level(46.8, -92.2) == {"ft": 8000.0, "at_or_below": False}


def test_the_temperature_between_two_reports_is_interpolated_and_below_them_lapsed(monkeypatch):
    """6,000 ft is the lowest temperature the product gives; under it the
    standard lapse rate (about 2 degC per 1,000 ft) is all there is."""
    from wingtip import airports, weather
    monkeypatch.setattr(weather, "_fd_stations", lambda fcst_hr: {"DLH": {
        3000: {"temp_c": None}, 6000: {"temp_c": 4}, 9000: {"temp_c": -2}}})
    monkeypatch.setattr(weather, "_nearest_station", lambda lat, lon, ids, df: "DLH")
    monkeypatch.setattr(airports, "load_airports", lambda: None)
    assert weather.temperatures_aloft(46.8, -92.2) == [(6000.0, 4), (9000.0, -2)]
    assert weather.temperature_at_altitude(46.8, -92.2, 7500.0) == pytest.approx(1.0)
    assert weather.temperature_at_altitude(46.8, -92.2, 3000.0) == pytest.approx(4 + 3 * 1.9812)
    assert weather.temperature_at([], 5000.0) is None


# --- one download at a time, and nobody with a copy waits for it ------------

def test_a_reader_during_a_refresh_is_served_the_held_copy_at_once(monkeypatch):
    """The periodic refresh used to hold the lock for its whole download,
    so every reader waited behind it -- up to a minute and a half."""
    import threading
    import time as clock
    from wingtip import weather

    release, started = threading.Event(), threading.Event()

    def slow_get(url, params=None, headers=None, timeout=None):
        started.set()
        release.wait(5)
        return METARS

    with patch("wingtip.weather.requests.get", return_value=METARS):
        metar_for_idents(["KDLH"])                      # a held copy
    monkeypatch.setattr(weather.requests, "get", slow_get)
    refresher = threading.Thread(target=lambda: weather._dataset("metars", force=True))
    refresher.start()
    started.wait(5)

    before = clock.monotonic()
    assert metar_for_idents(["KDLH"])["KDLH"]["flight_category"] == "VFR"
    assert clock.monotonic() - before < 1.0
    release.set()
    refresher.join(5)


def test_callers_with_nothing_held_share_one_download(monkeypatch):
    import threading
    from wingtip import weather

    calls = []
    release = threading.Event()

    def slow_get(url, params=None, headers=None, timeout=None):
        calls.append(url)
        release.wait(5)
        return METARS

    monkeypatch.setattr(weather.requests, "get", slow_get)
    results = []
    threads = [threading.Thread(target=lambda: results.append(metar_for_idents(["KORD"]))) for _ in range(4)]
    for t in threads:
        t.start()
    release.set()
    for t in threads:
        t.join(5)

    assert len(calls) == 1
    assert len(results) == 4 and all(r["KORD"]["flight_category"] == "IFR" for r in results)


# --- a failure with nothing to serve, and the winds held by the same rule ---

def _text(body: str) -> Mock:
    response = Mock(status_code=200, text=body)
    response.raise_for_status.return_value = None
    return response


@patch("wingtip.weather.time.sleep")
@patch("wingtip.weather.requests.get")
def test_a_failure_with_nothing_held_is_the_answer_for_a_minute(mock_get, mock_sleep):
    """Every caller used to run a retry cycle of its own, one behind the
    other, while there was nothing to serve."""
    mock_get.side_effect = requests.ConnectionError("no route to host")
    with patch("wingtip.weather.time.time", return_value=T0200Z):
        with pytest.raises(WeatherServiceError, match="METARs unavailable") as raised:
            metar_for_idents(["KORD"])
    assert "no route to host" in str(raised.value.__cause__)
    attempts = mock_get.call_count

    with patch("wingtip.weather.time.time", return_value=T0200Z + 30):
        with pytest.raises(WeatherServiceError, match="METARs unavailable"):
            metar_for_idents(["KORD"])
    assert mock_get.call_count == attempts

    mock_get.side_effect, mock_get.return_value = None, METARS
    with patch("wingtip.weather.time.time", return_value=T0200Z + 61):
        assert metar_for_idents(["KORD"])["KORD"]["flight_category"] == "IFR"


@patch("wingtip.weather.time.sleep")
@patch("wingtip.weather.requests.get")
def test_metars_are_served_through_an_outage_with_their_own_times(mock_get, mock_sleep):
    """A METAR has no period of validity, only the time it was made, which
    each report carries: the last set heard is served, its age said."""
    mock_get.return_value = METARS
    with patch("wingtip.weather.time.time", return_value=T0200Z):
        metar_for_idents(["KORD"])
    mock_get.return_value, mock_get.side_effect = None, requests.ConnectionError("no route to host")
    with patch("wingtip.weather.time.time", return_value=T0200Z + 6 * 3600):
        report = metar_for_idents(["KORD"])["KORD"]
    assert report["observed_at"] == "2026-09-20T01:51:00.000Z"
    assert weather.dataset_status()["metars"] == T0200Z


@patch("wingtip.weather.time.sleep")
@patch("wingtip.weather.requests.get")
def test_a_taf_set_is_served_to_the_end_of_its_latest_period_and_no_further(mock_get, mock_sleep):
    mock_get.return_value = TAFS
    with patch("wingtip.weather.time.time", return_value=T0200Z):
        weather._dataset("tafs")
    ends = datetime(2026, 9, 20, 12, 0, tzinfo=timezone.utc).timestamp()   # the latest period above
    mock_get.return_value, mock_get.side_effect = None, requests.ConnectionError("no route to host")
    with patch("wingtip.weather.time.time", return_value=ends - 60):
        assert weather._dataset("tafs")[0]["icaoId"] == "KDLH"
    with patch("wingtip.weather.time.time", return_value=ends + 120):
        with pytest.raises(WeatherServiceError):
            weather._dataset("tafs")


@patch("wingtip.weather.time.sleep")
@patch("wingtip.weather.requests.get")
def test_sigmets_are_served_until_the_last_of_them_ends(mock_get, mock_sleep):
    mock_get.return_value = AIRSIGMETS
    with patch("wingtip.weather.time.time", return_value=T0200Z):
        weather._dataset("airsigmets")
    ends = datetime(2026, 9, 20, 2, 55, tzinfo=timezone.utc).timestamp()   # the latest valid_to above
    mock_get.return_value, mock_get.side_effect = None, requests.ConnectionError("no route to host")
    with patch("wingtip.weather.time.time", return_value=ends - 60):
        assert len(weather._dataset("airsigmets")) == 3
    with patch("wingtip.weather.time.time", return_value=ends + 120):
        with pytest.raises(WeatherServiceError):
            weather._dataset("airsigmets")


@patch("wingtip.weather.time.sleep")
@patch("wingtip.weather.requests.get")
def test_a_refresh_tries_every_source_and_raises_the_first_failure(mock_get, mock_sleep):
    def answer(url, params=None, headers=None, timeout=None):
        if "metars" in url:
            raise requests.ConnectionError("metars down")
        return TAFS if "tafs" in url else AIRSIGMETS

    mock_get.side_effect = answer
    with pytest.raises(WeatherServiceError, match="METARs unavailable") as raised:
        weather.refresh()
    assert "metars down" in str(raised.value.__cause__)
    fetched = {name for name, at in weather.dataset_status().items() if at is not None}
    assert fetched == {"tafs", "airsigmets", "pireps", "gairmets"}


def test_no_code_path_asks_for_the_discontinued_fb(monkeypatch):
    """The FB's windtemp API answers 400 since the NAM ended (NWS Service
    Change Notice 26-47): preload, refresh and every winds lookup read
    the GFS (wingtip.modelwinds) and never ask aviationweather.gov for it."""
    from wingtip import modelwinds

    asked = []
    monkeypatch.setattr(weather.requests, "get", lambda url, **kw: asked.append(url) or METARS)
    warmed = []
    monkeypatch.setattr(modelwinds, "warm", lambda force=False: warmed.append(force))
    stations = weather.FdStations({"DLH": {9000: {"wind_dir_true_deg": 270.0, "wind_speed_kt": 30.0, "temp_c": -8.0}}})
    stations.period, stations.modelled = {"valid_at": "x", "use_from": "x", "use_to": "x"}, True
    monkeypatch.setattr(modelwinds, "stations", lambda fcst_hr="06": stations)
    for name in ("preload", "refresh"):
        try:
            getattr(weather, name)()
        except WeatherServiceError:
            pass
    assert weather.winds_period("06")["modelled"] is True
    assert warmed == [True, False]
    assert not [u for u in asked if "windtemp" in u]
    assert not hasattr(weather, "WINDTEMP_URL") and not hasattr(weather, "parse_fd_text")
    assert not [name for name in weather._SOURCES if name.startswith("winds")]


def test_winds_nomads_cannot_give_are_a_weather_service_error_in_a_pilots_words(monkeypatch):
    from wingtip import modelwinds

    def down(fcst_hr="06"):
        raise modelwinds.ModelWindsUnavailable("NOMADS answered 503")

    monkeypatch.setattr(modelwinds, "stations", down)
    with pytest.raises(WeatherServiceError, match="Winds aloft"):
        weather._fd_stations("06")
    assert weather.winds_period("06") is None


# --- PIREPs and G-AIRMETs ---

PIREP_XML = b"""<response><data>
<AircraftReport><observation_time>{now}</observation_time><aircraft_ref>C172</aircraft_ref><latitude>42.5</latitude>
  <longitude>-88.1</longitude><altitude_ft_msl>5500</altitude_ft_msl><turbulence_condition turbulence_intensity="MOD" />
  <icing_condition icing_intensity="NEG" /><report_type>PIREP</report_type><raw_text>UA /OV ... /TB MOD</raw_text></AircraftReport>
<AircraftReport><observation_time>{now}</observation_time><aircraft_ref>B738</aircraft_ref><latitude>42.6</latitude>
  <longitude>-88.0</longitude><altitude_ft_msl>36000</altitude_ft_msl><report_type>PIREP</report_type>
  <raw_text>UA FL360</raw_text></AircraftReport>
<AircraftReport><observation_time>{now}</observation_time><latitude>54.0</latitude><longitude>-50.0</longitude>
  <altitude_ft_msl>37000</altitude_ft_msl><report_type>AIREP</report_type><raw_text>ARP</raw_text></AircraftReport>
<AircraftReport><observation_time>{now}</observation_time><latitude>42.5</latitude><longitude>-80.0</longitude>
  <altitude_ft_msl>4000</altitude_ft_msl><report_type>Urgent PIREP</report_type><raw_text>UUA far east</raw_text></AircraftReport>
</data></response>"""


def test_the_pilot_reports_near_the_route_are_a_light_aeroplanes_not_the_airliners(monkeypatch):
    from datetime import datetime, timezone

    from wingtip import weather
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z").encode()
    reports = weather._parse_pireps(PIREP_XML.replace(b"{now}", now))
    assert [r["aircraft"] for r in reports] == ["C172", "B738", None]   # the AIREP left out
    monkeypatch.setattr(weather, "_dataset", lambda name: reports)
    near = weather.pireps_along_route([(42.0, -88.0), (43.0, -88.0)])
    assert [(r["aircraft"], r["turbulence"], r["icing"]) for r in near] == [("C172", "MOD", "NEG")]
    assert near[0]["along_track_nm"] == pytest.approx(30.0, abs=1.0)


GAIRMET_XML = b"""<response><data>
<GAIRMET><valid_time>2026-10-04T15:00:00.000Z</valid_time><hazard type="ICE" severity="MOD" /><geometry_type>AREA</geometry_type>
  <due_to>ICE</due_to><altitude min_ft_msl="FZL" max_ft_msl="16000" />
  <area><point><longitude>-89</longitude><latitude>42</latitude></point><point><longitude>-87</longitude><latitude>42</latitude></point>
  <point><longitude>-87</longitude><latitude>43</latitude></point><point><longitude>-89</longitude><latitude>43</latitude></point></area></GAIRMET>
<GAIRMET><valid_time>2026-10-04T18:00:00.000Z</valid_time><hazard type="ICE" severity="MOD" /><geometry_type>AREA</geometry_type>
  <due_to>ICE</due_to><altitude min_ft_msl="FZL" max_ft_msl="18000" />
  <area><point><longitude>-89</longitude><latitude>42</latitude></point><point><longitude>-87</longitude><latitude>42</latitude></point>
  <point><longitude>-87</longitude><latitude>43</latitude></point><point><longitude>-89</longitude><latitude>43</latitude></point></area></GAIRMET>
<GAIRMET><valid_time>2026-10-04T15:00:00.000Z</valid_time><hazard type="TURB-HI" severity="MOD" /><geometry_type>AREA</geometry_type>
  <area><point><longitude>-89</longitude><latitude>42</latitude></point><point><longitude>-87</longitude><latitude>42</latitude></point>
  <point><longitude>-87</longitude><latitude>43</latitude></point></area></GAIRMET>
</data></response>"""


def test_the_g_airmets_the_route_crosses_are_every_snapshot_with_its_time_and_area(monkeypatch):
    from wingtip import weather
    advisories = weather._parse_gairmets(GAIRMET_XML)
    assert len(advisories) == 2                                 # high-level turbulence left out
    monkeypatch.setattr(weather, "_dataset", lambda name: advisories)
    start = 1791126000.0                                          # 2026-10-04T14:20:00Z
    # Every snapshot the route crosses, with its time and area, for the
    # briefing to pick the one for when the flight is in it (app.exposure).
    snapshots = weather.gairmet_snapshots_along_route([(41.5, -88.0), (43.5, -88.0)], (start, start + 2 * 3600))
    assert [s["valid_at"] for s in snapshots] == ["2026-10-04T15:00:00.000Z", "2026-10-04T18:00:00.000Z"]
    assert len(snapshots[0]["coords"]) == 4
    assert {k: v for k, v in snapshots[0].items() if k not in ("valid", "coords")} == {
        "hazard": "Icing", "severity": "MOD", "due_to": "ICE", "valid_at": "2026-10-04T15:00:00.000Z", "issued": None,
        "altitude_low_ft": None, "from_freezing_level": True, "altitude_high_ft": 16000.0,
    }


@patch("wingtip.weather.requests.get", return_value=FOG_IN_A_TEMPO)
def test_a_station_is_read_for_when_the_flight_is_there(mock_get):
    """The fog in the TEMPO at 04-06Z is what a pilot arriving at 05Z is
    told, and not one arriving at 01Z: each place over its own hour."""
    assert weather.tafs_over({"KDLH": (_at(4), _at(6))}) == {
        "KDLH": {"ceiling_ft": 200, "ceiling_unknown": False, "visibility_sm": 0.5, "raw": "TAF KDLH ..."}}
    assert weather.tafs_over({"KDLH": (_at(0), _at(2))})["KDLH"]["visibility_sm"] == 6.0
    # One with no TAF held is left out; asked for none, nothing is read.
    assert weather.tafs_over({"KXXX": (_at(0), _at(2))}) == {}
    assert weather.tafs_over({}) == {} and mock_get.call_count == 1


def test_an_unchanged_product_is_not_downloaded_or_parsed_again(monkeypatch):
    """The held copy's ETag asks whether it has changed: a 304 keeps it."""
    from unittest.mock import MagicMock

    monkeypatch.setattr(weather, "_DATASETS", {})
    first = MagicMock(status_code=200, content=b"", headers={"ETag": '"abc"', "Last-Modified": "Wed, 07 Oct 2026 16:11:35 GMT"})
    unchanged = MagicMock(status_code=304, content=b"", headers={"ETag": '"abc"'})
    asked = []

    def get(url, params=None, headers=None, timeout=None):
        asked.append(headers)
        return first if len(asked) == 1 else unchanged

    parsed = []
    monkeypatch.setattr(weather.requests, "get", get)
    def parse(resp):
        parsed.append(1)
        return ["held"]

    monkeypatch.setitem(weather._SOURCES, "airsigmets", ("https://example/airsigmets", {}, parse, 300, lambda data, at: at + 3 * 3600))
    assert weather._dataset("airsigmets", force=True) == ["held"]
    assert weather._dataset("airsigmets", force=True) == ["held"]
    assert parsed == [1]
    assert asked[1]["If-None-Match"] == '"abc"' and asked[1]["If-Modified-Since"] == "Wed, 07 Oct 2026 16:11:35 GMT"


def test_the_weather_is_in_use_once_a_request_asks_for_it(monkeypatch):
    monkeypatch.setattr(weather, "_LAST_ASKED", 0.0)
    assert not weather.in_use()
    monkeypatch.setitem(weather._DATASETS, "metars", weather._Record(at=time.time(), data={}, attempted=time.time(), error=None))
    weather._dataset("metars")
    assert weather.in_use()


def test_a_field_with_no_report_is_given_the_nearest_and_told_whether_it_is_near(monkeypatch):
    # One station 6 nm north of the point, one 12 nm east -- past ten
    # statute miles (8.7 nm), within thirty -- and one with no place.
    now = datetime.fromtimestamp(time.time() - 600, timezone.utc).isoformat()
    reports = {
        "KNEAR": {"flight_category": "MVFR", "lat": 42.4, "lon": -88.0, "observed_at": now},
        "KFAR": {"flight_category": "VFR", "lat": 42.3, "lon": -88.0 + 12 / 60 / 0.7396, "observed_at": now},
        "KNONE": {"flight_category": "VFR", "lat": None, "lon": None, "observed_at": now},
    }
    monkeypatch.setattr(weather, "_dataset", lambda name: reports)
    near = weather.nearest_report(42.3, -88.0)
    assert near["ident"] == "KNEAR" and near["distance_nm"] == 6.0 and near["bearing_deg"] == 0 and near["near"]
    assert near["metar"]["flight_category"] == "MVFR"
    # The nearest past ten statute miles: given, and not near.
    far = weather.nearest_report(42.3, -88.0, exclude="KNEAR")
    assert far["ident"] == "KFAR" and abs(far["distance_nm"] - 12) < 0.2 and far["bearing_deg"] == 90 and not far["near"]
    # None within thirty.
    assert weather.nearest_report(45.0, -100.0) is None


def test_the_nearest_report_is_a_current_one(monkeypatch):
    # An old station nearer than a current one must not hide it, and one
    # with no time is not known to be current.
    fresh = datetime.fromtimestamp(time.time() - 1800, timezone.utc).isoformat()
    old = datetime.fromtimestamp(time.time() - 3 * 3600, timezone.utc).isoformat()
    reports = {
        "KOLD": {"flight_category": "IFR", "lat": 42.31, "lon": -88.0, "observed_at": old},
        "KNOTIME": {"flight_category": "IFR", "lat": 42.32, "lon": -88.0},
        "KNEW": {"flight_category": "VFR", "lat": 42.4, "lon": -88.0, "observed_at": fresh},
    }
    monkeypatch.setattr(weather, "_dataset", lambda name: reports)
    assert weather.nearest_report(42.3, -88.0)["ident"] == "KNEW"
    assert weather.nearest_report(42.3, -88.0, exclude="KNEW") is None


# --- the wind forecast at a field for a time ---

WINDY_TAFS = _cache_file(
    '<TAF><raw_text>TAF KDLH ...</raw_text><station_id>KDLH</station_id><issue_time>2026-09-20T00:00:00.000Z</issue_time>'
    '<latitude>46.8421</latitude><longitude>-92.1936</longitude><elevation_m>434.0</elevation_m>'
    '<forecast><fcst_time_from>2026-09-20T00:00:00.000Z</fcst_time_from><fcst_time_to>2026-09-20T06:00:00.000Z</fcst_time_to>'
    '<wind_dir_degrees>270</wind_dir_degrees><wind_speed_kt>10</wind_speed_kt></forecast>'
    '<forecast><fcst_time_from>2026-09-20T02:00:00.000Z</fcst_time_from><fcst_time_to>2026-09-20T04:00:00.000Z</fcst_time_to>'
    '<change_indicator>TEMPO</change_indicator><wind_dir_degrees>360</wind_dir_degrees><wind_speed_kt>25</wind_speed_kt></forecast>'
    '<forecast><fcst_time_from>2026-09-20T06:00:00.000Z</fcst_time_from><fcst_time_to>2026-09-20T12:00:00.000Z</fcst_time_to>'
    '<change_indicator>FM</change_indicator><wind_dir_degrees>090</wind_dir_degrees><wind_speed_kt>8</wind_speed_kt>'
    '<wind_gust_kt>18</wind_gust_kt></forecast>'
    '<forecast><fcst_time_from>2026-09-20T09:00:00.000Z</fcst_time_from><fcst_time_to>2026-09-20T10:00:00.000Z</fcst_time_to>'
    '<change_indicator>BECMG</change_indicator><wind_dir_degrees>VRB</wind_dir_degrees><wind_speed_kt>4</wind_speed_kt></forecast></TAF>'
)

@patch("wingtip.weather.time.time", return_value=T0200Z)
@patch("wingtip.weather.requests.get", return_value=WINDY_TAFS)
def test_the_wind_forecast_at_a_field_is_the_prevailing_one_then_never_a_tempo(mock_get, mock_time):
    """For the runway a flight will find in use when it gets there (the
    owner's pick, 2026-10-20), the TAF's prevailing wind at that time."""
    at = lambda h: datetime(2026, 9, 20, h, 0, tzinfo=timezone.utc).timestamp()  # noqa: E731
    # Mid TEMPO: the base period's 270 at 10, not the TEMPO's 25 kt.
    three = weather.forecast_wind(*KDLH, at(3), "KDLH")
    assert (three["ident"], three["distance_nm"], three["dir_true_deg"], three["speed_kt"]) == ("KDLH", 0.0, 270.0, 10.0)
    seven = weather.forecast_wind(*KDLH, at(7), "KDLH")
    assert (seven["dir_true_deg"], seven["speed_kt"], seven["gust_kt"]) == (90.0, 8.0, 18.0)
    # A BECMG lasts past its own hour, to the end of the forecast: variable.
    eleven = weather.forecast_wind(*KDLH, at(11), "KDLH")
    assert (eleven["dir_true_deg"], eleven["speed_kt"]) == (None, 4.0)
    # Past the TAF's end, none.
    assert weather.forecast_wind(*KDLH, at(13), "KDLH") is None


@patch("wingtip.weather.time.time", return_value=T0200Z)
@patch("wingtip.weather.requests.get", return_value=WINDY_TAFS)
def test_a_field_without_a_taf_has_the_nearest_ones_within_thirty_miles(mock_get, mock_time):
    at = datetime(2026, 9, 20, 7, 0, tzinfo=timezone.utc).timestamp()
    near = weather.forecast_wind(46.70, -92.20, at, "KSUW")
    assert near["ident"] == "KDLH" and 8 < near["distance_nm"] < 9
    assert weather.forecast_wind(*C81, at, "C81") is None


def test_sources_status_names_each_source_and_says_which_is_served_on(monkeypatch):
    # The pilot's Status page: each source in a pilot's words, its copy's
    # age, to when a held copy is used, and which source is failing.
    monkeypatch.setattr(weather, "_DATASETS", {})
    failed = weather.WeatherServiceError("TAFs unavailable from aviationweather.gov just now")
    monkeypatch.setitem(weather._DATASETS, "tafs", weather._Record(at=100.0, data={}, attempted=200.0, error=failed, until=900.0))
    monkeypatch.setitem(weather._DATASETS, "metars", weather._Record(at=150.0, data={}, attempted=150.0, error=None, until=float("inf")))
    by_name = {s["name"]: s for s in weather.sources_status()}
    assert by_name["TAFs"] == {"name": "TAFs", "fetched_at": 100.0, "kept_until": 900.0, "failing": True}
    assert by_name["METARs"] == {"name": "METARs", "fetched_at": 150.0, "kept_until": None, "failing": False}
    # The winds aloft, modelled, each period to the end of its own window.
    winds = by_name["Winds aloft, modelled (GFS), 6-hour"]
    assert winds["fetched_at"] is None and not winds["failing"]
