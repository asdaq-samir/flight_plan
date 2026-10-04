"""The wind down a runway: how much of the reported wind is along it, as a
headwind (a tailwind below nothing), and how much across it -- for the
end the wind favours, the one a pilot would land on.

A runway end's heading is OurAirports' true heading where it has one;
where not, the runway's number -- its magnetic heading in tens of
degrees -- turned true with the field's magnetic variation. A METAR's
wind is true, so the two are compared as they are. A helipad ("H1") or
an end with no number has no heading, and no wind of its own.
"""
import math
import re

from .magnetic import magnetic_variation_deg

#: A runway end's number, and the L, C or R of a parallel.
_NUMBERED = re.compile(r"^(\d{1,2})[LCR]?$")


def end_heading_true_deg(ident: str | None, heading_true_deg: float | None, variation_deg: float) -> float | None:
    """A runway end's true heading: the table's, or its number's magnetic
    heading turned true (variation east positive). None where it has
    neither."""
    if heading_true_deg is not None and not math.isnan(heading_true_deg):
        return heading_true_deg % 360
    match = _NUMBERED.match((ident or "").strip().upper())
    if not match:
        return None
    return (int(match.group(1)) * 10 + variation_deg) % 360


def components_kt(wind_dir_true_deg: float, wind_speed_kt: float, heading_true_deg: float) -> tuple[float, float]:
    """(headwind, crosswind) of a wind from `wind_dir_true_deg` on a
    runway heading `heading_true_deg`: the headwind negative for a
    tailwind, the crosswind positive from the right."""
    angle = math.radians(wind_dir_true_deg - heading_true_deg)
    return wind_speed_kt * math.cos(angle), wind_speed_kt * math.sin(angle)


def favoured_end(ends: list, metar: dict | None, variation_deg: float) -> dict | None:
    """The end of a runway the reported wind favours -- the most headwind --
    and its components: {"end", "headwind_kt", "crosswind_kt",
    "gust_crosswind_kt"}, rounded to the knot, the gust's crosswind where
    the report has a gust. `ends` is the runway's [(ident, true heading
    or None)]. Calm is every end at nothing, the first one named. None
    with no report, a variable wind or no end with a heading."""
    if not metar or metar.get("wind_speed_kt") is None:
        return None
    speed = metar["wind_speed_kt"]
    headed = [(ident, heading) for ident, heading in
              ((ident, end_heading_true_deg(ident, heading, variation_deg)) for ident, heading in ends)
              if heading is not None]
    if not headed:
        return None
    if speed == 0:
        return {"end": headed[0][0], "headwind_kt": 0.0, "crosswind_kt": 0.0, "gust_crosswind_kt": None}
    direction = metar.get("wind_dir_true_deg")
    if direction is None:
        return None
    ident, heading = max(headed, key=lambda end: components_kt(direction, speed, end[1])[0])
    head, cross = components_kt(direction, speed, heading)
    gust = metar.get("wind_gust_kt")
    return {
        "end": ident, "headwind_kt": round(head), "crosswind_kt": round(cross),
        "gust_crosswind_kt": round(components_kt(direction, gust, heading)[1]) if gust else None,
    }


def with_winds(runways: list, metar: dict | None, lat: float, lon: float) -> list:
    """vfr.airports.get_runways' runways, each with the reported wind on
    the end it favours (`wind`, favoured_end), at a field at (lat, lon)."""
    variation = magnetic_variation_deg(lat, lon)
    return [{**r, "wind": favoured_end(r.get("end_headings", []), metar, variation)} for r in runways]
