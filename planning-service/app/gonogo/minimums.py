"""A pilot's personal minimums -- the weather they have decided they will
not take off or land in, stricter than the rules -- and where the
briefing's weather is under them (web/src/lib/minimums.ts). Each off
(None) until set."""
from .words import alt_ft, num

#: The minimums, each off until set: the lowest ceiling (feet above the
#: field, a METAR's or TAF's), the least visibility (statute miles), the
#: most crosswind on the best runway and the most surface wind, gusts
#: included (knots).
NO_MINIMUMS = {"ceiling_ft": None, "visibility_sm": None, "crosswind_kt": None, "wind_kt": None}

#: The choices each minimum is picked from (menus, not sliders), the web's
#: MINIMUM_CHOICES: the native app's menus read the same.
MINIMUM_CHOICES = {
    "ceiling_ft": [1000, 1500, 2000, 2500, 3000, 4000, 5000],
    "visibility_sm": [3, 4, 5, 6, 8, 10],
    "crosswind_kt": [5, 8, 10, 12, 15, 17, 20],
    "wind_kt": [10, 15, 20, 25, 30, 35],
}


def steady_or_gust_kt(steady_kt: float, gust_kt: float | None) -> float:
    """The crosswind a wind is judged by, steady or in the gusts,
    whichever is more, unsigned (lib/wind steadyOrGustKt): a pilot meets
    the gust's crosswind in the flare -- a design choice that errs toward
    the stronger wind."""
    return max(abs(steady_kt), abs(gust_kt or 0))


def runway_crosswind_kt(wind: dict) -> float:
    """A runway's wind as the planner works it out (vfr.runway_wind),
    judged by steady_or_gust_kt."""
    return steady_or_gust_kt(wind["crosswind_kt"], wind.get("gust_crosswind_kt"))


def best_crosswind(runways: list[dict], reported: dict | None = None) -> dict | None:
    """The crosswind on the field's best open runway for the wind -- the
    least, the gusts' where they are more -- and that runway's favoured
    end. A closed runway is not landed on, so its wind is not counted. A
    wind reported with no direction (VRB), which gives no runway a
    component, may blow across any of them, so all of it, gusts included,
    is taken as crosswind, with no end (`reported`: speed_kt, gust_kt)."""
    open_ = [r for r in runways if not r.get("closed")]
    winds = [r["wind"] for r in open_ if r.get("wind")]
    if not winds:
        reported = reported or {}
        all_ = steady_or_gust_kt(reported.get("speed_kt") or 0, reported.get("gust_kt"))
        return {"end": None, "kt": all_} if all_ > 0 and open_ else None
    best = winds[0]
    for w in winds[1:]:
        if runway_crosswind_kt(w) < runway_crosswind_kt(best):
            best = w
    return {"end": best["end"], "kt": runway_crosswind_kt(best)}


def under_minimums(m: dict, briefing: dict, landings: list[str], dest: str) -> list[str]:
    """Where the briefing's weather is under the minimums, each a
    sentence: every airport landed at's current report (ceiling,
    visibility, wind, the crosswind on its best runway), the
    destination's forecast, and the forecast along the route. Empty when
    it is not, or none is set."""
    reasons: list[str] = []

    def ceiling(where: str, ft):
        if m.get("ceiling_ft") is not None and ft is not None and ft < m["ceiling_ft"]:
            reasons.append(f"{where} ceiling {alt_ft(ft)} ft, under your {alt_ft(m['ceiling_ft'])} ft")

    def visibility(where: str, sm):
        if m.get("visibility_sm") is not None and sm is not None and sm < m["visibility_sm"]:
            reasons.append(f"{where} visibility {num(sm)} sm, under your {num(m['visibility_sm'])} sm")

    for ident in landings:
        metar = (briefing.get("metars") or {}).get(ident)
        if metar:
            ceiling(ident, metar.get("ceiling_ft"))
            visibility(ident, metar.get("visibility_sm"))
            wind = steady_or_gust_kt(metar.get("wind_speed_kt") or 0, metar.get("wind_gust_kt"))
            if m.get("wind_kt") is not None and wind > m["wind_kt"]:
                speed, gust = metar.get("wind_speed_kt"), metar.get("wind_gust_kt")
                reported = f"{num(speed)}G{num(gust)}" if gust else num(speed)
                reasons.append(f"{ident} wind {reported} kt, over your {num(m['wind_kt'])} kt")
        runways = ((briefing.get("airports") or {}).get(ident) or {}).get("runways") or []
        crosswind = best_crosswind(runways, metar and {"speed_kt": metar.get("wind_speed_kt"), "gust_kt": metar.get("wind_gust_kt")})
        if m.get("crosswind_kt") is not None and crosswind and crosswind["kt"] > m["crosswind_kt"]:
            reasons.append(
                f"{ident} variable wind {num(crosswind['kt'])} kt, which may all be crosswind, over your {num(m['crosswind_kt'])} kt"
                if crosswind["end"] is None else
                f"{ident} crosswind {num(crosswind['kt'])} kt on its best runway ({crosswind['end']}), "
                f"over your {num(m['crosswind_kt'])} kt"
            )
    forecast = briefing.get("forecast") or {}
    station = next((s for s in forecast.get("stations") or [] if s.get("icaoId") == dest), None)
    if station:
        ceiling(f"{dest} forecast", station.get("ceiling_ft"))
        visibility(f"{dest} forecast", station.get("visibility_sm"))
    ceiling("Along the route, forecast", forecast.get("min_ceiling_ft"))
    visibility("Along the route, forecast", forecast.get("min_visibility_sm"))
    return reasons
