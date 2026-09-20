"""Civil twilight, for the VFR fuel reserve: 14 CFR 91.151 wants 30
minutes of fuel by day and 45 at night, and night (14 CFR 1.1) runs
from the end of evening civil twilight to the start of morning civil
twilight -- the sun six degrees below the horizon.

The sunrise/sunset equation from the old Nautical Almanac Office
"Almanac for Computers", good to a few minutes, which is all a fuel
reserve needs. No dependency: the one library that does this better
would be pulled in for a single function.
"""
import math
from datetime import date, datetime, timedelta, timezone

CIVIL_ZENITH_DEG = 96.0


def _twilight_ut(lat: float, lon: float, on: date, rising: bool, zenith_deg: float = CIVIL_ZENITH_DEG) -> float | None:
    """The hour (UT, on `on`'s date) the sun crosses `zenith_deg` on the
    way up (rising) or down; None when it never does that day -- polar
    day or night."""
    day_of_year = on.timetuple().tm_yday
    lng_hour = lon / 15.0
    t = day_of_year + ((6.0 if rising else 18.0) - lng_hour) / 24.0

    mean_anomaly = 0.9856 * t - 3.289
    true_lon = (
        mean_anomaly + 1.916 * math.sin(math.radians(mean_anomaly))
        + 0.020 * math.sin(math.radians(2 * mean_anomaly)) + 282.634
    ) % 360.0

    right_ascension = math.degrees(math.atan(0.91764 * math.tan(math.radians(true_lon)))) % 360.0
    # Into the same quadrant as the true longitude, then hours.
    right_ascension += (math.floor(true_lon / 90.0) * 90.0) - (math.floor(right_ascension / 90.0) * 90.0)
    right_ascension /= 15.0

    sin_dec = 0.39782 * math.sin(math.radians(true_lon))
    cos_dec = math.cos(math.asin(sin_dec))
    cos_hour_angle = (
        (math.cos(math.radians(zenith_deg)) - sin_dec * math.sin(math.radians(lat)))
        / (cos_dec * math.cos(math.radians(lat)))
    )
    if cos_hour_angle > 1 or cos_hour_angle < -1:
        return None
    hour_angle = math.degrees(math.acos(cos_hour_angle))
    hour_angle = (360.0 - hour_angle if rising else hour_angle) / 15.0

    local_mean = hour_angle + right_ascension - 0.06571 * t - 6.622
    return (local_mean - lng_hour) % 24.0


def civil_twilight(lat: float, lon: float, on: date) -> tuple:
    """(dawn, dusk) as UTC datetimes for the civil day that begins with
    that dawn -- dusk may fall on the next UTC date for a western
    longitude. Either is None in polar conditions: no dawn means the sun
    never gets up that day, no dusk that it never goes down."""
    dawn_ut = _twilight_ut(lat, lon, on, rising=True)
    dusk_ut = _twilight_ut(lat, lon, on, rising=False)
    midnight = datetime(on.year, on.month, on.day, tzinfo=timezone.utc)
    dawn = None if dawn_ut is None else midnight + timedelta(hours=dawn_ut)
    dusk = None if dusk_ut is None else midnight + timedelta(hours=dusk_ut)
    if dawn is not None and dusk is not None and dusk < dawn:
        dusk += timedelta(days=1)
    return dawn, dusk


def is_night(lat: float, lon: float, at: datetime) -> bool:
    """Whether `at` (UTC; a naive time is taken as UTC) is night at the
    point -- outside civil twilight. Checks the civil days around the
    instant, since the one that contains it may have begun the UTC day
    before."""
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    for offset in (-1, 0, 1):
        dawn, dusk = civil_twilight(lat, lon, (at + timedelta(days=offset)).date())
        if dawn is None and dusk is None:
            # Polar: the sun neither rises nor sets that day. Above the
            # horizon all day in summer, below all day in winter.
            summer = (lat > 0) == (4 <= at.month <= 9)
            return not summer
        if dawn is not None and dusk is not None and dawn <= at <= dusk:
            return False
    return True
