"""How a figure or the FAA's text is written in the Go / No-Go's words, as
the web app writes them (lib/units, lib/advisories, features/plan/format):
the verdict's lines are compared word for word with the web's."""
import math
from decimal import ROUND_HALF_UP, Decimal

from . import ask


def js_round(n: float) -> int:
    """JavaScript's Math.round: halves up, toward +infinity, where
    Python's round() takes them to the even one."""
    return math.floor(n + 0.5)


def num(n) -> str:
    """A number as JavaScript writes it into a string: 28 for 28.0, 2.3
    for 2.3, and "null" for none (a template literal's)."""
    if n is None:
        return "null"
    if isinstance(n, bool):
        return "true" if n else "false"
    if isinstance(n, float) and n.is_integer():
        return str(int(n))
    return str(n)


def to_fixed(n: float, digits: int = 1) -> str:
    """JavaScript's toFixed: the nearest, a tie to the larger, on the
    float's exact value (Python's format takes a tie to the even)."""
    quantum = Decimal(1).scaleb(-digits)
    return str(Decimal(n).quantize(quantum, rounding=ROUND_HALF_UP))


def one(n: float) -> float:
    """To a tenth, as lib/verdict's `one`."""
    return js_round(n * 10) / 10


def grouped(n: float) -> str:
    """A whole number with a comma between each three figures, "12,500",
    as the FAA writes altitudes and weights (lib/units grouped): rounded
    on the magnitude, halves away from zero."""
    magnitude = math.floor(abs(n) + 0.5)
    digits = f"{magnitude:,}"
    return f"-{digits}" if n < 0 and magnitude > 0 else digits


def alt_ft(ft: float | None) -> str:
    """"12,500"; an em dash for none (lib/units altFt)."""
    return "—" if ft is None else grouped(ft)


def flight_level(ft: float | None) -> str:
    """A cruising altitude as the owner asked it written, hundreds of feet
    in three figures: "FL-045" for 4,500 ft, "FL----" with none yet
    (lib/units flightLevel; the owner, 2026-10-27: "make it in the format
    FL-***"), padded as String(n).padStart(3, "0") pads a minus sign."""
    return "FL----" if ft is None else f"FL-{str(js_round(ft / 100)).rjust(3, '0')}"


def ceiling_and_visibility(ceiling_ft: float | None, visibility_sm: float | None) -> str:
    """Ceiling and visibility the way a briefer says them
    (features/plan/format ceilingAndVisibility)."""
    ceiling = "no ceiling" if ceiling_ft is None else f"{alt_ft(ceiling_ft)} ft"
    visibility = "—" if visibility_sm is None else f"{num(visibility_sm)} sm"
    return f"{ceiling} · {visibility}"


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


def faa_words(text: str | None) -> str:
    """The FAA's capitalised text in sentence case, its codes kept
    (lib/advisories faaWords): a word with a figure in it is a code, an
    airspace's class is "Class B" (AIM 3-2-1); text with any lower case
    is someone's own writing and is left as it is."""
    return ask("faa_words", text=text) if text else ""


def sigmet_hazard(hazard: str | None, kind: str | None = None) -> str:
    """"Convective", "Mountain obscuration" (lib/advisories sigmetHazard)."""
    return ask("sigmet_hazard", hazard=hazard, kind=kind)


def gairmet_title(g: dict) -> str:
    """A G-AIRMET's hazard and how bad: "Icing, moderate"."""
    return ask("gairmet_title", hazard=g["hazard"], severity=g.get("severity"))
