//! The flight as planned, flown on paper (the web's navlog/dryRun), at the
//! owner's ask ("a dry run of the flight with altitude and speed
//! profile"): from the nav log's rows, in order, each leg's piece flown in
//! its own time (its ETE, or its distance at its ground speed) on its true
//! course at its ground speed, burning its fuel; the height the plan's
//! profile's at each point (crate::motion::profile: the climbs, the level
//! legs and the 3:1 descents). Ends where a leg is not in yet.
//!
//! The airplane flies the course line the map draws (the planner's
//! course_line), at the owner's notice ("How come the plane seems of course
//! in dry run?"): put between the rows' points straight across the chart's
//! latitudes and longitudes, it ran 3.5 nm west of the line half way from
//! C81 to Duluth, the line being the great circle the legs are flown on.
//! With no line, on the great circle between the rows' points.
//!
//! A leg the planner flies by the procedures picked (its `procedure`: out
//! of a field by its departure, into one by its arrival and its approach,
//! each to its runway; planning-service with_procedures) is flown along
//! their path from its start, the whole leg at once -- its tops of climb
//! and descent, laid along the route, are passed as it starts -- in the
//! leg's own time and fuel, which the planner made the longer by the path's
//! miles more. Coming in, its heights are the plan's climb and the chart's
//! (landing_heights); going out alone, the plan's laid evenly over the
//! path. There is no approach speed in an airplane's figures, so the leg's
//! ground speed it is. Gone missed, the last approach goes missed at its
//! missed approach point instead of landing: its missed approach and once
//! round its hold, climbing at the standard gradient (missed_heights).
//!
//! The run's figures between its points, as it plays, stay in each app:
//! they are asked every frame.

use super::profile::{f, maybe, plan_profile, rows_of, Kind, ProfilePoint, Row, DESCENT_FT_PER_NM};
use super::{num, opt_bool};
use crate::figures::words::js_round;
use crate::geo::{bearing_deg, destination, distance_nm};
use crate::json::{self, Value};

/// Where the airplane is put along the route between the nav log's rows,
/// nm: often enough that its height follows the profile's climb and
/// descent, and its line the route's.
pub const STEP_NM: f64 = 2.0;
/// The climb a missed approach is built for, ft a nm, where its chart
/// publishes no steeper one: 200 (FAA Order 8260.3, the standard missed
/// approach climb gradient).
pub const MISSED_CLIMB_FT_PER_NM: f64 = 200.0;

type LatLon = (f64, f64);

/// JavaScript's Math.min and Math.max, which a NaN wins, where Rust's
/// f64::min and max pass it over.
fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.min(b)
    }
}

fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}

/// A report of the run: when (s since 1970), where, how high, how fast and
/// which way, as a replay's reports are (/api's PastFlightPoint).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RunPoint {
    pub t: f64,
    pub lat: f64,
    pub lon: f64,
    pub alt_ft: Option<f64>,
    pub gs_kt: Option<f64>,
    pub track_deg: Option<f64>,
}

/// A landing, a stop's or the destination's: when the run is in, the
/// distance flown and the fuel burnt by then.
#[derive(Clone, Debug, PartialEq)]
pub struct Landing {
    pub ident: String,
    pub t: f64,
    pub nm: f64,
    pub fuel: f64,
}

/// The planned flight as a replay's reports, and what it has flown and
/// burnt by each.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct DryRun {
    pub points: Vec<RunPoint>,
    /// Distance flown by each point, nm.
    pub along_nm: Vec<f64>,
    /// Fuel burnt by each point, gal.
    pub fuel_gal: Vec<f64>,
    /// When the airplane reaches each of the nav log's rows.
    pub row_t: Vec<f64>,
    /// The distance flown to each of those rows (`run`) and the route's
    /// there, the legs' own (`route`).
    pub bends: Vec<(f64, f64)>,
    /// Whether an approach picked into a field has a missed approach to fly.
    pub missable: bool,
    /// When the airplane is on that approach's final: from its final
    /// approach fix to its missed approach point.
    pub last_final: Option<(f64, f64)>,
    pub landings: Vec<Landing>,
}

/// A leg flown as procedures or round a hold: its path from the row
/// before, the distance along it to each of its points, and the heights it
/// is flown at along it, or None for the plan's own laid evenly over it.
#[derive(Clone, Debug)]
struct Flown {
    path: Vec<LatLon>,
    at: Vec<f64>,
    heights: Option<Vec<ProfilePoint>>,
}

#[derive(Clone, Debug)]
struct Anchor {
    along: f64,
    route: f64,
    lat: f64,
    lon: f64,
    t: f64,
    fuel: f64,
    gs: Option<f64>,
    track: Option<f64>,
    flown: Option<Flown>,
}

/// The point a fraction `f` of the way from `a` to `b` on the great circle
/// between them, the way the planner's legs run.
fn between(a: LatLon, b: LatLon, f: f64) -> LatLon {
    if f <= 0.0 {
        return a;
    }
    if f >= 1.0 {
        return b;
    }
    destination(a.0, a.1, bearing_deg(a.0, a.1, b.0, b.1), distance_nm(a.0, a.1, b.0, b.1) * f)
}

/// The distance along a path to each of its points, nm.
fn cumulative(path: &[LatLon]) -> Vec<f64> {
    let mut at = vec![0.0];
    for i in 1..path.len() {
        at.push(at[i - 1] + distance_nm(path[i - 1].0, path[i - 1].1, path[i].0, path[i].1));
    }
    at
}

/// The point `s` nm along a path (`at` the distance to each of its
/// points), on the great circle between the two either side, and the track
/// between them.
fn on_path(path: &[LatLon], at: &[f64], s: f64) -> (LatLon, f64) {
    match path.len() {
        0 => return ((f64::NAN, f64::NAN), f64::NAN),
        1 => return (path[0], 0.0),
        _ => {}
    }
    let mut i = 1;
    while i < path.len() - 1 && at[i] < s {
        i += 1;
    }
    let (a, b) = (path[i - 1], path[i]);
    let f = if at[i] > at[i - 1] { (s - at[i - 1]) / (at[i] - at[i - 1]) } else { 1.0 };
    (between(a, b, f), bearing_deg(a.0, a.1, b.0, b.1))
}

/// The height at `along` on a line of heights, held past its ends.
fn height_on(line: &[ProfilePoint], along: f64) -> Option<f64> {
    let first = line.first()?;
    if along <= first.along_nm {
        return Some(first.plan_ft);
    }
    for w in line.windows(2) {
        let (a, b) = (w[0], w[1]);
        if along <= b.along_nm {
            return Some(if b.along_nm > a.along_nm {
                a.plan_ft + ((b.plan_ft - a.plan_ft) * (along - a.along_nm)) / (b.along_nm - a.along_nm)
            } else {
                b.plan_ft
            });
        }
    }
    line.last().map(|p| p.plan_ft)
}

/// The heights a missed approach is flown at: from the height the descent
/// to the runway reaches at the missed approach point (`start`, nm along
/// the path, at `from`; the decision altitude or MDA itself left out), up
/// at the standard gradient to `to`, and level there to the path's `end`.
fn missed_heights(start: f64, end: f64, from: f64, to: f64) -> Vec<ProfilePoint> {
    let level = js_max(from, to);
    let top = start + (level - from) / MISSED_CLIMB_FT_PER_NM;
    if top >= end {
        return vec![ProfilePoint { along_nm: end, plan_ft: from + (end - start) * MISSED_CLIMB_FT_PER_NM }];
    }
    vec![ProfilePoint { along_nm: top, plan_ft: level }, ProfilePoint { along_nm: end, plan_ft: level }]
}

/// Sorted, each once: a JavaScript Set of numbers, sorted.
fn sorted_once(mut marks: Vec<f64>) -> Vec<f64> {
    marks.sort_by(|x, y| x.partial_cmp(y).unwrap_or(std::cmp::Ordering::Equal));
    marks.dedup();
    marks
}

/// The heights a leg flown into a field by its procedures is flown at,
/// along its path (`at`, nm from the leg's start): the plan's own up to its
/// cruise (`climb`, its height `s` nm into the leg), and no higher than
/// each altitude the chart sets (`ft`, one a point) allows -- held until a
/// descent at three to one, the rate the plan descends at
/// (DESCENT_FT_PER_NM), crosses the next at it, straight to the next where
/// the two are closer than that allows -- and from the last down to the
/// field's `field` ft at the path's end. One the chart sets over the leg's
/// cruise (`cruise`) is left out, at the owner's word (a PA28 at 2,000 ft
/// climbed to BENKY6's 12,000 on its way into O'Hare): the plan's altitude
/// stands, as a controller would assign it. A final approach fix is set for
/// its glide path, normally 3° (AIM 1-1-9), 318 ft a mile against the
/// plan's 333, so the last of it is the glide path near enough.
fn landing_heights(at: &[f64], ft: &[Option<f64>], cruise: f64, field: f64, climb: &dyn Fn(f64) -> f64) -> Vec<ProfilePoint> {
    let end = *at.last().unwrap_or(&0.0);
    let mut targets = vec![(0.0, cruise)];
    for i in 1..at.len().saturating_sub(1) {
        if let Some(Some(x)) = ft.get(i) {
            if *x <= cruise {
                targets.push((at[i], *x));
            }
        }
    }
    targets.push((end, field));
    let mut chart = vec![ProfilePoint { along_nm: 0.0, plan_ft: cruise }];
    for w in targets.windows(2) {
        let ((a_s, a_ft), (b_s, b_ft)) = (w[0], w[1]);
        let down = (a_ft - b_ft) / DESCENT_FT_PER_NM;
        if down > 0.0 && down < b_s - a_s {
            chart.push(ProfilePoint { along_nm: b_s - down, plan_ft: a_ft });
        }
        chart.push(ProfilePoint { along_nm: b_s, plan_ft: b_ft });
    }
    // The lower of the two at each bend of either, and every STEP_NM
    // between, so the climb's top and the chart's descents meet near enough.
    let mut marks: Vec<f64> = chart.iter().map(|p| p.along_nm).chain(at.iter().copied()).collect();
    let mut s = STEP_NM;
    while s < end {
        marks.push(s);
        s += STEP_NM;
    }
    sorted_once(marks)
        .into_iter()
        .map(|s| ProfilePoint { along_nm: s, plan_ft: js_min(climb(s), height_on(&chart, s).unwrap_or(cruise)) })
        .collect()
}

fn path_of(v: Option<&Value>) -> Vec<LatLon> {
    v.and_then(Value::as_array)
        .map(|points| {
            points
                .iter()
                .map(|p| {
                    let ll = p.as_array().unwrap_or(&[]);
                    let at = |i: usize| ll.get(i).and_then(Value::as_f64).unwrap_or(f64::NAN);
                    (at(0), at(1))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn index(v: &Value, key: &str) -> Option<usize> {
    maybe(v, key).filter(|i| *i >= 0.0 && i.fract() == 0.0).map(|i| i as usize)
}

/// A piece of a leg with the pilot's hold on it (the planner's LegHold), as
/// the dry run flies it: round the racetrack the planner drew from the
/// hold's point -- its turns, or as many as its minutes make (rounded, one
/// at the least) -- then on to the piece's end; or, into the destination,
/// to the field and round it there. Level round the racetrack at the
/// plan's height where it starts (into the destination, the plan's height a
/// mile out), the plan's own along the rest, laid over the piece's straight
/// part.
fn held_path(hold: &Value, from: LatLon, to: LatLon, route_nm: f64, route_at: f64, plan: &[ProfilePoint]) -> Flown {
    let lap = path_of(hold.get("path"));
    let laps = js_round(f(hold, "minutes") / js_max(0.1, f(hold, "lap_min"))).max(1);
    let mut track: Vec<LatLon> = Vec::new();
    for k in 0..laps {
        track.extend_from_slice(if k == 0 { &lap[..] } else { lap.get(1..).unwrap_or(&[]) });
    }
    let laps_nm = *cumulative(&track).last().unwrap_or(&0.0);
    let straight_nm = distance_nm(from.0, from.1, to.0, to.1);
    // The plan's heights over the piece's straight part, starting `offset`
    // nm along the path.
    let planned = |offset: f64| -> Vec<ProfilePoint> {
        plan.iter()
            .filter(|p| p.along_nm > route_at && p.along_nm < route_at + route_nm)
            .map(|p| ProfilePoint {
                along_nm: offset + ((p.along_nm - route_at) * straight_nm) / js_max(1e-9, route_nm),
                plan_ft: p.plan_ft,
            })
            .collect()
    };
    let h = |route: f64| height_on(plan, route).unwrap_or(0.0);
    let point = |along_nm: f64, plan_ft: f64| ProfilePoint { along_nm, plan_ft };
    if matches!(hold.get("at_end"), Some(Value::Bool(true))) {
        let held = h(js_max(route_at, route_at + route_nm - 1.0));
        let mut path = vec![from];
        path.extend(track);
        let mut heights = vec![point(0.0, h(route_at))];
        heights.extend(planned(0.0).into_iter().filter(|p| p.along_nm < straight_nm));
        heights.push(point(straight_nm, held));
        heights.push(point(straight_nm + laps_nm, held));
        let at = cumulative(&path);
        return Flown { path, at, heights: Some(heights) };
    }
    let level = h(route_at);
    let mut path = track;
    path.push(to);
    let mut heights = vec![point(0.0, level), point(laps_nm, level)];
    heights.extend(planned(laps_nm));
    heights.push(point(laps_nm + straight_nm, h(route_at + route_nm)));
    let at = cumulative(&path);
    Flown { path, at, heights: Some(heights) }
}

fn truthy(v: Option<&Value>) -> bool {
    !matches!(v, None | Some(Value::Null) | Some(Value::Bool(false)))
}

/// The flight flown on paper from the nav log's rows, starting at
/// `start_s` (s since 1970: the departure picked, or now), along `line`
/// (the planner's course_line, [lat, lon] pairs) where there is one, and
/// with `missed` the last approach gone missed.
pub fn dry_run(rows: &[Row], start_s: f64, line: Option<&[LatLon]>, missed: bool) -> DryRun {
    let Some(first) = rows.first().filter(|r| r.kind == Kind::Departure) else { return DryRun::default() };
    let plan = plan_profile(rows).0;
    let mut anchors = vec![Anchor {
        along: 0.0,
        route: 0.0,
        lat: first.lat,
        lon: first.lon,
        t: start_s,
        fuel: 0.0,
        gs: None,
        track: None,
        flown: None,
    }];
    let mut missable = false;
    let mut went_missed = false;
    let mut last_final: Option<(f64, f64)> = None;
    // Go missed is the last approach's, the one whose final the run's button
    // is on (DryRunControls): a stop's approach before it is flown to its
    // runway -- the audit's finding, every approach went missed.
    fn procedure_of<'a>(row: &Row<'a>) -> Option<&'a Value> {
        row.leg.and_then(|l| l.get("procedure")).filter(|p| !matches!(p, Value::Null))
    }
    let last_approach = rows
        .iter()
        .enumerate()
        .filter(|(_, r)| r.kind != Kind::Departure && !r.is_leg_point() && procedure_of(r).is_some_and(|p| truthy(p.get("missed"))))
        .map(|(i, _)| i)
        .last();
    for (i, row) in rows.iter().enumerate().skip(1) {
        let Some(part) = row.leg_of() else { break };
        let prev = anchors.last().expect("the departure's anchor").clone();
        let whole = if row.kind == Kind::Departure { None } else { row.leg };
        let flown_by = procedure_of(row);
        if flown_by.is_some() && row.is_leg_point() {
            // A top of climb or descent on a leg flown by its procedures: laid
            // along the route, passed as the leg starts, the leg flown whole
            // along their path at the row it ends at (below).
            anchors.push(Anchor { flown: None, ..prev });
            continue;
        }
        if let (Some(by), Some(whole)) = (flown_by, whole) {
            // The whole leg, its time and fuel the planner's with the path's
            // miles more in them.
            let gs = maybe(whole, "groundspeed_kt").or_else(|| maybe(whole, "tas_kt"));
            let seconds = match maybe(whole, "ete_min") {
                Some(ete) => ete * 60.0,
                None => match gs {
                    Some(gs) if gs > 0.0 => ((f(whole, "distance_nm") + f(by, "more_nm")) / gs) * 3600.0,
                    _ => 0.0,
                },
            };
            let fuel = maybe(whole, "fuel_gal").unwrap_or_else(|| (f(whole, "fuel_burn_gph") * seconds) / 3600.0);
            let ground = if row.lands() { row.elevation_ft.unwrap_or(0.0) } else { 0.0 };
            let flown_path = path_of(by.get("path"));
            // The missed approach, there to fly; flown at its point when asked
            // (`missed`), where the approach ended at the runway.
            let has_missed = truthy(by.get("missed"));
            if has_missed {
                missable = true;
            }
            let go_missed = (missed && has_missed && Some(i) == last_approach).then(|| by.get("missed")).flatten();
            if go_missed.is_some() {
                went_missed = true;
            }
            // The missed approach point (`map_at`): the runway's threshold,
            // where the path ends, or short of it on a VOR's or a LOC's
            // approach -- gone missed, the path is cut there and the missed
            // approach flown from it.
            let map_at = index(by, "map_at").unwrap_or(flown_path.len().saturating_sub(1));
            let landed = cumulative(&flown_path);
            let path = match go_missed {
                Some(m) => {
                    let mut p = flown_path[..(map_at + 1).min(flown_path.len())].to_vec();
                    p.extend(path_of(m.get("path")));
                    p
                }
                None => flown_path.clone(),
            };
            let at = cumulative(&path);
            let at_map = landed.get(map_at).copied().unwrap_or(f64::NAN);
            let nm = *at.last().unwrap_or(&0.0);
            // The leg's time and fuel are the planner's for the path to the runway.
            let landed_nm = js_max(1e-9, *landed.last().unwrap_or(&0.0));
            let t_at = |s: f64| prev.t + (seconds * s) / landed_nm;
            if has_missed {
                // Its final from the final approach fix, the last time the
                // path is there (after a course reversal round it), or the
                // last five miles where the chart names none.
                let from = match index(by, "final_at") {
                    Some(k) => at.get(k).copied().unwrap_or(f64::NAN),
                    None => js_max(0.0, at_map - 5.0),
                };
                last_final = Some((t_at(from), t_at(at_map)));
            }
            // The plan's own climb along the path, from the leg's start to its
            // top of climb, and its cruise after: not its descent, laid along
            // the route, which the chart's altitudes stand in for.
            let cruise = f(whole, "altitude_ft");
            let toc_at = whole.get("toc").filter(|t| !matches!(t, Value::Null)).map(|t| f(t, "along_nm"));
            let climb = |s: f64| match toc_at {
                Some(top) if s < top => height_on(&plan, prev.route + s).unwrap_or(cruise),
                _ => cruise,
            };
            let ft: Vec<Option<f64>> = by.get("ft").and_then(Value::as_array).unwrap_or(&[]).iter().map(Value::as_f64).collect();
            let landing = truthy(by.get("landing")).then(|| landing_heights(&landed, &ft, cruise, ground, &climb));
            // Gone missed, the descent to the runway is flown to the missed
            // approach point, and the climb is from the height there.
            let map_ft = landing.as_ref().map_or(ground, |l| height_on(l, at_map).unwrap_or(ground));
            let heights = match (&landing, go_missed) {
                (Some(l), Some(m)) => {
                    let mut h: Vec<ProfilePoint> = l.iter().copied().filter(|p| p.along_nm <= at_map).collect();
                    if h.last().map(|p| p.along_nm) != Some(at_map) {
                        h.push(ProfilePoint { along_nm: at_map, plan_ft: map_ft });
                    }
                    h.extend(missed_heights(at_map, nm, map_ft, maybe(m, "ft").unwrap_or(cruise)));
                    Some(h)
                }
                _ => landing,
            };
            anchors.push(Anchor {
                along: prev.along + nm,
                route: prev.route + f(whole, "distance_nm"),
                lat: row.lat,
                lon: row.lon,
                // Gone missed, on past the missed approach point at the leg's pace.
                t: t_at(nm),
                fuel: prev.fuel + (fuel * nm) / landed_nm,
                gs,
                track: maybe(whole, "true_course_deg"),
                flown: Some(Flown { path, at, heights }),
            });
            continue;
        }
        let gs = maybe(part, "groundspeed_kt").or_else(|| maybe(part, "tas_kt"));
        let mut seconds = match maybe(part, "ete_min") {
            Some(ete) => ete * 60.0,
            None => match gs {
                Some(gs) if gs > 0.0 => (f(part, "distance_nm") / gs) * 3600.0,
                _ => 0.0,
            },
        };
        let mut fuel = maybe(part, "fuel_gal").unwrap_or_else(|| (f(part, "fuel_burn_gph") * seconds) / 3600.0);
        // A hold the pilot put on the leg (plan.with_holds), its minutes and
        // fuel in the leg's and so in its last piece's: taken out of the
        // piece, and flown round its racetrack -- as the leg leaves its
        // point, or, into the destination, before it lands.
        let hold = whole.and_then(|w| w.get("hold")).filter(|h| !matches!(h, Value::Null));
        let ends_leg = !row.is_leg_point();
        if let (Some(hold), true) = (hold, ends_leg) {
            seconds = js_max(0.0, seconds - f(hold, "minutes") * 60.0);
            fuel = js_max(0.0, fuel - f(hold, "gal"));
        }
        let before = &rows[i - 1];
        // The leg's first piece: not after a top of climb or descent of the
        // same leg.
        let first_piece = !(before.is_leg_point() && before.leg == whole);
        if let Some(hold) = hold {
            let at_end = matches!(hold.get("at_end"), Some(Value::Bool(true)));
            if if at_end { ends_leg } else { first_piece } {
                let distance = f(part, "distance_nm");
                let flown = held_path(hold, (prev.lat, prev.lon), (row.lat, row.lon), distance, prev.route, &plan);
                anchors.push(Anchor {
                    along: prev.along + flown.at.last().copied().unwrap_or(0.0),
                    route: prev.route + distance,
                    lat: row.lat,
                    lon: row.lon,
                    t: prev.t + seconds + f(hold, "minutes") * 60.0,
                    fuel: prev.fuel + fuel + f(hold, "gal"),
                    gs,
                    track: maybe(part, "true_course_deg"),
                    flown: Some(flown),
                });
                continue;
            }
        }
        anchors.push(Anchor {
            along: prev.along + f(part, "distance_nm"),
            route: prev.route + f(part, "distance_nm"),
            lat: row.lat,
            lon: row.lon,
            t: prev.t + seconds,
            fuel: prev.fuel + fuel,
            gs,
            track: maybe(part, "true_course_deg"),
            flown: None,
        });
    }
    if anchors.len() < 2 {
        return DryRun::default();
    }
    // Every row, every bend of the profile -- the plan's, or an approach's
    // -- every corner of an approach, and every STEP_NM between.
    let end = anchors.last().map_or(0.0, |a| a.along);
    let mut marks: Vec<f64> = anchors.iter().map(|a| a.along).collect();
    for w in anchors.windows(2) {
        let (a, b) = (&w[0], &w[1]);
        match &b.flown {
            Some(flown) => {
                marks.extend(flown.at.iter().map(|s| a.along + s));
                match &flown.heights {
                    Some(heights) => marks.extend(heights.iter().map(|h| a.along + h.along_nm)),
                    None => {
                        // The plan's own bends, laid evenly over the path.
                        let k = flown.at.last().copied().unwrap_or(0.0) / js_max(1e-9, b.route - a.route);
                        marks.extend(plan.iter().filter(|p| p.along_nm > a.route && p.along_nm < b.route).map(|p| a.along + (p.along_nm - a.route) * k));
                    }
                }
            }
            None => marks.extend(plan.iter().filter(|p| p.along_nm > a.route && p.along_nm < b.route).map(|p| a.along + p.along_nm - a.route)),
        }
    }
    let mut s = STEP_NM;
    while s < end {
        marks.push(s);
        s += STEP_NM;
    }
    // A row's anchor is its own: one each, in order, from the departure's.
    let landings = anchors
        .iter()
        .zip(rows)
        .filter(|(_, row)| (row.kind == Kind::Stop && !row.fix) || row.kind == Kind::Destination)
        .map(|(a, row)| Landing { ident: row.ident.clone(), t: a.t, nm: a.along, fuel: a.fuel })
        .collect();
    let mut out = DryRun {
        row_t: anchors.iter().map(|a| a.t).collect(),
        bends: anchors.iter().map(|a| (a.route, a.along)).collect(),
        missable,
        last_final,
        landings,
        ..DryRun::default()
    };
    let total_route = anchors.last().map_or(0.0, |a| a.route);
    let on_line = line.filter(|l| l.len() >= 2).map(|l| (l, cumulative(l)));
    let mut seg = 1;
    for along in sorted_once(marks) {
        while seg < anchors.len() - 1 && anchors[seg].along < along {
            seg += 1;
        }
        let (a, b) = (&anchors[seg - 1], &anchors[seg]);
        let frac = if b.along > a.along { js_min(1.0, js_max(0.0, (along - a.along) / (b.along - a.along))) } else { 1.0 };
        let t = a.t + (b.t - a.t) * frac;
        // Two marks at one moment (a row on a profile's bend) are one report.
        if out.points.last().is_some_and(|p| t <= p.t) {
            continue;
        }
        let (at, track, alt) = match &b.flown {
            Some(flown) => {
                let s = along - a.along;
                let (at, track) = on_path(&flown.path, &flown.at, s);
                let alt = match &flown.heights {
                    Some(h) => height_on(h, s),
                    None => height_on(&plan, a.route + (s / js_max(1e-9, flown.at.last().copied().unwrap_or(0.0))) * (b.route - a.route)),
                };
                (at, Some(track), alt)
            }
            None => {
                // The route's own distance, on a leg flown as it was planned.
                let route = a.route + (along - a.along);
                let (at, track) = match &on_line {
                    // Where the route's distance is on the course the map
                    // draws: its length matched to the legs', so the two end
                    // together.
                    Some((points, lengths)) => {
                        let length = lengths.last().copied().unwrap_or(0.0);
                        let (at, track) = on_path(points, lengths, if total_route > 0.0 { (route / total_route) * length } else { 0.0 });
                        (at, Some(track))
                    }
                    None => (between((a.lat, a.lon), (b.lat, b.lon), frac), b.track),
                };
                (at, track, height_on(&plan, route))
            }
        };
        out.points.push(RunPoint { t, lat: at.0, lon: at.1, alt_ft: alt, gs_kt: b.gs, track_deg: track });
        out.along_nm.push(along);
        out.fuel_gal.push(a.fuel + (b.fuel - a.fuel) * frac);
    }
    // Landed: at a standstill on the field at the run's end, not at the leg's
    // ground speed. Held there at 120 kt, own ship was in the air to the
    // alerts ahead, which said "Tower 307 ft, now, 120 ft above you" over El
    // Dorado's runway (the owner's recording, 2026-10-19). Not where the run
    // goes missed and ends in the air, or stops short of the legs not in.
    let last_row = rows.last();
    if !went_missed && anchors.len() == rows.len() && last_row.is_some_and(|r| r.kind == Kind::Destination && !r.fix) {
        if let Some(p) = out.points.last_mut() {
            p.gs_kt = Some(0.0);
        }
    }
    out
}

/// The run as JSON: {"points": [{t, lat, lon, alt_ft, gs_kt, track_deg}],
/// "along_nm", "fuel_gal", "row_t", "bends": [{route, run}], "missable",
/// "final": {from, to}|null, "landings": [{ident, t, nm, fuel}]}.
pub fn to_json(run: &DryRun) -> String {
    let mut out = String::from("{\"points\":[");
    for (i, p) in run.points.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"t\":");
        json::number(&mut out, p.t);
        out.push_str(",\"lat\":");
        json::number(&mut out, p.lat);
        out.push_str(",\"lon\":");
        json::number(&mut out, p.lon);
        out.push_str(",\"alt_ft\":");
        json::opt_number(&mut out, p.alt_ft);
        out.push_str(",\"gs_kt\":");
        json::opt_number(&mut out, p.gs_kt);
        out.push_str(",\"track_deg\":");
        json::opt_number(&mut out, p.track_deg);
        out.push('}');
    }
    let numbers = |out: &mut String, key: &str, xs: &[f64]| {
        out.push_str(&format!("],\"{key}\":["));
        for (i, x) in xs.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            json::number(out, *x);
        }
    };
    numbers(&mut out, "along_nm", &run.along_nm);
    numbers(&mut out, "fuel_gal", &run.fuel_gal);
    numbers(&mut out, "row_t", &run.row_t);
    out.push_str("],\"bends\":[");
    for (i, (route, run_nm)) in run.bends.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"route\":");
        json::number(&mut out, *route);
        out.push_str(",\"run\":");
        json::number(&mut out, *run_nm);
        out.push('}');
    }
    out.push_str("],\"missable\":");
    out.push_str(if run.missable { "true" } else { "false" });
    out.push_str(",\"final\":");
    match run.last_final {
        None => out.push_str("null"),
        Some((from, to)) => {
            out.push_str("{\"from\":");
            json::number(&mut out, from);
            out.push_str(",\"to\":");
            json::number(&mut out, to);
            out.push('}');
        }
    }
    out.push_str(",\"landings\":[");
    for (i, l) in run.landings.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"ident\":");
        json::string(&mut out, &l.ident);
        out.push_str(",\"t\":");
        json::number(&mut out, l.t);
        out.push_str(",\"nm\":");
        json::number(&mut out, l.nm);
        out.push_str(",\"fuel\":");
        json::number(&mut out, l.fuel);
        out.push('}');
    }
    out.push_str("]}");
    out
}

/// `dry_run`: the run (to_json), from `{"rows", "start_s", "line"?:
/// [[lat, lon]], "missed"?}`.
pub(super) fn dry_run_rule(v: &Value) -> Result<String, String> {
    let n = "dry_run";
    let raw = v.get("rows").and_then(Value::as_array).ok_or("dry_run: \"rows\" is missing or not a list")?;
    let rows = rows_of(n, raw)?;
    let line = path_of(v.get("line"));
    let run = dry_run(&rows, num(n, v, "start_s")?, Some(&line[..]), opt_bool(n, v, "missed")?.unwrap_or(false));
    Ok(to_json(&run))
}
