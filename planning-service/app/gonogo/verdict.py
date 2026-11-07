"""The Brief's Go / No-Go: every tab's own finding about the flight in one
list, each a row that opens where it was found -- the weather, the
airspace on the route, the altitude, the fuel, the runways, the loading
and the risk -- and one line over them saying what they come to. What the
pilot reads first on opening the Brief, as a flight service briefer opens
with adverse conditions and whether VFR is recommended (AIM 7-1-5(b)(1),
(b)(2)). The findings are the planner's; the decision is the pilot in
command's (14 CFR 91.3), and the line says so.

The rules are the engine's (wingtip_engine::gonogo::verdict), asked by
name through wingtip_native.call, the one copy the planner, the web app
(web/src/lib/verdict.ts) and the phones share.

A finding (lib/status) is "ok", "caution", "stop", "unknown" or
"pending"; the input is the web's VerdictInput in snake case."""
from . import ask

RISK_FINDING = {"low": "ok", "caution": "caution", "high": "stop"}


def verdict_items(v: dict) -> list[dict]:
    """Each tab's finding, in the order a pilot goes through them, each
    with where it is shown in full: a tab of the planning panel and a
    section of it by its title."""
    return ask("gonogo_verdict_items", **v)


def verdict_line(items: list[dict]) -> dict:
    """What the findings come to, in a line over them."""
    return ask("gonogo_verdict_line", items=items)


def alternate_finding(data: dict | None) -> dict | None:
    """What the IFR alternate comes to for the Go / No-Go
    (features/plan/hooks/useAlternate alternateFinding): a stop where the
    one filed will not do, a caution where one is needed (14 CFR
    91.169(a)(2), (b)) and none is filed or the one filed is the pilot's
    to check; nothing where none is needed."""
    return ask("gonogo_alternate_finding", data=data)


def with_alternate(items: list[dict], found: dict | None) -> list[dict]:
    """The alternate is the weather's to say, where the weather says
    nothing worse: a caution or a stop of its own, opening its section
    (FlightBriefingView)."""
    return ask("gonogo_with_alternate", items=items, found=found)
