"""app.gonogo.minimums, with web/src/lib/minimums.test.ts's cases."""
from app.gonogo.minimums import NO_MINIMUMS, best_crosswind, under_minimums

BRIEFING = {
    "metars": {"C81": {"ceiling_ft": 2500, "visibility_sm": 10, "wind_speed_kt": 12, "wind_gust_kt": 22}, "KDLH": None},
    "forecast": {"min_ceiling_ft": 1800, "min_visibility_sm": 6, "stations": [{"icaoId": "KDLH", "ceiling_ft": 4000, "visibility_sm": 4}]},
    "airports": {
        "C81": {"runways": [
            {"ends": "6/24", "wind": {"end": "24", "headwind_kt": 10, "crosswind_kt": 9, "gust_crosswind_kt": 14}},
            {"ends": "18/36", "wind": {"end": "36", "headwind_kt": 5, "crosswind_kt": -11, "gust_crosswind_kt": -13}},
        ]},
        "KDLH": {"runways": []},
    },
}


def test_none_set_nothing_is_under_them():
    assert under_minimums(NO_MINIMUMS, BRIEFING, ["C81", "KDLH"], "KDLH") == []


def test_the_best_runway_is_the_one_with_the_least_crosswind_gusts_included():
    assert best_crosswind(BRIEFING["airports"]["C81"]["runways"]) == {"end": "36", "kt": 13}


def test_leaves_a_closed_runway_out_whatever_its_wind():
    runways = [
        {"ends": "9/27", "closed": True, "wind": {"end": "27", "headwind_kt": 15, "crosswind_kt": 0, "gust_crosswind_kt": None}},
        {"ends": "18/36", "closed": False, "wind": {"end": "36", "headwind_kt": 0, "crosswind_kt": -15, "gust_crosswind_kt": None}},
    ]
    assert best_crosswind(runways) == {"end": "36", "kt": 15}


def test_takes_a_variable_wind_which_favours_no_runway_as_all_crosswind_gusts_included():
    runways = [{"ends": "18/36", "closed": False, "wind": None}]
    assert best_crosswind(runways, {"speed_kt": 15, "gust_kt": 25}) == {"end": None, "kt": 25}
    assert best_crosswind(runways, {"speed_kt": 0, "gust_kt": None}) is None
    vrb = {**BRIEFING, "metars": {"C81": {"wind_speed_kt": 15, "wind_gust_kt": 25}}, "airports": {"C81": {"runways": runways}}}
    assert under_minimums({**NO_MINIMUMS, "crosswind_kt": 15}, vrb, ["C81"], "KDLH") == [
        "C81 variable wind 25 kt, which may all be crosswind, over your 15 kt",
    ]


def test_each_airports_report_the_destinations_forecast_and_the_routes_against_each_minimum():
    mine = {"ceiling_ft": 3000, "visibility_sm": 5, "crosswind_kt": 10, "wind_kt": 20}
    assert under_minimums(mine, BRIEFING, ["C81", "KDLH"], "KDLH") == [
        "C81 ceiling 2,500 ft, under your 3,000 ft",
        "C81 wind 12G22 kt, over your 20 kt",
        "C81 crosswind 13 kt on its best runway (36), over your 10 kt",
        "KDLH forecast visibility 4 sm, under your 5 sm",
        "Along the route, forecast ceiling 1,800 ft, under your 3,000 ft",
    ]
