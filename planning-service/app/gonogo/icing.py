"""Under IFR, whether the flight is planned into icing
(web/src/lib/icing.ts): a leg flown at or above the freezing level, where
the moisture icing needs is forecast -- cloud along the route, or an icing
AIRMET or SIGMET over it (the planner's `icing_possible`, vfr.altitude) --
with the pilot reports of icing near the route (structural icing needs
visible moisture at or below 0 °C, the Aviation Weather Handbook,
FAA-H-8083-28A, Icing). Under VFR the flight stays clear of cloud (14 CFR
91.155), and the freezing level is the altitude reasoning's line alone --
though freezing rain or drizzle (FZRA, FZDZ) ices an airplane out of
cloud, which this does not read."""
from .words import grouped


def icing_at_altitude(selection: dict, flown_ft: list[float], pireps: list[dict]) -> dict | None:
    """The highest altitude flown at or above the freezing level, the
    level, whether the forecast is below freezing at its lowest altitude
    (`at_or_below`), and the pilot reports of icing near the route of any
    intensity but none; None where the flight is not planned into it."""
    level = selection.get("freezing_level_ft")
    if level is None or not selection.get("icing_possible") or not flown_ft:
        return None
    highest = max(flown_ft)
    if not selection.get("freezing_level_at_or_below") and highest < level:
        return None
    # A report's intensity as sent: NEG (and NEGclr) is none.
    reports = sum(1 for p in pireps if p.get("icing") and not p["icing"].upper().startswith("NEG"))
    return {"altitude_ft": highest, "freezing_level_ft": level,
            "at_or_below": bool(selection.get("freezing_level_at_or_below")), "reports": reports}


def _ft(n: float) -> str:
    return f"{grouped(n)} ft"


def icing_line(icing: dict) -> str:
    """In a line, for the Go / No-Go."""
    reports = icing["reports"]
    near = f"; {reports} pilot report{'' if reports == 1 else 's'} of icing near the route" if reports else ""
    return (f"Icing possible at {_ft(icing['altitude_ft'])}: the freezing level "
            f"{'at or below' if icing['at_or_below'] else 'at'} {_ft(icing['freezing_level_ft'])}, in cloud{near}")
