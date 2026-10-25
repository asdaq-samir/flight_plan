"""app.gonogo.frat, with web/src/lib/frat.test.ts's and
airworthiness.test.ts's cases."""
from app.gonogo.frat import assess, inspection_factors, squawk_factors

DAY = "2026-10-05"
QUIET = {
    "vfr_not_recommended": False, "under_minimums": [], "tfr_on_route": False, "hazards": 0, "night": False,
    "fuel_margin_gal": 10, "currency": None, "day": DAY, "ticked": {},
}
CURRENT = {
    "day_passengers_until": "2026-12-01", "night_passengers_until": None, "flight_review_until": "2027-06-30",
    "medical_expires_on": "2028-01-31", "total_hours": 240, "flights": 120,
    "instrument_current_until": None, "ipc_needed_after": None,
}


def keys(a: dict) -> list[str]:
    return [f["key"] for f in a["factors"]]


def test_a_quiet_day_is_low_and_a_few_things_together_raise_it():
    assert assess(QUIET) == {"score": 0, "level": "low", "factors": []}
    evening = assess({**QUIET, "night": True, "hazards": 1, "ticked": {"pressure": True}})
    assert evening["score"] == 3 + 2 + 3
    assert evening["level"] == "caution"
    assert keys(evening) == ["hazards", "night", "pressure"]


def test_the_briefings_no_go_and_the_pilots_own_minimums_are_high_on_their_own():
    assert assess({**QUIET, "vfr_not_recommended": True})["level"] == "high"
    assert "KDLH" in assess({**QUIET, "under_minimums": ["KDLH ceiling 900 ft, under your 1,500 ft"]})["factors"][0]["why"]


def test_what_makes_the_flight_unlawful_is_high_whatever_the_points():
    alcohol = assess({**QUIET, "ticked": {"alcohol": True}})
    assert (alcohol["score"], alcohol["level"]) == (0, "high")
    assert assess({**QUIET, "fuel_margin_gal": -0.5})["level"] == "high"
    assert assess({**QUIET, "fuel_margin_gal": -0.5})["factors"][0]["why"] == "91.151"
    assert assess({**QUIET, "fuel_margin_gal": -0.5, "ifr": True})["factors"][0]["why"] == "91.167"
    # Under IFR, instrument currency too (61.57(c)); a VFR flight does not ask it.
    assert keys(assess({**QUIET, "currency": CURRENT, "ifr": True})) == ["instrument"]
    assert assess({**QUIET, "currency": {**CURRENT, "instrument_current_until": "2026-10-31"}, "ifr": True})["factors"] == []
    assert assess({**QUIET, "currency": CURRENT})["factors"] == []
    # Under IFR in one's own airplane, a VOR check within 30 days (91.171):
    # a caution without one; nothing asked of a stock profile.
    assert keys(assess({**QUIET, "ifr": True, "vor_check": None})) == ["vor"]
    assert assess({**QUIET, "ifr": True, "vor_check": {"good_through": "2026-10-20", "within_limit": True}})["factors"] == []
    assert keys(assess({**QUIET, "ifr": True, "vor_check": {"good_through": "2026-10-01", "within_limit": True}})) == ["vor"]
    assert assess({**QUIET, "ifr": True})["factors"] == []
    assert assess({**QUIET, "currency": {**CURRENT, "flight_review_until": "2026-09-30"}})["level"] == "high"


def test_the_logbook_counts_only_where_the_pilot_keeps_one_and_night_landings_only_at_night():
    assert assess({**QUIET, "currency": {**CURRENT, "flights": 0, "total_hours": 0, "day_passengers_until": None}})["factors"] == []
    assert assess({**QUIET, "currency": CURRENT})["factors"] == []
    assert keys(assess({**QUIET, "night": True, "currency": CURRENT})) == ["night", "recent-night"]


# Each recorded, each good on 5 October 2026.
GOOD = {
    "annual_good_through": "2026-10-31", "hours_now": 1250, "hundred_hour_due_at_hours": 1300.5,
    "static_check_good_through": "2027-01-31", "transponder_check_good_through": "2027-01-31",
    "elt_inspection_good_through": "2027-02-28", "elt_battery_due_on": "2028-06-01",
}


def inspection_keys(i: dict, ifr: bool = False) -> list[str]:
    return [f["key"] for f in inspection_factors(i, DAY, ifr)]


def test_inspections_all_good_nothing_none_recorded_nothing_either_way():
    assert inspection_keys(GOOD, True) == []
    assert inspection_keys(dict.fromkeys(GOOD), True) == []


def test_an_annual_an_elt_inspection_or_an_elt_battery_past_due_stops_the_flight():
    # Good through its last day, past due the day after (91.409(a)).
    assert inspection_factors({**GOOD, "annual_good_through": "2026-10-05"}, DAY, False) == []
    annual = inspection_factors({**GOOD, "annual_good_through": "2026-09-30"}, DAY, False)
    assert [(f["key"], f["stop"], f["why"]) for f in annual] == [("annual", True, "91.409(a)")]
    assert inspection_keys({**GOOD, "elt_inspection_good_through": "2026-09-30"}) == ["elt"]
    # The battery's marked date: due on it (91.207(c)).
    assert inspection_keys({**GOOD, "elt_battery_due_on": DAY}) == ["eltBattery"]
    assert assess({**QUIET, "inspections": {**GOOD, "annual_good_through": "2026-09-30"}})["level"] == "high"


def test_the_static_test_only_under_ifr_the_transponder_and_the_100_hour_as_cautions():
    lapsed = {**GOOD, "static_check_good_through": "2026-09-30"}
    assert inspection_keys(lapsed) == []
    assert inspection_keys(lapsed, True) == ["static"]
    transponder = inspection_factors({**GOOD, "transponder_check_good_through": "2026-09-30"}, DAY, False)
    assert [(f["key"], f["points"]) for f in transponder] == [("transponder", 3)]
    assert inspection_keys({**GOOD, "hours_now": 1300.5}) == ["hundredHour"]
    assert inspection_keys({**GOOD, "hours_now": 1300.4}) == []


def squawk(**over) -> dict:
    return {"text": "Landing light out", "inoperative": True, "deferred_for": None, **over}


def test_an_inoperative_item_not_deferred_for_this_kind_of_flight_stops_it_other_squawks_are_a_caution():
    light = squawk(deferred_for="VFR_DAY")
    # Deferred for VFR by day: by day an open squawk to read; at night or
    # under IFR it stops the flight.
    assert [f["key"] for f in squawk_factors([light], False, False)] == ["squawks"]
    night = squawk_factors([light], True, False)
    assert [(f["key"], f["stop"], f["why"]) for f in night] == [("inoperative", True, "91.213(d)")]
    assert squawk_factors([light], False, True)[0]["label"] == "Inoperative and not deferred for this flight: Landing light out"
    assert [f["key"] for f in squawk_factors([squawk(deferred_for="ALL")], True, True)] == ["squawks"]
    both = squawk_factors([squawk(), squawk(text="Paint chip", inoperative=False)], False, False)
    assert [f["key"] for f in both] == ["inoperative", "squawks"]
    assert (both[1]["label"], both[1]["points"]) == ("1 open squawk: read it before flight", 1)
    assert assess({**QUIET, "squawks": [squawk()]})["level"] == "high"


def test_a_stock_profile_has_none_to_say():
    assert assess(QUIET)["factors"] == []
    assert assess({**QUIET, "inspections": None})["factors"] == []
