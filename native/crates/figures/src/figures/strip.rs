//! The flight's fuel figure in the strip at the sheet's foot (the web's
//! FlightLine, the iPhone's FiguresStrip, Android's Figures): one answer
//! for the three, so the strip says the same fuel on each. The figure is
//! the fuel required to the next landing -- the tanks are filled at each
//! stop (the planner's app.planning.route_totals) -- less what a flight
//! under way has burnt; red where the tanks do not hold it on any flight
//! of the route. Before the nav log's totals are in, an estimate from the
//! airplane's book alone.

use crate::flight::{reserve_min, DEFAULT_TAXI_FUEL_GAL};

/// One flight between two landings, as the planner's totals give it.
#[derive(Clone, Debug, PartialEq)]
pub struct Hop {
    pub departure: String,
    pub destination: String,
    pub fuel_required_gal: Option<f64>,
    pub fuel_margin_gal: Option<f64>,
}

/// A flight the tanks do not hold the fuel and its reserve for: "C81 →
/// KMSN", or "" for a route with no stops, and by how much.
#[derive(Clone, Debug, PartialEq)]
pub struct Short {
    pub name: String,
    pub short_gal: f64,
}

/// The strip's fuel: the fuel required to the landing of hop `hop` (the
/// first where the route has stops; the whole route's where it has none),
/// less `burnt_gal` where a flight is under way, never below nothing; and
/// the flights the tanks fall short on, a fuel margin under nothing being
/// the fuel and its reserve (14 CFR 91.151, 91.167) more than they hold.
pub fn fuel_figure(
    required_gal: Option<f64>,
    margin_gal: Option<f64>,
    hops: &[Hop],
    hop: usize,
    burnt_gal: Option<f64>,
) -> (Option<f64>, Vec<Short>) {
    let planned = match hops.get(hop.min(hops.len().saturating_sub(1))) {
        Some(h) => h.fuel_required_gal,
        None => required_gal,
    };
    let required = planned.map(|p| match burnt_gal {
        Some(b) => (p - b).max(0.0),
        None => p,
    });
    let flights: Vec<(String, Option<f64>)> = if hops.is_empty() {
        vec![(String::new(), margin_gal)]
    } else {
        hops.iter().map(|h| (format!("{} → {}", h.departure, h.destination), h.fuel_margin_gal)).collect()
    };
    let short = flights
        .into_iter()
        .filter_map(|(name, m)| m.filter(|m| *m < 0.0).map(|m| Short { name, short_gal: -m }))
        .collect();
    (required, short)
}

/// The reserve an estimate carries, minutes: the most the rules ask --
/// night VFR (14 CFR 91.151(a)(2)) and IFR (91.167(a)(3)), 45 minutes --
/// as whether the flight is either is not known before the nav log, so an
/// estimate is never short.
pub fn estimate_reserve_min() -> f64 {
    reserve_min(true, false).max(reserve_min(false, true))
}

/// The figures from the airplane's book alone, before the nav log's: at
/// cruise speed with no wind the time over the course's distance,
/// minutes; the fuel at the cruise burn over that time; and the fuel
/// required, that with the start and taxi allowance (DEFAULT_TAXI_FUEL_GAL)
/// and the estimate's reserve at the cruise burn. None where the book
/// gives no speed (or no burn, for the fuel).
pub fn estimate(distance_nm: f64, cruise_tas_kt: Option<f64>, fuel_burn_gph: Option<f64>) -> (Option<f64>, Option<f64>, Option<f64>) {
    let minutes = cruise_tas_kt.filter(|t| *t > 0.0).map(|t| distance_nm / t * 60.0);
    let burn = fuel_burn_gph.filter(|b| *b > 0.0);
    let trip = minutes.zip(burn).map(|(m, b)| m / 60.0 * b);
    let required = trip.zip(burn).map(|(t, b)| t + DEFAULT_TAXI_FUEL_GAL + estimate_reserve_min() / 60.0 * b);
    (minutes, trip, required)
}

/// One point of the route as the tanks are walked along it: the fuel its
/// leg burns to get there (None where not known, which leaves the tanks
/// unknown from there to the next fill), and whether the tanks are filled
/// on landing there (a field stopped at, not a fix).
#[derive(Clone, Debug, PartialEq)]
pub struct TankPoint {
    pub departure: bool,
    pub fuel_gal: Option<f64>,
    pub refuel: bool,
}

/// The fuel in the tanks at each point, gallons, and whether it is under
/// the reserve: full (`usable_gal`) at the departure, the start, taxi and
/// takeoff allowance and each leg's burn taken from them after, filled
/// again at each field landed at, as the planner checks each flight
/// (app.planning.route_totals). None at a point past a leg whose burn is
/// not known, until the next fill.
pub fn tanks(points: &[TankPoint], usable_gal: f64, taxi_gal: f64, reserve_gal: f64) -> Vec<Option<(f64, bool)>> {
    let mut burned = 0.0;
    points
        .iter()
        .map(|p| {
            if p.departure {
                return Some((usable_gal, false));
            }
            burned += p.fuel_gal.unwrap_or(f64::NAN);
            let gal = usable_gal - taxi_gal - burned;
            let at = gal.is_finite().then(|| (gal.max(0.0), gal < reserve_gal));
            if p.refuel {
                burned = 0.0;
            }
            at
        })
        .collect()
}
