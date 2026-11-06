//! A flight debriefed from its flown track (the roadmap's debrief, against
//! ACS PA.VI.A's tolerances): the saved flight's nav log is the plan, the
//! track what was flown. Leg by leg, how much of the cruise was within 200
//! ft of the planned altitude and how much of the way the ground track was
//! within 15 degrees of the course, and how far off the line it went
//! (within 3 nm, S5); at each checkpoint, when it was passed against when
//! it was due (within 5 minutes, S6) and how close; at each field landed
//! at, the altitude about where the downwind starts against the pattern's.
//!
//! Deterministic: measured, not judged. GPS altitude is not the
//! altimeter's and a ground track is not a heading, so each figure is
//! close to what the examiner sees, not it -- the page says so.
//!
//! app.figures.debrief (itself web/src/lib/debrief.ts): the web's copy
//! holds the same rules and changes with this. Its checkpoints are the
//! saved flight's (the gateway's FlightCheckpointDto) and its points the
//! track's (TrackDto: `t` in ms since 1970, GPS altitude in feet).

use crate::geo::{angle_between, bearing_deg, distance_nm};
use crate::json;

/// PA.VI.A's tolerances: S7's altitude, and its heading applied to the
/// ground track; S5's distance from the planned route; S6's time at each
/// checkpoint against its estimate.
pub const ALTITUDE_FT: f64 = 200.0;
pub const COURSE_DEG: f64 = 15.0;
pub const OFF_ROUTE_NM: f64 = 3.0;
pub const ETA_MIN: f64 = 5.0;
/// How near the field the downwind is taken to start, and PA.III.B.S5's
/// pattern altitude.
pub const PATTERN_NM: f64 = 1.5;
pub const PATTERN_FT: f64 = 100.0;
/// Slower than this over the ground, the airplane is on the ground (the
/// web's lib/map/glide AIRBORNE_KT): a fast taxi is under it, a light
/// single's slowest flight over it.
pub const AIRBORNE_KT: f64 = 40.0;

/// A point of the flown track: `t` ms since 1970, GPS altitude in feet
/// where the file has one.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub t: f64,
    pub lat: f64,
    pub lon: f64,
    pub alt_ft: Option<f64>,
}

/// A saved flight's checkpoint: its place and the plan's figures into it.
#[derive(Clone, Debug, PartialEq)]
pub struct Checkpoint {
    pub sequence_no: i64,
    pub name: String,
    /// "departure", "stop", "destination", or a checkpoint's own kind.
    pub category: String,
    pub lat: f64,
    pub lon: f64,
    pub along_track_nm: f64,
    pub true_course_deg: Option<f64>,
    pub ete_min: Option<f64>,
    pub altitude_ft: Option<f64>,
}

/// A leg graded.
#[derive(Clone, Debug, PartialEq)]
pub struct LegGrade {
    pub from: String,
    pub to: String,
    pub planned_alt_ft: Option<f64>,
    pub altitude_within: Option<f64>,
    pub worst_alt_ft: Option<f64>,
    pub course_deg: Option<f64>,
    pub course_within: Option<f64>,
    pub worst_off_nm: Option<f64>,
}

/// A checkpoint passed: minutes from the takeoff it was due and passed.
#[derive(Clone, Debug, PartialEq)]
pub struct Pass {
    pub name: String,
    pub category: String,
    pub due_min: Option<f64>,
    pub passed_min: Option<f64>,
    pub closest_nm: Option<f64>,
}

/// The altitude PATTERN_NM from a field landed at, and its pattern's.
#[derive(Clone, Debug, PartialEq)]
pub struct PatternEntry {
    pub ident: String,
    pub alt_ft: f64,
    pub pattern_ft: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LinePoint {
    pub lat: f64,
    pub lon: f64,
    pub off: bool,
}

/// The flight debriefed (unmarked: `marks` and `debrief_json` add each
/// finding's mark).
#[derive(Clone, Debug, PartialEq)]
pub struct Debrief {
    pub takeoff: f64,
    pub landing: f64,
    pub flown_min: f64,
    pub planned_min: Option<f64>,
    pub legs: Vec<LegGrade>,
    pub passes: Vec<Pass>,
    pub patterns: Vec<PatternEntry>,
    /// Along the route, nm, and the altitude there.
    pub profile: Vec<(f64, f64)>,
    /// Each leg's from and to, nm along, and its planned altitude.
    pub planned: Vec<(f64, f64, Option<f64>)>,
    pub line: Vec<LinePoint>,
    pub has_altitude: bool,
    pub notes: Vec<String>,
}

fn nm(a: (f64, f64), b: (f64, f64)) -> f64 {
    distance_nm(a.0, a.1, b.0, b.1)
}

fn at(p: &Point) -> (f64, f64) {
    (p.lat, p.lon)
}

fn place(c: &Checkpoint) -> (f64, f64) {
    (c.lat, c.lon)
}

/// Ground speed at each point, knots: over at least ten seconds round it,
/// which a one-second GPS's jitter would otherwise make a mess of.
fn ground_speeds(points: &[Point]) -> Vec<f64> {
    let last = points.len().saturating_sub(1);
    (0..points.len())
        .map(|i| {
            let (mut j, mut k) = (i, i);
            while points[k].t - points[j].t < 10_000.0 && (j > 0 || k < last) {
                if j > 0 {
                    j -= 1;
                }
                if k < last {
                    k += 1;
                }
            }
            let hours = (points[k].t - points[j].t) / 3_600_000.0;
            if hours > 0.0 { nm(at(&points[j]), at(&points[k])) / hours } else { 0.0 }
        })
        .collect()
}

/// The track's flights: each run of points over AIRBORNE_KT, as (first,
/// last) indices, a minute's dip under it (a slow flight, a go-around)
/// kept in, and a run of under a minute (a fast taxi) dropped.
pub fn airborne(points: &[Point]) -> Vec<(usize, usize)> {
    let mut runs: Vec<(usize, usize)> = Vec::new();
    for (i, kt) in ground_speeds(points).into_iter().enumerate() {
        if kt < AIRBORNE_KT {
            continue;
        }
        match runs.last_mut() {
            Some(run) if points[i].t - points[run.1].t < 60_000.0 => run.1 = i,
            _ => runs.push((i, i)),
        }
    }
    runs.retain(|r| points[r.1].t - points[r.0].t >= 60_000.0);
    runs
}

/// Where a point is against a segment: how far along it (0 to 1), how far
/// right of it (left negative), and how far from it at all. Flat over a
/// leg, which is near enough at a leg's length.
fn against(from: &Checkpoint, to: &Checkpoint, p: &Point) -> (f64, f64, f64) {
    // d * pi / 180 in that order, as the Python's _rad (to_radians
    // multiplies by pi / 180, a last bit apart).
    let kx = (from.lat * std::f64::consts::PI / 180.0).cos() * 60.0;
    let (bx, by) = ((to.lon - from.lon) * kx, (to.lat - from.lat) * 60.0);
    let (px, py) = ((p.lon - from.lon) * kx, (p.lat - from.lat) * 60.0);
    let len2 = bx * bx + by * by;
    let t = if len2 > 0.0 { (px * bx + py * by) / len2 } else { 0.0 };
    let right = if len2 > 0.0 { -(bx * py - by * px) / len2.sqrt() } else { px.hypot(py) };
    let away = if t < 0.0 {
        px.hypot(py)
    } else if t > 1.0 {
        (px - bx).hypot(py - by)
    } else {
        right.abs()
    };
    (t.clamp(0.0, 1.0), right, away)
}

/// The flight's hops, by checkpoint index: from each field taken off from
/// to the next landed at.
fn hops(cps: &[Checkpoint]) -> Vec<(usize, usize)> {
    let fields: Vec<usize> = (0..cps.len()).filter(|&i| i == 0 || i == cps.len() - 1 || cps[i].category == "stop").collect();
    fields.windows(2).map(|w| (w[0], w[1])).collect()
}

#[derive(Default, Clone, Copy)]
struct Grade {
    alt_w: f64,
    alt_in: f64,
    worst_alt: Option<f64>,
    course_w: f64,
    course_in: f64,
    worst_off: Option<f64>,
}

/// A flight debriefed against its track; None where the track never flew.
/// `points` in time order; `patterns` the fields' pattern altitudes, ft
/// MSL, by ident (the planner's own, wingtip.pattern's).
pub fn debrief(checkpoints: &[Checkpoint], points: &[Point], patterns: &[(String, f64)]) -> Option<Debrief> {
    let mut cps = checkpoints.to_vec();
    cps.sort_by_key(|c| c.sequence_no);
    let runs = airborne(points);
    if cps.len() < 2 || runs.is_empty() {
        return None;
    }
    let leg_hops = hops(&cps);
    let mut notes = Vec::new();
    // Each hop its own flight where the track has as many; else the whole
    // track one flight, its times from the first takeoff.
    let flights: Vec<(usize, usize)> = if runs.len() == leg_hops.len() {
        runs.clone()
    } else {
        if leg_hops.len() > 1 {
            notes.push(format!(
                "The track has {} flight{} for the plan's {}: times are from the first takeoff.",
                runs.len(),
                if runs.len() == 1 { "" } else { "s" },
                leg_hops.len()
            ));
        }
        vec![(runs[0].0, runs[runs.len() - 1].1); leg_hops.len()]
    };
    let (first, last) = (points[flights[0].0], points[flights[flights.len() - 1].1]);
    let (cp0, cpn) = (&cps[0], &cps[cps.len() - 1]);
    let (off_start, off_end) = (nm(at(&first), place(cp0)), nm(at(&last), place(cpn)));
    // Python's "{:.0f}": the nearest, a tie to the even one, as Rust's.
    if off_start > 5.0 {
        notes.push(format!("The track takes off {off_start:.0} nm from {}: is it this flight's?", cp0.name));
    }
    if off_end > 5.0 {
        notes.push(format!("The track lands {off_end:.0} nm from {}.", cpn.name));
    }

    // Each leg, from checkpoint i to i + 1, and the hop it is in.
    let seg_hop: Vec<Option<usize>> = (0..cps.len() - 1).map(|i| leg_hops.iter().position(|&(a, b)| a <= i && i < b)).collect();
    let has_altitude = points.iter().any(|p| p.alt_ft.is_some());
    let mut grades = vec![Grade::default(); cps.len() - 1];
    let mut profile = Vec::new();
    let mut line = Vec::new();
    let mut passed: Vec<Option<f64>> = vec![None; cps.len()];
    let mut passes = Vec::new();
    let mut entries = Vec::new();

    for (h, &(a, b)) in leg_hops.iter().enumerate() {
        let (start, end) = flights[h];
        let hop_segs: Vec<usize> = (0..cps.len() - 1).filter(|&s| seg_hop[s] == Some(h)).collect();
        // The cruise: from first reaching the first leg's altitude to last
        // being at the last leg's, before the landing.
        let first_alt = cps.get(a + 1).and_then(|c| c.altitude_ft);
        let last_alt = cps[b].altitude_ft;
        let (mut cruise_from, mut cruise_to) = (f64::INFINITY, f64::NEG_INFINITY);
        for p in &points[start..=end] {
            let Some(alt) = p.alt_ft else { continue };
            if first_alt.is_some_and(|f| cruise_from == f64::INFINITY && alt >= f - ALTITUDE_FT) {
                cruise_from = p.t;
            }
            if last_alt.is_some_and(|l| alt >= l - ALTITUDE_FT) {
                cruise_to = p.t;
            }
        }
        let mut cursor = 0;
        let mut prev_along = cps[a].along_track_nm;
        let mut prev_t = points[start].t;
        for i in start..=end {
            let p = &points[i];
            // The nearest of the legs about where it was, so a route that
            // doubles back is not read on its way out as on its way home.
            let mut best = hop_segs[cursor];
            let mut where_ = against(&cps[best], &cps[best + 1], p);
            for &s in &hop_segs[cursor.saturating_sub(1)..=(cursor + 3).min(hop_segs.len() - 1)] {
                let w = against(&cps[s], &cps[s + 1], p);
                if w.2 < where_.2 {
                    best = s;
                    where_ = w;
                }
            }
            cursor = hop_segs.iter().position(|&s| s == best).unwrap_or(0);
            let (from, to) = (&cps[best], &cps[best + 1]);
            let (t_along, right, _) = where_;
            let along = from.along_track_nm + t_along * (to.along_track_nm - from.along_track_nm);
            // Each checkpoint passed: when the track first got past it.
            for k in a + 1..b {
                let cp_along = cps[k].along_track_nm;
                if passed[k].is_none() && along >= cp_along && cp_along > prev_along {
                    let share = if along > prev_along { (cp_along - prev_along) / (along - prev_along) } else { 0.0 };
                    passed[k] = Some(prev_t + share * (p.t - prev_t));
                }
            }
            prev_along = along;
            prev_t = p.t;
            let weight = if i < end { (points[i + 1].t - p.t).min(30_000.0) } else { 0.0 };
            let g = &mut grades[best];
            let since_leg_start = along - from.along_track_nm;
            let (to_field, from_field) = (cps[b].along_track_nm - along, along - cps[a].along_track_nm);
            // Course: not over the fields, nor in the turn onto a leg.
            if let Some(course) = to.true_course_deg {
                if from_field > 2.0 && to_field > 2.0 && since_leg_start > 1.0 {
                    let (mut j, mut k) = (i, i);
                    while points[k].t - points[j].t < 20_000.0 && (j > start || k < end) {
                        if j > start {
                            j -= 1;
                        }
                        if k < end {
                            k += 1;
                        }
                    }
                    if k > j {
                        let off = angle_between(bearing_deg(points[j].lat, points[j].lon, points[k].lat, points[k].lon), course);
                        g.course_w += weight;
                        if off <= COURSE_DEG {
                            g.course_in += weight;
                        }
                    }
                    if g.worst_off.is_none_or(|w| right.abs() > w.abs()) {
                        g.worst_off = Some(right);
                    }
                }
            }
            // Altitude: in the cruise, and not in a step to a new one.
            let planned = to.altitude_ft;
            let stepped = best > a && cps[best].altitude_ft != planned && since_leg_start < 3.0;
            let mut off_line = right.abs() > OFF_ROUTE_NM && from_field > 2.0 && to_field > 2.0;
            if let (Some(alt), Some(planned)) = (p.alt_ft, planned) {
                if cruise_from <= p.t && p.t <= cruise_to && !stepped {
                    let dev = alt - planned;
                    g.alt_w += weight;
                    if dev.abs() <= ALTITUDE_FT {
                        g.alt_in += weight;
                    } else {
                        off_line = true;
                    }
                    if g.worst_alt.is_none_or(|w| dev.abs() > w.abs()) {
                        g.worst_alt = Some(dev);
                    }
                }
            }
            line.push(LinePoint { lat: p.lat, lon: p.lon, off: off_line });
            if let Some(alt) = p.alt_ft {
                profile.push((along, alt));
            }
        }

        // The checkpoints' times, from this hop's takeoff.
        let mut due = Some(0.0);
        for (k, cp) in cps.iter().enumerate().take(b + 1).skip(a + 1) {
            due = match (due, cp.ete_min) {
                (Some(d), Some(e)) => Some(d + e),
                _ => None,
            };
            let at_t = if k == b { Some(points[end].t) } else { passed[k] };
            let closest = points[start..=end].iter().map(|p| nm(at(p), place(cp))).fold(f64::INFINITY, f64::min);
            passes.push(Pass {
                name: cp.name.clone(),
                category: cp.category.clone(),
                due_min: due,
                passed_min: at_t.map(|t| (t - points[start].t) / 60_000.0),
                closest_nm: closest.is_finite().then_some(closest),
            });
        }

        // The pattern: the altitude where it first came within PATTERN_NM
        // of the field it landed at.
        let field = &cps[b];
        if let Some(&(_, pattern_ft)) = patterns.iter().find(|(ident, _)| *ident == field.name) {
            let found = points[start..=end].iter().find_map(|p| p.alt_ft.filter(|_| nm(at(p), place(field)) <= PATTERN_NM));
            if let Some(alt) = found {
                entries.push(PatternEntry { ident: field.name.clone(), alt_ft: alt, pattern_ft });
            }
        }
    }

    let legs = grades
        .iter()
        .enumerate()
        .map(|(s, g)| {
            let (from, to) = (&cps[s], &cps[s + 1]);
            LegGrade {
                from: from.name.clone(),
                to: to.name.clone(),
                planned_alt_ft: to.altitude_ft,
                altitude_within: (g.alt_w > 0.0).then(|| g.alt_in / g.alt_w),
                worst_alt_ft: g.worst_alt,
                course_deg: to.true_course_deg,
                course_within: (g.course_w > 0.0).then(|| g.course_in / g.course_w),
                worst_off_nm: g.worst_off,
            }
        })
        .collect();
    let flown_ms: f64 = flights
        .iter()
        .enumerate()
        .filter(|&(h, &(a, _))| !(h > 0 && flights[h - 1].0 == a))
        .map(|(_, &(a, b))| points[b].t - points[a].t)
        .sum();
    let mut planned_min = Some(0.0);
    for c in &cps[1..] {
        planned_min = match (planned_min, c.ete_min) {
            (Some(p), Some(e)) => Some(p + e),
            _ => None,
        };
    }
    // At most 400 points on the profile and 1,500 on the map: they are
    // drawn, not read. An off point is never thinned out of the map's.
    let stride = profile.len().div_ceil(400).max(1);
    let line_stride = line.len().div_ceil(1500).max(1);
    let line_last = line.len().saturating_sub(1);
    Some(Debrief {
        takeoff: first.t,
        landing: last.t,
        flown_min: flown_ms / 60_000.0,
        planned_min,
        legs,
        passes,
        patterns: entries,
        profile: profile.into_iter().step_by(stride).collect(),
        planned: (0..cps.len() - 1).map(|s| (cps[s].along_track_nm, cps[s + 1].along_track_nm, cps[s + 1].altitude_ft)).collect(),
        line: line.into_iter().enumerate().filter(|(i, pt)| pt.off || i % line_stride == 0 || *i == line_last).map(|(_, pt)| pt).collect(),
        has_altitude,
        notes,
    })
}

/// A leg's mark as the web's FlightPage gives it beside the finding:
/// within where neither its altitude nor its distance off the route went
/// past PA.VI.A's tolerance.
pub fn leg_ok(worst_alt_ft: Option<f64>, worst_off_nm: Option<f64>) -> bool {
    worst_alt_ft.is_none_or(|a| a.abs() <= ALTITUDE_FT) && worst_off_nm.is_none_or(|o| o.abs() <= OFF_ROUTE_NM)
}

/// A checkpoint's marks: landed at (a field), how late (+) or early, and
/// within ETA_MIN of its estimate -- none where either time is not known.
pub fn pass_marks(category: &str, due_min: Option<f64>, passed_min: Option<f64>) -> (bool, Option<f64>, Option<bool>) {
    let late = match (due_min, passed_min) {
        (Some(due), Some(passed)) => Some(passed - due),
        _ => None,
    };
    (category == "destination" || category == "stop", late, late.map(|l| l.abs() <= ETA_MIN))
}

/// A pattern entry's marks: how far off the pattern's altitude, and
/// within PATTERN_FT.
pub fn pattern_marks(alt_ft: f64, pattern_ft: f64) -> (f64, bool) {
    (alt_ft - pattern_ft, (alt_ft - pattern_ft).abs() <= PATTERN_FT)
}

fn field(out: &mut String, first: bool, key: &str) {
    out.push_str(if first { "{\"" } else { ",\"" });
    out.push_str(key);
    out.push_str("\":");
}

fn list<T>(out: &mut String, items: &[T], mut each: impl FnMut(&mut String, &T)) {
    out.push('[');
    for (i, item) in items.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        each(out, item);
    }
    out.push(']');
}

fn boolean(out: &mut String, b: bool) {
    out.push_str(if b { "true" } else { "false" });
}

/// The debrief as JSON, each finding with its mark (the planner's marked
/// Debrief) where `marked`, without where not (app.figures.debrief's own).
pub fn to_json(d: &Debrief, marked: bool) -> String {
    let mut out = String::new();
    field(&mut out, true, "takeoff");
    json::number(&mut out, d.takeoff);
    field(&mut out, false, "landing");
    json::number(&mut out, d.landing);
    field(&mut out, false, "flown_min");
    json::number(&mut out, d.flown_min);
    field(&mut out, false, "planned_min");
    json::opt_number(&mut out, d.planned_min);
    field(&mut out, false, "legs");
    list(&mut out, &d.legs, |out, l| {
        field(out, true, "from");
        json::string(out, &l.from);
        field(out, false, "to");
        json::string(out, &l.to);
        for (key, v) in [("planned_alt_ft", l.planned_alt_ft), ("altitude_within", l.altitude_within), ("worst_alt_ft", l.worst_alt_ft),
                         ("course_deg", l.course_deg), ("course_within", l.course_within), ("worst_off_nm", l.worst_off_nm)] {
            field(out, false, key);
            json::opt_number(out, v);
        }
        if marked {
            field(out, false, "ok");
            boolean(out, leg_ok(l.worst_alt_ft, l.worst_off_nm));
        }
        out.push('}');
    });
    field(&mut out, false, "passes");
    list(&mut out, &d.passes, |out, p| {
        field(out, true, "name");
        json::string(out, &p.name);
        field(out, false, "category");
        json::string(out, &p.category);
        for (key, v) in [("due_min", p.due_min), ("passed_min", p.passed_min), ("closest_nm", p.closest_nm)] {
            field(out, false, key);
            json::opt_number(out, v);
        }
        if marked {
            let (landed, late, ok) = pass_marks(&p.category, p.due_min, p.passed_min);
            field(out, false, "landed");
            boolean(out, landed);
            field(out, false, "late_min");
            json::opt_number(out, late);
            field(out, false, "ok");
            match ok {
                Some(ok) => boolean(out, ok),
                None => out.push_str("null"),
            }
        }
        out.push('}');
    });
    field(&mut out, false, "patterns");
    list(&mut out, &d.patterns, |out, e| {
        field(out, true, "ident");
        json::string(out, &e.ident);
        field(out, false, "alt_ft");
        json::number(out, e.alt_ft);
        field(out, false, "pattern_ft");
        json::number(out, e.pattern_ft);
        if marked {
            let (off, ok) = pattern_marks(e.alt_ft, e.pattern_ft);
            field(out, false, "off_ft");
            json::number(out, off);
            field(out, false, "ok");
            boolean(out, ok);
        }
        out.push('}');
    });
    field(&mut out, false, "profile");
    list(&mut out, &d.profile, |out, &(along, alt)| {
        field(out, true, "along_nm");
        json::number(out, along);
        field(out, false, "alt_ft");
        json::number(out, alt);
        out.push('}');
    });
    field(&mut out, false, "planned");
    list(&mut out, &d.planned, |out, &(from, to, alt)| {
        field(out, true, "from_nm");
        json::number(out, from);
        field(out, false, "to_nm");
        json::number(out, to);
        field(out, false, "alt_ft");
        json::opt_number(out, alt);
        out.push('}');
    });
    field(&mut out, false, "line");
    list(&mut out, &d.line, |out, pt| {
        field(out, true, "lat");
        json::number(out, pt.lat);
        field(out, false, "lon");
        json::number(out, pt.lon);
        field(out, false, "off");
        boolean(out, pt.off);
        out.push('}');
    });
    field(&mut out, false, "has_altitude");
    boolean(&mut out, d.has_altitude);
    field(&mut out, false, "notes");
    list(&mut out, &d.notes, |out, n| json::string(out, n));
    out.push('}');
    out
}

/// The tolerances the debrief holds the flight to, for the page's headings.
pub fn tolerances_json() -> String {
    let mut out = String::new();
    for (i, (key, v)) in [("altitude_ft", ALTITUDE_FT), ("course_deg", COURSE_DEG), ("off_route_nm", OFF_ROUTE_NM),
                          ("eta_min", ETA_MIN), ("pattern_nm", PATTERN_NM), ("pattern_ft", PATTERN_FT)].iter().enumerate() {
        field(&mut out, i == 0, key);
        json::number(&mut out, *v);
    }
    out.push('}');
    out
}

/// The whole of the planner's /api/debrief answer, JSON: `{"debrief":
/// marked or null, "tolerances"}`. The points are put in time order
/// first, as the planner does.
pub fn answer_json(checkpoints: &[Checkpoint], points: &[Point], patterns: &[(String, f64)]) -> String {
    let mut sorted = points.to_vec();
    sorted.sort_by(|a, b| a.t.total_cmp(&b.t));
    let mut out = String::from("{\"debrief\":");
    match debrief(checkpoints, &sorted, patterns) {
        Some(d) => out.push_str(&to_json(&d, true)),
        None => out.push_str("null"),
    }
    out.push_str(",\"tolerances\":");
    out.push_str(&tolerances_json());
    out.push('}');
    out
}
