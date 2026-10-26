"""Two-way radio failure under IFR (the roadmap's lost-comms calculator,
14 CFR 91.185, ACS IR.VII.A): the route to fly, the altitude on each
segment of it, and when to leave the clearance limit, each worked from the
clearance as the rule words it. In VFR conditions there is nothing to
work: continue VFR and land as soon as practicable (91.185(b)).

web/src/lib/lostComms.ts, and the words of features/pilot/LostCommsPage.tsx,
ported line for line: the two hold the same rules and change together."""
from ..gonogo.words import alt_ft

#: 91.185(c)(1): the route, in the rule's order -- the first that applies.
ROUTES = [
    {"key": "assigned", "label": "Assigned", "rule": "The route assigned in the last ATC clearance received."},
    {"key": "vectored", "label": "Vectored", "rule": "Being radar vectored: direct from the point of radio failure to the fix, "
                                                     "route or airway specified in the vector clearance."},
    {"key": "expected", "label": "Expected",
     "rule": "No route assigned: the route ATC has advised may be expected in a further clearance."},
    {"key": "filed", "label": "Filed", "rule": "Neither assigned nor expected: the route filed in the flight plan."},
]

#: 91.185(b): what VFR conditions call for, as the page opens.
VFR_WORDS = ("In VFR conditions, or on meeting them after the failure: continue VFR and land as soon as practicable (91.185(b)). "
             "In IFR conditions, the rest of this page.")

BECAUSE = {"assigned": "assigned", "minimum": "the minimum", "expected": "expected"}


def segment_altitudes(segments: list[dict], assigned_ft: float | None, expected_ft: float | None, expected_from: int) -> list[dict]:
    """91.185(c)(2): on each segment, the highest of the altitude assigned,
    the minimum for IFR operations, and the altitude ATC said to expect --
    and which it was. None where none is known. Each segment is a `name`
    and its `minimum_ft` (the MEA, or an OROCA or MOCA off airways); the
    expected altitude applies from segment `expected_from` on ("expect
    6,000 ten minutes after departure" is from where the airplane is
    then), before it only the assigned and the minimum count. A tie goes
    to the first named, as the rule lists them."""
    out = []
    for i, s in enumerate(segments):
        candidates = [(assigned_ft, "assigned"), (s.get("minimum_ft"), "minimum"),
                      (expected_ft if i >= expected_from else None, "expected")]
        known = [c for c in candidates if c[0] is not None]
        if not known:
            out.append({"name": s["name"], "fly": None, "because": None})
            continue
        fly, because = known[0]
        for c in known[1:]:
            if c[0] > fly:
                fly, because = c
        out.append({"name": s["name"], "fly": fly, "because": because})
    return out


def fly_words(seg: dict) -> str:
    """A segment's altitude as the page says it: "Fly 6,000 ft: expected"."""
    return "No altitude known" if seg["fly"] is None else f"Fly {alt_ft(seg['fly'])} ft: {BECAUSE[seg['because']]}"


def leave_limit(approach_fix: bool, efc: str, eta: str) -> str:
    """91.185(c)(3): when to leave the clearance limit, in words."""
    at = f", {eta}" if eta else ""
    if approach_fix:
        return (f"Hold at the clearance limit, and begin the descent or the approach as close as possible to the "
                f"expect-further-clearance time, {efc}." if efc else
                f"Begin the descent or the approach as close as possible to your estimated time of arrival{at}, "
                "from the filed or amended time en route.")
    return (f"Leave the clearance limit at the expect-further-clearance time, {efc}, proceed to a fix an approach begins from, "
            f"and begin the descent or the approach as close as possible to your estimated time of arrival{at}." if efc else
            "Leave the clearance limit on arriving over it, proceed to a fix an approach begins from, and begin the descent "
            f"or the approach as close as possible to your estimated time of arrival{at}.")
