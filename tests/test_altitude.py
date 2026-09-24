"""vfr.altitude.select_cruise_altitude with its data sources stubbed: the
hemispheric rule leg by leg, and the freezing level as an icing warning
rather than a ceiling."""
from pathlib import Path

import pytest

from vfr import airspace, altitude, sua, terrain, weather

PROFILE = {"service_ceiling_ft": 14000, "cruise_tas_kt": 110}
DEP, DEST = (45.0, -90.0), (46.0, -90.0)          # due north
DOGLEG = (45.5, -89.85)                            # east of the line


@pytest.fixture
def sources(monkeypatch):
    """Flat 2,000 ft floor, no airspace, no variation, and weather the
    test sets."""
    state = {"freezing": None, "cv": {"min_ceiling_ft": None, "min_visibility_sm": None, "stations": []},
             "hazards": []}
    monkeypatch.setattr(airspace, "ensure_class_airspace_shapefile", lambda cache_dir: Path("/nowhere"))
    monkeypatch.setattr(terrain, "floor_profile", lambda start, end, breaks, faa_cache_dir=None: [2000.0] * (len(breaks) - 1))
    monkeypatch.setattr(airspace, "airspace_ceiling_profile", lambda start, end, fixes, shp: [None] * (len(fixes) - 1))
    monkeypatch.setattr(airspace, "max_airspace_altitude_msl", lambda start, end, shp: None)
    monkeypatch.setattr(airspace, "airspace_transits", lambda start, end, shp, fixes=None: [])
    monkeypatch.setattr(altitude, "magnetic_variation_deg", lambda lat, lon: 0.0)
    monkeypatch.setattr(weather, "freezing_level", lambda lat, lon, fcst_hr="06": state["freezing"])
    monkeypatch.setattr(weather, "ceiling_visibility_along_route", lambda start, end, window=None: state["cv"])
    monkeypatch.setattr(weather, "hazards_along_route", lambda start, end: state["hazards"])
    state["special_use"] = []
    monkeypatch.setattr(sua, "along_route", lambda start, end, fixes=None: state["special_use"])
    return state


def test_each_leg_is_rounded_to_its_own_magnetic_course(sources):
    """A north-bound route with a dogleg east of the line: the first leg
    flies 010-ish (odd thousands plus 500), the second 350-ish (even)."""
    result = altitude.select_cruise_altitude(DEP, DEST, PROFILE, fixes=[DEP, DOGLEG, DEST])

    first, second = result["segments"]
    assert first["eastbound"] is True and first["candidates_ft"][0] == 3500.0
    assert second["eastbound"] is False and second["candidates_ft"][0] == 2500.0


def test_the_freezing_level_no_longer_caps_the_altitudes(sources):
    sources["freezing"] = {"ft": 6000.0, "at_or_below": False}

    result = altitude.select_cruise_altitude(DEP, DEST, PROFILE)

    assert max(result["candidates_ft"]) > 6000.0
    assert result["band_ceiling_ft"] == 14000
    assert result["icing_possible"] is False        # cold, but nothing forecast to ice in


def test_icing_is_flagged_with_cloud_forecast_above_the_freezing_level(sources):
    sources["freezing"] = {"ft": 6000.0, "at_or_below": False}
    sources["cv"] = {"min_ceiling_ft": 3000, "min_visibility_sm": 6.0, "stations": []}

    assert altitude.select_cruise_altitude(DEP, DEST, PROFILE)["icing_possible"] is True


def test_an_icing_airmet_is_moisture_too(sources):
    sources["freezing"] = {"ft": 6000.0, "at_or_below": True}
    sources["hazards"] = [{"hazard": "ICE", "type": "AIRMET", "altitude_low_ft": None,
                           "altitude_high_ft": 12000.0, "raw": "AIRMET ZULU"}]

    result = altitude.select_cruise_altitude(DEP, DEST, PROFILE)

    assert result["icing_possible"] is True
    assert result["freezing_level_at_or_below"] is True


def test_icing_is_unknown_when_the_freezing_level_could_not_be_checked(sources, monkeypatch):
    def down(lat, lon, fcst_hr="06"):
        raise weather.WeatherServiceError("aviationweather.gov is down")

    monkeypatch.setattr(weather, "freezing_level", down)

    result = altitude.select_cruise_altitude(DEP, DEST, PROFILE)

    assert result["icing_possible"] is None
    assert "freezing_level" in result["weather_unavailable"]


def test_no_altitude_enters_a_prohibited_area_the_route_crosses(sources):
    """A prohibited area from the surface to 5,000 ft on the second leg:
    that leg's altitudes start above it; the first leg's are untouched."""
    sources["special_use"] = [{"name": "P-99", "type": "P", "kind": "prohibited area", "floor_ft": 0.0,
                               "floor_ref": "SFC", "ceiling_ft": 5000.0, "ceiling_ref": "MSL",
                               "times_of_use": "CONTINUOUS", "controlling_agency": None,
                               "along_track_nm": 40.0, "legs": [1]}]

    result = altitude.select_cruise_altitude(DEP, DEST, PROFILE, fixes=[DEP, DOGLEG, DEST])

    first, second = result["segments"]
    assert first["candidates_ft"][0] == 3500.0
    assert min(second["candidates_ft"]) > 5000.0
    assert min(result["candidates_ft"]) > 5000.0            # the whole route crosses it
    assert result["special_use"][0]["name"] == "P-99"


def test_a_restricted_area_is_listed_but_not_a_ceiling(sources):
    sources["special_use"] = [{"name": "R-4501", "type": "R", "kind": "restricted area", "floor_ft": 0.0,
                               "floor_ref": "SFC", "ceiling_ft": 18000.0, "ceiling_ref": "MSL",
                               "times_of_use": "0700-2200 MON-FRI", "controlling_agency": "FAA",
                               "along_track_nm": 20.0, "legs": [0]}]

    result = altitude.select_cruise_altitude(DEP, DEST, PROFILE)

    assert result["candidates_ft"][0] == 3500.0
    assert result["special_use"][0]["type"] == "R"


def test_special_use_unavailable_is_said_rather_than_treated_as_none(sources, monkeypatch):
    def down(start, end, fixes=None):
        raise sua.SpecialUseUnavailable("no answer")

    monkeypatch.setattr(sua, "along_route", down)

    result = altitude.select_cruise_altitude(DEP, DEST, PROFILE)

    assert "special_use" in result["weather_unavailable"]
