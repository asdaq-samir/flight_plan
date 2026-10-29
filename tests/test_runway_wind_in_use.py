"""vfr.runway_wind.runway_in_use, the planner's runway into the wind for a
first plan: the same examples as the web's windPick tests (lib/
windPick.test.ts), which the page's own pick goes by."""
from vfr.runway_wind import runway_in_use


def runway(ends, length_ft, wind=None, surface="ASP"):
    return {"closed": False, "length_ft": length_ft, "surface": surface, "wind": wind,
            "runway_ends": [{"ident": ident, "heading_true_deg": heading} for ident, heading in ends]}


def test_the_most_headwind_of_the_ends_the_report_favours():
    # KDLH reporting 360° at 30: 7 kt down 21, 2 kt down 27.
    kdlh = [runway([("03", 31), ("21", 211)], 5719, {"end": "21", "headwind_kt": 7, "crosswind_kt": -1}),
            runway([("09", 91), ("27", 271)], 10591, {"end": "27", "headwind_kt": 2, "crosswind_kt": -7})]
    assert runway_in_use(kdlh) == "21"


def test_calm_the_runway_in_use_then_the_paved_then_the_longer():
    kept = [runway([("06", 58), ("24", 238)], 3573, {"end": "06", "headwind_kt": 0, "crosswind_kt": 0}),
            runway([("09", 88), ("27", 268)], 3270, {"end": "27", "headwind_kt": 0, "crosswind_kt": 0, "in_use": True})]
    assert runway_in_use(kept) == "27"
    # Calm with no wind before it: C81's paved 09/27 over its longer 06/24 ("COP").
    calm = [runway([("06", 58), ("24", 238)], 3573, {"end": "06", "headwind_kt": 0, "crosswind_kt": 0}, surface="COP"),
            runway([("09", 88), ("27", 268)], 3270, {"end": "09", "headwind_kt": 0, "crosswind_kt": 0})]
    assert runway_in_use(calm) == "9"


def test_no_report_or_a_variable_wind_picks_none_and_the_page_goes_by_a_nearby_one():
    assert runway_in_use([runway([("06", 58), ("24", 238)], 3573), runway([("09", 88), ("27", 268)], 3270)]) is None
    # A closed runway, or an end with no heading (a helipad), is not one.
    shut = {**runway([("03", 31), ("21", 211)], 5719, {"end": "21", "headwind_kt": 9, "crosswind_kt": 0}), "closed": True}
    open_ = runway([("09", 91), ("27", 271)], 10591, {"end": "27", "headwind_kt": 2, "crosswind_kt": -7})
    assert runway_in_use([shut, open_]) == "27"
    assert runway_in_use([runway([("H1", None)], 50, {"end": "H1", "headwind_kt": 5, "crosswind_kt": 0})]) is None


def test_a_forecasts_wind_by_every_open_end_the_report_set_aside():
    from vfr.runway_wind import forecast_pick
    # KDLH reports 21 favoured now; its TAF says 090° at 12 for the arrival.
    kdlh = [runway([("03", 31), ("21", 211)], 5719, {"end": "21", "headwind_kt": 7, "crosswind_kt": -1}),
            runway([("09", 91), ("27", 271)], 10591, {"end": "27", "headwind_kt": 2, "crosswind_kt": -7})]
    assert forecast_pick(kdlh, {"dir_true_deg": 90, "speed_kt": 12}) == "9"
    c81 = [runway([("06", 58), ("24", 238)], 3573), runway([("09", 88), ("27", 268)], 3270)]
    assert forecast_pick(c81, {"dir_true_deg": 270, "speed_kt": 10}) == "27"
    # Calm or variable: the runway in use, else the most used (paved, then longer).
    assert forecast_pick(c81, {"dir_true_deg": None, "speed_kt": 6}) == "6"
    assert forecast_pick(c81, {"dir_true_deg": 200, "speed_kt": 0}) == "6"
    assert forecast_pick(c81, None) is None and forecast_pick(c81, {"dir_true_deg": 90, "speed_kt": None}) is None
