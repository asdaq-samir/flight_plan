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


def test_no_fixes_is_the_direct_line_as_one_leg(sources, monkeypatch):
    """One path for the Class B rule: without fixes the route is asked of
    the leg-by-leg function as a single leg, and the answer is the same
    as with the ends given as the fixes."""
    asked = []

    def ceilings(start, end, fixes, shp):
        asked.append(fixes)
        return [4500.0] * (len(fixes) - 1)

    monkeypatch.setattr(airspace, "airspace_ceiling_profile", ceilings)
    bare = altitude.select_cruise_altitude(DEP, DEST, PROFILE)
    ends = altitude.select_cruise_altitude(DEP, DEST, PROFILE, fixes=[DEP, DEST])

    assert asked == [[DEP, DEST], [DEP, DEST]]
    fields = ("airspace_ceiling_ft", "band_ceiling_ft", "recommended_ft", "candidates_ft")
    assert {k: bare[k] for k in fields} == {k: ends[k] for k in fields}
    assert bare["airspace_ceiling_ft"] == 4500.0


def _station(ident, lat, lon, ceiling_ft, elevation_ft=1000):
    """A TAF station near the route, as ceiling_visibility_along_route
    gives it: the ceiling above the field, the field's elevation."""
    return {"icaoId": ident, "lat": lat, "lon": lon, "elevation_ft": elevation_ft,
            "ceiling_ft": ceiling_ft, "visibility_sm": 5.0}


def test_a_leg_keeps_500_ft_under_the_clouds_forecast_near_it(sources):
    # A 4,500 ft ceiling over a 1,000 ft field on the second leg's line:
    # cloud at 5,500 ft MSL, so nothing above 5,000 there. The first leg,
    # with no station near it, keeps its whole band.
    sources["cv"] = {"min_ceiling_ft": 4500, "min_visibility_sm": 5.0,
                     "stations": [_station("KXYZ", 45.95, -89.99, 4500)]}

    result = altitude.select_cruise_altitude(DEP, DEST, PROFILE, fixes=[DEP, DOGLEG, DEST])

    first, second = result["segments"]
    assert first["cloud_base_ft"] is None and max(first["candidates_ft"]) > 5000
    assert second["cloud_base_ft"] == 5500 and second["cloud_station"] == "KXYZ"
    assert second["cloud_ceiling_ft"] == 5000 == second["band_ceiling_ft"]
    assert max(second["candidates_ft"]) == 4500 and second["cloud_clearance_kept"] is True
    # The whole route keeps under the lowest cloud anywhere on it.
    assert result["cloud_base_ft"] == 5500 and result["band_ceiling_ft"] == 5000


def test_at_10000_ft_and_above_the_clouds_are_kept_1000_ft_above(sources):
    assert altitude.highest_under_clouds_ft(6000.0) == 5500.0
    assert altitude.highest_under_clouds_ft(12000.0) == 11000.0
    # 500 ft under a 10,800 ft base is 10,300 -- but at 10,000 and above
    # the rule is 1,000 ft, so the highest is just under 10,000.
    assert 9500.0 < altitude.highest_under_clouds_ft(10800.0) < 10000.0


def test_clouds_too_low_over_the_floor_are_said_and_the_leg_keeps_its_band(sources):
    # A 1,200 ft ceiling over a 1,000 ft field: cloud at 2,200 ft MSL over
    # a 2,000 ft floor, and nothing there keeps 500 ft below it. Not a
    # refusal to plan: the leg keeps its band without the clouds, and
    # says the clearance could not be kept.
    sources["cv"] = {"min_ceiling_ft": 1200, "min_visibility_sm": 5.0,
                     "stations": [_station("KXYZ", 45.5, -90.0, 1200)]}

    result = altitude.select_cruise_altitude(DEP, DEST, PROFILE, fixes=[DEP, DEST])

    (leg,) = result["segments"]
    # Due north: odd thousands plus 500, the first over the floor 3,500.
    assert leg["cloud_clearance_kept"] is False and leg["candidates_ft"][0] == 3500.0
    assert leg["band_ceiling_ft"] == 14000 and leg["cloud_ceiling_ft"] == 1700
    assert result["cloud_clearance_kept"] is False and result["recommended_ft"] == 3500.0


def test_a_station_far_from_the_leg_does_not_cap_it(sources):
    # 42 nm west of the line: its forecast is not this leg's.
    sources["cv"] = {"min_ceiling_ft": 1200, "min_visibility_sm": 5.0,
                     "stations": [_station("KFAR", 45.5, -91.0, 1200)]}

    result = altitude.select_cruise_altitude(DEP, DEST, PROFILE, fixes=[DEP, DEST])

    assert result["cloud_base_ft"] is None and result["segments"][0]["candidates_ft"]
