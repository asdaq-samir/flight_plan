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


def favoured_end(ends: list, metar: dict | None, variation_deg: float, recent: dict | None = None) -> dict | None:
    """The end of a runway the reported wind favours -- the most headwind --
    and its components: {"end", "headwind_kt", "crosswind_kt",
    "gust_crosswind_kt"}, rounded to the knot, the gust's crosswind where
    the report has a gust. `ends` is the runway's [(ident, true heading
    or None)]. Calm is every end at nothing: the end the field's last wind
    favoured (`recent`, vfr.weather.recent_wind), the runway in use, said
    so ("in_use"), else the first one named. None with no report, a
    variable wind or no end with a heading."""
    if not metar or metar.get("wind_speed_kt") is None:
        return None
    speed = metar["wind_speed_kt"]
    headed = [(ident, heading) for ident, heading in
              ((ident, end_heading_true_deg(ident, heading, variation_deg)) for ident, heading in ends)
              if heading is not None]
    if not headed:
        return None
    if speed == 0:
        if recent:
            kept = max(headed, key=lambda end: components_kt(recent["wind_dir_true_deg"], recent["wind_speed_kt"], end[1])[0])[0]
            return {"end": kept, "headwind_kt": 0.0, "crosswind_kt": 0.0, "gust_crosswind_kt": None, "in_use": True}
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


def with_winds(runways: list, metar: dict | None, lat: float, lon: float, recent: dict | None = None) -> list:
    """vfr.airports.get_runways' runways, each with the reported wind on
    the end it favours (`wind`, favoured_end), at a field at (lat, lon);
    `recent`, the field's last wind, for a calm one."""
    variation = magnetic_variation_deg(lat, lon)
    out = [{**r, "wind": favoured_end(r.get("end_headings", []), metar, variation)} for r in runways]
    if not recent or not metar or metar.get("wind_speed_kt") != 0:
        return out
    # Calm: the one runway the last wind favoured most is the one in use,
    # on its end into that wind; the rest stay calm on their first end.
    def into_last(r: dict) -> float:
        headings = [end_heading_true_deg(i, h, variation) for i, h in r.get("end_headings", [])]
        return max((components_kt(recent["wind_dir_true_deg"], recent["wind_speed_kt"], h)[0] for h in headings if h is not None),
                   default=float("-inf"))
    best = max(range(len(out)), key=lambda k: into_last(out[k]), default=None)
    if best is not None and out[best]["wind"]:
        out[best] = {**out[best], "wind": favoured_end(out[best].get("end_headings", []), metar, variation, recent)}
    return out


def _paved(runway: dict) -> bool:
    return bool(re.search(r"asp|con|bit|pem|paved", runway.get("surface") or "", re.I))


def runway_in_use(runways: list, most_used: bool = False) -> str | None:
    """The end a pilot would take off from and land on at a field, by its
    own report: of the ends the wind favours on each runway (with_winds),
    the one with the most headwind -- AC 90-66C 11.5, the runway most
    nearly into the wind -- a calm field's runway in use first, ties to
    the runway used most (paved, then the longer). The web's runwayInUse
    (lib/pattern), the same rule, which the page's own pick goes by: the
    planner picks with it for a first plan (app.routers.plan wind_picks),
    the page's pick then the same. None with no wind on any runway -- no
    report, or a variable one -- where the page goes by a nearby report's.
    Over pattern.with_traffic's runways: open, with an end that has a
    heading. `most_used`: with no wind on any, the runway used most's first
    end, as the web's does (a calm or a variable forecast's)."""
    open_ = [r for r in runways if not r.get("closed")
             and any(e.get("heading_true_deg") is not None for e in r.get("runway_ends") or [])]
    winded = sorted((r for r in open_ if r.get("wind")),
                    key=lambda r: (not r["wind"].get("in_use"), -r["wind"]["headwind_kt"],
                                   not _paved(r), -(r.get("length_ft") or 0)))
    for runway in winded:
        end = next((e for e in runway.get("runway_ends") or []
                    if e.get("ident") == runway["wind"]["end"] and e.get("heading_true_deg") is not None), None)
        if end:
            return end["ident"].lstrip("0") or end["ident"]
    if not most_used or not open_:
        return None
    first = min(open_, key=lambda r: (not _paved(r), -(r.get("length_ft") or 0)))
    end = next(e for e in first["runway_ends"] if e.get("heading_true_deg") is not None)
    return end["ident"].lstrip("0") or end["ident"]


def wind_pick(runways: list, wind: dict | None) -> str | None:
    """The end into a wind the field's own report did not give ({"dir_true_deg"
    (None for VRB), "speed_kt"}): a forecast's for the time the flight is
    there (vfr.weather.forecast_wind, the owner's pick of 2026-10-20 for a
    field reached later than an hour from now), the nearest report's for a
    field with none of its own (vfr.weather.nearest_report), or the field's
    own variable one. Of every open end, the most headwind, the longer
    runway on a tie; calm or variable, the runway in use (runway_in_use,
    most used with none). The web's windPick with a forecast or a nearby
    report (lib/pattern). None with no wind."""
    if not wind or wind.get("speed_kt") is None:
        return None
    direction, speed = wind.get("dir_true_deg"), wind["speed_kt"]
    if speed == 0 or direction is None:
        return runway_in_use(runways, most_used=True)
    ends = [(e, r) for r in runways if not r.get("closed")
            for e in r.get("runway_ends") or [] if e.get("heading_true_deg") is not None]
    if not ends:
        return None
    end, _ = max(ends, key=lambda er: (round(components_kt(direction, speed, er[0]["heading_true_deg"])[0], 9),
                                       er[1].get("length_ft") or 0))
    return end["ident"].lstrip("0") or end["ident"]
