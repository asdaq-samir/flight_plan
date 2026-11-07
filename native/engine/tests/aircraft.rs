//! The traffic list's filters and the registry's airplanes
//! (wingtip_engine::aircraft), held to the cases the web's lib/fbo and
//! lib/aircraftChoice tests and the iPhone's RegisteredTests hold their
//! copies to.

use serde_json::{json, Value};
use wingtip_engine::aircraft::filters::{self, Plane, Relation};
use wingtip_engine::aircraft::registry::{is_n_number, profile_of};
use wingtip_engine::call::call;

fn ask(name: &str, input: Value) -> Value {
    serde_json::from_str(&call(name, &input.to_string()).unwrap()).unwrap()
}

// --- The traffic list's filters ----------------------------------------------

#[test]
fn what_an_airplane_is_by_its_emitter_category() {
    // GDL 90 ICD Rev A, Table 11: A1 under 15,500 lb, A2 to 75,000, A3 to
    // 300,000, A4 a B757, A5 over 300,000, A6 highly maneuverable, A7
    // rotorcraft.
    let kinds: Vec<Value> = [json!("A1"), json!("A2"), json!("A3"), json!("A4"), json!("A5"), json!("A6"), json!("A7"), Value::Null]
        .into_iter()
        .map(|c| ask("traffic_kind", json!({"category": c})))
        .collect();
    assert_eq!(kinds, ["light", "small", "large", "large", "large", "other", "helicopter", "other"]);
}

#[test]
fn its_heights_band_each_side_of_class_a() {
    // Class A from 18,000 ft MSL (14 CFR 71.33(a)).
    let bands: Vec<Value> = [json!(2500), json!(9500), json!(17_999), json!(18_000), Value::Null]
        .into_iter()
        .map(|a| ask("altitude_band", json!({"altitude_ft": a})))
        .collect();
    assert_eq!(bands, [json!("low"), json!("mid"), json!("high"), json!("flight-levels"), Value::Null]);
}

#[test]
fn its_operator_from_an_airlines_callsign() {
    assert_eq!(ask("operator_of", json!({"callsign": "UAL2088 "})), "UAL");
    assert_eq!(ask("operator_of", json!({"callsign": "N174HA"})), Value::Null);
    assert_eq!(ask("operator_of", json!({"callsign": null})), Value::Null);
}

#[test]
fn an_emergency_squawked_or_sent() {
    // 7700 an emergency (AIM 6-2-2), 7500 unlawful interference (6-3-4),
    // 7600 a radio failed (6-4-2); 1200, VFR, none.
    let said: Vec<Value> =
        ["7700", "7500", "7600", "1200", "7777"].iter().map(|s| ask("in_emergency", json!({"squawk": s, "emergency": null}))).collect();
    assert_eq!(said, [true, true, true, false, false]);
    assert_eq!(ask("in_emergency", json!({"squawk": "1200", "emergency": "general"})), true);
}

#[test]
fn a_filter_keeps_by_kind_band_operator_and_emergency_together() {
    let united = json!({"callsign": "UAL2088", "category": "A3", "altitude_ft": 7000});
    let filter = |kind: &str, band: &str, operator: &str, emergency: bool| {
        json!({"kind": kind, "band": band, "operator": operator, "emergency": emergency})
    };
    assert_eq!(ask("traffic_matches", json!({"plane": united, "filter": filter("large", "mid", "UAL", false)})), true);
    assert_eq!(ask("traffic_matches", json!({"plane": united, "filter": filter("light", "any", "", false)})), false);
    assert_eq!(ask("traffic_matches", json!({"plane": united, "filter": filter("any", "any", "", true)})), false);
}

const LWM: (f64, f64, f64) = (42.7172, -71.1234, 148.0);

fn plane(lat: f64, altitude_ft: f64, track_deg: f64, vertical_fpm: f64) -> Plane {
    Plane { lat, lon: -71.12, altitude_ft: Some(altitude_ft), track_deg: Some(track_deg), vertical_fpm: Some(vertical_fpm) }
}

fn relation(p: &Plane) -> Relation {
    filters::relation_to(p, LWM.0, LWM.1, LWM.2)
}

#[test]
fn inbound_departing_and_about_a_field_from_position_track_and_climb() {
    // 11 nm north of Lawrence, heading south and coming down: inbound.
    assert_eq!(relation(&plane(42.9, 3000.0, 180.0, -500.0)), Relation { around: false, inbound: true, departing: false });
    // The same going north and climbing: departing.
    assert_eq!(relation(&plane(42.9, 3000.0, 0.0, 700.0)), Relation { around: false, inbound: false, departing: true });
    // High overhead, passing: neither.
    let high = relation(&plane(42.9, 25_000.0, 180.0, -500.0));
    assert!(!high.inbound && !high.departing);
    // In the pattern, low and close: about it, and in.
    let close = relation(&plane(42.75, 1100.0, 180.0, 0.0));
    assert!(close.around && close.inbound);
    // Through the call, as the web asks it.
    assert_eq!(
        ask(
            "field_relation",
            json!({"plane": {"lat": 42.9, "lon": -71.12, "altitude_ft": 3000, "track_deg": 180, "vertical_fpm": -500},
                   "field": {"lat": LWM.0, "lon": LWM.1, "elevation_ft": LWM.2}})
        ),
        json!({"around": false, "inbound": true, "departing": false})
    );
    // With no track, only whether it is about the field.
    let no_track = Plane { track_deg: None, ..plane(42.75, 1100.0, 0.0, 0.0) };
    assert_eq!(relation(&no_track), Relation { around: true, inbound: false, departing: false });
}

// --- The registry's airplanes ------------------------------------------------

#[test]
fn an_n_number_is_told_by_its_shape() {
    // 14 CFR 47.15(b): the web's and the iPhone's cases.
    for n in ["N3429J", "N1", "N12345", "N172SP", "N1234Z", "N123AB", "N9"] {
        assert!(is_n_number(n), "{n}");
        assert_eq!(ask("n_number", json!({"text": n})), true);
    }
    // Letters before figures, three letters, six symbols, a leading zero,
    // the letters I and O, and other words: none.
    for n in ["N0123", "N123456", "C172", "KDLH", "N", "N1A2B", "N12ABC", "NABCD", "N1234AB", "N12I", "N1O", "n172sp", " N172SP"] {
        assert!(!is_n_number(n), "{n}");
    }
}

#[test]
fn a_registered_type_flies_on_its_stock_profile() {
    let p = |maker: &str, model: &str, year: Option<f64>| profile_of(Some(maker), Some(model), year);
    assert_eq!(p("Cessna", "172S", None), Some("c172"));
    assert_eq!(p("CESSNA", "172", None), Some("c172"));
    assert_eq!(p("Piper", "PA-28-181", None), Some("pa28"));
    assert_eq!(p("Cessna", "150G", None), Some("c150"));
    assert_eq!(p("Cessna", "A152", None), Some("c152"));
    assert_eq!(p("Cessna", "182T", None), Some("c182"));
    assert_eq!(p("Piper", "PA-28-140", Some(1971.0)), Some("pa28140"));
    assert_eq!(p("Piper", "PA-28-140", Some(1975.0)), Some("pa28140cruiser"));
    // No year: the Cruiser's, the lower ceiling.
    assert_eq!(p("Piper", "PA-28-140", None), Some("pa28140cruiser"));
    assert_eq!(p("Cirrus Design Corp", "SR22", None), Some("sr22"));
    assert_eq!(p("Diamond Aircraft IND Inc", "DA 40 NG", None), Some("da40ng"));
    assert_eq!(p("Piper", "PA-28-161", None), Some("pa28161"));
    assert_eq!(p("Piper", "PA-28R-201", None), Some("pa28r201"));
    assert_eq!(p("Mooney", "M20J", None), Some("m20j"));
    assert_eq!(p("Cessna", "FA150L", None), Some("c150"));
    assert_eq!(p("Cessna", "F150M", None), Some("c150"));
    // A model sharing the name but not the figures: none.
    for (maker, model) in [
        ("Cessna", "R182"),
        ("Cessna", "T182T"),
        ("Piper", "PA-28-180"),
        ("Cirrus Design Corp", "SR22T"),
        ("Diamond Aircraft IND Inc", "DA 40"),
        ("Piper", "PA-28R-201T"),
        ("Beech", "A36"),
        ("Cessna", "150N"),
    ] {
        assert_eq!(p(maker, model, None), None, "{maker} {model}");
    }
    assert_eq!(ask("registered_profile", json!({"manufacturer": "Piper", "model": "PA-28-140", "year": 1971})), "pa28140");
    assert_eq!(ask("registered_profile", json!({})), Value::Null);
}

#[test]
fn an_emitter_category_by_its_do_260b_name() {
    // GDL 90 Table 11's categories, as the kept airplanes' shapes read them.
    let named: Vec<Value> =
        ["A1", "A3", "A6", "A7", "B1", "B2", "B5", ""].iter().map(|c| ask("emitter_category", json!({"category": c}))).collect();
    assert_eq!(
        named,
        [json!("light"), json!("large"), json!("high_performance"), json!("rotorcraft"), json!("glider"), json!("lighter_than_air"), Value::Null, Value::Null]
    );
    assert_eq!(ask("emitter_category", json!({})), Value::Null);
}

#[test]
fn a_squawk_says_what_it_means() {
    // 7500 unlawful interference (AIM 6-3-4), 7600 two-way radio failure
    // (AIM 6-4-2), 7700 an emergency (AIM 6-2-2); 7777 and 1200 nothing.
    let said: Vec<Value> = ["7500", "7600", "7700", "7777", "1200"].iter().map(|s| ask("squawk_meaning", json!({"squawk": s}))).collect();
    assert_eq!(said, [json!("hijack"), json!("lost radio"), json!("emergency"), Value::Null, Value::Null]);
    assert_eq!(ask("squawk_meaning", json!({"squawk": null})), Value::Null);
}
