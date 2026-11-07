//! A flown track as a pilot's apps export it -- ForeFlight's, Garmin
//! Pilot's, a GPS's -- read (the web's lib/track, the phone's GPXTrack):
//! GPX's track points, or KML's gx:Track (ForeFlight's track log), each
//! with its time, and its altitude where it has one. GPS altitude, above
//! sea level: not what the altimeter read, and the debrief says so.

use super::opt;
use crate::figures::words::js_round;
use crate::json::{self, Value};
use crate::time::{days_from_civil, days_in_month};
use crate::xml::{self, Element};

/// Feet in a metre (the international foot, 0.3048 m).
pub const FEET_PER_METRE: f64 = 3.28084;
/// The most points a track is kept with: a second-by-second log of two
/// hours is seven thousand.
pub const KEEP_POINTS: usize = 4000;

/// A point of a flown track: `t` ms since 1970, GPS altitude in feet where
/// the file has one.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TrackPoint {
    pub t: f64,
    pub lat: f64,
    pub lon: f64,
    pub alt_ft: Option<f64>,
}

pub const NOT_A_TRACK: &str = "This file is not a GPX or KML track.";
pub const NO_TIMES: &str = "The track's points have no times: export it with them (a GPX track, or ForeFlight's KML track log).";
pub const NO_TRACK: &str = "There is no track in this file.";

/// A number as JavaScript's Number() reads a string: space round it
/// allowed, nothing at all zero, and anything else not a number (NaN).
pub fn js_number(text: &str) -> f64 {
    let t = text.trim();
    if t.is_empty() {
        return 0.0;
    }
    let (sign, body) = match t.as_bytes()[0] {
        b'-' => (-1.0, &t[1..]),
        b'+' => (1.0, &t[1..]),
        _ => (1.0, t),
    };
    if body == "Infinity" {
        return sign * f64::INFINITY;
    }
    // Rust's parse takes "inf" and "nan", which JavaScript does not; a
    // number is digits, a point, and an exponent.
    if !body.bytes().all(|c| c.is_ascii_digit() || b".eE+-".contains(&c)) || !body.bytes().any(|c| c.is_ascii_digit()) {
        return f64::NAN;
    }
    t.parse::<f64>().unwrap_or(f64::NAN)
}

fn digits(s: &str) -> Option<i64> {
    (!s.is_empty() && s.bytes().all(|c| c.is_ascii_digit())).then(|| s.parse().ok()).flatten()
}

/// An ISO 8601 date-time (xsd:dateTime, as GPX and KML write a time), ms
/// since 1970: `YYYY-MM-DD`, then `THH:MM`, `:SS` and a fraction of a
/// second where there are, and `Z` or an offset. GPX 1.1 sets its times in
/// UTC, so one written with no offset is taken as UTC. None where it is not
/// one.
pub fn iso_ms(text: &str) -> Option<f64> {
    let s = text.trim();
    let (date, time) = match s.find(['T', 't', ' ']) {
        Some(i) => (&s[..i], Some(&s[i + 1..])),
        None => (s, None),
    };
    let mut parts = date.split('-');
    let (y, m, d) = (parts.next()?, parts.next(), parts.next());
    if parts.next().is_some() || y.len() != 4 {
        return None;
    }
    let year = digits(y)?;
    let month = m.map_or(Some(1), digits)?;
    let day = d.map_or(Some(1), digits)?;
    if m.is_some_and(|m| m.len() != 2) || d.is_some_and(|d| d.len() != 2) || !(1..=12).contains(&month) {
        return None;
    }
    if day < 1 || day > days_in_month(year, month as u32) as i64 {
        return None;
    }
    let mut ms = days_from_civil(year, month as u32, day as u32) as f64 * 86_400_000.0;
    let Some(time) = time else { return Some(ms) };
    // The offset: Z, or +HH:MM / -HH:MM (or +HHMM) after the clock.
    let (clock, offset_min) = if let Some(c) = time.strip_suffix(['Z', 'z']) {
        (c, 0)
    } else if let Some(i) = time.rfind(['+', '-']) {
        let (c, off) = time.split_at(i);
        let sign = if off.starts_with('-') { -1 } else { 1 };
        let off = off[1..].replace(':', "");
        if off.len() != 4 {
            return None;
        }
        let (h, mm) = (digits(&off[..2])?, digits(&off[2..])?);
        if h > 23 || mm > 59 {
            return None;
        }
        (c, sign * (h * 60 + mm))
    } else {
        (time, 0)
    };
    let mut hms = clock.split(':');
    let (h, mi, sec) = (digits(hms.next()?)?, hms.next().and_then(digits)?, hms.next());
    if hms.next().is_some() || h > 24 || mi > 59 {
        return None;
    }
    let (whole, fraction) = match sec {
        None => (0, 0.0),
        Some(sec) => {
            let (w, f) = sec.split_once('.').unwrap_or((sec, ""));
            if w.len() != 2 || (sec.contains('.') && f.is_empty()) {
                return None;
            }
            let w = digits(w)?;
            if w > 59 {
                return None;
            }
            // The milliseconds, as JavaScript keeps them: the first three
            // figures of the fraction.
            let f = if f.is_empty() {
                0.0
            } else {
                digits(f)?;
                format!("{:0<3}", &f[..f.len().min(3)]).parse::<f64>().ok()?
            };
            (w, f)
        }
    };
    if h == 24 && (mi > 0 || whole > 0 || fraction > 0.0) {
        return None;
    }
    ms += ((h * 3600 + mi * 60 + whole) * 1000) as f64 + fraction - (offset_min * 60_000) as f64;
    Some(ms)
}

fn elevation(text: Option<String>) -> Option<f64> {
    let text = text?;
    if text.trim().is_empty() {
        return None;
    }
    let metres = js_number(&text);
    metres.is_finite().then_some(metres * FEET_PER_METRE)
}

fn first_text(e: &Element, name: &str) -> Option<String> {
    e.iter_named(name).into_iter().find(|c| !std::ptr::eq(*c, e)).map(Element::all_text)
}

fn gpx(root: &Element) -> Vec<TrackPoint> {
    root.iter_named("trkpt")
        .into_iter()
        .map(|el| TrackPoint {
            t: first_text(el, "time").and_then(|t| iso_ms(&t)).unwrap_or(f64::NAN),
            lat: el.attribute("lat").map_or(0.0, js_number),
            lon: el.attribute("lon").map_or(0.0, js_number),
            alt_ft: elevation(first_text(el, "ele")),
        })
        .collect()
}

/// KML's gx:Track: its `when`s and its `gx:coord`s ("lon lat alt"), in
/// step. A plain LineString has no times, and no use here.
fn kml(root: &Element) -> Vec<TrackPoint> {
    let mut points = Vec::new();
    for track in root.iter_named("Track") {
        let coords: Vec<String> = track.iter_named("coord").into_iter().map(Element::all_text).collect();
        for (i, when) in track.iter_named("when").into_iter().enumerate() {
            let figures: Vec<f64> = coords.get(i).map_or("", String::as_str).split_whitespace().map(js_number).collect();
            let alt = figures.get(2).copied().filter(|a| !a.is_nan());
            points.push(TrackPoint {
                t: iso_ms(&when.all_text()).unwrap_or(f64::NAN),
                lat: figures.get(1).copied().unwrap_or(f64::NAN),
                lon: figures.first().copied().unwrap_or(f64::NAN),
                alt_ft: alt.map(|a| a * FEET_PER_METRE),
            });
        }
    }
    points
}

fn valid(p: &TrackPoint) -> bool {
    p.t.is_finite() && p.lat.abs() <= 90.0 && p.lon.abs() <= 180.0 && !(p.lat == 0.0 && p.lon == 0.0)
}

/// A track file's points in time order, the unreadable ones dropped (no
/// time, off the earth, or at 0, 0, a GPS's nothing), one a moment; Err
/// with the words for the pilot where it has none to use.
pub fn read_track(text: &str) -> Result<Vec<TrackPoint>, &'static str> {
    let root = xml::parse(text).map_err(|_| NOT_A_TRACK)?;
    let raw = match root.name.to_lowercase().as_str() {
        "gpx" => gpx(&root),
        "kml" => kml(&root),
        _ => return Err(NOT_A_TRACK),
    };
    let mut points: Vec<TrackPoint> = raw.iter().copied().filter(valid).collect();
    points.sort_by(|a, b| a.t.partial_cmp(&b.t).unwrap_or(std::cmp::Ordering::Equal));
    if points.len() < 2 {
        return Err(if raw.is_empty() { NO_TRACK } else { NO_TIMES });
    }
    points.dedup_by(|later, earlier| later.t <= earlier.t);
    Ok(points)
}

/// Which of `len` points a track thinned to at most `most` keeps, the first
/// and the last among them: even steps through it, which keep its shape at
/// a light airplane's speeds.
pub fn thin(len: usize, most: usize) -> Vec<usize> {
    if len <= most {
        return (0..len).collect();
    }
    let step = (len - 1) as f64 / (most as f64 - 1.0);
    (0..most).map(|i| js_round(i as f64 * step) as usize).collect()
}

/// `read_track`: {"points": [{t, lat, lon, alt_ft}]} or {"error": words},
/// from `{"text"}`, the file's text.
pub(super) fn read_rule(v: &Value) -> Result<String, String> {
    let text = v.get("text").and_then(Value::as_str).ok_or("read_track: \"text\" is missing or not a string")?;
    let mut out = String::new();
    match read_track(text) {
        Err(words) => {
            out.push_str("{\"error\":");
            json::string(&mut out, words);
            out.push('}');
        }
        Ok(points) => {
            out.push_str("{\"points\":[");
            for (i, p) in points.iter().enumerate() {
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
                out.push('}');
            }
            out.push_str("]}");
        }
    }
    Ok(out)
}

/// `thin_track`: the points kept, each as it came, from `{"points",
/// "most"?}` (KEEP_POINTS where not given).
pub(super) fn thin_rule(v: &Value) -> Result<String, String> {
    let points = v.get("points").and_then(Value::as_array).ok_or("thin_track: \"points\" is missing or not a list")?;
    let most = match opt("thin_track", v, "most")? {
        None => KEEP_POINTS,
        Some(m) if m >= 2.0 && m.fract() == 0.0 => m as usize,
        Some(_) => return Err("thin_track: \"most\" is a whole number, 2 or more".to_owned()),
    };
    let kept: Vec<Value> = thin(points.len(), most).into_iter().map(|i| points[i].clone()).collect();
    let mut out = String::new();
    json::value(&mut out, &Value::Array(kept));
    Ok(out)
}
