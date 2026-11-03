//! A field's weather as the app says it (wingtip_engine::forecast), held
//! to the cases the web's lib/map/flightCategory and lib/hourly tests and
//! the planner's tests/test_glmp.py hold their copies to.

use serde_json::{json, Value};
use wingtip_engine::call::call;
use wingtip_engine::forecast::{self, Figures, Group};
use wingtip_engine::metar;

fn ask(name: &str, input: Value) -> Value {
    serde_json::from_str(&call(name, &input.to_string()).unwrap()).unwrap()
}

fn category(ceiling: Value, visibility: Value) -> Value {
    ask("flight_category", json!({"ceiling_ft": ceiling, "visibility_sm": visibility}))
}

// --- The flight category ----------------------------------------------------

// Each bound of AIM 7-1-7's categories, from either side.
#[test]
fn the_ceilings_bounds_with_the_visibility_clear() {
    let said: Vec<Value> = [499, 500, 999, 1000, 3000, 3001].iter().map(|&c| category(json!(c), json!(10))).collect();
    assert_eq!(said, ["LIFR", "IFR", "IFR", "MVFR", "MVFR", "VFR"]);
}

#[test]
fn the_visibilitys_bounds_with_no_ceiling() {
    let said: Vec<Value> = [0.75, 1.0, 2.75, 3.0, 5.0, 6.0].iter().map(|&v| category(Value::Null, json!(v))).collect();
    assert_eq!(said, ["LIFR", "IFR", "IFR", "MVFR", "MVFR", "VFR"]);
}

#[test]
fn the_worse_of_the_two_and_nothing_known_none() {
    assert_eq!(category(json!(5000), json!(2)), "IFR");
    assert_eq!(category(json!(800), json!(10)), "IFR");
    assert_eq!(category(Value::Null, Value::Null), Value::Null);
    assert_eq!(ask("flight_category", json!({})), Value::Null);
}

#[test]
fn with_no_visibility_only_what_the_ceiling_decides_alone() {
    assert_eq!(category(json!(400), Value::Null), "LIFR");
    assert_eq!(category(json!(800), Value::Null), Value::Null);
    assert_eq!(category(json!(5000), Value::Null), Value::Null);
}

#[test]
fn the_glmp_cases_are_the_aims() {
    // tests/test_glmp.py's, the modelled weather's categories.
    for (c, v, want) in [
        (None, 10.0, "VFR"),
        (Some(3100.0), 6.0, "VFR"),
        (Some(3000.0), 10.0, "MVFR"),
        (None, 5.0, "MVFR"),
        (Some(1000.0), 10.0, "MVFR"),
        (Some(999.0), 10.0, "IFR"),
        (None, 2.9, "IFR"),
        (Some(500.0), 10.0, "IFR"),
        (Some(499.0), 10.0, "LIFR"),
        (None, 0.9, "LIFR"),
    ] {
        assert_eq!(forecast::category_of(c, Some(v)), Some(want), "{c:?} ft, {v} sm");
    }
}

#[test]
fn with_a_visibility_it_is_the_metar_readers_category() {
    // The one set of bounds: a METAR's category (AC 00-45H) wherever the
    // visibility is known.
    for c in [None, Some(0.0), Some(499.0), Some(500.0), Some(999.0), Some(1000.0), Some(3000.0), Some(3001.0)] {
        for v in [0.0, 0.5, 1.0, 2.9, 3.0, 5.0, 5.1, 10.0] {
            assert_eq!(forecast::category_of(c, Some(v)), metar::flight_category(c, Some(v)));
        }
    }
}

#[test]
fn the_largest_number_is_no_limit() {
    // The web sends an unlimited figure (Infinity, which JSON has not) as
    // the largest number.
    assert_eq!(category(json!(f64::MAX), json!(f64::MAX)), "VFR");
    assert_eq!(category(json!(800), json!(f64::MAX)), "IFR");
}

#[test]
fn a_figure_not_a_number_is_refused() {
    assert!(call("flight_category", r#"{"ceiling_ft": "low"}"#).is_err());
}

// --- An hour of a TAF -------------------------------------------------------

fn figs(category: Option<&str>, gust_kt: Option<f64>, thunder: bool) -> Figures {
    Figures { category: category.map(str::to_owned), gust_kt, thunder }
}

#[test]
fn a_becmg_under_way_is_the_worse_of_before_and_after() {
    // BECMG 2922/2924 OVC012 from BKN040: at 23Z still VFR before, MVFR after.
    let after = figs(Some("MVFR"), None, false);
    let before = figs(Some("VFR"), None, false);
    assert!(!forecast::hour(&after, true, Some(&before), &[]).before_worse);
    // Getting better (BECMG to P6SM SCT030 from MVFR): MVFR until it is done.
    let better = figs(Some("VFR"), None, false);
    let worse = figs(Some("MVFR"), None, false);
    assert!(forecast::hour(&better, true, Some(&worse), &[]).before_worse);
    // Done, it is the new weather.
    assert!(!forecast::hour(&better, false, Some(&worse), &[]).before_worse);
}

#[test]
fn a_tempo_is_the_weather_at_times_where_worse() {
    let prevailing = figs(Some("VFR"), None, false);
    let tempo = Group { figures: figs(Some("IFR"), Some(30.0), true), chance: false };
    let h = forecast::hour(&prevailing, false, None, &[tempo]);
    assert_eq!(h.at_times.as_deref(), Some("IFR"));
    assert_eq!(h.at_times_gust_kt, Some(30.0));
    assert!(h.at_times_thunder);
    assert!(!h.at_times_chance);
    // No better than the prevailing: nothing at times.
    let same = Group { figures: figs(Some("VFR"), None, false), chance: false };
    assert_eq!(forecast::hour(&prevailing, false, None, &[same]).at_times, None);
}

#[test]
fn a_prob_is_a_chance_until_a_tempo_says_the_same() {
    let prevailing = figs(Some("VFR"), None, false);
    let prob = Group { figures: figs(Some("MVFR"), None, false), chance: true };
    let h = forecast::hour(&prevailing, false, None, std::slice::from_ref(&prob));
    assert_eq!((h.at_times.as_deref(), h.at_times_chance), (Some("MVFR"), true));
    let tempo = Group { figures: figs(Some("MVFR"), None, false), chance: false };
    let h = forecast::hour(&prevailing, false, None, &[prob.clone(), tempo]);
    assert_eq!((h.at_times.as_deref(), h.at_times_chance), (Some("MVFR"), false));
    // A worse PROB after a TEMPO: the worse, as a chance.
    let tempo = Group { figures: figs(Some("MVFR"), None, false), chance: false };
    let worse = Group { figures: figs(Some("IFR"), None, false), chance: true };
    let h = forecast::hour(&prevailing, false, None, &[tempo, worse]);
    assert_eq!((h.at_times.as_deref(), h.at_times_chance), (Some("IFR"), true));
}

#[test]
fn gusts_and_thunder_at_times_only_beyond_the_prevailing() {
    let prevailing = figs(Some("MVFR"), Some(25.0), true);
    let tempo = Group { figures: figs(Some("MVFR"), Some(20.0), true), chance: false };
    let h = forecast::hour(&prevailing, false, None, &[tempo]);
    assert_eq!(h.at_times_gust_kt, None);
    assert!(!h.at_times_thunder);
    // A BECMG's weather before, thunder in it, is what the TEMPO is held to.
    let after = figs(Some("VFR"), None, false);
    let before = figs(Some("IFR"), None, true);
    let tempo = Group { figures: figs(None, None, true), chance: false };
    let h = forecast::hour(&after, true, Some(&before), &[tempo]);
    assert!(h.before_worse);
    assert!(!h.at_times_thunder);
}

#[test]
fn the_hour_through_the_call() {
    let answer = ask(
        "taf_hour",
        json!({"prevailing": {"category": "VFR", "gust_kt": null, "thunder": false}, "becoming": false,
               "supplemental": [{"category": "IFR", "gust_kt": 28, "thunder": false, "chance": true}]}),
    );
    assert_eq!(
        answer,
        json!({"before_worse": false, "at_times": "IFR", "at_times_gust_kt": 28.0, "at_times_thunder": false, "at_times_chance": true})
    );
    assert!(call("taf_hour", "{}").is_err());
}
