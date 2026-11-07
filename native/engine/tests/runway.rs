//! Runways, the wind on them and the traffic pattern (wingtip_engine::runway),
//! held to every case the web's tests hold lib/wind, lib/pattern,
//! lib/runwayFit, lib/takeoffLanding and lib/trafficPattern to
//! (wind.test.ts, windPick.test.ts, runwayFlown.test.ts,
//! runwayFit.test.ts, trafficPattern.test.ts, weightBalance.test.ts), and
//! the planner's tests hold wingtip.runway_wind and wingtip.pattern to
//! (tests/test_runway_wind*.py, test_pattern.py), asked as the hosts ask
//! them: by name, JSON in and out.

use serde_json::{json, Value};
use std::path::PathBuf;
use wingtip_engine::call::call;
use wingtip_engine::runway::{circuit, pick, wind};

fn ask(name: &str, input: Value) -> Value {
    let out = call(name, &input.to_string()).unwrap_or_else(|e| panic!("{name}: {e}"));
    serde_json::from_str(&out).unwrap_or_else(|e| panic!("{name} answered {out}: {e}"))
}

fn num(v: &Value) -> f64 {
    v.as_f64().unwrap_or_else(|| panic!("{v} is not a number"))
}

fn near(a: f64, b: f64, within: f64) -> bool {
    (a - b).abs() <= within
}

/// A runway of two ends at their true headings, as the planner sends one.
fn runway(ends: &[(&str, f64)], length_ft: f64, wind: Value) -> Value {
    json!({
        "closed": false, "length_ft": length_ft, "surface": "ASP",
        "runway_ends": ends.iter().map(|(i, h)| json!({"ident": i, "heading_true_deg": h, "traffic": "left"})).collect::<Vec<_>>(),
        "wind": wind,
    })
}

fn c81() -> Value {
    json!([runway(&[("06", 58.0), ("24", 238.0)], 3573.0, Value::Null), runway(&[("09", 88.0), ("27", 268.0)], 3270.0, Value::Null)])
}

fn kdlh() -> Value {
    json!([
        runway(&[("03", 31.0), ("21", 211.0)], 5719.0, json!({"end": "21", "headwind_kt": 7, "crosswind_kt": -1, "gust_crosswind_kt": null})),
        runway(&[("09", 91.0), ("27", 271.0)], 10591.0, json!({"end": "27", "headwind_kt": 2, "crosswind_kt": -7, "gust_crosswind_kt": null})),
    ])
}

// --- wind (wind.test.ts) ----------------------------------------------------

#[test]
fn a_wind_splits_along_and_across_a_tailwind_negative_and_a_crosswind_from_the_right_positive() {
    // 300° at 20 kt on runway 27 (270° true): 30° off, 17.3 along, 10 across.
    let c = ask("wind_components", json!({"from_deg": 300, "kt": 20, "heading_deg": 270}));
    assert!(near(num(&c["headwind_kt"]), 17.32, 0.005));
    assert!(near(num(&c["crosswind_kt"]), 10.0, 1e-6));
    assert!(near(wind::crosswind_kt(240.0, 20.0, 270.0), -10.0, 1e-6));
    assert!(near(wind::headwind_kt(90.0, 12.0, 270.0), -12.0, 1e-6));
    // Across the 360/0 seam: 010° on 350° is 20° from the right.
    assert!(near(wind::crosswind_kt(10.0, 10.0, 350.0), 3.42, 0.005));
}

#[test]
fn a_crosswind_is_judged_by_the_steady_one_or_the_gusts_whichever_is_more() {
    assert_eq!(ask("wind_steady_or_gust", json!({"steady_kt": -6, "gust_kt": 9})), json!(9.0));
    assert_eq!(ask("wind_steady_or_gust", json!({"steady_kt": 12, "gust_kt": null})), json!(12.0));
    assert_eq!(ask("wind_steady_or_gust", json!({"steady_kt": -12, "gust_kt": -8})), json!(12.0));
    assert_eq!(ask("runway_crosswind", json!({"wind": {"crosswind_kt": -4, "gust_crosswind_kt": -11}})), json!(11.0));
}

#[test]
fn calm_is_a_speed_of_nothing_and_a_wind_not_reported_is_not_calm() {
    assert_eq!(ask("wind_calm", json!({"speed_kt": 0})), json!(true));
    assert_eq!(ask("wind_calm", json!({"speed_kt": 3})), json!(false));
    assert_eq!(ask("wind_calm", json!({"speed_kt": null})), json!(false));
    assert_eq!(ask("wind_calm", json!({})), json!(false));
    let calm = |w: Value| ask("runway_calm", json!({"wind": w}));
    assert_eq!(calm(json!({"end": "18", "headwind_kt": 0, "crosswind_kt": 0, "gust_crosswind_kt": null})), json!(true));
    // 1 kt straight across: not calm.
    assert_eq!(calm(json!({"end": "18", "headwind_kt": 0, "crosswind_kt": 1, "gust_crosswind_kt": null})), json!(false));
}

// --- the favoured end (test_runway_wind.py) -------------------------------

fn nine_27() -> Value {
    json!([["9", 88.0], ["27", 268.0]])
}

fn favoured(ends: Value, metar: Value, variation: f64, recent: Value) -> Value {
    ask("runway_favoured_end", json!({"ends": ends, "metar": metar, "variation_deg": variation, "recent": recent}))
}

#[test]
fn the_end_into_the_wind_is_favoured_its_crosswind_signed_and_rounded_as_the_planner_rounds() {
    // 300 at 12 on 27 (268 true): 32 degrees off the nose, from the right.
    let w = favoured(nine_27(), json!({"wind_dir_true_deg": 300.0, "wind_speed_kt": 12.0}), -3.0, Value::Null);
    assert_eq!(w, json!({"end": "27", "headwind_kt": 10, "crosswind_kt": 6, "gust_crosswind_kt": null}));
    // Whole numbers, as the planner's Python gives them.
    let raw = call("runway_favoured_end", &json!({"ends": nine_27(), "metar": {"wind_dir_true_deg": 300.0, "wind_speed_kt": 12.0},
                                                   "variation_deg": 0.0}).to_string()).unwrap();
    assert!(raw.contains("\"headwind_kt\":10,"), "{raw}");
    // 040 on 9 (088 true): from the left, and the gust its own.
    let w = favoured(nine_27(), json!({"wind_dir_true_deg": 40.0, "wind_speed_kt": 10.0, "wind_gust_kt": 20.0}), 0.0, Value::Null);
    assert_eq!((w["end"].as_str(), num(&w["crosswind_kt"]), num(&w["gust_crosswind_kt"])), (Some("9"), -7.0, -15.0));
}

#[test]
fn an_end_with_no_heading_takes_its_number_turned_true() {
    // Runway 18 at 3 degrees west: 177 true; a wind from 177 is all headwind.
    assert!(near(num(&ask("runway_end_heading", json!({"ident": "18L", "heading_true_deg": null, "variation_deg": -3.0}))), 177.0, 1e-9));
    assert_eq!(ask("runway_end_heading", json!({"ident": "H1", "variation_deg": 0.0})), Value::Null);
    assert_eq!(ask("runway_end_heading", json!({"ident": "09", "heading_true_deg": 361.5, "variation_deg": 0.0})), json!(1.5));
    let w = favoured(json!([["18L", null], ["36R", null]]), json!({"wind_dir_true_deg": 177.0, "wind_speed_kt": 8.0}), -3.0, Value::Null);
    assert_eq!(w, json!({"end": "18L", "headwind_kt": 8, "crosswind_kt": 0, "gust_crosswind_kt": null}));
}

#[test]
fn no_wind_without_a_report_a_direction_or_a_runway_heading() {
    assert_eq!(favoured(nine_27(), Value::Null, 0.0, Value::Null), Value::Null);
    assert_eq!(favoured(nine_27(), json!({}), 0.0, Value::Null), Value::Null);
    assert_eq!(favoured(nine_27(), json!({"wind_dir_true_deg": null, "wind_speed_kt": 4.0}), 0.0, Value::Null), Value::Null);
    assert_eq!(favoured(json!([["H1", null]]), json!({"wind_dir_true_deg": 300.0, "wind_speed_kt": 12.0}), 0.0, Value::Null), Value::Null);
}

#[test]
fn calm_is_nothing_on_the_first_end_or_on_the_one_the_last_wind_favoured() {
    let calm = json!({"wind_dir_true_deg": 0.0, "wind_speed_kt": 0.0});
    let raw = call("runway_favoured_end", &json!({"ends": nine_27(), "metar": calm, "variation_deg": 0.0}).to_string()).unwrap();
    assert_eq!(raw, r#"{"end":"9","headwind_kt":0.0,"crosswind_kt":0.0,"gust_crosswind_kt":null}"#);
    let w = favoured(nine_27(), calm.clone(), 0.0, json!({"wind_dir_true_deg": 270.0, "wind_speed_kt": 8.0}));
    assert_eq!(w, json!({"end": "27", "headwind_kt": 0.0, "crosswind_kt": 0.0, "gust_crosswind_kt": null, "in_use": true}));
    // with_winds: the one runway the last wind favoured is in use.
    let runways = json!([{"end_headings": [["6", 58.0], ["24", 238.0]]}, {"end_headings": [["9", 88.0], ["27", 268.0]]}]);
    let out = ask("runway_with_winds", json!({"runways": runways, "metar": calm, "variation_deg": -3.0,
                                               "recent": {"wind_dir_true_deg": 270.0, "wind_speed_kt": 8.0}}));
    assert_eq!(out[0].get("in_use"), None);
    assert_eq!(out[1]["in_use"], json!(true));
    assert_eq!(out[1]["end"], json!("27"));
}

// --- the runway in use and the pilot's pick (runwayFlown.test.ts, test_runway_wind_in_use.py)

fn field() -> Value {
    json!([
        runway(&[("09", 90.0), ("27", 270.0)], 6000.0, json!({"end": "27", "headwind_kt": 12, "crosswind_kt": 1, "gust_crosswind_kt": null})),
        runway(&[("18", 180.0), ("36", 360.0)], 2400.0, json!({"end": "36", "headwind_kt": 0, "crosswind_kt": -12, "gust_crosswind_kt": null})),
    ])
}

fn flown(runways: &Value, picked: Value) -> Option<(usize, String)> {
    let f = ask("gonogo_runway_flown", json!({"runways": runways, "picked": picked}));
    if f.is_null() {
        return None;
    }
    let (r, e) = (f["runway"].as_u64().unwrap() as usize, f["end"].as_u64().unwrap() as usize);
    Some((r, runways[r]["runway_ends"][e]["ident"].as_str().unwrap().to_owned()))
}

#[test]
fn the_runway_flown_is_the_pilots_pick_else_the_one_most_nearly_into_the_wind() {
    let f = field();
    assert_eq!(flown(&f, json!("36")), Some((1, "36".into())));
    assert_eq!(flown(&f, Value::Null), Some((0, "27".into())));
    assert_eq!(flown(&f, json!("NONE")), Some((0, "27".into())));
    // A pick on a closed runway, or one the field doesn't have, falls back.
    let mut closed = f.clone();
    closed[1]["closed"] = json!(true);
    closed[1]["wind"] = Value::Null;
    assert_eq!(flown(&closed, json!("36")), Some((0, "27".into())));
    assert_eq!(flown(&f, json!("4")), Some((0, "27".into())));
}

#[test]
fn a_pick_is_found_by_the_fields_icao_or_faa_ident_alike() {
    let picks = json!({"pattern": [["C81", "24"], ["UES", "10"], ["KDLH", "NONE"]], "takeoff": [["UES", "28"]]});
    let picked = |ident: &str, kind: &str, departure: bool| {
        ask("gonogo_picked_end", json!({"picks": picks, "ident": ident, "kind": kind, "departure": departure}))
    };
    assert_eq!(picked("C81", "takeoff", true), json!("24"));
    assert_eq!(picked("UES", "landing", false), json!("10"));
    assert_eq!(picked("UES", "takeoff", false), json!("28"));
    assert_eq!(picked("KUES", "landing", false), json!("10"));
    assert_eq!(picked("KDLH", "landing", false), Value::Null);
    assert_eq!(picked("KMSN", "landing", false), Value::Null);
}

#[test]
fn calm_the_runway_in_use_then_the_paved_then_the_longer() {
    let kept = json!([
        runway(&[("06", 58.0), ("24", 238.0)], 3573.0, json!({"end": "06", "headwind_kt": 0, "crosswind_kt": 0})),
        runway(&[("09", 88.0), ("27", 268.0)], 3270.0, json!({"end": "27", "headwind_kt": 0, "crosswind_kt": 0, "in_use": true})),
    ]);
    assert_eq!(flown(&kept, Value::Null).unwrap().1, "27");
    let mut calm = json!([
        runway(&[("06", 58.0), ("24", 238.0)], 3573.0, json!({"end": "06", "headwind_kt": 0, "crosswind_kt": 0})),
        runway(&[("09", 88.0), ("27", 268.0)], 3270.0, json!({"end": "09", "headwind_kt": 0, "crosswind_kt": 0})),
    ]);
    calm[0]["surface"] = json!("COP");
    assert_eq!(flown(&calm, Value::Null).unwrap().1, "09");
    // A helipad is not one.
    let pad = json!([runway(&[("H1", f64::NAN)], 50.0, json!({"end": "H1", "headwind_kt": 5, "crosswind_kt": 0}))]);
    let mut pad = pad;
    pad[0]["runway_ends"][0]["heading_true_deg"] = Value::Null;
    assert_eq!(flown(&pad, Value::Null), None);
}

// --- windPick (windPick.test.ts, test_runway_wind_in_use.py) --------------

fn pick_of(runways: Value, nearby: Value, forecast_at: Value) -> Value {
    ask("wind_pick", json!({"runways": runways, "nearby": nearby, "forecast_at": forecast_at}))
}

#[test]
fn a_fields_own_report_as_the_planner_worked_it_out_on_each_runway() {
    let p = pick_of(kdlh(), json!({"station": "KDLH", "distance_nm": 0, "dir_true_deg": 0, "speed_kt": 30}), Value::Null);
    assert_eq!(p, json!({"ident": "21", "headwind_kt": 7.0, "crosswind_kt": -1.0, "gust_crosswind_kt": null, "calm": false, "from": null}));
}

#[test]
fn a_field_with_no_report_goes_by_the_nearest_reports_wind_said_as_that_stations() {
    // KUGN's 220° at 8 kt: 18° off 24, 48° off 27.
    let p = pick_of(c81(), json!({"station": "KUGN", "distance_nm": 11.1, "dir_true_deg": 220, "speed_kt": 8, "gust_kt": 15}), Value::Null);
    let r = |x: f64| x.round();
    assert_eq!(p, json!({
        "ident": "24", "headwind_kt": r(8.0 * 18f64.to_radians().cos()), "crosswind_kt": r(8.0 * (-18f64).to_radians().sin()),
        "gust_crosswind_kt": r(15.0 * (-18f64).to_radians().sin()), "calm": false, "from": {"ident": "KUGN", "nm": 11.0},
    }));
}

#[test]
fn calm_and_a_variable_wind_pick_the_runway_in_use_or_the_most_used_and_no_wind_picks_none() {
    let p = pick_of(c81(), json!({"station": "KUGN", "distance_nm": 11, "dir_true_deg": null, "speed_kt": 0}), Value::Null);
    assert_eq!((p["ident"].clone(), p["calm"].clone(), p["from"]["ident"].clone()), (json!("6"), json!(true), json!("KUGN")));
    let kept = json!([
        runway(&[("06", 58.0), ("24", 238.0)], 3573.0, json!({"end": "06", "headwind_kt": 0, "crosswind_kt": 0, "gust_crosswind_kt": null})),
        runway(&[("09", 88.0), ("27", 268.0)], 3270.0,
               json!({"end": "27", "headwind_kt": 0, "crosswind_kt": 0, "gust_crosswind_kt": null, "in_use": true})),
    ]);
    let p = pick_of(kept, Value::Null, Value::Null);
    assert_eq!((p["ident"].clone(), p["calm"].clone(), p["in_use"].clone()), (json!("27"), json!(true), json!(true)));
    // The paved runway, though a strip of another surface is listed longer.
    let mut paved = c81();
    paved[0]["surface"] = json!("COP");
    assert_eq!(pick_of(paved, json!({"station": "KUGN", "distance_nm": 11, "speed_kt": 0}), Value::Null)["ident"], json!("9"));
    let p = pick_of(c81(), json!({"station": "KUGN", "distance_nm": 11, "dir_true_deg": null, "speed_kt": 6}), Value::Null);
    assert_eq!((p["ident"].clone(), p["calm"].clone(), p["variable_kt"].clone()), (json!("6"), json!(true), json!(6.0)));
    assert_eq!(pick_of(c81(), Value::Null, Value::Null), Value::Null);
    assert_eq!(pick_of(c81(), json!({"station": "KRFD", "distance_nm": 2, "dir_true_deg": 90, "speed_kt": null}), Value::Null), Value::Null);
}

#[test]
fn a_forecasts_wind_is_picked_into_on_its_own_the_report_now_set_aside() {
    let at = 1_790_000_000.0;
    let p = pick_of(kdlh(), json!({"station": "KDLH", "distance_nm": 0, "dir_true_deg": 90, "speed_kt": 12}), json!(at));
    assert_eq!((p["ident"].clone(), num(&p["headwind_kt"]), p["from"].clone(), num(&p["forecast_at"])), (json!("9"), 12.0, Value::Null, at));
    let p = pick_of(c81(), json!({"station": "KRFD", "distance_nm": 21.4, "dir_true_deg": 270, "speed_kt": 10}), json!(at));
    assert_eq!((p["ident"].clone(), p["from"].clone()), (json!("27"), json!({"ident": "KRFD", "nm": 21.0})));
}

#[test]
fn ends_square_across_the_wind_are_a_tie_the_longer_runway_taking_it() {
    // A wind from 360 straight across 09/27 and its parallel: the sums leave
    // a tailwind of a few 1e-16 on one end, which is no reason to pick it
    // over the longer runway (wingtip.runway_wind rounds them to 9 places).
    let runways = json!([runway(&[("09", 90.0), ("27", 270.0)], 3000.0, Value::Null), runway(&[("09", 90.0), ("27", 270.0)], 5000.0, Value::Null)]);
    let mut runways = runways;
    runways[1]["runway_ends"] = json!([{"ident": "27", "heading_true_deg": 270.0}, {"ident": "09", "heading_true_deg": 90.0}]);
    let p = pick_of(runways, json!({"station": "KX", "distance_nm": 3, "dir_true_deg": 0, "speed_kt": 10}), json!(0));
    assert_eq!(p["ident"], json!("27"));
}

// --- the pattern's words and altitude (pattern.ts, test_pattern.py) -------

#[test]
fn a_pattern_is_flown_left_unless_the_faa_says_right() {
    assert_eq!(num(&ask("pattern_side", json!({"heading_true_deg": 90, "traffic": "left"}))), 0.0);
    assert_eq!(num(&ask("pattern_side", json!({"heading_true_deg": 90, "traffic": "right"}))), 180.0);
    assert_eq!(num(&ask("pattern_side", json!({"heading_true_deg": 30}))), 300.0);
    assert_eq!(ask("compass_word", json!({"bearing_deg": 225})), json!("southwest"));
    assert_eq!(ask("compass_word", json!({"bearing_deg": -10})), json!("north"));
    assert_eq!(pick::runway_number("09"), "9");
    assert_eq!(ask("runway_end_key", json!({"ident": " 09l "})), json!("9L"));
    assert_eq!(ask("faa_ids", json!({"ident": "KRFD"})), json!(["RFD", "KRFD"]));
    assert_eq!(ask("faa_ids", json!({"ident": "C81"})), json!(["C81"]));
}

#[test]
fn a_pattern_is_joined_on_the_45_from_its_side_and_over_midfield_from_the_other() {
    // Left traffic on 27: the downwind is south of the runway.
    let end = json!({"ident": "27", "heading_true_deg": 270, "traffic": "left"});
    let e = ask("pattern_entry", json!({"end": end, "course_deg": 0}));
    assert_eq!(e["from"], json!("south"));
    assert_eq!(e["pattern_side"], json!(true));
    assert_eq!(e["words"], json!("From the south, on the pattern's side: join the 45° to the left downwind for runway 27, abeam midfield at pattern altitude."));
    let e = ask("pattern_entry", json!({"end": end, "course_deg": 180}));
    assert_eq!(e["pattern_side"], json!(false));
    assert!(e["words"].as_str().unwrap().contains("cross midfield 500 ft above pattern altitude, descend to it well clear, and turn back"));
    assert_eq!(ask("pattern_exit", json!({"traffic": "right"})),
               json!("Straight out, or a 45° right turn once past the departure end at pattern altitude."));
}

#[test]
fn the_pattern_altitude_is_the_faas_where_published_and_1000_ft_above_the_field_where_not() {
    assert_eq!(ask("pattern_altitude", json!({"elevation_ft": 742.0, "published_agl_ft": 800.0})),
               json!({"agl_ft": 800.0, "altitude_ft": 1542, "published": true}));
    assert_eq!(ask("pattern_altitude", json!({"elevation_ft": 727.0})), json!({"agl_ft": 1000.0, "altitude_ft": 1727, "published": false}));
    assert_eq!(ask("pattern_altitude", json!({}))["altitude_ft"], Value::Null);
    // Halves to even, as the planner's round.
    assert_eq!(ask("pattern_altitude", json!({"elevation_ft": 812.5}))["altitude_ft"], json!(1812));
}

#[test]
fn an_end_is_right_traffic_only_where_the_faa_flags_it() {
    let ends = ask("runway_ends_traffic", json!({"end_headings": [["05", 50.0], ["23", null], ["H1", null]], "variation_deg": -3.0, "right": ["23"]}));
    assert_eq!(ends[0], json!({"ident": "05", "heading_true_deg": 50.0, "traffic": "left"}));
    assert_eq!(ends[1]["traffic"], json!("right"));
    assert!(near(num(&ends[1]["heading_true_deg"]), 227.0, 1e-9));
    assert_eq!(ends[2]["heading_true_deg"], Value::Null);
}

// --- the runway fit (runwayFit.test.ts) and short-field distances ---------

fn c172() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data/aircraft/c172.json");
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn fit(runway_ft: f64, surface: &str, wind: Value, extra: Value) -> Value {
    let mut input = json!({
        "aircraft": c172(), "runway": {"length_ft": runway_ft, "surface": surface, "closed": false, "runway_ends": []},
        "end": {"ident": "27", "heading_true_deg": 270}, "wind": wind, "elevation_ft": 900, "altimeter_in_hg": 29.92, "temp_c": 15,
        "weight_lb": 2550, "kind": "takeoff",
    });
    for (k, v) in extra.as_object().unwrap() {
        input[k] = v.clone();
    }
    ask("runway_end_fit", input)
}

#[test]
fn an_ends_crosswind_its_gusts_where_more_against_the_pohs_demonstrated_15_kt() {
    let f = fit(5000.0, "ASP", json!({"dir_true_deg": 360, "speed_kt": 12, "gust_kt": 20}), json!({}));
    assert_eq!((num(&f["crosswind_kt"]), f["crosswind_over"].clone()), (20.0, json!(true)));
    assert_eq!(num(&fit(5000.0, "ASP", json!({"dir_true_deg": 270, "speed_kt": 12}), json!({}))["crosswind_kt"]), 0.0);
    // A variable wind may blow straight across: all of it, gusts included.
    assert_eq!(num(&fit(5000.0, "ASP", json!({"dir_true_deg": null, "speed_kt": 15, "gust_kt": 25}), json!({}))["crosswind_kt"]), 25.0);
}

#[test]
fn a_runway_shorter_than_the_distance_over_50_ft_and_one_within_safo_19001s_15_per_cent() {
    let still = json!({"dir_true_deg": null, "speed_kt": 0});
    let needed = num(&fit(10000.0, "ASP", still.clone(), json!({}))["needed_ft"]);
    assert!(needed > 1000.0);
    assert_eq!(fit(needed - 1.0, "ASP", still.clone(), json!({}))["short"], json!(true));
    let close = fit((needed * 1.1).round(), "ASP", still.clone(), json!({}));
    assert_eq!((close["short"].clone(), close["close"].clone()), (json!(false), json!(true)));
    assert_eq!(fit(needed * 2.0, "ASP", still, json!({}))["close"], json!(false));
}

#[test]
fn the_fit_is_the_runway_checks_own_distance() {
    // 270 at 10 straight down 27, a grass runway, a warm low day.
    let f = fit(3000.0, "TURF", json!({"dir_true_deg": 270, "speed_kt": 10}), json!({"temp_c": 30, "altimeter_in_hg": 29.72}));
    let air = ask("gonogo_field_air", json!({"elevation_ft": 900, "altimeter_in_hg": 29.72, "temp_c": 30}));
    let d = ask("gonogo_end_distance", json!({"table": c172()["takeoff"], "runway": {"surface": "TURF", "length_ft": 3000},
                                               "pressure_alt_ft": air["pressure_alt_ft"], "temp_c": air["temp_c"], "weight_lb": 2550,
                                               "headwind_kt": 10}));
    assert_eq!(num(&f["needed_ft"]), num(&d["total_ft"]).round());
    // No weight known: the table's heaviest, the longest distance.
    let heaviest = fit(3000.0, "TURF", Value::Null, json!({"weight_lb": null}));
    let d = ask("gonogo_end_distance", json!({"table": c172()["takeoff"], "runway": {"surface": "TURF"}, "pressure_alt_ft": 900,
                                               "temp_c": 15, "weight_lb": null, "headwind_kt": 0}));
    assert_eq!(num(&heaviest["needed_ft"]), num(&d["total_ft"]));
    // No tables: nothing needed, and no demonstrated crosswind: never over.
    let none = fit(3000.0, "ASP", json!({"dir_true_deg": 360, "speed_kt": 30}), json!({"aircraft": {"crosswind": null}}));
    assert_eq!((none["needed_ft"].clone(), none["crosswind_over"].clone()), (Value::Null, json!(false)));
    assert_eq!(wingtip_engine::runway::performance::DISTANCE_MARGIN, 1.15);
}

#[test]
fn the_pohs_short_field_table_read_between_its_points_with_its_notes() {
    // weightBalance.test.ts's cases, the 172S's tables.
    let t = c172()["takeoff"].clone();
    let sf = |pa: f64, temp: f64, lb: f64, head: f64, grass: bool| {
        ask("gonogo_short_field", json!({"table": t, "pressure_alt_ft": pa, "temp_c": temp, "weight_lb": lb, "headwind_kt": head, "grass": grass}))
    };
    assert_eq!(sf(0.0, 15.0, 2550.0, 0.0, false), json!({"ground_roll_ft": 960.0, "total_ft": 1635.0, "caveats": []}));
    assert_eq!(num(&sf(0.0, 10.0, 2550.0, 9.0, false)["ground_roll_ft"]), 835.0);
    assert_eq!(num(&sf(0.0, 10.0, 2550.0, -2.0, false)["ground_roll_ft"]), 1020.0);
    let g = sf(0.0, 10.0, 2550.0, 0.0, true);
    assert_eq!((num(&g["ground_roll_ft"]), num(&g["total_ft"])), (1065.0, 1715.0));
    assert_eq!(num(&sf(0.0, 0.0, 2475.0, 0.0, false)["ground_roll_ft"]), 805.0);
}

// --- the traffic pattern's legs (trafficPattern.test.ts, test_pattern.py) ---

/// A runway 09/27 a mile long on the equator: 09 lands east, 27 west.
fn equator() -> Value {
    json!({"length_ft": 6076, "runway_ends": [
        {"ident": "09", "heading_true_deg": 90, "traffic": "left", "lat": 0, "lon": 0},
        {"ident": "27", "heading_true_deg": 270, "traffic": "right", "lat": 0, "lon": 1.0 / 60.0},
    ]})
}

fn pt(v: &Value) -> (f64, f64) {
    (num(&v["lat"]), num(&v["lon"]))
}

fn bearing(a: (f64, f64), b: (f64, f64)) -> f64 {
    wingtip_engine::geo::bearing_deg(a.0, a.1, b.0, b.1)
}

fn leg<'a>(p: &'a Value, name: &str) -> &'a Value {
    p["legs"].as_array().unwrap().iter().find(|l| l["name"] == name).unwrap()
}

#[test]
fn a_pattern_is_flown_on_its_ends_side_its_downwind_three_quarters_of_a_mile_out() {
    let left = ask("traffic_pattern", json!({"ident": "KTST", "runway": equator(), "end_ident": "09", "altitude_ft": 1800}));
    let down = leg(&left, "Downwind");
    assert!(num(&down["from"]["lat"]) > 0.0);
    assert_eq!(bearing(pt(&down["from"]), pt(&down["to"])).round(), 270.0);
    let right = ask("traffic_pattern", json!({"ident": "KTST", "runway": equator(), "end_ident": "27", "altitude_ft": 1800}));
    assert!(num(&leg(&right, "Downwind")["from"]["lat"]) > 0.0);
    assert!(near(wingtip_engine::geo::distance_nm(0.0, 0.0, num(&down["to"]["lat"]), 0.0), circuit::DOWNWIND_NM, 0.005));
    let base = leg(&left, "Base");
    assert!(near(wingtip_engine::geo::distance_nm(0.0, 0.0, 0.0, num(&base["from"]["lon"])), circuit::DOWNWIND_NM, 0.005));
    assert!(num(&base["from"]["lon"]) < 0.0);
    let names: Vec<&str> = left["legs"].as_array().unwrap().iter().map(|l| l["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["Upwind", "Crosswind", "Downwind", "Base", "Final"]);
    assert_eq!(left["legs"][4]["to"], json!({"lat": 0.0, "lon": 0.0}));
    assert_eq!((left["kind"].clone(), left["runway"].clone(), left["traffic"].clone(), left["altitude_ft"].clone()),
               (json!("arrival"), json!("9"), json!("left"), json!(1800.0)));
}

#[test]
fn a_pattern_is_joined_on_the_45_abeam_midfield_and_not_drawn_without_a_threshold() {
    let p = ask("traffic_pattern", json!({"ident": "KTST", "runway": equator(), "end_ident": "09", "altitude_ft": 1800}));
    assert!(near(num(&p["entry"]["to"]["lon"]), 1.0 / 120.0, 0.0005));
    assert_eq!(bearing(pt(&p["entry"]["from"]), pt(&p["entry"]["to"])).round(), 225.0);
    assert!(num(&p["entry"]["from"]["lat"]) > num(&p["entry"]["to"]["lat"]));
    assert_eq!(p["entry"]["name"], json!("45° entry"));
    let mut unsurveyed = equator();
    for e in unsurveyed["runway_ends"].as_array_mut().unwrap() {
        e["lat"] = Value::Null;
        e["lon"] = Value::Null;
    }
    assert_eq!(ask("traffic_pattern", json!({"ident": "KTST", "runway": unsurveyed, "end_ident": "09"})), Value::Null);
    assert_eq!(ask("arrival_circuit", json!({"runway": unsurveyed, "end_ident": "09"})), Value::Null);
}

#[test]
fn the_way_out_is_straight_or_a_45_to_the_patterns_side_whichever_is_nearer_the_way_on() {
    let dep = |toward: Value| ask("departure_pattern", json!({"ident": "KTST", "runway": equator(), "end_ident": "09", "altitude_ft": 1800, "toward": toward}));
    let ahead = dep(json!({"lat": 0, "lon": 2}));
    assert_eq!(ahead["kind"], json!("departure"));
    assert_eq!(ahead["legs"].as_array().unwrap().len(), 1);
    assert_eq!(ahead["legs"][0]["from"], json!({"lat": 0.0, "lon": 0.0}));
    assert!(num(&ahead["legs"][0]["to"]["lon"]) > 1.0 / 60.0);
    assert_eq!(ahead["entry"]["name"], json!("Straight out"));
    assert_eq!(bearing(pt(&ahead["entry"]["from"]), pt(&ahead["entry"]["to"])).round(), 90.0);
    let north = dep(json!({"lat": 1, "lon": 0.5}));
    assert_eq!(north["entry"]["name"], json!("45° departure"));
    assert_eq!(bearing(pt(&north["entry"]["from"]), pt(&north["entry"]["to"])).round(), 45.0);
}

/// UGN's runway 5/23 as wingtip.pattern with_traffic gives it: 23 right, 5 left.
fn ugn() -> Value {
    json!({"runway_ends": [
        {"ident": "05", "heading_true_deg": 49.0, "traffic": "left", "lat": 42.4176, "lon": -87.8742},
        {"ident": "23", "heading_true_deg": 229.0, "traffic": "right", "lat": 42.4268, "lon": -87.8593},
    ]})
}

fn side_of(end: (f64, f64), along: f64, p: (f64, f64)) -> f64 {
    circuit::signed_turn(along, bearing(end, p))
}

#[test]
fn the_planners_arrival_comes_in_at_45_to_the_downwind_and_lands_on_the_threshold() {
    // test_pattern.py: "5" finds NASR's "05".
    let points: Vec<(f64, f64)> = ask("arrival_circuit", json!({"runway": ugn(), "end_ident": "5"}))["points"]
        .as_array().unwrap().iter().map(|p| (num(&p[0]), num(&p[1]))).collect();
    let [entry, midfield, downwind_end, _final_start, threshold] = points[..] else { panic!("{points:?}") };
    assert_eq!(threshold, (42.4176, -87.8742));
    let along = bearing((42.4176, -87.8742), (42.4268, -87.8593));
    assert!(side_of(threshold, along, midfield) < 0.0);
    let turn = circuit::signed_turn(bearing(midfield, downwind_end), bearing(entry, midfield)).abs();
    assert!(near(turn, 45.0, 1.0), "{turn}");
    let right: Vec<Value> = ask("arrival_circuit", json!({"runway": ugn(), "end_ident": "23"}))["points"].as_array().unwrap().clone();
    let back = bearing((42.4268, -87.8593), (42.4176, -87.8742));
    assert!(side_of((num(&right[4][0]), num(&right[4][1])), back, (num(&right[1][0]), num(&right[1][1]))) > 0.0);
}

#[test]
fn the_planners_departure_leaves_straight_out_or_at_45_toward_the_way_on() {
    let along = bearing((42.4176, -87.8742), (42.4268, -87.8593));
    let ahead = wingtip_engine::geo::destination(42.4268, -87.8593, along, 30.0);
    let left = wingtip_engine::geo::destination(42.4268, -87.8593, (along - 60.0).rem_euclid(360.0), 30.0);
    let straight = ask("departure_circuit", json!({"runway": ugn(), "end_ident": "5", "toward": [ahead.0, ahead.1]}));
    let turned = ask("departure_circuit", json!({"runway": ugn(), "end_ident": "5", "toward": [left.0, left.1]}));
    assert_eq!(straight["points"][0], json!([42.4176, -87.8742]));
    assert_eq!(straight["points"].as_array().unwrap().len(), 4);
    assert!(near(num(&straight["exit_deg"]), along, 0.2));
    assert!(near(num(&turned["exit_deg"]), (along - 45.0).rem_euclid(360.0), 0.2));
    let none = json!({"runway_ends": [{"ident": "14", "heading_true_deg": 140.0, "traffic": "left", "lat": null, "lon": null}]});
    assert_eq!(ask("departure_circuit", json!({"runway": none, "end_ident": "14", "toward": [42.0, -88.0]})), Value::Null);
}

#[test]
fn a_rule_not_known_or_input_not_of_its_shape_is_an_error_not_a_panic() {
    assert!(call("wind_components", "{}").is_err());
    assert!(call("runway_favoured_end", r#"{"ends": [[1, 2]], "variation_deg": 0}"#).is_err());
    assert!(call("departure_circuit", r#"{"runway": {}, "end_ident": "9", "toward": [1]}"#).is_err());
    assert!(call("runway_end_fit", r#"{"runway": {}, "elevation_ft": 0}"#).is_err());
}

#[test]
fn a_fit_with_no_elevation_or_no_length_is_unknown_and_one_past_the_table_beyond() {
    // 14 CFR 91.103(b): no elevation, no distance -- not a sea-level one.
    let f = fit(5000.0, "ASP", json!(null), json!({"elevation_ft": null}));
    assert_eq!((f["needed_ft"].clone(), f["unknown"].clone(), f["short"].clone()), (json!(null), json!(true), json!(false)));
    let f = fit(5000.0, "ASP", json!(null), json!({"runway": {"length_ft": null, "surface": "ASP", "closed": false, "runway_ends": []}}));
    assert_eq!((f["unknown"].clone(), f["short"].clone(), f["close"].clone()), (json!(true), json!(false), json!(false)));
    let f = fit(5000.0, "ASP", json!(null), json!({}));
    assert_eq!((f["unknown"].clone(), f["beyond"].clone()), (json!(false), json!(false)));
    // Heavier than the 172's heaviest table, 2,550 lb.
    assert_eq!(fit(5000.0, "ASP", json!(null), json!({"weight_lb": 2600}))["beyond"], json!(true));
}
