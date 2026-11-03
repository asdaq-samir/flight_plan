//! Other airplanes about own ship, as the map draws them (the web's
//! lib/map/traffic, the phone's Traffic): the height under each against own
//! ship's, whether it is near own ship's, which of them is own ship's own
//! transponder heard from the ground, and when and how near one comes.
//! Seconds-old
//! internet data: for knowing what is about, never for avoiding it.

use super::{num, opt, rad};
use crate::figures::words::{grouped, js_round};
use crate::geo::{angle_between, destination, distance_nm};
use crate::json::{self, Value};

/// Within this of own ship's height an airplane is drawn amber, the traffic
/// to look for first. A design choice: 1,000 ft is the vertical spacing VFR
/// cruising altitudes keep between opposite directions' (14 CFR 91.159),
/// the nearest another airplane is meant to be passing.
pub const NEAR_FT: f64 = 1000.0;
/// A vertical rate this or more gets an arrow by the height, as a TCAS
/// display draws one (the FAA's Introduction to TCAS II, version 7.1).
pub const ARROW_FPM: f64 = 500.0;
/// How far ahead a closest approach is looked for, minutes.
pub const CPA_MIN: f64 = 10.0;

/// Whether two heights are within NEAR_FT of each other: the map's traffic
/// coloured so, and the airplane card's closest approach said in red.
pub fn near_in_height(apart_ft: f64) -> bool {
    apart_ft.abs() <= NEAR_FT
}

/// Under the airplane: its height against own ship's in hundreds of feet,
/// "+05" above and "-12" below, as TCAS writes it, with an arrow climbing
/// or descending; with own ship's height not known, its own height in
/// feet, "4,500". Nothing where it sends none. The hundreds cut toward own
/// ship, never rounded away from it, so an airplane is never shown further
/// off than it is: 250 ft below is "-02", 50 ft below "-00" -- the owner's
/// "conservative approach ... to show how close traffic are" (2026-10-28).
pub fn label(altitude_ft: Option<f64>, vertical_fpm: Option<f64>, own_ft: Option<f64>) -> String {
    let Some(ft) = altitude_ft else { return String::new() };
    let rate = vertical_fpm.unwrap_or(0.0);
    let arrow = if rate >= ARROW_FPM {
        "↑"
    } else if rate <= -ARROW_FPM {
        "↓"
    } else {
        ""
    };
    let Some(own) = own_ft else {
        return format!("{}{arrow}", grouped(js_round(ft / 100.0) as f64 * 100.0));
    };
    let apart = ft - own;
    let hundreds = (apart.abs() / 100.0).trunc();
    format!("{}{:02}{arrow}", if apart < 0.0 { "-" } else { "+" }, hundreds as u64)
}

/// Whether it is within NEAR_FT of own ship's height; false where either
/// is not known.
pub fn near_own_height(altitude_ft: Option<f64>, own_ft: Option<f64>) -> bool {
    matches!((altitude_ft, own_ft), (Some(ft), Some(own)) if near_in_height(ft - own))
}

/// Own ship as the GPS has it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Fix {
    pub lat: f64,
    pub lon: f64,
    pub heading_deg: Option<f64>,
    pub speed_kt: Option<f64>,
    pub altitude_ft: Option<f64>,
}

/// An airplane as the feed sends it: what the rules read of it.
#[derive(Clone, Debug, PartialEq)]
pub struct Plane {
    pub hex: String,
    pub lat: f64,
    pub lon: f64,
    pub altitude_ft: Option<f64>,
    pub vertical_fpm: Option<f64>,
    pub track_deg: Option<f64>,
    pub speed_kt: Option<f64>,
    /// How old its position is, s: the feed's own age and the answer's.
    pub seen_s: Option<f64>,
}

/// Which airplane, if any, is own ship itself, heard by the receivers on
/// the ground from its own transponder: the one nearest the GPS's fix --
/// within half a mile and 400 ft of it, going the same way (within 20°) at
/// about the same speed (within 20 kt or 30 %) -- and only that one, so an
/// airplane in formation or just ahead is not lost with it. The feed's
/// position is `seen_s` old, so the fix is taken back along its heading by
/// as much. A design choice, as an EFB asks for the airplane's own address
/// instead, which this app does not know.
pub fn own_ship_hex<'a>(planes: &'a [Plane], fix: Option<&Fix>) -> Option<&'a str> {
    let fix = fix?;
    let (speed, heading) = (fix.speed_kt?, fix.heading_deg?);
    let mut best: Option<(&str, f64)> = None;
    for plane in planes {
        let (Some(track), Some(kt)) = (plane.track_deg, plane.speed_kt) else { continue };
        let back = destination(fix.lat, fix.lon, (heading + 180.0) % 360.0, (speed * plane.seen_s.unwrap_or(0.0)) / 3600.0);
        let nm = distance_nm(back.0, back.1, plane.lat, plane.lon);
        let turn = angle_between(track, heading);
        let height = match (fix.altitude_ft, plane.altitude_ft) {
            (Some(own), Some(ft)) => (ft - own).abs(),
            _ => 0.0,
        };
        if nm > 0.5 || height > 400.0 || turn > 20.0 || (kt - speed).abs() > f64::max(20.0, speed * 0.3) {
            continue;
        }
        if best.is_none_or(|(_, b)| nm < b) {
            best = Some((&plane.hex, nm));
        }
    }
    best.map(|(hex, _)| hex)
}

/// When and how near an airplane comes to own ship, both carried on
/// straight at their ground speeds -- what a traffic display's closing
/// figures say: (minutes to it, nm then, its height above own ship's
/// then) at the closest within CPA_MIN, now where they are already drawing
/// apart; its vertical speed carried on, own ship's height held. None
/// without own ship's track and speed or the airplane's. Flat, east and
/// north of own ship, which is near enough within ten minutes.
pub fn closest_approach(own: &Fix, plane: &Plane) -> Option<(f64, f64, Option<f64>)> {
    let (heading, speed) = (own.heading_deg?, own.speed_kt?);
    let (track, kt) = (plane.track_deg?, plane.speed_kt?);
    let cos_lat = rad(own.lat).cos();
    // Nautical miles east and north of own ship, and knots each way.
    let (rx, ry) = ((plane.lon - own.lon) * 60.0 * cos_lat, (plane.lat - own.lat) * 60.0);
    let vx = kt * rad(track).sin() - speed * rad(heading).sin();
    let vy = kt * rad(track).cos() - speed * rad(heading).cos();
    let closing = vx * vx + vy * vy;
    let hours = if closing > 0.0 { f64::min(CPA_MIN / 60.0, f64::max(0.0, -(rx * vx + ry * vy) / closing)) } else { 0.0 };
    let nm = (rx + vx * hours).hypot(ry + vy * hours);
    let above = match (plane.altitude_ft, own.altitude_ft) {
        (Some(ft), Some(own_ft)) => Some(ft + plane.vertical_fpm.unwrap_or(0.0) * hours * 60.0 - own_ft),
        _ => None,
    };
    Some((hours * 60.0, nm, above))
}

// --- By name (crate::call) ----------------------------------------------

fn fix_of(name: &str, v: &Value) -> Result<Fix, String> {
    Ok(Fix {
        lat: num(name, v, "lat")?,
        lon: num(name, v, "lon")?,
        heading_deg: opt(name, v, "heading_deg")?,
        speed_kt: opt(name, v, "speed_kt")?,
        altitude_ft: opt(name, v, "altitude_ft")?,
    })
}

fn plane_of(name: &str, v: &Value) -> Result<Plane, String> {
    Ok(Plane {
        hex: v.get("hex").and_then(Value::as_str).unwrap_or("").to_owned(),
        lat: num(name, v, "lat")?,
        lon: num(name, v, "lon")?,
        altitude_ft: opt(name, v, "altitude_ft")?,
        vertical_fpm: opt(name, v, "vertical_fpm")?,
        track_deg: opt(name, v, "track_deg")?,
        speed_kt: opt(name, v, "speed_kt")?,
        seen_s: opt(name, v, "seen_s")?,
    })
}

fn list<'a>(name: &str, v: &'a Value, key: &str) -> Result<&'a [Value], String> {
    v.get(key).and_then(Value::as_array).ok_or_else(|| format!("{name}: \"{key}\" is missing or not a list"))
}

/// `traffic_marks`: [{"label", "near"}], one an airplane, from
/// `{"own_ft"?, "planes": [{"altitude_ft"?, "vertical_fpm"?}]}`: the map's
/// airplanes all at once, as one call a plane costs more than the rule.
pub(super) fn marks_rule(v: &Value) -> Result<String, String> {
    let n = "traffic_marks";
    let own = opt(n, v, "own_ft")?;
    let mut out = String::from("[");
    for (i, p) in list(n, v, "planes")?.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        let ft = opt(n, p, "altitude_ft")?;
        out.push_str("{\"label\":");
        json::string(&mut out, &label(ft, opt(n, p, "vertical_fpm")?, own));
        out.push_str(if near_own_height(ft, own) { ",\"near\":true}" } else { ",\"near\":false}" });
    }
    out.push(']');
    Ok(out)
}

/// `own_ship_hex`: the hex or null, from `{"planes": [plane], "fix": fix |
/// null}`.
pub(super) fn own_ship_hex_rule(v: &Value) -> Result<String, String> {
    let n = "own_ship_hex";
    let planes = list(n, v, "planes")?.iter().map(|p| plane_of(n, p)).collect::<Result<Vec<_>, _>>()?;
    let fix = match v.get("fix") {
        None | Some(Value::Null) => None,
        Some(f) => Some(fix_of(n, f)?),
    };
    let mut out = String::new();
    json::opt_string(&mut out, own_ship_hex(&planes, fix.as_ref()));
    Ok(out)
}

/// `closest_approach`: {"in_min", "nm", "above_ft"} or null, from `{"own":
/// fix, "plane": plane}`.
pub(super) fn closest_approach_rule(v: &Value) -> Result<String, String> {
    let n = "closest_approach";
    let own = fix_of(n, v.get("own").ok_or("closest_approach: \"own\" is missing")?)?;
    let plane = plane_of(n, v.get("plane").ok_or("closest_approach: \"plane\" is missing")?)?;
    Ok(match closest_approach(&own, &plane) {
        None => "null".to_owned(),
        Some((in_min, nm, above)) => {
            let mut out = String::from("{\"in_min\":");
            json::number(&mut out, in_min);
            out.push_str(",\"nm\":");
            json::number(&mut out, nm);
            out.push_str(",\"above_ft\":");
            json::opt_number(&mut out, above);
            out.push('}');
            out
        }
    })
}
