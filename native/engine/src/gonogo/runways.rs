//! The runway check at each airport a flight takes off from or lands at
//! (web/src/lib/runwayCheck.ts, lib/takeoffLanding.ts and lib/pattern.ts's
//! runwayFlown): the runway the pilot picked, else the one the wind
//! favours, the field's pressure and density altitude, the reported wind
//! along and across it, and the POH's short-field distances against that
//! runway's length -- the runway lengths and takeoff and landing
//! distances 14 CFR 91.103(b) asks a pilot to know.

use super::minimums::{runway_crosswind_kt, steady_or_gust_kt, RunwayWind};
use crate::flight;
use crate::json;

/// The field's pressure altitude from its elevation and the altimeter
/// setting reported: a thousand feet for every inch under 29.92
/// (FAA-H-8083-25C, chapter 11); the elevation itself without one (none,
/// or 0, as JavaScript's falsy 0).
pub fn pressure_altitude_ft(elevation_ft: f64, altimeter_in_hg: Option<f64>) -> f64 {
    match altimeter_in_hg {
        Some(a) if a != 0.0 && !a.is_nan() => elevation_ft + (flight::STANDARD_INHG - a) * 1000.0,
        _ => elevation_ft + 0.0,
    }
}

/// Density altitude: the height in the standard atmosphere whose air is
/// as thin as the field's, from its pressure altitude and temperature --
/// worked out from the atmosphere itself rather than the 120 ft a degree
/// rule of thumb. What an airplane performs as if it were at
/// (FAA-H-8083-25C, chapter 11). The engine's standard atmosphere
/// (flight), the one the nav log's cruise and climb are flown in.
pub fn density_altitude_ft(pressure_alt_ft: f64, temp_c: f64) -> f64 {
    flight::density_altitude_ft(flight::density_ratio(pressure_alt_ft, temp_c))
}

/// A POH's short-field table (the profile's ShortField): its pressure
/// altitudes and temperatures, its weights heaviest first, for each weight
/// the ground roll's and the total over a 50 ft obstacle's grids (rows the
/// altitudes, columns the temperatures), and the ground roll's share more
/// on dry grass, per cent.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ShortField {
    pub pressure_altitudes_ft: Vec<f64>,
    pub temperatures_c: Vec<f64>,
    pub weights_lb: Vec<f64>,
    pub ground_roll_ft: Vec<Vec<Vec<f64>>>,
    pub total_50ft_ft: Vec<Vec<Vec<f64>>>,
    pub grass_ground_roll_pct: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Distances {
    pub ground_roll_ft: f64,
    pub total_ft: f64,
    /// What could not be had from the table: beyond its altitudes or
    /// temperatures (where its edge is taken), or a tailwind past ten.
    pub caveats: Vec<&'static str>,
}

struct At {
    i: usize,
    f: f64,
    beyond: bool,
}

/// A value between table points, its edge where it is beyond them.
fn at(points: &[f64], value: f64) -> At {
    let n = points.len();
    if value <= points[0] {
        return At { i: 0, f: 0.0, beyond: value < points[0] };
    }
    if value >= points[n - 1] {
        return At { i: n - 2, f: 1.0, beyond: value > points[n - 1] };
    }
    let mut i = 0;
    while points[i + 1] < value {
        i += 1;
    }
    At { i, f: (value - points[i]) / (points[i + 1] - points[i]), beyond: false }
}

fn bilinear(grid: &[Vec<f64>], row: &At, col: &At) -> f64 {
    let g = |r: usize, c: usize| grid[r][c];
    let top = g(row.i, col.i) + (g(row.i, col.i + 1) - g(row.i, col.i)) * col.f;
    let bottom = g(row.i + 1, col.i) + (g(row.i + 1, col.i + 1) - g(row.i + 1, col.i)) * col.f;
    top + (bottom - top) * row.f
}

/// A POH's short-field distances at a pressure altitude, temperature and
/// weight: read between the table's altitudes and temperatures, and
/// between its weights (a weight under the lightest table taken at that
/// table, which is the longer); then its notes -- a tenth less for every
/// 9 kt of headwind, a tenth more for every 2 kt of tailwind up to 10 --
/// and on dry grass the ground roll's share more.
pub fn short_field(table: &ShortField, pressure_alt_ft: f64, temp_c: f64, weight_lb: f64, headwind_kt: f64, grass: bool) -> Distances {
    let mut caveats = Vec::new();
    let row = at(&table.pressure_altitudes_ft, pressure_alt_ft);
    let col = at(&table.temperatures_c, temp_c);
    if row.beyond {
        caveats.push("the field is higher than the table goes");
    }
    if col.beyond {
        caveats.push("the temperature is beyond the table's");
    }
    // Weights heaviest first; read between the two either side.
    let weights = &table.weights_lb;
    let read = |grids: &[Vec<Vec<f64>>]| -> f64 {
        let values: Vec<f64> = grids.iter().map(|g| bilinear(g, &row, &col)).collect();
        if weights.len() == 1 || weight_lb >= weights[0] {
            return values[0];
        }
        for k in 0..weights.len() - 1 {
            if weight_lb >= weights[k + 1] {
                let f = (weights[k] - weight_lb) / (weights[k] - weights[k + 1]);
                return values[k] + (values[k + 1] - values[k]) * f;
            }
        }
        values[values.len() - 1]
    };
    let mut roll = read(&table.ground_roll_ft);
    let mut total = read(&table.total_50ft_ft);
    // The Cessna 172S POH's notes to its takeoff and landing charts
    // (figures 5-5 and 5-11): "Decrease distances 10% for each 9 knots
    // headwind. For operation with tail winds up to 10 knots, increase
    // distances by 10% for each 2 knots." The one table set in
    // data/aircraft is the 172S's; another handbook's notes differ, and
    // are to come with its tables.
    let factor = if headwind_kt >= 0.0 { 1.0 - 0.1 * (headwind_kt / 9.0) } else { 1.0 + 0.1 * (-headwind_kt / 2.0) };
    if headwind_kt < -10.0 {
        caveats.push("the POH gives no figures for a tailwind over 10 kt");
    }
    roll *= factor;
    total *= factor;
    if grass {
        let added = (table.grass_ground_roll_pct / 100.0) * roll;
        roll += added;
        total += added;
    }
    // Up to the next 5 ft, never down: a distance a runway is checked
    // against reads long rather than short.
    Distances { ground_roll_ft: (roll / 5.0).ceil() * 5.0, total_ft: (total / 5.0).ceil() * 5.0, caveats }
}

/// A runway end: its ident as the data has it ("09") and its true
/// heading, None for one without (a helipad's).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct End {
    pub ident: String,
    pub heading_true_deg: Option<f64>,
}

/// A field's runway, as much as the check reads of it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Runway {
    pub surface: Option<String>,
    pub length_ft: Option<f64>,
    pub closed: bool,
    pub ends: Vec<End>,
    pub wind: Option<RunwayWind>,
}

fn has(text: &str, words: &[&str]) -> bool {
    let text = text.to_lowercase();
    words.iter().any(|w| text.contains(w))
}

/// A runway with a soft surface -- turf, grass, dirt or gravel, as
/// OurAirports and NASR code it -- for the POH's correction to the ground
/// roll on dry grass.
pub fn soft_surface(runway: Option<&Runway>) -> bool {
    runway.and_then(|r| r.surface.as_deref()).is_some_and(|s| has(s, &["turf", "grass", "grs", "dirt", "gravel"]))
}

/// The air a field's distances are worked out in: its pressure altitude
/// from the altimeter reported (a standard 29.92 without one) and the
/// temperature reported, else a standard day's at its elevation.
/// (pressure altitude, temperature).
pub fn field_air(elevation_ft: f64, altimeter_in_hg: Option<f64>, temp_c: Option<f64>) -> (f64, f64) {
    (pressure_altitude_ft(elevation_ft, altimeter_in_hg), temp_c.unwrap_or_else(|| flight::isa_temp_c(elevation_ft)))
}

/// One runway end's short-field distance over a 50 ft obstacle, at the
/// weight (the table's heaviest, the longest distance, where none is
/// known), with the headwind on that end (a tailwind negative) and the
/// correction for a soft surface; and whether it is longer than the
/// runway.
pub fn end_distance(table: &ShortField, runway: Option<&Runway>, air: (f64, f64), weight_lb: Option<f64>, headwind_kt: f64)
                    -> (Distances, bool) {
    let heaviest = table.weights_lb.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let d = short_field(table, air.0, air.1, weight_lb.unwrap_or(heaviest), headwind_kt, soft_surface(runway));
    let over = runway.and_then(|r| r.length_ft).is_some_and(|length| d.total_ft > length);
    (d, over)
}

/// A runway end as painted: "9" for "09".
pub fn runway_number(ident: &str) -> &str {
    let stripped = ident.trim_start_matches('0');
    // Leading zeros, but not the last figure of a number all zeros.
    if stripped.len() < ident.len() && !stripped.starts_with(|c: char| c.is_ascii_digit()) {
        &ident[ident.len() - stripped.len() - 1..]
    } else {
        stripped
    }
}

/// Paved, asphalt or concrete (OurAirports' surface codes), where an
/// unpaved strip may be listed longer.
fn paved(r: &Runway) -> bool {
    r.surface.as_deref().is_some_and(|s| has(s, &["asp", "con", "bit", "pem", "paved"]))
}

/// Paved first, then the longer: the runway a field's traffic uses most,
/// as far as its data says.
fn most_used(a: &Runway, b: &Runway) -> std::cmp::Ordering {
    (paved(b) as i32).cmp(&(paved(a) as i32)).then_with(|| b.length_ft.unwrap_or(0.0).total_cmp(&a.length_ft.unwrap_or(0.0)))
}

/// The runway flown: its index in the field's runways, its end's index in
/// that runway's ends, and whether the reported wind chose it.
pub type Flown = (usize, usize, bool);

/// The runway end a pilot would take off from and land on (lib/pattern
/// runwayInUse): of the ends the reported wind favours, the one with the
/// most headwind -- AC 90-66C 11.5's runway most nearly into the wind,
/// calm, the one the field's last wind favoured -- or, with no wind
/// reported, the most used runway's first end. Only ends with a heading.
pub fn runway_in_use(runways: &[Runway]) -> Option<Flown> {
    let open: Vec<usize> = (0..runways.len())
        .filter(|&i| !runways[i].closed && runways[i].ends.iter().any(|e| e.heading_true_deg.is_some()))
        .collect();
    let mut winded: Vec<usize> = open.iter().copied().filter(|&i| runways[i].wind.is_some()).collect();
    // A stable sort, as JavaScript's: equals keep the data's order.
    winded.sort_by(|&a, &b| {
        let (wa, wb) = (runways[a].wind.as_ref().unwrap(), runways[b].wind.as_ref().unwrap());
        (wb.in_use as i32)
            .cmp(&(wa.in_use as i32))
            .then_with(|| wb.headwind_kt.total_cmp(&wa.headwind_kt))
            .then_with(|| most_used(&runways[a], &runways[b]))
    });
    for i in winded {
        let wind_end = &runways[i].wind.as_ref().unwrap().end;
        if let Some(j) = runways[i].ends.iter().position(|e| &e.ident == wind_end && e.heading_true_deg.is_some()) {
            return Some((i, j, true));
        }
    }
    let mut by_use = open;
    by_use.sort_by(|&a, &b| most_used(&runways[a], &runways[b]));
    let longest = *by_use.first()?;
    let j = runways[longest].ends.iter().position(|e| e.heading_true_deg.is_some())?;
    Some((longest, j, false))
}

/// The runway end flown at a field (lib/pattern runwayFlown): the pilot's
/// pick where they made one (the end as painted, "24"), else
/// runway_in_use.
pub fn runway_flown(runways: &[Runway], picked: Option<&str>) -> Option<Flown> {
    if let Some(picked) = picked.filter(|p| !p.is_empty()) {
        for (i, runway) in runways.iter().enumerate().filter(|(_, r)| !r.closed) {
            if let Some(j) = runway
                .ends
                .iter()
                .position(|e| runway_number(&e.ident) == runway_number(picked) && e.heading_true_deg.is_some())
            {
                let by_wind = runway.wind.as_ref().is_some_and(|w| w.end == runway.ends[j].ident);
                return Some((i, j, by_wind));
            }
        }
    }
    runway_in_use(runways)
}

/// A field's ident for matching, as lib/procedures sameField has it:
/// trimmed, in capitals, and a K before three letters or figures taken
/// off, so a stop typed UES is the planner's KUES.
pub fn bare_ident(ident: &str) -> String {
    let upper = ident.trim().to_uppercase();
    let rest = upper.strip_prefix('K').filter(|r| r.chars().count() == 3 && r.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()));
    rest.map_or(upper.clone(), str::to_owned)
}

/// The runways the pilot picked, by field, in the order they were made:
/// `pattern` the departure's runway out and every other field's runway
/// in, `takeoff` a stop's runway out ("24", as painted).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Picks {
    pub pattern: Vec<(String, String)>,
    pub takeoff: Vec<(String, String)>,
}

/// The end the pilot picked at `ident` for a takeoff or a landing, by the
/// field's ICAO or FAA ident alike (lib/pattern pickedEnd); None with no
/// pick, or an older address's "NONE".
pub fn picked_end<'a>(picks: Option<&'a Picks>, ident: &str, takeoff: bool, departure: bool) -> Option<&'a str> {
    let picks = picks?;
    let by_field = if takeoff && !departure { &picks.takeoff } else { &picks.pattern };
    let want = bare_ident(ident);
    let (_, end) = by_field.iter().find(|(field, _)| bare_ident(field) == want)?;
    (end != "NONE").then_some(end.as_str())
}

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
    pub pressure_alt_ft: f64,
    pub density_alt_ft: f64,
    pub temp_c: f64,
    /// The temperature and altimeter were reported (a METAR).
    pub reported: bool,
    pub headwind_kt: f64,
    /// The crosswind on that runway, its gusts' where they are more.
    pub crosswind_kt: f64,
    /// Past the most the POH demonstrates, where it says: not a
    /// limitation, but beyond what was flown.
    pub crosswind_over: bool,
    pub grass: bool,
    pub distances: Vec<EndCheck>,
}

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
            // components (vfr.runway_wind): all of it may be across, gusts
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
        let air = field_air(field.elevation_ft.unwrap_or(0.0), metar.and_then(|m| m.altimeter_in_hg), metar.and_then(|m| m.temp_c));
        let last = i == fields.len() - 1;
        let kinds: &[bool] = if i == 0 { &[true] } else if last { &[false] } else { &[false, true] };
        let first = flown_for(kinds[0]);
        let distances = kinds
            .iter()
            .map(|&takeoff| {
                let on = flown_for(takeoff);
                let (table, weight) = if takeoff { (takeoff_table, takeoff_lb) } else { (landing_table, landing_lb) };
                let (d, over) = end_distance(table, on.runway.map(|r| &runways[r]), air, weight, on.headwind);
                EndCheck { kind: if takeoff { "takeoff" } else { "landing" }, distances: d, over, runway: on.runway, end: on.end }
            })
            .collect();
        checks.push(Check {
            field: i,
            role: if i == 0 { "Departure" } else if last { "Destination" } else { "Stop" },
            runway: first.runway,
            end: first.end.clone(),
            picked: first.picked,
            pressure_alt_ft: air.0,
            density_alt_ft: density_altitude_ft(air.0, air.1),
            temp_c: air.1,
            reported: metar.is_some(),
            headwind_kt: first.headwind,
            crosswind_kt: first.crosswind,
            crosswind_over: airplane.demonstrated_kt.is_some_and(|d| first.crosswind > d),
            grass: soft_surface(first.runway.map(|r| &runways[r])),
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
        json::number(&mut out, c.pressure_alt_ft);
        out.push_str(",\"density_alt_ft\":");
        json::number(&mut out, c.density_alt_ft);
        out.push_str(",\"temp_c\":");
        json::number(&mut out, c.temp_c);
        out.push_str(&format!(",\"reported\":{},\"headwind_kt\":", c.reported));
        json::number(&mut out, c.headwind_kt);
        out.push_str(",\"crosswind_kt\":");
        json::number(&mut out, c.crosswind_kt);
        out.push_str(&format!(",\"crosswind_over\":{},\"grass\":{},\"distances\":[", c.crosswind_over, c.grass));
        for (k, d) in c.distances.iter().enumerate() {
            if k > 0 {
                out.push(',');
            }
            out.push_str(&format!("{{\"kind\":\"{}\",", d.kind));
            distances_json(&mut out, &d.distances);
            out.push_str(&format!(",\"over\":{},\"runway\":", d.over));
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
