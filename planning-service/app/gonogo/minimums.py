"""A pilot's personal minimums -- the weather they have decided they will
not take off or land in, stricter than the rules -- and where the
briefing's weather is under them (web/src/lib/minimums.ts). Each off
(None) until set. The rules are the engine's
(wingtip_engine::gonogo::minimums), asked by name through wingtip_native.call,
as the web app asks them."""
from . import ask

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
    the stronger wind. The engine's (wingtip_engine::runway::wind)."""
    return ask("wind_steady_or_gust", steady_kt=steady_kt, gust_kt=gust_kt)


def runway_crosswind_kt(wind: dict) -> float:
    """A runway's wind as the planner works it out (wingtip.runway_wind),
    judged by steady_or_gust_kt."""
    return ask("runway_crosswind", wind={"crosswind_kt": wind["crosswind_kt"], "gust_crosswind_kt": wind.get("gust_crosswind_kt")})


def best_crosswind(runways: list[dict], reported: dict | None = None) -> dict | None:
    """The crosswind on the field's best open runway for the wind -- the
    least, the gusts' where they are more -- and that runway's favoured
    end; a wind reported with no direction (VRB, `reported`: speed_kt,
    gust_kt) all of it, with no end."""
    return ask("gonogo_best_crosswind", runways=runways, reported=reported)


def under_minimums(m: dict, briefing: dict, landings: list[str], dest: str) -> list[str]:
    """Where the briefing's weather is under the minimums, each a
    sentence: every airport landed at's current report (ceiling,
    visibility, wind, the crosswind on its best runway), the
    destination's forecast, and the forecast along the route. Empty when
    it is not, or none is set."""
    airports = briefing.get("airports") or {}
    return ask("gonogo_under_minimums", minimums=m, landings=landings, dest=dest, metars=briefing.get("metars") or {},
               airports={i: airports[i] for i in landings if i in airports}, forecast=briefing.get("forecast"))


def ceiling_unknown_at(briefing: dict, landings: list[str]) -> list[str]:
    """Where the briefing's ceiling could not be held against anything:
    every airport landed at whose current report, and every TAF station
    along the route whose forecast, has a broken or overcast layer with no
    height as its lowest ("OVC///", wingtip.weather._sky_ceiling). The
    ceiling there is not known (14 CFR 1.1), so a ceiling minimum is
    neither met nor missed: it is not checked, and is said so."""
    metars = briefing.get("metars") or {}
    found = [i for i in landings if (metars.get(i) or {}).get("ceiling_unknown")]
    found += (briefing.get("forecast") or {}).get("ceiling_unknown_at") or []
    return list(dict.fromkeys(found))
