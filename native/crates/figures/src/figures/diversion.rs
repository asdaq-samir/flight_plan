//! A diversion worked out exactly (the roadmap's diversion drill, ACS
//! PA.VI.C): from a point on the route, to the field a student picks, in
//! the leg's own air -- its altitude, wind, true airspeed, burn and
//! variation -- the true course and distance there, the wind triangle,
//! the magnetic heading, the ground speed, the time and the fuel. And a
//! student's own estimates checked against it.
//!
//! The ACS asks for "a reasonable estimate of heading, groundspeed,
//! arrival time, and fuel required" (PA.VI.C.S2) and gives no figures;
//! ALLOWANCES are this drill's own, about what a pilot works out in their
//! head and off the chart while flying the airplane.
//!
//! app.figures.diversion (itself web/src/lib/diversion.ts) and the
//! planner's steps in words: the web's copy holds the same rules and
//! changes with this.

use super::words::{bearing, js_round, norm360, to_fixed, wind_correction};
use crate::flight;
use crate::geo::angle_between;
use crate::json;

/// The figures a student estimates, and how far off is still reasonable:
/// key, label, unit and allowance.
pub const ALLOWANCES: [(&str, &str, &str, f64); 4] = [
    ("mh", "Magnetic heading", "°", 10.0),
    ("gs", "Ground speed", "kt", 10.0),
    ("ete", "Time", "min", 3.0),
    ("fuel", "Fuel", "gal", 1.0),
];

/// The leg's air the diversion is flown in.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Air {
    pub tas_kt: f64,
    pub fuel_burn_gph: f64,
    /// East positive.
    pub magnetic_variation_deg: f64,
    /// The direction the wind blows from, true, and its speed; calm where
    /// there is no forecast.
    pub wind_from_deg: f64,
    pub wind_kt: f64,
}

/// The diversion worked out.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Diverted {
    pub tc: f64,
    pub distance_nm: f64,
    pub wca: f64,
    pub th: f64,
    pub mh: f64,
    pub gs: f64,
    pub ete: f64,
    pub fuel: f64,
}

impl Diverted {
    /// The figure a student estimates, by its key.
    pub fn figure(&self, key: &str) -> Option<f64> {
        match key {
            "mh" => Some(self.mh),
            "gs" => Some(self.gs),
            "ete" => Some(self.ete),
            "fuel" => Some(self.fuel),
            _ => None,
        }
    }
}

/// The wind triangle for a true course: the correction (+ right), the true
/// heading and the ground speed; None where the crosswind is more than the
/// airplane's speed and no heading holds the course. The nav log's own
/// correction and ground speed (flight::wind_correction_deg and
/// groundspeed_kt, wingtip.navlog's), so the drill's figures are the nav
/// log's to the last bit; the hold's legs are worked by it too.
pub fn wind_triangle(tc: f64, tas: f64, wind_from_deg: f64, wind_kt: f64) -> Option<(f64, f64, f64)> {
    if (wind_kt * (wind_from_deg - tc).to_radians().sin()).abs() > tas {
        return None;
    }
    // A calm wind's correction is none, not -0.
    let wca = flight::wind_correction_deg(tc, wind_from_deg, wind_kt, tas) + 0.0;
    let gs = flight::groundspeed_kt(tc, wind_from_deg, wind_kt, tas, wca);
    (gs > 0.0).then(|| (wca, norm360(tc + wca), gs))
}

/// The diversion to a field `distance_nm` away on a true course of
/// `tc_deg`, flown in the leg's air at its cruise burn; None where the
/// crosswind is more than the airplane's speed and no heading holds the
/// course (wind_triangle).
pub fn divert(air: &Air, tc_deg: f64, distance_nm: f64) -> Option<Diverted> {
    let (wca, th, gs) = wind_triangle(tc_deg, air.tas_kt, air.wind_from_deg, air.wind_kt)?;
    let ete = (distance_nm / gs) * 60.0;
    Some(Diverted {
        tc: tc_deg,
        distance_nm,
        wca,
        th,
        // East is least: a variation east (positive) comes off.
        mh: norm360(th - air.magnetic_variation_deg),
        gs,
        ete,
        fuel: (ete / 60.0) * air.fuel_burn_gph,
    })
}

/// Whether an estimate is reasonable: within its allowance, a heading
/// round the compass (358 is 4 from 002). None for a key not estimated.
pub fn reasonable(key: &str, typed: f64, exact: f64) -> Option<bool> {
    let allowance = ALLOWANCES.iter().find(|a| a.0 == key)?.3;
    let off = if key == "mh" { angle_between(typed, exact) } else { (typed - exact).abs() };
    Some(off <= allowance + 1e-9)
}

/// A figure as the student would write it (the web's DiversionDrill
/// `written`).
pub fn written(key: &str, value: f64) -> String {
    match key {
        "mh" => bearing(value),
        "fuel" => format!("{} gal", to_fixed(value, 1)),
        "gs" => format!("{} kt", js_round(value)),
        _ => format!("{} min", js_round(value)),
    }
}

/// The diversion's steps in words, name and value, as the drill shows them.
pub fn steps(d: &Diverted) -> Vec<(&'static str, String)> {
    vec![
        ("True course", format!("{}, {} nm", bearing(d.tc), to_fixed(d.distance_nm, 1))),
        ("Wind correction", wind_correction(d.wca)),
        ("True heading", bearing(d.th)),
        ("Magnetic heading", bearing(d.mh)),
        ("Ground speed", format!("{} kt", js_round(d.gs))),
        ("Time", format!("{} min", js_round(d.ete))),
        ("Fuel", format!("{} gal", to_fixed(d.fuel, 1))),
    ]
}

/// The solution, its steps, the problem where there is none, and each
/// estimate checked, as the planner's /api/diversion answers them (the
/// field and its air are the planner's, from its own data): JSON
/// `{"solved", "steps", "problem", "checks"}`. `to` is the field's ident
/// for the problem's words; `typed` the student's estimates in
/// ALLOWANCES' order, None where not given.
pub fn diversion_json(air: &Air, tc_deg: f64, distance_nm: f64, to: &str, typed: [Option<f64>; 4]) -> String {
    let solved = divert(air, tc_deg, distance_nm);
    let mut out = String::from("{\"solved\":");
    match &solved {
        None => out.push_str("null"),
        Some(d) => {
            let figures = [("tc", d.tc), ("distance_nm", d.distance_nm), ("wca", d.wca), ("th", d.th), ("mh", d.mh),
                           ("gs", d.gs), ("ete", d.ete), ("fuel", d.fuel)];
            for (i, (key, v)) in figures.iter().enumerate() {
                out.push_str(if i == 0 { "{\"" } else { ",\"" });
                out.push_str(key);
                out.push_str("\":");
                json::number(&mut out, *v);
            }
            out.push('}');
        }
    }
    out.push_str(",\"steps\":[");
    if let Some(d) = &solved {
        for (i, (name, value)) in steps(d).iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            out.push_str("{\"name\":");
            json::string(&mut out, name);
            out.push_str(",\"value\":");
            json::string(&mut out, value);
            out.push('}');
        }
    }
    out.push_str("],\"problem\":");
    let problem = solved.is_none().then(|| format!("The wind is too strong for a heading to {to} to hold."));
    json::opt_string(&mut out, problem.as_deref());
    out.push_str(",\"checks\":[");
    for (i, ((key, label, unit, allowance), typed)) in ALLOWANCES.iter().zip(typed).enumerate() {
        if i > 0 {
            out.push(',');
        }
        let exact = solved.as_ref().and_then(|d| d.figure(key));
        out.push_str("{\"key\":");
        json::string(&mut out, key);
        out.push_str(",\"label\":");
        json::string(&mut out, label);
        out.push_str(",\"unit\":");
        json::string(&mut out, unit);
        out.push_str(",\"allowance\":");
        json::number(&mut out, *allowance);
        out.push_str(",\"typed\":");
        json::opt_number(&mut out, typed);
        out.push_str(",\"exact\":");
        json::opt_number(&mut out, exact);
        out.push_str(",\"written\":");
        json::opt_string(&mut out, exact.map(|e| written(key, e)).as_deref());
        out.push_str(",\"reasonable\":");
        match (typed, exact) {
            (Some(t), Some(e)) => out.push_str(if reasonable(key, t, e) == Some(true) { "true" } else { "false" }),
            _ => out.push_str("null"),
        }
        out.push('}');
    }
    out.push_str("]}");
    out
}
