"""app.gonogo.pass_times, with web/src/lib/passTimes.test.ts's cases."""
from datetime import datetime, timezone

from app.gonogo.pass_times import pass_time, sua_when, tfr_when

LEGS = [{"distance_nm": 50, "ete_min": 30}, {"distance_nm": 100, "ete_min": 50}]


def utc(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def test_the_departure_plus_the_legs_times_the_leg_it_is_in_pro_rata():
    depart = utc("2026-10-06T14:00:00Z")
    assert pass_time(LEGS, depart, 25) == utc("2026-10-06T14:15:00Z")
    assert pass_time(LEGS, depart, 100) == utc("2026-10-06T14:55:00Z")
    # Past the end, the arrival.
    assert pass_time(LEGS, depart, 400) == utc("2026-10-06T15:20:00Z")
    assert pass_time([], depart, 10) is None
    assert pass_time([{"distance_nm": 50, "ete_min": None}], depart, 10) is None


def test_a_tfrs_window_against_the_pass_half_an_hour_either_side():
    tfr = {"effective": "2026-10-06T16:00:00Z", "expires": "2026-10-06T18:00:00Z"}
    assert tfr_when(tfr, utc("2026-10-06T15:00:00Z")) == "before"
    assert tfr_when(tfr, utc("2026-10-06T15:45:00Z")) == "in-force"
    assert tfr_when(tfr, utc("2026-10-06T19:00:00Z")) == "after"
    assert tfr_when({"effective": None, "expires": None}, datetime.now(timezone.utc)) == "in-force"


def test_a_special_use_areas_published_times_of_use():
    tuesday1420z = utc("2026-10-06T14:20:00Z")
    assert sua_when("CONTINUOUS", tuesday1420z) == "active"
    assert sua_when("INTERMITTENT BY NOTAM 4 HOURS IN ADVANCE", tuesday1420z) == "by-notam"
    assert sua_when("1400 - 2200Z, MON - FRI", tuesday1420z) == "active"
    assert sua_when("1500 - 2200Z, MON - FRI; OTHER TIMES BY NOTAM", tuesday1420z) == "by-notam"
    assert sua_when("1400 - 2200Z, SAT - SUN", tuesday1420z) == "not-scheduled"
    assert sua_when("2200 - 0600Z", utc("2026-10-06T02:00:00Z")) == "active"
    assert sua_when("SR - SS", tuesday1420z) == "unknown"


def test_local_hours_are_read_in_the_areas_own_zone_daylight_saving_time_and_all():
    # 14:20Z on Tuesday 6 October 2026 is 08:20 MDT in Denver, 07:20 MST in
    # Phoenix (Arizona keeps standard time), 10:20 EDT in New York.
    tuesday1420z = utc("2026-10-06T14:20:00Z")
    hours = "0800 - 1700, MON - FRI; OTHER TIMES BY NOTAM"
    assert sua_when(hours, tuesday1420z, "America/Denver") == "active"
    assert sua_when(hours, tuesday1420z, "America/Phoenix") == "by-notam"
    assert sua_when("0700 - 0800 MST, MON - FRI", tuesday1420z, "America/Phoenix") == "active"
    # In January Denver keeps standard time too: 14:20Z is 07:20 there.
    assert sua_when(hours, utc("2027-01-05T14:20:00Z"), "America/Denver") == "by-notam"
    # Hawaii's 17:00 on Monday is Tuesday 03:00Z.
    assert sua_when("0800 - 1800, MON", utc("2026-10-06T03:00:00Z"), "Pacific/Honolulu") == "active"
    # No zone for the area: its local hours are not guessed at.
    assert sua_when(hours, tuesday1420z, None) == "unknown"
    assert sua_when(hours, tuesday1420z, "Not/AZone") == "unknown"
    # UTC ranges need none.
    assert sua_when("1400 - 2200Z, MON - FRI", tuesday1420z, None) == "active"


def test_every_range_is_read_each_with_its_own_clauses_days():
    zone = "America/Chicago"
    # Saturday 3 October 2026, 11:00 CDT (16:00Z).
    saturday = utc("2026-10-03T16:00:00Z")
    assert sua_when("0800 - 1600, MON - FRI; 1000 - 1400, SAT; OTHER TIMES BY NOTAM", saturday, zone) == "active"
    assert sua_when("0800 - 1600, MON - FRI; OTHER TIMES BY NOTAM", saturday, zone) == "by-notam"
    # Two ranges in one clause, the second the one in use; the data's "%" breaks clauses too.
    assert sua_when("0600 - 0900, 1030 - 1200, MON - SAT, BY NOTAM 2 HOURS IN ADVANCE; %1300 - 1500, FRI", saturday, zone) == "active"
    # An "other times by NOTAM between" clause's hours are the NOTAM's, not the schedule.
    assert sua_when("0700 - 0900, MON - FRI; OTHER TIMES BY NOTAM BETWEEN 0600 - 2200", saturday, zone) == "by-notam"
    # A range past midnight belongs to the day it began: Friday 23:00 to Saturday 02:00.
    saturday0100 = utc("2026-10-03T06:00:00Z")
    assert sua_when("2300 - 0200, FRI", saturday0100, zone) == "active"
    assert sua_when("2300 - 0200, SAT", saturday0100, zone) == "not-scheduled"
    assert sua_when("0700 - 1600, DAILY", saturday, zone) == "active"
    assert sua_when("0700 - 1600, SUN - TUE", saturday, zone) == "not-scheduled"
    assert sua_when("0700 - 1600, FRI - SUN", saturday, zone) == "active"
