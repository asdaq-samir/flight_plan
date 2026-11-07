//! The Go / No-Go's rules (wingtip_engine::gonogo), held to every case the
//! planner's tests hold app.gonogo to (planning-service/tests/
//! test_gonogo_*.py), themselves the web's lib/verdict, lib/minimums,
//! lib/icing, lib/frat, lib/airworthiness, lib/runwayCheck,
//! lib/runwayFlown, lib/weightBalance and lib/passTimes tests -- and to the
//! three places the Python had drifted from the web, where the web's rule
//! was taken: FL-045, a variable wind all crosswind, and a pick matched to
//! its field as lib/procedures sameField matches it.

use serde_json::Value;
use std::path::PathBuf;
use wingtip_engine::figures::words;
use wingtip_engine::gonogo::frat::{self, Currency, Inspections, Squawk, VorCheck};
use wingtip_engine::gonogo::icing::{self, Selection};
use wingtip_engine::gonogo::minimums::{self, Landing, Minimums, Report as Winds, RunwayWind};
use wingtip_engine::gonogo::pass_times;
use wingtip_engine::gonogo::runways::{self, Airplane, End, Field, Picks, Report, Runway, ShortField};
use wingtip_engine::gonogo::verdict::{self, Alternates, FiledAlternate, Input};
use wingtip_engine::gonogo::weight_balance::{self, Load, Loading, Station};

fn s(v: &str) -> String {
    v.to_owned()
}

fn strings(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| s(x)).collect()
}

fn near(a: f64, b: f64, within: f64) -> bool {
    (a - b).abs() <= within
}

// --- words ------------------------------------------------------------------

#[test]
fn a_cruising_altitude_is_written_fl_dash_as_the_owner_asked() {
    // lib/units flightLevel, the owner's 2026-10-27 format; the Python wrote
    // FL045 and FL--- until the engine took the web's.
    assert_eq!(words::flight_level(Some(4500.0)), "FL-045");
    assert_eq!(words::flight_level(Some(12_500.0)), "FL-125");
    assert_eq!(words::flight_level(Some(0.0)), "FL-000");
    assert_eq!(words::flight_level(None), "FL-___");
    // String(-5).padStart(3, "0"), as the web pads it.
    assert_eq!(words::flight_level(Some(-500.0)), "FL-0-5");
}

#[test]
fn numbers_are_written_as_javascript_writes_them() {
    assert_eq!(words::js_num(28.0), "28");
    assert_eq!(words::js_num(2.3), "2.3");
    assert_eq!(words::js_num(-0.0), "0");
    assert_eq!(words::js_num(1e-5), "0.00001");
    assert_eq!(words::js_num(1e-7), "1e-7");
    assert_eq!(words::js_num(1.5e21), "1.5e+21");
    assert_eq!(words::js_opt(None), "null");
    assert_eq!(words::js_round(0.49999999999999994), 0);
    assert_eq!(words::one(2.25), 2.3);
    assert_eq!(words::ceiling_and_visibility(Some(3500.0), Some(6.0)), "3,500 ft · 6 sm");
    assert_eq!(words::ceiling_and_visibility(None, None), "no ceiling · —");
}

// --- verdict ----------------------------------------------------------------

fn quiet() -> Input {
    Input {
        weather: verdict::Weather { worst: Some(s("3,500 ft · 6 sm")), ..Default::default() },
        airspace: Default::default(),
        altitude: verdict::Altitude { flown: Some(s("FL055 · Lowest")), ..Default::default() },
        fuel: verdict::Fuel { margin_gal: Some(12.4), required_gal: Some(27.6), reserve_min: Some(30.0), ..Default::default() },
        runways: verdict::Runways { worked: true, ..Default::default() },
        balance: verdict::Balance { worked: true, takeoff: Some(s("2,407 lb at 41.2 in")), ..Default::default() },
        risk: Some((s("low"), s("Low · 2 points"))),
    }
}

fn finding(v: &Input, key: &str) -> verdict::Item {
    verdict::verdict_items(v).into_iter().find(|i| i.key == key).unwrap()
}

#[test]
fn finds_nothing_against_a_quiet_day_every_row_saying_what_it_checked() {
    let items = verdict::verdict_items(&quiet());
    assert!(items.iter().all(|i| i.finding == "ok"));
    assert_eq!(items.len(), 7);
    assert_eq!(finding(&quiet(), "fuel").detail, "Needs 27.6 gal with taxi and a 30 min reserve; 12.4 gal spare");
    assert_eq!(verdict::verdict_line(&items), ("ok", s("Nothing found against this flight")));
}

#[test]
fn is_no_go_on_vfr_not_recommended_a_tfr_in_force_too_little_fuel_or_no_altitude_naming_each() {
    let mut v = quiet();
    v.weather.vfr_not_recommended = strings(&["KDLH currently reporting IFR"]);
    v.airspace.in_force = strings(&["6/1111"]);
    v.fuel.margin_gal = Some(-2.25);
    v.altitude.problem = Some(s("Ceiling 11,700 ft: terrain 40 nm past KDLH needs 12,500"));
    assert_eq!(finding(&v, "weather").detail, "VFR not recommended: KDLH currently reporting IFR");
    assert_eq!(finding(&v, "fuel").detail, "2.3 gal short of the fuel and its 30 min reserve (14 CFR 91.151)");
    assert_eq!(verdict::verdict_line(&verdict::verdict_items(&v)).1, "No-go as planned: Weather, TFRs & special use, Altitude, Fuel");
}

#[test]
fn under_ifr_cites_the_ifr_reserves_rule() {
    let mut v = quiet();
    v.fuel = verdict::Fuel { margin_gal: Some(-2.25), reserve_min: Some(45.0), ifr: true, ..v.fuel };
    assert_eq!(finding(&v, "fuel").detail, "2.3 gal short of the fuel and its 45 min reserve (14 CFR 91.167)");
}

#[test]
fn under_ifr_asks_for_another_look_at_icing_before_the_hazards_it_may_come_from() {
    let icing = "Icing possible at 6,000 ft: the freezing level at 5,000 ft, in cloud";
    let mut v = quiet();
    v.weather.icing = Some(s(icing));
    v.weather.hazards = strings(&["Icing G-AIRMET"]);
    let item = finding(&v, "weather");
    assert_eq!((item.finding.as_str(), item.detail.as_str(), item.section.as_deref()), ("caution", icing, Some("Adverse Conditions")));
    let mut mine = quiet();
    mine.weather.icing = Some(s(icing));
    mine.weather.under_minimums = strings(&["KDLH 800 ft"]);
    assert_eq!(finding(&mine, "weather").finding, "stop");
}

#[test]
fn asks_for_another_look_at_hazards_an_area_in_use_a_pilots_own_altitude_and_a_crosswind() {
    let mut v = quiet();
    v.weather.hazards = strings(&["IFR G-AIRMET"]);
    v.airspace.special_use = vec![(s("VOLK EAST MOA"), s("active"))];
    v.altitude.cautions = strings(&["Westbound above 3,000 ft flies even thousands plus 500 (14 CFR 91.159)"]);
    v.runways.crosswind = strings(&["C81"]);
    assert_eq!(finding(&v, "airspace").detail, "VOLK EAST MOA scheduled in use when you pass");
    assert_eq!(verdict::verdict_line(&verdict::verdict_items(&v)).1, "Look again at Weather, TFRs & special use, Altitude, Runways");
}

#[test]
fn says_what_was_not_worked_out_and_what_is_still_coming() {
    let mut v = quiet();
    v.runways.worked = false;
    v.balance = verdict::Balance::default();
    assert_eq!(verdict::verdict_line(&verdict::verdict_items(&v)).1, "Nothing found against it; not worked out: Runways, Weight & balance");
    let mut coming = quiet();
    coming.weather.pending = true;
    coming.risk = None;
    assert_eq!(verdict::verdict_line(&verdict::verdict_items(&coming)), ("pending", s("Still checking: Weather, Risk")));
}

#[test]
fn names_a_near_tfr_and_an_area_not_scheduled_as_nothing_against_it() {
    let mut v = quiet();
    v.airspace.near = 2.0;
    v.airspace.special_use = vec![(s("A"), s("not-scheduled"))];
    let item = finding(&v, "airspace");
    assert_eq!((item.finding.as_str(), item.detail.as_str()),
               ("ok", "2 TFRs near, none in force on the route; 1 special-use area not scheduled then"));
}

#[test]
fn an_altitude_line_left_empty_stays_empty_as_the_webs_nullish_says() {
    // `flown ?? "Planned"`: only none is "Planned".
    let mut v = quiet();
    v.altitude.flown = Some(String::new());
    assert_eq!(finding(&v, "altitude").detail, "");
    v.altitude.flown = None;
    assert_eq!(finding(&v, "altitude").detail, "Planned");
}

#[test]
fn the_alternate_speaks_for_the_weather_where_the_weather_says_nothing_worse() {
    let needed = Alternates { required: true, alternate: None };
    assert_eq!(verdict::alternate_finding(Some(&needed)),
               Some(("caution", s("An alternate is required (14 CFR 91.169): file one in Weather"))));
    assert_eq!(verdict::alternate_finding(Some(&Alternates { required: false, alternate: None })), None);
    let filed = |good, good_given| Alternates {
        required: true, alternate: Some(FiledAlternate { ident: s("KMSN"), good, good_given, first_reason: None }),
    };
    let under = verdict::alternate_finding(Some(&filed(Some(false), true)));
    assert_eq!(under, Some(("stop", s("KMSN is under its alternate minimums at the ETA there"))));
    assert_eq!(verdict::alternate_finding(Some(&filed(None, true))), Some(("caution", s("KMSN: check it"))));
    // `good === null` only: an answer with no `good` says nothing.
    assert_eq!(verdict::alternate_finding(Some(&filed(None, false))), None);
    let (f, d) = under.unwrap();
    let items = verdict::with_alternate(verdict::verdict_items(&quiet()), Some((f, &d)));
    let weather = items.iter().find(|i| i.key == "weather").unwrap();
    assert_eq!((weather.finding.as_str(), weather.tab.as_str(), weather.section.as_deref()), ("stop", "arrive", Some("Alternate")));
    let mut vnr = quiet();
    vnr.weather.vfr_not_recommended = strings(&["x"]);
    let stopped = verdict::with_alternate(verdict::verdict_items(&vnr), Some((f, &d)));
    assert_eq!(stopped[0].section.as_deref(), Some("Adverse Conditions"));
    let whole: Value = serde_json::from_str(&verdict::verdict_json(&quiet(), Some(&filed(Some(false), true)))).unwrap();
    assert_eq!(whole["line"]["finding"], "stop");
    assert_eq!(whole["items"][0]["section"], "Alternate");
}

// --- minimums ---------------------------------------------------------------

fn wind(end: &str, headwind_kt: f64, crosswind_kt: f64, gust: Option<f64>) -> RunwayWind {
    RunwayWind { end: s(end), headwind_kt, crosswind_kt, gust_crosswind_kt: gust, in_use: false }
}

fn c81_winds() -> Vec<(bool, Option<RunwayWind>)> {
    vec![(false, Some(wind("24", 10.0, 9.0, Some(14.0)))), (false, Some(wind("36", 5.0, -11.0, Some(-13.0))))]
}

fn briefing() -> minimums::Weather {
    minimums::Weather {
        landings: vec![
            Landing {
                ident: s("C81"),
                metar: Some(Winds { ceiling_ft: Some(2500.0), visibility_sm: Some(10.0), wind_speed_kt: Some(12.0), wind_gust_kt: Some(22.0) }),
                runways: c81_winds(),
            },
            Landing { ident: s("KDLH"), metar: None, runways: vec![] },
        ],
        dest: s("KDLH"),
        dest_forecast: Some((Some(4000.0), Some(4.0))),
        min_ceiling_ft: Some(1800.0),
        min_visibility_sm: Some(6.0),
    }
}

#[test]
fn none_set_nothing_is_under_them() {
    assert!(minimums::under_minimums(&Minimums::default(), &briefing()).is_empty());
}

#[test]
fn the_best_runway_is_the_one_with_the_least_crosswind_gusts_included() {
    assert_eq!(minimums::best_crosswind(&c81_winds(), None), Some((Some(s("36")), 13.0)));
}

#[test]
fn leaves_a_closed_runway_out_whatever_its_wind() {
    let runways = vec![(true, Some(wind("27", 15.0, 0.0, None))), (false, Some(wind("36", 0.0, -15.0, None)))];
    assert_eq!(minimums::best_crosswind(&runways, None), Some((Some(s("36")), 15.0)));
}

#[test]
fn takes_a_variable_wind_which_favours_no_runway_as_all_crosswind_gusts_included() {
    let runways = vec![(false, None)];
    assert_eq!(minimums::best_crosswind(&runways, Some((Some(15.0), Some(25.0)))), Some((None, 25.0)));
    assert_eq!(minimums::best_crosswind(&runways, Some((Some(0.0), None))), None);
    let vrb = minimums::Weather {
        landings: vec![Landing {
            ident: s("C81"),
            metar: Some(Winds { wind_speed_kt: Some(15.0), wind_gust_kt: Some(25.0), ..Default::default() }),
            runways,
        }],
        ..briefing()
    };
    let m = Minimums { crosswind_kt: Some(15.0), ..Default::default() };
    assert_eq!(minimums::under_minimums(&m, &vrb), strings(&["C81 variable wind 25 kt, which may all be crosswind, over your 15 kt"]));
}

#[test]
fn each_airports_report_the_destinations_forecast_and_the_routes_against_each_minimum() {
    let mine = Minimums { ceiling_ft: Some(3000.0), visibility_sm: Some(5.0), crosswind_kt: Some(10.0), wind_kt: Some(20.0) };
    assert_eq!(minimums::under_minimums(&mine, &briefing()), strings(&[
        "C81 ceiling 2,500 ft, under your 3,000 ft",
        "C81 wind 12G22 kt, over your 20 kt",
        "C81 crosswind 13 kt on its best runway (36), over your 10 kt",
        "KDLH forecast visibility 4 sm, under your 5 sm",
        "Along the route, forecast ceiling 1,800 ft, under your 3,000 ft",
    ]));
}

// --- icing ------------------------------------------------------------------

fn selection(level: Option<f64>, possible: bool, at_or_below: bool) -> Selection {
    Selection { freezing_level_ft: level, possible, at_or_below }
}

#[test]
fn a_leg_at_or_above_the_freezing_level_in_cloud_with_the_reports_of_icing_near_the_route() {
    let pireps = [Some(s("MOD")), Some(s("NEG")), Some(s("NEGclr")), None, Some(s("LGT-MOD"))];
    let found = icing::icing_at_altitude(&selection(Some(5000.0), true, false), &[4000.0, 6000.0], &pireps).unwrap();
    assert_eq!(found, icing::Icing { altitude_ft: 6000.0, freezing_level_ft: 5000.0, at_or_below: false, reports: 2 });
    assert_eq!(icing::icing_line(&found),
               "Icing possible at 6,000 ft: the freezing level at 5,000 ft, in cloud; 2 pilot reports of icing near the route");
    assert!(icing::icing_at_altitude(&selection(Some(5000.0), true, false), &[5000.0], &[]).is_some());
}

#[test]
fn nothing_below_the_freezing_level_without_the_moisture_or_where_the_level_is_not_known() {
    assert!(icing::icing_at_altitude(&selection(Some(5000.0), true, false), &[4000.0, 4999.0], &[]).is_none());
    assert!(icing::icing_at_altitude(&selection(Some(5000.0), false, false), &[8000.0], &[]).is_none());
    assert!(icing::icing_at_altitude(&selection(None, true, false), &[8000.0], &[]).is_none());
}

#[test]
fn a_freezing_level_at_or_below_the_lowest_forecast_altitude_is_every_altitude() {
    let found = icing::icing_at_altitude(&selection(Some(3000.0), true, true), &[2000.0], &[]).unwrap();
    assert_eq!(icing::icing_line(&found), "Icing possible at 2,000 ft: the freezing level at or below 3,000 ft, in cloud");
}

// --- frat -------------------------------------------------------------------

const DAY: &str = "2026-10-05";

fn quiet_risk() -> frat::Input {
    frat::Input { fuel_margin_gal: Some(10.0), day: s(DAY), ..Default::default() }
}

fn current() -> Currency {
    Currency {
        day_passengers_until: Some(s("2026-12-01")), flight_review_until: Some(s("2027-06-30")),
        medical_expires_on: Some(s("2028-01-31")), total_hours: 240.0, flights: 120.0, ..Default::default()
    }
}

fn keys(a: &frat::Assessment) -> Vec<&str> {
    a.factors.iter().map(|f| f.key.as_str()).collect()
}

#[test]
fn a_quiet_day_is_low_and_a_few_things_together_raise_it() {
    let a = frat::assess(&quiet_risk());
    assert_eq!((a.score, a.level, a.factors.len()), (0, "low", 0));
    let evening = frat::assess(&frat::Input { night: true, hazards: 1, ticked: strings(&["pressure"]), ..quiet_risk() });
    assert_eq!((evening.score, evening.level), (3 + 2 + 3, "caution"));
    assert_eq!(keys(&evening), ["hazards", "night", "pressure"]);
    // A self check ticked keeps its group, and is drawn with no mark.
    let pressure = &evening.factors[2];
    assert_eq!((pressure.group.as_deref(), frat::mark(pressure)), (Some("The day"), None));
    assert_eq!(frat::mark(&evening.factors[0]), Some("caution"));
}

#[test]
fn the_briefings_no_go_and_the_pilots_own_minimums_are_high_on_their_own() {
    let vnr = frat::assess(&frat::Input { vfr_not_recommended: true, ..quiet_risk() });
    assert_eq!(vnr.level, "high");
    assert_eq!(frat::mark(&vnr.factors[0]), Some("stop"));
    let mine = frat::assess(&frat::Input { under_minimums: strings(&["KDLH ceiling 900 ft, under your 1,500 ft"]), ..quiet_risk() });
    assert!(mine.factors[0].why.as_deref().unwrap().contains("KDLH"));
}

#[test]
fn what_makes_the_flight_unlawful_is_high_whatever_the_points() {
    let alcohol = frat::assess(&frat::Input { ticked: strings(&["alcohol"]), ..quiet_risk() });
    assert_eq!((alcohol.score, alcohol.level), (0, "high"));
    let short = frat::assess(&frat::Input { fuel_margin_gal: Some(-0.5), ..quiet_risk() });
    assert_eq!((short.level, short.factors[0].why.as_deref()), ("high", Some("91.151")));
    let ifr_short = frat::assess(&frat::Input { fuel_margin_gal: Some(-0.5), ifr: true, ..quiet_risk() });
    assert_eq!(ifr_short.factors[0].why.as_deref(), Some("91.167"));
    assert_eq!(keys(&frat::assess(&frat::Input { currency: Some(current()), ifr: true, ..quiet_risk() })), ["instrument"]);
    let instrument = Currency { instrument_current_until: Some(s("2026-10-31")), ..current() };
    assert!(frat::assess(&frat::Input { currency: Some(instrument), ifr: true, ..quiet_risk() }).factors.is_empty());
    assert!(frat::assess(&frat::Input { currency: Some(current()), ..quiet_risk() }).factors.is_empty());
    assert_eq!(keys(&frat::assess(&frat::Input { ifr: true, vor_check: VorCheck::None, ..quiet_risk() })), ["vor"]);
    let checked = |good_through: &str| VorCheck::Checked { good_through: s(good_through), within_limit: true };
    assert!(frat::assess(&frat::Input { ifr: true, vor_check: checked("2026-10-20"), ..quiet_risk() }).factors.is_empty());
    assert_eq!(keys(&frat::assess(&frat::Input { ifr: true, vor_check: checked("2026-10-01"), ..quiet_risk() })), ["vor"]);
    assert!(frat::assess(&frat::Input { ifr: true, ..quiet_risk() }).factors.is_empty());
    let lapsed = Currency { flight_review_until: Some(s("2026-09-30")), ..current() };
    assert_eq!(frat::assess(&frat::Input { currency: Some(lapsed), ..quiet_risk() }).level, "high");
}

#[test]
fn the_logbook_counts_only_where_the_pilot_keeps_one_and_night_landings_only_at_night() {
    let none = Currency { flights: 0.0, total_hours: 0.0, day_passengers_until: None, ..current() };
    assert!(frat::assess(&frat::Input { currency: Some(none), ..quiet_risk() }).factors.is_empty());
    assert_eq!(keys(&frat::assess(&frat::Input { night: true, currency: Some(current()), ..quiet_risk() })), ["night", "recent-night"]);
}

fn good() -> Inspections {
    Inspections {
        annual_good_through: Some(s("2026-10-31")), hours_now: Some(1250.0), hundred_hour_due_at_hours: Some(1300.5),
        static_check_good_through: Some(s("2027-01-31")), transponder_check_good_through: Some(s("2027-01-31")),
        elt_inspection_good_through: Some(s("2027-02-28")), elt_battery_due_on: Some(s("2028-06-01")),
    }
}

fn inspection_keys(i: &Inspections, ifr: bool) -> Vec<String> {
    frat::inspection_factors(i, DAY, ifr).into_iter().map(|f| f.key).collect()
}

#[test]
fn inspections_all_good_nothing_none_recorded_nothing_either_way() {
    assert!(inspection_keys(&good(), true).is_empty());
    assert!(inspection_keys(&Inspections::default(), true).is_empty());
}

#[test]
fn an_annual_an_elt_inspection_or_an_elt_battery_past_due_stops_the_flight() {
    assert!(frat::inspection_factors(&Inspections { annual_good_through: Some(s(DAY)), ..good() }, DAY, false).is_empty());
    let annual = frat::inspection_factors(&Inspections { annual_good_through: Some(s("2026-09-30")), ..good() }, DAY, false);
    assert_eq!(annual.iter().map(|f| (f.key.as_str(), f.stop, f.why.as_deref())).collect::<Vec<_>>(), [("annual", true, Some("91.409(a)"))]);
    assert_eq!(inspection_keys(&Inspections { elt_inspection_good_through: Some(s("2026-09-30")), ..good() }, false), ["elt"]);
    assert_eq!(inspection_keys(&Inspections { elt_battery_due_on: Some(s(DAY)), ..good() }, false), ["eltBattery"]);
    let past = Inspections { annual_good_through: Some(s("2026-09-30")), ..good() };
    assert_eq!(frat::assess(&frat::Input { inspections: Some(past), ..quiet_risk() }).level, "high");
}

#[test]
fn the_static_test_only_under_ifr_the_transponder_and_the_100_hour_as_cautions() {
    let lapsed = Inspections { static_check_good_through: Some(s("2026-09-30")), ..good() };
    assert!(inspection_keys(&lapsed, false).is_empty());
    assert_eq!(inspection_keys(&lapsed, true), ["static"]);
    let transponder = frat::inspection_factors(&Inspections { transponder_check_good_through: Some(s("2026-09-30")), ..good() }, DAY, false);
    assert_eq!((transponder[0].key.as_str(), transponder[0].points, transponder.len()), ("transponder", 3, 1));
    assert_eq!(inspection_keys(&Inspections { hours_now: Some(1300.5), ..good() }, false), ["hundredHour"]);
    assert!(inspection_keys(&Inspections { hours_now: Some(1300.4), ..good() }, false).is_empty());
}

fn squawk(text: &str, inoperative: bool, deferred_for: Option<&str>) -> Squawk {
    Squawk { text: s(text), inoperative, deferred_for: deferred_for.map(s) }
}

#[test]
fn an_inoperative_item_not_deferred_for_this_kind_of_flight_stops_it_other_squawks_are_a_caution() {
    let light = squawk("Landing light out", true, Some("VFR_DAY"));
    let keys_of = |f: Vec<frat::Factor>| f.into_iter().map(|f| f.key).collect::<Vec<_>>();
    assert_eq!(keys_of(frat::squawk_factors(&[light.clone()], false, false)), ["squawks"]);
    let night = frat::squawk_factors(&[light.clone()], true, false);
    assert_eq!((night[0].key.as_str(), night[0].stop, night[0].why.as_deref()), ("inoperative", true, Some("91.213(d)")));
    assert_eq!(frat::squawk_factors(&[light], false, true)[0].label, "Inoperative and not deferred for this flight: Landing light out");
    assert_eq!(keys_of(frat::squawk_factors(&[squawk("Landing light out", true, Some("ALL"))], true, true)), ["squawks"]);
    let both = frat::squawk_factors(&[squawk("Landing light out", true, None), squawk("Paint chip", false, None)], false, false);
    assert_eq!(both.iter().map(|f| f.key.as_str()).collect::<Vec<_>>(), ["inoperative", "squawks"]);
    assert_eq!((both[1].label.as_str(), both[1].points), ("1 open squawk: read it before flight", 1));
    let grounded = frat::Input { squawks: Some(vec![squawk("Landing light out", true, None)]), ..quiet_risk() };
    assert_eq!(frat::assess(&grounded).level, "high");
}

#[test]
fn a_stock_profile_has_none_to_say_and_the_lines_and_checks_read_as_the_web() {
    assert!(frat::assess(&quiet_risk()).factors.is_empty());
    assert_eq!(frat::risk_line("caution", 8), "Raised · 8 points");
    assert_eq!(frat::risk_line("low", 1), "Low · 1 point");
    let checks: Value = serde_json::from_str(&frat::self_checks_json()).unwrap();
    assert_eq!(checks[3]["key"], "alcohol");
    assert_eq!((checks[3]["stop"].as_bool(), checks[3]["group"].as_str(), checks[3]["finding"].is_null()), (Some(true), Some("You"), true));
    let whole: Value = serde_json::from_str(&frat::assessment_json(&frat::assess(&frat::Input { night: true, ..quiet_risk() }))).unwrap();
    assert_eq!((whole["line"].as_str(), whole["words"].as_str()), (Some("Low · 3 points"), Some("Go, with the usual care.")));
    assert_eq!(whole["factors"][0]["finding"], "caution");
}

// --- runways ----------------------------------------------------------------

fn c172() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data/aircraft/c172.json");
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn floats(v: &Value) -> Vec<f64> {
    v.as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect()
}

fn grid(v: &Value) -> Vec<Vec<f64>> {
    v.as_array().unwrap().iter().map(floats).collect()
}

fn table(v: &Value) -> ShortField {
    let tables = v["tables"].as_array().unwrap();
    ShortField {
        pressure_altitudes_ft: floats(&v["pressure_altitudes_ft"]),
        temperatures_c: floats(&v["temperatures_c"]),
        weights_lb: floats(&v["weights_lb"]),
        ground_roll_ft: tables.iter().map(|t| grid(&t["ground_roll_ft"])).collect(),
        total_50ft_ft: tables.iter().map(|t| grid(&t["total_50ft_ft"])).collect(),
        grass_ground_roll_pct: v["grass_ground_roll_pct"].as_f64().unwrap(),
    }
}

fn airplane() -> Airplane {
    let p = c172();
    Airplane { takeoff: Some(table(&p["takeoff"])), landing: Some(table(&p["landing"])), demonstrated_kt: p["crosswind"]["demonstrated_kt"].as_f64() }
}

fn loading() -> Loading {
    let l = &c172()["loading"];
    Loading {
        max_ramp_lb: l["max_ramp_lb"].as_f64().unwrap(),
        max_takeoff_lb: l["max_takeoff_lb"].as_f64().unwrap(),
        max_landing_lb: l["max_landing_lb"].as_f64().unwrap(),
        sample_empty_weight_lb: l["sample_empty_weight_lb"].as_f64().unwrap(),
        sample_empty_moment_lb_in: l["sample_empty_moment_lb_in"].as_f64().unwrap(),
        stations: l["stations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|st| Station { name: st["name"].as_str().unwrap().into(), arm_in: st["arm_in"].as_f64().unwrap(), max_lb: st["max_lb"].as_f64() })
            .collect(),
        baggage_combined_max_lb: l["baggage_combined_max_lb"].as_f64(),
        fuel_arm_in: l["fuel_arm_in"].as_f64().unwrap(),
        fuel_max_gal: l["fuel_max_gal"].as_f64().unwrap(),
        fuel_lb_per_gal: l["fuel_lb_per_gal"].as_f64().unwrap_or(6.0),
        start_taxi_fuel_lb: l["start_taxi_fuel_lb"].as_f64().unwrap_or(0.0),
        envelope: l["envelope"].as_array().unwrap().iter().map(|p| (p[0].as_f64().unwrap(), p[1].as_f64().unwrap())).collect(),
    }
}

fn load(arm: f64, stations: &[f64], fuel_gal: f64) -> Load {
    Load { empty_weight_lb: 1642.0, empty_arm_in: arm, stations_lb: stations.iter().map(|x| Some(*x)).collect(), fuel_gal }
}

#[test]
fn the_pohs_own_sample_loading_weighs_2550_lb_at_takeoff_within_the_envelope() {
    // Figure 6-5's sample: empty 1,642 lb at 62.6 (thousand lb-in), 30 gal,
    // 340 lb in front, 340 behind, 56 lb of baggage in area 1.
    let b = weight_balance::balance(&loading(), &load(62600.0 / 1642.0, &[340.0, 340.0, 56.0, 0.0], 30.0), Some(0.0));
    assert_eq!(b.takeoff.weight_lb, 2550.0);
    let expected = (62600.0 + 180.0 * 48.0 + 340.0 * 37.0 + 340.0 * 73.0 + 56.0 * 95.0 - 8.0 * 48.0) / 2550.0;
    assert!(near(b.takeoff.arm_in, expected, 1e-6));
    assert!(b.problems.is_empty());
}

#[test]
fn over_its_weight_and_the_baggage_over_its_own() {
    let b = weight_balance::balance(&loading(), &load(38.1, &[170.0, 400.0, 120.0, 50.0], 53.0), Some(10.0));
    assert!(b.problems.contains(&s("The takeoff weight, 2,692 lb, is 142 lb over its most")));
    assert!(b.problems.contains(&s("The baggage, 170 lb in all, is over its 120 lb")));
}

#[test]
fn the_envelope_is_the_pohs() {
    let envelope = loading().envelope;
    assert!(weight_balance::in_envelope(&envelope, 36.0, 1900.0));
    assert!(!weight_balance::in_envelope(&envelope, 36.0, 2500.0));
    assert!(!weight_balance::in_envelope(&envelope, 47.5, 2000.0));
}

#[test]
fn the_default_load_is_the_sample_airplane_and_a_pilot() {
    let d = weight_balance::default_load(&loading(), 40.0);
    assert_eq!(d, Load { empty_weight_lb: 1642.0, empty_arm_in: 38.12, stations_lb: vec![Some(170.0), Some(0.0), Some(0.0), Some(0.0)],
                         fuel_gal: 40.0 });
}

#[test]
fn the_table_at_sea_level_and_15_c_half_way_between_its_10_and_20() {
    let d = runways::short_field(&airplane().takeoff.unwrap(), 0.0, 15.0, 2550.0, 0.0, false);
    assert_eq!((d.ground_roll_ft, d.total_ft, d.caveats.len()), (960.0, 1635.0, 0));
}

#[test]
fn a_headwind_takes_a_tenth_off_every_9_kt_a_tailwind_adds_a_tenth_every_2_grass_the_ground_rolls_15_pct() {
    let t = airplane().takeoff.unwrap();
    assert_eq!(runways::short_field(&t, 0.0, 10.0, 2550.0, 9.0, false).ground_roll_ft, 835.0);
    assert_eq!(runways::short_field(&t, 0.0, 10.0, 2550.0, -2.0, false).ground_roll_ft, 1020.0);
    let grass = runways::short_field(&t, 0.0, 10.0, 2550.0, 0.0, true);
    assert_eq!((grass.ground_roll_ft, grass.total_ft), (1065.0, 1715.0));
}

#[test]
fn between_its_weights_and_its_one_landing_table_at_any_weight() {
    let a = airplane();
    assert_eq!(runways::short_field(a.takeoff.as_ref().unwrap(), 0.0, 0.0, 2475.0, 0.0, false).ground_roll_ft, 805.0);
    let landing = runways::short_field(a.landing.as_ref().unwrap(), 2000.0, 20.0, 2200.0, 0.0, false);
    assert_eq!((landing.ground_roll_ft, landing.total_ft), (630.0, 1420.0));
}

#[test]
fn density_altitude_is_the_pressure_altitude_on_a_standard_day_and_higher_the_hotter_it_is() {
    assert!(near(runways::density_altitude_ft(0.0, 15.0), 0.0, 1e-6));
    assert!(near(runways::density_altitude_ft(5000.0, 5.094), 5000.0, 5.0));
    let hot = runways::density_altitude_ft(5000.0, 25.0);
    assert!(7200.0 < hot && hot < 7400.0);
    assert!(runways::density_altitude_ft(2000.0, -10.0) < 2000.0);
}

#[test]
fn a_fields_air_off_the_altimeter_and_a_standard_days_temperature_where_none_is_reported() {
    let (pa, t) = runways::field_air(900.0, Some(29.42), Some(25.0));
    assert!(near(pa, 1400.0, 1e-9));
    assert_eq!(t, 25.0);
    let (pa, t) = runways::field_air(900.0, None, None);
    assert_eq!(pa, 900.0);
    assert!(near(t, 13.2, 0.05));
}

#[test]
fn takes_turf_grass_dirt_and_gravel_as_soft_and_asphalt_not() {
    let soft = |surface: &str| runways::soft_surface(Some(&Runway { surface: Some(s(surface)), ..Default::default() }));
    assert!(["TURF", "GRS", "grass", "DIRT", "GRAVEL-G"].iter().all(|x| soft(x)));
    assert!(!soft("ASPH-G"));
    assert!(!runways::soft_surface(None));
    assert_eq!(runways::runway_number("09"), "9");
    assert_eq!(runways::runway_number("00"), "0");
    assert_eq!(runways::runway_number("36L"), "36L");
}

fn runway(length: f64, headwind: f64, crosswind: f64) -> Runway {
    Runway {
        surface: Some(s("ASP")), length_ft: Some(length), closed: false, ends: vec![],
        wind: Some(wind("27", headwind, crosswind, None)),
    }
}

fn ends(a: &str, ha: f64, b: &str, hb: f64) -> Vec<End> {
    vec![End { ident: s(a), heading_true_deg: Some(ha) }, End { ident: s(b), heading_true_deg: Some(hb) }]
}

fn fields(c81: Vec<Runway>, kdlh: Vec<Runway>, c81_metar: Option<Report>) -> Vec<Field> {
    vec![
        Field { ident: s("C81"), elevation_ft: Some(900.0), metar: c81_metar, runways: c81 },
        Field { ident: s("KDLH"), elevation_ft: Some(1400.0), metar: None, runways: kdlh },
    ]
}

fn standard() -> Vec<Field> {
    let hot = Report { temp_c: Some(30.0), altimeter_in_hg: Some(29.92), ..Default::default() };
    fields(vec![runway(1500.0, 2.0, 18.0)], vec![runway(9000.0, 10.0, 3.0), Runway { closed: true, ..runway(12000.0, 0.0, 0.0) }], Some(hot))
}

#[test]
fn takes_off_from_the_departure_and_lands_at_the_destination_on_the_runway_the_wind_favours() {
    let checks = runways::runway_checks(&airplane(), true, &standard(), Some(2550.0), Some(2400.0), None);
    let (start, end) = (&checks[0], &checks[1]);
    assert_eq!(start.role, "Departure");
    assert_eq!(start.distances.iter().map(|d| d.kind).collect::<Vec<_>>(), ["takeoff"]);
    assert_eq!(end.distances.iter().map(|d| d.kind).collect::<Vec<_>>(), ["landing"]);
    // A closed runway is not one to land on, however long.
    assert_eq!(end.runway, Some(0));
    assert!(!end.reported);
}

#[test]
fn says_a_runway_too_short_and_a_crosswind_past_the_172s_demonstrated_15_kt() {
    let checks = runways::runway_checks(&airplane(), true, &standard(), Some(2550.0), Some(2400.0), None);
    let (start, end) = (&checks[0], &checks[1]);
    assert!(start.distances[0].over);
    assert_eq!(start.crosswind_kt, 18.0);
    assert!(start.crosswind_over);
    assert!(start.density_alt_ft > start.pressure_alt_ft);
    assert!(!end.distances[0].over);
    assert!(!end.crosswind_over);
}

fn picked_field() -> Vec<Field> {
    let mut f = standard();
    f[1].runways = vec![
        Runway { ends: ends("09", 0.0, "27", 180.0), ..runway(9000.0, 10.0, 3.0) },
        Runway { ends: ends("18", 0.0, "36", 180.0), wind: Some(wind("36", 8.0, 0.0, None)), ..runway(1200.0, 8.0, 0.0) },
    ];
    f
}

#[test]
fn checks_the_runway_the_pilot_picked_whatever_the_wind_with_the_wind_on_the_end_picked() {
    let a = airplane();
    let into = &runways::runway_checks(&a, true, &picked_field(), Some(2550.0), Some(2400.0), None)[1];
    assert_eq!((into.end.as_deref(), into.picked, into.distances[0].over), (Some("27"), false, false));
    let picks = Picks { pattern: vec![(s("KDLH"), s("18"))], takeoff: vec![] };
    let flown = &runways::runway_checks(&a, true, &picked_field(), Some(2550.0), Some(2400.0), Some(&picks))[1];
    // 18 is the far end of the wind's 36: its headwind is a tailwind.
    assert_eq!((flown.end.as_deref(), flown.picked, flown.headwind_kt, flown.runway), (Some("18"), true, -8.0, Some(1)));
    assert!(flown.distances[0].over);
}

#[test]
fn is_not_worked_out_without_the_pohs_tables() {
    let no_takeoff = Airplane { takeoff: None, ..airplane() };
    assert!(runways::runway_checks(&no_takeoff, true, &standard(), Some(2550.0), Some(2400.0), None).is_empty());
    assert!(runways::runway_checks(&airplane(), false, &standard(), Some(2550.0), Some(2400.0), None).is_empty());
}

#[test]
fn a_variable_wind_with_no_runway_component_is_all_crosswind_gusts_included() {
    // runwayCheck.ts (AIM 7-1-28): a VRB wind gives the runways no
    // components, and all of it, gusts included, may be across -- past the
    // 172's demonstrated 15 kt, the Runways caution. The Python gave 0.
    let vrb = Report { temp_c: Some(15.0), altimeter_in_hg: Some(29.92), wind_dir_true_deg: None, wind_speed_kt: Some(12.0), wind_gust_kt: Some(22.0) };
    let calm_runway = Runway { wind: None, ..runway(5000.0, 0.0, 0.0) };
    let f = fields(vec![calm_runway.clone()], vec![runway(9000.0, 10.0, 3.0)], Some(vrb));
    let start = &runways::runway_checks(&airplane(), true, &f, Some(2550.0), Some(2400.0), None)[0];
    assert_eq!((start.crosswind_kt, start.crosswind_over, start.headwind_kt), (22.0, true, 0.0));
    // A wind with a direction, which gives the runways components, or none
    // at all, is not.
    let steady = Report { wind_dir_true_deg: Some(270.0), ..vrb };
    let f = fields(vec![calm_runway.clone()], vec![], Some(steady));
    assert_eq!(runways::runway_checks(&airplane(), true, &f, Some(2550.0), Some(2400.0), None)[0].crosswind_kt, 0.0);
    let calm = Report { wind_speed_kt: Some(0.0), wind_gust_kt: None, ..vrb };
    let f = fields(vec![calm_runway], vec![], Some(calm));
    assert_eq!(runways::runway_checks(&airplane(), true, &f, Some(2550.0), Some(2400.0), None)[0].crosswind_kt, 0.0);
}

fn flown_runway(pairs: &[(&str, f64)], length: f64, w: Option<RunwayWind>, closed: bool) -> Runway {
    Runway {
        surface: Some(s("ASP")), length_ft: Some(length), closed,
        ends: pairs.iter().map(|(i, h)| End { ident: s(i), heading_true_deg: Some(*h) }).collect(), wind: w,
    }
}

fn field() -> Vec<Runway> {
    vec![
        flown_runway(&[("09", 90.0), ("27", 270.0)], 6000.0, Some(wind("27", 12.0, 1.0, None)), false),
        flown_runway(&[("18", 180.0), ("36", 360.0)], 2400.0, Some(wind("36", 0.0, -12.0, None)), false),
    ]
}

#[test]
fn runway_flown_the_pilots_pick_where_they_made_one_even_off_the_wind() {
    assert_eq!(runways::runway_flown(&field(), Some("36")), Some((1, 1, true)));
}

#[test]
fn runway_flown_else_the_runway_most_nearly_into_the_wind() {
    assert_eq!(runways::runway_flown(&field(), None), Some((0, 1, true)));
    assert_eq!(runways::runway_flown(&field(), Some("NONE")).map(|f| (f.0, f.1)), Some((0, 1)));
}

#[test]
fn a_pick_on_a_closed_runway_or_one_the_field_doesnt_have_falls_back_to_the_winds() {
    let closed = vec![field().remove(0), flown_runway(&[("18", 180.0), ("36", 360.0)], 2400.0, None, true)];
    assert_eq!(runways::runway_flown(&closed, Some("36")).map(|f| (f.0, f.1)), Some((0, 1)));
    assert_eq!(runways::runway_flown(&field(), Some("4")).map(|f| (f.0, f.1)), Some((0, 1)));
}

fn picks() -> Picks {
    Picks {
        pattern: vec![(s("C81"), s("24")), (s("UES"), s("10")), (s("KDLH"), s("NONE"))],
        takeoff: vec![(s("UES"), s("28"))],
    }
}

#[test]
fn picked_end_the_departures_runway_out_and_every_fields_runway_in_from_pattern_a_stops_runway_out_from_takeoff() {
    let p = picks();
    assert_eq!(runways::picked_end(Some(&p), "C81", true, true), Some("24"));
    assert_eq!(runways::picked_end(Some(&p), "UES", false, false), Some("10"));
    assert_eq!(runways::picked_end(Some(&p), "UES", true, false), Some("28"));
}

#[test]
fn picked_end_by_the_fields_icao_or_faa_ident_alike_none_for_no_pick_or_the_pilots_none() {
    let p = picks();
    assert_eq!(runways::picked_end(Some(&p), "KUES", false, false), Some("10"));
    assert_eq!(runways::picked_end(Some(&p), "KDLH", false, false), None);
    assert_eq!(runways::picked_end(Some(&p), "KMSN", false, false), None);
    assert_eq!(runways::picked_end(None, "C81", true, true), None);
}

#[test]
fn a_pick_is_matched_to_its_field_as_lib_procedures_same_field_matches() {
    // Trimmed, upper-cased, and a K taken off only before three letters or
    // figures. The Python took the K off before upper-casing and without
    // trimming, so "kues" and " KUES " missed, and took it off "K-1A".
    let p = Picks { pattern: vec![(s(" kues "), s("10")), (s("K-1A"), s("5"))], takeoff: vec![] };
    assert_eq!(runways::picked_end(Some(&p), "UES", false, false), Some("10"));
    assert_eq!(runways::picked_end(Some(&p), "kues", false, false), Some("10"));
    assert_eq!(runways::picked_end(Some(&p), "-1A", false, false), None);
    assert_eq!(runways::picked_end(Some(&p), "K-1A", false, false), Some("5"));
    assert_eq!(runways::bare_ident(" kdlh"), "DLH");
    assert_eq!(runways::bare_ident("KX1"), "KX1");
}

// --- pass times -------------------------------------------------------------

const LEGS: [(f64, Option<f64>); 2] = [(50.0, Some(30.0)), (100.0, Some(50.0))];

/// Microseconds since 1970 of a UTC time on a day of October 2026 (or
/// January 2027 with `month` 1).
fn utc(year: i64, month: u32, day: u32, hour: i64, minute: i64) -> i64 {
    let days = wingtip_engine::time::days_from_civil(year, month, day);
    ((days * 24 + hour) * 60 + minute) * 60_000_000
}

#[test]
fn the_departure_plus_the_legs_times_the_leg_it_is_in_pro_rata() {
    assert_eq!(pass_times::pass_minutes(&LEGS, 25.0), Some(15.0));
    assert_eq!(pass_times::pass_minutes(&LEGS, 100.0), Some(55.0));
    // Past the end, the arrival.
    assert_eq!(pass_times::pass_minutes(&LEGS, 400.0), Some(80.0));
    assert_eq!(pass_times::pass_minutes(&[], 10.0), None);
    assert_eq!(pass_times::pass_minutes(&[(50.0, None)], 10.0), None);
}

#[test]
fn a_tfrs_window_against_the_pass_half_an_hour_either_side() {
    let (from, to) = (Some(utc(2026, 10, 6, 16, 0)), Some(utc(2026, 10, 6, 18, 0)));
    assert_eq!(pass_times::tfr_when(utc(2026, 10, 6, 15, 0), from, to), "before");
    assert_eq!(pass_times::tfr_when(utc(2026, 10, 6, 15, 45), from, to), "in-force");
    assert_eq!(pass_times::tfr_when(utc(2026, 10, 6, 19, 0), from, to), "after");
    assert_eq!(pass_times::tfr_when(utc(2026, 10, 6, 19, 0), None, None), "in-force");
    // The margin's edges are inside.
    assert_eq!(pass_times::tfr_when(utc(2026, 10, 6, 15, 30), from, to), "in-force");
    assert_eq!(pass_times::tfr_when(utc(2026, 10, 6, 18, 30), from, to), "in-force");
}

/// Tuesday 6 October 2026, 14:20Z.
const TUESDAY_1420Z: (u32, u32) = (2, 14 * 60 + 20);

#[test]
fn a_special_use_areas_published_times_of_use() {
    let at = |t: &str, utc: (u32, u32)| pass_times::sua_when(Some(t), utc, None);
    assert_eq!(at("CONTINUOUS", TUESDAY_1420Z), "active");
    assert_eq!(at("INTERMITTENT BY NOTAM 4 HOURS IN ADVANCE", TUESDAY_1420Z), "by-notam");
    assert_eq!(at("1400 - 2200Z, MON - FRI", TUESDAY_1420Z), "active");
    assert_eq!(at("1500 - 2200Z, MON - FRI; OTHER TIMES BY NOTAM", TUESDAY_1420Z), "by-notam");
    assert_eq!(at("1400 - 2200Z, SAT - SUN", TUESDAY_1420Z), "not-scheduled");
    // Tuesday 02:00Z.
    assert_eq!(at("2200 - 0600Z", (2, 120)), "active");
    assert_eq!(at("SR - SS", TUESDAY_1420Z), "unknown");
    assert_eq!(pass_times::sua_when(None, TUESDAY_1420Z, None), "unknown");
    assert_eq!(at("H24", TUESDAY_1420Z), "active");
    assert_eq!(at("BH24", TUESDAY_1420Z), "unknown");
}

#[test]
fn local_hours_are_read_on_the_areas_own_clock() {
    // The clocks the caller works out: 14:20Z on Tuesday 6 October 2026 is
    // 08:20 MDT in Denver and 07:20 MST in Phoenix.
    let hours = Some("0800 - 1700, MON - FRI; OTHER TIMES BY NOTAM");
    assert_eq!(pass_times::sua_when(hours, TUESDAY_1420Z, Some((2, 8 * 60 + 20))), "active");
    assert_eq!(pass_times::sua_when(hours, TUESDAY_1420Z, Some((2, 7 * 60 + 20))), "by-notam");
    assert_eq!(pass_times::sua_when(Some("0700 - 0800 MST, MON - FRI"), TUESDAY_1420Z, Some((2, 7 * 60 + 20))), "active");
    // Hawaii's 17:00 on Monday is Tuesday 03:00Z.
    assert_eq!(pass_times::sua_when(Some("0800 - 1800, MON"), (2, 180), Some((1, 17 * 60))), "active");
    // No zone for the area: its local hours are not guessed at; UTC ranges need none.
    assert_eq!(pass_times::sua_when(hours, TUESDAY_1420Z, None), "unknown");
    assert_eq!(pass_times::sua_when(Some("1400 - 2200Z, MON - FRI"), TUESDAY_1420Z, None), "active");
}

#[test]
fn every_range_is_read_each_with_its_own_clauses_days() {
    // Saturday 3 October 2026, 11:00 CDT (16:00Z).
    let (z, local) = ((6, 16 * 60), Some((6, 11 * 60)));
    let at = |t: &str| pass_times::sua_when(Some(t), z, local);
    assert_eq!(at("0800 - 1600, MON - FRI; 1000 - 1400, SAT; OTHER TIMES BY NOTAM"), "active");
    assert_eq!(at("0800 - 1600, MON - FRI; OTHER TIMES BY NOTAM"), "by-notam");
    assert_eq!(at("0600 - 0900, 1030 - 1200, MON - SAT, BY NOTAM 2 HOURS IN ADVANCE; %1300 - 1500, FRI"), "active");
    assert_eq!(at("0700 - 0900, MON - FRI; OTHER TIMES BY NOTAM BETWEEN 0600 - 2200"), "by-notam");
    // A range past midnight belongs to the day it began: Saturday 01:00 CDT.
    let late = |t: &str| pass_times::sua_when(Some(t), (6, 6 * 60), Some((6, 60)));
    assert_eq!(late("2300 - 0200, FRI"), "active");
    assert_eq!(late("2300 - 0200, SAT"), "not-scheduled");
    assert_eq!(at("0700 - 1600, DAILY"), "active");
    assert_eq!(at("0700 - 1600, SUN - TUE"), "not-scheduled");
    assert_eq!(at("0700 - 1600, FRI - SUN"), "active");
    assert_eq!(at("0700 - 1600 MONDAY"), "active");
}

// --- by name (crate::call) ----------------------------------------------------

fn call(name: &str, input: &str) -> Value {
    serde_json::from_str(&wingtip_engine::call::call(name, input).unwrap()).unwrap()
}

#[test]
fn every_rule_answers_by_name_from_the_planners_and_the_webs_own_objects() {
    let quiet = r#"{"weather": {"pending": false, "failed": null, "vfr_not_recommended": [], "under_minimums": [], "hazards": [], "unchecked": [], "worst": "3,500 ft · 6 sm"},
        "airspace": {"pending": false, "unchecked": false, "in_force": [], "near": 0, "special_use": []},
        "altitude": {"pending": false, "problem": null, "cautions": [], "flown": "FL-055 · Lowest"},
        "fuel": {"pending": false, "margin_gal": 12.4, "required_gal": 27.6, "reserve_min": 30},
        "runways": {"pending": false, "worked": true, "short": [], "crosswind": []},
        "balance": {"pending": false, "worked": true, "problems": [], "takeoff": "2,407 lb at 41.2 in"},
        "risk": {"level": "low", "line": "Low · 2 points"}}"#;
    let items = call("gonogo_verdict_items", quiet);
    assert_eq!(items[3]["detail"], "Needs 27.6 gal with taxi and a 30 min reserve; 12.4 gal spare");
    let whole = call("gonogo_verdict", &format!(r#"{{"verdict": {quiet}, "alternate": {{"destination": {{"required": true}}, "alternate": null}}}}"#));
    assert_eq!(whole["line"]["finding"], "caution");
    assert_eq!(whole["items"][0]["section"], "Alternate");
    // An alternate with no `good` at all says nothing; one with good null
    // is the pilot's to check (useAlternate's `=== null`).
    assert!(call("gonogo_alternate_finding", r#"{"data": {"destination": {"required": true}, "alternate": {"ident": "KMSN", "reasons": []}}}"#).is_null());
    assert_eq!(call("gonogo_alternate_finding", r#"{"data": {"destination": {"required": true}, "alternate": {"ident": "KMSN", "good": null, "reasons": []}}}"#)["detail"],
               "KMSN: check it");
    let under = call("gonogo_under_minimums", r#"{"minimums": {"crosswind_kt": 15}, "landings": ["C81"], "dest": "KDLH",
        "metars": {"C81": {"wind_speed_kt": 15, "wind_gust_kt": 25}}, "airports": {"C81": {"runways": [{"closed": false, "wind": null}]}},
        "forecast": {"stations": []}}"#);
    assert_eq!(under[0], "C81 variable wind 25 kt, which may all be crosswind, over your 15 kt");
    let risk = call("gonogo_risk", r#"{"day": "2026-10-05", "night": true, "hazards": 1, "ticked": {"pressure": true}, "ifr": true, "vor_check": null}"#);
    assert_eq!((risk["score"].as_i64(), risk["line"].as_str()), (Some(10), Some("Raised · 10 points")));
    assert_eq!(risk["factors"][2]["key"], "vor");
    assert!(risk["factors"][3]["finding"].is_null());
    let none = call("gonogo_risk", r#"{"day": "2026-10-05", "ifr": true}"#);
    assert_eq!(none["factors"].as_array().unwrap().len(), 0);
    let icing = call("gonogo_icing", r#"{"selection": {"freezing_level_ft": 5000, "icing_possible": true}, "flown_ft": [6000], "pireps": [{"icing": "MOD"}]}"#);
    assert_eq!(icing["reports"], 1);
    assert_eq!(call("gonogo_picked_end", r#"{"picks": {"pattern": [[" kues", "10"]]}, "ident": "UES", "kind": "landing", "departure": false}"#), "10");
    assert_eq!(call("gonogo_sua_when", r#"{"times_of_use": "1400 - 2200Z, MON - FRI", "utc": [2, 860]}"#), "active");
    assert_eq!(call("gonogo_tfr_when", r#"{"at_us": 0, "effective_us": 3600000000}"#), "before");
    assert_eq!(call("gonogo_pass_minutes", r#"{"legs": [{"distance_nm": 50, "ete_min": 30}, {"distance_nm": 100, "ete_min": 50}], "along_nm": 100}"#), 55.0);
    assert_eq!(call("gonogo_runway_number", r#"{"ident": "09"}"#), "9");
    assert_eq!(call("gonogo_soft_surface", r#"{"surface": "TURF"}"#), true);
    let c172 = c172();
    let checks = call("gonogo_runway_checks", &serde_json::json!({
        "aircraft": {"takeoff": c172["takeoff"], "landing": c172["landing"], "crosswind": c172["crosswind"]},
        "fields": [{"ident": "C81", "elevation_ft": 900}, {"ident": "KDLH", "elevation_ft": 1400}],
        "metars": {"C81": {"temp_c": 15, "altimeter_in_hg": 29.92, "wind_dir_true_deg": null, "wind_speed_kt": 12, "wind_gust_kt": 22}, "KDLH": {}},
        "airports": {"C81": {"runways": [{"length_ft": 5000, "surface": "ASP", "closed": false, "runway_ends": [], "wind": null}]}},
        "takeoff_lb": 2550, "landing_lb": 2400,
    }).to_string());
    assert_eq!((checks[0]["crosswind_kt"].as_f64(), checks[0]["crosswind_over"].as_bool()), (Some(22.0), Some(true)));
    // An empty report is a report, as the web reads it.
    assert_eq!(checks[1]["reported"], true);
    let b = call("gonogo_balance", &serde_json::json!({
        "loading": c172["loading"], "load": {"empty_weight_lb": 1642, "empty_arm_in": 38.1, "stations_lb": [170, 400, 120, 50], "fuel_gal": 53},
        "trip_fuel_gal": 10,
    }).to_string());
    assert!(b["problems"].as_array().unwrap().iter().any(|p| p == "The takeoff weight, 2,692 lb, is 142 lb over its most"));
    assert_eq!(call("gonogo_default_load", &serde_json::json!({"loading": c172["loading"], "fuel_gal": 40}).to_string())["empty_arm_in"], 38.12);
}

#[test]
fn a_bad_ask_is_an_error_not_a_panic() {
    let err = |name: &str, input: &str| wingtip_engine::call::call(name, input).unwrap_err();
    assert!(err("gonogo_verdict_items", "{}").contains("\"weather\" is missing"));
    assert!(err("gonogo_risk", r#"{"day": 5}"#).contains("not a string"));
    assert!(err("gonogo_short_field", r#"{"table": {"pressure_altitudes_ft": [0], "temperatures_c": [0], "weights_lb": [], "tables": [], "grass_ground_roll_pct": 0}, "pressure_alt_ft": 0, "temp_c": 0, "weight_lb": 0, "headwind_kt": 0}"#)
        .contains("not a short-field table"));
    assert!(err("gonogo_sua_when", r#"{"utc": [9, 0]}"#).contains("day 0-6"));
    assert!(err("gonogo_nope", "{}").contains("no rule called"));
}

// --- what the runway check does not know (the aviation audit, 2026-11-06) --

#[test]
fn a_field_with_no_elevation_is_not_checked_rather_than_taken_as_sea_level() {
    // 14 CFR 91.103(b): the distances at the field. Taken as sea level a
    // high field's come out short; with no elevation they are not worked
    // out, and the check says why.
    let mut f = standard();
    f[0].elevation_ft = None;
    f[0].runways = vec![runway(9000.0, 0.0, 0.0)];
    let checks = runways::runway_checks(&airplane(), true, &f, Some(2550.0), Some(2400.0), None);
    let start = &checks[0];
    assert!(start.distances.is_empty());
    assert_eq!((start.unchecked, start.pressure_alt_ft, start.density_alt_ft), (Some(runways::NO_ELEVATION), None, None));
    // The temperature reported is still said.
    assert_eq!(start.temp_c, Some(30.0));
    // The destination, whose elevation is known, is checked as before.
    assert_eq!((checks[1].unchecked, checks[1].distances.len()), (None, 1));
    // The other side: with an elevation it is worked out, and the higher
    // the field the longer the takeoff -- what sea level would hide.
    f[0].elevation_ft = Some(0.0);
    let low = runways::runway_checks(&airplane(), true, &f, Some(2550.0), Some(2400.0), None)[0].distances[0].distances.total_ft;
    f[0].elevation_ft = Some(5000.0);
    let high = &runways::runway_checks(&airplane(), true, &f, Some(2550.0), Some(2400.0), None)[0];
    assert_eq!(high.unchecked, None);
    assert!(high.distances[0].distances.total_ft > low * 1.5, "{} against {low}", high.distances[0].distances.total_ft);
    let json = runways::checks_json(&runways::runway_checks(&airplane(), true, &standard(), Some(2550.0), Some(2400.0), None));
    assert!(json.contains("\"unchecked\":null") && json.contains("\"unknown\":false,\"beyond\":"));
}

#[test]
fn an_airplane_over_the_heaviest_table_or_a_field_past_the_highest_is_a_caveat_and_beyond() {
    let t = airplane().takeoff.unwrap();
    // At the heaviest table's weight, nothing to say; a pound over, said.
    assert!(runways::short_field(&t, 0.0, 15.0, 2550.0, 0.0, false).caveats.is_empty());
    let heavy = runways::short_field(&t, 0.0, 15.0, 2551.0, 0.0, false);
    assert_eq!(heavy.caveats, ["the airplane is heavier than the table's heaviest weight"]);
    assert!(heavy.beyond());
    // The table goes to 8,000 ft pressure altitude.
    assert!(!runways::short_field(&t, 8000.0, 15.0, 2550.0, 0.0, false).beyond());
    assert!(runways::short_field(&t, 8001.0, 15.0, 2550.0, 0.0, false).beyond());
    // In the check, the end is marked beyond.
    let mut f = standard();
    f[0].runways = vec![runway(9000.0, 0.0, 0.0)];
    let heavy = &runways::runway_checks(&airplane(), true, &f, Some(2700.0), Some(2400.0), None)[0].distances[0];
    assert!(heavy.beyond && !heavy.over);
    let within = &runways::runway_checks(&airplane(), true, &f, Some(2550.0), Some(2400.0), None)[0].distances[0];
    assert!(!within.beyond);
}

#[test]
fn a_runway_of_no_known_length_is_unknown_never_within() {
    let mut f = standard();
    f[0].runways = vec![Runway { length_ft: None, ..runway(0.0, 0.0, 0.0) }];
    let d = &runways::runway_checks(&airplane(), true, &f, Some(2550.0), Some(2400.0), None)[0].distances[0];
    assert!(d.unknown && !d.over);
    f[0].runways = vec![runway(9000.0, 0.0, 0.0)];
    assert!(!runways::runway_checks(&airplane(), true, &f, Some(2550.0), Some(2400.0), None)[0].distances[0].unknown);
}

#[test]
fn the_runways_finding_is_a_caution_past_the_tables_and_unknown_where_not_checked() {
    let mut v = quiet();
    v.runways.beyond = strings(&["KLXV"]);
    let item = finding(&v, "runways");
    assert_eq!((item.finding.as_str(), item.detail.as_str()), ("caution", "Past the POH's tables at KLXV: its distances will be longer"));
    v.runways.crosswind = strings(&["C81"]);
    assert_eq!(finding(&v, "runways").detail,
               "Crosswind past the POH's demonstrated at C81; Past the POH's tables at KLXV: its distances will be longer");
    let mut v = quiet();
    v.runways.unchecked = strings(&["C81"]);
    let item = finding(&v, "runways");
    assert_eq!((item.finding.as_str(), item.detail.as_str()), ("unknown", "Not checked at C81: runway length or field elevation not known"));
    // A short runway is still the stop it was.
    v.runways.short = strings(&["KDLH"]);
    assert_eq!(finding(&v, "runways").finding, "stop");
    // And with none of them, within.
    assert_eq!(finding(&quiet(), "runways").detail, "Takeoff and landing within each runway");
}

fn verdict_call(input: Value) -> Vec<Value> {
    let out = wingtip_engine::call::call("gonogo_verdict_items", &input.to_string()).unwrap();
    serde_json::from_str::<Value>(&out).unwrap().as_array().unwrap().clone()
}

fn found(items: &[Value], key: &str) -> (String, String) {
    let i = items.iter().find(|i| i["key"] == key).unwrap();
    (i["finding"].as_str().unwrap().to_owned(), i["detail"].as_str().unwrap().to_owned())
}

/// The quiet day as the web and the planner send it, every list there.
fn sent() -> Value {
    serde_json::json!({
        "weather": {"pending": false, "failed": null, "vfr_not_recommended": [], "under_minimums": [], "icing": null, "hazards": [],
                    "unchecked": [], "worst": null},
        "airspace": {"pending": false, "unchecked": false, "in_force": [], "near": 0, "special_use": []},
        "altitude": {"pending": false, "problem": null, "cautions": [], "flown": "FL055"},
        "fuel": {"pending": false, "margin_gal": 12.4, "required_gal": 27.6, "reserve_min": 30, "ifr": false},
        "runways": {"pending": false, "worked": true, "short": [], "crosswind": []},
        "balance": {"pending": false, "worked": true, "problems": [], "takeoff": null},
        "risk": {"level": "low", "line": "Low"},
    })
}

#[test]
fn a_section_sent_empty_is_unknown_as_the_fuel_is_never_clear() {
    // As the shells send it, every row is ok.
    let items = verdict_call(sent());
    assert!(items.iter().all(|i| i["finding"] == "ok"), "{items:?}");
    for key in ["weather", "airspace", "altitude", "runways"] {
        let mut v = sent();
        v[key] = serde_json::json!({});
        let items = verdict_call(v);
        // The runways' says why in its own words: nothing worked out.
        let (finding, detail) = found(&items, key);
        assert_eq!(finding, "unknown", "{key}");
        assert!(detail.starts_with("Not worked out"), "{key}: {detail}");
    }
    // Still waiting is still pending, not unknown.
    let mut v = sent();
    v["weather"] = serde_json::json!({"pending": true});
    assert_eq!(found(&verdict_call(v), "weather").0, "pending");
    // The fuel, as before: no margin, unknown.
    let mut v = sent();
    v["fuel"] = serde_json::json!({});
    assert_eq!(found(&verdict_call(v), "fuel").0, "unknown");
}
