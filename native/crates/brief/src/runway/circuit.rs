//! A runway's traffic pattern drawn and flown (web/src/lib/trafficPattern.ts,
//! wingtip.pattern's circuits): the rectangle flown round the runway for the
//! end landed on, the side its traffic is flown on, and the 45° entry to
//! the downwind abeam midfield -- as the FAA's Airplane Flying Handbook
//! (FAA-H-8083-3, "Airport Traffic Patterns") and AC 90-66C draw it:
//!
//! - the downwind "approximately 1/2 to 1 mile out from the landing
//!   runway" -- drawn at three-quarters of a statute mile;
//! - the turn to base "approximately 45° from the approach end of the
//!   runway" -- abeam it 45° back, so as far past the threshold as the
//!   downwind is out;
//! - the crosswind "beyond the departure end of the runway within 300
//!   feet of pattern altitude" -- where that is depends on the climb, so
//!   drawn as far past the departure end as the downwind is out, a
//!   rectangle;
//! - the pattern "entered at a 45° angle to the downwind leg" abeam
//!   midfield (AIM 4-3-3, AC 90-66C 11.3), from the pattern's side;
//! - left traffic unless the FAA says right (14 CFR 91.126(b)(1)),
//!   pick::pattern_side_deg.
//!
//! And the way out of a field left from: the takeoff along the runway and
//! the upwind past its end, then out of the pattern straight on or with a
//! 45° turn to the pattern's side -- the two AIM 4-3-3 gives -- whichever
//! is the nearer the way on to the flight's next field.
//!
//! A sketch of the pattern to fly by, not a procedure: the size of a
//! pattern is the pilot's, flown as the field and its traffic need. The
//! map draws it and the planner flies it (wingtip.procedure_paths) from these
//! same corners.

use super::pick::{end_key, pattern_side_deg, runway_number};
use crate::geo::{bearing_deg, destination, distance_nm};

/// Three-quarters of a statute mile, in nautical miles: the middle of the
/// handbook's half a mile to a mile for the downwind's distance out.
pub const DOWNWIND_NM: f64 = 0.75 * 0.868976;
/// How far out the 45° entry is drawn from where it joins the downwind,
/// and the departure's exit from the upwind's end, nm.
pub const ENTRY_NM: f64 = 1.2;
/// Feet in a nautical mile (1,852 m), as lib/geo's FT_PER_NM.
const FT_PER_NM: f64 = 6076.12;

pub type Point = (f64, f64);

/// A runway end as the pattern reads it: its ident, true heading (None for
/// a helipad's), traffic ("left" or "right") and threshold, where known.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CircuitEnd {
    pub ident: String,
    pub heading_true_deg: Option<f64>,
    pub traffic: String,
    pub at: Option<Point>,
}

/// A runway as the pattern reads it: its length (for the far end where it
/// alone is not known) and its ends.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CircuitRunway {
    pub length_ft: Option<f64>,
    pub ends: Vec<CircuitEnd>,
}

/// The pattern's corners for one end.
#[derive(Clone, Debug, PartialEq)]
pub struct Corners {
    /// The end flown, its index in the runway's ends.
    pub end: usize,
    pub threshold: Point,
    pub far: Point,
    /// Along the runway as it is laid, and the pattern's side, true.
    pub along: f64,
    pub side: f64,
    /// The final's start on the extended centre line before the threshold,
    /// and the upwind's end past the departure end.
    pub final_start: Point,
    pub upwind_end: Point,
}

fn dest(p: Point, bearing: f64, nm: f64) -> Point {
    destination(p.0, p.1, bearing, nm)
}

/// The turn from one direction to another, -180 to 180, right of it
/// positive (lib/geo signedTurn).
pub fn signed_turn(from: f64, to: f64) -> f64 {
    ((((to - from) % 360.0) + 540.0) % 360.0) - 180.0
}

/// The pattern's corners for `end_ident` (as painted or as the data has
/// it: "9" is "09"). None where its threshold or heading is not known (the
/// other end's place is taken from the runway's length where it alone is
/// missing).
pub fn corners(runway: &CircuitRunway, end_ident: &str) -> Option<Corners> {
    let key = end_key(end_ident);
    let i = runway.ends.iter().position(|e| end_key(&e.ident) == key)?;
    let end = &runway.ends[i];
    let (threshold, heading) = (end.at?, end.heading_true_deg?);
    let other = runway.ends.iter().enumerate().find(|(k, _)| *k != i).and_then(|(_, e)| e.at);
    let far = match (other, runway.length_ft.filter(|l| *l != 0.0 && !l.is_nan())) {
        (Some(far), _) => far,
        (None, Some(length)) => dest(threshold, heading, length / FT_PER_NM),
        (None, None) => return None,
    };
    // Along the runway as it is laid, not its painted heading, where both
    // ends are known.
    let along = if other.is_some() { bearing_deg(threshold.0, threshold.1, far.0, far.1) } else { heading };
    let back = (along + 180.0) % 360.0;
    let side = pattern_side_deg(Some(along), &end.traffic);
    Some(Corners {
        end: i,
        threshold,
        far,
        along,
        side,
        final_start: dest(threshold, back, DOWNWIND_NM),
        upwind_end: dest(far, along, DOWNWIND_NM),
    })
}

/// The downwind abeam midfield, where the 45° entry joins it.
fn midfield(c: &Corners) -> Point {
    let half = distance_nm(c.threshold.0, c.threshold.1, c.far.0, c.far.1) / 2.0;
    dest(dest(c.threshold, c.along, half), c.side, DOWNWIND_NM)
}

/// The bisector of the runway's direction and the pattern's side: the 45°
/// entry comes in on it, from out on the pattern's side behind the
/// downwind's direction, and the 45° departure leaves on it.
fn bisector(c: &Corners) -> f64 {
    (c.along + signed_turn(c.along, c.side) / 2.0 + 360.0) % 360.0
}

/// A pattern's leg, from its start to its end.
pub type Leg = (&'static str, Point, Point);

/// A pattern to land or to leave (lib/trafficPattern TrafficPattern): the
/// end as painted, its traffic, the legs in the order flown, and the 45°
/// entry -- leaving, the exit from the upwind's end, its name the way it
/// goes.
#[derive(Clone, Debug, PartialEq)]
pub struct Pattern {
    pub arrival: bool,
    pub runway: String,
    pub traffic: String,
    pub legs: Vec<Leg>,
    pub entry: Leg,
}

/// The pattern for landing on `end_ident` of `runway`, or None where it
/// cannot be drawn (corners).
pub fn arrival(runway: &CircuitRunway, end_ident: &str) -> Option<Pattern> {
    let c = corners(runway, end_ident)?;
    let crosswind_end = dest(c.upwind_end, c.side, DOWNWIND_NM);
    let downwind_end = dest(c.final_start, c.side, DOWNWIND_NM);
    let mid = midfield(&c);
    let end = &runway.ends[c.end];
    Some(Pattern {
        arrival: true,
        runway: runway_number(&end.ident).to_owned(),
        traffic: end.traffic.clone(),
        legs: vec![
            ("Upwind", c.far, c.upwind_end),
            ("Crosswind", c.upwind_end, crosswind_end),
            ("Downwind", crosswind_end, downwind_end),
            ("Base", downwind_end, c.final_start),
            ("Final", c.final_start, c.threshold),
        ],
        entry: ("45° entry", dest(mid, bisector(&c), ENTRY_NM), mid),
    })
}

/// The way out of a field leaving from `end_ident`: the takeoff along the
/// runway and the upwind past its end, then straight out or a 45° turn to
/// the pattern's side (AIM 4-3-3), whichever is the nearer the way on to
/// `toward`, straight out on a tie or with no field to go on to.
pub fn departure(runway: &CircuitRunway, end_ident: &str, toward: Option<Point>) -> Option<(Pattern, f64)> {
    let c = corners(runway, end_ident)?;
    let turned = bisector(&c);
    let on = toward.map_or(c.along, |t| bearing_deg(c.upwind_end.0, c.upwind_end.1, t.0, t.1));
    let straight = signed_turn(c.along, on).abs() <= signed_turn(turned, on).abs();
    let out = if straight { c.along } else { turned };
    let end = &runway.ends[c.end];
    let pattern = Pattern {
        arrival: false,
        runway: runway_number(&end.ident).to_owned(),
        traffic: end.traffic.clone(),
        legs: vec![("Upwind", c.threshold, c.upwind_end)],
        entry: (if straight { "Straight out" } else { "45° departure" }, c.upwind_end, dest(c.upwind_end, out, ENTRY_NM)),
    };
    Some((pattern, out))
}

/// The pattern flown to land on `end_ident`, as the points of a leg the
/// planner flies (wingtip.pattern arrival_circuit, wingtip.procedure_paths): in at
/// 45° to the downwind abeam midfield, along the downwind, then base and
/// final to the threshold.
pub fn arrival_points(runway: &CircuitRunway, end_ident: &str) -> Option<Vec<Point>> {
    let p = arrival(runway, end_ident)?;
    let (_, entry, mid) = p.entry;
    Some(vec![entry, mid, p.legs[2].2, p.legs[3].2, p.legs[4].2])
}

/// The way out by `end_ident`, as the points of a leg the planner flies
/// (wingtip.pattern departure_circuit): the threshold, the far end, the
/// upwind's end and the exit, with the exit's true bearing.
pub fn departure_points(runway: &CircuitRunway, end_ident: &str, toward: Point) -> Option<(Vec<Point>, f64)> {
    let c = corners(runway, end_ident)?;
    let (p, out) = departure(runway, end_ident, Some(toward))?;
    Some((vec![c.threshold, c.far, c.upwind_end, p.entry.2], out))
}
