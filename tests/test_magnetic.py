"""The World Magnetic Model, evaluated here rather than asked of NOAA.

These pin the two things that swap had to preserve: the same answers
NOAA's own calculator gave -- the values this project had cached from it
before the model was evaluated locally -- and the sign convention the
nav log's true-to-magnetic conversion depends on.
"""
from datetime import date

import pytest

from vfr.magnetic import _decimal_year, magnetic_variation_deg

# Real rows from the CSV this project cached NOAA's calculator into:
# (lat, lon, declination NOAA returned).
NOAA_CACHED = [
    (44.58, -90.14, -2.55629),
    (42.33, -88.08, -3.89582),
    (42.36, -88.10, -3.88521),
    (43.02, -89.00, -3.27400),
]


@pytest.mark.parametrize("lat,lon,noaa", NOAA_CACHED)
def test_it_agrees_with_what_noaa_returned(lat, lon, noaa):
    # The model is the one NOAA's own page runs, so this is agreement to
    # several decimal places past anything a compass shows.
    assert magnetic_variation_deg(lat, lon, on=date(2026, 9, 21)) == pytest.approx(noaa, abs=0.01)


def test_the_sign_is_east_positive_west_negative():
    # vfr.navlog's magnetic = true - declination depends on this. The
    # agonic line runs up the middle of the United States: east of it
    # (Chicago, and this project's own routes) declination is westerly
    # and negative, west of it (Seattle) easterly and positive.
    assert magnetic_variation_deg(41.9, -87.6, on=date(2026, 9, 21)) < 0
    assert magnetic_variation_deg(47.6, -122.3, on=date(2026, 9, 21)) > 0


def test_a_date_past_the_model_is_clamped_rather_than_raising():
    # Each edition of the model is valid five years, and pygeomag raises
    # past the end of it. The nav log gets the edge of a lapsed model
    # rather than no heading at all.
    edge = magnetic_variation_deg(42.3, -88.1, on=date(2029, 12, 31))
    beyond = magnetic_variation_deg(42.3, -88.1, on=date(2099, 1, 1))
    assert beyond == pytest.approx(edge, abs=0.05)


def test_a_date_before_the_model_is_clamped_too():
    early = magnetic_variation_deg(42.3, -88.1, on=date(1990, 1, 1))
    start = magnetic_variation_deg(42.3, -88.1, on=date(2025, 1, 1))
    assert early == pytest.approx(start, abs=0.05)


def test_decimal_year_is_the_models_own_time_unit():
    assert _decimal_year(date(2026, 1, 1)) == pytest.approx(2026.0)
    assert _decimal_year(date(2026, 7, 2)) == pytest.approx(2026.5, abs=0.01)
