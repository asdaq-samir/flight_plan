//! The forecast's rules as crate::call answers them, JSON in and out; the
//! names and their inputs are listed in call.rs with the others.

use super::{category_of, hour, Figures, Group};
use crate::json::{self, Value};

/// The names this module answers.
pub const NAMES: [&str; 2] = ["flight_category", "taf_hour"];

type R<T> = Result<T, String>;

/// A member that is a number, or None where it is missing or null.
fn opt_num(name: &str, v: &Value, key: &str) -> R<Option<f64>> {
    match v.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => Ok(Some(*n)),
        Some(_) => Err(format!("{name}: \"{key}\" is not a number")),
    }
}

fn opt_bool(name: &str, v: &Value, key: &str) -> R<bool> {
    match v.get(key) {
        None | Some(Value::Null) => Ok(false),
        Some(Value::Bool(b)) => Ok(*b),
        Some(_) => Err(format!("{name}: \"{key}\" is not true or false")),
    }
}

/// `{"category"?, "gust_kt"?, "thunder"?}`.
fn figures(name: &str, v: &Value) -> R<Figures> {
    let category = match v.get("category") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => Some(s.clone()),
        Some(_) => return Err(format!("{name}: a \"category\" is not a string")),
    };
    Ok(Figures { category, gust_kt: opt_num(name, v, "gust_kt")?, thunder: opt_bool(name, v, "thunder")? })
}

/// The rule `name` worked on `v`.
pub fn call(name: &str, v: &Value) -> R<String> {
    let mut out = String::new();
    match name {
        "flight_category" => {
            let (ceiling, visibility) = (opt_num(name, v, "ceiling_ft")?, opt_num(name, v, "visibility_sm")?);
            // A ceiling sent with no height ("OVC///") is one not known, not
            // none (14 CFR 1.1): only what the visibility settles is said.
            let category = if opt_bool(name, v, "ceiling_unknown")? {
                crate::metar::flight_category_of(None, true, visibility)
            } else {
                category_of(ceiling, visibility)
            };
            json::opt_string(&mut out, category);
        }
        "taf_hour" => {
            let prevailing = figures(name, v.get("prevailing").ok_or_else(|| format!("{name}: \"prevailing\" is missing"))?)?;
            let before = match v.get("before") {
                None | Some(Value::Null) => None,
                Some(b) => Some(figures(name, b)?),
            };
            let supplemental = match v.get("supplemental") {
                None | Some(Value::Null) => Vec::new(),
                Some(Value::Array(groups)) => groups
                    .iter()
                    .map(|g| Ok(Group { figures: figures(name, g)?, chance: opt_bool(name, g, "chance")? }))
                    .collect::<R<Vec<_>>>()?,
                Some(_) => return Err(format!("{name}: \"supplemental\" is not a list")),
            };
            let h = hour(&prevailing, opt_bool(name, v, "becoming")?, before.as_ref(), &supplemental);
            out.push_str("{\"before_worse\":");
            out.push_str(if h.before_worse { "true" } else { "false" });
            out.push_str(",\"at_times\":");
            json::opt_string(&mut out, h.at_times.as_deref());
            out.push_str(",\"at_times_gust_kt\":");
            json::opt_number(&mut out, h.at_times_gust_kt);
            out.push_str(",\"at_times_thunder\":");
            out.push_str(if h.at_times_thunder { "true" } else { "false" });
            out.push_str(",\"at_times_chance\":");
            out.push_str(if h.at_times_chance { "true" } else { "false" });
            out.push('}');
        }
        _ => return Err(format!("the engine has no rule called {name:?}")),
    }
    Ok(out)
}
