//! Instrument approaches taught and debriefed, one copy for the web app
//! (callEngine), the planner (wingtip_native.call) and the phones (wt_call),
//! so the iPhone can teach an approach and debrief one flown with no
//! signal, from the same rules:
//!
//! - `debrief`: a flown approach judged against its procedure -- which of
//!   the field's approaches the track flew, how far off the course and for
//!   how long past full scale (AIM 1-1-9, 1-1-17), how high it crossed each
//!   fix against its altitude (AIM 5-4-5), the glidepath, the lowest before
//!   the missed approach point against the pilot's minimums (14 CFR
//!   91.175(c), (e)), and the missed approach or the landing (the web's
//!   lib/approachDebrief);
//! - `lesson`: the approach briefed, flown fix by fix with a word at each,
//!   seen from the side and asked back as a quiz -- the descent rate on the
//!   path (the TPP's rate of descent table), the approach category (14 CFR
//!   97.3), the minimums' kind, the missed approach in the plate's words
//!   (the web's lib/approachLesson);
//! - `calls`: the rules by name, as crate::call lists them.
//!
//! Both read the procedure as the planner draws it from the FAA's CIFP
//! (wingtip.procedures.procedure_drawing, /api/procedure's answer), `Drawing`
//! below. What runs every frame -- the lesson's airplane moved along its
//! line on the map -- stays in each app; these are worked out once a
//! procedure, a flight or a step.

pub mod calls;
pub mod debrief;
pub mod lesson;

use crate::json::Value;

/// Feet in a nautical mile (1,852 m), as the web's lib/geo FT_PER_NM.
pub const FT_PER_NM: f64 = 6076.12;

/// A fix of the procedure: its place, its roles ("IAF", "IF", "FACF",
/// "FAF", "MAP", "hold"), its crossing altitudes, and whether it is the
/// missed approach's.
#[derive(Clone, Debug, PartialEq)]
pub struct Fix {
    pub ident: String,
    pub lat: f64,
    pub lon: f64,
    pub roles: Vec<String>,
    pub min_ft: Option<f64>,
    pub max_ft: Option<f64>,
    pub missed: bool,
}

impl Fix {
    pub fn has(&self, role: &str) -> bool {
        self.roles.iter().any(|r| r == role)
    }
}

/// A part of the procedure's line: "transition", "final", "missed",
/// "common" or "runway", its points (lat, lon).
#[derive(Clone, Debug, PartialEq)]
pub struct Line {
    pub role: String,
    pub points: Vec<(f64, f64)>,
}

/// A hold or a procedure turn drawn at a fix.
#[derive(Clone, Debug, PartialEq)]
pub struct Hold {
    pub fix: String,
    /// "hold" or "procedure turn".
    pub kind: String,
    pub missed: bool,
}

/// A missed approach's coded leg (ARINC 424-18 5.21's path and
/// terminator, "CA", "VI", "CF", "HM" ...).
#[derive(Clone, Debug, PartialEq)]
pub struct MissedLeg {
    pub path: String,
    pub fix: Option<String>,
    pub course_deg: Option<f64>,
    /// "L" or "R".
    pub turn: Option<String>,
    pub min_ft: Option<f64>,
    pub max_ft: Option<f64>,
}

/// The glidepath placed on its runway: its threshold, the height it
/// crosses it at (ft MSL) and its angle.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RunwayPath {
    pub lat: f64,
    pub lon: f64,
    pub ft: f64,
    pub deg: f64,
}

/// A procedure as the planner draws it (/api/procedure).
#[derive(Clone, Debug, PartialEq)]
pub struct Drawing {
    pub airport: String,
    /// "approach", "arrival" or "departure".
    pub kind: String,
    pub id: String,
    pub name: String,
    pub transition: Option<String>,
    pub stale: bool,
    pub glidepath_deg: Option<f64>,
    pub final_course_deg: Option<f64>,
    pub lines: Vec<Line>,
    pub holds: Vec<Hold>,
    pub fixes: Vec<Fix>,
    pub missed_legs: Vec<MissedLeg>,
    pub runway_path: Option<RunwayPath>,
}

type R<T> = Result<T, String>;

pub(crate) fn opt_num(name: &str, v: &Value, key: &str) -> R<Option<f64>> {
    match v.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => Ok(Some(*n)),
        Some(_) => Err(format!("{name}: \"{key}\" is not a number")),
    }
}

pub(crate) fn num(name: &str, v: &Value, key: &str) -> R<f64> {
    opt_num(name, v, key)?.ok_or_else(|| format!("{name}: \"{key}\" is missing"))
}

pub(crate) fn opt_str(name: &str, v: &Value, key: &str) -> R<Option<String>> {
    match v.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(format!("{name}: \"{key}\" is not a string")),
    }
}

pub(crate) fn str_or_empty(name: &str, v: &Value, key: &str) -> R<String> {
    Ok(opt_str(name, v, key)?.unwrap_or_default())
}

pub(crate) fn flag(name: &str, v: &Value, key: &str) -> R<bool> {
    match v.get(key) {
        None | Some(Value::Null) => Ok(false),
        Some(Value::Bool(b)) => Ok(*b),
        Some(_) => Err(format!("{name}: \"{key}\" is not true or false")),
    }
}

pub(crate) fn list<'a>(name: &str, v: &'a Value, key: &str) -> R<&'a [Value]> {
    match v.get(key) {
        None | Some(Value::Null) => Ok(&[]),
        Some(Value::Array(items)) => Ok(items),
        Some(_) => Err(format!("{name}: \"{key}\" is not a list")),
    }
}

/// A [lat, lon] pair.
pub(crate) fn pair(name: &str, v: &Value) -> R<(f64, f64)> {
    match v.as_array() {
        Some([Value::Number(lat), Value::Number(lon), ..]) => Ok((*lat, *lon)),
        _ => Err(format!("{name}: a point is not [lat, lon]")),
    }
}

impl Drawing {
    /// The planner's drawing, read from its JSON.
    pub fn read(name: &str, v: &Value) -> R<Drawing> {
        if !matches!(v, Value::Object(_)) {
            return Err(format!("{name}: a drawing is not an object"));
        }
        let lines = list(name, v, "lines")?
            .iter()
            .map(|l| {
                Ok(Line {
                    role: str_or_empty(name, l, "role")?,
                    points: list(name, l, "points")?.iter().map(|p| pair(name, p)).collect::<R<_>>()?,
                })
            })
            .collect::<R<_>>()?;
        let holds = list(name, v, "holds")?
            .iter()
            .map(|h| Ok(Hold { fix: str_or_empty(name, h, "fix")?, kind: str_or_empty(name, h, "kind")?, missed: flag(name, h, "missed")? }))
            .collect::<R<_>>()?;
        let fixes = list(name, v, "fixes")?
            .iter()
            .map(|f| {
                Ok(Fix {
                    ident: str_or_empty(name, f, "ident")?,
                    lat: num(name, f, "lat")?,
                    lon: num(name, f, "lon")?,
                    roles: list(name, f, "roles")?
                        .iter()
                        .map(|r| r.as_str().map(str::to_owned).ok_or_else(|| format!("{name}: a fix's role is not a string")))
                        .collect::<R<_>>()?,
                    min_ft: opt_num(name, f, "min_ft")?,
                    max_ft: opt_num(name, f, "max_ft")?,
                    missed: flag(name, f, "missed")?,
                })
            })
            .collect::<R<_>>()?;
        let missed_legs = missed_legs(name, list(name, v, "missed_legs")?)?;
        let runway_path = match v.get("runway_path") {
            None | Some(Value::Null) => None,
            Some(p @ Value::Object(_)) => Some(RunwayPath {
                lat: num(name, p, "lat")?,
                lon: num(name, p, "lon")?,
                ft: num(name, p, "ft")?,
                deg: num(name, p, "deg")?,
            }),
            Some(_) => return Err(format!("{name}: \"runway_path\" is not an object")),
        };
        Ok(Drawing {
            airport: str_or_empty(name, v, "airport")?,
            kind: str_or_empty(name, v, "kind")?,
            id: str_or_empty(name, v, "id")?,
            name: str_or_empty(name, v, "name")?,
            transition: opt_str(name, v, "transition")?,
            stale: flag(name, v, "stale")?,
            glidepath_deg: opt_num(name, v, "glidepath_deg")?,
            final_course_deg: opt_num(name, v, "final_course_deg")?,
            lines,
            holds,
            fixes,
            missed_legs,
            runway_path,
        })
    }
}

/// A missed approach's coded legs, read from their JSON.
pub(crate) fn missed_legs(name: &str, items: &[Value]) -> R<Vec<MissedLeg>> {
    items
        .iter()
        .map(|l| {
            Ok(MissedLeg {
                path: str_or_empty(name, l, "path")?,
                fix: opt_str(name, l, "fix")?,
                course_deg: opt_num(name, l, "course_deg")?,
                turn: opt_str(name, l, "turn")?,
                min_ft: opt_num(name, l, "min_ft")?,
                max_ft: opt_num(name, l, "max_ft")?,
            })
        })
        .collect()
}
