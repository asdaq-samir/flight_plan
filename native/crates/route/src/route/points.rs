//! A route's point as the address names it, and the pilot's own point off
//! a fix: the web app's lib/identSchema (stopOf, isFixIdent, frdOf,
//! frdIdent), the planner's POINT and wingtip.fixes' parse_frd and
//! frd_ident, and the iPhone's RouteExtras.frd.
//!
//! The pilot's own point is a fix, the magnetic course or radial from it
//! and the distance, nm: "VPBNG/090/30" as ForeFlight's route takes it, or
//! packed, "DLH090030", the FAA flight plan's fix/radial/distance (FAA
//! Form 7233-4, item 15, route; AIM 5-1-6). Its course is 000 to 360 and
//! its distance above nothing and out to 999 nm, as the planner places one.

use super::{all, js_string, normal, upper_alnum};
use crate::figures::words::js_round;

/// What a point of the route is by its form.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// An airport's or a named fix's ident -- a VFR waypoint (VPBNG), a GPS
    /// waypoint -- two to five letters and figures.
    Fix,
    /// The pilot's own point off a fix, "VPBNG/090/30" or "DLH090030".
    Own,
}

impl Kind {
    pub fn key(self) -> &'static str {
        match self {
            Kind::Fix => "fix",
            Kind::Own => "own",
        }
    }
}

fn digits(s: &str, min: usize, max: usize) -> bool {
    all(s, min, max, |c| c.is_ascii_digit())
}

/// Up to `whole` figures and at most one after a point: "30", "4.5".
fn tenths(s: &str, whole: usize) -> bool {
    match s.split_once('.') {
        Some((w, t)) => digits(w, 1, whole) && digits(t, 1, 1),
        None => digits(s, 1, whole),
    }
}

/// A point's parts as written "VPBNG/090/30": the fix, the course's three
/// figures and the distance's.
fn written(s: &str) -> Option<(&str, &str, &str)> {
    let mut parts = s.split('/');
    let (base, course, nm) = (parts.next()?, parts.next()?, parts.next()?);
    (parts.next().is_none() && all(base, 2, 5, upper_alnum) && digits(course, 3, 3) && tenths(nm, 3)).then_some((base, course, nm))
}

/// Packed as a flight plan writes it, "DLH090030": the fix's letters,
/// three figures of course and three of distance.
fn packed(s: &str) -> Option<(&str, &str, &str)> {
    let base_len = s.len().checked_sub(6)?;
    if !s.is_ascii() || !(2..=5).contains(&base_len) {
        return None;
    }
    let (base, figures) = s.split_at(base_len);
    (base.bytes().all(|c| c.is_ascii_uppercase()) && digits(figures, 6, 6)).then(|| (base, &figures[..3], &figures[3..]))
}

/// What `ident` is by its form, read as it is (uppercase, no space round
/// it): a fix's ident, the pilot's own point, or None. The form only: a
/// course past 360 is still the form of one, which the planner then
/// cannot place.
pub fn kind(ident: &str) -> Option<Kind> {
    if all(ident, 2, 5, upper_alnum) {
        Some(Kind::Fix)
    } else if written(ident).is_some() || packed(ident).is_some() {
        Some(Kind::Own)
    } else {
        None
    }
}

/// The pilot's own point off a fix (wingtip.fixes.parse_frd), trimmed and
/// uppercased: its fix, its course 0 to 359 (360 is north, 0) and its
/// distance, nm; None where `text` is not one, or its course is past 360
/// or its distance nothing or past 999 nm.
pub fn frd(text: &str) -> Option<(String, i64, f64)> {
    let s = normal(text);
    let (base, course, nm) = written(&s).or_else(|| packed(&s))?;
    let course: i64 = course.parse().ok()?;
    let nm: f64 = nm.parse().ok()?;
    if !(0..=360).contains(&course) || !(nm > 0.0 && nm <= 999.0) {
        return None;
    }
    Some((base.to_owned(), course % 360, nm))
}

/// The pilot's point as the route writes it, "VPBNG/090/30": the course
/// to the degree, 000 for north, and the distance to a tenth of a mile.
pub fn frd_ident(base: &str, course: f64, distance_nm: f64) -> String {
    let nm = js_round(distance_nm * 10.0) as f64 / 10.0;
    format!("{}/{:03}/{}", super::upper(base), js_round(course).rem_euclid(360), js_string(nm))
}

/// A field's FAA ident, trimmed and uppercased: the CIFP names it by its
/// ICAO ident (KDLH) where the route may have the FAA's (DLH), so a K and
/// three letters or figures is the three.
pub fn bare_field(ident: &str) -> String {
    let s = normal(ident);
    if s.len() == 4 && s.starts_with('K') && s.bytes().all(upper_alnum) {
        s[1..].to_owned()
    } else {
        s
    }
}

/// Whether two idents name one field (bare_field).
pub fn same_field(a: &str, b: &str) -> bool {
    bare_field(a) == bare_field(b)
}
