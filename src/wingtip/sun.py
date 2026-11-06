"""Civil twilight, for the VFR fuel reserve: 14 CFR 91.151 wants 30
minutes of fuel by day and 45 at night, and night (14 CFR 1.1) runs
from the end of evening civil twilight to the start of morning civil
twilight -- the sun six degrees below the horizon.

astral does the astronomy. What used to be here was the Nautical
Almanac Office's "Almanac for Computers" sunrise equation, copied by
hand: about thirty lines of mean anomaly, true longitude and right
ascension, good to a few minutes. The two agree on dawn to within 1.1
minutes across four hundred random points and dates over the United
States, and both decline to answer in polar conditions, so the swap
changes no answer this project acts on -- it just stops the formula
being ours to get wrong.

What stays here is the part that is about this project rather than
about the sun: which civil day a UTC instant belongs to.
"""
from datetime import date, datetime, timedelta, timezone

from astral import Observer
from astral.sun import dawn as _dawn, dusk as _dusk

# The sun six degrees below the horizon, which is what "civil" means in
# 14 CFR 1.1's definition of night.
CIVIL_DEPRESSION_DEG = 6.0


def _at(which, lat: float, lon: float, on: date) -> datetime | None:
    """astral raises ValueError where the sun never reaches the
    depression angle -- a polar day or night. That is an answer here,
    not a failure: no dawn means the sun never got up, no dusk that it
    never went down, and is_night reads the pair."""
    try:
        return which(Observer(latitude=lat, longitude=lon), on,
                     tzinfo=timezone.utc, depression=CIVIL_DEPRESSION_DEG)
    except ValueError:
        return None


def civil_twilight(lat: float, lon: float, on: date) -> tuple:
    """(dawn, dusk) as UTC datetimes for the civil day that begins with
    that dawn -- dusk may fall on the next UTC date for a western
    longitude. Either is None in polar conditions: no dawn means the sun
    never gets up that day, no dusk that it never goes down."""
    dawn = _at(_dawn, lat, lon, on)
    dusk = _at(_dusk, lat, lon, on)
    # The roll is this project's own convention, and the reason this
    # wrapper exists: astral answers for the UTC date it was asked
    # about, and west of Greenwich that day's dusk lands after midnight.
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
