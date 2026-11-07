//! The FAA data sets' cycles held to the shared fixture the planner and
//! the web are held to (web/src/lib/fixtures/dataCycles.json, its dates
//! from the FAA's 28 and 56 Day Product Schedule, the NASR subscription
//! page and the DOF page), asked as every host asks: `data_cycle` by name.

use serde_json::{json, Value};
use std::path::PathBuf;
use wingtip_engine::call::call;

fn fixture() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web/src/lib/fixtures/dataCycles.json");
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

#[test]
fn each_edition_is_in_force_for_its_own_cycle_only() {
    let cases = fixture()["cases"].as_array().unwrap().clone();
    assert!(cases.len() >= 10);
    for c in cases {
        let input = json!({ "kind": c["kind"], "effective": c["effective"], "on": c["on"] });
        let answer: Value = serde_json::from_str(&call("data_cycle", &input.to_string()).unwrap()).unwrap();
        for key in ["state", "expires", "current", "current_ident", "next", "behind"] {
            assert_eq!(answer[key], c["expected"][key], "{key} of {}: {answer}", c["why"]);
        }
    }
}

#[test]
fn a_day_or_kind_that_is_not_one_is_refused_in_words() {
    for input in [
        json!({ "kind": "weekly", "on": "2026-11-06" }),
        json!({ "kind": "airac", "on": "2026-02-30" }),
        json!({ "kind": "airac", "on": "2026-11-06", "effective": "29 Oct 2026" }),
    ] {
        let err = call("data_cycle", &input.to_string()).unwrap_err();
        assert!(err.starts_with("data_cycle:"), "{err}");
    }
}
