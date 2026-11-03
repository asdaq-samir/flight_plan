//! The approach's rules as crate::call answers them, JSON in and out; the
//! names and their inputs are listed in call.rs with the others. A drawing
//! is the planner's /api/procedure answer as it comes; a track's points
//! are `{"t", "lat", "lon", "alt_ft"?}` (t in ms since 1970).

use super::debrief::{self, Attempt, Debrief, Finding, Outcome, Tone};
use super::lesson::{self, Focus, Frequency};
use super::{list, missed_legs, num, opt_num, opt_str, Drawing, RunwayPath};
use crate::figures::debrief::Point;
use crate::json::{self, Value};

/// The names this module answers.
pub const NAMES: [&str; 21] = [
    "approach_guidance",
    "glidepath_ft",
    "approach_attempts",
    "approach_debrief",
    "approach_find",
    "approach_transition",
    "approach_minimums",
    "approach_descent_fpm",
    "approach_rounded_fpm",
    "approach_category",
    "approach_minimums_kind",
    "approach_fix_name",
    "approach_missed_words",
    "approach_brief_frequencies",
    "approach_lesson_path",
    "approach_path_between",
    "approach_along_nm",
    "approach_brief",
    "approach_coaching",
    "approach_quiz",
    "approach_profile",
];

type R<T> = Result<T, String>;

fn drawing(name: &str, v: &Value) -> R<Drawing> {
    Drawing::read(name, v.get("drawing").ok_or_else(|| format!("{name}: \"drawing\" is missing"))?)
}

fn drawings(name: &str, v: &Value) -> R<Vec<Drawing>> {
    list(name, v, "drawings")?.iter().map(|d| Drawing::read(name, d)).collect()
}

fn points(name: &str, v: &Value) -> R<Vec<Point>> {
    list(name, v, "points")?
        .iter()
        .map(|p| Ok(Point { t: num(name, p, "t")?, lat: num(name, p, "lat")?, lon: num(name, p, "lon")?, alt_ft: opt_num(name, p, "alt_ft")? }))
        .collect()
}

fn index(name: &str, v: &Value, key: &str) -> R<usize> {
    let n = num(name, v, key)?;
    if n >= 0.0 && n.fract() == 0.0 && n <= u32::MAX as f64 {
        Ok(n as usize)
    } else {
        Err(format!("{name}: \"{key}\" is not an index"))
    }
}

fn place(name: &str, v: Option<&Value>) -> R<(f64, f64)> {
    let v = v.ok_or_else(|| format!("{name}: a place is missing"))?;
    Ok((num(name, v, "lat")?, num(name, v, "lon")?))
}

fn path(name: &str, v: &Value) -> R<Vec<(f64, f64)>> {
    list(name, v, "path")?.iter().map(|p| place(name, Some(p))).collect()
}

fn frequencies(name: &str, v: &Value) -> R<Vec<Frequency>> {
    list(name, v, "frequencies")?
        .iter()
        .map(|f| Ok(Frequency { kind: opt_str(name, f, "type")?, description: opt_str(name, f, "description")?, mhz: opt_num(name, f, "frequency_mhz")? }))
        .collect()
}

/// The track's points for an attempt: none past its end.
fn check_attempt(name: &str, a: Attempt, n: usize) -> R<Attempt> {
    if a.faf + 1 >= n || a.to >= n || a.from > a.to {
        return Err(format!("{name}: the attempt is not one of the track's"));
    }
    Ok(a)
}

fn place_json(out: &mut String, (lat, lon): (f64, f64)) {
    out.push_str("{\"lat\":");
    json::number(out, lat);
    out.push_str(",\"lon\":");
    json::number(out, lon);
    out.push('}');
}

fn places_json(points: &[(f64, f64)]) -> String {
    let mut out = String::from("[");
    for (i, p) in points.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        place_json(&mut out, *p);
    }
    out.push(']');
    out
}

fn strings_json(out: &mut String, items: &[String]) {
    out.push('[');
    for (i, s) in items.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        json::string(out, s);
    }
    out.push(']');
}

fn focus_json(out: &mut String, f: &Focus) {
    out.push_str("{\"fix\":");
    json::opt_string(out, f.fix.as_deref());
    out.push_str(",\"segment\":");
    json::opt_string(out, f.segment);
    out.push('}');
}

fn debrief_json(d: Option<&Debrief>) -> String {
    let mut out = String::new();
    match d {
        Some(d) => debrief::to_json(&mut out, d),
        None => out.push_str("null"),
    }
    out
}

fn opt_string_json(s: Option<&str>) -> String {
    let mut out = String::new();
    json::opt_string(&mut out, s);
    out
}

fn number_json(n: f64) -> String {
    let mut out = String::new();
    json::number(&mut out, n);
    out
}

/// The rule `name` worked on `v`.
pub fn call(name: &str, v: &Value) -> R<String> {
    match name {
        "approach_guidance" => Ok(opt_string_json(Some(debrief::guidance_of(&opt_str(name, v, "id")?.unwrap_or_default()).key()))),
        "glidepath_ft" => {
            let gp = v.get("runway_path").ok_or_else(|| format!("{name}: \"runway_path\" is missing"))?;
            let gp = RunwayPath { lat: num(name, gp, "lat")?, lon: num(name, gp, "lon")?, ft: num(name, gp, "ft")?, deg: num(name, gp, "deg")? };
            Ok(number_json(debrief::glidepath_ft(&gp, num(name, v, "nm_out")?)))
        }
        "approach_attempts" => {
            let attempts = debrief::attempts_at(&drawing(name, v)?, &points(name, v)?);
            let parts: Vec<String> = attempts.iter().map(|a| format!("{{\"faf\":{},\"from\":{},\"to\":{}}}", a.faf, a.from, a.to)).collect();
            Ok(format!("[{}]", parts.join(",")))
        }
        "approach_debrief" => {
            let (d, pts) = (drawing(name, v)?, points(name, v)?);
            let attempt = match v.get("attempt") {
                None | Some(Value::Null) => None,
                Some(a) => Some(check_attempt(
                    name,
                    Attempt { faf: index(name, a, "faf")?, from: index(name, a, "from")?, to: index(name, a, "to")? },
                    pts.len(),
                )?),
            };
            Ok(debrief_json(debrief::debrief(&d, &pts, attempt, opt_num(name, v, "minimums_ft")?).as_ref()))
        }
        "approach_find" => {
            let picked = opt_str(name, v, "picked")?;
            let found = debrief::find_approaches(&drawings(name, v)?, &points(name, v)?, picked.as_deref(), opt_num(name, v, "minimums_ft")?);
            let parts: Vec<String> = found.iter().map(|d| debrief_json(Some(d))).collect();
            Ok(format!("[{}]", parts.join(",")))
        }
        "approach_transition" => {
            let best = debrief::with_transition(
                num(name, v, "faf_at")?,
                index(name, v, "passed")?,
                &drawings(name, v)?,
                &points(name, v)?,
                opt_num(name, v, "minimums_ft")?,
            );
            Ok(debrief_json(best.as_ref()))
        }
        "approach_minimums" => {
            let findings = list(name, v, "findings")?
                .iter()
                .map(|f| {
                    let tone = opt_str(name, f, "tone")?.and_then(|t| Tone::read(&t)).ok_or_else(|| format!("{name}: a finding's tone is not one"))?;
                    Ok(Finding { tone, text: opt_str(name, f, "text")?.unwrap_or_default(), minimums: matches!(f.get("minimums"), Some(Value::Bool(true))) })
                })
                .collect::<R<Vec<_>>>()?;
            let outcome = opt_str(name, v, "outcome")?
                .and_then(|o| Outcome::read(&o))
                .ok_or_else(|| format!("{name}: \"outcome\" is not landed, missed or unknown"))?;
            let kept = debrief::with_minimums(&findings, opt_num(name, v, "lowest_ft")?, outcome, opt_num(name, v, "minimums_ft")?);
            let mut out = String::new();
            debrief::findings_json(&mut out, &kept);
            Ok(out)
        }
        "approach_descent_fpm" => Ok(number_json(lesson::descent_fpm(num(name, v, "gs_kt")?, num(name, v, "angle_deg")?))),
        "approach_rounded_fpm" => Ok(number_json(lesson::rounded_fpm(num(name, v, "fpm")?))),
        "approach_category" => Ok(opt_string_json(lesson::approach_category(opt_num(name, v, "vref_kt")?, opt_num(name, v, "vso_kt")?))),
        "approach_minimums_kind" => Ok(opt_string_json(Some(lesson::minimums_kind(&opt_str(name, v, "name")?.unwrap_or_default()).key()))),
        "approach_fix_name" => Ok(opt_string_json(Some(&lesson::fix_name(&opt_str(name, v, "ident")?.unwrap_or_default())))),
        "approach_missed_words" => {
            let legs = missed_legs(name, list(name, v, "legs")?)?;
            Ok(opt_string_json(lesson::missed_words(&legs).as_deref()))
        }
        "approach_brief_frequencies" => {
            let mut out = String::new();
            strings_json(&mut out, &lesson::brief_frequencies(&frequencies(name, v)?));
            Ok(out)
        }
        "approach_lesson_path" => Ok(places_json(&lesson::lesson_path(&drawing(name, v)?))),
        "approach_path_between" => {
            Ok(places_json(&lesson::path_between(&path(name, v)?, place(name, v.get("a"))?, place(name, v.get("b"))?)))
        }
        "approach_along_nm" => Ok(number_json(lesson::along_nm(&path(name, v)?, place(name, v.get("at"))?))),
        "approach_brief" => {
            let items =
                lesson::approach_brief(&drawing(name, v)?, &frequencies(name, v)?, opt_num(name, v, "vref_kt")?, opt_num(name, v, "vso_kt")?);
            let mut out = String::from("[");
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str("{\"key\":");
                json::string(&mut out, &item.key);
                out.push_str(",\"title\":");
                json::string(&mut out, item.title);
                out.push_str(",\"lines\":");
                strings_json(&mut out, &item.lines);
                out.push_str(",\"focus\":");
                focus_json(&mut out, &item.focus);
                out.push('}');
            }
            out.push(']');
            Ok(out)
        }
        "approach_coaching" => {
            let steps = lesson::coaching_steps(&drawing(name, v)?, num(name, v, "gs_kt")?);
            let mut out = String::from("[");
            for (i, s) in steps.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str("{\"key\":");
                json::string(&mut out, &s.key);
                out.push_str(",\"title\":");
                json::string(&mut out, &s.title);
                out.push_str(",\"say\":");
                json::string(&mut out, &s.say);
                out.push_str(",\"why\":");
                json::opt_string(&mut out, s.why.as_deref());
                out.push_str(",\"at\":");
                match s.at {
                    Some(at) => place_json(&mut out, at),
                    None => out.push_str("null"),
                }
                out.push_str(",\"focus\":");
                focus_json(&mut out, &s.focus);
                out.push_str(",\"altitude_ft\":");
                json::opt_number(&mut out, s.altitude_ft);
                out.push('}');
            }
            out.push(']');
            Ok(out)
        }
        "approach_profile" => {
            let (marks, path) = lesson::lesson_profile(&drawing(name, v)?);
            let mut out = String::from("{\"marks\":[");
            for (i, m) in marks.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str("{\"ident\":");
                json::string(&mut out, &m.ident);
                out.push_str(",\"along_nm\":");
                json::number(&mut out, m.along_nm);
                out.push_str(",\"ft\":");
                json::opt_number(&mut out, m.ft);
                out.push_str(&format!(",\"faf\":{},\"map\":{}}}", m.faf, m.map));
            }
            out.push_str("],\"path\":");
            match path {
                None => out.push_str("null"),
                Some(((from_nm, from_ft), (to_nm, to_ft))) => {
                    out.push_str("{\"from\":{\"nm\":");
                    json::number(&mut out, from_nm);
                    out.push_str(",\"ft\":");
                    json::number(&mut out, from_ft);
                    out.push_str("},\"to\":{\"nm\":");
                    json::number(&mut out, to_nm);
                    out.push_str(",\"ft\":");
                    json::number(&mut out, to_ft);
                    out.push_str("}}");
                }
            }
            out.push('}');
            Ok(out)
        }
        "approach_quiz" => {
            let questions = lesson::approach_quiz(&drawing(name, v)?, num(name, v, "gs_kt")?);
            let mut out = String::from("[");
            for (i, q) in questions.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str("{\"key\":");
                json::string(&mut out, &q.key);
                out.push_str(",\"prompt\":");
                json::string(&mut out, &q.prompt);
                out.push_str(",\"choices\":");
                strings_json(&mut out, &q.choices);
                out.push_str(&format!(",\"answer\":{},\"explain\":", q.answer));
                json::string(&mut out, &q.explain);
                out.push_str(",\"focus\":");
                focus_json(&mut out, &q.focus);
                out.push('}');
            }
            out.push(']');
            Ok(out)
        }
        _ => Err(format!("the engine has no rule called {name:?}")),
    }
}
