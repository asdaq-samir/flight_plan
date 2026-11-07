//! The Go / No-Go's rules by name (crate::call lists them): each reads its
//! input as the planner's and the web's own objects in snake_case -- a
//! briefing's METARs and runways, a profile's tables and loading, the
//! web's VerdictInput and FratInput -- and answers the planner's JSON.
//!
//! JavaScript's truth is read where the web reads a value as true or
//! false (an empty object is there; an empty string, 0 and null are not),
//! and a member left out is told from one sent as null where the web tells
//! them apart (a VOR check, an alternate's `good`).

use super::frat::{self, Currency, Inspections, Squawk, VorCheck};
use super::icing::{self, Selection};
use super::minimums::{self, Landing, Minimums, Report as Winds, RunwayWind};
use super::runways::{self, Airplane, End, Field, Picks, Report, Runway, ShortField};
use super::verdict::{self, Alternates, FiledAlternate, Item};
use super::weight_balance::{self, Load, Loading, Station};
use super::pass_times;
use crate::json::{self, Value};

type R<T> = Result<T, String>;

/// A rule's reading of its input, with its name in each complaint.
#[derive(Clone, Copy)]
pub(crate) struct In<'a> {
    pub(crate) name: &'a str,
}

impl In<'_> {
    pub(crate) fn err<T>(&self, key: &str, what: &str) -> R<T> {
        Err(format!("{}: \"{key}\" {what}", self.name))
    }

    pub(crate) fn opt_num(&self, v: &Value, key: &str) -> R<Option<f64>> {
        match v.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::Number(n)) => Ok(Some(*n)),
            Some(_) => self.err(key, "is not a number"),
        }
    }

    pub(crate) fn num(&self, v: &Value, key: &str) -> R<f64> {
        self.opt_num(v, key)?.map_or_else(|| self.err(key, "is missing"), Ok)
    }

    pub(crate) fn opt_str(&self, v: &Value, key: &str) -> R<Option<String>> {
        match v.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(s)) => Ok(Some(s.clone())),
            Some(_) => self.err(key, "is not a string"),
        }
    }

    pub(crate) fn str(&self, v: &Value, key: &str) -> R<String> {
        self.opt_str(v, key)?.map_or_else(|| self.err(key, "is missing"), Ok)
    }

    pub(crate) fn strings(&self, v: &Value, key: &str) -> R<Vec<String>> {
        match v.get(key) {
            None | Some(Value::Null) => Ok(vec![]),
            Some(Value::Array(items)) => {
                items.iter().map(|s| s.as_str().map(str::to_owned).map_or_else(|| self.err(key, "holds a non-string"), Ok)).collect()
            }
            Some(_) => self.err(key, "is not a list"),
        }
    }

    pub(crate) fn list<'v>(&self, v: &'v Value, key: &str) -> R<&'v [Value]> {
        match v.get(key) {
            None | Some(Value::Null) => Ok(&[]),
            Some(Value::Array(items)) => Ok(items),
            Some(_) => self.err(key, "is not a list"),
        }
    }

    pub(crate) fn nums(&self, v: &Value, key: &str) -> R<Vec<f64>> {
        self.list(v, key)?.iter().map(|x| x.as_f64().map_or_else(|| self.err(key, "holds a non-number"), Ok)).collect()
    }

    /// An object member, None where it is missing or null.
    pub(crate) fn obj<'v>(&self, v: &'v Value, key: &str) -> R<Option<&'v Value>> {
        match v.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(o @ Value::Object(_)) => Ok(Some(o)),
            Some(_) => self.err(key, "is not an object"),
        }
    }
}

/// JavaScript's truth of a member: false where it is missing, null,
/// false, 0, NaN or ""; an object or a list, even an empty one, is true.
pub(crate) fn truth(v: &Value, key: &str) -> bool {
    truthy(v.get(key))
}

/// Whether a section left out a member it decides its finding by: one not
/// sent at all, as `{"weather": {}}` sends nothing, so the section checked
/// nothing and its finding is "unknown" rather than "ok" (a null is sent:
/// the web's and the planner's say "none" so).
fn left_out(v: &Value, keys: &[&str]) -> bool {
    keys.iter().any(|k| v.get(k).is_none())
}

fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => *n != 0.0 && !n.is_nan(),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

fn members(v: Option<&Value>) -> &[(String, Value)] {
    match v {
        Some(Value::Object(m)) => m,
        _ => &[],
    }
}

/// The rule `name` on `v`; None where the name is not one of the Go /
/// No-Go's.
pub fn call(name: &str, v: &Value) -> Option<R<String>> {
    let i = In { name };
    Some(match name {
        "gonogo_verdict" => verdict_rule(i, v),
        "gonogo_verdict_items" => verdict_input(i, v).map(|input| verdict::items_json(&verdict::verdict_items(&input))),
        "gonogo_verdict_line" => items(i, v, "items").map(|items| {
            let (finding, words) = verdict::verdict_line(&items);
            line_json(finding, &words)
        }),
        "gonogo_alternate_finding" => alternates(i, v.get("data")).map(|a| verdict::finding_json(verdict::alternate_finding(a.as_ref()))),
        "gonogo_with_alternate" => with_alternate_rule(i, v),
        "gonogo_under_minimums" => under_minimums_rule(i, v),
        "gonogo_best_crosswind" => best_crosswind_rule(i, v),
        "gonogo_icing" => icing_rule(i, v),
        "gonogo_icing_line" => icing_line_rule(i, v),
        "gonogo_risk" => frat_input(i, v).map(|f| frat::assessment_json(&frat::assess(&f))),
        "gonogo_inspection_factors" => (|| {
            let insp = inspections(i, v.get("inspections"))?.unwrap_or_default();
            Ok(frat::factors_json(&frat::inspection_factors(&insp, &i.str(v, "day")?, truth(v, "ifr"))))
        })(),
        "gonogo_squawk_factors" => squawks(i, v, "squawks").map(|s| frat::factors_json(&frat::squawk_factors(&s, truth(v, "night"), truth(v, "ifr")))),
        "gonogo_self_checks" => Ok(frat::self_checks_json()),
        "gonogo_risk_line" => (|| {
            let score = i.num(v, "score")?;
            let mut out = String::new();
            json::string(&mut out, &frat::risk_line(&i.str(v, "level")?, score as i64));
            Ok(out)
        })(),
        "gonogo_short_field" => short_field_rule(i, v),
        "gonogo_end_distance" => end_distance_rule(i, v),
        "gonogo_density_altitude" => (|| {
            let mut out = String::new();
            json::number(&mut out, runways::density_altitude_ft(i.num(v, "pressure_alt_ft")?, i.num(v, "temp_c")?));
            Ok(out)
        })(),
        "gonogo_field_air" => (|| {
            let (pa, t) = runways::field_air(i.num(v, "elevation_ft")?, i.opt_num(v, "altimeter_in_hg")?, i.opt_num(v, "temp_c")?);
            let mut out = String::from("{\"pressure_alt_ft\":");
            json::number(&mut out, pa);
            out.push_str(",\"temp_c\":");
            json::number(&mut out, t);
            out.push('}');
            Ok(out)
        })(),
        "gonogo_soft_surface" => (|| {
            let r = Runway { surface: i.opt_str(v, "surface")?, ..Default::default() };
            Ok(runways::soft_surface(Some(&r)).to_string())
        })(),
        "gonogo_runway_number" => (|| {
            let mut out = String::new();
            json::string(&mut out, runways::runway_number(&i.str(v, "ident")?));
            Ok(out)
        })(),
        "gonogo_runway_flown" => (|| {
            let rs = runway_list(i, v, "runways")?;
            Ok(flown_json(runways::runway_flown(&rs, i.opt_str(v, "picked")?.as_deref())))
        })(),
        "gonogo_runway_in_use" => runway_list(i, v, "runways").map(|rs| flown_json(runways::runway_in_use(&rs))),
        "gonogo_picked_end" => (|| {
            let p = picks(i, v.get("picks"))?;
            let kind = i.str(v, "kind")?;
            let end = runways::picked_end(p.as_ref(), &i.str(v, "ident")?, kind == "takeoff", truth(v, "departure"));
            let mut out = String::new();
            json::opt_string(&mut out, end);
            Ok(out)
        })(),
        "gonogo_runway_checks" => runway_checks_rule(i, v),
        "gonogo_balance" => (|| {
            let l = loading(i, v)?;
            let load = load(i, v)?;
            Ok(weight_balance::balance_json(&weight_balance::balance(&l, &load, i.opt_num(v, "trip_fuel_gal")?)))
        })(),
        "gonogo_default_load" => {
            (|| Ok(weight_balance::load_json(&weight_balance::default_load(&loading(i, v)?, i.num(v, "fuel_gal")?))))()
        }
        "gonogo_in_envelope" => (|| {
            let env = envelope(i, v)?;
            Ok(weight_balance::in_envelope(&env, i.num(v, "arm")?, i.num(v, "weight")?).to_string())
        })(),
        "gonogo_pass_minutes" => (|| {
            let legs = i
                .list(v, "legs")?
                .iter()
                .map(|l| Ok((i.num(l, "distance_nm")?, i.opt_num(l, "ete_min")?)))
                .collect::<R<Vec<_>>>()?;
            let mut out = String::new();
            json::opt_number(&mut out, pass_times::pass_minutes(&legs, i.num(v, "along_nm")?));
            Ok(out)
        })(),
        "gonogo_tfr_when" => (|| {
            let us = |key: &str| -> R<Option<i64>> { Ok(i.opt_num(v, key)?.map(|t| t as i64)) };
            let at = i.num(v, "at_us")? as i64;
            Ok(format!("\"{}\"", pass_times::tfr_when(at, us("effective_us")?, us("expires_us")?)))
        })(),
        "gonogo_hazard_window" => (|| {
            let margin_min = i.opt_num(v, "margin_min")?.unwrap_or(pass_times::PASS_MARGIN_MIN as f64);
            let when = pass_times::window_when(
                i.num(v, "enter")?,
                i.num(v, "leave")?,
                i.opt_num(v, "valid_from")?,
                i.opt_num(v, "valid_to")?,
                margin_min * 60.0,
            );
            let mut out = String::new();
            json::opt_string(&mut out, when);
            Ok(out)
        })(),
        "gonogo_sua_when" => (|| {
            let clock = |key: &str| -> R<Option<(u32, u32)>> {
                match v.get(key) {
                    None | Some(Value::Null) => Ok(None),
                    Some(Value::Array(dm)) if dm.len() == 2 => match (dm[0].as_f64(), dm[1].as_f64()) {
                        (Some(d), Some(m)) if (0.0..7.0).contains(&d) && m >= 0.0 => Ok(Some((d as u32, m as u32))),
                        _ => i.err(key, "is not [day 0-6, minute]"),
                    },
                    Some(_) => i.err(key, "is not [day, minute]"),
                }
            };
            let utc = clock("utc")?.map_or_else(|| i.err("utc", "is missing"), Ok)?;
            Ok(format!("\"{}\"", pass_times::sua_when(i.opt_str(v, "times_of_use")?.as_deref(), utc, clock("local")?)))
        })(),
        _ => return None,
    })
}

// --- verdict ----------------------------------------------------------------

fn line_json(finding: &str, words: &str) -> String {
    let mut out = String::from("{\"finding\":");
    json::string(&mut out, finding);
    out.push_str(",\"words\":");
    json::string(&mut out, words);
    out.push('}');
    out
}

fn verdict_input(i: In, v: &Value) -> R<verdict::Input> {
    let part = |key: &str| -> R<&Value> { i.obj(v, key)?.map_or_else(|| i.err(key, "is missing"), Ok) };
    let (w, a, t, f, r, b) = (part("weather")?, part("airspace")?, part("altitude")?, part("fuel")?, part("runways")?, part("balance")?);
    let special_use = i
        .list(a, "special_use")?
        .iter()
        .map(|s| Ok((i.str(s, "name")?, i.str(s, "when")?)))
        .collect::<R<Vec<_>>>()?;
    let risk = match i.obj(v, "risk")? {
        None => None,
        Some(r) => Some((i.str(r, "level")?, i.str(r, "line")?)),
    };
    Ok(verdict::Input {
        weather: verdict::Weather {
            missing: left_out(w, &["vfr_not_recommended", "under_minimums", "hazards", "unchecked"]),
            pending: truth(w, "pending"),
            failed: i.opt_str(w, "failed")?,
            vfr_not_recommended: i.strings(w, "vfr_not_recommended")?,
            under_minimums: i.strings(w, "under_minimums")?,
            icing: i.opt_str(w, "icing")?,
            hazards: i.strings(w, "hazards")?,
            unchecked: i.strings(w, "unchecked")?,
            worst: i.opt_str(w, "worst")?,
        },
        airspace: verdict::Airspace {
            missing: left_out(a, &["unchecked", "in_force", "special_use"]),
            pending: truth(a, "pending"),
            unchecked: truth(a, "unchecked"),
            in_force: i.strings(a, "in_force")?,
            near: i.opt_num(a, "near")?.unwrap_or(0.0),
            special_use,
        },
        altitude: verdict::Altitude {
            missing: left_out(t, &["cautions"]),
            pending: truth(t, "pending"),
            problem: i.opt_str(t, "problem")?,
            cautions: i.strings(t, "cautions")?,
            flown: i.opt_str(t, "flown")?,
        },
        fuel: verdict::Fuel {
            pending: truth(f, "pending"),
            margin_gal: i.opt_num(f, "margin_gal")?,
            required_gal: i.opt_num(f, "required_gal")?,
            reserve_min: i.opt_num(f, "reserve_min")?,
            ifr: truth(f, "ifr"),
        },
        runways: verdict::Runways {
            missing: left_out(r, &["short", "crosswind"]),
            pending: truth(r, "pending"),
            worked: truth(r, "worked"),
            short: i.strings(r, "short")?,
            crosswind: i.strings(r, "crosswind")?,
            beyond: i.strings(r, "beyond")?,
            unchecked: i.strings(r, "unchecked")?,
        },
        balance: verdict::Balance {
            pending: truth(b, "pending"),
            worked: truth(b, "worked"),
            problems: i.strings(b, "problems")?,
            takeoff: i.opt_str(b, "takeoff")?,
        },
        risk,
    })
}

fn items(i: In, v: &Value, key: &str) -> R<Vec<Item>> {
    i.list(v, key)?
        .iter()
        .map(|x| {
            Ok(Item {
                key: i.str(x, "key")?,
                label: i.str(x, "label")?,
                tab: i.str(x, "tab")?,
                section: i.opt_str(x, "section")?,
                finding: i.str(x, "finding")?,
                detail: i.str(x, "detail")?,
            })
        })
        .collect()
}

/// The planner's /api/alternate answer, as much as the finding reads:
/// None where there is none (`!data`).
fn alternates(i: In, data: Option<&Value>) -> R<Option<Alternates>> {
    let Some(data) = data.filter(|d| !matches!(d, Value::Null)) else { return Ok(None) };
    let required = data.get("destination").is_some_and(|d| truth(d, "required"));
    let alternate = match data.get("alternate") {
        None | Some(Value::Null) => None,
        Some(a) => Some(FiledAlternate {
            ident: i.opt_str(a, "ident")?.unwrap_or_default(),
            good: match a.get("good") {
                Some(Value::Bool(b)) => Some(*b),
                _ => None,
            },
            good_given: matches!(a.get("good"), Some(Value::Null | Value::Bool(_))),
            first_reason: i.strings(a, "reasons")?.into_iter().next(),
        }),
    };
    Ok(Some(Alternates { required, alternate }))
}

fn verdict_rule(i: In, v: &Value) -> R<String> {
    let input = verdict_input(i, i.obj(v, "verdict")?.map_or_else(|| i.err("verdict", "is missing"), Ok)?)?;
    Ok(verdict::verdict_json(&input, alternates(i, v.get("alternate"))?.as_ref()))
}

fn with_alternate_rule(i: In, v: &Value) -> R<String> {
    let list = items(i, v, "items")?;
    let found = match i.obj(v, "found")? {
        None => None,
        Some(f) => Some((i.str(f, "finding")?, i.str(f, "detail")?)),
    };
    Ok(verdict::items_json(&verdict::with_alternate(list, found.as_ref().map(|(f, d)| (f.as_str(), d.as_str())))))
}

// --- minimums ---------------------------------------------------------------

pub(crate) fn runway_wind(i: In, v: &Value) -> R<Option<RunwayWind>> {
    let Some(w) = i.obj(v, "wind")? else { return Ok(None) };
    Ok(Some(RunwayWind {
        end: i.str(w, "end")?,
        headwind_kt: i.num(w, "headwind_kt")?,
        crosswind_kt: i.num(w, "crosswind_kt")?,
        gust_crosswind_kt: i.opt_num(w, "gust_crosswind_kt")?,
        in_use: truth(w, "in_use"),
    }))
}

pub(crate) fn runway(i: In, r: &Value) -> R<Runway> {
    Ok(Runway {
        surface: i.opt_str(r, "surface")?,
        length_ft: i.opt_num(r, "length_ft")?,
        closed: truth(r, "closed"),
        ends: i
            .list(r, "runway_ends")?
            .iter()
            .map(|e| Ok(End { ident: i.str(e, "ident")?, heading_true_deg: i.opt_num(e, "heading_true_deg")? }))
            .collect::<R<_>>()?,
        wind: runway_wind(i, r)?,
    })
}

pub(crate) fn runway_list(i: In, v: &Value, key: &str) -> R<Vec<Runway>> {
    i.list(v, key)?.iter().map(|r| runway(i, r)).collect()
}

/// A field's runways from a briefing's `airports`: none where it has none.
fn field_runways(i: In, v: &Value, ident: &str) -> R<Vec<Runway>> {
    match v.get("airports").and_then(|a| a.get(ident)) {
        Some(a @ Value::Object(_)) => runway_list(i, a, "runways"),
        _ => Ok(vec![]),
    }
}

/// A field's METAR from a briefing's `metars`: None where it has none
/// (null, or missing); an empty object is a report, as the web takes it.
fn metar<'v>(v: &'v Value, ident: &str) -> Option<&'v Value> {
    v.get("metars").and_then(|m| m.get(ident)).filter(|m| !matches!(m, Value::Null))
}

fn under_minimums_rule(i: In, v: &Value) -> R<String> {
    let m = i.obj(v, "minimums")?;
    let mine = match m {
        None => Minimums::default(),
        Some(m) => Minimums {
            ceiling_ft: i.opt_num(m, "ceiling_ft")?,
            visibility_sm: i.opt_num(m, "visibility_sm")?,
            crosswind_kt: i.opt_num(m, "crosswind_kt")?,
            wind_kt: i.opt_num(m, "wind_kt")?,
        },
    };
    let dest = i.str(v, "dest")?;
    let landings = i
        .strings(v, "landings")?
        .into_iter()
        .map(|ident| {
            let report = match metar(v, &ident) {
                None => None,
                Some(m) => Some(Winds {
                    ceiling_ft: i.opt_num(m, "ceiling_ft")?,
                    visibility_sm: i.opt_num(m, "visibility_sm")?,
                    wind_speed_kt: i.opt_num(m, "wind_speed_kt")?,
                    wind_gust_kt: i.opt_num(m, "wind_gust_kt")?,
                }),
            };
            let runways = field_runways(i, v, &ident)?.into_iter().map(|r| (r.closed, r.wind)).collect();
            Ok(Landing { ident, metar: report, runways })
        })
        .collect::<R<Vec<_>>>()?;
    let forecast = i.obj(v, "forecast")?;
    let station = match forecast {
        None => None,
        Some(f) => i.list(f, "stations")?.iter().find(|s| s.get("icaoId").and_then(Value::as_str) == Some(dest.as_str())),
    };
    let dest_forecast = match station {
        None => None,
        Some(s) => Some((i.opt_num(s, "ceiling_ft")?, i.opt_num(s, "visibility_sm")?)),
    };
    let w = minimums::Weather {
        landings,
        dest,
        dest_forecast,
        min_ceiling_ft: forecast.map(|f| i.opt_num(f, "min_ceiling_ft")).transpose()?.flatten(),
        min_visibility_sm: forecast.map(|f| i.opt_num(f, "min_visibility_sm")).transpose()?.flatten(),
    };
    Ok(verdict::strings_json(&minimums::under_minimums(&mine, &w)))
}

fn best_crosswind_rule(i: In, v: &Value) -> R<String> {
    let runways: Vec<(bool, Option<RunwayWind>)> = i
        .list(v, "runways")?
        .iter()
        .map(|r| Ok((truth(r, "closed"), runway_wind(i, r)?)))
        .collect::<R<_>>()?;
    let reported = match i.obj(v, "reported")? {
        None => None,
        Some(r) => Some((i.opt_num(r, "speed_kt")?, i.opt_num(r, "gust_kt")?)),
    };
    Ok(match minimums::best_crosswind(&runways, reported) {
        None => "null".into(),
        Some((end, kt)) => {
            let mut out = String::from("{\"end\":");
            json::opt_string(&mut out, end.as_deref());
            out.push_str(",\"kt\":");
            json::number(&mut out, kt);
            out.push('}');
            out
        }
    })
}

// --- icing ------------------------------------------------------------------

fn icing_rule(i: In, v: &Value) -> R<String> {
    let s = i.obj(v, "selection")?;
    let selection = match s {
        None => Selection::default(),
        Some(s) => Selection {
            freezing_level_ft: i.opt_num(s, "freezing_level_ft")?,
            possible: truth(s, "icing_possible"),
            at_or_below: truth(s, "freezing_level_at_or_below"),
        },
    };
    // A report's icing as sent; one that is not a string says none.
    let reports: Vec<Option<String>> = i.list(v, "pireps")?.iter().map(|p| p.get("icing").and_then(Value::as_str).map(str::to_owned)).collect();
    Ok(icing::icing_json(icing::icing_at_altitude(&selection, &i.nums(v, "flown_ft")?, &reports).as_ref()))
}

fn icing_line_rule(i: In, v: &Value) -> R<String> {
    let f = i.obj(v, "icing")?.map_or_else(|| i.err("icing", "is missing"), Ok)?;
    let found = icing::Icing {
        altitude_ft: i.num(f, "altitude_ft")?,
        freezing_level_ft: i.num(f, "freezing_level_ft")?,
        at_or_below: truth(f, "at_or_below"),
        reports: i.opt_num(f, "reports")?.unwrap_or(0.0) as usize,
    };
    let mut out = String::new();
    json::string(&mut out, &icing::icing_line(&found));
    Ok(out)
}

// --- risk -------------------------------------------------------------------

fn inspections(i: In, v: Option<&Value>) -> R<Option<Inspections>> {
    let Some(x) = v.filter(|x| !matches!(x, Value::Null)) else { return Ok(None) };
    let date = |key: &str| i.opt_str(x, key);
    Ok(Some(Inspections {
        annual_good_through: date("annual_good_through")?,
        elt_inspection_good_through: date("elt_inspection_good_through")?,
        elt_battery_due_on: date("elt_battery_due_on")?,
        static_check_good_through: date("static_check_good_through")?,
        transponder_check_good_through: date("transponder_check_good_through")?,
        hundred_hour_due_at_hours: i.opt_num(x, "hundred_hour_due_at_hours")?,
        hours_now: i.opt_num(x, "hours_now")?,
    }))
}

fn squawks(i: In, v: &Value, key: &str) -> R<Vec<Squawk>> {
    i.list(v, key)?
        .iter()
        .map(|s| Ok(Squawk { text: i.opt_str(s, "text")?.unwrap_or_default(), inoperative: truth(s, "inoperative"), deferred_for: i.opt_str(s, "deferred_for")? }))
        .collect()
}

fn frat_input(i: In, v: &Value) -> R<frat::Input> {
    let vor_check = match v.get("vor_check") {
        None => VorCheck::Absent,
        Some(Value::Null) => VorCheck::None,
        Some(c) => VorCheck::Checked { good_through: i.opt_str(c, "good_through")?.unwrap_or_default(), within_limit: truth(c, "within_limit") },
    };
    let currency = match i.obj(v, "currency")? {
        None => None,
        Some(c) => Some(Currency {
            flights: i.opt_num(c, "flights")?.unwrap_or(0.0),
            total_hours: i.opt_num(c, "total_hours")?.unwrap_or(0.0),
            day_passengers_until: i.opt_str(c, "day_passengers_until")?,
            night_passengers_until: i.opt_str(c, "night_passengers_until")?,
            instrument_current_until: i.opt_str(c, "instrument_current_until")?,
            ipc_needed_after: i.opt_str(c, "ipc_needed_after")?,
            flight_review_until: i.opt_str(c, "flight_review_until")?,
            medical_expires_on: i.opt_str(c, "medical_expires_on")?,
        }),
    };
    let ticked = members(v.get("ticked")).iter().filter(|(_, on)| truthy(Some(on))).map(|(k, _)| k.clone()).collect();
    Ok(frat::Input {
        vfr_not_recommended: truth(v, "vfr_not_recommended"),
        under_minimums: i.strings(v, "under_minimums")?,
        tfr_on_route: truth(v, "tfr_on_route"),
        hazards: i.opt_num(v, "hazards")?.unwrap_or(0.0) as i64,
        night: truth(v, "night"),
        fuel_margin_gal: i.opt_num(v, "fuel_margin_gal")?,
        ifr: truth(v, "ifr"),
        vor_check,
        inspections: inspections(i, v.get("inspections"))?,
        squawks: match v.get("squawks") {
            None | Some(Value::Null) => None,
            Some(_) => Some(squawks(i, v, "squawks")?),
        },
        currency,
        day: i.str(v, "day")?,
        ticked,
    })
}

// --- runways ----------------------------------------------------------------

pub(crate) fn table(i: In, t: &Value) -> R<ShortField> {
    let grids = |key: &str| -> R<Vec<Vec<Vec<f64>>>> {
        i.list(t, "tables")?
            .iter()
            .map(|w| {
                i.list(w, key)?
                    .iter()
                    .map(|row| row.as_array().map_or_else(|| i.err(key, "is not a grid"), |r| r.iter().map(|x| x.as_f64().map_or_else(|| i.err(key, "is not a grid of numbers"), Ok)).collect()))
                    .collect()
            })
            .collect()
    };
    let st = ShortField {
        pressure_altitudes_ft: i.nums(t, "pressure_altitudes_ft")?,
        temperatures_c: i.nums(t, "temperatures_c")?,
        weights_lb: i.nums(t, "weights_lb")?,
        ground_roll_ft: grids("ground_roll_ft")?,
        total_50ft_ft: grids("total_50ft_ft")?,
        grass_ground_roll_pct: i.num(t, "grass_ground_roll_pct")?,
    };
    // A table the reading would run off: two altitudes and temperatures at
    // least, a grid of them for every weight.
    let (rows, cols, n) = (st.pressure_altitudes_ft.len(), st.temperatures_c.len(), st.weights_lb.len());
    let fits = |g: &Vec<Vec<Vec<f64>>>| g.len() == n && g.iter().all(|w| w.len() == rows && w.iter().all(|r| r.len() == cols));
    if rows < 2 || cols < 2 || n == 0 || !fits(&st.ground_roll_ft) || !fits(&st.total_50ft_ft) {
        return i.err("table", "is not a short-field table of its altitudes, temperatures and weights");
    }
    Ok(st)
}

fn distances_json(d: &runways::Distances) -> String {
    let mut out = String::from("{");
    runways::distances_json(&mut out, d);
    out.push('}');
    out
}

fn short_field_rule(i: In, v: &Value) -> R<String> {
    let t = table(i, i.obj(v, "table")?.map_or_else(|| i.err("table", "is missing"), Ok)?)?;
    let d = runways::short_field(&t, i.num(v, "pressure_alt_ft")?, i.num(v, "temp_c")?, i.num(v, "weight_lb")?, i.num(v, "headwind_kt")?,
                                 truth(v, "grass"));
    Ok(distances_json(&d))
}

fn end_distance_rule(i: In, v: &Value) -> R<String> {
    let t = table(i, i.obj(v, "table")?.map_or_else(|| i.err("table", "is missing"), Ok)?)?;
    let r = match i.obj(v, "runway")? {
        None => None,
        Some(r) => Some(runway(i, r)?),
    };
    let (d, over) = runways::end_distance(&t, r.as_ref(), (i.num(v, "pressure_alt_ft")?, i.num(v, "temp_c")?), i.opt_num(v, "weight_lb")?,
                                          i.num(v, "headwind_kt")?);
    let mut out = distances_json(&d);
    out.pop();
    out.push_str(&format!(",\"over\":{over}}}"));
    Ok(out)
}

fn flown_json(f: Option<runways::Flown>) -> String {
    match f {
        None => "null".into(),
        Some((r, e, by_wind)) => format!("{{\"runway\":{r},\"end\":{e},\"by_wind\":{by_wind}}}"),
    }
}

/// The picks, each kind an object of field to end or a list of [field,
/// end] pairs (the web's Map, in its order); None where none are given.
fn picks(i: In, v: Option<&Value>) -> R<Option<Picks>> {
    let Some(p) = v.filter(|p| !matches!(p, Value::Null)) else { return Ok(None) };
    let pairs = |key: &str| -> R<Vec<(String, String)>> {
        match p.get(key) {
            None | Some(Value::Null) => Ok(vec![]),
            Some(Value::Object(m)) => m.iter().map(|(f, e)| e.as_str().map(|e| (f.clone(), e.to_owned())).map_or_else(|| i.err(key, "holds a non-string end"), Ok)).collect(),
            Some(Value::Array(list)) => list
                .iter()
                .map(|pair| match pair.as_array() {
                    Some([Value::String(f), Value::String(e)]) => Ok((f.clone(), e.clone())),
                    _ => i.err(key, "holds a pair that is not [field, end]"),
                })
                .collect(),
            Some(_) => i.err(key, "is not an object or a list of pairs"),
        }
    };
    Ok(Some(Picks { pattern: pairs("pattern")?, takeoff: pairs("takeoff")? }))
}

fn runway_checks_rule(i: In, v: &Value) -> R<String> {
    let aircraft = i.obj(v, "aircraft")?;
    let tables = |key: &str| -> R<Option<ShortField>> {
        match aircraft.map(|a| i.obj(a, key)).transpose()?.flatten() {
            None => Ok(None),
            Some(t) => Ok(Some(table(i, t)?)),
        }
    };
    let airplane = Airplane {
        takeoff: tables("takeoff")?,
        landing: tables("landing")?,
        demonstrated_kt: match aircraft.map(|a| i.obj(a, "crosswind")).transpose()?.flatten() {
            None => None,
            Some(c) => i.opt_num(c, "demonstrated_kt")?,
        },
    };
    let fields = i
        .list(v, "fields")?
        .iter()
        .map(|f| {
            let ident = i.str(f, "ident")?;
            let report = match metar(v, &ident) {
                None => None,
                Some(m) => Some(Report {
                    altimeter_in_hg: i.opt_num(m, "altimeter_in_hg")?,
                    temp_c: i.opt_num(m, "temp_c")?,
                    wind_dir_true_deg: i.opt_num(m, "wind_dir_true_deg")?,
                    wind_speed_kt: i.opt_num(m, "wind_speed_kt")?,
                    wind_gust_kt: i.opt_num(m, "wind_gust_kt")?,
                }),
            };
            Ok(Field { runways: field_runways(i, v, &ident)?, elevation_ft: i.opt_num(f, "elevation_ft")?, metar: report, ident })
        })
        .collect::<R<Vec<_>>>()?;
    let p = picks(i, v.get("picks"))?;
    Ok(runways::checks_json(&runways::runway_checks(&airplane, true, &fields, i.opt_num(v, "takeoff_lb")?, i.opt_num(v, "landing_lb")?,
                                                    p.as_ref())))
}

// --- weight and balance -----------------------------------------------------

fn envelope(i: In, v: &Value) -> R<Vec<(f64, f64)>> {
    i.list(v, "envelope")?
        .iter()
        .map(|p| match p.as_array() {
            Some([Value::Number(a), Value::Number(w)]) => Ok((*a, *w)),
            _ => i.err("envelope", "holds a point that is not [arm, weight]"),
        })
        .collect()
}

fn loading(i: In, v: &Value) -> R<Loading> {
    let l = i.obj(v, "loading")?.map_or_else(|| i.err("loading", "is missing"), Ok)?;
    Ok(Loading {
        max_ramp_lb: i.num(l, "max_ramp_lb")?,
        max_takeoff_lb: i.num(l, "max_takeoff_lb")?,
        max_landing_lb: i.num(l, "max_landing_lb")?,
        sample_empty_weight_lb: i.num(l, "sample_empty_weight_lb")?,
        sample_empty_moment_lb_in: i.num(l, "sample_empty_moment_lb_in")?,
        stations: i
            .list(l, "stations")?
            .iter()
            .map(|s| Ok(Station { name: i.str(s, "name")?, arm_in: i.num(s, "arm_in")?, max_lb: i.opt_num(s, "max_lb")? }))
            .collect::<R<_>>()?,
        baggage_combined_max_lb: i.opt_num(l, "baggage_combined_max_lb")?,
        fuel_arm_in: i.num(l, "fuel_arm_in")?,
        fuel_max_gal: i.num(l, "fuel_max_gal")?,
        // Avgas's standard 6 lb a gallon (FAA-H-8083-1B, Aircraft Weight
        // and Balance Handbook), where the airplane's handbook gives none.
        fuel_lb_per_gal: i.opt_num(l, "fuel_lb_per_gal")?.unwrap_or(6.0),
        start_taxi_fuel_lb: i.opt_num(l, "start_taxi_fuel_lb")?.unwrap_or(0.0),
        envelope: envelope(i, l)?,
    })
}

fn load(i: In, v: &Value) -> R<Load> {
    let l = i.obj(v, "load")?.map_or_else(|| i.err("load", "is missing"), Ok)?;
    Ok(Load {
        empty_weight_lb: i.num(l, "empty_weight_lb")?,
        empty_arm_in: i.num(l, "empty_arm_in")?,
        stations_lb: i
            .list(l, "stations_lb")?
            .iter()
            .map(|x| match x {
                Value::Null => Ok(None),
                Value::Number(n) => Ok(Some(*n)),
                _ => i.err("stations_lb", "holds a non-number"),
            })
            .collect::<R<_>>()?,
        fuel_gal: i.num(l, "fuel_gal")?,
    })
}
