"""A flight risk assessment before each flight (web/src/lib/frat.ts and
lib/airworthiness.ts; the roadmap's FRAT, after the FAA Risk Management
Handbook's PAVE and IMSAFE, FAA-H-8083-2): points for what raises the risk
of this flight -- from the briefing, the nav log's fuel check, the pilot's
own airplane's inspections and squawks and the pilot's logbook -- and for
what only the pilot knows: IMSAFE, and the pressures on the day.

The points and where they turn the assessment amber and red are the
planner's own guide, not the FAA's and not a rule: the decision is the
pilot in command's (91.3, 91.103). The rules, their points and their
sources are the engine's (wingtip_engine::gonogo::frat), asked by name
through wingtip_native.call, as the web app asks them.

Dates are the pilot's days, "yyyy-mm-dd", compared as strings as the web
compares them."""
from . import ask

#: At these points the assessment is amber, and at these red (the
#: engine's frat::CAUTION_FROM and HIGH_FROM, held to them by the tests).
CAUTION_FROM = 6
HIGH_FROM = 12

LEVEL_NAME = {"low": "Low", "caution": "Raised", "high": "High"}

LEVEL_WORDS = {
    "low": "Go, with the usual care.",
    "caution": "Bring it down where you can (a later time, a shorter leg, an instructor along), or talk it over.",
    "high": "Don't go as planned.",
}

#: How far a 91.213(d) determination reaches: VFR by day, by day and
#: night, or every kind of flight (91.205(b)-(d)).
REACH = {"VFR_DAY": 0, "VFR": 1, "ALL": 2}


def _unmarked(f: dict) -> dict:
    return {k: v for k, v in f.items() if k != "finding"}


def self_checks() -> list[dict]:
    """What only the pilot can say, ticked where it is so -- the IMSAFE
    checklist and PAVE's pressures and unfamiliarity -- in the order shown,
    each in its group, with no mark (RiskAssessment.tsx draws none)."""
    return ask("gonogo_self_checks")


#: The self checks as the web's SELF_CHECKS lists them.
SELF_CHECKS = [{k: v for k, v in _unmarked(c).items() if k != "stop" or v} for c in self_checks()]


def assessment(f: dict) -> dict:
    """The whole assessment as the Go / No-Go answers it: its points, its
    level, its line ("Raised · 8 points") and what to do at that level,
    and every factor with its mark -- a stop or a caution for what the
    briefing, the nav log and the logbook raise, none on a self check
    ticked, which keeps its group (RiskAssessment.tsx). `f` is the web's
    FratInput in snake case; `vor_check` left out (a stock profile, the
    web's undefined) is not the same as None (the pilot's own airplane
    with none recorded)."""
    return ask("gonogo_risk", **f)
