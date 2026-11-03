"""Two-way radio failure under IFR (the roadmap's lost-comms calculator,
14 CFR 91.185, ACS IR.VII.A): the routes in the rule's order, the altitude
on each segment and when to leave the clearance limit, each worked out by
the engine (wingtip_engine::figures::lost_comms, through vfr_native), the
one copy the planner and the phones share.

web/src/lib/lostComms.ts asks the same engine (its WebAssembly, by the
rule's name); the words of features/pilot/LostCommsPage.tsx change with the
engine's."""
import vfr_native

_routes, VFR_WORDS = vfr_native.lost_comms_routes()
#: 91.185(c)(1): the route, in the rule's order -- the first that applies.
ROUTES = [{"key": key, "label": label, "rule": rule} for key, label, rule in _routes]


def segment_altitudes(segments: list[dict], assigned_ft: float | None, expected_ft: float | None, expected_from: int) -> list[dict]:
    """91.185(c)(2): on each segment (a `name` and its `minimum_ft`, the
    minimum altitude for IFR operations, 14 CFR 91.177), the highest of the
    altitude assigned, the minimum and the altitude ATC said to expect --
    expected only from segment `expected_from` on -- and which it was."""
    flown = vfr_native.lost_comms_altitudes([(s["name"], s.get("minimum_ft")) for s in segments],
                                            assigned_ft, expected_ft, expected_from)
    return [{"name": name, "fly": fly, "because": because} for name, fly, because in flown]


def fly_words(seg: dict) -> str:
    """A segment's altitude as the page says it: "Fly 6,000 ft: expected"."""
    return vfr_native.lost_comms_fly_words(seg["fly"], seg["because"])


def leave_limit(approach_fix: bool, efc: str, eta: str) -> str:
    """91.185(c)(3): when to leave the clearance limit, in words."""
    return vfr_native.lost_comms_leave(approach_fix, efc, eta)
