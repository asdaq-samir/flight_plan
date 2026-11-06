//! A hold the pilot puts anywhere on the route, as Garmin's and
//! ForeFlight's pilot-defined holds are: at one of the route's points, its
//! inbound course (magnetic), its turns, its legs by time or distance and
//! how long it is held, written as the address has it --
//! "VPBNG/090/30:270:R:1M:2T" -- and the minutes flying it takes, which
//! the planner adds to the flight's time and fuel. The web app's lib/holds,
//! wingtip.holds' parse and figures, and the iPhone's Hold; the entry and the
//! legs' minutes by altitude are crate::figures::holding's.
//!
//! A no-wind racetrack, at the leg's true airspeed: a pilot corrects for
//! the wind as it is found there, and a timed hold's lap takes as long
//! whatever the wind (its inbound leg is the timed one, its outbound
//! adjusted to it).

use super::{all, js_string, normal};

/// A standard-rate turn, degrees a second: a 180 degree turn at either end
/// of the racetrack is a minute (FAA-H-8083-15B, Instrument Flying
/// Handbook, ch. 7, "Standard Rate Turns").
pub const STANDARD_RATE_DEG_S: f64 = 3.0;

/// A hold's legs: timed, or by distance.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Leg {
    Minutes(f64),
    Nm(f64),
}

/// How long a hold is held: turns round the racetrack, or minutes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Length {
    Turns(u32),
    Minutes(u32),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Hold {
    /// The point held at: an airport, a fix, or the pilot's own point off
    /// one.
    pub fix: String,
    /// The inbound course to the fix, magnetic degrees, 0 to 359.
    pub inbound: u32,
    pub right: bool,
    pub leg: Leg,
    pub length: Length,
}

fn digits(s: &str, min: usize, max: usize) -> bool {
    all(s, min, max, |c| c.is_ascii_digit())
}

/// A length as the address codes it, "2T" two turns, "10M" ten minutes:
/// one to three figures, above nothing. The text as it is.
fn length_of(s: &str) -> Option<Length> {
    let (n, turns) = match s.strip_suffix('T') {
        Some(n) => (n, true),
        None => (s.strip_suffix('M')?, false),
    };
    if !digits(n, 1, 3) {
        return None;
    }
    let n: u32 = n.parse().ok()?;
    match (n > 0, turns) {
        (false, _) => None,
        (true, true) => Some(Length::Turns(n)),
        (true, false) => Some(Length::Minutes(n)),
    }
}

/// A length's code read back, trimmed and uppercased; None for one that
/// is not.
pub fn length_read(text: &str) -> Option<Length> {
    length_of(&normal(text))
}

/// A length as the address codes it: "2T", "10M".
pub fn length_code(length: Length) -> String {
    match length {
        Length::Turns(n) => format!("{n}T"),
        Length::Minutes(n) => format!("{n}M"),
    }
}

/// A leg as the address codes it, "1M", "1.5M", "4N": under a hundred, to
/// a tenth, above nothing.
fn leg_of(s: &str) -> Option<Leg> {
    let (n, timed) = match s.strip_suffix('M') {
        Some(n) => (n, true),
        None => (s.strip_suffix('N')?, false),
    };
    let ok = match n.split_once('.') {
        Some((w, t)) => digits(w, 1, 2) && digits(t, 1, 1),
        None => digits(n, 1, 2),
    };
    if !ok {
        return None;
    }
    let n: f64 = n.parse().ok()?;
    match (n > 0.0, timed) {
        (false, _) => None,
        (true, true) => Some(Leg::Minutes(n)),
        (true, false) => Some(Leg::Nm(n)),
    }
}

/// One hold as the address writes it, trimmed and uppercased: a point of
/// letters, figures, "/" and "."; a course of one to three figures, to 360
/// (360 is north, 0); R or L; its legs; how long. None where it is not one.
pub fn read(text: &str) -> Option<Hold> {
    let s = normal(text);
    let mut parts = s.split(':');
    let (fix, inbound, turns, leg, length) = (parts.next()?, parts.next()?, parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() || fix.is_empty() || !fix.bytes().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == b'/' || c == b'.') {
        return None;
    }
    if !digits(inbound, 1, 3) {
        return None;
    }
    let inbound: u32 = inbound.parse().ok()?;
    let right = match turns {
        "R" => true,
        "L" => false,
        _ => return None,
    };
    if inbound > 360 {
        return None;
    }
    Some(Hold { fix: fix.to_owned(), inbound: inbound % 360, right, leg: leg_of(leg)?, length: length_of(length)? })
}

/// The pieces of a list of holds, "A,B": each trimmed, the empty ones left
/// out, with the hold it is or None. The address leaves out one that is
/// not; the planner answers a 422 naming it.
pub fn read_all(text: &str) -> Vec<(String, Option<Hold>)> {
    text.split(',').map(super::trim).filter(|p| !p.is_empty()).map(|p| (p.to_owned(), read(p))).collect()
}

/// A hold as the address writes it, which the planner reads: the inbound
/// course padded to three figures, as the web app wrote it,
/// "VPBNG/090/30:270:R:1M:2T". `inbound` as given, a hold read being 0 to
/// 359 already.
pub fn write(fix: &str, inbound: f64, right: bool, leg: Leg, length: Length) -> String {
    let leg = match leg {
        Leg::Minutes(m) => format!("{}M", js_string(m)),
        Leg::Nm(nm) => format!("{}N", js_string(nm)),
    };
    format!("{fix}:{:0>3}:{}:{leg}:{}", js_string(inbound), if right { "R" } else { "L" }, length_code(length))
}

/// A standard-rate turn's radius at `tas_kt`, nm: half a circle in a
/// minute flies TAS/60 nm, so the radius is TAS/(60 pi) -- 0.64 nm at 120
/// kt.
pub fn turn_radius_nm(tas_kt: f64) -> f64 {
    tas_kt / (60.0 * std::f64::consts::PI) * (3.0 / STANDARD_RATE_DEG_S)
}

/// One turn round the racetrack, minutes: its two legs and its two 180
/// degree turns at standard rate (a minute each). A distance leg is flown
/// at `tas_kt`.
pub fn lap_minutes(leg: Leg, tas_kt: f64) -> f64 {
    let turns = 2.0 * 180.0 / STANDARD_RATE_DEG_S / 60.0;
    let leg = match leg {
        Leg::Minutes(m) => m,
        Leg::Nm(nm) => nm / tas_kt.max(1.0) * 60.0,
    };
    2.0 * leg + turns
}

/// How long the hold is flown, minutes: the minutes given, or its turns
/// round the racetrack (one where neither is given, as wingtip.holds had it).
pub fn held_minutes(leg: Leg, turns: Option<f64>, minutes: Option<f64>, tas_kt: f64) -> f64 {
    match minutes {
        Some(m) => m,
        None => turns.filter(|t| *t != 0.0).unwrap_or(1.0) * lap_minutes(leg, tas_kt),
    }
}

/// A hold's minutes, as `held_minutes` has them, from its length.
pub fn length_minutes(leg: Leg, length: Length, tas_kt: f64) -> f64 {
    match length {
        Length::Turns(n) => held_minutes(leg, Some(n as f64), None, tas_kt),
        Length::Minutes(n) => held_minutes(leg, None, Some(n as f64), tas_kt),
    }
}
