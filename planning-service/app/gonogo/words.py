"""How a figure or the FAA's text is written in the Go / No-Go's words, as
the web app writes them (lib/units, lib/advisories, features/plan/format):
the verdict's lines are compared word for word with the web's."""
from . import ask


# How a figure is written is the engine's (figures::words, through
# wingtip_native.call), JavaScript's rounding and number text as the web's
# lib/units writes them, so a line here reads as the web's word for word.


def num(n) -> str:
    """A number as JavaScript writes it into a string: 28 for 28.0, 2.3
    for 2.3, and "null" for none (a template literal's)."""
    return ask("words_num", n=n)


def to_fixed(n: float, digits: int = 1) -> str:
    """JavaScript's toFixed: the nearest, a tie to the larger, on the
    float's exact value."""
    return ask("words_to_fixed", n=n, digits=digits)


def one(n: float) -> float:
    """To a tenth, as lib/verdict's `one`."""
    return ask("words_one", n=n)


def grouped(n: float) -> str:
    """A whole number with a comma between each three figures, "12,500",
    as the FAA writes altitudes and weights (lib/units grouped)."""
    return ask("words_grouped", n=n)


def alt_ft(ft: float | None) -> str:
    """"12,500"; an em dash for none (lib/units altFt)."""
    return ask("words_alt_ft", ft=ft)


def flight_level(ft: float | None) -> str:
    """A cruising altitude as the owner asked it written, hundreds of feet
    in three figures: "FL-045" for 4,500 ft, "FL-___" with none yet
    (lib/units flightLevel)."""
    return ask("words_flight_level", ft=ft)


def ceiling_and_visibility(ceiling_ft: float | None, visibility_sm: float | None) -> str:
    """Ceiling and visibility the way a briefer says them
    (features/plan/format ceilingAndVisibility)."""
    return ask("words_ceiling_and_visibility", ceiling_ft=ceiling_ft, visibility_sm=visibility_sm)


#: An altitude plan's name (features/plan/format PLAN_NAME): the planner's
#: four (wingtip.navlog.altitude_profiles).
PLAN_NAME = {"lowest": "Lowest", "highest": "Highest", "fastest": "Fastest", "economical": "Economical"}

#: What each weather source is called when a pilot is told it could not
#: be checked (FlightBriefingView's WEATHER_SOURCE_LABEL).
WEATHER_SOURCE_LABEL = {
    "hazards": "SIGMETs",
    "forecast": "the TAF forecast",
    "metars": "current METARs",
    "tfrs": "TFRs",
    "pireps": "pilot reports",
    "gairmets": "G-AIRMETs",
}

# The FAA's own words in the app's -- its capitals in sentence case, the
# advisories' intensities and hazards -- are the shared engine's
# (wingtip_engine::wording, through wingtip_native.call), the web's and the
# phones' very rules: the verdict's lines are compared word for word.


def sigmet_hazard(hazard: str | None, kind: str | None = None) -> str:
    """"Convective", "Mountain obscuration" (lib/advisories sigmetHazard)."""
    return ask("sigmet_hazard", hazard=hazard, kind=kind)


def gairmet_title(g: dict) -> str:
    """A G-AIRMET's hazard and how bad: "Icing, moderate"."""
    return ask("gairmet_title", hazard=g["hazard"], severity=g.get("severity"))
