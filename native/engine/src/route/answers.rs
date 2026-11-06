//! The route's pieces as crate::call answers them, JSON in and out; the
//! names and their inputs are listed in call.rs with the others.

use super::holds::{self, Hold, Leg, Length};
use super::picks::{self, Pick};
use super::points;
use crate::json::{self, Value};

/// The names this module answers.
pub const NAMES: [&str; 15] = [
    "hold_read",
    "holds_read",
    "hold_write",
    "hold_length_read",
    "hold_length_write",
    "hold_figures",
    "procedures_read",
    "procedures_write",
    "runways_read",
    "altitude_lines",
    "point_kind",
    "frd_read",
    "frd_write",
    "bare_field",
    "same_field",
];

fn text<'a>(name: &str, v: &'a Value, key: &str) -> Result<&'a str, String> {
    v.get(key).and_then(Value::as_str).ok_or_else(|| format!("{name}: \"{key}\" is missing or not a string"))
}

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

fn hold_json(out: &mut String, hold: &Hold) {
    out.push_str("{\"fix\":");
    json::string(out, &hold.fix);
    out.push_str(&format!(",\"inbound\":{},\"right\":{}", hold.inbound, hold.right));
    let (min, nm) = match hold.leg {
        Leg::Minutes(m) => (Some(m), None),
        Leg::Nm(nm) => (None, Some(nm)),
    };
    out.push_str(",\"leg_min\":");
    json::opt_number(out, min);
    out.push_str(",\"leg_nm\":");
    json::opt_number(out, nm);
    let (turns, minutes) = match hold.length {
        Length::Turns(n) => (Some(n), None),
        Length::Minutes(n) => (None, Some(n)),
    };
    out.push_str(&format!(
        ",\"turns\":{},\"minutes\":{}}}",
        turns.map_or("null".to_owned(), |n| n.to_string()),
        minutes.map_or("null".to_owned(), |n| n.to_string())
    ));
}

fn opt_hold_json(hold: Option<&Hold>) -> String {
    let mut out = String::new();
    match hold {
        Some(h) => hold_json(&mut out, h),
        None => out.push_str("null"),
    }
    out
}

/// A hold's legs from `{"leg_min"|"leg_nm"}`: one or the other.
fn leg_in(name: &str, h: &Value) -> Result<Leg, String> {
    match (opt_num(name, h, "leg_min")?, opt_num(name, h, "leg_nm")?) {
        (Some(m), None) => Ok(Leg::Minutes(m)),
        (None, Some(nm)) => Ok(Leg::Nm(nm)),
        _ => Err(format!("{name}: a hold's legs are \"leg_min\" or \"leg_nm\", one of the two")),
    }
}

/// A hold's length from `{"turns"|"minutes"}`: one or the other, whole.
fn length_in(name: &str, h: &Value) -> Result<Length, String> {
    let count = |n: f64| (n.fract() == 0.0 && (0.0..=f64::from(u32::MAX)).contains(&n)).then_some(n as u32);
    match (opt_num(name, h, "turns")?, opt_num(name, h, "minutes")?) {
        (Some(t), None) => count(t).map(Length::Turns),
        (None, Some(m)) => count(m).map(Length::Minutes),
        _ => None,
    }
    .ok_or_else(|| format!("{name}: a hold's length is whole \"turns\" or \"minutes\", one of the two"))
}

fn hold_in<'a>(name: &str, v: &'a Value) -> Result<&'a Value, String> {
    match v.get("hold") {
        Some(h @ Value::Object(_)) => Ok(h),
        _ => Err(format!("{name}: \"hold\" is missing or not an object")),
    }
}

fn picks_in(name: &str, v: &Value) -> Result<Vec<Pick>, String> {
    let list = v.get("picks").and_then(Value::as_array).ok_or_else(|| format!("{name}: \"picks\" is missing or not a list"))?;
    list.iter()
        .map(|p| {
            Ok(Pick {
                ident: text(name, p, "ident")?.to_owned(),
                id: text(name, p, "id")?.to_owned(),
                transition: opt_text(name, p, "transition")?.filter(|t| !t.is_empty()).map(str::to_owned),
                direct: opt_text(name, p, "direct")?.filter(|d| !d.is_empty()).map(str::to_owned),
            })
        })
        .collect()
}

fn opt_str_json(out: &mut String, s: Option<&str>) {
    json::opt_string(out, s);
}

/// The rule `name` (one of NAMES) worked on `v`.
pub fn answer(name: &str, v: &Value) -> Result<String, String> {
    let mut out = String::new();
    match name {
        "hold_read" => out = opt_hold_json(holds::read(text(name, v, "text")?).as_ref()),
        "holds_read" => {
            out.push('[');
            for (i, (part, hold)) in holds::read_all(text(name, v, "text")?).iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str("{\"part\":");
                json::string(&mut out, part);
                out.push_str(",\"hold\":");
                out.push_str(&opt_hold_json(hold.as_ref()));
                out.push('}');
            }
            out.push(']');
        }
        "hold_write" => {
            let h = hold_in(name, v)?;
            let right = match h.get("right") {
                Some(Value::Bool(b)) => *b,
                _ => return Err(format!("{name}: a hold's \"right\" is missing or not true or false")),
            };
            let written = holds::write(text(name, h, "fix")?, num(name, h, "inbound")?, right, leg_in(name, h)?, length_in(name, h)?);
            json::string(&mut out, &written);
        }
        "hold_length_read" => match holds::length_read(text(name, v, "text")?) {
            Some(Length::Turns(n)) => out = format!("{{\"turns\":{n}}}"),
            Some(Length::Minutes(n)) => out = format!("{{\"minutes\":{n}}}"),
            None => out.push_str("null"),
        },
        "hold_length_write" => json::string(&mut out, &holds::length_code(length_in(name, v)?)),
        "hold_figures" => {
            let h = hold_in(name, v)?;
            let tas = num(name, v, "tas_kt")?;
            let leg = leg_in(name, h)?;
            let held = holds::held_minutes(leg, opt_num(name, h, "turns")?, opt_num(name, h, "minutes")?, tas);
            out.push_str("{\"lap_min\":");
            json::number(&mut out, holds::lap_minutes(leg, tas));
            out.push_str(",\"held_min\":");
            json::number(&mut out, held);
            out.push_str(",\"turn_radius_nm\":");
            json::number(&mut out, holds::turn_radius_nm(tas));
            out.push('}');
        }
        "procedures_read" => {
            out.push('[');
            for (i, read) in picks::procedures_read(text(name, v, "text")?).iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str("{\"part\":");
                json::string(&mut out, &read.part);
                out.push_str(",\"pick\":");
                match &read.pick {
                    None => out.push_str("null"),
                    Some(p) => {
                        out.push_str("{\"ident\":");
                        json::string(&mut out, &p.ident);
                        out.push_str(",\"id\":");
                        json::string(&mut out, &p.id);
                        out.push_str(",\"transition\":");
                        opt_str_json(&mut out, p.transition.as_deref());
                        out.push_str(",\"direct\":");
                        opt_str_json(&mut out, p.direct.as_deref());
                        out.push('}');
                    }
                }
                out.push_str(&format!(",\"exact\":{}}}", read.exact));
            }
            out.push(']');
        }
        "procedures_write" => json::string(&mut out, &picks::procedures_write(&picks_in(name, v)?)),
        "runways_read" => {
            out.push('[');
            for (i, (part, pick)) in picks::runways_read(text(name, v, "text")?).iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str("{\"part\":");
                json::string(&mut out, part);
                out.push_str(",\"pick\":");
                match pick {
                    None => out.push_str("null"),
                    Some(p) => {
                        out.push_str("{\"field\":");
                        json::string(&mut out, &p.field);
                        out.push_str(",\"runway\":");
                        json::string(&mut out, &p.runway);
                        out.push('}');
                    }
                }
                out.push('}');
            }
            out.push(']');
        }
        "altitude_lines" => {
            let set = picks::altitude_lines(opt_num(name, v, "min_ft")?, opt_num(name, v, "max_ft")?);
            out.push_str("{\"crossing\":");
            opt_str_json(&mut out, set.as_ref().map(|(c, _)| c.key()));
            out.push_str(",\"lines\":[");
            for (i, (ft, under, over)) in set.map(|(_, lines)| lines).unwrap_or_default().iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str("{\"ft\":");
                json::number(&mut out, *ft);
                out.push_str(&format!(",\"under\":{under},\"over\":{over}}}"));
            }
            out.push_str("]}");
        }
        "point_kind" => opt_str_json(&mut out, points::kind(text(name, v, "text")?).map(points::Kind::key)),
        "frd_read" => match points::frd(text(name, v, "text")?) {
            None => out.push_str("null"),
            Some((base, course, nm)) => {
                out.push_str("{\"base\":");
                json::string(&mut out, &base);
                out.push_str(&format!(",\"course\":{course},\"distance_nm\":"));
                json::number(&mut out, nm);
                out.push('}');
            }
        },
        "frd_write" => {
            let written = points::frd_ident(text(name, v, "base")?, num(name, v, "course")?, num(name, v, "distance_nm")?);
            json::string(&mut out, &written);
        }
        "bare_field" => json::string(&mut out, &points::bare_field(text(name, v, "ident")?)),
        "same_field" => out.push_str(if points::same_field(text(name, v, "a")?, text(name, v, "b")?) { "true" } else { "false" }),
        _ => return Err(format!("the engine has no rule called {name:?}")),
    }
    Ok(out)
}
