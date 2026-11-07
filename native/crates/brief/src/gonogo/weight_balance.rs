//! The airplane's weight and balance (web/src/lib/weightBalance.ts): what
//! the pilot loads -- its own empty weight and arm (from its weight and
//! balance record), each station's pounds in the loading's order, and the
//! fuel at the start in gallons -- against its POH's loading: the
//! weights, the centre-of-gravity envelope and each station's most (the
//! POH's section 6; 14 CFR 91.9(a), its limitations).

use crate::figures::words::{js_num, js_round_f, pounds, to_fixed};
use crate::json;

/// A station of the loading: its name, arm (inches aft of the datum) and
/// the most it holds, where the POH says.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Station {
    pub name: String,
    pub arm_in: f64,
    pub max_lb: Option<f64>,
}

/// The POH's loading (the profile's Loading).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Loading {
    pub max_ramp_lb: f64,
    pub max_takeoff_lb: f64,
    pub max_landing_lb: f64,
    pub sample_empty_weight_lb: f64,
    pub sample_empty_moment_lb_in: f64,
    pub stations: Vec<Station>,
    pub baggage_combined_max_lb: Option<f64>,
    pub fuel_arm_in: f64,
    pub fuel_max_gal: f64,
    /// Pounds a gallon: avgas's standard 6 (FAA-H-8083-1B, Aircraft Weight
    /// and Balance Handbook) where the airplane's handbook gives none.
    pub fuel_lb_per_gal: f64,
    pub start_taxi_fuel_lb: f64,
    /// The centre-of-gravity envelope, (arm, weight) points in order.
    pub envelope: Vec<(f64, f64)>,
}

/// What the pilot loads: each station's pounds in the loading's order
/// (None, or one left off the end, is nothing there).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Load {
    pub empty_weight_lb: f64,
    pub empty_arm_in: f64,
    pub stations_lb: Vec<Option<f64>>,
    pub fuel_gal: f64,
}

/// The loading's own sample (its POH's), and a pilot of 170 lb.
pub fn default_load(loading: &Loading, fuel_gal: f64) -> Load {
    Load {
        empty_weight_lb: loading.sample_empty_weight_lb,
        empty_arm_in: js_round_f(loading.sample_empty_moment_lb_in / loading.sample_empty_weight_lb * 100.0) / 100.0,
        stations_lb: (0..loading.stations.len()).map(|i| Some(if i == 0 { 170.0 } else { 0.0 })).collect(),
        fuel_gal: fuel_gal.min(loading.fuel_max_gal),
    }
}

/// The forward and aft limits at a weight: the envelope's edges there.
pub fn limits_at(envelope: &[(f64, f64)], weight: f64) -> Option<(f64, f64)> {
    let mut arms = Vec::new();
    let mut j = envelope.len().wrapping_sub(1);
    for i in 0..envelope.len() {
        let ((xi, yi), (xj, yj)) = (envelope[i], envelope[j]);
        if (yi <= weight && weight <= yj) || (yj <= weight && weight <= yi) {
            arms.push(if yi == yj { xi.min(xj) } else { xi + (xj - xi) * (weight - yi) / (yj - yi) });
            if yi == yj {
                arms.push(xi.max(xj));
            }
        }
        j = i;
    }
    if arms.is_empty() {
        return None;
    }
    Some((arms.iter().copied().fold(f64::INFINITY, f64::min), arms.iter().copied().fold(f64::NEG_INFINITY, f64::max)))
}

/// Whether an (arm, weight) point is within the envelope, its edges
/// included: the POH's sample loading sits on its top, at 2,550 lb.
pub fn in_envelope(envelope: &[(f64, f64)], arm: f64, weight: f64) -> bool {
    limits_at(envelope, weight).is_some_and(|(fwd, aft)| fwd - 1e-6 <= arm && arm <= aft + 1e-6)
}

/// A condition: the weight, and the centre of gravity, inches aft of the
/// datum.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Condition {
    pub weight_lb: f64,
    pub arm_in: f64,
}

pub struct Balance {
    pub takeoff: Condition,
    pub landing: Condition,
    /// What is out of limits, each a sentence; empty when it is within.
    pub problems: Vec<String>,
}

/// The weight and centre of gravity at takeoff -- the ramp's, less the
/// start and taxi fuel -- and at landing, less the trip's fuel, each
/// against the loading's limits: the most it may weigh, the envelope, and
/// each station's and the baggage's own most.
pub fn balance(loading: &Loading, load: &Load, trip_fuel_gal: Option<f64>) -> Balance {
    let lb_per_gal = loading.fuel_lb_per_gal;
    let taxi_lb = loading.start_taxi_fuel_lb;
    let at = |i: usize| load.stations_lb.get(i).copied().flatten().unwrap_or(0.0);
    let fuel_lb = load.fuel_gal * lb_per_gal;
    let mut weight = load.empty_weight_lb + fuel_lb;
    let mut moment = load.empty_weight_lb * load.empty_arm_in + fuel_lb * loading.fuel_arm_in;
    for (i, station) in loading.stations.iter().enumerate() {
        weight += at(i);
        moment += at(i) * station.arm_in;
    }
    let takeoff_weight = weight - taxi_lb;
    let takeoff_moment = moment - taxi_lb * loading.fuel_arm_in;
    let burned_lb = (fuel_lb - taxi_lb).min(trip_fuel_gal.unwrap_or(0.0) * lb_per_gal);
    let landing_weight = takeoff_weight - burned_lb;
    let landing_moment = takeoff_moment - burned_lb * loading.fuel_arm_in;
    let takeoff = Condition { weight_lb: takeoff_weight, arm_in: takeoff_moment / takeoff_weight };
    let landing = Condition { weight_lb: landing_weight, arm_in: landing_moment / landing_weight };

    let mut problems = Vec::new();
    let envelope = &loading.envelope;
    if weight > loading.max_ramp_lb {
        problems.push(format!("The ramp weight, {}, is over its most, {}", pounds(weight), pounds(loading.max_ramp_lb)));
    }
    if takeoff.weight_lb > loading.max_takeoff_lb {
        problems.push(format!("The takeoff weight, {}, is {} over its most", pounds(takeoff.weight_lb),
                              pounds(takeoff.weight_lb - loading.max_takeoff_lb)));
    }
    if landing.weight_lb > loading.max_landing_lb {
        problems.push(format!("The landing weight, {}, is {} over its most", pounds(landing.weight_lb),
                              pounds(landing.weight_lb - loading.max_landing_lb)));
    }
    let heaviest = envelope.iter().map(|p| p.1).fold(f64::NEG_INFINITY, f64::max);
    for (name, c) in [("takeoff", takeoff), ("landing", landing)] {
        if c.weight_lb > heaviest {
            continue; // said above, as a weight
        }
        if !in_envelope(envelope, c.arm_in, c.weight_lb) {
            let limits = limits_at(envelope, c.weight_lb);
            let side = match limits {
                Some((fwd, _)) if c.arm_in < fwd => format!("forward of its limit, {} in", to_fixed(fwd, 1)),
                Some((_, aft)) => format!("aft of its limit, {} in", to_fixed(aft, 1)),
                None => "outside the envelope".into(),
            };
            problems.push(format!("At {name} the centre of gravity, {} in, is {side}", to_fixed(c.arm_in, 1)));
        }
    }
    for (i, station) in loading.stations.iter().enumerate() {
        if let Some(most) = station.max_lb {
            if at(i) > most {
                problems.push(format!("{} holds {}, over its {}", station.name, pounds(at(i)), pounds(most)));
            }
        }
    }
    let baggage: f64 = loading
        .stations
        .iter()
        .enumerate()
        .filter(|(_, s)| s.name.to_lowercase().starts_with("baggage"))
        .map(|(i, _)| at(i))
        .fold(0.0, |sum, lb| sum + lb);
    if let Some(most) = loading.baggage_combined_max_lb {
        if baggage > most {
            problems.push(format!("The baggage, {} in all, is over its {}", pounds(baggage), pounds(most)));
        }
    }
    if load.fuel_gal > loading.fuel_max_gal {
        problems.push(format!("{} gal is more than the tanks' usable {}", js_num(load.fuel_gal), js_num(loading.fuel_max_gal)));
    }
    Balance { takeoff, landing, problems }
}

fn condition_json(out: &mut String, c: &Condition) {
    out.push_str("{\"weight_lb\":");
    json::number(out, c.weight_lb);
    out.push_str(",\"arm_in\":");
    json::number(out, c.arm_in);
    out.push('}');
}

/// The balance as JSON: {"takeoff", "landing", "problems"}, and the line
/// the Go / No-Go's row ends with, "2,407 lb at 41.2 in".
pub fn balance_json(b: &Balance) -> String {
    let mut out = String::from("{\"takeoff\":");
    condition_json(&mut out, &b.takeoff);
    out.push_str(",\"landing\":");
    condition_json(&mut out, &b.landing);
    out.push_str(",\"problems\":");
    out.push_str(&super::verdict::strings_json(&b.problems));
    out.push_str(",\"takeoff_words\":");
    json::string(&mut out, &takeoff_words(&b.takeoff));
    out.push('}');
    out
}

/// The takeoff's weight and centre of gravity in words, as the Go /
/// No-Go's row says them (FlightBriefingView): "2,407 lb at 41.2 in".
pub fn takeoff_words(c: &Condition) -> String {
    format!("{} at {} in", pounds(c.weight_lb), to_fixed(c.arm_in, 1))
}

pub fn load_json(load: &Load) -> String {
    let mut out = String::from("{\"empty_weight_lb\":");
    json::number(&mut out, load.empty_weight_lb);
    out.push_str(",\"empty_arm_in\":");
    json::number(&mut out, load.empty_arm_in);
    out.push_str(",\"stations_lb\":[");
    for (i, s) in load.stations_lb.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        json::opt_number(&mut out, *s);
    }
    out.push_str("],\"fuel_gal\":");
    json::number(&mut out, load.fuel_gal);
    out.push('}');
    out
}
