//! The things that move (wingtip_engine::motion), asked by name as every
//! host asks them (crate::call), held to the cases the web's own tests
//! hold its lib/map/traffic, lib/aircraftAlerts, lib/map/glide,
//! navlog/profile and navlog/dryRun to, and to the shared traffic fixture
//! (web/src/lib/fixtures/traffic.json) the phone's Traffic is held to.

use serde_json::{json, Value};
use std::path::PathBuf;
use wingtip_engine::call::call;
use wingtip_engine::geo::distance_nm;

fn ask(name: &str, input: Value) -> Value {
    let text = call(name, &input.to_string()).unwrap_or_else(|e| panic!("{name}: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{name} answered {text}: {e}"))
}

fn close(a: f64, b: f64, within: f64) -> bool {
    (a - b).abs() <= within
}

/// Every number as a float, so 42 and 42.0 are the same, as they are to
/// the web.
fn norm(v: &Value) -> Value {
    match v {
        Value::Number(x) => json!(x.as_f64().unwrap()),
        Value::Array(items) => Value::Array(items.iter().map(norm).collect()),
        Value::Object(m) => Value::Object(m.iter().map(|(k, x)| (k.clone(), norm(x))).collect()),
        other => other.clone(),
    }
}

fn n(v: &Value) -> f64 {
    v.as_f64().unwrap_or_else(|| panic!("{v} is not a number"))
}

// --- Traffic ----------------------------------------------------------------

fn plane(over: Value) -> Value {
    let mut p = json!({
        "hex": "a128b9", "callsign": "N174HA", "lat": 42.3246, "lon": -88.0741, "altitude_ft": 3520,
        "pressure_altitude": false, "track_deg": 92, "speed_kt": 110, "vertical_fpm": 0,
    });
    for (k, v) in over.as_object().unwrap() {
        p[k] = v.clone();
    }
    p
}

fn fix(over: Value) -> Value {
    let mut f = json!({ "lat": 42.3246, "lon": -88.0741, "heading_deg": 90, "speed_kt": 112, "altitude_ft": 3000 });
    for (k, v) in over.as_object().unwrap() {
        f[k] = v.clone();
    }
    f
}

fn mark(p: &Value, own: Value) -> Value {
    ask("traffic_marks", json!({ "own_ft": own, "planes": [{ "altitude_ft": p["altitude_ft"], "vertical_fpm": p["vertical_fpm"] }] }))[0].clone()
}

fn label(p: &Value, own: Value) -> String {
    mark(p, own)["label"].as_str().unwrap().to_owned()
}

fn near(p: &Value, own: Value) -> bool {
    mark(p, own)["near"].as_bool().unwrap()
}

#[test]
fn heights_are_written_against_own_ships_in_hundreds_as_tcas_does() {
    assert_eq!(label(&plane(json!({})), json!(3000)), "+05");
    assert_eq!(label(&plane(json!({ "altitude_ft": 1800 })), json!(3000)), "-12");
    assert_eq!(label(&plane(json!({ "altitude_ft": 3020 })), json!(3000)), "+00");
    // An arrow at 500 ft a minute and more.
    assert_eq!(label(&plane(json!({ "vertical_fpm": 500 })), json!(3000)), "+05↑");
    assert_eq!(label(&plane(json!({ "vertical_fpm": -800 })), json!(3000)), "+05↓");
    assert_eq!(label(&plane(json!({ "vertical_fpm": 400 })), json!(3000)), "+05");
    // Its own height where own ship's is not known; nothing where it sends none.
    assert_eq!(label(&plane(json!({ "altitude_ft": 4525 })), Value::Null), "4,500");
    assert_eq!(label(&plane(json!({ "altitude_ft": null })), json!(3000)), "");
}

#[test]
fn near_own_ships_height_is_within_1000_ft() {
    assert!(near(&plane(json!({ "altitude_ft": 3990 })), json!(3000)));
    assert!(!near(&plane(json!({ "altitude_ft": 4100 })), json!(3000)));
    assert!(!near(&plane(json!({})), Value::Null));
    // nearInHeight: the difference itself, against nothing.
    assert!(near(&json!({ "altitude_ft": -1000 }), json!(0)));
    assert!(!near(&json!({ "altitude_ft": 1000.01 }), json!(0)));
    // Many at once, in order.
    let many = ask("traffic_marks", json!({ "own_ft": 3000, "planes": [{ "altitude_ft": 3520 }, { "altitude_ft": null }, { "altitude_ft": 1800, "vertical_fpm": -600 }] }));
    assert_eq!(many, json!([{ "label": "+05", "near": true }, { "label": "", "near": false }, { "label": "-12↓", "near": false }]));
}

#[test]
fn the_shared_traffic_fixture() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web/src/lib/fixtures/traffic.json");
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let cases = fixture["cases"].as_array().unwrap();
    assert!(cases.len() >= 20);
    for case in cases {
        let p = plane(json!({ "altitude_ft": case["plane"]["altitude_ft"], "vertical_fpm": case["plane"]["vertical_fpm"] }));
        assert_eq!(label(&p, case["ownFt"].clone()), case["label"].as_str().unwrap(), "{case}");
        assert_eq!(near(&p, case["ownFt"].clone()), case["near"].as_bool().unwrap(), "{case}");
    }
}

fn own_hex(planes: Value, fix: Value) -> Value {
    ask("own_ship_hex", json!({ "planes": planes, "fix": fix }))
}

#[test]
fn own_ships_own_transponder_is_known_and_no_other() {
    // Where it is, as high, the same way, as fast.
    assert_eq!(own_hex(json!([plane(json!({ "altitude_ft": 3100 }))]), fix(json!({}))), "a128b9");
    // Still known when the answer is old: 40 s at 112 kt is 1.2 nm, taken
    // back with the age (the web's agedBy adds it to seen_s).
    let behind = plane(json!({ "lon": -88.0741 - 0.0268, "altitude_ft": 3100 }));
    assert_eq!(own_hex(json!([behind]), fix(json!({}))), Value::Null);
    assert_eq!(own_hex(json!([plane(json!({ "lon": -88.0741 - 0.0268, "altitude_ft": 3100, "seen_s": 40 }))]), fix(json!({}))), "a128b9");
    // Not another airplane.
    for other in [json!({ "track_deg": 270 }), json!({ "altitude_ft": 3600 }), json!({ "lat": 42.34 }), json!({ "speed_kt": 60 })] {
        assert_eq!(own_hex(json!([plane(other.clone())]), fix(json!({}))), Value::Null, "{other}");
    }
    assert_eq!(own_hex(json!([plane(json!({}))]), Value::Null), Value::Null);
    // Only the nearest match, so a wingman stays drawn.
    let wing = plane(json!({ "hex": "wing", "altitude_ft": 3100, "lat": 42.3246 + 0.002 }));
    assert_eq!(own_hex(json!([wing, plane(json!({ "altitude_ft": 3100 }))]), fix(json!({}))), "a128b9");
    // The feed's age: own ship was further back when it was heard.
    let heard = plane(json!({ "altitude_ft": 3100, "lon": -88.0741 - 0.0147, "seen_s": 30 }));
    assert_eq!(own_hex(json!([heard]), fix(json!({}))), "a128b9");
    let mut now = heard.clone();
    now["seen_s"] = json!(0);
    assert_eq!(own_hex(json!([now]), fix(json!({}))), Value::Null);
}

#[test]
fn the_closest_approach_of_one_coming_head_on_and_one_drawing_apart() {
    let own = fix(json!({ "lat": 42, "lon": -88, "heading_deg": 90, "speed_kt": 120, "altitude_ft": 3000 }));
    // Ten miles east, coming west at 120 kt, 500 ft above: they meet in 2.5
    // minutes, closing at 240 kt.
    let east = -88.0 + 10.0 / (60.0 * (42.0_f64 * std::f64::consts::PI / 180.0).cos());
    let cpa = ask("closest_approach", json!({ "own": own, "plane": plane(json!({ "lat": 42, "lon": east, "track_deg": 270, "speed_kt": 120, "altitude_ft": 3500 })) }));
    assert!(close(n(&cpa["in_min"]), 2.5, 0.05), "{cpa}");
    assert!(close(n(&cpa["nm"]), 0.0, 0.05), "{cpa}");
    assert!(close(n(&cpa["above_ft"]), 500.0, 0.5), "{cpa}");
    let apart = ask("closest_approach", json!({ "own": own, "plane": plane(json!({ "lat": 42, "lon": -88.1, "track_deg": 270, "speed_kt": 120, "altitude_ft": 3000 })) }));
    assert_eq!(n(&apart["in_min"]), 0.0);
    // Nothing without a track or speed.
    assert_eq!(ask("closest_approach", json!({ "own": fix(json!({ "heading_deg": null })), "plane": plane(json!({})) })), Value::Null);
    assert_eq!(ask("closest_approach", json!({ "own": own, "plane": plane(json!({ "speed_kt": null })) })), Value::Null);
}

// --- Alerts -----------------------------------------------------------------

fn airborne(before: Value, airborne: bool, arrived: bool, heard: Value) -> Value {
    ask("airborne_now", json!({ "before": before, "airborne": airborne, "arrived": arrived, "heard_s": heard }))
}

#[test]
fn in_the_air_where_heard_there_down_where_landed_and_gone_quiet_still_flying() {
    assert_eq!(airborne(Value::Null, true, false, json!(4)), json!(true));
    assert_eq!(airborne(json!(true), false, true, json!(4)), json!(false));
    // Unheard half a minute, no landing known: still in the air.
    assert_eq!(airborne(json!(true), false, false, json!(40)), json!(true));
    // Never heard, or not for half an hour: parked.
    assert_eq!(airborne(Value::Null, false, false, Value::Null), json!(false));
    assert_eq!(airborne(Value::Null, false, false, json!(3600)), json!(false));
    assert_eq!(airborne(Value::Null, false, false, json!(1800)), json!(false));
    assert_eq!(airborne(Value::Null, false, false, json!(40)), Value::Null);
}

#[test]
fn alerts_go_off_once_as_it_happens() {
    let fires = |input: Value| ask("alert_fires", input);
    // Takes off: from the ground into the air.
    assert_eq!(fires(json!({ "kind": "takeoff", "before_airborne": false, "airborne": true }))["fires"], json!(true));
    assert_eq!(fires(json!({ "kind": "takeoff", "before_airborne": true, "airborne": true }))["fires"], json!(false));
    assert_eq!(fires(json!({ "kind": "takeoff", "before_airborne": null, "airborne": true }))["fires"], json!(false));
    // Lands: from the air to a field, only once it is known where.
    assert_eq!(fires(json!({ "kind": "land", "before_airborne": true, "airborne": false, "arrived": true }))["fires"], json!(true));
    assert_eq!(fires(json!({ "kind": "land", "before_airborne": true, "airborne": true, "arrived": false }))["fires"], json!(false));
    assert_eq!(fires(json!({ "kind": "land", "before_airborne": false, "airborne": false, "arrived": true }))["fires"], json!(false));
    // Comes near me: 7 nm north-east of own ship, within the 10 picked.
    let me = json!({ "lat": 42.0, "lon": -88.0 });
    let close_by = json!({ "lat": 42.1, "lon": -87.9 });
    let first = fires(json!({ "kind": "near", "before_airborne": true, "airborne": true, "plane": close_by, "to": me, "limit_nm": 10 }));
    assert_eq!((first["fires"].clone(), first["inside"].clone()), (json!(true), json!(true)));
    assert_eq!(n(&first["nm"]).round(), 7.0);
    assert!(n(&first["bearing_deg"]) > 22.5 && n(&first["bearing_deg"]) < 67.5, "north-east: {first}");
    // Already near at the last answer: not said again.
    let again = fires(json!({ "kind": "near", "was_inside": true, "plane": close_by, "to": me, "limit_nm": 10 }));
    assert_eq!((again["fires"].clone(), again["inside"].clone()), (json!(false), json!(true)));
    // Further than picked, or no fix of own ship.
    let far = fires(json!({ "kind": "near", "plane": { "lat": 43.0, "lon": -88.0 }, "to": me, "limit_nm": 10 }));
    assert_eq!((far["fires"].clone(), far["inside"].clone()), (json!(false), json!(false)));
    assert_eq!(fires(json!({ "kind": "near", "plane": close_by, "to": null, "limit_nm": 10 }))["inside"], Value::Null);
    // Comes near an airport: 6 nm from 10C.
    let galt = json!({ "lat": 42.4027, "lon": -88.3751 });
    let inbound = fires(json!({ "kind": "near", "plane": { "lat": 42.45, "lon": -88.25 }, "to": galt, "limit_nm": 10 }));
    assert_eq!(inbound["fires"], json!(true));
    assert_eq!(n(&inbound["nm"]).round(), 6.0);
    assert_eq!(fires(json!({ "kind": "near", "plane": { "lat": 42.9, "lon": -88.3 }, "to": galt, "limit_nm": 10 }))["fires"], json!(false));
}

// --- Glide ------------------------------------------------------------------

#[test]
fn the_glide_ring_is_1_5_nm_a_thousand_feet_in_the_air() {
    let range = |alt: Value, kt: Value, ground: Value| ask("glide_range", json!({ "altitude_ft": alt, "speed_kt": kt, "ground_ft": ground }));
    assert_eq!(n(&range(json!(4800), json!(100), json!(800))), 6.0);
    assert_eq!(range(json!(1000), json!(100), json!(800)), Value::Null);
    assert_eq!(range(json!(4800), json!(10), json!(800)), Value::Null);
    assert_eq!(range(Value::Null, json!(100), json!(800)), Value::Null);
    assert_eq!(range(json!(4800), json!(100), Value::Null), Value::Null);
}

#[test]
fn a_field_within_a_glide_is_judged_over_its_own_elevation_at_pattern_height() {
    let reaches = |alt: f64, kt: f64, nm: f64, elevation: Value| {
        ask("glide_reaches", json!({ "altitude_ft": alt, "speed_kt": kt, "distance_nm": nm, "elevation_ft": elevation })).as_bool().unwrap()
    };
    // 5,000 ft over a 600 ft field is 3,400 ft to spare above its pattern:
    // 5.1 nm. A field 6 nm off at 2,500 ft has 1,500 ft: 2.25 nm.
    assert!(reaches(5000.0, 100.0, 5.0, json!(600)));
    assert!(!reaches(5000.0, 100.0, 6.0, json!(600)));
    assert!(!reaches(5000.0, 100.0, 6.0, json!(2500)));
    assert!(!reaches(5000.0, 10.0, 1.0, json!(600)));
    assert!(!reaches(5000.0, 100.0, 1.0, Value::Null));
    assert!(!reaches(1500.0, 100.0, 0.5, json!(600)));
    assert_eq!(ask("underway", json!({ "speed_kt": 40 })), json!(true));
    assert_eq!(ask("underway", json!({ "speed_kt": 39.9 })), json!(false));
    assert_eq!(ask("underway", json!({})), json!(false));
}

// --- The nav log's rows, as the web's navLogRows builds them ----------------

fn airport(ident: &str, lat: f64, elevation: f64) -> Value {
    json!({ "ident": ident, "name": ident, "lat": lat, "lon": -88, "elevation_ft": elevation, "kind": "airport" })
}

/// The piece of `leg` from one point on it to the next.
fn piece(leg: &Value, from: (f64, f64, f64), to: (f64, Option<f64>, Option<f64>)) -> Value {
    let mut p = leg.clone();
    p["distance_nm"] = json!(f64::max(0.0, to.0 - from.0));
    p["ete_min"] = json!(to.1.map(|m| f64::max(0.0, m - from.1)));
    p["fuel_gal"] = json!(to.2.map(|g| f64::max(0.0, g - from.2)));
    p
}

/// The rows of a route with no checkpoints: the departure, each stop and
/// the destination, each leg's tops of climb and descent rows of their own.
fn nav_log_rows(fields: &[Value], legs: &[Value]) -> Value {
    let mut rows = vec![json!({ "kind": "departure", "key": "departure", "airport": fields[0], "minutesFlown": 0 })];
    for (k, field) in fields.iter().enumerate().skip(1) {
        let kind = if k == fields.len() - 1 { "destination" } else { "stop" };
        let Some(leg) = legs.get(k - 1) else {
            rows.push(json!({ "kind": kind, "airport": field }));
            continue;
        };
        let mut points: Vec<(&str, &Value)> = Vec::new();
        for kind in ["toc", "tod"] {
            if leg[kind].is_object() {
                points.push((kind, &leg[kind]));
            }
        }
        points.sort_by(|a, b| n(&a.1["along_nm"]).partial_cmp(&n(&b.1["along_nm"])).unwrap());
        let mut from = (0.0, 0.0, 0.0);
        for (kind, point) in &points {
            let mut part = piece(leg, from, (n(&point["along_nm"]), point["ete_min"].as_f64(), point["fuel_gal"].as_f64()));
            if *kind == "toc" {
                part["tas_kt"] = point["tas_kt"].clone();
                part["groundspeed_kt"] = point["groundspeed_kt"].clone();
            }
            rows.push(json!({ "kind": kind, "point": point, "leg": leg, "part": part }));
            from = (n(&point["along_nm"]), n(&point["ete_min"]), point["fuel_gal"].as_f64().unwrap_or(0.0));
        }
        let mut row = json!({ "kind": kind, "airport": field, "leg": leg });
        if !points.is_empty() {
            row["part"] = piece(leg, from, (n(&leg["distance_nm"]), leg["ete_min"].as_f64(), leg["fuel_gal"].as_f64()));
        }
        rows.push(row);
    }
    Value::Array(rows)
}

/// One 60 nm leg north at 100 kt over the ground, 36 minutes and 5
/// gallons, climbing for its first 8 nm and down at 3:1 from 48 nm.
fn leg() -> Value {
    json!({
        "distance_nm": 60, "ete_min": 36, "fuel_gal": 5, "fuel_burn_gph": 8, "altitude_ft": 5500, "climb_min": 6, "groundspeed_kt": 100,
        "tas_kt": 110, "true_course_deg": 0,
        "toc": { "along_nm": 8, "ete_min": 6, "fuel_gal": 1, "altitude_ft": 5500, "lat": 42.13, "lon": -88, "tas_kt": 70, "groundspeed_kt": 75 },
        "tod": { "along_nm": 48, "ete_min": 28.8, "fuel_gal": 4, "altitude_ft": 5500, "to_ft": 1500, "pattern": true, "fpm": 550, "lat": 42.8, "lon": -88 },
    })
}

fn c81_kdlh(legs: &[Value]) -> Value {
    nav_log_rows(&[airport("C81", 42.0, 800.0), airport("KDLH", 43.0, 500.0)], legs)
}

// --- The plan from the side --------------------------------------------------

#[test]
fn the_plan_climbs_to_its_top_holds_and_descends_to_the_pattern_a_mile_out() {
    let mut l = leg();
    l["toc"]["lat"] = json!(42.1);
    let p = ask("plan_profile", json!({ "rows": c81_kdlh(&[l]) }));
    assert_eq!(
        norm(&p["points"]),
        norm(&json!([
            { "along_nm": 0, "plan_ft": 800 }, { "along_nm": 8, "plan_ft": 5500 }, { "along_nm": 48, "plan_ft": 5500 },
            { "along_nm": 59, "plan_ft": 1500 }, { "along_nm": 60, "plan_ft": 500 },
        ]))
    );
    assert_eq!(p["marks"].as_array().unwrap().iter().map(|m| m["kind"].as_str().unwrap()).collect::<Vec<_>>(), ["TOC", "TOD"]);
    assert_eq!(p["length_nm"], json!(60.0));
}

#[test]
fn the_plan_descends_to_an_approachs_first_fix_by_its_distance_out_then_to_the_field() {
    // ANDOE crossed at 3,000 ft 15 nm out: 2,500 ft at three to one is 7.5
    // nm, so down from 37.5 and level at 45.
    let mut l = leg();
    l["tod"] = json!({ "along_nm": 37.5, "ete_min": 22.5, "fuel_gal": 3, "altitude_ft": 5500, "to_ft": 3000, "pattern": false, "fix": "ANDOE", "fpm": 550, "lat": 42.6, "lon": -88 });
    let p = ask("plan_profile", json!({ "rows": c81_kdlh(&[l]) }));
    let along: Vec<(f64, f64)> = p["points"].as_array().unwrap().iter().map(|q| ((n(&q["along_nm"]) * 10.0).round() / 10.0, n(&q["plan_ft"]))).collect();
    assert_eq!(along, [(0.0, 800.0), (8.0, 5500.0), (37.5, 5500.0), (45.0, 3000.0), (60.0, 500.0)]);
}

// --- The dry run -------------------------------------------------------------

struct Run(Value);

impl Run {
    fn of(rows: &Value, line: Option<Value>, missed: bool) -> Run {
        Run(ask("dry_run", json!({ "rows": rows, "start_s": 1000, "line": line, "missed": missed })))
    }
    fn points(&self) -> &Vec<Value> {
        self.0["points"].as_array().unwrap()
    }
    fn along(&self, i: usize) -> f64 {
        n(&self.0["along_nm"][i])
    }
    fn last(&self) -> &Value {
        self.points().last().unwrap()
    }
    fn first_at_or_past(&self, nm: f64) -> &Value {
        let i = (0..self.points().len()).find(|&i| self.along(i) >= nm).unwrap();
        &self.points()[i]
    }
    fn at(&self, lat: f64, lon: f64) -> Option<&Value> {
        self.points().iter().find(|p| distance_nm(n(&p["lat"]), n(&p["lon"]), lat, lon) < 0.05)
    }
}

#[test]
fn the_planned_flight_flown_on_paper() {
    let rows = c81_kdlh(&[leg()]);
    let run = Run::of(&rows, None, false);
    // Leaves the field at the start, its height the field's; lands at the
    // end of the legs' time.
    let first = &run.points()[0];
    assert_eq!((n(&first["t"]), n(&first["lat"]), n(&first["alt_ft"])), (1000.0, 42.0, 800.0));
    assert!(close(n(&run.last()["t"]), 1000.0 + 36.0 * 60.0, 1e-6));
    assert!(close(n(&run.last()["lat"]), 43.0, 1e-9));
    assert_eq!(n(&run.last()["alt_ft"]), 500.0);
    // At the plan's altitude level between its top of climb and descent.
    let level: Vec<&Value> = (0..run.points().len()).filter(|&i| run.along(i) > 8.0 && run.along(i) < 48.0).map(|i| &run.points()[i]).collect();
    assert!(level.len() > 5);
    assert!(level.iter().all(|p| n(&p["alt_ft"]) == 5500.0));
    // At a standstill on the field at the end, where the alerts ahead take
    // it as landed.
    assert_eq!(n(&run.last()["gs_kt"]), 0.0);
    assert!(n(&run.points()[run.points().len() - 2]["gs_kt"]) > 0.0);
    // What is left and burnt: the whole 60 nm and 5 gallons.
    assert!(close(run.along(run.points().len() - 1), 60.0, 1e-9));
    assert!(close(n(run.0["fuel_gal"].as_array().unwrap().last().unwrap()), 5.0, 1e-9));
    // Each of the log's rows reached in turn.
    let row_t = run.0["row_t"].as_array().unwrap();
    assert_eq!(row_t.len(), rows.as_array().unwrap().len());
    assert_eq!(n(&row_t[0]), 1000.0);
    assert!(close(n(row_t.last().unwrap()), 1000.0 + 36.0 * 60.0, 1e-6));
}

#[test]
fn the_dry_run_flies_the_course_line_the_map_draws() {
    // A line bent east at its middle: half way along the legs, the airplane
    // is at the bend, on the line, whatever the rows' points say.
    let rows = c81_kdlh(&[leg()]);
    let run = Run::of(&rows, Some(json!([[42, -88], [42.5, -87.9], [43, -88]])), false);
    let half = run.first_at_or_past(30.0);
    assert!(close(n(&half["lat"]), 42.5, 0.005) && close(n(&half["lon"]), -87.9, 0.005), "{half}");
    assert!(close(n(&run.last()["lat"]), 43.0, 1e-9) && close(n(&run.last()["lon"]), -88.0, 1e-9));
    // Its track the line's own: north-east on the way to the bend.
    let early = n(&run.first_at_or_past(10.0)["track_deg"]);
    assert!(early > 0.0 && early < 90.0, "{early}");
}

// The leg in to the test's Duluth (43 N, 88 W) flown by an RNAV (GPS) RWY
// 27, as the planner gives it (with_procedures): from the leg's start at
// C81 out to its IAF, PLANE, south-east of the field, north to HOMUV (at
// or above 2,500), west to its FAF, CIRUS (1,900), and on to the runway;
// its missed approach west to a hold at UDTEG (3,300).
const C81: (f64, f64) = (42.0, -88.0);
const PLANE: (f64, f64) = (42.9, -87.8);
const HOMUV: (f64, f64) = (43.0, -87.8);
const CIRUS: (f64, f64) = (43.0, -87.9);
const RUNWAY: (f64, f64) = (43.0, -88.0);
const UDTEG: (f64, f64) = (43.0, -88.3);

fn nm(a: (f64, f64), b: (f64, f64)) -> f64 {
    distance_nm(a.0, a.1, b.0, b.1)
}

fn path_nm() -> f64 {
    nm(C81, PLANE) + nm(PLANE, HOMUV) + nm(HOMUV, CIRUS) + nm(CIRUS, RUNWAY)
}

fn path_json(points: &[(f64, f64)]) -> Value {
    Value::Array(points.iter().map(|p| json!([p.0, p.1])).collect())
}

fn procedure(ft: Value) -> Value {
    let more_nm = path_nm() - 60.0;
    let more_min = (more_nm / 100.0) * 60.0;
    json!({
        "path": path_json(&[C81, PLANE, HOMUV, CIRUS, RUNWAY]),
        "ft": ft, "nm": path_nm(), "landing": true, "final_at": 3, "map_at": 4,
        "missed": { "path": [[UDTEG.0, UDTEG.1]], "ft": 3300 }, "more_nm": more_nm, "more_min": more_min, "more_gal": (more_min / 60.0) * 8.0,
    })
}

fn flown_leg(p: Value) -> Value {
    let more_min = n(&p["more_min"]);
    let mut l = leg();
    l["ete_min"] = json!(36.0 + more_min);
    l["fuel_gal"] = json!(5.0 + (more_min / 60.0) * 8.0);
    l["procedure"] = p;
    l
}

#[test]
fn a_leg_flown_by_its_procedures_follows_their_path_and_the_charts_altitudes() {
    let p = procedure(json!([null, null, 2500, 1900, null]));
    let more_min = n(&p["more_min"]);
    let rows = c81_kdlh(&[flown_leg(p)]);
    let run = Run::of(&rows, None, false);
    // The whole leg along their path, out to the IAF and down to the runway.
    assert!(path_nm() - 60.0 > 5.0);
    for fix in [PLANE, HOMUV, CIRUS] {
        assert!(run.at(fix.0, fix.1).is_some(), "{fix:?}");
    }
    assert!(close(n(&run.last()["lat"]), 43.0, 1e-9) && close(n(&run.last()["lon"]), -88.0, 1e-9));
    assert_eq!(n(&run.last()["alt_ft"]), 500.0);
    assert!(run.points().iter().all(|q| n(&q["lon"]) > -88.01));
    // Westbound on its final.
    let total = run.along(run.points().len() - 1);
    let final_track = n(&run.first_at_or_past(total - 3.0)["track_deg"]);
    assert!(final_track > 265.0 && final_track < 275.0, "{final_track}");
    // Climbs as planned, holds its cruise, crosses each fix at its altitude.
    let climbing = n(&run.first_at_or_past(4.0)["alt_ft"]);
    assert!(climbing > 800.0 && climbing < 5500.0);
    assert_eq!(n(&run.first_at_or_past(20.0)["alt_ft"]), 5500.0);
    assert!(close(n(&run.at(HOMUV.0, HOMUV.1).unwrap()["alt_ft"]), 2500.0, 0.5));
    assert!(close(n(&run.at(CIRUS.0, CIRUS.1).unwrap()["alt_ft"]), 1900.0, 0.5));
    // Down the last of it from the FAF, never climbing.
    let from_faf: Vec<f64> = (0..run.points().len()).filter(|&i| run.along(i) >= total - nm(CIRUS, RUNWAY)).map(|i| n(&run.points()[i]["alt_ft"])).collect();
    assert!(from_faf.windows(2).all(|w| w[1] <= w[0]));
    // The planner's time and fuel, its miles more in them; the tops of
    // climb and descent passed as it starts.
    assert!(close(total, path_nm(), 1e-6));
    assert!(close(n(&run.last()["t"]), 1000.0 + (36.0 + more_min) * 60.0, 1e-6));
    assert!(close(n(run.0["fuel_gal"].as_array().unwrap().last().unwrap()), 5.0 + (more_min / 60.0) * 8.0, 1e-9));
    let kinds: Vec<&str> = rows.as_array().unwrap().iter().map(|r| r["kind"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["departure", "toc", "tod", "destination"]);
    let row_t: Vec<f64> = run.0["row_t"].as_array().unwrap().iter().map(n).collect();
    assert_eq!(row_t[..3], [1000.0, 1000.0, 1000.0]);
    assert!(close(row_t[3], n(&run.last()["t"]), 1e-6));
    // The route's distance laid evenly over the path (the web's runNmAt reads these bends).
    assert_eq!(norm(&run.0["bends"][3]), json!({ "route": 60.0, "run": total }));
    // Its final from CIRUS to the runway, while Go missed is there.
    assert_eq!(run.0["missable"], json!(true));
    assert!(close(n(&run.0["final"]["from"]), n(&run.at(CIRUS.0, CIRUS.1).unwrap()["t"]), 1.0));
    assert!(close(n(&run.0["final"]["to"]), n(&run.last()["t"]), 1e-6));
}

#[test]
fn the_plans_cruise_stands_where_the_chart_sets_a_fix_over_it() {
    // PLANE at 12,000 (BENKY6's at O'Hare): flown at 5,500, not climbed to.
    let rows = c81_kdlh(&[flown_leg(procedure(json!([null, 12000, 2500, 1900, null])))]);
    let run = Run::of(&rows, None, false);
    let top = run.points().iter().map(|q| q["alt_ft"].as_f64().unwrap_or(0.0)).fold(f64::MIN, f64::max);
    assert_eq!(top, 5500.0);
}

#[test]
fn going_missed_flies_on_from_the_missed_approach_point_climbing_200_ft_a_mile() {
    let rows = c81_kdlh(&[flown_leg(procedure(json!([null, null, 2500, 1900, null])))]);
    let landed = Run::of(&rows, None, false);
    let missed = Run::of(&rows, None, true);
    let out = nm(RUNWAY, UDTEG);
    // The same flight to the runway, at the same moments.
    let map_index = landed.points().len() - 1;
    let at_map = &missed.points()[map_index];
    assert!(close(n(&at_map["lat"]), 43.0, 1e-9) && close(n(&at_map["lon"]), -88.0, 1e-9));
    assert!(close(n(&at_map["alt_ft"]), 500.0, 0.5));
    assert!(close(n(&at_map["t"]), n(&landed.last()["t"]), 1e-6));
    // Then out west to UDTEG, climbing from the field's 500 at the standard
    // gradient, short of its 3,300 there; ending in the air, still flying.
    let end = missed.last();
    assert!(close(n(&end["lat"]), 43.0, 0.005) && close(n(&end["lon"]), -88.3, 0.005));
    assert!(close(n(&end["alt_ft"]), 500.0 + out * 200.0, 0.5));
    assert!(close(missed.along(missed.points().len() - 1), landed.along(map_index) + out, 1e-6));
    assert!(n(&end["gs_kt"]) > 0.0);
}

#[test]
fn going_missed_from_a_map_short_of_the_runway_climbs_from_the_height_there() {
    // A LOC's MAP a mile and a half short of the threshold (the audit of
    // 2026-10-21).
    let map = (43.0, -87.965);
    let mut p = procedure(json!([null, null, 2500, 1900, null, null]));
    p["path"] = path_json(&[C81, PLANE, HOMUV, CIRUS, map, RUNWAY]);
    p["map_at"] = json!(4);
    let rows = c81_kdlh(&[flown_leg(p)]);
    let landed = Run::of(&rows, None, false);
    assert!(close(n(&landed.last()["lat"]), 43.0, 1e-9) && close(n(&landed.last()["lon"]), -88.0, 1e-9));
    assert_eq!(n(&landed.last()["alt_ft"]), 500.0);
    assert!(n(&landed.0["final"]["to"]) < n(&landed.last()["t"]));
    let gone = Run::of(&rows, None, true);
    let i = gone.points().iter().position(|q| distance_nm(n(&q["lat"]), n(&q["lon"]), map.0, map.1) < 0.01).unwrap();
    assert!(i > 0);
    let map_ft = n(&gone.points()[i]["alt_ft"]);
    assert!(map_ft > 600.0);
    assert!(close(n(&gone.points()[i]["t"]), n(&landed.0["final"]["to"]), 5.0));
    assert!(!gone.points().iter().any(|q| distance_nm(n(&q["lat"]), n(&q["lon"]), RUNWAY.0, RUNWAY.1) < 0.05));
    assert!(gone.points()[i..].iter().all(|q| n(&q["alt_ft"]) > map_ft - 10.0));
    assert!(close(n(&gone.last()["lat"]), 43.0, 1e-9) && close(n(&gone.last()["lon"]), -88.3, 1e-9));
}

#[test]
fn a_departure_alone_lays_the_plans_heights_along_its_path() {
    let mut l = leg();
    l["procedure"] = json!({
        "path": [[42, -88], [42.1, -88.1], [42.3, -88.1], [43, -88]], "ft": [null, null, null, null], "nm": 0, "landing": false,
        "final_at": null, "map_at": null, "missed": null, "more_nm": 0, "more_min": 0, "more_gal": 0,
    });
    let run = Run::of(&c81_kdlh(&[l]), None, false);
    assert!(run.at(42.1, -88.1).is_some());
    assert!(close(n(&run.last()["lat"]), 43.0, 1e-9));
    assert_eq!(n(&run.last()["alt_ft"]), 500.0);
    let top = run.points().iter().map(|q| n(&q["alt_ft"])).fold(f64::MIN, f64::max);
    assert_eq!(top, 5500.0);
    assert_eq!(run.0["missable"], json!(false));
    assert_eq!(run.0["final"], Value::Null);
}

#[test]
fn the_dry_run_knows_each_landing() {
    // C81 to a stop 60 nm north and on 60 nm to the destination, each flight
    // 36 minutes and 5 gallons, level.
    let mut level = leg();
    level["toc"] = Value::Null;
    level["tod"] = Value::Null;
    level["climb_min"] = json!(0);
    let rows = nav_log_rows(&[airport("C81", 42.0, 800.0), airport("KJVL", 43.0, 800.0), airport("KDLH", 44.0, 500.0)], &[level.clone(), level]);
    let run = Run::of(&rows, None, false);
    let landings = run.0["landings"].as_array().unwrap();
    assert_eq!(landings.iter().map(|l| l["ident"].as_str().unwrap()).collect::<Vec<_>>(), ["KJVL", "KDLH"]);
    assert!(close(n(&landings[0]["t"]), 1000.0 + 36.0 * 60.0, 1e-6));
    assert!(close(n(&landings[0]["nm"]), 60.0, 1e-9));
    assert!(close(n(&landings[0]["fuel"]), 5.0, 1e-9));
    assert!(close(n(&landings[1]["t"]), 1000.0 + 72.0 * 60.0, 1e-6));
    assert!(close(n(&landings[1]["nm"]), 120.0, 1e-9));
}

#[test]
fn a_hold_before_landing_is_flown_round_its_racetrack_in_the_planners_time() {
    // Over the destination, two turns of a lap of four minutes, a racetrack
    // a few miles east of the field: eight minutes and a gallon more.
    let mut held = leg();
    held["ete_min"] = json!(44);
    held["fuel_gal"] = json!(6);
    held["hold"] = json!({
        "fix": "KDLH", "inbound_deg": 270, "right": true, "leg_min": 1, "leg_nm": null, "turns": 2, "minutes": 8, "lap_min": 4, "gal": 1,
        "entry": "direct", "path": [[43, -88], [43.02, -87.98], [43.02, -87.9], [43, -87.92], [43, -88]], "at_end": true,
    });
    let run = Run::of(&c81_kdlh(&[held]), None, false);
    assert!(close(n(&run.last()["t"]), 1000.0 + 44.0 * 60.0, 1e-6));
    assert!(close(n(run.0["fuel_gal"].as_array().unwrap().last().unwrap()), 6.0, 1e-9));
    assert!(run.points().iter().map(|q| n(&q["lon"])).fold(f64::MIN, f64::max) > -87.95);
    assert!(close(n(&run.last()["lat"]), 43.0, 1e-9) && close(n(&run.last()["lon"]), -88.0, 1e-9));
    // The field's row reached when the hold is flown, and half way round it
    // still at the hold's height.
    assert!(close(n(run.0["row_t"].as_array().unwrap().last().unwrap()), 1000.0 + 44.0 * 60.0, 1e-6));
    let mid = run.points().iter().find(|q| n(&q["t"]) >= 1000.0 + 40.0 * 60.0).unwrap();
    assert!(n(&mid["alt_ft"]) > 500.0);
}

#[test]
fn no_run_without_a_departure_or_a_leg() {
    let empty = Run::of(&json!([]), None, false);
    assert!(empty.points().is_empty());
    let no_leg = Run::of(&c81_kdlh(&[]), None, false);
    assert!(no_leg.points().is_empty());
    assert!(call("dry_run", r#"{"rows": [{"kind": "nope"}], "start_s": 0}"#).is_err());
    assert!(call("dry_run", r#"{"rows": []}"#).is_err());
}

// --- A flown track read from its file ---------------------------------------

fn read(text: &str) -> Value {
    ask("read_track", json!({ "text": text }))
}

fn gpx(points: &str) -> String {
    format!(r#"<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>{points}</trkseg></trk></gpx>"#)
}

#[test]
fn a_gpx_track_is_read_in_time_order_its_heights_in_feet() {
    let read = read(&gpx(concat!(
        r#"<trkpt lat="42.1" lon="-88.1"><ele>250.5</ele><time>2026-10-01T14:00:00Z</time></trkpt>"#,
        r#"<trkpt lat="42.2" lon="-88.2"><time>2026-10-01T14:00:05.250Z</time></trkpt>"#,
        // A second report at the same moment, a point at 0, 0 and one off
        // the earth: dropped.
        r#"<trkpt lat="42.3" lon="-88.3"><ele></ele><time>2026-10-01T14:00:05.250Z</time></trkpt>"#,
        r#"<trkpt lat="0" lon="0"><time>2026-10-01T14:00:07Z</time></trkpt>"#,
        r#"<trkpt lat="95" lon="1"><time>2026-10-01T14:00:08Z</time></trkpt>"#,
        // An offset: 13:59 an hour east of Greenwich is 12:59 UTC, first.
        r#"<trkpt lat="42.4" lon="-88.4"><ele>x</ele><time>2026-10-01T13:59:00+01:00</time></trkpt>"#,
    )));
    assert_eq!(
        read["points"],
        json!([
            { "t": 1790859540000.0, "lat": 42.4, "lon": -88.4, "alt_ft": null },
            { "t": 1790863200000.0, "lat": 42.1, "lon": -88.1, "alt_ft": 250.5 * 3.28084 },
            { "t": 1790863205250.0, "lat": 42.2, "lon": -88.2, "alt_ft": null },
        ])
    );
}

#[test]
fn a_kml_track_log_is_read_from_its_whens_and_coords() {
    let read = read(concat!(
        r#"<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><Placemark><gx:Track>"#,
        "<when>2026-10-01T14:00:00Z</when><when>2026-10-01T14:00:04Z</when><when>2026-10-01T14:00:08Z</when>",
        "<gx:coord>-88.1 42.1 300</gx:coord><gx:coord>-88.2 42.2</gx:coord><gx:coord> -88.3   42.3 310.5 </gx:coord>",
        "</gx:Track></Placemark></Document></kml>",
    ));
    let points = read["points"].as_array().unwrap();
    assert_eq!(points.len(), 3);
    assert_eq!(norm(&points[0]), json!({ "t": 1790863200000.0, "lat": 42.1, "lon": -88.1, "alt_ft": 300.0 * 3.28084 }));
    assert_eq!(points[1]["alt_ft"], Value::Null);
    assert_eq!(points[2]["lat"], json!(42.3));
}

#[test]
fn a_file_with_nothing_to_use_says_why() {
    let error = |text: &str| read(text)["error"].as_str().unwrap().to_owned();
    assert_eq!(error(&gpx(r#"<trkpt lat="42.1" lon="-88.1"><ele>250</ele></trkpt><trkpt lat="42.2" lon="-88.2"></trkpt>"#)), "The track's points have no times: export it with them (a GPX track, or ForeFlight's KML track log).");
    assert_eq!(error(&gpx("")), "There is no track in this file.");
    assert_eq!(error(r#"<kml><Document><Placemark><LineString><coordinates>-88,42,0 -88.1,42.1,0</coordinates></LineString></Placemark></Document></kml>"#), "There is no track in this file.");
    for not_a_track in ["<foo/>", "not xml at all", "<gpx><trk>"] {
        assert_eq!(error(not_a_track), "This file is not a GPX or KML track.");
    }
}

#[test]
fn times_are_read_as_iso_8601_in_utc() {
    use wingtip_engine::motion::track::iso_ms;
    assert_eq!(iso_ms("2026-10-01T14:00:00Z"), Some(1790863200000.0));
    assert_eq!(iso_ms("2026-10-01T14:00:00.5Z"), Some(1790863200500.0));
    assert_eq!(iso_ms("2026-10-01T14:00:02-05:00"), Some(1790863202000.0 + 5.0 * 3600_000.0));
    assert_eq!(iso_ms("2026-10-02"), Some(1790899200000.0));
    // GPX 1.1 sets its times in UTC: one with no offset is UTC.
    assert_eq!(iso_ms("2026-10-01T14:00:00"), Some(1790863200000.0));
    for bad in ["", "yesterday", "2026-13-01T00:00:00Z", "2026-02-30", "2026-10-01T25:00Z", "2026-10-01T14:00:00.Z"] {
        assert_eq!(iso_ms(bad), None, "{bad}");
    }
}

#[test]
fn a_track_is_thinned_by_even_steps_keeping_its_ends() {
    let points: Vec<Value> = (0..9001).map(|i| json!({ "t": i * 1000, "lat": 42, "lon": -88, "altFt": null })).collect();
    let kept = ask("thin_track", json!({ "points": points }));
    let kept = kept.as_array().unwrap();
    assert_eq!(kept.len(), 4000);
    assert_eq!(norm(&kept[0]), norm(&points[0]));
    assert_eq!(norm(&kept[3999]), norm(&points[9000]));
    let few = ask("thin_track", json!({ "points": points[..10], "most": 4000 }));
    assert_eq!(few.as_array().unwrap().len(), 10);
    let three = ask("thin_track", json!({ "points": points[..100], "most": 3 }));
    assert_eq!(three.as_array().unwrap().iter().map(|p| n(&p["t"])).collect::<Vec<_>>(), [0.0, 50_000.0, 99_000.0]);
}

#[test]
fn a_descent_at_three_to_one_is_about_pattern_altitude_and_3300_ft_ten_miles_out() {
    // 1,000 ft in 3 nm (profile.rs DESCENT_FT_PER_NM): ten miles out is
    // 3,333 ft above pattern altitude, to the hundred.
    let at = |cruise: f64, pattern: Value| ask("descent_altitude", json!({"cruise_ft": cruise, "pattern_ft": pattern, "nm_out": 10}));
    assert_eq!(at(8500.0, json!(1800)), json!(5100.0));
    // No higher than the cruise, and the cruise with no pattern altitude.
    assert_eq!(at(4500.0, json!(1800)), json!(4500.0));
    assert_eq!(at(6500.0, Value::Null), json!(6500.0));
}
