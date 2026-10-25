"""When the flight passes a point along its route, and whether a TFR or a
special-use area is in force then (web/src/lib/passTimes.ts, the
roadmap's 4-D airspace check): the briefing lists what is near the route
at any time during the flight, and this says whether it is at the time
the airplane gets there."""
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

#: The minutes either side of a pass time a TFR's window is widened by:
#: an ETA is an estimate, and a few minutes early is still inside.
PASS_MARGIN_MIN = 30


def instant(text: str) -> datetime:
    """An ISO time, UTC where it gives no zone, as JavaScript's Date reads
    the planner's."""
    t = datetime.fromisoformat(text)
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def pass_time(legs: list[dict], depart: datetime, along_nm: float) -> datetime | None:
    """When the flight is `along_nm` along its route: the departure plus
    the legs' times to there, the leg it is in taken pro rata. None where
    a leg before it has no time (it cannot be flown) or there are no
    legs."""
    if not legs:
        return None
    distance = 0.0
    minutes = 0.0
    for i, leg in enumerate(legs):
        if leg.get("ete_min") is None:
            return None
        if along_nm <= distance + leg["distance_nm"] or i == len(legs) - 1:
            share = min(1.0, max(0.0, (along_nm - distance) / leg["distance_nm"])) if leg["distance_nm"] > 0 else 0.0
            return depart + timedelta(minutes=minutes + share * leg["ete_min"])
        distance += leg["distance_nm"]
        minutes += leg["ete_min"]
    return None


def tfr_when(t: dict, at: datetime) -> str:
    """A TFR's window against the pass time, widened by PASS_MARGIN_MIN:
    "before", "after" or "in-force"; one with no start or no end is open
    that way."""
    margin = timedelta(minutes=PASS_MARGIN_MIN)
    if t.get("effective") and at < instant(t["effective"]) - margin:
        return "before"
    if t.get("expires") and at > instant(t["expires"]) + margin:
        return "after"
    return "in-force"


DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
DAY = "SUN|MON|TUE|WED|THU|FRI|SAT"


def _clock_in(at: datetime, zone: str) -> tuple[int, int] | None:
    """The day of the week (0 Sunday) and the minute of the day of `at`
    in `zone` -- "UTC", or an IANA zone, daylight saving time and all --
    or None for a zone not known."""
    if zone == "UTC":
        local = at.astimezone(timezone.utc)
    else:
        try:
            local = at.astimezone(ZoneInfo(zone))
        except (KeyError, ValueError):
            return None
    return (local.weekday() + 1) % 7, local.hour * 60 + local.minute


def _days_of(clause: str) -> set[int]:
    """The days a clause of times of use names -- "MON - FRI", "SAT - SUN",
    "FRI" -- as days of the week; every day where it names none, or
    "DAILY", which "means 7 days per week" (FAA Order JO 7400.2, 21-2-4)."""
    days: set[int] = set()
    for m in re.finditer(rf"\b({DAY})\b(?:\s*-\s*({DAY})\b)?", clause):
        first = DAY_NAMES.index(m.group(1))
        last = DAY_NAMES.index(m.group(2)) if m.group(2) else first
        d = first
        while True:
            days.add(d)
            if d == last:
                break
            d = (d + 1) % 7
    return days or set(range(7))


def sua_when(times_of_use: str | None, at: datetime, time_zone: str | None = None) -> str:
    """Whether a special-use area's published times of use have it in use
    when the flight passes, as the FAA writes them (the TIMESOFUSE of its
    special-use airspace data, after FAA Order JO 7400.2, 21-2-4):
    "active", "not-scheduled", "by-notam" or "unknown". Every time range
    is read clause by clause (";", and the "%" the data breaks a long one
    with), each with its clause's days, a range past midnight with the day
    it began; not the ranges of an "OTHER TIMES BY NOTAM" clause, which
    bound the NOTAM's times. Seasons are not read: each season's hours
    count all year, which can say in use, never the other way. Local
    hours are read in the area's own zone (vfr.sua.time_zone), "Z" or
    "UTC" ones in UTC; with no zone, local hours are not guessed at."""
    text = (times_of_use or "").upper()
    if not text:
        return "unknown"
    if re.search(r"CONTINUOUS|\bH24\b", text):
        return "active"
    read = unread = False
    for clause in re.split(r"[;%]", text):
        if re.match(r"^\s*(OTHER TIMES|O/T)\b", clause):
            continue
        ranges = list(re.finditer(r"(\d{2})(\d{2})\s*-\s*(\d{2})(\d{2})\s*(Z|UTC)?", clause))
        if not ranges:
            continue
        days = _days_of(clause)
        for r in ranges:
            zone = "UTC" if r.group(5) else time_zone
            clock = _clock_in(at, zone) if zone else None
            if clock is None:
                unread = True
                continue
            read = True
            day_now, minute = clock
            start = int(r.group(1)) * 60 + int(r.group(2))
            end = int(r.group(3)) * 60 + int(r.group(4))
            overnight = start > end
            in_hours = (minute >= start or minute < end) if overnight else (start <= minute < end)
            # Past midnight, a range that began the day before is that day's.
            day = (day_now + 6) % 7 if overnight and minute < end else day_now
            if in_hours and day in days:
                return "active"
    if unread:
        return "unknown"
    if not read:
        return "by-notam" if "NOTAM" in text else "unknown"
    return "by-notam" if "NOTAM" in text else "not-scheduled"
