"""vfr.altitude.select_cruise_altitude with its data sources stubbed: the
hemispheric rule leg by leg, and the freezing level as an icing warning
rather than a ceiling."""
from pathlib import Path

import pytest

from vfr import airspace, altitude, terrain, weather

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
    monkeypatch.setattr(airspace, "airspace_transits", lambda start, end, shp: [])
    monkeypatch.setattr(altitude, "magnetic_variation_deg", lambda lat, lon: 0.0)
    monkeypatch.setattr(weather, "freezing_level", lambda lat, lon, fcst_hr="06": state["freezing"])
    monkeypatch.setattr(weather, "ceiling_visibility_along_route", lambda start, end, window=None: state["cv"])
    monkeypatch.setattr(weather, "hazards_along_route", lambda start, end: state["hazards"])
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
