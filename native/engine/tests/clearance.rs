//! The engine's clearance reading against the web app's own fixtures
//! (web/src/lib/fixtures): the same clearances read into the same items,
//! the same routes from what was found, the same calls to us -- so the
//! phone in the air answers as the page does.

use serde_json::Value;
use std::path::PathBuf;
use wingtip_engine::clearance::{cleared_route, direct_of, our_call, read, tokens, Found, FoundPlaces, FoundProcedure, Route};

fn fixture(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web/src/lib/fixtures").join(name);
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn text(v: &Value) -> Option<String> {
    v.as_str().map(str::to_owned)
}

fn found(v: &Value) -> Found {
    Found {
        said: v["said"].as_str().unwrap_or("").to_owned(),
        ident: text(&v["ident"]),
        name: text(&v["name"]),
        kind: match v["kind"].as_str() {
            Some("airport") => Some("airport"),
            Some("navaid") => Some("navaid"),
            Some("fix") => Some("fix"),
            _ => None,
        },
        sure: v["sure"].as_bool().unwrap_or(true),
    }
}

fn procedure(v: &Value) -> Option<FoundProcedure> {
    v.as_object().map(|_| FoundProcedure { id: v["id"].as_str().unwrap().to_owned(), transition: text(&v["transition"]) })
}

fn route(v: &Value) -> Route {
    Route {
        dep: v["dep"].as_str().unwrap().to_owned(),
        stops: v["stops"].as_array().unwrap().iter().map(|s| s.as_str().unwrap().to_owned()).collect(),
        dest: v["dest"].as_str().unwrap().to_owned(),
    }
}

#[test]
fn a_clearance_is_read_as_the_web_reads_it() {
    let f = fixture("clearances.json");
    for case in f["read"].as_array().unwrap() {
        let heard = case["heard"].as_str().unwrap();
        let ours: Value = serde_json::from_str(&read(heard).to_json()).unwrap();
        // The web's leaves a procedure's transition out where none was
        // said only in writing; null and missing are the same here.
        assert_eq!(ours, case["clearance"], "{heard}");
    }
}

#[test]
fn figures_said_are_one_number() {
    let f = fixture("clearances.json");
    for case in f["numbers"].as_array().unwrap() {
        let heard = case["heard"].as_str().unwrap();
        let toks = tokens(heard);
        assert_eq!(toks.len(), 1, "{heard}");
        assert_eq!(toks[0].word, heard);
        assert_eq!(toks[0].num.as_deref(), case["num"].as_str(), "{heard}");
    }
}

#[test]
fn the_route_a_clearance_gives_is_the_webs() {
    let f = fixture("clearances.json");
    for case in f["routes"].as_array().unwrap() {
        let heard = case["heard"].as_str().unwrap();
        let fv = &case["found"];
        let places = FoundPlaces {
            limit: fv["limit"].as_object().map(|_| found(&fv["limit"])),
            route: fv["route"].as_array().map(|runs| runs.iter().map(|r| r.as_array().unwrap().iter().map(found).collect()).collect()).unwrap_or_default(),
            departure: procedure(&fv["departure"]),
            arrival: procedure(&fv["arrival"]),
        };
        let (got, typed) = cleared_route(&read(heard), &places, &route(&case["planned"]));
        assert_eq!(got, route(&case["route"]), "{heard}");
        let want: Vec<(String, Option<String>, Option<String>)> = case["typed"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| (t["name"].as_str().unwrap().to_owned(), text(&t["before"]), text(&t["after"])))
            .collect();
        let typed: Vec<_> = typed.into_iter().map(|t| (t.name, t.before, t.after)).collect();
        assert_eq!(typed, want, "{heard}");
    }
}

#[test]
fn a_call_to_us_is_heard_as_the_web_hears_it() {
    let f = fixture("heardCalls.json");
    let tail = f["tail"].as_str().unwrap();
    for case in f["cases"].as_array().unwrap() {
        let heard = case["heard"].as_str().unwrap();
        assert_eq!(our_call(heard, tail), case["forUs"].as_bool().unwrap(), "{heard}");
        assert_eq!(direct_of(heard), text(&case["direct"]), "{heard}");
        assert_eq!(read(heard).maintain_ft, case["maintainFt"].as_i64(), "{heard}");
    }
}

#[test]
fn a_readback_is_checked_as_the_web_checks_it() {
    let f = fixture("readbacks.json");
    let cleared = f["cleared"].as_str().unwrap();
    for case in f["cases"].as_array().unwrap() {
        let said = case["said"].as_str().unwrap();
        let ours: Value = serde_json::from_str(&wingtip_engine::readback::check_json(cleared, said)).unwrap();
        assert_eq!(ours["items"], case["items"], "{said}");
        assert_eq!(ours["words"], case["words"], "{said}");
    }
    let fl = &f["flightLevel"];
    for case in fl["cases"].as_array().unwrap() {
        let said = case["said"].as_str().unwrap();
        let ours: Value = serde_json::from_str(&wingtip_engine::readback::check_json(fl["cleared"].as_str().unwrap(), said)).unwrap();
        assert_eq!(ours["items"], case["items"], "{said}");
    }
}

#[test]
fn the_call_signs_pattern_is_the_webs() {
    // The web's test runs the pattern over heardCalls.json with the
    // browser's own regular expressions; here that it is made for a
    // registration and not for words that are none.
    let f = fixture("heardCalls.json");
    let pattern = wingtip_engine::clearance::call_pattern(f["tail"].as_str().unwrap()).unwrap();
    assert!(pattern.starts_with("^\\W*(?:[a-z']+\\W+){0,3}?(?:"), "{pattern}");
    assert!(pattern.contains("november"), "{pattern}");
    assert_eq!(wingtip_engine::clearance::call_pattern("not a tail"), None);
    assert_eq!(wingtip_engine::clearance::call_pattern("N"), None);
}
