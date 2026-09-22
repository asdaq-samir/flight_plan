"""Civil twilight against known figures: Chicago on the September
equinox, where sunrise is about 06:40 and sunset about 18:50 local
(11:40 and 23:50 UTC), and civil twilight roughly half an hour beyond
each."""
from datetime import datetime, timezone

from vfr.sun import civil_twilight, is_night

CHICAGO = (41.88, -87.63)


def test_civil_twilight_brackets_the_day_in_chicago_at_the_equinox():
    dawn, dusk = civil_twilight(*CHICAGO, datetime(2026, 9, 22).date())
    assert dawn is not None and dusk is not None
    # Dawn about 11:10 UTC (06:10 CDT), dusk about 00:20 UTC the next day (19:20 CDT).
    assert abs((dawn - datetime(2026, 9, 22, 11, 10, tzinfo=timezone.utc)).total_seconds()) < 20 * 60
    assert abs((dusk - datetime(2026, 9, 23, 0, 20, tzinfo=timezone.utc)).total_seconds()) < 20 * 60


def test_midday_is_day_and_the_small_hours_are_night():
    assert is_night(*CHICAGO, datetime(2026, 9, 22, 17, 0, tzinfo=timezone.utc)) is False   # noon CDT
    assert is_night(*CHICAGO, datetime(2026, 9, 22, 8, 0, tzinfo=timezone.utc)) is True     # 03:00 CDT
    # Just after dusk, on the next UTC date, is night; just before, day.
    assert is_night(*CHICAGO, datetime(2026, 9, 23, 1, 0, tzinfo=timezone.utc)) is True
    assert is_night(*CHICAGO, datetime(2026, 9, 22, 23, 30, tzinfo=timezone.utc)) is False


def test_a_naive_time_is_read_as_utc():
    assert is_night(*CHICAGO, datetime(2026, 9, 22, 17, 0)) is False


def test_polar_night_and_polar_day_answer_rather_than_raise():
    # astral raises where the sun never reaches six degrees below the
    # horizon. That is an answer here: Svalbard in January is night all
    # day, in July it is day all day, and a fuel reserve still has to be
    # decided. Neither may take the nav log down.
    svalbard = (78.2, 15.6)
    assert civil_twilight(*svalbard, datetime(2026, 1, 15).date()) == (None, None)
    assert is_night(*svalbard, datetime(2026, 1, 15, 12, 0, tzinfo=timezone.utc)) is True
    assert is_night(*svalbard, datetime(2026, 7, 15, 0, 0, tzinfo=timezone.utc)) is False


def test_dusk_rolls_past_midnight_for_a_western_longitude():
    # The convention this wrapper exists for: the pair describes one
    # civil day, so a US dusk lands on the UTC date after its dawn.
    dawn, dusk = civil_twilight(*CHICAGO, datetime(2026, 6, 21).date())
    assert dawn is not None and dusk is not None
    assert dusk > dawn
    assert dusk.date() > dawn.date()
