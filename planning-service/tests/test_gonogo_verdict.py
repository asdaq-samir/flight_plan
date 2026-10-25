"""app.gonogo.verdict, with web/src/lib/verdict.test.ts's cases: the two
must give the same answers."""
import copy

from app.gonogo.verdict import alternate_finding, verdict_items, verdict_line, with_alternate

QUIET = {
    "weather": {"pending": False, "failed": None, "vfr_not_recommended": [], "under_minimums": [], "hazards": [], "unchecked": [],
                "worst": "3,500 ft · 6 sm"},
    "airspace": {"pending": False, "unchecked": False, "in_force": [], "near": 0, "special_use": []},
    "altitude": {"pending": False, "problem": None, "cautions": [], "flown": "FL055 · Lowest"},
    "fuel": {"pending": False, "margin_gal": 12.4, "required_gal": 27.6, "reserve_min": 30},
    "runways": {"pending": False, "worked": True, "short": [], "crosswind": []},
    "balance": {"pending": False, "worked": True, "problems": [], "takeoff": "2,407 lb at 41.2 in"},
    "risk": {"level": "low", "line": "Low · 2 points"},
}


def quiet(**over) -> dict:
    v = copy.deepcopy(QUIET)
    for part, fields in over.items():
        if fields is None or part == "risk":
            v[part] = fields
        else:
            v[part].update(fields)
    return v


def finding(v: dict, key: str) -> dict:
    return next(i for i in verdict_items(v) if i["key"] == key)


def test_finds_nothing_against_a_quiet_day_every_row_saying_what_it_checked():
    items = verdict_items(quiet())
    assert [i["finding"] for i in items] == ["ok"] * 7
    assert finding(quiet(), "fuel")["detail"] == "Needs 27.6 gal with taxi and a 30 min reserve; 12.4 gal spare"
    assert verdict_line(items) == {"finding": "ok", "words": "Nothing found against this flight"}


def test_is_no_go_on_vfr_not_recommended_a_tfr_in_force_too_little_fuel_or_no_altitude_naming_each():
    v = quiet(
        weather={"vfr_not_recommended": ["KDLH currently reporting IFR"]},
        airspace={"in_force": ["6/1111"]},
        fuel={"margin_gal": -2.25},
        altitude={"problem": "Ceiling 11,700 ft: terrain 40 nm past KDLH needs 12,500"},
    )
    items = verdict_items(v)
    assert finding(v, "weather")["detail"] == "VFR not recommended: KDLH currently reporting IFR"
    assert finding(v, "fuel")["detail"] == "2.3 gal short of the fuel and its 30 min reserve (14 CFR 91.151)"
    assert verdict_line(items) == {"finding": "stop", "words": "No-go as planned: Weather, TFRs & special use, Altitude, Fuel"}


def test_under_ifr_cites_the_ifr_reserves_rule():
    v = quiet(fuel={"margin_gal": -2.25, "reserve_min": 45, "ifr": True})
    assert finding(v, "fuel")["detail"] == "2.3 gal short of the fuel and its 45 min reserve (14 CFR 91.167)"


def test_under_ifr_asks_for_another_look_at_icing_before_the_hazards_it_may_come_from():
    icing = "Icing possible at 6,000 ft: the freezing level at 5,000 ft, in cloud"
    item = finding(quiet(weather={"icing": icing, "hazards": ["Icing G-AIRMET"]}), "weather")
    assert (item["finding"], item["detail"], item["section"]) == ("caution", icing, "Adverse Conditions")
    # Your own minimums come first.
    assert finding(quiet(weather={"icing": icing, "under_minimums": ["KDLH 800 ft"]}), "weather")["finding"] == "stop"


def test_asks_for_another_look_at_hazards_an_area_in_use_a_pilots_own_altitude_and_a_crosswind():
    v = quiet(
        weather={"hazards": ["IFR G-AIRMET"]},
        airspace={"special_use": [{"name": "VOLK EAST MOA", "when": "active"}]},
        altitude={"cautions": ["Westbound above 3,000 ft flies even thousands plus 500 (14 CFR 91.159)"]},
        runways={"crosswind": ["C81"]},
    )
    assert finding(v, "airspace")["detail"] == "VOLK EAST MOA scheduled in use when you pass"
    assert verdict_line(verdict_items(v))["words"] == "Look again at Weather, TFRs & special use, Altitude, Runways"


def test_says_what_was_not_worked_out_and_what_is_still_coming():
    unknown = verdict_items(quiet(runways={"worked": False}, balance={"pending": False, "worked": False, "problems": [], "takeoff": None}))
    assert verdict_line(unknown)["words"] == "Nothing found against it; not worked out: Runways, Weight & balance"
    coming = verdict_items(quiet(weather={"pending": True}, risk=None))
    assert verdict_line(coming) == {"finding": "pending", "words": "Still checking: Weather, Risk"}


def test_names_a_near_tfr_and_an_area_not_scheduled_as_nothing_against_it():
    item = finding(quiet(airspace={"near": 2, "special_use": [{"name": "A", "when": "not-scheduled"}]}), "airspace")
    assert (item["finding"], item["detail"]) == ("ok", "2 TFRs near, none in force on the route; 1 special-use area not scheduled then")


def test_the_alternate_speaks_for_the_weather_where_the_weather_says_nothing_worse():
    # FlightBriefingView's merge and useAlternate's alternateFinding.
    needed = {"destination": {"required": True}, "alternate": None}
    assert alternate_finding(needed) == {"finding": "caution", "detail": "An alternate is required (14 CFR 91.169): file one in Weather"}
    assert alternate_finding({"destination": {"required": False}}) is None
    under = alternate_finding({"destination": {"required": True}, "alternate": {"ident": "KMSN", "good": False, "reasons": []}})
    assert under == {"finding": "stop", "detail": "KMSN is under its alternate minimums at the ETA there"}
    items = with_alternate(verdict_items(quiet()), under)
    weather = next(i for i in items if i["key"] == "weather")
    assert (weather["finding"], weather["tab"], weather["section"]) == ("stop", "arrive", "Alternate")
    # A stop of the weather's own stands.
    stopped = with_alternate(verdict_items(quiet(weather={"vfr_not_recommended": ["x"]})), under)
    assert next(i for i in stopped if i["key"] == "weather")["section"] == "Adverse Conditions"
