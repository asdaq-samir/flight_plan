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
//!   from `{"points"}`;
//! - `read_clearance`: an ATC clearance heard, read into its items as the
//!   web's lib/clearance read it (clearance.rs, AIM 4-4-3), from
//!   `{"text"}`, the answer the web's Clearance (camelCase);
//! - `cleared_route`: the route a clearance gives, `{"route": {"dep",
//!   "stops", "dest"}, "typed": [{"name", "before", "after"}]}`, from
//!   `{"text", "found"?: {"limit"?, "route"?, "departure"?, "arrival"?}
//!   (the planner's ClearancePlaces), "planned": {"dep", "stops", "dest"}}`;
//! - `our_call`: whether a transmission is said to the airplane `tail`
//!   (AIM 4-2-4), from `{"text", "tail"}`;
//! - `direct_of`: the place a "direct" sends us to, as words to find, or
//!   null, from `{"text"}`;
//! - `call_pattern`: our call sign as a regular expression over a
//!   recognizer's words (AIM 4-2-4), for a locked phone's listener, or
//!   null where `tail` is no registration, from `{"tail"}`;
//! - `tokens`: the words heard with each run of figures one number (AIM
//!   4-2-8, 4-2-9), `[{"word", "num"?}]`, from `{"text"}`;
//! - `place_words`: words for a place as the planner looks them up, the
//!   ICAO alphabet's spelled, from `{"tokens": [{"word", "num"?}]}`;
//! - `readback_check`: a readback against the clearance heard (AIM
//!   4-4-7), `{"items": [{"item", "cleared", "said"}], "words"}`, from
//!   `{"cleared", "said"}`, both as heard.
//!
//! The Brief's Go / No-Go (crate::gonogo, the web's lib/verdict and the
//! modules it is fed from), each from the planner's and the web's own
//! objects in snake_case:
//!
//! - `gonogo_verdict`: POST /api/go-no-go's `line` and `items`, from
//!   `{"verdict": VerdictInput, "alternate"?: /api/alternate's answer}`;
//!   `gonogo_verdict_items` from a VerdictInput, `gonogo_verdict_line`
//!   from `{"items"}`, `gonogo_alternate_finding` from `{"data"?}`,
//!   `gonogo_with_alternate` from `{"items", "found"?}`. A VerdictInput
//!   is `{"weather": {"pending", "failed"?, "vfr_not_recommended",
//!   "under_minimums", "icing"?, "hazards", "unchecked", "worst"?},
//!   "airspace": {"pending", "unchecked", "in_force", "near",
//!   "special_use": [{"name", "when"}]}, "altitude": {"pending",
//!   "problem"?, "cautions", "flown"?}, "fuel": {"pending", "margin_gal"?,
//!   "required_gal"?, "reserve_min"?, "ifr"?}, "runways": {"pending",
//!   "worked", "short", "crosswind"}, "balance": {"pending", "worked",
//!   "problems", "takeoff"?}, "risk"?: {"level", "line"}};
//! - `gonogo_under_minimums`: the sentences where the weather is under the
//!   pilot's minimums, from `{"minimums": {"ceiling_ft"?, "visibility_sm"?,
//!   "crosswind_kt"?, "wind_kt"?}, "landings": [ident], "dest", and the
//!   briefing's "metars", "airports" and "forecast"}`;
//!   `gonogo_best_crosswind` from `{"runways", "reported"?: {"speed_kt"?,
//!   "gust_kt"?}}`;
//! - `gonogo_icing`: icing at an altitude flown, with its line, or null,
//!   from `{"selection": {"freezing_level_ft"?, "icing_possible",
//!   "freezing_level_at_or_below"}, "flown_ft", "pireps": [{"icing"?}]}`;
//!   `gonogo_icing_line` from `{"icing"}`;
//! - `gonogo_risk`: the risk assessment, its line, what to do and every
//!   factor marked, from a FratInput, `{"vfr_not_recommended",
//!   "under_minimums", "tfr_on_route", "hazards", "night",
//!   "fuel_margin_gal"?, "ifr"?, "vor_check"? (left out for a stock
//!   profile, null for none recorded), "inspections"?, "squawks"?,
//!   "currency"?, "day", "ticked": {key: true}}`;
//!   `gonogo_inspection_factors` from `{"inspections", "day", "ifr"}`,
//!   `gonogo_squawk_factors` from `{"squawks", "night", "ifr"}`,
//!   `gonogo_self_checks` from `{}`, `gonogo_risk_line` from `{"level",
//!   "score"}`;
//! - `gonogo_runway_checks`: the runway check at every field, fields and
//!   runways by index, from `{"aircraft": {"takeoff"?, "landing"?,
//!   "crosswind"?}, "fields": [{"ident", "elevation_ft"?}], the briefing's
//!   "metars" and "airports", "takeoff_lb"?, "landing_lb"?, "picks"?:
//!   {"pattern", "takeoff"} (objects of field to end, or [field, end]
//!   pairs)}`; `gonogo_short_field`, `gonogo_end_distance`,
//!   `gonogo_density_altitude`, `gonogo_field_air`, `gonogo_soft_surface`
//!   from `{"surface"?}`, `gonogo_runway_number` from `{"ident"}`,
//!   `gonogo_runway_flown`
//!   and `gonogo_runway_in_use` (runway and end by index),
//!   `gonogo_picked_end`;
//! - `gonogo_balance` from `{"loading", "load", "trip_fuel_gal"?}`,
//!   `gonogo_default_load` from `{"loading", "fuel_gal"}`,
//!   `gonogo_in_envelope` from `{"envelope", "arm", "weight"}`;
//! - `gonogo_pass_minutes` (minutes after departure, or null) from
//!   `{"legs": [{"distance_nm", "ete_min"?}], "along_nm"}`;
//!   `gonogo_tfr_when` from `{"at_us", "effective_us"?, "expires_us"?}`
//!   (microseconds since 1970); `gonogo_sua_when` from `{"times_of_use"?,
//!   "utc": [day, minute], "local"?: [day, minute]}` (day 0 Sunday; the
//!   host works the clocks out in the area's own time zone, which the
//!   engine has no database of).
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
        // The clearance reader (clearance.rs), the web's lib/clearance and
        // lib/heardCall: held to the same fixtures as the web's tests.
        "read_clearance" => Ok(crate::clearance::read(ask.str("text")?).to_json()),
        "cleared_route" => cleared_route_rule(&ask),
        "our_call" => Ok(if crate::clearance::our_call(ask.str("text")?, ask.str("tail")?) { "true" } else { "false" }.to_owned()),
        "direct_of" => {
            let mut out = String::new();
            json::opt_string(&mut out, crate::clearance::direct_of(ask.str("text")?).as_deref());
            Ok(out)
        }
        "call_pattern" => {
            let mut out = String::new();
            json::opt_string(&mut out, crate::clearance::call_pattern(ask.str("tail")?).as_deref());
            Ok(out)
        }
        "tokens" => {
            let mut out = String::from("[");
            for (i, t) in crate::clearance::tokens(ask.str("text")?).iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str("{\"word\":");
                json::string(&mut out, &t.word);
                if let Some(num) = &t.num {
                    out.push_str(",\"num\":");
                    json::string(&mut out, num);
                }
                out.push('}');
            }
            out.push(']');
            Ok(out)
        }
        "place_words" => {
            let toks = ask
                .list("tokens")?
                .iter()
                .map(|t| {
                    let word = t.get("word").and_then(Value::as_str).ok_or_else(|| "place_words: a token has no \"word\"".to_owned())?;
                    Ok(crate::clearance::Token { word: word.to_owned(), num: t.get("num").and_then(Value::as_str).map(str::to_owned) })
                })
                .collect::<Result<Vec<_>, String>>()?;
            let mut out = String::new();
            json::string(&mut out, &crate::clearance::place_words(&toks));
            Ok(out)
        }
        "readback_check" => Ok(crate::readback::check_json(ask.str("cleared")?, ask.str("said")?)),
        // The Go / No-Go's, by their own names (gonogo::calls).
        _ => crate::gonogo::calls::call(name, ask.v).unwrap_or_else(|| Err(format!("the engine has no rule called {name:?}"))),
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

/// The route a clearance gives (clearance::cleared_route) from the words
/// heard, the planner's places for them and the route planned: the web's
/// lib/clearance clearedRoute, its input the places as ClearancePlaces
/// answers them.
fn cleared_route_rule(ask: &Ask) -> Result<String, String> {
    use crate::clearance::{self, Found, FoundPlaces, FoundProcedure, Route};
    let name = ask.name;
    let text = ask.str("text")?;
    let str_in = |v: &Value, key: &str| -> Option<String> { v.get(key).and_then(Value::as_str).map(str::to_owned) };
    let found_in = |v: &Value| -> Result<Found, String> {
        let kind = match v.get("kind").and_then(Value::as_str) {
            Some("airport") => Some("airport"),
            Some("navaid") => Some("navaid"),
            Some("fix") => Some("fix"),
            _ => None,
        };
        let sure = match v.get("sure") {
            Some(Value::Bool(b)) => *b,
            _ => true,
        };
        Ok(Found { said: str_in(v, "said").unwrap_or_default(), ident: str_in(v, "ident"), name: str_in(v, "name"), kind, sure })
    };
    let procedure_in = |v: Option<&Value>| -> Result<Option<FoundProcedure>, String> {
        match v {
            None | Some(Value::Null) => Ok(None),
            Some(p @ Value::Object(_)) => Ok(Some(FoundProcedure {
                id: str_in(p, "id").ok_or_else(|| format!("{name}: a procedure found has no \"id\""))?,
                transition: str_in(p, "transition"),
            })),
            Some(_) => Err(format!("{name}: a procedure found is not an object")),
        }
    };
    let found = match ask.v.get("found") {
        None | Some(Value::Null) => FoundPlaces::default(),
        Some(f @ Value::Object(_)) => FoundPlaces {
            limit: match f.get("limit") {
                Some(l @ Value::Object(_)) => Some(found_in(l)?),
                _ => None,
            },
            route: match f.get("route") {
                Some(Value::Array(runs)) => runs
                    .iter()
                    .map(|run| run.as_array().unwrap_or(&[]).iter().map(found_in).collect::<Result<Vec<_>, _>>())
                    .collect::<Result<Vec<_>, _>>()?,
                _ => Vec::new(),
            },
            departure: procedure_in(f.get("departure"))?,
            arrival: procedure_in(f.get("arrival"))?,
        },
        Some(_) => return Err(format!("{name}: \"found\" is not an object")),
    };
    let planned = match ask.v.get("planned") {
        Some(p @ Value::Object(_)) => Route {
            dep: str_in(p, "dep").unwrap_or_default(),
            stops: p.get("stops").and_then(Value::as_array).map(|s| s.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect()).unwrap_or_default(),
            dest: str_in(p, "dest").unwrap_or_default(),
        },
        _ => return Err(format!("{name}: \"planned\" is missing or not an object")),
    };
    let (route, typed) = clearance::cleared_route(&clearance::read(text), &found, &planned);
    let mut out = String::from("{\"route\":{\"dep\":");
    json::string(&mut out, &route.dep);
    out.push_str(",\"stops\":[");
    for (i, stop) in route.stops.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        json::string(&mut out, stop);
    }
    out.push_str("],\"dest\":");
    json::string(&mut out, &route.dest);
    out.push_str("},\"typed\":[");
    for (i, t) in typed.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"name\":");
        json::string(&mut out, &t.name);
        out.push_str(",\"before\":");
        json::opt_string(&mut out, t.before.as_deref());
        out.push_str(",\"after\":");
        json::opt_string(&mut out, t.after.as_deref());
        out.push('}');
    }
    out.push_str("]}");
    Ok(out)
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
