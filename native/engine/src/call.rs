//! One way in for every host: a rule asked by its name, its input a JSON
//! object, its answer JSON. The web app (native/wasm, from TypeScript),
//! the planner (vfr_native.call) and the phones (wt_call) all come in
//! here, so a rule moved into the engine needs no new function on any of
//! them -- only a name below. The answers are the planner's endpoints'
//! own JSON, snake_case, where a rule has an endpoint.
//!
//! The names:
//!
//! - `holding`: /api/holding's answer (AIM 5-3-8), from `{"inbound",
//!   "heading", "turns": "right"|"left", "tas_kt"?, "wind_from"?,
//!   "wind_kt"?, "altitude_ft"?}`, the endpoint's query;
//! - `holding_leg_minutes`: the inbound leg's minutes (AIM 5-3-8 j.4(a)),
//!   from `{"altitude_ft"?}`;
//! - `lost_comms`: /api/lost-comms's answer (14 CFR 91.185), from its
//!   body, `{"segments": [{"name", "minimum_ft"?}], "assigned_ft"?,
//!   "expected_ft"?, "expected_from"?, "approach_fix"?, "efc"?, "eta"?}`;
//! - `diversion`: /api/diversion's `solved`, `steps`, `problem` and
//!   `checks` (ACS PA.VI.C), from the leg's air the planner looks up for
//!   it, `{"true_course_deg", "distance_nm", "tas_kt", "fuel_burn_gph",
//!   "magnetic_variation_deg", "wind": {"wind_dir_true_deg",
//!   "wind_speed_kt"}|null, "to"?, "mh"?, "gs"?, "ete"?, "fuel"?}`;
//! - `wind_triangle`: `{"wca", "th", "gs"}` or null, from `{"tc", "tas",
//!   "wind_from_deg", "wind_kt"}`;
//! - `diversion_reasonable`: whether an estimate is within the drill's
//!   allowance, from `{"key", "typed", "exact"}`;
//! - `debrief`: /api/debrief's answer (ACS PA.VI.A), from its body,
//!   `{"checkpoints": [{"sequence_no", "name", "category", "lat", "lon",
//!   "along_track_nm", "true_course_deg"?, "ete_min"?, "altitude_ft"?}],
//!   "points": [{"t", "lat", "lon", "alt_ft"?}]}`, with the fields'
//!   pattern altitudes, which the planner looks up, as `"patterns":
//!   {ident: ft}`;
//! - `debrief_airborne`: the track's flights as [first, last] indices,
//!   from `{"points"}`.
//!
//! The things that move (crate::motion), each from the web's own shapes
//! in snake_case:
//!
//! - `traffic_marks`: `[{"label", "near"}]`, each airplane's height under
//!   it as TCAS writes it and whether it is within 1,000 ft of own ship's
//!   (14 CFR 91.159), from `{"own_ft"?, "planes": [{"altitude_ft"?,
//!   "vertical_fpm"?}]}`;
//! - `own_ship_hex`: which airplane heard is own ship's own transponder,
//!   its hex or null, from `{"planes": [TrafficAircraft], "fix": {"lat",
//!   "lon", "heading_deg"?, "speed_kt"?, "altitude_ft"?}|null}`;
//! - `closest_approach`: `{"in_min", "nm", "above_ft"}` or null, from
//!   `{"own": fix, "plane": TrafficAircraft}`;
//! - `airborne_now`: a watched airplane in the air, true, false or null,
//!   from `{"before": bool|null, "airborne", "arrived", "heard_s"?}`;
//! - `alert_fires`: `{"fires", "inside", "nm", "bearing_deg"}`, from
//!   `{"kind": "takeoff"|"land"|"near", "before_airborne", "was_inside"?,
//!   "airborne", "arrived"?, "plane": {"lat", "lon"}|null, "to"?,
//!   "limit_nm"?}`;
//! - `glide_range`: still-air glide nm or null, from `{"altitude_ft"?,
//!   "speed_kt"?, "ground_ft"?}`; `glide_reaches`: a field within it at
//!   pattern height, from `{"altitude_ft"?, "speed_kt"?, "distance_nm",
//!   "elevation_ft"?}`; `underway`: at flying speed, from `{"speed_kt"?}`;
//! - `plan_profile`: `{"points", "marks", "length_nm"}`, the plan's
//!   altitudes along the route, from `{"rows"}`, the web's nav log rows;
//! - `dry_run`: the planned flight flown on paper (motion::dry_run's
//!   to_json), from `{"rows", "start_s", "line"?, "missed"?}`;
//! - `read_track`: `{"points": [{"t", "lat", "lon", "alt_ft"}]}` or
//!   `{"error"}`, a GPX or KML track read, from `{"text"}`; `thin_track`:
//!   at most `most` (4,000) of `points`, from `{"points", "most"?}`.
//!
//! `?` marks a member that may be missing or null. A name not known, or
//! input not of its shape, is Err with a plain message, never a panic.

use crate::figures::{debrief, diversion, holding, lost_comms};
use crate::json::{self, Value};

/// The rule `name` worked on `input`, a JSON object; the answer as JSON.
pub fn call(name: &str, input: &str) -> Result<String, String> {
    let ask = json::parse(input)?;
    if !matches!(ask, Value::Object(_)) {
        return Err(format!("{name}: the input is not a JSON object"));
    }
    let ask = Ask { name, v: &ask };
    match name {
        "holding" => holding_rule(&ask),
        "holding_leg_minutes" => {
            let mut out = String::new();
            json::number(&mut out, holding::leg_minutes(ask.opt_num("altitude_ft")?));
            Ok(out)
        }
        "lost_comms" => lost_comms_rule(&ask),
        "diversion" => diversion_rule(&ask),
        "wind_triangle" => {
            let solved = diversion::wind_triangle(ask.num("tc")?, ask.num("tas")?, ask.num("wind_from_deg")?, ask.num("wind_kt")?);
            Ok(match solved {
                None => "null".to_owned(),
                Some((wca, th, gs)) => {
                    let mut out = String::from("{\"wca\":");
                    json::number(&mut out, wca);
                    out.push_str(",\"th\":");
                    json::number(&mut out, th);
                    out.push_str(",\"gs\":");
                    json::number(&mut out, gs);
                    out.push('}');
                    out
                }
            })
        }
        "diversion_reasonable" => {
            let key = ask.str("key")?;
            match diversion::reasonable(key, ask.num("typed")?, ask.num("exact")?) {
                Some(ok) => Ok(if ok { "true" } else { "false" }.to_owned()),
                None => Err(format!("diversion_reasonable: no estimate is called {key:?}")),
            }
        }
        "debrief" => {
            let checkpoints = checkpoints(&ask)?;
            let points = points(&ask)?;
            let patterns = match ask.v.get("patterns") {
                None | Some(Value::Null) => Vec::new(),
                Some(Value::Object(members)) => members
                    .iter()
                    .map(|(ident, ft)| match ft.as_f64() {
                        Some(ft) => Ok((ident.clone(), ft)),
                        None => Err(format!("debrief: the pattern altitude of {ident:?} is not a number")),
                    })
                    .collect::<Result<_, _>>()?,
                Some(_) => return Err("debrief: \"patterns\" is not an object of idents to feet".to_owned()),
            };
            Ok(debrief::answer_json(&checkpoints, &points, &patterns))
        }
        "debrief_airborne" => {
            let runs = debrief::airborne(&points(&ask)?);
            let mut out = String::from("[");
            for (i, (a, b)) in runs.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&format!("[{a},{b}]"));
            }
            out.push(']');
            Ok(out)
        }
        _ => crate::motion::call(name, ask.v).unwrap_or_else(|| Err(format!("the engine has no rule called {name:?}"))),
    }
}

/// The input of one call, read with the rule's name in each complaint.
struct Ask<'a> {
    name: &'a str,
    v: &'a Value,
}

impl Ask<'_> {
    fn opt_num(&self, key: &str) -> Result<Option<f64>, String> {
        opt_num_in(self.name, self.v, key)
    }

    fn num(&self, key: &str) -> Result<f64, String> {
        num_in(self.name, self.v, key)
    }

    fn str(&self, key: &str) -> Result<&str, String> {
        self.v.get(key).and_then(Value::as_str).ok_or_else(|| format!("{}: \"{key}\" is missing or not a string", self.name))
    }

    fn opt_str(&self, key: &str) -> Result<&str, String> {
        match self.v.get(key) {
            None | Some(Value::Null) => Ok(""),
            Some(Value::String(s)) => Ok(s),
            Some(_) => Err(format!("{}: \"{key}\" is not a string", self.name)),
        }
    }

    fn opt_bool(&self, key: &str) -> Result<bool, String> {
        match self.v.get(key) {
            None | Some(Value::Null) => Ok(false),
            Some(Value::Bool(b)) => Ok(*b),
            Some(_) => Err(format!("{}: \"{key}\" is not true or false", self.name)),
        }
    }

    fn list(&self, key: &str) -> Result<&[Value], String> {
        self.v.get(key).and_then(Value::as_array).ok_or_else(|| format!("{}: \"{key}\" is missing or not a list", self.name))
    }
}

fn opt_num_in(name: &str, v: &Value, key: &str) -> Result<Option<f64>, String> {
    match v.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => Ok(Some(*n)),
        Some(_) => Err(format!("{name}: \"{key}\" is not a number")),
    }
}

fn num_in(name: &str, v: &Value, key: &str) -> Result<f64, String> {
    opt_num_in(name, v, key)?.ok_or_else(|| format!("{name}: \"{key}\" is missing"))
}

fn holding_rule(ask: &Ask) -> Result<String, String> {
    let right = match ask.opt_str("turns")? {
        "" | "right" => true,
        "left" => false,
        other => return Err(format!("holding: turns are \"right\" or \"left\", not {other:?}")),
    };
    Ok(holding::holding_json(
        ask.num("inbound")?,
        ask.num("heading")?,
        right,
        ask.opt_num("tas_kt")?,
        ask.opt_num("wind_from")?,
        ask.opt_num("wind_kt")?,
        ask.opt_num("altitude_ft")?,
    ))
}

fn lost_comms_rule(ask: &Ask) -> Result<String, String> {
    let segments = ask
        .list("segments")?
        .iter()
        .map(|s| {
            let name = match s.get("name") {
                None | Some(Value::Null) => String::new(),
                Some(Value::String(n)) => n.clone(),
                Some(_) => return Err("lost_comms: a segment's \"name\" is not a string".to_owned()),
            };
            Ok((name, opt_num_in("lost_comms", s, "minimum_ft")?))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let expected_from = ask.opt_num("expected_from")?.unwrap_or(0.0);
    if expected_from.fract() != 0.0 {
        return Err("lost_comms: \"expected_from\" is a segment's index, a whole number".to_owned());
    }
    Ok(lost_comms::lost_comms_json(
        &segments,
        ask.opt_num("assigned_ft")?,
        ask.opt_num("expected_ft")?,
        expected_from as i64,
        ask.opt_bool("approach_fix")?,
        ask.opt_str("efc")?,
        ask.opt_str("eta")?,
    ))
}

fn diversion_rule(ask: &Ask) -> Result<String, String> {
    // No wind forecast is calm, as the planner flies the leg in.
    let (wind_from_deg, wind_kt) = match ask.v.get("wind") {
        None | Some(Value::Null) => (0.0, 0.0),
        Some(w @ Value::Object(_)) => (
            opt_num_in("diversion", w, "wind_dir_true_deg")?.unwrap_or(0.0),
            opt_num_in("diversion", w, "wind_speed_kt")?.unwrap_or(0.0),
        ),
        Some(_) => return Err("diversion: \"wind\" is not an object".to_owned()),
    };
    let air = diversion::Air {
        tas_kt: ask.num("tas_kt")?,
        fuel_burn_gph: ask.num("fuel_burn_gph")?,
        magnetic_variation_deg: ask.num("magnetic_variation_deg")?,
        wind_from_deg,
        wind_kt,
    };
    let typed = [ask.opt_num("mh")?, ask.opt_num("gs")?, ask.opt_num("ete")?, ask.opt_num("fuel")?];
    Ok(diversion::diversion_json(&air, ask.num("true_course_deg")?, ask.num("distance_nm")?, ask.opt_str("to")?, typed))
}

fn checkpoints(ask: &Ask) -> Result<Vec<debrief::Checkpoint>, String> {
    let n = ask.name;
    ask.list("checkpoints")?
        .iter()
        .map(|c| {
            let text = |key: &str| {
                c.get(key).and_then(Value::as_str).map(str::to_owned).ok_or_else(|| format!("{n}: a checkpoint's \"{key}\" is missing"))
            };
            let sequence_no = num_in(n, c, "sequence_no")?;
            if sequence_no.fract() != 0.0 {
                return Err(format!("{n}: a checkpoint's \"sequence_no\" is not a whole number"));
            }
            Ok(debrief::Checkpoint {
                sequence_no: sequence_no as i64,
                name: text("name")?,
                category: text("category")?,
                lat: num_in(n, c, "lat")?,
                lon: num_in(n, c, "lon")?,
                along_track_nm: num_in(n, c, "along_track_nm")?,
                true_course_deg: opt_num_in(n, c, "true_course_deg")?,
                ete_min: opt_num_in(n, c, "ete_min")?,
                altitude_ft: opt_num_in(n, c, "altitude_ft")?,
            })
        })
        .collect()
}

fn points(ask: &Ask) -> Result<Vec<debrief::Point>, String> {
    let n = ask.name;
    ask.list("points")?
        .iter()
        .map(|p| {
            Ok(debrief::Point {
                t: num_in(n, p, "t")?,
                lat: num_in(n, p, "lat")?,
                lon: num_in(n, p, "lon")?,
                alt_ft: opt_num_in(n, p, "alt_ft")?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_rule_by_name_answers_its_endpoints_json() {
        let held = call("holding", r#"{"inbound": 360, "heading": 112, "turns": "right"}"#).unwrap();
        assert!(held.starts_with(r#"{"entry":"teardrop","entry_name":"#), "{held}");
        assert!(held.contains(r#""either":"direct""#), "{held}");
        assert_eq!(call("holding_leg_minutes", r#"{"altitude_ft": 16000}"#).unwrap(), "1.5");
        assert_eq!(call("holding_leg_minutes", "{}").unwrap(), "1.0");
        assert_eq!(call("wind_triangle", r#"{"tc": 360, "tas": 50, "wind_from_deg": 270, "wind_kt": 60}"#).unwrap(), "null");
        assert_eq!(call("diversion_reasonable", r#"{"key": "mh", "typed": 2, "exact": 355}"#).unwrap(), "true");
    }

    #[test]
    fn bad_asks_are_errors_not_panics() {
        assert_eq!(call("nope", "{}").unwrap_err(), "the engine has no rule called \"nope\"");
        assert!(call("holding", "[1]").unwrap_err().contains("not a JSON object"));
        assert_eq!(call("holding", r#"{"inbound": 360}"#).unwrap_err(), "holding: \"heading\" is missing");
        assert!(call("holding", r#"{"inbound": "x", "heading": 1}"#).unwrap_err().contains("not a number"));
        assert!(call("holding", r#"{"inbound": 1, "heading": 1, "turns": "up"}"#).is_err());
        assert!(call("debrief", r#"{"checkpoints": [], "points": [{"t": 0}]}"#).is_err());
        assert!(call("diversion_reasonable", r#"{"key": "tc", "typed": 1, "exact": 1}"#).is_err());
        assert!(call("lost_comms", "{").unwrap_err().starts_with("JSON:"));
    }
}
