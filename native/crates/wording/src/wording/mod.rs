//! How the FAA's own words are turned into the app's, once for every
//! screen: its capitals in sentence case with its codes kept, names as
//! names are written, the weather advisories' intensities and hazards, a
//! special-use area's limits, a field's radio and its fuel, and a VOR's
//! radial, Morse and service volume. The web app (lib/advisories,
//! lib/frequencies, lib/stopServices, lib/airspace, lib/navaid), the
//! planner's app.gonogo.words and the iPhone's AirportWords each had a
//! copy; how a number is printed and how a row is laid out stay in each
//! app. The names and their inputs are listed in crate::call.

pub mod faa;
pub mod navaid;
pub mod radio;

use crate::json::{self, Value};
use radio::Frequency;

/// The names this module answers.
pub const NAMES: [&str; 19] = [
    "faa_words",
    "title_case",
    "place_name",
    "sigmet_hazard",
    "gairmet_title",
    "pirep_conditions",
    "sua_altitudes",
    "fuel_names",
    "short_airspace_name",
    "airspace_entry_rules",
    "frequency_line",
    "frequency_of",
    "ctaf_of",
    "kneeboard_radio",
    "radial_of",
    "fix_radial_distance",
    "morse",
    "service_volume",
    "navaid_hours",
];

fn opt_text<'a>(name: &str, v: &'a Value, key: &str) -> Result<Option<&'a str>, String> {
    match v.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s)),
        Some(_) => Err(format!("{name}: \"{key}\" is not a string")),
    }
}

fn opt_num(name: &str, v: &Value, key: &str) -> Result<Option<f64>, String> {
    match v.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => Ok(Some(*n)),
        Some(_) => Err(format!("{name}: \"{key}\" is not a number")),
    }
}

fn num(name: &str, v: &Value, key: &str) -> Result<f64, String> {
    opt_num(name, v, key)?.ok_or_else(|| format!("{name}: \"{key}\" is missing"))
}

fn list<'a>(name: &str, v: &'a Value, key: &str) -> Result<&'a [Value], String> {
    v.get(key).and_then(Value::as_array).ok_or_else(|| format!("{name}: \"{key}\" is missing or not a list"))
}

fn strings<'a>(name: &str, v: &'a Value, key: &str) -> Result<Vec<&'a str>, String> {
    list(name, v, key)?.iter().map(|s| s.as_str().ok_or_else(|| format!("{name}: \"{key}\" is not a list of strings"))).collect()
}

fn quoted(s: &str) -> String {
    let mut out = String::new();
    json::string(&mut out, s);
    out
}

fn opt_quoted(s: Option<&str>) -> String {
    let mut out = String::new();
    json::opt_string(&mut out, s);
    out
}

/// A field's frequencies, `[{"type"?, "description"?, "frequency_mhz"?}]`.
fn frequencies(name: &str, v: &Value) -> Result<Vec<Frequency>, String> {
    list(name, v, "frequencies")?
        .iter()
        .map(|f| {
            Ok(Frequency {
                kind: opt_text(name, f, "type")?.map(str::to_owned),
                description: opt_text(name, f, "description")?.map(str::to_owned),
                mhz: opt_num(name, f, "frequency_mhz")?,
            })
        })
        .collect()
}

fn index(at: Option<usize>) -> String {
    at.map_or("null".to_owned(), |i| i.to_string())
}

/// An airspace class, "B", "C" or "D" (any other answers no rules).
fn class(name: &str, v: &Value) -> Result<char, String> {
    let text = v.get("class").and_then(Value::as_str).ok_or_else(|| format!("{name}: \"class\" is missing or not a string"))?;
    let mut chars = text.chars();
    match (chars.next(), chars.next()) {
        (Some(c), None) => Ok(c),
        _ => Err(format!("{name}: \"class\" is one letter, not {text:?}")),
    }
}

fn station(name: &str, v: &Value) -> Result<navaid::Station, String> {
    Ok(navaid::Station {
        ident: opt_text(name, v, "ident")?.unwrap_or("").to_owned(),
        lat: num(name, v, "lat")?,
        lon: num(name, v, "lon")?,
        mag_var: opt_num(name, v, "mag_var")?,
    })
}

/// The rule `name` worked on `v`; the names are in NAMES.
pub fn answer(name: &str, v: &Value) -> Result<String, String> {
    match name {
        // Each of `texts` where it is given, else `text`: a list's rows in
        // one call.
        "faa_words" | "title_case" | "place_name" => {
            let rule: fn(&str) -> String = match name {
                "faa_words" => faa::faa_words,
                "title_case" => faa::title_case,
                _ => faa::place_words,
            };
            match v.get("texts") {
                Some(Value::Array(texts)) => {
                    let mut out = String::from("[");
                    for (i, t) in texts.iter().enumerate() {
                        if i > 0 {
                            out.push(',');
                        }
                        match t {
                            Value::String(s) => json::string(&mut out, &rule(s)),
                            Value::Null => out.push_str("\"\""),
                            _ => return Err(format!("{name}: \"texts\" is not a list of strings")),
                        }
                    }
                    out.push(']');
                    Ok(out)
                }
                Some(_) => Err(format!("{name}: \"texts\" is not a list")),
                None => Ok(quoted(&rule(opt_text(name, v, "text")?.unwrap_or("")))),
            }
        }
        "sigmet_hazard" => Ok(quoted(&faa::sigmet_hazard(opt_text(name, v, "hazard")?, opt_text(name, v, "kind")?))),
        "gairmet_title" => Ok(quoted(&faa::gairmet_title(opt_text(name, v, "hazard")?.unwrap_or(""), opt_text(name, v, "severity")?))),
        "pirep_conditions" => {
            Ok(opt_quoted(faa::pirep_conditions(opt_text(name, v, "turbulence")?, opt_text(name, v, "icing")?).as_deref()))
        }
        "sua_altitudes" => {
            let mid = match v.get("mid_sentence") {
                None | Some(Value::Null) => false,
                Some(Value::Bool(b)) => *b,
                Some(_) => return Err(format!("{name}: \"mid_sentence\" is not true or false")),
            };
            Ok(quoted(&faa::sua_altitudes(
                (opt_num(name, v, "floor_ft")?, opt_text(name, v, "floor_ref")?),
                (opt_num(name, v, "ceiling_ft")?, opt_text(name, v, "ceiling_ref")?),
                mid,
            )))
        }
        "fuel_names" => Ok(quoted(&faa::fuel_names(&strings(name, v, "types")?))),
        "short_airspace_name" => Ok(quoted(&faa::short_airspace_name(opt_text(name, v, "name")?.unwrap_or("")))),
        "airspace_entry_rules" => {
            let class = class(name, v)?;
            let mut out = String::from("{\"rules\":[");
            for (i, (rule, cite)) in crate::rules::entry_rules(class).iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str("{\"rule\":");
                json::string(&mut out, rule);
                out.push_str(",\"cite\":");
                json::string(&mut out, cite);
                out.push('}');
            }
            out.push_str("],\"call\":[");
            for (i, t) in crate::rules::call_types(class).iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                json::string(&mut out, t);
            }
            out.push_str("]}");
            Ok(out)
        }
        "frequency_line" => {
            let (named, kind, detail) = radio::frequency_line(opt_text(name, v, "type")?, opt_text(name, v, "description")?);
            Ok(format!("{{\"name\":{},\"kind\":{},\"detail\":{}}}", quoted(&named), quoted(kind), opt_quoted(detail.as_deref())))
        }
        "frequency_of" => Ok(index(radio::frequency_of(&frequencies(name, v)?, &strings(name, v, "types")?))),
        "ctaf_of" => Ok(match radio::ctaf_of(&frequencies(name, v)?) {
            Some(at) => at.to_string(),
            None => {
                let mut out = String::from("{\"type\":\"MULTICOM\",\"description\":\"MULTICOM\",\"frequency_mhz\":");
                json::number(&mut out, radio::MULTICOM_MHZ);
                out.push('}');
                out
            }
        }),
        "kneeboard_radio" => {
            let mut out = String::from("[");
            for (i, (called, mhz)) in radio::kneeboard_radio(&frequencies(name, v)?).iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push('[');
                json::string(&mut out, called);
                out.push(',');
                json::number(&mut out, *mhz);
                out.push(']');
            }
            out.push(']');
            Ok(out)
        }
        "radial_of" => {
            let at = v.get("at").ok_or_else(|| format!("{name}: \"at\" is missing"))?;
            let s = v.get("station").ok_or_else(|| format!("{name}: \"station\" is missing"))?;
            Ok(match navaid::radial_of(&station(name, s)?, num(name, at, "lat")?, num(name, at, "lon")?) {
                None => "null".to_owned(),
                Some((radial, to_course, nm)) => {
                    let mut out = String::from("{\"radial\":");
                    json::number(&mut out, radial);
                    out.push_str(",\"to_course\":");
                    json::number(&mut out, to_course);
                    out.push_str(",\"nm\":");
                    json::number(&mut out, nm);
                    out.push('}');
                    out
                }
            })
        }
        "fix_radial_distance" => {
            let at = v.get("at").ok_or_else(|| format!("{name}: \"at\" is missing"))?;
            let stations = list(name, v, "stations")?.iter().map(|s| station(name, s)).collect::<Result<Vec<_>, _>>()?;
            Ok(opt_quoted(navaid::fix_radial_distance(num(name, at, "lat")?, num(name, at, "lon")?, &stations).as_deref()))
        }
        "morse" => Ok(quoted(&navaid::morse(opt_text(name, v, "ident")?.unwrap_or("")))),
        "service_volume" => Ok(opt_quoted(navaid::service_volume(opt_text(name, v, "code")?.unwrap_or("")))),
        "navaid_hours" => Ok(opt_quoted(navaid::hours(opt_text(name, v, "hours")?.unwrap_or("")).as_deref())),
        _ => Err(format!("the engine has no rule called {name:?}")),
    }
}
