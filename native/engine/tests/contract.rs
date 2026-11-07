//! The engine against its contract (native/contract/engine.schema.json),
//! the one statement of every call's input and answer that the web's types
//! (web/src/lib/engine/contract.ts) are generated from: every name the
//! engine dispatches has its entry there and no other does, and the answers
//! to the shared fixtures (web/src/lib/fixtures), asked as the hosts ask,
//! are of the shapes it gives. A member renamed in Rust then fails here,
//! not on the phone.

use serde_json::{json, Map, Value};
use std::collections::BTreeSet;
use std::path::PathBuf;
use wingtip_engine::call::call;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn read_json(path: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(root().join(path)).unwrap_or_else(|e| panic!("{path}: {e}"))).unwrap()
}

fn contract() -> Value {
    read_json("native/contract/engine.schema.json")
}

fn fixture(name: &str) -> Value {
    read_json(&format!("web/src/lib/fixtures/{name}"))
}

fn schema_names() -> BTreeSet<String> {
    contract()["properties"].as_object().unwrap().keys().cloned().collect()
}

/// The names in a module's `NAMES` list.
fn names_const(src: &str) -> BTreeSet<String> {
    let start = src.find("pub const NAMES").expect("a NAMES list");
    // Past the type's `[&str; n]`, from the `=` to the list's end.
    let open = start + src[start..].find('=').unwrap();
    let list = &src[open..open + src[open..].find("];").unwrap()];
    quoted(list)
}

/// The string literals in `text`.
fn quoted(text: &str) -> BTreeSet<String> {
    text.split('"').skip(1).step_by(2).map(str::to_owned).collect()
}

/// The names a dispatching `fn` matches on: its arms that are only string
/// literals, alone or joined by `|`, before `=>` (or running on to the
/// next line, as call.rs lists the runway rules).
fn arms(src: &str, start: &str) -> BTreeSet<String> {
    let at = src.find(start).unwrap_or_else(|| panic!("no {start:?}"));
    let body = &src[at..at + src[at..].find("\n}\n").unwrap()];
    let mut out = BTreeSet::new();
    for line in body.lines() {
        let pattern = line.split("=>").next().unwrap().trim().trim_start_matches('|').trim();
        let pieces: Vec<&str> = pattern.split('|').map(str::trim).filter(|p| !p.is_empty()).collect();
        let literal = |p: &&str| p.len() > 2 && p.starts_with('"') && p.ends_with('"') && p[1..p.len() - 1].chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
        if !pieces.is_empty() && pieces.iter().all(literal) {
            out.extend(pieces.iter().map(|p| p[1..p.len() - 1].to_owned()));
        }
    }
    out
}

/// Every name the engine answers, read from its source, not its doc: the
/// arms of call.rs's `call`, of motion's and the Go / No-Go's (which have no
/// list), and the NAMES of the modules call.rs asks by them.
fn code_names() -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    names.extend(arms(include_str!("../src/call.rs"), "pub fn call("));
    names.extend(arms(include_str!("../../crates/route/src/motion/mod.rs"), "pub fn call("));
    names.extend(arms(include_str!("../../crates/brief/src/gonogo/calls.rs"), "pub fn call("));
    for src in [
        include_str!("../../crates/wording/src/wording/mod.rs"),
        include_str!("../../crates/weather/src/forecast/calls.rs"),
        include_str!("../../crates/pilot/src/aircraft/calls.rs"),
        include_str!("../../crates/route/src/approach/calls.rs"),
        include_str!("../../crates/route/src/route/answers.rs"),
    ] {
        names.extend(names_const(src));
    }
    names
}

#[test]
fn every_name_dispatched_is_in_the_contract_and_no_other() {
    let code = code_names();
    let schema = schema_names();
    let missing: Vec<_> = code.difference(&schema).collect();
    let extra: Vec<_> = schema.difference(&code).collect();
    assert!(missing.is_empty(), "the engine answers these, and the contract has no entry for them: {missing:?}");
    assert!(extra.is_empty(), "the contract has these, and the engine dispatches no such name: {extra:?}");
    // The reading of the source finds real names: each is one the engine
    // knows (asked with nothing, it may refuse the input, never the name).
    for name in &code {
        if let Err(e) = call(name, "{}") {
            assert!(!e.contains("has no rule called"), "{name}: {e}");
        }
    }
    let required: BTreeSet<String> = contract()["required"].as_array().unwrap().iter().map(|n| n.as_str().unwrap().to_owned()).collect();
    assert_eq!(required, schema, "every name is required in the contract");
}

/// The contract with no name required, so one call at a time is checked
/// against it: `{name: {"input", "answer"}}`.
struct Checker {
    validator: jsonschema::Validator,
    checked: BTreeSet<String>,
}

impl Checker {
    fn new() -> Self {
        let mut schema = contract();
        schema["required"] = json!([]);
        Checker { validator: jsonschema::draft7::new(&schema).expect("the contract is a draft 7 schema"), checked: BTreeSet::new() }
    }

    /// The rule `name` asked `input`, the input and the answer held to the
    /// contract; the answer.
    fn ask(&mut self, name: &str, input: Value) -> Value {
        let text = call(name, &input.to_string()).unwrap_or_else(|e| panic!("{name}: {e}"));
        let answer: Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{name} answered {text}: {e}"));
        let mut asked = Map::new();
        asked.insert(name.to_owned(), json!({ "input": input, "answer": answer }));
        let asked = Value::Object(asked);
        let errors: Vec<String> = self.validator.iter_errors(&asked).map(|e| format!("{} at {}", e, e.instance_path)).collect();
        assert!(errors.is_empty(), "{name}: not of the contract's shape:\n{}\ninput {input}\nanswer {answer}", errors.join("\n"));
        self.checked.insert(name.to_owned());
        answer
    }
}

#[test]
fn the_shared_fixtures_answers_are_of_the_contracts_shapes() {
    let mut c = Checker::new();

    for case in fixture("atis.json")["cases"].as_array().unwrap() {
        c.ask("read_atis", json!({ "text": case["heard"] }));
    }

    let clearances = fixture("clearances.json");
    for case in clearances["read"].as_array().unwrap() {
        c.ask("read_clearance", json!({ "text": case["heard"] }));
    }
    for case in clearances["numbers"].as_array().unwrap() {
        let tokens = c.ask("tokens", json!({ "text": case["heard"] }));
        c.ask("place_words", json!({ "tokens": tokens }));
        c.ask("direct_of", json!({ "text": case["heard"] }));
    }
    for case in clearances["routes"].as_array().unwrap() {
        c.ask("cleared_route", json!({ "text": case["heard"], "found": case["found"], "planned": case["planned"] }));
    }

    let heard = fixture("heardCalls.json");
    for case in heard["cases"].as_array().unwrap() {
        c.ask("our_call", json!({ "text": case["heard"], "tail": heard["tail"] }));
        c.ask("direct_of", json!({ "text": case["heard"] }));
    }
    c.ask("call_pattern", json!({ "tail": heard["tail"] }));

    let readbacks = fixture("readbacks.json");
    for case in readbacks["cases"].as_array().unwrap() {
        c.ask("readback_check", json!({ "cleared": readbacks["cleared"], "said": case["said"] }));
    }
    for case in readbacks["flightLevel"]["cases"].as_array().unwrap() {
        c.ask("readback_check", json!({ "cleared": readbacks["flightLevel"]["cleared"], "said": case["said"] }));
    }

    for case in fixture("checklist.json")["cases"].as_array().unwrap() {
        let read = c.ask("checklist_read", json!({ "text": case["text"] }));
        c.ask("checklist_write", json!({ "checklist": read }));
        c.ask("checklist_write", json!({ "checklist": case["checklist"] }));
    }

    let logbook = fixture("logbookCsv.json");
    for case in logbook["export"].as_array().unwrap() {
        c.ask("logbook_csv_write", json!({ "entries": case["entries"] }));
        c.ask("csv_rows", json!({ "text": case["csv"] }));
    }
    for case in logbook["import"].as_array().unwrap() {
        c.ask("logbook_csv_read", json!({ "text": case["text"] }));
    }

    let holds = fixture("holds.json");
    for case in holds["parse"].as_array().unwrap() {
        let read = c.ask("hold_read", json!({ "text": case["text"] }));
        c.ask("holds_read", json!({ "text": case["text"] }));
        if !read.is_null() {
            c.ask("hold_write", json!({ "hold": read }));
            c.ask("hold_figures", json!({ "hold": read, "tas_kt": 100 }));
        }
    }
    for case in holds["legMinutes"].as_array().unwrap() {
        c.ask("holding_leg_minutes", json!({ "altitude_ft": case["altitudeFt"] }));
    }

    for case in fixture("lostComms.json")["leaveLimit"].as_array().unwrap() {
        c.ask(
            "lost_comms",
            json!({
                "segments": [{ "name": "V97", "minimum_ft": 4000 }, { "name": "V82", "minimum_ft": 6000 }],
                "assigned_ft": 5000,
                "expected_ft": 7000,
                "expected_from": 1,
                "approach_fix": case["approachFix"],
                "efc": case["efc"],
                "eta": case["eta"],
            }),
        );
    }

    for case in fixture("traffic.json")["cases"].as_array().unwrap() {
        c.ask("traffic_marks", json!({ "own_ft": case["ownFt"], "planes": [case["plane"]] }));
    }

    let rules = fixture("flightRules.json");
    for case in rules["windTriangle"].as_array().unwrap() {
        c.ask("wind_triangle", json!({ "tc": case["tc"], "tas": case["tas"], "wind_from_deg": case["windFrom"], "wind_kt": case["windKt"] }));
    }
    for case in rules["densityAltitude"].as_array().unwrap() {
        c.ask("gonogo_density_altitude", json!({ "pressure_alt_ft": case["pressureAltitudeFt"], "temp_c": case["oatC"] }));
    }
    for case in rules["pressureAltitude"].as_array().unwrap() {
        c.ask("gonogo_field_air", json!({ "elevation_ft": case["elevationFt"], "altimeter_in_hg": case["altimeterInHg"], "temp_c": 15 }));
    }
    for case in rules["declination"].as_array().unwrap() {
        c.ask("magnetic_variation", json!({ "lat": case["lat"], "lon": case["lon"], "date": "2026-07-01" }));
    }
    for case in fixture("dataCycles.json")["cases"].as_array().unwrap() {
        c.ask("data_cycle", json!({ "kind": case["kind"], "effective": case["effective"], "on": case["on"] }));
    }
    for case in rules["weatherInForce"].as_array().unwrap() {
        let at = |k: &str| case.get(k).cloned().unwrap_or(Value::Null);
        c.ask("weather_in_force", json!({ "product": case["product"], "now": case["now"], "observed": at("observed"),
            "last_routine": at("lastRoutine"), "valid_from": at("validFrom"), "valid_to": at("validTo") }));
        c.ask("weather_expires_at", json!({ "product": case["product"], "observed": at("observed"),
            "last_routine": at("lastRoutine"), "valid_to": at("validTo") }));
    }
    for case in fixture("dataCycles.json")["cases"].as_array().unwrap() {
        c.ask("data_cycle", json!({ "kind": case["kind"], "effective": case["effective"], "on": case["on"] }));
    }

    // The planner's rules moved in (#482 phase 0).
    let planner = fixture("plannerRules.json");
    for case in planner["airspaceColumn"].as_array().unwrap() {
        c.ask("airspace_column", json!({ "ground_ft": case["ground_ft"], "volumes": case["volumes"], "in_veil": case["in_veil"] }));
    }
    for case in planner["modeCVeil"].as_array().unwrap() {
        c.ask("mode_c_veil", json!({ "lat": case["lat"], "lon": case["lon"], "airports": case["airports"] }));
    }
    for case in planner["notamsFns"].as_array().unwrap() {
        c.ask("notams_fns", json!({ "text": case["text"] }));
    }
    for case in planner["hazardWindow"].as_array().unwrap() {
        c.ask("gonogo_hazard_window", json!({ "enter": case["enter"], "leave": case["leave"], "valid_from": case["valid_from"], "valid_to": case["valid_to"] }));
    }
    for case in planner["ceiling"].as_array().unwrap() {
        c.ask("ceiling_ft", json!({ "layers": case["layers"], "vert_vis_ft": case["vert_vis_ft"] }));
        c.ask("sky_ceiling", json!({ "layers": case["layers"], "vert_vis_ft": case["vert_vis_ft"] }));
    }
    c.ask("sky_ceiling", json!({ "layers": [{ "cover": "OVC", "base_ft": null }], "vert_vis_ft": null }));
    c.ask("report_flight_category", json!({ "ceiling_ft": null, "ceiling_unknown": true, "visibility_sm": 10 }));
    for case in planner["reportCategory"].as_array().unwrap() {
        c.ask("report_flight_category", json!({ "ceiling_ft": case["ceiling_ft"], "visibility_sm": case["visibility_sm"] }));
    }
    for case in planner["words"].as_array().unwrap() {
        let n = &case["n"];
        c.ask("words_num", json!({ "n": n }));
        c.ask("words_alt_ft", json!({ "ft": n }));
        c.ask("words_flight_level", json!({ "ft": n }));
        c.ask("words_ceiling_and_visibility", json!({ "ceiling_ft": n, "visibility_sm": 3 }));
        if !n.is_null() {
            c.ask("words_one", json!({ "n": n }));
            c.ask("words_to_fixed", json!({ "n": n, "digits": 2 }));
            c.ask("words_grouped", json!({ "n": n }));
        }
    }
    c.ask("notam_text", json!({ "text": "!ORD 10/709 ORD RWY 04L/22R CLSD EXC TAX 2610191016-2610201100EST" }));
    c.ask("notam_text", json!({ "text": "not a notam" }));
    c.ask("metar_read", json!({ "raw": "METAR KDLH 021355Z 27012G20KT 10SM BKN008 OVC015 M02/M05 A2992" }));
    c.ask("metar_read", json!({ "raw": "nothing" }));
    c.ask("taf_read", json!({ "raw": "TAF KDLH 021130Z 0212/0312 27012KT P6SM BKN030", "near": 1_793_000_000 }));
    c.ask("vfr_basic_minimums", json!({}));
    c.ask("reserve_min", json!({ "ifr": false, "night": true }));
    c.ask("isa_temp_c", json!({ "altitude_ft": 4500 }));
    c.ask("density_ratio", json!({ "altitude_ft": 4500, "oat_c": 25 }));
    c.ask("density_altitude_ft", json!({ "sigma": 0.85 }));
    c.ask("pressure_altitude_ft", json!({ "elevation_ft": 1200, "altimeter_inhg": 30.12 }));
    c.ask("is_eastbound", json!({ "magnetic_course_deg": 95 }));
    c.ask("lowest_vfr_cruising_altitude", json!({ "floor_ft": 3200, "magnetic_course_deg": 270 }));
    c.ask("distance_nm", json!({ "lat1": 46.84, "lon1": -92.19, "lat2": 38.75, "lon2": -90.37 }));
    c.ask("region_of", json!({ "lat": 41.9, "lon": -87.9 }));
    c.ask("descent_ft_per_nm", json!({}));

    // The approaches at KBUR, as the planner's /api/procedure draws them.
    let kbur = fixture("approachKbur.json");
    for (id, drawing) in kbur.as_object().unwrap() {
        c.ask("approach_guidance", json!({ "id": drawing["id"] }));
        c.ask("approach_profile", json!({ "drawing": drawing }));
        c.ask("approach_brief", json!({ "drawing": drawing, "vref_kt": 65, "vso_kt": 48 }));
        c.ask("approach_coaching", json!({ "drawing": drawing, "gs_kt": 90 }));
        c.ask("approach_quiz", json!({ "drawing": drawing, "gs_kt": 90 }));
        c.ask("approach_missed_words", json!({ "legs": drawing["missed_legs"] }));
        c.ask("approach_minimums_kind", json!({ "name": drawing["name"] }));
        let path = c.ask("approach_lesson_path", json!({ "drawing": drawing }));
        assert!(path.is_array(), "{id}");
    }

    // Every fixture above was asked, and these are the names it reaches:
    // a name dropped from it fails here rather than going unchecked.
    assert!(c.checked.len() >= 30, "only {} names were checked: {:?}", c.checked.len(), c.checked);
}
