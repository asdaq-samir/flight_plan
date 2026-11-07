//! The aircraft rules as crate::call answers them, JSON in and out; the
//! names and their inputs are listed in call.rs with the others.

use super::filters::{self, Filter, Heard, Plane};
use super::registry;
use crate::json::{self, Value};

/// The names this module answers.
pub const NAMES: [&str; 10] = [
    "traffic_kind",
    "emitter_category",
    "altitude_band",
    "operator_of",
    "in_emergency",
    "squawk_meaning",
    "field_relation",
    "traffic_matches",
    "n_number",
    "registered_profile",
];

type R<T> = Result<T, String>;

fn opt_num(name: &str, v: &Value, key: &str) -> R<Option<f64>> {
    match v.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => Ok(Some(*n)),
        Some(_) => Err(format!("{name}: \"{key}\" is not a number")),
    }
}

fn num(name: &str, v: &Value, key: &str) -> R<f64> {
    opt_num(name, v, key)?.ok_or_else(|| format!("{name}: \"{key}\" is missing"))
}

fn opt_str<'a>(name: &str, v: &'a Value, key: &str) -> R<Option<&'a str>> {
    match v.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s)),
        Some(_) => Err(format!("{name}: \"{key}\" is not a string")),
    }
}

fn object<'a>(name: &str, v: &'a Value, key: &str) -> R<&'a Value> {
    match v.get(key) {
        Some(o @ Value::Object(_)) => Ok(o),
        _ => Err(format!("{name}: \"{key}\" is missing or not an object")),
    }
}

/// An emergency sent in an airplane's ADS-B: any word ("general",
/// "nordo") or true; none where missing, null, empty or false.
fn emergency_sent(v: &Value) -> bool {
    match v.get("emergency") {
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Bool(b)) => *b,
        _ => false,
    }
}

fn flag(out: &mut String, b: bool) {
    out.push_str(if b { "true" } else { "false" });
}

/// The rule `name` worked on `v`.
pub fn call(name: &str, v: &Value) -> R<String> {
    let mut out = String::new();
    match name {
        "traffic_kind" => json::string(&mut out, filters::kind_of(opt_str(name, v, "category")?)),
        "altitude_band" => json::opt_string(&mut out, filters::band_of(opt_num(name, v, "altitude_ft")?)),
        "operator_of" => json::opt_string(&mut out, filters::operator_of(opt_str(name, v, "callsign")?).as_deref()),
        "emitter_category" => json::opt_string(&mut out, filters::emitter(opt_str(name, v, "category")?)),
        "in_emergency" => flag(&mut out, filters::in_emergency(opt_str(name, v, "squawk")?, emergency_sent(v))),
        "squawk_meaning" => json::opt_string(&mut out, filters::squawk_meaning(opt_str(name, v, "squawk")?)),
        "field_relation" => {
            let p = object(name, v, "plane")?;
            let f = object(name, v, "field")?;
            let plane = Plane {
                lat: num(name, p, "lat")?,
                lon: num(name, p, "lon")?,
                altitude_ft: opt_num(name, p, "altitude_ft")?,
                track_deg: opt_num(name, p, "track_deg")?,
                vertical_fpm: opt_num(name, p, "vertical_fpm")?,
            };
            let r = filters::relation_to(&plane, num(name, f, "lat")?, num(name, f, "lon")?, num(name, f, "elevation_ft")?);
            out.push_str("{\"around\":");
            flag(&mut out, r.around);
            out.push_str(",\"inbound\":");
            flag(&mut out, r.inbound);
            out.push_str(",\"departing\":");
            flag(&mut out, r.departing);
            out.push('}');
        }
        "traffic_matches" => {
            let p = object(name, v, "plane")?;
            let f = object(name, v, "filter")?;
            let plane = Heard {
                category: opt_str(name, p, "category")?.map(str::to_owned),
                altitude_ft: opt_num(name, p, "altitude_ft")?,
                callsign: opt_str(name, p, "callsign")?.map(str::to_owned),
                squawk: opt_str(name, p, "squawk")?.map(str::to_owned),
                emergency: emergency_sent(p),
            };
            let filter = Filter {
                kind: opt_str(name, f, "kind")?.unwrap_or("any").to_owned(),
                band: opt_str(name, f, "band")?.unwrap_or("any").to_owned(),
                operator: opt_str(name, f, "operator")?.unwrap_or("").to_owned(),
                emergency: matches!(f.get("emergency"), Some(Value::Bool(true))),
            };
            flag(&mut out, filters::matches(&plane, &filter));
        }
        "n_number" => flag(&mut out, registry::is_n_number(opt_str(name, v, "text")?.unwrap_or(""))),
        "registered_profile" => json::opt_string(
            &mut out,
            registry::profile_of(opt_str(name, v, "manufacturer")?, opt_str(name, v, "model")?, opt_num(name, v, "year")?),
        ),
        _ => return Err(format!("the engine has no rule called {name:?}")),
    }
    Ok(out)
}
