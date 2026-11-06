//! What a VOR's and a fix's cards say a pilot does with them: the radial
//! the airplane is on and the course to fly to the station, the station's
//! Morse identifier, its service volume, and a fix's place off the
//! nearest VOR as a controller gives it. The web's lib/navaid had these.

use crate::figures::words::js_round_f;
use crate::geo::{bearing_deg, distance_nm};

/// A VOR as its card has it: where it is and the declination its radials
/// are aligned to (NASR NAV_BASE MAG_VARN, east positive).
#[derive(Clone, Debug, PartialEq)]
pub struct Station {
    pub ident: String,
    pub lat: f64,
    pub lon: f64,
    pub mag_var: Option<f64>,
}

/// A direction from 0 up to 360 (JavaScript's `((d % 360) + 360) % 360`).
fn normalize(deg: f64) -> f64 {
    ((deg % 360.0) + 360.0) % 360.0
}

/// Degrees as a VOR's radial or a course is said: three figures, 360 for
/// north ("the 360 radial"), never 000.
pub fn three_figures(deg: f64) -> String {
    let whole = js_round_f(normalize(deg)) as i64 % 360;
    format!("{:03}", if whole == 0 { 360 } else { whole })
}

/// The radial of `station` that a point is on, the course to fly to the
/// station and how far, nm: the magnetic bearing from the station as its
/// radials are laid out, to the station's own declination (NASR NAV_BASE
/// MAG_VARN, the year it was set in MAG_VARN_YEAR), not today's variation
/// at the airplane -- as the planner turns a pilot's "JOT/045/12"
/// (wingtip.fixes.frd_point). The course to it is the radial's reciprocal.
/// None where the station has no declination filed.
pub fn radial_of(station: &Station, lat: f64, lon: f64) -> Option<(f64, f64, f64)> {
    let var = station.mag_var?;
    // Magnetic = true - east variation.
    let radial = normalize(bearing_deg(station.lat, station.lon, lat, lon) - var);
    Some((radial, normalize(radial + 180.0), distance_nm(station.lat, station.lon, lat, lon)))
}

/// A point off the nearest of `stations` that has a declination, as a
/// controller and a flight plan give it -- "JOT 045° 12 nm", its
/// fix/radial/distance (AIM 5-1-6) -- or None with none.
pub fn fix_radial_distance(lat: f64, lon: f64, stations: &[Station]) -> Option<String> {
    let mut best: Option<(&Station, f64)> = None;
    for station in stations.iter().filter(|s| s.mag_var.is_some()) {
        let nm = distance_nm(station.lat, station.lon, lat, lon);
        if best.is_none_or(|(_, b)| nm < b) {
            best = Some((station, nm));
        }
    }
    let (station, _) = best?;
    let (radial, _, nm) = radial_of(station, lat, lon)?;
    Some(format!("{} {}° {} nm", station.ident, three_figures(radial), js_round_f(nm) as i64))
}

/// A letter or figure in International Morse Code.
fn morse_char(c: char) -> Option<&'static str> {
    Some(match c {
        'A' => "·−",
        'B' => "−···",
        'C' => "−·−·",
        'D' => "−··",
        'E' => "·",
        'F' => "··−·",
        'G' => "−−·",
        'H' => "····",
        'I' => "··",
        'J' => "·−−−",
        'K' => "−·−",
        'L' => "·−··",
        'M' => "−−",
        'N' => "−·",
        'O' => "−−−",
        'P' => "·−−·",
        'Q' => "−−·−",
        'R' => "·−·",
        'S' => "···",
        'T' => "−",
        'U' => "··−",
        'V' => "···−",
        'W' => "·−−",
        'X' => "−··−",
        'Y' => "−·−−",
        'Z' => "−−··",
        '0' => "−−−−−",
        '1' => "·−−−−",
        '2' => "··−−−",
        '3' => "···−−",
        '4' => "····−",
        '5' => "·····",
        '6' => "−····",
        '7' => "−−···",
        '8' => "−−−··",
        '9' => "−−−−·",
        _ => return None,
    })
}

/// An ident in International Morse Code, a letter's dots and dashes apart
/// from the next: what the station sends, and the only positive way to
/// know it is the one tuned (AIM 1-1-3).
pub fn morse(ident: &str) -> String {
    ident.to_uppercase().chars().filter_map(morse_char).collect::<Vec<_>>().join("  ")
}

/// A VOR's standard service volume, by NASR's ALT_CODE, as AIM 1-1-8's
/// TBL 1-1-1 gives each: how far out its signal is protected, from 1,000
/// ft above the transmitter (ATH). Below 1,000 ft ATH it reaches less far
/// (AIM 1-1-8 FIG 1-1-2, 1-1-3). The High and VOR High volumes' 130 nm
/// from 18,000 to 45,000 ft above it is left out, a range a VFR airplane
/// does not fly at.
pub fn service_volume(code: &str) -> Option<&'static str> {
    Some(match code {
        "T" => "Terminal · 25 nm, 1,000–12,000 ft above it",
        "L" => "Low · 40 nm, 1,000–18,000 ft above it",
        "H" => "High · 40 nm to 14,500 ft above it, 100 nm above",
        "VL" => "VOR Low · 40 nm under 5,000 ft above it, 70 nm to 18,000",
        "VH" => "VOR High · 40 nm under 5,000 ft above it, 70 nm to 14,500, 100 nm above",
        _ => return None,
    })
}

/// A station's hours as NASR files them in words: "24" is continuous;
/// None where none are filed.
pub fn hours(filed: &str) -> Option<String> {
    match filed {
        "" => None,
        "24" => Some("Continuous".to_owned()),
        other => Some(other.to_owned()),
    }
}
