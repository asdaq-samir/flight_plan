//! The runway check at each airport a flight takes off from or lands at
//! (web/src/lib/runwayCheck.ts): the runway the pilot picked, else the one
//! the wind favours, the field's pressure and density altitude, the
//! reported wind along and across it, and the POH's short-field distances
//! against that runway's length -- the runway lengths and takeoff and
//! landing distances 14 CFR 91.103(b) asks a pilot to know.
//!
//! The runway, its pick and its distances are the runway module's
//! (crate::runway: lib/pattern's runwayFlown, lib/takeoffLanding), shared
//! with FPL's runway chips and the traffic pattern; they are named here
//! too, as the check has always offered them.

pub use crate::runway::performance::{
    density_altitude_ft, end_distance, field_air, pressure_altitude_ft, short_field, soft_surface, Distances, ShortField,
};
pub use crate::runway::pick::{bare_ident, picked_end, runway_flown, runway_in_use, runway_number, End, Flown, Picks, Runway};
use super::minimums::{runway_crosswind_kt, steady_or_gust_kt};
use crate::json;

/// A field's current report, as much as the check reads of it.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Report {
    pub altimeter_in_hg: Option<f64>,
    pub temp_c: Option<f64>,
    pub wind_dir_true_deg: Option<f64>,
    pub wind_speed_kt: Option<f64>,
    pub wind_gust_kt: Option<f64>,
}

/// An airport the flight takes off from or lands at, in the route's
/// order: its elevation (None not known), its METAR (None with none) and
/// its runways.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Field {
    pub ident: String,
    pub elevation_ft: Option<f64>,
    pub metar: Option<Report>,
    pub runways: Vec<Runway>,
}

/// The airplane as the check reads it: its POH's takeoff and landing
/// tables and its demonstrated crosswind, where it gives them.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Airplane {
    pub takeoff: Option<ShortField>,
    pub landing: Option<ShortField>,
    pub demonstrated_kt: Option<f64>,
}

pub struct EndCheck {
    /// "takeoff" or "landing".
    pub kind: &'static str,
    pub distances: Distances,
    pub over: bool,
    /// The runway (its index in the field's) and the end it is flown on: a
    /// stop's runway out may not be its runway in.
    pub runway: Option<usize>,
    pub end: Option<String>,
    /// No runway, or its length not known: whether the distance fits is
    /// not known either, and never taken as "within" (14 CFR 91.103(b)
    /// asks for the runway lengths).
    pub unknown: bool,
    /// Read past the POH's table (Distances::beyond): its edge's figures,
    /// not the airplane's.
    pub beyond: bool,
}

pub struct Check {
    /// The field's index in the route's.
    pub field: usize,
    pub role: &'static str,
    /// The runway out of the departure, into every other field, and its
    /// end, and whether the pilot picked it rather than the wind.
    pub runway: Option<usize>,
    pub end: Option<String>,
    pub picked: bool,
    /// None where the field's elevation is not known, and with it the
    /// distances (see `unchecked`).
    pub pressure_alt_ft: Option<f64>,
    pub density_alt_ft: Option<f64>,
    /// The temperature reported, else a standard day's at the elevation;
    /// None with neither.
    pub temp_c: Option<f64>,
    /// The temperature and altimeter were reported (a METAR).
    pub reported: bool,
    pub headwind_kt: f64,
    /// The crosswind on that runway, its gusts' where they are more.
    pub crosswind_kt: f64,
    /// Past the most the POH demonstrates, where it says: not a
    /// limitation, but beyond what was flown.
    pub crosswind_over: bool,
    pub grass: bool,
    /// Why the field's distances were not worked out (they are then
    /// empty), where they were not.
    pub unchecked: Option<&'static str>,
    pub distances: Vec<EndCheck>,
}

/// Why a field's distances are not worked out without its elevation.
pub const NO_ELEVATION: &str = "the field's elevation is not known";

struct OnRunway {
    runway: Option<usize>,
    end: Option<String>,
    picked: bool,
    headwind: f64,
    crosswind: f64,
}

/// Every airport the flight takes off from or lands at, the distances it
/// needs there: the takeoff from the departure, the landing at the
/// destination, both at a stop. Empty without the POH's tables or the
/// briefing (`briefed` false).
pub fn runway_checks(airplane: &Airplane, briefed: bool, fields: &[Field], takeoff_lb: Option<f64>, landing_lb: Option<f64>,
                     picks: Option<&Picks>) -> Vec<Check> {
    let (Some(takeoff_table), Some(landing_table)) = (&airplane.takeoff, &airplane.landing) else { return vec![] };
    if !briefed || fields.is_empty() {
        return vec![];
    }
    let mut checks = Vec::new();
    for (i, field) in fields.iter().enumerate() {
        let runways = &field.runways;
        let metar = field.metar.as_ref();
        // The runway the wind favours most, or the longest without a wind.
        let mut open: Vec<usize> = (0..runways.len()).filter(|&r| !runways[r].closed).collect();
        let headwind_of = |r: usize| runways[r].wind.as_ref().map_or(-99.0, |w| w.headwind_kt);
        open.sort_by(|&a, &b| {
            headwind_of(b).total_cmp(&headwind_of(a)).then_with(|| runways[b].length_ft.unwrap_or(0.0).total_cmp(&runways[a].length_ft.unwrap_or(0.0)))
        });
        let windward = open.first().copied();
        // The runway flown for a takeoff or a landing: the pilot's pick
        // where there is one, checked whatever the wind -- a short runway
        // picked was never checked, the long one into the wind was -- with
        // the wind on the end picked (a tailwind on the far end of the
        // wind's runway); else the wind's.
        let flown_for = |takeoff: bool| -> OnRunway {
            let pick = picked_end(picks, &field.ident, takeoff, i == 0);
            let flown = runway_flown(runways, pick);
            let picked = flown.is_some() && pick.is_some();
            let runway = if picked { flown.map(|f| f.0) } else { windward };
            let w = runway.and_then(|r| runways[r].wind.as_ref());
            let end = if picked { flown.map(|(r, e, _)| runways[r].ends[e].ident.clone()) } else { w.map(|w| w.end.clone()) };
            let headwind = match w {
                Some(w) if end.as_ref().is_some_and(|e| *e != w.end) => -w.headwind_kt,
                Some(w) => w.headwind_kt,
                None => 0.0,
            };
            // A variable wind (VRB, AIM 7-1-28) gives the planner no runway
            // components (wingtip.runway_wind): all of it may be across, gusts
            // included, as the minimums take it.
            let crosswind = match (w, metar) {
                (Some(w), _) => runway_crosswind_kt(w),
                (None, Some(m)) if m.wind_dir_true_deg.is_none() && m.wind_speed_kt.is_some_and(|s| s != 0.0 && !s.is_nan()) => {
                    steady_or_gust_kt(m.wind_speed_kt.unwrap_or(0.0), m.wind_gust_kt)
                }
                _ => 0.0,
            };
            OnRunway { runway, end, picked, headwind, crosswind }
        };
        // The field's air from its elevation. Without one the distances are
        // not worked out: taken as sea level (as they once were) a high
        // field's distances come out short -- density altitude lengthens
        // the takeoff roll (FAA-H-8083-25C, chapter 11) -- and the check
        // would pass a runway the airplane may not get off. 14 CFR
        // 91.103(b) asks for the distances at the field, so the check says
        // it does not know them instead.
        let air = field
            .elevation_ft
            .filter(|e| e.is_finite())
            .map(|e| field_air(e, metar.and_then(|m| m.altimeter_in_hg), metar.and_then(|m| m.temp_c)));
        let last = i == fields.len() - 1;
        let kinds: &[bool] = if i == 0 { &[true] } else if last { &[false] } else { &[false, true] };
        let first = flown_for(kinds[0]);
        let distances = match air {
            None => vec![],
            Some(air) => kinds
                .iter()
                .map(|&takeoff| {
                    let on = flown_for(takeoff);
                    let (table, weight) = if takeoff { (takeoff_table, takeoff_lb) } else { (landing_table, landing_lb) };
                    let runway = on.runway.map(|r| &runways[r]);
                    let (d, over) = end_distance(table, runway, air, weight, on.headwind);
                    let unknown = runway.and_then(|r| r.length_ft).is_none();
                    let beyond = d.beyond();
                    EndCheck { kind: if takeoff { "takeoff" } else { "landing" }, distances: d, over, runway: on.runway, end: on.end, unknown, beyond }
                })
                .collect(),
        };
        checks.push(Check {
            field: i,
            role: if i == 0 { "Departure" } else if last { "Destination" } else { "Stop" },
            runway: first.runway,
            end: first.end.clone(),
            picked: first.picked,
            pressure_alt_ft: air.map(|a| a.0),
            density_alt_ft: air.map(|a| density_altitude_ft(a.0, a.1)),
            temp_c: air.map(|a| a.1).or(metar.and_then(|m| m.temp_c)),
            reported: metar.is_some(),
            headwind_kt: first.headwind,
            crosswind_kt: first.crosswind,
            crosswind_over: airplane.demonstrated_kt.is_some_and(|d| first.crosswind > d),
            grass: soft_surface(first.runway.map(|r| &runways[r])),
            unchecked: air.is_none().then_some(NO_ELEVATION),
            distances,
        });
    }
    checks
}

pub fn distances_json(out: &mut String, d: &Distances) {
    out.push_str("\"ground_roll_ft\":");
    json::number(out, d.ground_roll_ft);
    out.push_str(",\"total_ft\":");
    json::number(out, d.total_ft);
    out.push_str(",\"caveats\":[");
    for (i, c) in d.caveats.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        json::string(out, c);
    }
    out.push(']');
}

fn opt_index(out: &mut String, i: Option<usize>) {
    match i {
        Some(i) => out.push_str(&i.to_string()),
        None => out.push_str("null"),
    }
}

/// The checks as JSON, each field and runway by its index in what was
/// given (the field's in `fields`, the runway's in that field's runways),
/// for the caller to put its own back.
pub fn checks_json(checks: &[Check]) -> String {
    let mut out = String::from("[");
    for (n, c) in checks.iter().enumerate() {
        if n > 0 {
            out.push(',');
        }
        out.push_str(&format!("{{\"field\":{},\"role\":\"{}\",\"runway\":", c.field, c.role));
        opt_index(&mut out, c.runway);
        out.push_str(",\"end\":");
        json::opt_string(&mut out, c.end.as_deref());
        out.push_str(&format!(",\"picked\":{},\"pressure_alt_ft\":", c.picked));
        json::opt_number(&mut out, c.pressure_alt_ft);
        out.push_str(",\"density_alt_ft\":");
        json::opt_number(&mut out, c.density_alt_ft);
        out.push_str(",\"temp_c\":");
        json::opt_number(&mut out, c.temp_c);
        out.push_str(&format!(",\"reported\":{},\"headwind_kt\":", c.reported));
        json::number(&mut out, c.headwind_kt);
        out.push_str(",\"crosswind_kt\":");
        json::number(&mut out, c.crosswind_kt);
        out.push_str(&format!(",\"crosswind_over\":{},\"grass\":{},\"unchecked\":", c.crosswind_over, c.grass));
        json::opt_string(&mut out, c.unchecked);
        out.push_str(",\"distances\":[");
        for (k, d) in c.distances.iter().enumerate() {
            if k > 0 {
                out.push(',');
            }
            out.push_str(&format!("{{\"kind\":\"{}\",", d.kind));
            distances_json(&mut out, &d.distances);
            out.push_str(&format!(",\"over\":{},\"unknown\":{},\"beyond\":{},\"runway\":", d.over, d.unknown, d.beyond));
            opt_index(&mut out, d.runway);
            out.push_str(",\"end\":");
            json::opt_string(&mut out, d.end.as_deref());
            out.push('}');
        }
        out.push_str("]}");
    }
    out.push(']');
    out
}
