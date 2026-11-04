//! The engine's ATIS reading against the web app's own fixture
//! (web/src/lib/fixtures/atis.json): the same broadcasts read into the
//! same figures, so the phone at the hold-short line reads one as the
//! page does.

use serde_json::{json, Value};
use std::path::PathBuf;
use wingtip_engine::atis::read;
use wingtip_engine::call::call;

fn fixture() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web/src/lib/fixtures/atis.json");
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

#[test]
fn a_broadcast_is_read_as_the_web_reads_it() {
    let f = fixture();
    let cases = f["cases"].as_array().unwrap();
    assert!(cases.len() >= 12);
    for case in cases {
        let heard = case["heard"].as_str().unwrap();
        let ours: Value = serde_json::from_str(&read(heard).to_json()).unwrap();
        assert_eq!(ours, case["reading"], "{}", case["name"]);
    }
}

#[test]
fn the_rule_answers_by_name_with_the_shape() {
    let answer = call("read_atis", &json!({ "text": "Milwaukee information Charlie, wind calm, altimeter two niner niner two" }).to_string()).unwrap();
    let v: Value = serde_json::from_str(&answer).unwrap();
    assert_eq!(v["information"], "C");
    assert_eq!(v["wind"], json!({ "from_deg": null, "kt": 0, "gust_kt": null, "variable": false }));
    assert_eq!(v["altimeter_inhg"], 29.92);
    assert_eq!(v["runways"], json!({ "landing": [], "departing": [] }));
    assert!(v["sky"].as_array().unwrap().is_empty());
    assert_eq!(v["raw"], "Milwaukee information Charlie, wind calm, altimeter two niner niner two");
    assert!(call("read_atis", "{}").is_err());
}
