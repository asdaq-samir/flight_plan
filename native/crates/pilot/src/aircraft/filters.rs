//! The Aircraft tab's filters, for an FBO's desk as much as a pilot's:
//! each a plain test on an airplane the planner gives (wingtip.traffic), so
//! the list and its tests agree.

use crate::geo::{angle_between, bearing_deg, distance_nm};

/// What an airplane is, by its transponder's emitter category, which is by
/// weight, not by engine (GDL 90 Data Interface Specification 560-1058-00
/// Rev A, Table 11, DO-260B's categories): A1 light, under 15,500 lb; A2
/// small, 15,500 to 75,000 lb; A3 large, 75,000 to 300,000 lb, A4 a
/// high-vortex large one (a B757) and A5 heavy, over 300,000 lb -- the
/// large ones; A7 rotorcraft. A6, highly maneuverable (over 5 g and fast),
/// is none of these: other. Not "jets": most business jets send A1 or A2,
/// and a large turboprop A3.
/// An emitter category's name in DO-260B's words (GDL 90 Table 11): A1
/// "light", A2 "small", A3 "large", A4 "high_vortex_large", A5 "heavy",
/// A6 "high_performance" (highly maneuverable), A7 "rotorcraft", B1
/// "glider" (a glider or sailplane), B2 "lighter_than_air"; None for one
/// not sent, and for the rest, which the app draws nothing different for.
pub fn emitter(category: Option<&str>) -> Option<&'static str> {
    Some(match category? {
        "A1" => "light",
        "A2" => "small",
        "A3" => "large",
        "A4" => "high_vortex_large",
        "A5" => "heavy",
        "A6" => "high_performance",
        "A7" => "rotorcraft",
        "B1" => "glider",
        "B2" => "lighter_than_air",
        _ => return None,
    })
}

pub fn kind_of(category: Option<&str>) -> &'static str {
    match category.unwrap_or("") {
        "A1" => "light",
        "A2" => "small",
        "A3" | "A4" | "A5" => "large",
        "A7" => "helicopter",
        _ => "other",
    }
}

/// Its height's band, ft as the planner gives it (GNSS where sent, else
/// pressure): low below 3,000, mid to 10,000, high to 18,000, and the
/// flight levels from 18,000 MSL up, Class A ("from 18,000 feet MSL to and
/// including FL600", 14 CFR 71.33(a)). Up there a flight level is a
/// pressure altitude, and a GNSS height near 18,000 may fall either side of
/// it: a band to look by, not a boundary to fly by.
pub fn band_of(altitude_ft: Option<f64>) -> Option<&'static str> {
    let a = altitude_ft?;
    Some(if a < 3000.0 {
        "low"
    } else if a < 10_000.0 {
        "mid"
    } else if a < 18_000.0 {
        "high"
    } else {
        "flight-levels"
    })
}

/// The operator's ICAO three-letter designator, from an airline's callsign
/// ("UAL2088" -> "UAL"); none for a registration flown as a callsign
/// (N174HA).
pub fn operator_of(callsign: Option<&str>) -> Option<String> {
    let c = callsign.unwrap_or("").trim().to_uppercase();
    let b = c.as_bytes();
    (b.len() >= 4 && b[..3].iter().all(u8::is_ascii_uppercase) && b[3].is_ascii_digit()).then(|| c[..3].to_owned())
}

/// Declaring an emergency: 7700 set for one (AIM 6-2-2), 7500 for unlawful
/// interference (AIM 6-3-4), 7600 for a radio failed (AIM 6-4-2), or an
/// emergency sent in its ADS-B.
pub fn in_emergency(squawk: Option<&str>, emergency: bool) -> bool {
    squawk_meaning(squawk).is_some() || emergency
}

/// What a squawk says, where it says more than a code: the three a pilot
/// sets in trouble -- 7500 unlawful interference (AIM 6-3-4, air piracy),
/// 7600 two-way radio failure (AIM 6-4-2), 7700 an emergency (AIM 6-2-2) --
/// in a few words for the airplane's card.
pub fn squawk_meaning(squawk: Option<&str>) -> Option<&'static str> {
    match squawk? {
        "7500" => Some("hijack"),
        "7600" => Some("lost radio"),
        "7700" => Some("emergency"),
        _ => None,
    }
}

/// Round an airport, nm: "about" it -- its pattern and one joining it,
/// well past the 4 nm round a Class C or D primary airport inside which 14
/// CFR 91.117(b) holds an airplane to 200 kt at or below 2,500 ft AGL.
/// (Class D's own area is tailored to each field, AIM 3-2-5.)
pub const AROUND_NM: f64 = 10.0;
/// How far out an airplane may be inbound or departing, nm.
pub const RELATION_NM: f64 = 40.0;
/// Under this far above the field, ft, an airplane can still be coming in
/// or going out of it; higher, it is passing over.
const RELATION_ABOVE_FT: f64 = 12_000.0;
/// Pointed at it, or away, within this, degrees.
const HEADED_DEG: f64 = 30.0;
/// Coming down, or going up, this fast, ft/min.
const CHANGING_FPM: f64 = 200.0;

/// An airplane heard, the parts the filters read.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Plane {
    pub lat: f64,
    pub lon: f64,
    pub altitude_ft: Option<f64>,
    pub track_deg: Option<f64>,
    pub vertical_fpm: Option<f64>,
}

/// How an airplane stands to a field.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Relation {
    pub around: bool,
    pub inbound: bool,
    pub departing: bool,
}

/// How an airplane in the air stands to a field at `lat`, `lon`,
/// `elevation_ft`, read from its position, track and climb -- not its
/// flight plan, which the FAA does not publish openly: inbound where it is
/// pointed at the field and coming down (or already close in), departing
/// where it is pointed away and going up (or still close in and low),
/// within RELATION_NM and not far above it.
pub fn relation_to(plane: &Plane, lat: f64, lon: f64, elevation_ft: f64) -> Relation {
    let nm = distance_nm(lat, lon, plane.lat, plane.lon);
    let above = plane.altitude_ft.map(|a| a - elevation_ft);
    let around = nm <= AROUND_NM;
    let (Some(above), Some(track)) = (above, plane.track_deg) else {
        return Relation { around, ..Relation::default() };
    };
    if nm > RELATION_NM || above > RELATION_ABOVE_FT {
        return Relation { around, ..Relation::default() };
    }
    let to_field = bearing_deg(plane.lat, plane.lon, lat, lon);
    let rate = plane.vertical_fpm.unwrap_or(0.0);
    let inbound = angle_between(track, to_field) <= HEADED_DEG && (rate <= -CHANGING_FPM || nm <= AROUND_NM);
    let departing = angle_between(track, (to_field + 180.0) % 360.0) <= HEADED_DEG
        && (rate >= CHANGING_FPM || (nm <= AROUND_NM && above < 3000.0));
    Relation { around, inbound, departing }
}

/// What a filter asks of an airplane: its kind ("any" or kind_of's), its
/// band ("any" or band_of's), its operator ("" for any) and an emergency.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Filter {
    pub kind: String,
    pub band: String,
    pub operator: String,
    pub emergency: bool,
}

/// An airplane's figures a filter is held against.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Heard {
    pub category: Option<String>,
    pub altitude_ft: Option<f64>,
    pub callsign: Option<String>,
    pub squawk: Option<String>,
    pub emergency: bool,
}

/// Whether the filter keeps the airplane: the place's own test is its
/// caller's (round the field, near the pilot), what it is here.
pub fn matches(plane: &Heard, f: &Filter) -> bool {
    (f.kind == "any" || kind_of(plane.category.as_deref()) == f.kind)
        && (f.band == "any" || band_of(plane.altitude_ft) == Some(f.band.as_str()))
        && (f.operator.is_empty() || operator_of(plane.callsign.as_deref()).as_deref() == Some(f.operator.as_str()))
        && (!f.emergency || in_emergency(plane.squawk.as_deref(), plane.emergency))
}
