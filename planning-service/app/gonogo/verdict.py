"""The Brief's Go / No-Go (web/src/lib/verdict.ts, which holds the same
rules for the web app: the two change together): every tab's own finding
about the flight in one list, each a row that opens where it was found --
the weather, the airspace on the route, the altitude, the fuel, the
runways, the loading and the risk -- and one line over them saying what
they come to. What the pilot reads first on opening the Brief, as a
flight service briefer starts with whether VFR is recommended (AIM
7-1-5(b)(2)). The findings are the planner's; the decision is the pilot
in command's (14 CFR 91.3), and the line says so.

A finding (lib/status) is "ok", "caution", "stop", "unknown" or
"pending"; the input is the web's VerdictInput in snake case."""
from .words import num, one

#: The worst first (lib/status worstOf): a stop over a caution over not
#: known over still pending over nothing found.
WORST_FIRST = ("stop", "caution", "unknown", "pending")

RISK_FINDING = {"low": "ok", "caution": "caution", "high": "stop"}


def worst_of(findings: list[str]) -> str:
    for f in WORST_FIRST:
        if f in findings:
            return f
    return "ok"


def _reserve_words(minutes: float | None) -> str:
    """The reserve as the planner set it: 30 minutes by day, 45 at night
    (14 CFR 91.151) or under IFR (91.167). Unsaid where it did not send
    one, rather than a guess at 30, which is short at night."""
    return "reserve" if minutes is None else f"{num(minutes)} min reserve"


def _item(key: str, label: str, tab: str, section: str, finding: str, detail: str) -> dict:
    return {"key": key, "label": label, "tab": tab, "section": section, "finding": finding, "detail": detail}


def _weather(w: dict) -> tuple[str, str]:
    if w.get("failed"):
        return "unknown", f"Not fetched: {w['failed']}"
    if w.get("pending"):
        return "pending", "Fetching METARs, TAFs and hazards…"
    if w.get("vfr_not_recommended"):
        return "stop", f"VFR not recommended: {w['vfr_not_recommended'][0]}"
    if w.get("under_minimums"):
        return "stop", f"Under your minimums: {w['under_minimums'][0]}"
    if w.get("icing"):
        return "caution", w["icing"]
    if w.get("hazards"):
        return "caution", f"{', '.join(w['hazards'])} along the route"
    if w.get("unchecked"):
        return "caution", f"Not checked: {', '.join(w['unchecked'])}"
    return "ok", f"No hazards; at worst {w['worst']}" if w.get("worst") else "No hazards along the route"


def _airspace(a: dict) -> tuple[str, str]:
    special = a.get("special_use") or []
    active = next((s for s in special if s["when"] == "active"), None)
    maybe = next((s for s in special if s["when"] in ("by-notam", "unknown")), None)
    if a.get("pending"):
        return "pending", "Checking TFRs along the route…"
    if a.get("in_force"):
        return "stop", f"TFR {a['in_force'][0]} in force when you get there"
    if a.get("unchecked"):
        return "caution", "Not checked: see tfr.faa.gov"
    if active:
        return "caution", f"{active['name']} scheduled in use when you pass"
    if maybe:
        return "caution", f"{maybe['name']}: ask whether it is active"
    near = a.get("near") or 0
    if near or special:
        parts = []
        if near:
            parts.append(f"{near} TFR{'' if near == 1 else 's'} near, none in force on the route")
        if special:
            parts.append(f"{len(special)} special-use area{'' if len(special) == 1 else 's'} not scheduled then")
        return "ok", "; ".join(parts)
    return "ok", "None on the route"


def _altitude(a: dict) -> tuple[str, str]:
    if a.get("problem"):
        return "stop", a["problem"]
    if a.get("pending"):
        return "pending", "Planning altitudes…"
    if a.get("cautions"):
        return "caution", a["cautions"][0]
    return "ok", a.get("flown") or "Planned"


def _fuel(f: dict) -> tuple[str, str]:
    margin, required = f.get("margin_gal"), f.get("required_gal")
    if f.get("pending"):
        return "pending", "Working out the fuel…"
    if margin is not None and margin < 0:
        rule = "91.167" if f.get("ifr") else "91.151"
        return "stop", f"{num(one(-margin))} gal short of the fuel and its {_reserve_words(f.get('reserve_min'))} (14 CFR {rule})"
    if margin is None:
        return "unknown", (f"{num(one(required))} gal needed; the tanks' usable fuel not known" if required is not None
                           else "Not worked out")
    return "ok", (f"Needs {num(one(required or 0))} gal with taxi and a {_reserve_words(f.get('reserve_min'))}; "
                  f"{num(one(margin))} gal spare")


def _runways(r: dict) -> tuple[str, str]:
    if not r.get("worked"):
        return "unknown", "Not worked out for this airplane"
    if r.get("pending"):
        return "pending", "Waiting on the runways and the weather…"
    if r.get("short"):
        return "stop", f"Too short at {', '.join(r['short'])}"
    if r.get("crosswind"):
        return "caution", f"Crosswind past the POH's demonstrated at {', '.join(r['crosswind'])}"
    return "ok", "Takeoff and landing within each runway"


def _balance(b: dict) -> tuple[str, str]:
    if b.get("pending"):
        return "pending", "Waiting on the airplane's profile…"
    if not b.get("worked"):
        return "unknown", "Not worked out for this airplane"
    if b.get("problems"):
        return "stop", b["problems"][0]
    return "ok", f"{b['takeoff']}, within limits" if b.get("takeoff") else "Within limits"


def verdict_items(v: dict) -> list[dict]:
    """Each tab's finding, in the order a pilot goes through them, each
    with where it is shown in full: a tab of the planning panel and a
    section of it by its title."""
    risk = v.get("risk")
    return [
        _item("weather", "Weather", "enroute", "Adverse Conditions", *_weather(v["weather"])),
        _item("airspace", "TFRs & special use", "preflight", "TFRs & Special Use", *_airspace(v["airspace"])),
        _item("altitude", "Altitude", "enroute", "Cruise Altitude", *_altitude(v["altitude"])),
        _item("fuel", "Fuel", "preflight", "Fuel", *_fuel(v["fuel"])),
        _item("runways", "Runways", "depart", "Takeoff", *_runways(v["runways"])),
        _item("balance", "Weight & balance", "preflight", "Weight & Balance", *_balance(v["balance"])),
        _item("risk", "Risk", "preflight", "Risk Assessment",
              *((RISK_FINDING[risk["level"]], risk["line"]) if risk else ("pending", "Waiting on the briefing…"))),
    ]


def verdict_line(items: list[dict]) -> dict:
    """What the findings come to, in a line over them."""
    finding = worst_of([i["finding"] for i in items])

    def named(f: str) -> str:
        return ", ".join(i["label"] for i in items if i["finding"] == f)

    words = {
        "stop": f"No-go as planned: {named('stop')}",
        "caution": f"Look again at {named('caution')}",
        "unknown": f"Nothing found against it; not worked out: {named('unknown')}",
        "pending": f"Still checking: {named('pending')}",
    }.get(finding, "Nothing found against this flight")
    return {"finding": finding, "words": words}


def alternate_finding(data: dict | None) -> dict | None:
    """What the IFR alternate comes to for the Go / No-Go
    (features/plan/hooks/useAlternate alternateFinding): a stop where the
    one filed will not do, a caution where one is needed (14 CFR
    91.169(a)(2), (b)) and none is filed or the one filed is the pilot's
    to check; nothing where none is needed."""
    if not data or not (data.get("destination") or {}).get("required"):
        return None
    alt = data.get("alternate")
    if not alt:
        return {"finding": "caution", "detail": "An alternate is required (14 CFR 91.169): file one in Weather"}
    if alt.get("good") is False:
        return {"finding": "stop", "detail": f"{alt['ident']} is under its alternate minimums at the ETA there"}
    if alt.get("good") is None:
        reasons = alt.get("reasons") or []
        return {"finding": "caution", "detail": f"{alt['ident']}: {reasons[0] if reasons else 'check it'}"}
    return None


def with_alternate(items: list[dict], found: dict | None) -> list[dict]:
    """The alternate is the weather's to say, where the weather says
    nothing worse: a caution or a stop of its own, opening its section
    (FlightBriefingView)."""
    if not found:
        return items
    return [
        {**i, **found, "tab": "arrive", "section": "Alternate"}
        if i["key"] == "weather" and (i["finding"] == "ok" or (found["finding"] == "stop" and i["finding"] != "stop")) else i
        for i in items
    ]
