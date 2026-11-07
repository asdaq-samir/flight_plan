//! The forecast's rules as crate::call answers them, JSON in and out; the
//! names and their inputs are listed in call.rs with the others.

use super::{category_of, hour, Figures, Group};
use crate::json::{self, Value};
use crate::metar;

/// The names this module answers.
pub const NAMES: [&str; 3] = ["flight_category", "taf_hour", "ceiling_visibility"];

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

/// A report's or a forecast group's ceiling and visibility, as a host's
/// own reader found its groups (the web's metar-taf-parser): the ceiling
/// 14 CFR 1.1's (metar::ceiling_of), the vertical visibility into an
/// obscuration settling it, and none where the lowest is sent with no
/// height; the visibility in statute miles,
/// metres converted as metar.rs reads them and given to the hundredth,
/// CAVOK the AWC's 6+ (WMO No. 306: 10 km or more).
fn ceiling_visibility(name: &str, v: &Value) -> R<(Option<f64>, Option<f64>)> {
    let mut layers = Vec::new();
    match v.get("layers") {
        None | Some(Value::Null) => {}
        Some(Value::Array(list)) => {
            for l in list {
                let cover = l.get("cover").and_then(Value::as_str).ok_or_else(|| format!("{name}: a layer's \"cover\" is missing"))?;
                layers.push(metar::Layer { cover: cover.to_owned(), base_ft_agl: opt_num(name, l, "base_ft")? });
            }
        }
        Some(_) => return Err(format!("{name}: \"layers\" is not a list")),
    }
    let vertical_visibility = opt_num(name, v, "vertical_visibility_ft")?;
    let visibility = if opt_bool(name, v, "cavok")? {
        Some(6.0)
    } else {
        match v.get("visibility") {
            None | Some(Value::Null) => None,
            Some(vis) => {
                let value = opt_num(name, vis, "value")?.ok_or_else(|| format!("{name}: the visibility's \"value\" is missing"))?;
                match vis.get("unit").and_then(Value::as_str) {
                    Some("m") => Some((metar::metres_to_sm(value) * 100.0).round() / 100.0),
                    Some("sm") | None => Some(value),
                    Some(other) => return Err(format!("{name}: the visibility's \"unit\" is sm or m, not {other:?}")),
                }
            }
        }
    };
    let sky = layers.iter().map(|l| (l.cover.as_str(), l.base_ft_agl));
    Ok((metar::ceiling_of(sky, vertical_visibility), visibility))
}

/// The rule `name` worked on `v`.
pub fn call(name: &str, v: &Value) -> R<String> {
    let mut out = String::new();
    match name {
        "ceiling_visibility" => {
            let (ceiling, visibility) = ceiling_visibility(name, v)?;
            out.push_str("{\"ceiling_ft\":");
            json::opt_number(&mut out, ceiling);
            out.push_str(",\"visibility_sm\":");
            json::opt_number(&mut out, visibility);
            out.push('}');
        }
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
