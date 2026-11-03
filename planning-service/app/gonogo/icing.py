"""Under IFR, whether the flight is planned into icing
(web/src/lib/icing.ts): a leg flown at or above the freezing level, where
the moisture icing needs is forecast -- cloud along the route, or an icing
AIRMET or SIGMET over it (the planner's `icing_possible`, vfr.altitude) --
with the pilot reports of icing near the route (structural icing needs
visible moisture at or below 0 °C, the Aviation Weather Handbook,
FAA-H-8083-28A, Icing). Under VFR the flight stays clear of cloud (14 CFR
91.155). The rule is the engine's (wingtip_engine::gonogo::icing), asked
by name through vfr_native.call."""
from . import ask


def icing_at_altitude(selection: dict, flown_ft: list[float], pireps: list[dict]) -> dict | None:
    """The highest altitude flown at or above the freezing level, the
    level, whether the forecast is below freezing at its lowest altitude
    (`at_or_below`), and the pilot reports of icing near the route of any
    intensity but none; None where the flight is not planned into it."""
    found = ask("gonogo_icing", selection={k: selection.get(k) for k in (
        "freezing_level_ft", "icing_possible", "freezing_level_at_or_below")}, flown_ft=list(flown_ft),
        pireps=[{"icing": p.get("icing")} for p in pireps])
    if found is not None:
        del found["line"]
    return found


def icing_line(icing: dict) -> str:
    """In a line, for the Go / No-Go."""
    return ask("gonogo_icing_line", icing=icing)
