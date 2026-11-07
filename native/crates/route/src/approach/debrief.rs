//! A flown instrument approach debriefed against the procedure it flew,
//! at the owner's ask (2026-10-30, the plan to teach flying approaches):
//! which of the field's approaches the track flew, found by its final --
//! through the final approach fix inbound and down the final course --
//! then fix by fix how far off the coded course it was and for how long
//! past full-scale deflection, how high it crossed each fix against the
//! altitude published there, how far above or below the glidepath it came
//! down where one is published, how low before the missed approach point,
//! and when the missed approach began or where it landed.
//!
//! The procedure is the FAA's CIFP as the planner draws it
//! (wingtip.procedures.procedure_drawing): its lines, its fixes with their
//! roles and crossing altitudes, and its placed glidepath (runway_path).
//! The track is GPS's (a GPX or KML file, or a followed airplane's ADS-B
//! reports), so its altitude is not the altimeter's and its course is a
//! ground track: what is measured here is close to what an instructor
//! sees, not the panel's needles. Measured, not judged, where no figure is
//! sure: a VOR's or an NDB's course is given in miles off and marked
//! nowhere.
//!
//! Flat over the approach (a plane through the missed approach point, as
//! the flight debrief takes each leg): within 30 nm of it the error is a
//! few feet in a mile.
//!
//! The web's lib/approachDebrief, ported line for line with its words.

use super::{Drawing, RunwayPath, FT_PER_NM};
use crate::figures::debrief::{airborne, Point};
use crate::figures::words::{alt_ft, grouped, js_num, js_round_f, to_fixed};
use crate::geo::distance_nm;
use crate::json;
use crate::motion::rad;

/// How near a fix the track has to come, nm off the course through it, to
/// have flown over it -- the app's own figure for "it went that way", a
/// terminal GPS's full scale (AIM 1-1-17), not a rule.
pub const PASS_NM: f64 = 1.0;
/// The mean distance off the final, nm, from the final approach fix to the
/// missed approach point, over which a track is not taken to have flown
/// that approach at all (a straight-in from somewhere else). The app's.
pub const MATCH_NM: f64 = 0.5;
/// How far over the final approach fix's altitude, ft, the track may cross
/// it and still be flying the approach rather than overflying it.
pub const MATCH_FT: f64 = 1500.0;

/// A localizer's full scale: 2.5° either side of its course (the
/// Instrument Flying Handbook, FAA-H-8083-15B, chapter 9: "a full-scale
/// deflection shows when the aircraft is 2.5° to either side of the
/// centerline"), its width set to 700 ft from full fly-left to full
/// fly-right at the threshold, transmitted from the far end of the runway
/// (AIM 1-1-9). So half of it is 350 ft at the threshold, opening at 2.5°
/// from there out.
pub const LOCALIZER_DEG: f64 = 2.5;
pub const LOCALIZER_THRESHOLD_FT: f64 = 350.0;
/// A GPS's full scale, nm either side (AIM 1-1-17): terminal ±1 nm to 2 nm
/// before the final approach waypoint, from there narrowing smoothly to
/// the approach's ±0.3 nm at it, and ±0.3 nm down the final. An LPV's is
/// angular and narrower near the runway (AIM 1-1-18): LNAV's is used for
/// every RNAV (GPS) final, the wider of the two.
pub const GPS_TERMINAL_NM: f64 = 1.0;
pub const GPS_APPROACH_NM: f64 = 0.3;
pub const GPS_RAMP_NM: f64 = 2.0;
/// A glide slope's full scale: its beam is 1.4° thick (AIM 1-1-9; FAA-H-
/// 8083-15B chapter 9), 0.7° either side of the path, from its antenna 750
/// to 1,250 ft down the runway (AIM 1-1-9): 1,000 ft taken here.
pub const GLIDESLOPE_DEG: f64 = 0.7;
pub const GLIDESLOPE_ANTENNA_FT: f64 = 1000.0;
/// The earth's mean radius, ft: a straight glidepath rises above the
/// curved sea level by d²/2R, 32 ft at 6 nm, which the chart's glide
/// slope altitude at the final approach fix includes (KBUR's ILS 08: 2,753
/// ft at BUDDE, 6.0 nm out on 3.00° from 787 ft).
const EARTH_FT: f64 = 6_371_000.0 * 3.28084;
/// The mean distance off a glidepath, ft, within which the track is
/// taken to have come down it: two approaches down one final are told
/// apart by it. The app's.
const GLIDEPATH_FIT_FT: f64 = 150.0;
/// A climb of this much from the lowest point after the final approach
/// fix is the missed approach begun, its start that lowest point. The
/// app's: GPS altitude wanders tens of feet.
pub const CLIMB_FT: f64 = 150.0;
/// Where the track, slowed to taxiing, is taken to have landed on the
/// approach's runway: within this of its missed approach point, nm.
const LANDED_NM: f64 = 3.0;
/// Two approaches over a final approach fix within this, ms, are one time
/// down a final; and a transition's attempt is the vectors' one within
/// TRANSITION_MS of it.
const SAME_MS: f64 = 180_000.0;
const TRANSITION_MS: f64 = 120_000.0;
/// As good laterally, nm: the pick and the glidepath decide between two.
const AS_GOOD_NM: f64 = 0.05;

/// How the course is flown, by the approach's coded identifier (ARINC
/// 424-18 5.10, wingtip.procedures APPROACH_TYPES): a localizer's ("I", "L"),
/// a GPS's ("R", "P", and the circling "RNV-", "GPS-"), or another (VOR,
/// NDB, LDA, back course), whose course is measured and marked nowhere:
/// a VOR's and an NDB's full scale is an angle from a station the
/// drawing does not place.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Guidance {
    Localizer,
    Gps,
    Other,
}

impl Guidance {
    pub fn key(self) -> &'static str {
        match self {
            Guidance::Localizer => "localizer",
            Guidance::Gps => "gps",
            Guidance::Other => "other",
        }
    }
}

pub fn guidance_of(id: &str) -> Guidance {
    let b = id.as_bytes();
    let upper = |c: u8| c.is_ascii_uppercase();
    // /^(RNV|GPS)-?[A-Z]$/: a circling RNAV or GPS approach.
    if (id.starts_with("RNV") || id.starts_with("GPS"))
        && ((b.len() == 4 && upper(b[3])) || (b.len() == 5 && b[3] == b'-' && upper(b[4])))
    {
        return Guidance::Gps;
    }
    // /^([A-Z])\d\d[LCR]?(-?[A-Z])?$/: the kind, the runway, a letter.
    let kind = (|| {
        if b.len() < 3 || !upper(b[0]) || !b[1].is_ascii_digit() || !b[2].is_ascii_digit() {
            return None;
        }
        let mut rest = &b[3..];
        let tail_ok = |t: &[u8]| t.is_empty() || (t.len() == 1 && upper(t[0])) || (t.len() == 2 && t[0] == b'-' && upper(t[1]));
        if tail_ok(rest) {
            return Some(b[0]);
        }
        if matches!(rest.first(), Some(b'L' | b'C' | b'R')) {
            rest = &rest[1..];
            if tail_ok(rest) {
                return Some(b[0]);
            }
        }
        None
    })();
    match kind {
        Some(b'I' | b'L') => Guidance::Localizer,
        Some(b'R' | b'P') => Guidance::Gps,
        _ => Guidance::Other,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Tone {
    Stop,
    Caution,
    Ok,
    Info,
}

impl Tone {
    pub fn key(self) -> &'static str {
        match self {
            Tone::Stop => "stop",
            Tone::Caution => "caution",
            Tone::Ok => "ok",
            Tone::Info => "info",
        }
    }

    pub fn read(s: &str) -> Option<Tone> {
        Some(match s {
            "stop" => Tone::Stop,
            "caution" => Tone::Caution,
            "ok" => Tone::Ok,
            "info" => Tone::Info,
            _ => return None,
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Finding {
    pub tone: Tone,
    pub text: String,
    /// The minimums' finding, put in again as the pilot types theirs.
    pub minimums: bool,
}

fn finding(tone: Tone, text: String) -> Finding {
    Finding { tone, text, minimums: false }
}

/// Stop first, then caution, ok and info, each kind in the order found.
fn ordered(mut findings: Vec<Finding>) -> Vec<Finding> {
    findings.sort_by_key(|f| f.tone);
    findings
}

#[derive(Clone, Debug, PartialEq)]
pub struct FixCrossing {
    pub ident: String,
    pub roles: Vec<String>,
    pub min_ft: Option<f64>,
    pub max_ft: Option<f64>,
    /// When it was crossed (ms), and how high (ft, GPS).
    pub t: f64,
    pub alt_ft: Option<f64>,
    /// Its furthest under its minimum on the way to it, ft (+ under).
    pub under_ft: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    Landed,
    Missed,
    Unknown,
}

impl Outcome {
    pub fn key(self) -> &'static str {
        match self {
            Outcome::Landed => "landed",
            Outcome::Missed => "missed",
            Outcome::Unknown => "unknown",
        }
    }

    pub fn read(s: &str) -> Option<Outcome> {
        Some(match s {
            "landed" => Outcome::Landed,
            "missed" => Outcome::Missed,
            "unknown" => Outcome::Unknown,
            _ => return None,
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct PlanFix {
    pub ident: String,
    pub lat: f64,
    pub lon: f64,
    pub roles: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ProfileFix {
    pub ident: String,
    pub to_go_nm: f64,
    pub min_ft: Option<f64>,
    pub max_ft: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ProfileGlidepath {
    pub from_nm: f64,
    pub from_ft: f64,
    pub to_nm: f64,
    pub to_ft: f64,
}

/// One attempt at an approach debriefed.
#[derive(Clone, Debug, PartialEq)]
pub struct Debrief {
    pub airport: String,
    pub id: String,
    pub name: String,
    pub transition: Option<String>,
    pub guidance: Guidance,
    /// When the track crossed the final approach fix inbound, ms.
    pub faf_at: f64,
    /// How far off the final it flew on average, nm; and off the
    /// glidepath, ft, where there is one and altitudes to say.
    pub fit_nm: f64,
    pub glidepath_fit_ft: Option<f64>,
    /// The fixes passed, in order, the missed approach's left out.
    pub crossings: Vec<FixCrossing>,
    pub findings: Vec<Finding>,
    /// The plate's plan view: the way in, the missed approach's lines, the
    /// fixes, and the track over it, each point off where it was past full
    /// scale or under a minimum.
    pub plan_inbound: Vec<(f64, f64)>,
    pub plan_missed: Vec<Vec<(f64, f64)>>,
    pub plan_fixes: Vec<PlanFix>,
    pub plan_track: Vec<(f64, f64, bool)>,
    /// The profile: the track's altitude by its distance to the missed
    /// approach point along the procedure (to go, ft, off), the fixes'
    /// minimums there, and the glidepath from the final approach fix to
    /// the runway.
    pub profile_track: Vec<(f64, f64, bool)>,
    pub profile_fixes: Vec<ProfileFix>,
    pub profile_glidepath: Option<ProfileGlidepath>,
    pub outcome: Outcome,
    pub seconds_after_map: Option<f64>,
    /// The way in's fixes before the final approach fix, and how many of
    /// them the track passed: all, where it came in by the transition.
    pub way_in_fixes: usize,
    pub way_in_passed: usize,
    pub has_altitude: bool,
    /// The lowest the track came after the final approach fix, before the
    /// missed approach point (or the climb, or the landing), ft.
    pub lowest_ft: Option<f64>,
    /// Approaches whose final the track fitted as well, by name.
    pub also_fits: Vec<String>,
}

/// An attempt at the approach: the point the track crossed the final
/// approach fix inbound from, and the points from and to which it is
/// this attempt's.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Attempt {
    pub faf: usize,
    pub from: usize,
    pub to: usize,
}

#[derive(Clone, Copy, Debug)]
struct Xy {
    x: f64,
    y: f64,
}

#[derive(Clone, Debug)]
struct PathFix {
    ident: String,
    roles: Vec<String>,
    min_ft: Option<f64>,
    max_ft: Option<f64>,
    v: usize,
}

/// The way in, as one line: the transition then the final, each vertex's
/// distance along it, the fixes at their vertices, where the final starts
/// and which of the fixes are its final approach fix and missed approach
/// point.
struct Path {
    ll: Vec<(f64, f64)>,
    xy: Vec<Xy>,
    cum: Vec<f64>,
    fixes: Vec<PathFix>,
    final_from: usize,
    faf: usize,
    map: usize,
}

/// Flat about a point: nm east and north of it.
struct Frame {
    lat0: f64,
    lon0: f64,
    kx: f64,
}

impl Frame {
    fn new(lat0: f64, lon0: f64) -> Frame {
        Frame { lat0, lon0, kx: rad(lat0).cos() * 60.0 }
    }

    fn at(&self, lat: f64, lon: f64) -> Xy {
        Xy { x: (lon - self.lon0) * self.kx, y: (lat - self.lat0) * 60.0 }
    }
}

fn path_of(d: &Drawing, frame: &Frame) -> Option<Path> {
    let mut ll: Vec<(f64, f64)> = Vec::new();
    let mut final_from: Option<usize> = None;
    for line in &d.lines {
        if line.role != "transition" && line.role != "final" {
            continue;
        }
        if line.role == "final" && final_from.is_none() {
            final_from = Some(ll.len().saturating_sub(1));
        }
        for &(lat, lon) in &line.points {
            if let Some(&(a, b)) = ll.last() {
                if (a - lat).abs() < 1e-5 && (b - lon).abs() < 1e-5 {
                    continue;
                }
            }
            ll.push((lat, lon));
        }
    }
    let final_from = final_from?;
    if ll.len() < 2 {
        return None;
    }
    let xy: Vec<Xy> = ll.iter().map(|&(lat, lon)| frame.at(lat, lon)).collect();
    let mut cum = vec![0.0];
    for i in 1..xy.len() {
        cum.push(cum[i - 1] + (xy[i].x - xy[i - 1].x).hypot(xy[i].y - xy[i - 1].y));
    }
    // Each fix at its vertex, in the order the way in reaches them.
    let mut fixes: Vec<PathFix> = Vec::new();
    let mut from = 0;
    for f in d.fixes.iter().filter(|f| !f.missed) {
        let p = frame.at(f.lat, f.lon);
        let Some(v) = (from..xy.len()).find(|&i| (xy[i].x - p.x).hypot(xy[i].y - p.y) < 0.1) else { continue };
        fixes.push(PathFix { ident: f.ident.clone(), roles: f.roles.clone(), min_ft: f.min_ft, max_ft: f.max_ft, v });
        from = v;
    }
    let faf = fixes.iter().position(|f| f.roles.iter().any(|r| r == "FAF"))?;
    let map = fixes.iter().position(|f| f.roles.iter().any(|r| r == "MAP"))?;
    if fixes[map].v <= fixes[faf].v {
        return None;
    }
    Some(Path { ll, xy, cum, fixes, final_from, faf, map })
}

/// The course through vertex v, as a unit vector: the way out of it, or
/// into it at the line's end.
fn course_at(path: &Path, v: usize) -> Xy {
    let (a, b) = if v < path.xy.len() - 1 { (path.xy[v], path.xy[v + 1]) } else { (path.xy[v - 1], path.xy[v]) };
    let len = (b.x - a.x).hypot(b.y - a.y);
    let len = if len == 0.0 { 1.0 } else { len };
    Xy { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
}

/// A pass of the track by a fix: its point index, the share of the way to
/// the next point, and how far right of the fix (nm).
#[derive(Clone, Copy, Debug)]
struct Cross {
    i: usize,
    u: f64,
    right: f64,
}

/// Each time the track crossed the line square to the course at vertex v,
/// going the course's way, within PASS_NM of it.
fn crossings(path: &Path, v: usize, xy: &[Xy], from: usize, to: usize) -> Vec<Cross> {
    let (f, d) = (path.xy[v], course_at(path, v));
    let mut out = Vec::new();
    for i in from..to.min(xy.len() - 1) {
        let (a, b) = (xy[i], xy[i + 1]);
        let sa = (a.x - f.x) * d.x + (a.y - f.y) * d.y;
        let sb = (b.x - f.x) * d.x + (b.y - f.y) * d.y;
        if !(sa < 0.0 && sb >= 0.0) {
            continue;
        }
        let u = -sa / (sb - sa);
        let (cx, cy) = (a.x + u * (b.x - a.x) - f.x, a.y + u * (b.y - a.y) - f.y);
        let right = d.y * cx - d.x * cy;
        if right.abs() <= PASS_NM {
            out.push(Cross { i, u, right });
        }
    }
    out
}

/// The track's passes by the fix at vertex v: each crossing (above); else,
/// where it turned at the fix rather than going through its line, each
/// nearest it came within PASS_NM. The first or the last of them.
fn pass_of(path: &Path, v: usize, xy: &[Xy], from: usize, to: usize, first: bool) -> Option<Cross> {
    let through = crossings(path, v, xy, from, to);
    if !through.is_empty() {
        return if first { through.first().copied() } else { through.last().copied() };
    }
    let f = path.xy[v];
    let away = |i: usize| (xy[i].x - f.x).hypot(xy[i].y - f.y);
    let mut near: Vec<Cross> = Vec::new();
    let last = to.min(xy.len() - 1);
    for i in from..=last {
        let d = away(i);
        if d <= PASS_NM && (i == from || d <= away(i - 1)) && (i == last || d < away(i + 1)) {
            near.push(Cross { i, u: 0.0, right: d });
        }
    }
    if first { near.first().copied() } else { near.last().copied() }
}

/// Where a point is against the way in between two vertices: how far
/// along it (nm from its start), how far right of it (left negative) and
/// how far from it at all.
#[derive(Clone, Copy, Debug)]
struct Against {
    along: f64,
    right: f64,
    away: f64,
}

fn against(path: &Path, p: Xy, va: usize, vb: usize) -> Against {
    let mut best = Against { along: path.cum[va], right: 0.0, away: f64::INFINITY };
    let mut k = va;
    while k < vb.max(va + 1) && k < path.xy.len() - 1 {
        let (a, b) = (path.xy[k], path.xy[k + 1]);
        let (bx, by) = (b.x - a.x, b.y - a.y);
        let len2 = bx * bx + by * by;
        let (px, py) = (p.x - a.x, p.y - a.y);
        let t = if len2 > 0.0 { ((px * bx + py * by) / len2).max(0.0).min(1.0) } else { 0.0 };
        let right = if len2 > 0.0 { (by * px - bx * py) / len2.sqrt() } else { px.hypot(py) };
        let away = (px - t * bx).hypot(py - t * by);
        if away < best.away {
            best = Against { along: path.cum[k] + t * len2.sqrt(), right, away };
        }
        k += 1;
    }
    best
}

/// The track's altitude between point i and the next, a share u of the
/// way; the nearer known one where either is missing.
fn alt_at(points: &[Point], i: usize, u: f64) -> Option<f64> {
    let a = points[i].alt_ft;
    let b = points.get(i + 1).and_then(|p| p.alt_ft);
    match (a, b) {
        (Some(a), Some(b)) => Some(a + u * (b - a)),
        _ if u < 0.5 => a.or(b),
        _ => b.or(a),
    }
}

fn time_at(points: &[Point], i: usize, u: f64) -> f64 {
    let t = points[i].t;
    t + u * (points.get(i + 1).map_or(t, |p| p.t) - t)
}

fn nm_to(p: &Point, lat: f64, lon: f64) -> f64 {
    distance_nm(p.lat, p.lon, lat, lon)
}

/// The glidepath's height at a distance from its runway's threshold, nm,
/// ft MSL: a straight line up from the runway's crossing altitude at its
/// angle, over the curved earth.
pub fn glidepath_ft(gp: &RunwayPath, nm_out: f64) -> f64 {
    let d = nm_out * FT_PER_NM;
    gp.ft + d * rad(gp.deg).tan() + (d * d) / (2.0 * EARTH_FT)
}

/// A glide slope's full scale either side, ft, at a distance from its
/// threshold (GLIDESLOPE_DEG from its antenna).
fn glideslope_half_ft(nm_out: f64) -> f64 {
    (nm_out * FT_PER_NM + GLIDESLOPE_ANTENNA_FT) * rad(GLIDESLOPE_DEG).tan()
}

fn map_fix(d: &Drawing) -> Option<&super::Fix> {
    d.fixes.iter().find(|f| f.has("MAP") && !f.missed)
}

/// Each time the track flew inbound over the approach's final approach
/// fix: the attempts at it, as point indices -- from the last one's end,
/// to the next one's start.
pub fn attempts_at(d: &Drawing, points: &[Point]) -> Vec<Attempt> {
    if points.len() < 2 {
        return Vec::new();
    }
    let Some(map) = map_fix(d) else { return Vec::new() };
    let frame = Frame::new(map.lat, map.lon);
    let Some(path) = path_of(d, &frame) else { return Vec::new() };
    let xy: Vec<Xy> = points.iter().map(|p| frame.at(p.lat, p.lon)).collect();
    let passes = crossings(&path, path.fixes[path.faf].v, &xy, 0, xy.len());
    (0..passes.len())
        .map(|k| Attempt {
            faf: passes[k].i,
            from: if k == 0 { 0 } else { passes[k - 1].i + 1 },
            to: if k + 1 < passes.len() { passes[k + 1].i } else { points.len() - 1 },
        })
        .collect()
}

/// A stretch of the track past full scale on one side.
struct Stretch {
    side: f64,
    nm: f64,
    worst: f64,
    from_along: f64,
}

/// A fix passed: which of the path's, at which point and how far on.
#[derive(Clone, Copy)]
struct Pass {
    fix: usize,
    i: usize,
    u: f64,
}

/// One attempt at an approach debriefed (the first where none is given);
/// None where the track did not fly it: never inbound over its final
/// approach fix within PASS_NM, or then not down its final within
/// MATCH_NM on average, or far over the fix's altitude. `minimums_ft` the
/// pilot's DA or MDA from the plate: the CIFP has no minimums, so none is
/// assumed.
pub fn debrief(d: &Drawing, points: &[Point], attempt: Option<Attempt>, minimums_ft: Option<f64>) -> Option<Debrief> {
    if d.kind != "approach" || points.len() < 2 {
        return None;
    }
    let map_fix = map_fix(d)?;
    let frame = Frame::new(map_fix.lat, map_fix.lon);
    let path = path_of(d, &frame)?;
    let attempt = match attempt {
        Some(a) => a,
        None => *attempts_at(d, points).first()?,
    };
    let xy: Vec<Xy> = points.iter().map(|p| frame.at(p.lat, p.lon)).collect();
    let guidance = guidance_of(&d.id);
    let gp = d.runway_path;
    let has_altitude = points.iter().any(|p| p.alt_ft.is_some());
    let (faf, map) = (path.faf, path.map);
    let faf_v = path.fixes[faf].v;
    let map_v = path.fixes[map].v;
    let faf_cross = *crossings(&path, faf_v, &xy, attempt.faf, attempt.faf + 1).first()?;

    // The missed approach point, the first time over it after the final
    // approach fix; else the track's nearest to it on the final.
    let map_pass = pass_of(&path, map_v, &xy, attempt.faf, attempt.to, true);
    // The landing: the flight's run of points over taxiing speed, ended near
    // the runway before the next attempt.
    let runs = airborne(points);
    let run = runs.iter().find(|&&(a, b)| a <= attempt.faf && b >= attempt.faf);
    // A run that ends with the track is the recording stopped in the air.
    let landed_at = run
        .filter(|&&(_, b)| b <= attempt.to && b < points.len() - 1 && nm_to(&points[b], map_fix.lat, map_fix.lon) <= LANDED_NM)
        .map(|&(_, b)| b);
    // The missed approach: the lowest point after the final approach fix
    // from which the track climbed CLIMB_FT.
    let mut climb_at: Option<usize> = None;
    if has_altitude && landed_at.is_none() {
        let mut low: Option<(usize, f64)> = None;
        for (i, p) in points.iter().enumerate().take(attempt.to + 1).skip(attempt.faf + 1) {
            let Some(alt) = p.alt_ft else { continue };
            match low {
                Some((_, low_ft)) if alt > low_ft => {
                    if alt - low_ft >= CLIMB_FT {
                        climb_at = low.map(|(k, _)| k);
                        break;
                    }
                }
                _ => low = Some((i, alt)),
            }
        }
    }
    // The scored way in ends over the missed approach point, or where the
    // climb or the landing came first.
    let end_at = [Some(map_pass.map_or(attempt.to, |p| p.i + 1)), climb_at, landed_at].into_iter().flatten().min().unwrap_or(attempt.to);
    let map_along = path.cum[map_v];

    // Each fix of the way in passed, back from the final approach fix: the
    // last time over it before the next, so a hold or a procedure turn there
    // is flown before it counts.
    let mut passes: Vec<Pass> = vec![Pass { fix: faf, i: faf_cross.i, u: faf_cross.u }];
    for k in (0..faf).rev() {
        if let Some(last) = pass_of(&path, path.fixes[k].v, &xy, attempt.from, passes[0].i, false) {
            if last.i <= passes[0].i {
                passes.insert(0, Pass { fix: k, i: last.i, u: last.u });
            }
        }
    }
    // Fixes after the final approach fix (step-downs, the MAP), forward.
    for k in faf + 1..path.fixes.len() {
        let from = passes[passes.len() - 1].i;
        if let Some(c) = pass_of(&path, path.fixes[k].v, &xy, from, end_at + 1, true) {
            passes.push(Pass { fix: k, i: c.i, u: c.u });
        }
    }
    // From vectors to the final, where no fix before the final approach fix
    // was passed: from where the track came onto the final's line, within
    // PASS_NM of it, going its way.
    let mut start_at = passes[0].i;
    let mut start_v = path.fixes[passes[0].fix].v;
    if passes[0].fix == faf {
        let mut i = faf_cross.i;
        while i > attempt.from {
            let w = against(&path, xy[i - 1], path.final_from, faf_v);
            if w.away > PASS_NM || w.along < path.cum[path.final_from] - 0.01 {
                break;
            }
            i -= 1;
        }
        start_at = i;
        start_v = path.final_from;
    }

    // The fit: the mean distance off the final, from its final approach fix.
    let (mut fit_sum, mut fit_n) = (0.0, 0usize);
    let mut i = faf_cross.i + 1;
    while i <= end_at && i < points.len() {
        let w = against(&path, xy[i], faf_v, map_v);
        if w.along >= map_along - 1e-6 && i > faf_cross.i + 1 {
            break;
        }
        fit_sum += w.away;
        fit_n += 1;
        i += 1;
    }
    let fit_nm = if fit_n > 0 { fit_sum / fit_n as f64 } else { faf_cross.right.abs() };
    if fit_nm > MATCH_NM {
        return None;
    }
    let faf_alt = alt_at(points, faf_cross.i, faf_cross.u);
    let faf_limit = path.fixes[faf].min_ft.or(path.fixes[faf].max_ft);
    if let (Some(alt), Some(limit)) = (faf_alt, faf_limit) {
        if alt - limit > MATCH_FT {
            return None;
        }
    }

    let faf_along = path.cum[faf_v];
    // Full scale either side at a distance along the way in, nm; None where
    // no figure is sure (see Guidance).
    let full_scale = |along: f64| -> Option<f64> {
        match guidance {
            Guidance::Gps => Some(if along >= faf_along {
                GPS_APPROACH_NM
            } else if along >= faf_along - GPS_RAMP_NM {
                GPS_TERMINAL_NM - ((GPS_TERMINAL_NM - GPS_APPROACH_NM) * (along - (faf_along - GPS_RAMP_NM))) / GPS_RAMP_NM
            } else {
                GPS_TERMINAL_NM
            }),
            Guidance::Localizer if gp.is_some() && along >= path.cum[path.final_from] => {
                let out_ft = (map_along - along).max(0.0) * FT_PER_NM;
                Some((LOCALIZER_THRESHOLD_FT + out_ft * rad(LOCALIZER_DEG).tan()) / FT_PER_NM)
            }
            _ => None,
        }
    };

    let mut findings: Vec<Finding> = Vec::new();
    let mut track_off = vec![false; points.len()];
    let mut along_at: Vec<(usize, f64)> = Vec::new();
    let mut stretches: Vec<Stretch> = Vec::new();
    let mut open = false;
    let mut worst_right = 0.0_f64;
    // A hold or a procedure turn at a fix (a hold in lieu of one) is flown
    // off the line by design: from first coming to the fix to the last time
    // over it inbound, the course is not scored.
    let hold_at = |ident: &str| d.holds.iter().any(|h| !h.missed && h.fix == ident);
    let mut reversing = vec![false; points.len()];
    for (k, pass) in passes.iter().enumerate() {
        if !hold_at(&path.fixes[pass.fix].ident) {
            continue;
        }
        let from = if k == 0 { start_at } else { passes[k - 1].i + 1 };
        let fix = path.xy[path.fixes[pass.fix].v];
        let first = (attempt.from.max(from)..=pass.i).find(|&i| (xy[i].x - fix.x).hypot(xy[i].y - fix.y) <= PASS_NM);
        if let Some(first) = first {
            for r in reversing.iter_mut().take(pass.i + 1).skip(first + 1) {
                *r = true;
            }
        }
    }
    // Course: each point from the start to the end, against the way in
    // between the fixes it was passed between.
    let last_v = path.xy.len() - 2;
    let mut seg: isize = -1;
    let mut i = start_at;
    while i <= end_at && i < points.len() {
        while ((seg + 1) as usize) < passes.len() && i > passes[(seg + 1) as usize].i {
            seg += 1;
        }
        let va = if seg < 0 { start_v } else { path.fixes[passes[seg as usize].fix].v };
        let vb = if ((seg + 1) as usize) < passes.len() { path.fixes[passes[(seg + 1) as usize].fix].v } else { map_v };
        let lo = last_v.min(va.min(vb));
        let w = against(&path, xy[i], lo, (lo + 1).max(va).max(vb));
        along_at.push((i, w.along));
        if reversing[i] {
            open = false;
            i += 1;
            continue;
        }
        if w.right.abs() > worst_right.abs() {
            worst_right = w.right;
        }
        let off = full_scale(w.along).is_some_and(|scale| w.right.abs() > scale);
        if off {
            let step = if i > start_at { distance_nm(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon) } else { 0.0 };
            let side = sign(w.right);
            match stretches.last_mut() {
                Some(s) if open && s.side == side => {
                    s.nm += step;
                    if w.right.abs() > s.worst.abs() {
                        s.worst = w.right;
                    }
                }
                _ => {
                    stretches.push(Stretch { side, nm: 0.0, worst: w.right, from_along: w.along });
                    open = true;
                }
            }
            track_off[i] = true;
        } else {
            open = false;
        }
        i += 1;
    }
    let where_ = |s: &Stretch| -> String {
        if s.from_along >= faf_along - 1e-6 {
            return "on final".to_owned();
        }
        let before = path.fixes.iter().rev().find(|f| path.cum[f.v] <= s.from_along + 1e-6);
        let next = path.fixes.iter().find(|f| path.cum[f.v] > s.from_along + 1e-6);
        match (before, next) {
            (Some(b), Some(n)) => format!("from {} to {}", b.ident, n.ident),
            (None, Some(n)) => format!("before {}", n.ident),
            _ => "on the way in".to_owned(),
        }
    };
    for s in &stretches {
        findings.push(finding(
            Tone::Stop,
            format!(
                "Full scale {} of the course for {} nm {}, {} nm off at most",
                if s.side > 0.0 { "right" } else { "left" },
                to_fixed(s.nm.max(0.1), 1),
                where_(s),
                to_fixed(s.worst.abs(), 1)
            ),
        ));
    }

    // Altitude at and before each fix: none under its minimum on the way to
    // it from the fix before -- a step-down's altitude holds until it is
    // passed, and those before it during the descent (AIM 5-4-5) -- and none
    // over its maximum where it is crossed.
    let mut crossings_out: Vec<FixCrossing> = Vec::new();
    for (k, pass) in passes.iter().enumerate() {
        let fix = &path.fixes[pass.fix];
        let alt = alt_at(points, pass.i, pass.u);
        let from = if k == 0 { start_at } else { passes[k - 1].i + 1 };
        let is_map = pass.fix == map;
        let floor_at = |i: usize| -> Option<f64> {
            let min = fix.min_ft?;
            if is_map {
                return None;
            }
            // Down the glidepath before the final approach fix, under its
            // intercept altitude, is the approach flown (AIM 5-4-5): the floor
            // there is the lower of the two, less the glide slope's full scale.
            if let (true, Some(gp)) = (pass.fix == faf, gp.as_ref()) {
                let out = nm_to(&points[i], gp.lat, gp.lon);
                return Some(min.min(glidepath_ft(gp, out) - glideslope_half_ft(out)));
            }
            Some(min)
        };
        let mut under: Option<f64> = None;
        for (i, p) in points.iter().enumerate().take(pass.i + 1).skip(from) {
            let (Some(a), Some(floor)) = (p.alt_ft, floor_at(i)) else { continue };
            if floor - a > 0.0 && under.is_none_or(|u| floor - a > u) {
                under = Some(floor - a);
            }
            if floor - a > 0.0 {
                track_off[i] = true;
            }
        }
        let floor_here = floor_at(pass.i);
        if let (Some(a), Some(floor)) = (alt, floor_here) {
            if floor - a > 0.0 && under.is_none_or(|u| floor - a > u) {
                under = Some(floor - a);
            }
        }
        crossings_out.push(FixCrossing {
            ident: fix.ident.clone(),
            roles: fix.roles.clone(),
            min_ft: fix.min_ft,
            max_ft: fix.max_ft,
            t: time_at(points, pass.i, pass.u),
            alt_ft: alt,
            under_ft: under,
        });
        if let (Some(under), Some(min)) = (under, fix.min_ft) {
            let at_fix = matches!((alt, floor_here), (Some(a), Some(floor)) if floor - a >= under - 1.0);
            // Inside the final, a step-down's altitude is the MDA's line of
            // minimums' alone, not a glidepath's DA (AIM 5-4-5).
            let step_down = path.cum[fix.v] > faf_along + 1e-6;
            findings.push(finding(
                if step_down { Tone::Caution } else { Tone::Stop },
                format!(
                    "{} {}: {} ft below {}{}",
                    if at_fix { "At" } else { "Before" },
                    fix.ident,
                    grouped(js_round_f(under)),
                    alt_ft(Some(min)),
                    if step_down { " (an MDA's step-down, not a glidepath's)" } else { "" }
                ),
            ));
        }
        // The final approach fix's "at" altitude is the glide slope's intercept
        // where there is a glidepath, crossed lower on it (ARINC 424-18 5.29 "I").
        if let (Some(max), Some(a)) = (fix.max_ft, alt) {
            if a - max > 0.0 && !is_map && !(pass.fix == faf && gp.is_some()) {
                findings.push(finding(Tone::Stop, format!("At {}: {} ft above {}", fix.ident, grouped(js_round_f(a - max)), alt_ft(Some(max)))));
            }
        }
    }

    // The glidepath, from the final approach fix to the runway: how far over
    // and under it, and on a glide slope, how long past its full scale.
    let mut profile_gp: Option<ProfileGlidepath> = None;
    let (mut gp_sum, mut gp_n) = (0.0, 0usize);
    if let Some(gp) = gp.as_ref() {
        let from_nm = map_along - faf_along;
        profile_gp = Some(ProfileGlidepath { from_nm, from_ft: glidepath_ft(gp, from_nm), to_nm: 0.0, to_ft: gp.ft });
        let (mut high, mut low): (Option<f64>, Option<f64>) = (None, None);
        let (mut under_nm, mut over_nm) = (0.0, 0.0);
        let mut i = faf_cross.i + 1;
        while i <= end_at && i < points.len() {
            let p = &points[i];
            if let Some(alt) = p.alt_ft {
                let out = nm_to(p, gp.lat, gp.lon);
                let dev = alt - glidepath_ft(gp, out);
                gp_sum += dev.abs();
                gp_n += 1;
                high = Some(high.map_or(dev, |h| h.max(dev)));
                low = Some(low.map_or(dev, |l| l.min(dev)));
                if guidance == Guidance::Localizer {
                    let scale = glideslope_half_ft(out);
                    let step = distance_nm(points[i - 1].lat, points[i - 1].lon, p.lat, p.lon);
                    if dev < -scale {
                        under_nm += step;
                        track_off[i] = true;
                    }
                    if dev > scale {
                        over_nm += step;
                    }
                }
            }
            i += 1;
        }
        if let (Some(high), Some(low)) = (high, low) {
            let said = |ft: f64| format!("{} ft {}", grouped((js_round_f(ft / 10.0) * 10.0).abs()), if ft >= 0.0 { "above" } else { "below" });
            findings.push(finding(Tone::Info, format!("Glidepath ({}°): from {} to {} it", to_fixed(gp.deg, 2), said(high), said(low))));
            if under_nm > 0.0 {
                findings.push(finding(Tone::Stop, format!("Below the glide slope's full scale for {} nm", to_fixed(under_nm.max(0.1), 1))));
            }
            if over_nm > 0.0 {
                findings.push(finding(Tone::Caution, format!("Above the glide slope's full scale for {} nm", to_fixed(over_nm.max(0.1), 1))));
            }
        }
    }

    // The lowest before the missed approach point, held to the pilot's
    // minimums where they give them (with_minimums).
    let mut lowest_ft: Option<f64> = None;
    let mut i = faf_cross.i + 1;
    while i <= end_at && i < points.len() {
        if let Some(a) = points[i].alt_ft {
            if lowest_ft.is_none_or(|l| a < l) {
                lowest_ft = Some(a);
            }
        }
        i += 1;
    }
    if !has_altitude {
        findings.push(finding(Tone::Info, "The track has no altitudes: the course alone is debriefed".to_owned()));
    }

    // The missed approach, against the missed approach point, or the landing.
    let map_t = map_pass.map(|p| time_at(points, p.i, p.u));
    let (mut outcome, mut seconds_after_map) = (Outcome::Unknown, None);
    if let Some(landed) = landed_at {
        let s = map_t.map(|t| (points[landed].t - t) / 1000.0);
        (outcome, seconds_after_map) = (Outcome::Landed, s);
        findings.push(finding(Tone::Info, s.map_or_else(|| "Landed".to_owned(), |s| format!("Landed {} s after the MAP", js_num(js_round_f(s))))));
    } else if let Some(climb) = climb_at {
        let s = map_t.map(|t| (points[climb].t - t) / 1000.0);
        (outcome, seconds_after_map) = (Outcome::Missed, s);
        let w = against(&path, xy[climb], faf_v, map_v);
        let short = map_along - w.along;
        let text = match s {
            Some(s) if js_round_f(s) >= 0.0 => {
                if js_round_f(s) == 0.0 {
                    "Missed approach started at the MAP".to_owned()
                } else {
                    format!("Missed approach started {} s after the MAP", js_num(js_round_f(s)))
                }
            }
            _ => format!(
                "Missed approach started {} nm before the MAP{}",
                to_fixed(short, 1),
                s.map_or_else(String::new, |s| format!(" ({} s)", js_num(js_round_f(-s))))
            ),
        };
        findings.push(finding(Tone::Info, text));
    } else if has_altitude {
        findings.push(finding(Tone::Info, "No climb or landing after the MAP in the track".to_owned()));
    }
    let side = |r: f64| if r >= 0.0 { "right" } else { "left" };
    if stretches.is_empty() && guidance != Guidance::Other {
        findings.push(finding(Tone::Ok, format!("Within full scale all the way, {} nm {} at most", to_fixed(worst_right.abs(), 1), side(worst_right))));
    } else if guidance == Guidance::Other {
        findings.push(finding(Tone::Info, format!("Course: {} nm {} of it at most", to_fixed(worst_right.abs(), 1), side(worst_right))));
    }

    // The track drawn: from where it came onto the way in to a couple of
    // minutes into the missed approach, or the landing.
    let draw_to = attempt.to.min(match (landed_at, climb_at) {
        (Some(l), _) => l,
        (None, Some(c)) => c + time_index(points, c, 120_000.0).max(1),
        (None, None) => end_at + 1,
    });
    let draw_from = attempt.from.max(start_at.saturating_sub(5));
    let plan_track: Vec<(f64, f64, bool)> =
        (draw_from..=draw_to.min(points.len() - 1)).map(|i| (points[i].lat, points[i].lon, track_off[i])).collect();
    let profile_all: Vec<(f64, f64, bool)> =
        along_at.iter().filter_map(|&(i, along)| points[i].alt_ft.map(|alt| (map_along - along, alt, track_off[i]))).collect();
    let every = profile_all.len().div_ceil(300).max(1);
    let profile_track = profile_all.iter().enumerate().filter(|(i, _)| i % every == 0).map(|(_, p)| *p).collect();
    let way_in_passed = passes.iter().position(|p| p.fix == faf).unwrap_or(0);
    let flown = Debrief {
        airport: d.airport.clone(),
        id: d.id.clone(),
        name: d.name.clone(),
        transition: d.transition.clone(),
        guidance,
        faf_at: time_at(points, faf_cross.i, faf_cross.u),
        fit_nm,
        glidepath_fit_ft: if gp_n > 0 { Some(gp_sum / gp_n as f64) } else { None },
        crossings: crossings_out,
        findings: ordered(findings),
        plan_inbound: path.ll.clone(),
        plan_missed: d.lines.iter().filter(|l| l.role == "missed").map(|l| l.points.clone()).collect(),
        plan_fixes: d.fixes.iter().map(|f| PlanFix { ident: f.ident.clone(), lat: f.lat, lon: f.lon, roles: f.roles.clone() }).collect(),
        plan_track,
        profile_track,
        profile_fixes: path
            .fixes
            .iter()
            .map(|f| ProfileFix { ident: f.ident.clone(), to_go_nm: map_along - path.cum[f.v], min_ft: f.min_ft, max_ft: f.max_ft })
            .collect(),
        profile_glidepath: profile_gp,
        outcome,
        seconds_after_map,
        way_in_fixes: faf,
        way_in_passed,
        has_altitude,
        lowest_ft,
        also_fits: Vec::new(),
    };
    let findings = with_minimums(&flown.findings, flown.lowest_ft, flown.outcome, minimums_ft);
    Some(Debrief { findings, ..flown })
}

/// JavaScript's Math.sign, which is 0 at 0 where Rust's signum is 1.
fn sign(n: f64) -> f64 {
    if n > 0.0 {
        1.0
    } else if n < 0.0 {
        -1.0
    } else {
        n
    }
}

/// A debrief's findings held to the pilot's minimums, the DA or MDA they
/// flew to (the CIFP has none): under them before a missed approach is
/// flying below them without the runway in sight, which 14 CFR 91.175(c)
/// and (e) do not allow; under them to land is what (c) allows with it in
/// sight. With none given, the lowest is said, measured. Again as they
/// are typed.
pub fn with_minimums(findings: &[Finding], lowest_ft: Option<f64>, outcome: Outcome, minimums_ft: Option<f64>) -> Vec<Finding> {
    let rest: Vec<Finding> = findings.iter().filter(|f| !f.minimums).cloned().collect();
    let Some(low) = lowest_ft else { return rest };
    let (tone, text) = match minimums_ft {
        Some(mins) if low < mins => {
            if outcome == Outcome::Landed {
                (Tone::Info, format!("Below {} to land: 91.175(c) asks for the runway in sight there", alt_ft(Some(mins))))
            } else {
                (
                    Tone::Stop,
                    format!(
                        "Down to {} before the missed approach, {} ft below {}",
                        alt_ft(Some(low)),
                        grouped(js_round_f(mins - low)),
                        alt_ft(Some(mins))
                    ),
                )
            }
        }
        _ => (
            if minimums_ft.is_some() { Tone::Ok } else { Tone::Info },
            format!(
                "Lowest before the MAP: {} ft{}",
                alt_ft(Some(low)),
                minimums_ft.map_or_else(String::new, |m| format!(", at or above {}", alt_ft(Some(m))))
            ),
        ),
    };
    let mut all = rest;
    all.push(Finding { tone, text, minimums: true });
    ordered(all)
}

/// How many points on from `i` the track is `ms` later.
fn time_index(points: &[Point], i: usize, ms: f64) -> usize {
    let mut k = i;
    while k < points.len() - 1 && points[k].t - points[i].t < ms {
        k += 1;
    }
    k - i
}

/// The approaches the track flew, one for each time it came down a final:
/// of the field's approaches drawn (each without a transition, as from
/// vectors, or with the one picked), the one whose final it fitted best;
/// the one the pilot picked for the flight where it fits as well.
pub fn find_approaches(drawings: &[Drawing], points: &[Point], picked: Option<&str>, minimums_ft: Option<f64>) -> Vec<Debrief> {
    let mut found: Vec<Debrief> = Vec::new();
    for d in drawings {
        for attempt in attempts_at(d, points) {
            if let Some(flown) = debrief(d, points, Some(attempt), minimums_ft) {
                found.push(flown);
            }
        }
    }
    // One a time down a final: those within three minutes over a final
    // approach fix are one, the best kept and the rest named with it. As
    // good laterally (within 0.05 nm), the one picked for the flight wins,
    // then one whose glidepath the track came down (within GLIDEPATH_FIT_FT).
    found.sort_by(|a, b| a.faf_at.partial_cmp(&b.faf_at).unwrap_or(std::cmp::Ordering::Equal));
    let followed = |f: &Debrief| f.glidepath_fit_ft.is_some_and(|ft| ft <= GLIDEPATH_FIT_FT);
    let is_picked = |f: &Debrief| picked.is_some_and(|p| f.id == p);
    let beats = |f: &Debrief, g: &Debrief| {
        if (f.fit_nm - g.fit_nm).abs() >= AS_GOOD_NM {
            return f.fit_nm < g.fit_nm;
        }
        if is_picked(f) != is_picked(g) {
            return is_picked(f);
        }
        if followed(f) != followed(g) {
            return followed(f);
        }
        false
    };
    let mut kept: Vec<Debrief> = Vec::new();
    for f in found {
        let Some(k) = kept.iter().position(|g| (g.faf_at - f.faf_at).abs() < SAME_MS) else {
            kept.push(f);
            continue;
        };
        let same = &kept[k];
        let near = (f.fit_nm - same.fit_nm).abs() < AS_GOOD_NM;
        if beats(&f, same) {
            let mut also = same.also_fits.clone();
            if near {
                also.push(same.name.clone());
            }
            kept[k] = Debrief { also_fits: also, ..f };
        } else if near && !same.also_fits.contains(&f.name) {
            kept[k].also_fits.push(f.name.clone());
        }
    }
    kept
}

/// Of an approach's transitions drawn, the one the track came in by, from
/// the vectors' debrief (its final approach fix crossed at `faf_at`, ms,
/// `passed` fixes before it): every fix of it before the final passed, and
/// the most of them; None where none was flown.
pub fn with_transition(faf_at: f64, passed: usize, drawings: &[Drawing], points: &[Point], minimums_ft: Option<f64>) -> Option<Debrief> {
    let (mut best, mut best_fixes) = (None, passed);
    for d in drawings {
        let Some(attempt) = attempts_at(d, points).into_iter().find(|a| (points[a.faf].t - faf_at).abs() < TRANSITION_MS) else { continue };
        let Some(flown) = debrief(d, points, Some(attempt), minimums_ft) else { continue };
        if flown.way_in_passed == flown.way_in_fixes && flown.way_in_passed > best_fixes {
            best_fixes = flown.way_in_passed;
            best = Some(flown);
        }
    }
    best
}

fn pairs_json(out: &mut String, points: &[(f64, f64)]) {
    out.push('[');
    for (i, (lat, lon)) in points.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push('[');
        json::number(out, *lat);
        out.push(',');
        json::number(out, *lon);
        out.push(']');
    }
    out.push(']');
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

pub fn findings_json(out: &mut String, findings: &[Finding]) {
    out.push('[');
    for (i, f) in findings.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"tone\":");
        json::string(out, f.tone.key());
        out.push_str(",\"text\":");
        json::string(out, &f.text);
        if f.minimums {
            out.push_str(",\"minimums\":true");
        }
        out.push('}');
    }
    out.push(']');
}

/// The debrief as JSON, snake_case: the web's ApproachDebrief's members.
pub fn to_json(out: &mut String, d: &Debrief) {
    out.push_str("{\"airport\":");
    json::string(out, &d.airport);
    out.push_str(",\"id\":");
    json::string(out, &d.id);
    out.push_str(",\"name\":");
    json::string(out, &d.name);
    out.push_str(",\"transition\":");
    json::opt_string(out, d.transition.as_deref());
    out.push_str(",\"guidance\":");
    json::string(out, d.guidance.key());
    out.push_str(",\"faf_at\":");
    json::number(out, d.faf_at);
    out.push_str(",\"fit_nm\":");
    json::number(out, d.fit_nm);
    out.push_str(",\"glidepath_fit_ft\":");
    json::opt_number(out, d.glidepath_fit_ft);
    out.push_str(",\"crossings\":[");
    for (i, c) in d.crossings.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"ident\":");
        json::string(out, &c.ident);
        out.push_str(",\"roles\":");
        strings_json(out, &c.roles);
        out.push_str(",\"min_ft\":");
        json::opt_number(out, c.min_ft);
        out.push_str(",\"max_ft\":");
        json::opt_number(out, c.max_ft);
        out.push_str(",\"t\":");
        json::number(out, c.t);
        out.push_str(",\"alt_ft\":");
        json::opt_number(out, c.alt_ft);
        out.push_str(",\"under_ft\":");
        json::opt_number(out, c.under_ft);
        out.push('}');
    }
    out.push_str("],\"findings\":");
    findings_json(out, &d.findings);
    out.push_str(",\"lowest_ft\":");
    json::opt_number(out, d.lowest_ft);
    out.push_str(",\"plan\":{\"inbound\":");
    pairs_json(out, &d.plan_inbound);
    out.push_str(",\"missed\":[");
    for (i, line) in d.plan_missed.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        pairs_json(out, line);
    }
    out.push_str("],\"fixes\":[");
    for (i, f) in d.plan_fixes.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"ident\":");
        json::string(out, &f.ident);
        out.push_str(",\"lat\":");
        json::number(out, f.lat);
        out.push_str(",\"lon\":");
        json::number(out, f.lon);
        out.push_str(",\"roles\":");
        strings_json(out, &f.roles);
        out.push('}');
    }
    out.push_str("],\"track\":[");
    for (i, (lat, lon, off)) in d.plan_track.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"lat\":");
        json::number(out, *lat);
        out.push_str(",\"lon\":");
        json::number(out, *lon);
        out.push_str(if *off { ",\"off\":true}" } else { ",\"off\":false}" });
    }
    out.push_str("]},\"profile\":{\"track\":[");
    for (i, (to_go, alt, off)) in d.profile_track.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"to_go_nm\":");
        json::number(out, *to_go);
        out.push_str(",\"alt_ft\":");
        json::number(out, *alt);
        out.push_str(if *off { ",\"off\":true}" } else { ",\"off\":false}" });
    }
    out.push_str("],\"fixes\":[");
    for (i, f) in d.profile_fixes.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"ident\":");
        json::string(out, &f.ident);
        out.push_str(",\"to_go_nm\":");
        json::number(out, f.to_go_nm);
        out.push_str(",\"min_ft\":");
        json::opt_number(out, f.min_ft);
        out.push_str(",\"max_ft\":");
        json::opt_number(out, f.max_ft);
        out.push('}');
    }
    out.push_str("],\"glidepath\":");
    match &d.profile_glidepath {
        None => out.push_str("null"),
        Some(g) => {
            out.push_str("{\"from_nm\":");
            json::number(out, g.from_nm);
            out.push_str(",\"from_ft\":");
            json::number(out, g.from_ft);
            out.push_str(",\"to_nm\":");
            json::number(out, g.to_nm);
            out.push_str(",\"to_ft\":");
            json::number(out, g.to_ft);
            out.push('}');
        }
    }
    out.push_str("},\"outcome\":{\"kind\":");
    json::string(out, d.outcome.key());
    out.push_str(",\"seconds_after_map\":");
    json::opt_number(out, d.seconds_after_map);
    out.push_str("},\"has_altitude\":");
    out.push_str(if d.has_altitude { "true" } else { "false" });
    out.push_str(",\"also_fits\":");
    strings_json(out, &d.also_fits);
    out.push_str(&format!(",\"way_in\":{{\"fixes\":{},\"passed\":{}}}}}", d.way_in_fixes, d.way_in_passed));
}
