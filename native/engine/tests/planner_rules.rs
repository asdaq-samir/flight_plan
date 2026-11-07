//! The planner's rules moved into the engine (#482 phase 0), held to the
//! answers the planner's own Python gave before the move
//! (web/src/lib/fixtures/plannerRules.json, written by it): the airspace
//! over a point, the Mode C veil, an FNS message's NOTAMs, a hazard's
//! window, a report's ceiling and category, and a figure in the web's
//! words. The planner now asks these names (wingtip_native.call), so the
//! same cases hold the web, the phones and the planner to one answer.

use serde_json::{json, Value};
use std::path::PathBuf;
use wingtip_engine::call::call;

fn fixture() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web/src/lib/fixtures/plannerRules.json");
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

/// Two JSON values the same, a number by its value: Python wrote 800 where
/// the engine writes 800.0.
fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same(p, q)),
        (Value::Object(x), Value::Object(y)) => x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| same(v, w))),
        _ => a == b,
    }
}

fn ask(name: &str, input: Value) -> Value {
    let text = call(name, &input.to_string()).unwrap_or_else(|e| panic!("{name}: {e}"));
    serde_json::from_str(&text).unwrap()
}

fn check(section: &str, name: &str, input: impl Fn(&Value) -> Value, answer: &str) {
    let all = fixture();
    let cases = all[section].as_array().unwrap_or_else(|| panic!("no {section}"));
    assert!(!cases.is_empty(), "{section} has no cases");
    for case in cases {
        let got = ask(name, input(case));
        assert!(same(&got, &case[answer]), "{section}: {case}\ngot {got}");
    }
}

#[test]
fn the_airspace_over_a_point() {
    check("airspaceColumn", "airspace_column", |c| json!({ "ground_ft": c["ground_ft"], "volumes": c["volumes"], "in_veil": c["in_veil"] }), "bands");
    check("modeCVeil", "mode_c_veil", |c| json!({ "lat": c["lat"], "lon": c["lon"], "airports": c["airports"] }), "veil");
}

#[test]
fn an_fns_messages_notams() {
    check("notamsFns", "notams_fns", |c| json!({ "text": c["text"] }), "notams");
}

#[test]
fn a_hazards_window() {
    check(
        "hazardWindow",
        "gonogo_hazard_window",
        |c| json!({ "enter": c["enter"], "leave": c["leave"], "valid_from": c["valid_from"], "valid_to": c["valid_to"], "margin_min": c["margin_min"] }),
        "when",
    );
}

#[test]
fn a_reports_ceiling_and_category() {
    check("ceiling", "ceiling_ft", |c| json!({ "layers": c["layers"], "vert_vis_ft": c["vert_vis_ft"] }), "ceiling_ft");
    check("reportCategory", "report_flight_category", |c| json!({ "ceiling_ft": c["ceiling_ft"], "visibility_sm": c["visibility_sm"] }), "category");
    // sky_ceiling finds the same ceiling, and calls none of these unknown:
    // the cases' lowest broken or overcast layer has a height.
    for case in fixture()["ceiling"].as_array().unwrap() {
        let got = ask("sky_ceiling", json!({ "layers": case["layers"], "vert_vis_ft": case["vert_vis_ft"] }));
        assert!(same(&got["ceiling_ft"], &case["ceiling_ft"]), "{case}\ngot {got}");
    }
}

/// The AWC's data API sends a layer whose height a station could not
/// measure ("OVC///", "VV///") with no base: the ceiling is not known, not
/// absent (14 CFR 1.1), and so neither is the category but for what the
/// visibility settles. One with no height above a measured ceiling leaves
/// it known (layers come lowest first, FMH-1 ch. 9).
#[test]
fn a_ceiling_sent_with_no_height() {
    let sky = |layers: Value, vv: Value| ask("sky_ceiling", json!({ "layers": layers, "vert_vis_ft": vv }));
    let unknown = json!({ "ceiling_ft": null, "ceiling_unknown": true });
    assert_eq!(sky(json!([{ "cover": "OVC", "base_ft": null }]), Value::Null), unknown);
    assert_eq!(sky(json!([{ "cover": "OVX" }]), Value::Null), unknown);
    assert_eq!(sky(json!([{ "cover": "FEW", "base_ft": 800 }, { "cover": "BKN", "base_ft": null }, { "cover": "OVC", "base_ft": 2500 }]), Value::Null), unknown);
    assert_eq!(ask("ceiling_ft", json!({ "layers": [{ "cover": "BKN", "base_ft": null }] })), Value::Null);
    // Under a measured layer, a layer with no height is above it.
    assert_eq!(
        sky(json!([{ "cover": "BKN", "base_ft": 1200 }, { "cover": "OVC", "base_ft": null }]), Value::Null),
        json!({ "ceiling_ft": 1200.0, "ceiling_unknown": false })
    );
    // A vertical visibility is the obscuration from the surface, under all.
    assert_eq!(sky(json!([{ "cover": "OVX", "base_ft": null }]), json!(200)), json!({ "ceiling_ft": 200.0, "ceiling_unknown": false }));
    assert_eq!(sky(json!([{ "cover": "SCT", "base_ft": 3000 }]), Value::Null), json!({ "ceiling_ft": null, "ceiling_unknown": false }));
    let category = |vis: f64| ask("report_flight_category", json!({ "ceiling_ft": null, "ceiling_unknown": true, "visibility_sm": vis }));
    assert_eq!(category(10.0), Value::Null);
    assert_eq!(category(0.5), json!("LIFR"));
    assert_eq!(ask("report_flight_category", json!({ "ceiling_ft": null, "visibility_sm": 10 })), json!("VFR"));
}

#[test]
fn a_figure_in_the_webs_words() {
    let all = fixture();
    for c in all["words"].as_array().unwrap() {
        let n = &c["n"];
        let mut want = vec![("words_num", json!({ "n": n }), &c["num"]), ("words_alt_ft", json!({ "ft": n }), &c["alt_ft"])];
        if !n.is_null() {
            want.extend([
                ("words_one", json!({ "n": n }), &c["one"]),
                ("words_to_fixed", json!({ "n": n }), &c["to_fixed"]),
                ("words_to_fixed", json!({ "n": n, "digits": 0 }), &c["to_fixed0"]),
                ("words_to_fixed", json!({ "n": n, "digits": 2 }), &c["to_fixed2"]),
                ("words_grouped", json!({ "n": n }), &c["grouped"]),
                ("words_flight_level", json!({ "ft": n }), &c["flight_level"]),
            ]);
        }
        for (name, input, expected) in want {
            let got = ask(name, input.clone());
            assert!(same(&got, expected), "{name} {input}: got {got}, want {expected}");
        }
    }
}
