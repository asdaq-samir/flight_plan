//! The flight's figures held to the shared fixture the planner, the web
//! and the iOS app are held to (web/src/lib/fixtures/flightRules.json,
//! written by the planner's Python).

use serde_json::Value;
use std::path::PathBuf;
use wingtip_engine::{flight, validity, wmm};

fn fixture() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web/src/lib/fixtures/flightRules.json");
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

fn f(v: &Value, k: &str) -> f64 {
    v[k].as_f64().unwrap()
}

fn t(v: &Value, k: &str) -> Option<i64> {
    v.get(k).and_then(Value::as_i64)
}

#[test]
fn the_wind_triangle() {
    for c in fixture()["windTriangle"].as_array().unwrap() {
        let got = flight::wind_triangle(f(c, "tc"), f(c, "tas"), f(c, "windFrom"), f(c, "windKt"));
        match &c["expected"] {
            Value::Null => assert!(got.is_none(), "{c}"),
            want => {
                let (wca, th, gs) = got.unwrap_or_else(|| panic!("{c}"));
                assert!((wca - f(want, "wca")).abs() < 1e-9 && (th - f(want, "th")).abs() < 1e-9 && (gs - f(want, "gs")).abs() < 1e-9, "{c}");
            }
        }
    }
}

#[test]
fn cruising_altitudes_and_reserves() {
    let all = fixture();
    for c in all["cruisingAltitude"].as_array().unwrap() {
        assert_eq!(flight::lowest_vfr_cruising_altitude(f(c, "floorFt"), f(c, "courseDeg")), f(c, "altitudeFt"), "{c}");
        assert_eq!(flight::is_eastbound(f(c, "courseDeg")), c["eastbound"].as_bool().unwrap(), "{c}");
    }
    for c in all["reserve"].as_array().unwrap() {
        assert_eq!(flight::reserve_min(c["ifr"].as_bool().unwrap(), c["night"].as_bool().unwrap()), f(c, "minutes"));
    }
}

#[test]
fn the_atmosphere() {
    let all = fixture();
    for c in all["densityAltitude"].as_array().unwrap() {
        let da = flight::density_altitude_ft(flight::density_ratio(f(c, "pressureAltitudeFt"), f(c, "oatC")));
        assert!((da - f(c, "densityAltitudeFt")).abs() < 1e-6, "{c}");
    }
    for c in all["pressureAltitude"].as_array().unwrap() {
        assert!((flight::pressure_altitude_ft(f(c, "elevationFt"), f(c, "altimeterInHg")) - f(c, "pressureAltitudeFt")).abs() < 1e-9);
    }
}

#[test]
fn variation_and_weather_expiry() {
    let all = fixture();
    for c in all["declination"].as_array().unwrap() {
        assert!((wmm::declination(f(c, "lat"), f(c, "lon"), f(c, "year")) - f(c, "deg")).abs() < 1e-9, "{c}");
    }
    for c in all["weatherInForce"].as_array().unwrap() {
        let product = match c["product"].as_str().unwrap() {
            "metar" => validity::Product::Metar,
            "speci" => validity::Product::Speci,
            "taf" => validity::Product::Taf,
            "winds" => validity::Product::WindsAloft,
            _ => validity::Product::Advisory,
        };
        let got = validity::in_force(product, t(c, "now").unwrap(), t(c, "observed"), t(c, "lastRoutine"), t(c, "validFrom"), t(c, "validTo"));
        assert_eq!(got, c["inForce"].as_bool().unwrap(), "{}", c["why"]);
    }
}

/// The same cases asked by name, as the web's Observed and the plan's
/// winds ask them (callEngine), so the call reads its input as the rule
/// takes it.
#[test]
fn weather_expiry_asked_by_name() {
    for c in fixture()["weatherInForce"].as_array().unwrap() {
        let input = serde_json::json!({
            "product": c["product"], "now": c["now"], "observed": c.get("observed"), "last_routine": c.get("lastRoutine"),
            "valid_from": c.get("validFrom"), "valid_to": c.get("validTo"),
        });
        let got = wingtip_engine::call::call("weather_in_force", &input.to_string()).unwrap();
        assert_eq!(got, c["inForce"].as_bool().unwrap().to_string(), "{}", c["why"]);
    }
    // A METAR observed at 10,000 s stops counting when the next hourly one
    // is due (AIM 7-1-28, "METAR-hourly").
    let expires = wingtip_engine::call::call("weather_expires_at", r#"{"product":"metar","observed":10000}"#).unwrap();
    assert_eq!(expires.parse::<f64>().unwrap(), 13_600.0);
    assert_eq!(wingtip_engine::call::call("weather_expires_at", r#"{"product":"taf"}"#).unwrap(), "null");
}
