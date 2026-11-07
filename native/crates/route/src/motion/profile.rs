//! The plan from the side (the web's navlog/profile): the plan's altitudes
//! as a line over the ground, from the nav log's rows -- up from each field
//! to its top of climb, level, down from each top of descent at three to
//! one, to a lower leg's level or to the pattern a mile out and the field,
//! and up again from a stop. The dry run flies these heights.
//!
//! The rows are the web's NavLogRow, as navLogRows builds them from the
//! planner's legs (/api/plan's Leg, with its toc and tod): `{"kind":
//! "departure"|"checkpoint"|"stop"|"destination"|"toc"|"tod", "airport"?,
//! "cp"?, "point"?, "leg"?, "part"?}`. A row's figures are its `part`, the
//! piece of its leg that arrives at it, where a top of climb or descent
//! cuts the leg, else its whole `leg`.

use super::{num, opt, present};
use crate::json::{self, Value};

/// Feet lost for every nautical mile of a descent: three to one, 333
/// ft/nm, as the nav log descends (wingtip.navlog.with_descents) -- a little
/// steeper than a 3° path's 318 ft/nm (6,076 × tan 3°), the angle a VASI is
/// normally set at (AIM 2-1-2).
pub const DESCENT_FT_PER_NM: f64 = 1000.0 / 3.0;
/// Where the pattern altitude is reached before a field: the downwind's
/// abeam, about a mile out.
pub const PATTERN_NM: f64 = 1.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Departure,
    Checkpoint,
    Stop,
    Destination,
    Toc,
    Tod,
}

/// A top of climb's or descent's figures, as the planner puts them on a leg.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LegPoint {
    pub along_nm: f64,
    pub altitude_ft: f64,
    /// A top of descent's: the altitude it descends to, and whether that is
    /// the pattern's.
    pub to_ft: f64,
    pub pattern: bool,
}

/// A nav log row, as the rules read it.
#[derive(Clone, Debug)]
pub struct Row<'a> {
    pub kind: Kind,
    /// Its place on the chart (the web's rowPoint).
    pub lat: f64,
    pub lon: f64,
    /// An airport row's: its ident, elevation, and whether it is a fix
    /// flown through rather than a field landed at.
    pub ident: String,
    pub elevation_ft: Option<f64>,
    pub fix: bool,
    pub point: Option<LegPoint>,
    pub leg: Option<&'a Value>,
    pub part: Option<&'a Value>,
}

impl<'a> Row<'a> {
    /// What the row's figures are: the piece of its leg that arrives at it,
    /// the whole leg where nothing cuts it; the departure has none.
    pub fn leg_of(&self) -> Option<&'a Value> {
        if self.kind == Kind::Departure {
            None
        } else {
            self.part.or(self.leg)
        }
    }

    /// The tops of climb and descent: rows of their own.
    pub fn is_leg_point(&self) -> bool {
        matches!(self.kind, Kind::Toc | Kind::Tod)
    }

    /// A field landed at: a stop or the destination that is not a fix.
    pub fn lands(&self) -> bool {
        matches!(self.kind, Kind::Stop | Kind::Destination) && !self.fix
    }
}

fn object<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    match v.get(key) {
        None | Some(Value::Null) => None,
        Some(x) => Some(x),
    }
}

/// The rows read from the web's NavLogRow list.
pub fn rows_of<'a>(n: &str, rows: &'a [Value]) -> Result<Vec<Row<'a>>, String> {
    rows.iter()
        .map(|r| {
            let kind = match r.get("kind").and_then(Value::as_str) {
                Some("departure") => Kind::Departure,
                Some("checkpoint") => Kind::Checkpoint,
                Some("stop") => Kind::Stop,
                Some("destination") => Kind::Destination,
                Some("toc") => Kind::Toc,
                Some("tod") => Kind::Tod,
                other => return Err(format!("{n}: a row's \"kind\" is not one of the nav log's, {other:?}")),
            };
            let at = match kind {
                Kind::Checkpoint => object(r, "cp"),
                Kind::Toc | Kind::Tod => object(r, "point"),
                _ => object(r, "airport"),
            }
            .ok_or_else(|| format!("{n}: a row has no place on the chart"))?;
            let airport = object(r, "airport");
            let point = match (kind, object(r, "point")) {
                (Kind::Toc | Kind::Tod, Some(p)) => Some(LegPoint {
                    along_nm: num(n, p, "along_nm")?,
                    altitude_ft: num(n, p, "altitude_ft")?,
                    to_ft: opt(n, p, "to_ft")?.unwrap_or(f64::NAN),
                    pattern: matches!(p.get("pattern"), Some(Value::Bool(true))),
                }),
                _ => None,
            };
            Ok(Row {
                kind,
                lat: num(n, at, "lat")?,
                lon: num(n, at, "lon")?,
                ident: airport.and_then(|a| a.get("ident")).and_then(Value::as_str).unwrap_or("").to_owned(),
                elevation_ft: match airport {
                    Some(a) => opt(n, a, "elevation_ft")?,
                    None => None,
                },
                fix: airport.and_then(|a| a.get("kind")).and_then(Value::as_str) == Some("fix"),
                point,
                leg: object(r, "leg"),
                part: object(r, "part"),
            })
        })
        .collect()
}

/// A number of a leg, NaN where it is missing, as the web's sum of an
/// undefined is.
pub(crate) fn f(leg: &Value, key: &str) -> f64 {
    leg.get(key).and_then(Value::as_f64).unwrap_or(f64::NAN)
}

/// A number of a leg that may be null.
pub(crate) fn maybe(leg: &Value, key: &str) -> Option<f64> {
    leg.get(key).and_then(Value::as_f64)
}

/// A point of the line: how far along the route, nm, and the plan's
/// altitude there, ft.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ProfilePoint {
    pub along_nm: f64,
    pub plan_ft: f64,
}

/// A top of climb (true) or descent on the line.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Mark {
    pub toc: bool,
    pub along_nm: f64,
    pub plan_ft: f64,
}

/// The plan's altitudes as a line over the ground, from the nav log's
/// rows. Distances are the legs' own, checkpoint to checkpoint; a row whose
/// leg is not in yet ends the line there. The line, its marks, and its
/// length, nm.
pub fn plan_profile(rows: &[Row]) -> (Vec<ProfilePoint>, Vec<Mark>, f64) {
    let mut points = Vec::new();
    let mut marks = Vec::new();
    let mut point = |along_nm: f64, plan_ft: f64| points.push(ProfilePoint { along_nm, plan_ft });
    let mut along = 0.0;
    // The altitude flown level, None while climbing or descending.
    let mut level: Option<f64> = None;
    // A descent under way: the altitude it levels at, where, and whether
    // to the pattern.
    let mut descent: Option<(f64, f64, bool)> = None;
    for row in rows {
        if row.kind == Kind::Departure {
            point(0.0, row.elevation_ft.unwrap_or(0.0));
            continue;
        }
        let Some(part) = row.leg_of() else { break };
        let start = along;
        along += f(part, "distance_nm");
        // A step-down levelling off on this piece.
        if let Some((to, at, false)) = descent {
            if at <= along {
                point(at, to);
                level = Some(to);
                descent = None;
            }
        }
        match (row.kind, row.point) {
            (Kind::Toc, Some(p)) => {
                point(along, p.altitude_ft);
                marks.push(Mark { toc: true, along_nm: along, plan_ft: p.altitude_ft });
                level = Some(p.altitude_ft);
            }
            (Kind::Tod, Some(p)) => {
                point(along, p.altitude_ft);
                marks.push(Mark { toc: false, along_nm: along, plan_ft: p.altitude_ft });
                descent = Some((p.to_ft, along + (p.altitude_ft - p.to_ft) / DESCENT_FT_PER_NM, p.pattern));
                level = None;
            }
            _ if row.lands() => {
                // A landing: the pattern a mile out, the field, and a climb anew.
                if let Some((to, _, true)) = descent {
                    point(f64::max(start, along - PATTERN_NM), to);
                }
                point(along, row.elevation_ft.unwrap_or(0.0));
                descent = None;
                level = None;
            }
            _ => {
                // A fix flown through: a point on the line where it is level
                // -- not mid-climb (a leg that climbs and tops out on a later
                // one) or mid-descent.
                let climbing_through = row.leg.is_some_and(|leg| maybe(leg, "climb_min").is_some_and(|m| m > 0.0) && !present(leg, "toc"));
                if climbing_through || descent.is_some() {
                    continue;
                }
                let at = *level.get_or_insert(f(part, "altitude_ft"));
                point(along, at);
            }
        }
    }
    (points, marks, along)
}

pub(crate) fn line_json(out: &mut String, line: &[ProfilePoint]) {
    out.push('[');
    for (i, p) in line.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"along_nm\":");
        json::number(out, p.along_nm);
        out.push_str(",\"plan_ft\":");
        json::number(out, p.plan_ft);
        out.push('}');
    }
    out.push(']');
}

/// About where a three-to-one descent (DESCENT_FT_PER_NM) to pattern
/// altitude has the airplane `nm_out` from the field, to the hundred feet,
/// no higher than its cruise: as the nav log flies it, and as the radio
/// calls say the altitude ten miles out. The cruise where no pattern
/// altitude is known.
pub fn descent_altitude(cruise_ft: f64, pattern_ft: Option<f64>, nm_out: f64) -> f64 {
    match pattern_ft {
        None => cruise_ft,
        // JavaScript's Math.round, half up, as the web wrote it.
        Some(p) => cruise_ft.min(((p + nm_out * DESCENT_FT_PER_NM) / 100.0 + 0.5).floor() * 100.0),
    }
}

/// `descent_altitude`: feet MSL, from `{"cruise_ft", "pattern_ft"?, "nm_out"}`.
pub(super) fn descent_altitude_rule(v: &Value) -> Result<String, String> {
    let n = "descent_altitude";
    let mut out = String::new();
    json::number(&mut out, descent_altitude(num(n, v, "cruise_ft")?, opt(n, v, "pattern_ft")?, num(n, v, "nm_out")?));
    Ok(out)
}

/// `plan_profile`: {"points": [{along_nm, plan_ft}], "marks": [{kind:
/// "TOC"|"TOD", along_nm, plan_ft}], "length_nm"}, from `{"rows"}`.
pub(super) fn profile_rule(v: &Value) -> Result<String, String> {
    let n = "plan_profile";
    let raw = v.get("rows").and_then(Value::as_array).ok_or("plan_profile: \"rows\" is missing or not a list")?;
    let (points, marks, length) = plan_profile(&rows_of(n, raw)?);
    let mut out = String::from("{\"points\":");
    line_json(&mut out, &points);
    out.push_str(",\"marks\":[");
    for (i, m) in marks.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(if m.toc { "{\"kind\":\"TOC\",\"along_nm\":" } else { "{\"kind\":\"TOD\",\"along_nm\":" });
        json::number(&mut out, m.along_nm);
        out.push_str(",\"plan_ft\":");
        json::number(&mut out, m.plan_ft);
        out.push('}');
    }
    out.push_str("],\"length_nm\":");
    json::number(&mut out, length);
    out.push('}');
    Ok(out)
}
