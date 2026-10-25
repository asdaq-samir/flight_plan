"""A flight risk assessment before each flight (web/src/lib/frat.ts and
lib/airworthiness.ts; the roadmap's FRAT, after the FAA Risk Management
Handbook's PAVE and IMSAFE, FAA-H-8083-2): points for what raises the risk
of this flight -- from the briefing (VFR not recommended, the pilot's own
minimums, a TFR on the route, SIGMETs and G-AIRMETs, night), from the nav
log's fuel check, from the pilot's own airplane's inspections, from the
pilot's logbook (the flight review, the medical, recent landings) -- and
for what only the pilot knows: IMSAFE, and the pressures on the day.

The points and where they turn the assessment amber and red are the
planner's own guide, not the FAA's and not a rule: the decision is the
pilot in command's (91.3, 91.103). What makes a flight unlawful --
alcohol within 8 hours, a lapsed flight review or medical, tanks that do
not hold the fuel, an annual past due -- is high whatever else is.

Dates are the pilot's days, "yyyy-mm-dd", compared as strings as the web
compares them."""

#: What only the pilot can say, ticked where it is so: the IMSAFE
#: checklist and PAVE's pressures and unfamiliarity.
SELF_CHECKS = [
    {"key": "illness", "group": "You", "label": "Ill, or not over it yet", "why": "IMSAFE: illness", "points": 5},
    {"key": "medication", "group": "You", "label": "On a medication that could impair you",
     "why": "61.53, IMSAFE: medication", "points": 5},
    {"key": "stress", "group": "You", "label": "Under stress: work, home or money", "why": "IMSAFE: stress", "points": 3},
    {"key": "alcohol", "group": "You", "label": "Alcohol in the last 8 hours, or still feeling it", "why": "91.17",
     "points": 0, "stop": True},
    {"key": "fatigue", "group": "You", "label": "Under 8 hours' sleep, or a long day already", "why": "IMSAFE: fatigue", "points": 4},
    {"key": "eating", "group": "You", "label": "Hungry or thirsty", "why": "IMSAFE: eating", "points": 1},
    {"key": "pressure", "group": "The day", "label": "Somewhere to be by a time, or people counting on it",
     "why": "PAVE: external pressures", "points": 3},
    {"key": "unfamiliar", "group": "The day", "label": "A field or a route new to you", "why": "PAVE: environment", "points": 2},
    {"key": "rusty", "group": "The day", "label": "Not flown this airplane in 30 days", "why": "PAVE: aircraft", "points": 3},
]

#: At these points the assessment is amber, and at these red.
CAUTION_FROM = 6
HIGH_FROM = 12

LEVEL_NAME = {"low": "Low", "caution": "Raised", "high": "High"}

LEVEL_WORDS = {
    "low": "Go, with the usual care.",
    "caution": "Bring it down where you can (a later time, a shorter leg, an instructor along), or talk it over.",
    "high": "Don't go as planned.",
}


def _factor(key: str, label: str, why: str | None, points: int, stop: bool = False) -> dict:
    return {"key": key, "label": label, "why": why, "points": points, "stop": stop}


def inspection_factors(i: dict, day: str, ifr: bool) -> list[dict]:
    """Whether the pilot's own airplane may be flown on the day, by the
    inspections and tests its owner has recorded: each recorded one past
    its last good day is a factor. What has not been recorded says
    nothing, either way.

    - The annual (14 CFR 91.409(a)) and the ELT's inspection (91.207(d)) or
      its battery past the date marked on it (91.207(c)): no flight as
      planned. The ELT's are not owed on a training flight within 50 nm of
      its departure, among 91.207(f)'s exceptions, which the pilot weighs.
    - The altimeter and static test (91.411(a)): no IFR in controlled
      airspace, so a stop under IFR and nothing under VFR.
    - The transponder test (91.413(a)): the transponder may not be used,
      which keeps the flight out of the airspace 91.215(b) requires one in
      -- a caution, as a flight can stay out of it.
    - The 100-hour (91.409(b)): owed only for hire, or for instruction in
      an airplane the instructor provides -- a caution."""
    def past(good_through):
        return bool(good_through) and good_through < day

    factors = []
    if past(i.get("annual_good_through")):
        factors.append(_factor("annual", "The airplane's annual inspection is past due", "91.409(a)", 0, True))
    if past(i.get("elt_inspection_good_through")):
        factors.append(_factor("elt", "The ELT's inspection is past due", "91.207(d), but for 91.207(f)'s exceptions", 0, True))
    # The battery is to be replaced by the date marked: on it, it is due.
    if i.get("elt_battery_due_on") and i["elt_battery_due_on"] <= day:
        factors.append(_factor("eltBattery", "The ELT's battery is past its replacement date",
                               "91.207(c), but for 91.207(f)'s exceptions", 0, True))
    if ifr and past(i.get("static_check_good_through")):
        factors.append(_factor("static", "The altimeter and static test is past due: no IFR in controlled airspace",
                               "91.411(a)", 0, True))
    if past(i.get("transponder_check_good_through")):
        factors.append(_factor("transponder", "The transponder test is past due: stay out of the airspace that needs one",
                               "91.413(a), 91.215(b)", 3))
    due, now = i.get("hundred_hour_due_at_hours"), i.get("hours_now")
    if due is not None and now is not None and now >= due:
        factors.append(_factor("hundredHour", "The 100-hour inspection is due",
                               "91.409(b): for hire, or instruction in an airplane you provide", 2))
    return factors


#: How far a 91.213(d) determination reaches: VFR by day, by day and
#: night, or every kind of flight (91.205(b)-(d)).
REACH = {"VFR_DAY": 0, "VFR": 1, "ALL": 2}


def squawk_factors(open_: list[dict], night: bool, ifr: bool) -> list[dict]:
    """The airplane's open squawks on the day: an instrument or equipment
    that does not work stops the flight unless its 91.213(d)
    determination was made for this kind of flight (by day, at night,
    under IFR: what 91.205 does not ask by day it may at night or under
    IFR); the others are a caution to read before flight (91.7(b))."""
    needs = REACH["ALL"] if ifr else REACH["VFR"] if night else REACH["VFR_DAY"]
    grounding = [s for s in open_ if s.get("inoperative")
                 and (s.get("deferred_for") is None or REACH[s["deferred_for"]] < needs)]
    factors = []
    if grounding:
        factors.append(_factor("inoperative", "Inoperative and not deferred for this flight: " + "; ".join(s["text"] for s in grounding),
                               "91.213(d)", 0, True))
    others = len(open_) - len(grounding)
    if others > 0:
        label = f"{others} open squawk{'' if others == 1 else 's'}: read {'it' if others == 1 else 'them'} before flight"
        factors.append(_factor("squawks", label, "91.7(b)", 1))
    return factors


def _found(f: dict) -> list[dict]:
    """What the briefing, the nav log and the logbook raise. `f` is the
    web's FratInput in snake case; `vor_check` absent (a stock profile,
    the web's undefined) is not the same as None (the pilot's own
    airplane with none recorded)."""
    day = f["day"]
    ifr = bool(f.get("ifr"))
    factors = []
    if f.get("vfr_not_recommended"):
        factors.append(_factor("vnr", "VFR flight not recommended", "The briefing (AIM 7-1-5)", HIGH_FROM))
    if f.get("under_minimums"):
        factors.append(_factor("minimums", "Under your personal minimums", f["under_minimums"][0], HIGH_FROM))
    if f.get("tfr_on_route"):
        factors.append(_factor("tfr", "A TFR on the route when you get there", "Route round it, or go another time", HIGH_FROM))
    hazards = f.get("hazards", 0)
    if hazards > 0:
        factors.append(_factor("hazards", f"{hazards} SIGMET or G-AIRMET{'' if hazards == 1 else 's'} along the route",
                               "Adverse conditions", min(6, 2 * hazards)))
    if f.get("night"):
        factors.append(_factor("night", "At night", "PAVE: environment", 3))
    # Under IFR by VOR, a check within 30 days (91.171): without one, by GPS
    # alone -- a caution, not a stop.
    if ifr and "vor_check" in f:
        vor = f["vor_check"]
        if not (vor and vor.get("within_limit") and vor.get("good_through", "") >= day):
            factors.append(_factor("vor", "No VOR check in the last 30 days", "91.171: to navigate IFR by VOR", 2))
    if f.get("inspections"):
        factors += inspection_factors(f["inspections"], day, ifr)
    if f.get("squawks"):
        factors += squawk_factors(f["squawks"], bool(f.get("night")), ifr)
    margin = f.get("fuel_margin_gal")
    if margin is not None and margin < 0:
        factors.append(_factor("fuel", "The tanks do not hold the fuel and its reserve", "91.167" if ifr else "91.151", 0, True))
    c = f.get("currency")
    if c and (c.get("flights") or 0) > 0:
        if c.get("flight_review_until") and c["flight_review_until"] < day:
            factors.append(_factor("review", "Your flight review has lapsed", "61.56", 0, True))
        if c.get("medical_expires_on") and c["medical_expires_on"] < day:
            factors.append(_factor("medical", "Your medical has expired", "61.23", 0, True))
        # Under IFR: instrument currency (61.57(c)), or after six months more
        # lapsed only a proficiency check (61.57(d)).
        if ifr and (not c.get("instrument_current_until") or c["instrument_current_until"] < day):
            ipc = bool(c.get("ipc_needed_after")) and c["ipc_needed_after"] < day
            factors.append(_factor(
                "instrument",
                "Instrument currency lapsed: a proficiency check is needed" if ipc else "Not instrument current",
                "61.57(d)" if ipc else "61.57(c): 6 approaches, holding, tracking", 0, True))
        if not c.get("day_passengers_until") or c["day_passengers_until"] < day:
            factors.append(_factor("recent", "Not three landings in the last 90 days", "61.57(a): no passengers, and rusty", 3))
        if f.get("night") and (not c.get("night_passengers_until") or c["night_passengers_until"] < day):
            # `night` is 14 CFR 1.1's, from the end of civil twilight; 61.57(b)
            # binds from an hour after sunset to an hour before sunrise, a
            # little later, so this errs toward the caution and says the window.
            factors.append(_factor("recent-night", "Not three night landings in the last 90 days",
                                   "61.57(b): needed from 1 h after sunset to 1 h before sunrise", 3))
        if (c.get("total_hours") or 0) < 100:
            factors.append(_factor("low-time", "Under 100 hours in your logbook", "PAVE: pilot", 2))
    return factors


def assess(f: dict) -> dict:
    """The whole assessment: the factors found and the ones ticked
    (`ticked`, the self checks' keys), their points, and the level they
    make."""
    ticked = f.get("ticked") or {}
    factors = _found(f) + [_factor(c["key"], c["label"], c["why"], c["points"], c.get("stop", False))
                           for c in SELF_CHECKS if ticked.get(c["key"])]
    score = sum(x["points"] for x in factors)
    level = "high" if any(x["stop"] for x in factors) or score >= HIGH_FROM else "caution" if score >= CAUTION_FROM else "low"
    return {"score": score, "level": level, "factors": factors}


def risk_line(a: dict) -> str:
    """An assessment in a few words: "Raised · 8 points"."""
    return f"{LEVEL_NAME.get(a['level'], a['level'])} · {a['score']} point{'' if a['score'] == 1 else 's'}"
