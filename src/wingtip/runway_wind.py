"""The wind down a runway: how much of the reported wind is along it, as a
headwind (a tailwind below nothing), and how much across it -- for the
end the wind favours, the one a pilot would land on.

A runway end's heading is OurAirports' true heading where it has one;
where not, the runway's number -- its magnetic heading in tens of
degrees -- turned true with the field's magnetic variation. A METAR's
wind is true, so the two are compared as they are. A helipad ("H1") or
an end with no number has no heading, and no wind of its own.

The rules are the shared engine's (wingtip_engine::runway::wind, through
wingtip_native.call), the very code the web app (lib/wind, lib/pattern) and
the phones (wt_call) ask; these keep their names and dicts and only carry
them across.
"""
import json

import wingtip_native

from .magnetic import magnetic_variation_deg


def _ask(name: str, **given):
    """The engine's rule `name` on the input given, its answer parsed."""
    return json.loads(wingtip_native.call(name, json.dumps(given)))


def end_heading_true_deg(ident: str | None, heading_true_deg: float | None, variation_deg: float) -> float | None:
    """A runway end's true heading: the table's, or its number's magnetic
    heading turned true (variation east positive). None where it has
    neither."""
    return _ask("runway_end_heading", ident=ident, heading_true_deg=_ends([(ident, heading_true_deg)])[0][1],
                variation_deg=variation_deg)


def _ends(ends: list) -> list:
    """[ident, true heading] pairs, a NaN heading none."""
    return [[ident, None if heading is None or heading != heading else heading] for ident, heading in ends]


def _slim(runways: list) -> list:
    """The runways as the engine reads them (pattern.with_traffic's), and
    nothing else of them."""
    return [{"closed": bool(r.get("closed")), "surface": r.get("surface"), "length_ft": r.get("length_ft"), "wind": r.get("wind") or None,
             "runway_ends": [{"ident": e.get("ident"), "heading_true_deg": e.get("heading_true_deg")} for e in r.get("runway_ends") or []]}
            for r in runways]


def _report(metar: dict | None) -> dict | None:
    return {k: metar.get(k) for k in ("wind_dir_true_deg", "wind_speed_kt", "wind_gust_kt")} if metar else None


def favoured_end(ends: list, metar: dict | None, variation_deg: float, recent: dict | None = None) -> dict | None:
    """The end of a runway the reported wind favours -- the most headwind --
    and its components: {"end", "headwind_kt", "crosswind_kt",
    "gust_crosswind_kt"}, rounded to the knot, the gust's crosswind where
    the report has a gust. `ends` is the runway's [(ident, true heading
    or None)]. Calm is every end at nothing: the end the field's last wind
    favoured (`recent`, wingtip.weather.recent_wind), the runway in use, said
    so ("in_use"), else the first one named. None with no report, a
    variable wind or no end with a heading."""
    return _ask("runway_favoured_end", ends=_ends(ends), metar=_report(metar), variation_deg=variation_deg,
                recent=recent or None)


def with_winds(runways: list, metar: dict | None, lat: float, lon: float, recent: dict | None = None) -> list:
    """wingtip.airports.get_runways' runways, each with the reported wind on
    the end it favours (`wind`, favoured_end), at a field at (lat, lon);
    `recent`, the field's last wind, for a calm one: the one runway it
    favoured most is the one in use."""
    winds = _ask("runway_with_winds", runways=[{"end_headings": _ends(r.get("end_headings", []))} for r in runways],
                 metar=_report(metar), variation_deg=magnetic_variation_deg(lat, lon), recent=recent or None)
    return [{**r, "wind": w} for r, w in zip(runways, winds)]


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
    found = _ask("gonogo_runway_in_use", runways=_slim(runways))
    if not found or not (found["by_wind"] or most_used):
        return None
    return _ask("gonogo_runway_number", ident=runways[found["runway"]]["runway_ends"][found["end"]]["ident"])


def wind_pick(runways: list, wind: dict | None) -> str | None:
    """The end into a wind the field's own report did not give ({"dir_true_deg"
    (None for VRB), "speed_kt"}): a forecast's for the time the flight is
    there (wingtip.weather.forecast_wind, the owner's pick of 2026-10-20 for a
    field reached later than an hour from now), the nearest report's for a
    field with none of its own (wingtip.weather.nearest_report), or the field's
    own variable one. Of every open end, the most headwind, the longer
    runway on a tie; calm or variable, the runway in use (runway_in_use,
    most used with none). The web's windPick with a forecast or a nearby
    report (lib/pattern). None with no wind."""
    if not wind:
        return None
    # As a forecast's, so the field's own report is set aside: the caller
    # has asked runway_in_use of it first.
    nearby = {"station": "", "distance_nm": 0, "dir_true_deg": wind.get("dir_true_deg"), "speed_kt": wind.get("speed_kt")}
    pick = _ask("wind_pick", runways=_slim(runways), nearby=nearby, forecast_at=0)
    return (pick or {}).get("ident") or None
