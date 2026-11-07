//! The four pilot pages' figures (wingtip_engine::figures), held to the
//! cases the planner's tests hold app.figures to (planning-service/tests/
//! test_figures_*.py), themselves the web's lib/debrief, lib/diversion,
//! lib/holding and lib/lostComms tests.

use serde_json::Value;
use wingtip_engine::figures::debrief::{self, Checkpoint, Point};
use wingtip_engine::figures::diversion::{self, Air};
use wingtip_engine::figures::holding::{self, Entry};
use wingtip_engine::figures::lost_comms::{self, Because};
use wingtip_engine::figures::words;

fn near(a: f64, b: f64, within: f64) -> bool {
    (a - b).abs() <= within
}

// --- Words ----------------------------------------------------------------

#[test]
fn figures_are_written_as_javascript_writes_them() {
    assert_eq!(words::js_round(2.5), 3);
    assert_eq!(words::js_round(-2.5), -2);
    // toFixed's tie goes up where Rust's own format takes it to the even.
    assert_eq!(words::to_fixed(0.25, 1), "0.3");
    assert_eq!(words::to_fixed(18.0, 1), "18.0");
    assert_eq!(words::to_fixed(9.95, 1), "9.9"); // 9.949999... as a double
    assert_eq!(words::to_fixed(99.96, 1), "100.0");
    assert_eq!(words::to_fixed(-0.04, 1), "-0.0");
    assert_eq!(words::to_fixed(2.5, 0), "3");
    assert_eq!(words::grouped(12_500.0), "12,500");
    assert_eq!(words::grouped(-499.5), "-500");
    assert_eq!(words::grouped(-0.4), "0");
    assert_eq!(words::grouped(1_234_567.0), "1,234,567");
    assert_eq!(words::alt_ft(None), "—");
    assert_eq!(words::bearing(0.0), "360°");
    assert_eq!(words::bearing(4.6), "005°");
    assert_eq!(words::bearing(-30.0), "330°");
    assert_eq!(words::wind_correction(8.4), "+8°");
    assert_eq!(words::wind_correction(-3.0), "−3°");
    assert_eq!(words::wind_correction(-0.4), "0°");
}

// --- Holding (AIM 5-3-8) ----------------------------------------------------

fn entry(inbound: f64, heading: f64, right: bool) -> Entry {
    holding::holding_entry(inbound, heading, right).0
}

#[test]
fn a_standard_hold_on_360() {
    assert_eq!(entry(360.0, 360.0, true), Entry::Direct);
    assert_eq!(entry(360.0, 90.0, true), Entry::Direct);
    assert_eq!(entry(360.0, 300.0, true), Entry::Direct);
    // From the north-west, heading south-east: the non-holding side, beyond the fix.
    assert_eq!(entry(360.0, 150.0, true), Entry::Teardrop);
    // From the north-east, heading south-west, and from the east heading west: the holding side.
    assert_eq!(entry(360.0, 220.0, true), Entry::Parallel);
    assert_eq!(entry(360.0, 270.0, true), Entry::Parallel);
}

#[test]
fn left_turns_are_the_mirror() {
    assert_eq!(entry(360.0, 210.0, false), Entry::Teardrop);
    assert_eq!(entry(360.0, 140.0, false), Entry::Parallel);
    assert_eq!(entry(360.0, 270.0, false), Entry::Direct);
    assert_eq!(entry(90.0, 160.0, false), Entry::Direct);
}

#[test]
fn within_5_degrees_of_a_sectors_edge_either_entry() {
    assert_eq!(holding::holding_entry(360.0, 112.0, true), (Entry::Teardrop, Some(Entry::Direct)));
    assert_eq!(holding::holding_entry(360.0, 288.0, true), (Entry::Parallel, Some(Entry::Direct)));
    assert_eq!(holding::holding_entry(360.0, 45.0, true).1, None);
}

#[test]
fn a_headwind_inbound_the_outbound_leg_shorter() {
    let w = holding::holding_wind(360.0, 100.0, 360.0, 20.0, 5000.0).unwrap();
    assert_eq!(w.leg_min, 1.0);
    assert!(near(w.inbound.gs, 80.0, 1e-9));
    assert!(near(w.outbound.gs, 120.0, 1e-9));
    // 80 kt for a minute is 1.33 nm, flown outbound at 120 kt: 40 s.
    assert!(near(w.outbound_sec, 40.0, 1e-9));
    assert!(near(w.rule_sec, 40.0, 1e-9));
}

#[test]
fn a_crosswind_outbound_three_times_the_inbound_correction_a_minute_and_a_half_up_high() {
    let w = holding::holding_wind(360.0, 100.0, 90.0, 15.0, 16000.0).unwrap();
    assert_eq!(w.leg_min, 1.5);
    assert!(near(w.inbound.wca, 8.63, 0.05));
    assert!(near(w.outbound.wca, -3.0 * w.inbound.wca, 1e-9));
    assert!(near(w.outbound.heading, 180.0 - 3.0 * w.inbound.wca, 1e-9));
    assert!(holding::holding_wind(360.0, 50.0, 90.0, 60.0, 5000.0).is_none());
}

#[test]
fn the_inbound_legs_time() {
    // A minute at or below 14,000 ft MSL, a minute and a half above (AIM 5-3-8 j.4(a)).
    assert_eq!(holding::leg_minutes(Some(3000.0)), 1.0);
    assert_eq!(holding::leg_minutes(Some(14_000.0)), 1.0);
    assert_eq!(holding::leg_minutes(Some(14_001.0)), 1.5);
    assert_eq!(holding::leg_minutes(Some(17_000.0)), 1.5);
    assert_eq!(holding::leg_minutes(None), 1.0);
}

#[test]
fn the_entries_in_words() {
    assert_eq!(holding::entry_steps(Entry::Direct, 360.0, true, 5000.0),
               "Fly to the fix and turn right to follow the pattern: outbound on 180°.");
    assert!(holding::entry_steps(Entry::Teardrop, 360.0, true, 5000.0)
        .starts_with("Fly to the fix, then turn to 150°, 30° into the holding side, for one minute"));
    assert!(holding::entry_steps(Entry::Parallel, 90.0, false, 16000.0).contains("for a minute and a half; then turn right"));
}

#[test]
fn the_holding_answer() {
    let d: Value = serde_json::from_str(&holding::holding_json(360.0, 220.0, true, Some(100.0), Some(360.0), Some(20.0), Some(5000.0))).unwrap();
    assert_eq!(d["entry"], "parallel");
    assert_eq!(d["entry_name"], "Parallel");
    assert!(d["either"].is_null());
    assert!(d["steps"].as_str().unwrap()
        .starts_with("At the fix, turn to 180°, parallel to the holding course on the non-holding side, for one minute"));
    assert_eq!(d["approach_relative"], 40.0);
    assert!(near(d["wind"]["outbound_sec"].as_f64().unwrap(), 40.0, 1e-9));
    assert_eq!(d["wind"]["time_words"], "So the inbound leg takes a minute at 80 kt; by the rule of a second a knot, 40 s");
    let near_edge: Value = serde_json::from_str(&holding::holding_json(360.0, 112.0, true, None, None, None, None)).unwrap();
    assert_eq!(near_edge["entry"], "teardrop");
    assert_eq!(near_edge["either_name"], "Direct");
    assert!(near_edge["wind"].is_null() && near_edge["wind_problem"].is_null());
    let strong: Value = serde_json::from_str(&holding::holding_json(360.0, 0.0, true, Some(50.0), Some(90.0), Some(60.0), Some(5000.0))).unwrap();
    assert!(strong["wind"].is_null());
    assert_eq!(strong["wind_problem"], "A wind stronger than the airplane holds no heading.");
}

// --- Lost communications (14 CFR 91.185) -------------------------------------

fn segs(list: &[(&str, Option<f64>)]) -> Vec<(String, Option<f64>)> {
    list.iter().map(|(n, m)| (n.to_string(), *m)).collect()
}

#[test]
fn each_segment_at_the_highest_of_assigned_minimum_and_expected() {
    let flown = lost_comms::segment_altitudes(
        &segs(&[("to SWEDE", Some(2600.0)), ("SWEDE to RAYMO", Some(5000.0)), ("RAYMO to the approach", Some(3400.0))]),
        Some(4000.0), Some(6000.0), 1,
    );
    let got: Vec<_> = flown.iter().map(|f| (f.name.as_str(), f.fly)).collect();
    assert_eq!(got, vec![
        ("to SWEDE", Some((4000.0, Because::Assigned))),
        ("SWEDE to RAYMO", Some((6000.0, Because::Expected))),
        ("RAYMO to the approach", Some((6000.0, Because::Expected))),
    ]);
    // An MEA above both: the MEA.
    assert_eq!(lost_comms::segment_altitudes(&segs(&[("x", Some(7000.0))]), Some(4000.0), Some(6000.0), 0)[0].fly,
               Some((7000.0, Because::Minimum)));
    assert_eq!(lost_comms::segment_altitudes(&segs(&[("x", None)]), None, None, 0)[0].fly, None);
    // A tie goes to the first named, as the rule lists them.
    assert_eq!(lost_comms::segment_altitudes(&segs(&[("x", Some(4000.0))]), Some(4000.0), Some(4000.0), 0)[0].fly,
               Some((4000.0, Because::Assigned)));
    assert_eq!(lost_comms::fly_words(flown[1].fly), "Fly 6,000 ft: expected");
    assert_eq!(lost_comms::fly_words(Some((7000.0, Because::Minimum))), "Fly 7,000 ft: the minimum");
    assert_eq!(lost_comms::fly_words(None), "No altitude known");
}

#[test]
fn leaving_the_clearance_limit_at_the_efc_else_the_eta() {
    assert!(lost_comms::leave_limit(true, "1420Z", "1435Z").contains("expect-further-clearance time, 1420Z"));
    assert!(lost_comms::leave_limit(true, "", "1435Z").contains("estimated time of arrival, 1435Z"));
    assert!(lost_comms::leave_limit(false, "", "1435Z")
        .starts_with("Leave the clearance limit on arriving over it, proceed to a fix an approach begins from"));
    assert!(lost_comms::leave_limit(false, "1420Z", "").contains("Leave the clearance limit at the expect-further-clearance time, 1420Z"));
}

#[test]
fn the_lost_comms_answer() {
    let d: Value = serde_json::from_str(&lost_comms::lost_comms_json(
        &segs(&[("Departure to SWEDE", Some(2600.0)), ("SWEDE to RAYMO", Some(5000.0)), ("", None)]),
        Some(4000.0), Some(6000.0), 1, false, "", " 1435Z ",
    )).unwrap();
    let said: Vec<&str> = d["segments"].as_array().unwrap().iter().map(|s| s["words"].as_str().unwrap()).collect();
    assert_eq!(said, ["Fly 4,000 ft: assigned", "Fly 6,000 ft: expected", "Fly 6,000 ft: expected"]);
    assert_eq!(d["segments"][2]["name"], "Segment");
    assert!(d["leave"].as_str().unwrap().ends_with("estimated time of arrival, 1435Z."));
    let keys: Vec<&str> = d["routes"].as_array().unwrap().iter().map(|r| r["key"].as_str().unwrap()).collect();
    assert_eq!(keys, ["assigned", "vectored", "expected", "filed"]);
    assert!(d["vfr"].as_str().unwrap().starts_with("In VFR conditions"));
    assert_eq!(Because::from_key("minimum"), Some(Because::Minimum));
}

// --- The diversion drill (ACS PA.VI.C) ----------------------------------------

const LEG: Air = Air { tas_kt: 110.0, fuel_burn_gph: 8.5, magnetic_variation_deg: -3.0, wind_from_deg: 270.0, wind_kt: 20.0 };

#[test]
fn the_wind_triangle() {
    // A direct headwind: no correction, the ground speed the difference.
    let head = diversion::divert(&Air { magnetic_variation_deg: 0.0, ..LEG }, 270.0, 10.0).unwrap();
    assert_eq!(head.wca, 0.0);
    assert_eq!(head.th, 270.0);
    assert!(near(head.gs, 90.0, 1e-9));
    // From the left on a northerly course: correct left, a little slower.
    let north = diversion::divert(&LEG, 360.0, 18.0).unwrap();
    assert!(near(north.wca, -10.48, 0.05));
    assert!(near(north.th, 349.52, 0.05));
    assert!(near(north.gs, 108.2, 0.05));
    // A wind faster than the airplane across the course holds no heading.
    assert!(diversion::divert(&Air { tas_kt: 50.0, wind_kt: 60.0, ..LEG }, 360.0, 18.0).is_none());
}

#[test]
fn to_the_field_heading_magnetic_time_and_fuel_at_the_legs_burn() {
    let d = diversion::divert(&LEG, 360.0, 18.0).unwrap();
    // 3 degrees west: west is best, so it is added.
    assert!(near(d.mh, 352.52, 0.05));
    assert!(near(d.ete, (18.0 / d.gs) * 60.0, 1e-9));
    assert!(near(d.fuel, (d.ete / 60.0) * 8.5, 1e-9));
    // No wind is calm.
    let calm = diversion::divert(&Air { wind_from_deg: 0.0, wind_kt: 0.0, ..LEG }, 90.0, 22.0).unwrap();
    assert_eq!(calm.wca, 0.0);
    assert!(near(calm.gs, 110.0, 1e-9) && near(calm.ete, 12.0, 1e-9));
}

#[test]
fn a_reasonable_estimate_headings_round_the_compass() {
    assert_eq!(diversion::reasonable("mh", 2.0, 355.0), Some(true));
    assert_eq!(diversion::reasonable("mh", 10.0, 355.0), Some(false));
    assert_eq!(diversion::reasonable("ete", 13.0, 10.0), Some(true));
    assert_eq!(diversion::reasonable("fuel", 3.6, 2.5), Some(false));
    assert_eq!(diversion::reasonable("tas", 3.6, 2.5), None);
}

#[test]
fn the_diversion_answer_in_words_with_the_estimates_checked() {
    let d: Value = serde_json::from_str(&diversion::diversion_json(&LEG, 360.0, 18.0, "KMSN", [Some(355.0), Some(95.0), None, Some(1.4)])).unwrap();
    assert!(d["problem"].is_null());
    assert!(near(d["solved"]["mh"].as_f64().unwrap(), 352.5, 0.05));
    assert_eq!(d["steps"][0]["value"], "360°, 18.0 nm");
    assert_eq!(d["steps"][1]["value"], "−10°");
    let checks = d["checks"].as_array().unwrap();
    assert_eq!(checks[0]["reasonable"], true);
    assert_eq!(checks[0]["written"], "353°");
    // 108 kt over the ground: 95 is more than 10 off.
    assert_eq!(checks[1]["reasonable"], false);
    assert!(checks[2]["reasonable"].is_null());
    assert_eq!(checks[2]["written"], "10 min");
    assert_eq!(checks[3]["reasonable"], true);
    let strong: Value = serde_json::from_str(&diversion::diversion_json(
        &Air { tas_kt: 50.0, wind_kt: 60.0, ..LEG }, 360.0, 18.0, "KMSN", [None; 4])).unwrap();
    assert!(strong["solved"].is_null() && strong["steps"].as_array().unwrap().is_empty());
    assert_eq!(strong["problem"], "The wind is too strong for a heading to KMSN to hold.");
}

// --- The debrief (ACS PA.VI.A) ------------------------------------------------

/// A flight due north along 88 W: A at 42 N, a lake 30 nm on, B 30 nm past
/// it, 18 minutes a leg at 3,500 ft.
fn checkpoints() -> Vec<Checkpoint> {
    let cp = |seq, name: &str, category: &str, lat, along, tc, ete, alt| Checkpoint {
        sequence_no: seq, name: name.into(), category: category.into(), lat, lon: -88.0, along_track_nm: along,
        true_course_deg: tc, ete_min: ete, altitude_ft: alt,
    };
    vec![
        cp(0, "A", "departure", 42.0, 0.0, None, None, None),
        cp(1, "Lake", "lake", 42.5, 30.0, Some(0.0), Some(18.0), Some(3500.0)),
        cp(2, "B", "destination", 43.0, 60.0, Some(0.0), Some(18.0), Some(3500.0)),
    ]
}

/// Flown every 5 s: two minutes' taxi, then north at 100 kt half a mile
/// east of the line, climbing at 500 fpm to 3,600; 3,800 for two minutes
/// on the second leg; down at 500 fpm to 1,800 in the last 4 nm; taxi.
fn flown() -> Vec<Point> {
    let t0 = 1_790_953_200_000.0; // 2026-10-02 15:00 UTC
    let lon = -88.0 + 0.5 / (60.0 * (42.5 * std::f64::consts::PI / 180.0).cos());
    let mut points: Vec<Point> = (0..120).step_by(5)
        .map(|s| Point { t: t0 + s as f64 * 1000.0, lat: 42.0 - 0.002 + (s as f64 / 3600.0) * (10.0 / 60.0), lon, alt_ft: Some(700.0) })
        .collect();
    let off = t0 + 120_000.0;
    for s in (0..=36 * 60).step_by(5) {
        let s = s as f64;
        let nm = (s / 3600.0) * 100.0;
        let mut alt = (700.0 + (s / 60.0) * 500.0).min(3600.0);
        if 40.0 < nm && nm < 40.0 + 100.0 / 30.0 {
            alt = 3800.0;
        }
        if nm > 56.0 {
            alt = (3600.0 - (nm - 56.0) * 600.0).max(1800.0);
        }
        points.push(Point { t: off + s * 1000.0, lat: 42.0 + nm / 60.0, lon, alt_ft: Some(alt) });
    }
    let on = off + 36.0 * 60_000.0;
    points.extend((5..120).step_by(5)
        .map(|s| Point { t: on + s as f64 * 1000.0, lat: 43.0 + (s as f64 / 3600.0) * (10.0 / 60.0), lon, alt_ft: Some(700.0) }));
    points
}

fn d() -> debrief::Debrief {
    debrief::debrief(&checkpoints(), &flown(), &[("B".into(), 1700.0)]).unwrap()
}

#[test]
fn the_flight_is_the_tracks_run_over_40_kt() {
    assert_eq!(debrief::airborne(&flown()).len(), 1);
    let d = d();
    assert!(near(d.flown_min, 36.0, 0.5));
    assert_eq!(d.planned_min, Some(36.0));
    assert!(d.notes.is_empty());
}

#[test]
fn leg_by_leg_the_course_held_and_how_far_off_it_the_altitude_held() {
    let d = d();
    assert_eq!(d.legs[0].course_within, Some(1.0));
    // Half a mile east of a northbound line: right of it.
    assert!(near(d.legs[0].worst_off_nm.unwrap(), 0.5, 0.05));
    // The climb is not the cruise: 3,600 from there is within 200.
    assert_eq!(d.legs[0].altitude_within, Some(1.0));
    // Two minutes at 3,800 of the second leg's cruise.
    let within = d.legs[1].altitude_within.unwrap();
    assert!(0.75 < within && within < 0.95, "{within}");
    assert_eq!(d.legs[1].worst_alt_ft, Some(300.0));
    // On the map, the two minutes at 3,800 are the off part of the line.
    let off: Vec<_> = d.line.iter().filter(|p| p.off).collect();
    assert!(off.len() > 10);
    assert!(off.iter().all(|p| 42.0 + 40.0 / 60.0 < p.lat && p.lat < 42.0 + 44.0 / 60.0));
}

#[test]
fn each_checkpoint_when_it_was_due_and_when_it_was_passed_and_the_pattern() {
    let d = d();
    let names: Vec<&str> = d.passes.iter().map(|p| p.name.as_str()).collect();
    assert_eq!(names, ["Lake", "B"]);
    assert_eq!(d.passes[0].due_min, Some(18.0));
    assert!(near(d.passes[0].passed_min.unwrap(), 18.0, 0.5));
    assert!(near(d.passes[0].closest_nm.unwrap(), 0.5, 0.05));
    assert!(near(d.passes[1].passed_min.unwrap(), 36.0, 0.5));
    assert_eq!(d.patterns.len(), 1);
    assert_eq!(d.patterns[0].pattern_ft, 1700.0);
    assert!(d.patterns[0].alt_ft > 1700.0);
}

#[test]
fn a_track_from_somewhere_else_is_said_and_one_that_never_flew_is_none() {
    let elsewhere: Vec<Point> = flown().into_iter().map(|p| Point { lat: p.lat + 1.0, ..p }).collect();
    let d = debrief::debrief(&checkpoints(), &elsewhere, &[]).unwrap();
    assert!(d.notes[0].starts_with("The track takes off 60 nm from A"), "{:?}", d.notes);
    assert!(debrief::debrief(&checkpoints(), &flown()[..20], &[]).is_none());
}

#[test]
fn the_marks_are_the_pages_against_the_tolerances() {
    let m: Value = serde_json::from_str(&debrief::to_json(&d(), true)).unwrap();
    // The first leg held both; the second went 300 ft high, past 200.
    assert_eq!(m["legs"][0]["ok"], true);
    assert_eq!(m["legs"][1]["ok"], false);
    assert_eq!(m["passes"][0]["ok"], true);
    assert_eq!(m["passes"][0]["landed"], false);
    assert_eq!(m["passes"][1]["landed"], true);
    assert!(near(m["passes"][0]["late_min"].as_f64().unwrap(), 0.0, 0.5));
    // Into the pattern: within 100 ft or not, by the figure.
    let entry = &m["patterns"][0];
    let off = entry["off_ft"].as_f64().unwrap();
    assert!(near(off, entry["alt_ft"].as_f64().unwrap() - 1700.0, 1e-9));
    assert_eq!(entry["ok"], off.abs() <= 100.0);
    // Unmarked, as app.figures.debrief's own answer: no marks.
    let plain: Value = serde_json::from_str(&debrief::to_json(&d(), false)).unwrap();
    assert!(plain["legs"][0].get("ok").is_none());
}

#[test]
fn the_debrief_answer_sorts_the_track_and_says_the_tolerances() {
    let mut points = flown();
    points.reverse();
    let a: Value = serde_json::from_str(&debrief::answer_json(&checkpoints(), &points, &[("B".into(), 1700.0)])).unwrap();
    assert_eq!(a["tolerances"], serde_json::json!({"altitude_ft": 200.0, "course_deg": 15.0, "off_route_nm": 3.0, "eta_min": 5.0,
                                                   "pattern_nm": 1.5, "pattern_ft": 100.0}));
    assert_eq!(a["debrief"]["passes"][0]["due_min"], 18.0);
    assert_eq!(a["debrief"]["patterns"][0]["pattern_ft"], 1700.0);
    let none: Value = serde_json::from_str(&debrief::answer_json(&checkpoints(), &flown()[..20], &[])).unwrap();
    assert!(none["debrief"].is_null());
}

fn ask(name: &str, input: serde_json::Value) -> serde_json::Value {
    serde_json::from_str(&wingtip_engine::call::call(name, &input.to_string()).unwrap()).unwrap()
}

// --- The strip's fuel, one answer for web, iPhone and Android ---------------

#[test]
fn the_strip_says_the_fuel_required_to_the_next_landing() {
    use serde_json::json;
    // A route with a stop: the first flight's fuel required, the tanks
    // filled at the stop (app.planning.route_totals); short on the second.
    let route = json!({"fuel_required_gal": 50.0, "fuel_margin_gal": -3.5, "hops": [
        {"departure": "C81", "destination": "KMSN", "fuel_required_gal": 20.4, "fuel_margin_gal": 12.0},
        {"departure": "KMSN", "destination": "KDLH", "fuel_required_gal": 29.6, "fuel_margin_gal": -3.5}]});
    let a = ask("strip_fuel", route.clone());
    assert_eq!(a["required_gal"], json!(20.4));
    assert_eq!(a["short"], json!([{"name": "KMSN → KDLH", "short_gal": 3.5}]));
    // The second flight, 10 gal burnt; never below nothing.
    let mut flying = route.clone();
    flying["hop"] = json!(1);
    flying["burnt_gal"] = json!(10.0);
    assert_eq!(ask("strip_fuel", flying.clone())["required_gal"], json!(19.6));
    flying["burnt_gal"] = json!(40.0);
    assert_eq!(ask("strip_fuel", flying)["required_gal"], json!(0.0));
    // No stops: the whole route's.
    let a = ask("strip_fuel", json!({"fuel_required_gal": 18.0, "fuel_margin_gal": 4.0}));
    assert_eq!(a, json!({"required_gal": 18.0, "short": []}));
    assert_eq!(ask("strip_fuel", json!({}))["required_gal"], serde_json::Value::Null);
}

#[test]
fn an_estimate_carries_the_taxi_allowance_and_45_minutes() {
    use serde_json::json;
    // 120 nm at 120 kt is an hour; at 8 gph, 8 gal; with 1.4 gal to start
    // and taxi and 45 minutes' reserve (14 CFR 91.151(a)(2), 91.167(a)(3)),
    // 6 gal, 15.4.
    let a = ask("fuel_estimate", json!({"distance_nm": 120.0, "cruise_tas_kt": 120.0, "fuel_burn_gph": 8.0}));
    assert_eq!(a["minutes"], json!(60.0));
    assert_eq!(a["trip_gal"], json!(8.0));
    assert!((a["required_gal"].as_f64().unwrap() - 15.4).abs() < 1e-9);
    let none = ask("fuel_estimate", json!({"distance_nm": 120.0, "cruise_tas_kt": 120.0}));
    assert_eq!(none["required_gal"], serde_json::Value::Null);
    assert_eq!(ask("fuel_estimate", json!({"distance_nm": 120.0}))["minutes"], serde_json::Value::Null);
}

#[test]
fn the_reserve_is_the_rules() {
    use serde_json::json;
    // 14 CFR 91.151(a): 30 minutes by day, 45 at night; 91.167(a)(3): 45.
    assert_eq!(ask("reserve_min", json!({})), json!(30.0));
    assert_eq!(ask("reserve_min", json!({"night": true})), json!(45.0));
    assert_eq!(ask("reserve_min", json!({"ifr": true})), json!(45.0));
}

#[test]
fn the_tanks_are_walked_and_filled_at_each_field_landed_at() {
    use serde_json::json;
    let a = ask("fuel_in_tanks", json!({"usable_gal": 40.0, "taxi_gal": 1.4, "reserve_gal": 6.0, "points": [
        {"departure": true}, {"fuel_gal": 10.0}, {"fuel_gal": 20.0, "refuel": true}, {"fuel_gal": 34.0},
        {"fuel_gal": null}, {"fuel_gal": 1.0}]}));
    assert_eq!(a[0], json!({"gal": 40.0, "low": false}));
    assert_eq!(a[1]["low"], json!(false));
    assert!((a[1]["gal"].as_f64().unwrap() - 28.6).abs() < 1e-9);
    assert!((a[2]["gal"].as_f64().unwrap() - 8.6).abs() < 1e-9);
    // Filled at the stop: 40 - 1.4 - 34 = 4.6, under the 6 gal reserve.
    assert!((a[3]["gal"].as_f64().unwrap() - 4.6).abs() < 1e-9);
    assert_eq!(a[3]["low"], json!(true));
    // A leg with no burn known: nothing known after it.
    assert_eq!(a[4], serde_json::Value::Null);
    assert_eq!(a[5], serde_json::Value::Null);
}
