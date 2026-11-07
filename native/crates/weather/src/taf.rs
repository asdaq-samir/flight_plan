//! TAFs as sent -- what a phone gets from FIS-B with no internet -- read
//! into the periods the planner reads from the AWC's decoded feed
//! (wingtip.weather's `_parse_tafs`): each period's start and end, its change
//! group (FM, TEMPO, BECMG, PROB), wind, visibility, ceiling and weather.
//! The groups are AC 00-45H's TAF and WMO No. 306's (INTER, used outside
//! the US, is a TEMPO). tests/test_parsers.py holds the reader to the
//! AWC's own decoding of every TAF in its cache and lists where they
//! differ.

use crate::metar::{self, Layer, Wind};
use crate::{json, time};

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Period {
    pub from: i64,
    pub to: i64,
    /// "" for the forecast's first part, else FM, TEMPO, BECMG or PROB.
    pub change: String,
    pub probability: Option<u32>,
    pub wind: Option<Wind>,
    pub visibility_sm: Option<f64>,
    pub layers: Vec<Layer>,
    pub weather: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Taf {
    pub station: String,
    pub issued: i64,
    pub valid_from: i64,
    pub valid_to: i64,
    pub periods: Vec<Period>,
}

impl Period {
    /// The period's ceiling (metar::sky_ceiling, 14 CFR 1.1), None where
    /// there is none or it is not known (ceiling_unknown tells them apart).
    pub fn ceiling_ft(&self) -> Option<f64> {
        metar::sky_ceiling(&self.layers).0
    }

    /// The lowest broken, overcast or obscured layer forecast with no
    /// height ("OVC///", "VV///"): the ceiling is not known, not absent.
    pub fn ceiling_unknown(&self) -> bool {
        metar::sky_ceiling(&self.layers).1
    }
}

fn digits(s: &str, n: usize) -> bool {
    s.len() == n && s.bytes().all(|b| b.is_ascii_digit())
}

/// "0212/0312": two day-and-hour times near `near`.
fn window(w: &str, near: i64) -> Option<(i64, i64)> {
    let (a, b) = w.split_once('/')?;
    if !digits(a, 4) || !digits(b, 4) {
        return None;
    }
    let at = |s: &str| time::nearest_day(near, s[..2].parse().ok()?, s[2..].parse().ok()?, 0);
    let (from, mut to) = (at(a)?, at(b)?);
    // A window running past the month's end: its end the month after.
    if to < from {
        to = time::nearest_day(from + 20 * time::DAY_S, b[..2].parse().ok()?, b[2..].parse().ok()?, 0)?;
    }
    Some((from, to))
}

fn weather_of(p: &mut Period, words: &[&str]) {
    let mut i = 0;
    while i < words.len() {
        let w = words[i];
        i += 1;
        if !w.is_ascii() {
            continue;
        }
        if p.wind.is_none() && metar::wind(w).is_some() {
            p.wind = metar::wind(w);
        } else if w == "CAVOK" {
            // 10 km or more, no cloud below 5,000 ft and no weather that
            // matters (WMO No. 306): the AWC writes its weather NSW.
            p.visibility_sm = Some(6.0);
            p.weather = vec!["NSW".to_string()];
        } else if p.visibility_sm.is_none() && w.len() == 1 && w.as_bytes()[0].is_ascii_digit()
            && words.get(i).is_some_and(|n| n.contains('/') && n.ends_with("SM"))
        {
            p.visibility_sm = metar::statute_miles(words[i], w.parse().ok()).map(|(v, _)| v);
            i += 1;
        } else if p.visibility_sm.is_none() && w.ends_with("SM") {
            p.visibility_sm = metar::statute_miles(w, None).map(|(v, _)| v);
        } else if p.visibility_sm.is_none() && digits(w, 4) {
            let metres: f64 = w.parse().unwrap();
            p.visibility_sm = Some(if metres >= 9999.0 { 6.0 } else { metres / 1609.344 });
        } else if w == "NSW" {
            p.weather.push(w.to_string());
        } else if let Some(cover) = sky(w) {
            p.layers.extend(cover);
        } else if metar::is_weather(w) {
            p.weather.push(w.to_string());
        }
    }
}

fn sky(w: &str) -> Option<Option<Layer>> {
    if !w.is_ascii() {
        return None;
    }
    if matches!(w, "SKC" | "CLR" | "NSC") {
        return Some(None);
    }
    let (cover, rest) = if let Some(r) = w.strip_prefix("VV") {
        ("VV", r)
    } else if w.len() >= 6 && ["FEW", "SCT", "BKN", "OVC"].contains(&&w[..3]) {
        (&w[..3], &w[3..])
    } else {
        return None;
    };
    let height = rest.get(..3)?;
    if !(rest.len() == 3 || matches!(&rest[3..], "CB" | "TCU")) {
        return None;
    }
    let base = if height == "///" { None } else { Some(height.parse::<f64>().ok()? * 100.0) };
    Some(Some(Layer { cover: cover.to_string(), base_ft_agl: base }))
}

/// A TAF as sent, its day-and-hour times placed in the month nearest
/// `near` (Unix seconds; the time it is read). None where its station or
/// times cannot be read.
pub fn parse(raw: &str, near: i64) -> Option<Taf> {
    let words: Vec<&str> = raw.split_whitespace().filter(|w| *w != "=").map(|w| w.trim_end_matches('=')).collect();
    let mut i = 0;
    if words.first() == Some(&"TAF") {
        i += 1;
    }
    while matches!(words.get(i), Some(&"AMD" | &"COR")) {
        i += 1;
    }
    let station = *words.get(i)?;
    if !(station.len() == 4 && station.bytes().all(|b| b.is_ascii_alphanumeric())) {
        return None;
    }
    i += 1;
    // The Navy writes AMD after the station, and may leave the issue time out.
    while matches!(words.get(i), Some(&"AMD" | &"COR")) {
        i += 1;
    }
    let issued = match words.get(i).and_then(|w| w.strip_suffix('Z')).filter(|t| digits(t, 6)) {
        Some(t) => {
            i += 1;
            time::nearest_day(near, t[..2].parse().ok()?, t[2..4].parse().ok()?, t[4..].parse().ok()?)?
        }
        None => near,
    };
    let (valid_from, valid_to) = window(words.get(i)?, issued)?;
    i += 1;
    // The groups: the first part, then each FM, TEMPO, BECMG, PROB or INTER.
    let mut groups: Vec<(Period, Vec<&str>)> = vec![(Period { from: valid_from, to: valid_to, ..Default::default() }, vec![])];
    while i < words.len() {
        let w = words[i];
        i += 1;
        if w == "RMK" {
            break;
        }
        if let Some(t) = w.strip_prefix("FM").filter(|t| digits(t, 6)) {
            let from = time::nearest_day(issued, t[..2].parse().ok()?, t[2..4].parse().ok()?, t[4..].parse().ok()?)?;
            groups.push((Period { from, to: valid_to, change: "FM".into(), ..Default::default() }, vec![]));
            continue;
        }
        let probability = w.strip_prefix("PROB").and_then(|p| p.parse::<u32>().ok());
        if probability.is_some() || matches!(w, "TEMPO" | "BECMG" | "INTER") {
            let mut change = match w {
                "BECMG" => "BECMG",
                "TEMPO" | "INTER" => "TEMPO",
                _ => "PROB",
            };
            if probability.is_some() && matches!(words.get(i), Some(&"TEMPO" | &"INTER")) {
                change = "TEMPO";
                i += 1;
            }
            let Some((from, to)) = words.get(i).and_then(|t| window(t, issued)) else { continue };
            i += 1;
            groups.push((Period { from, to, change: change.into(), probability, ..Default::default() }, vec![]));
            continue;
        }
        groups.last_mut().unwrap().1.push(w);
    }
    // The prevailing forecast -- the first part, each FM, each BECMG --
    // holds until the next of them begins (AC 00-45H's TAF: a BECMG's
    // change lasts once made), and a BECMG keeps what it does not change;
    // a TEMPO or PROB is for its own hours. A first part a BECMG begins
    // at once has no hours of its own and is left out, as the AWC leaves it.
    let starts: Vec<i64> = groups.iter().filter(|(p, _)| matches!(p.change.as_str(), "FM" | "BECMG")).map(|(p, _)| p.from).collect();
    let mut periods: Vec<Period> = Vec::new();
    let mut prevailing: Option<Period> = None;
    for (mut p, words) in groups {
        let lasting = matches!(p.change.as_str(), "" | "FM" | "BECMG");
        if lasting {
            p.to = starts.iter().copied().filter(|&s| s > p.from).min().unwrap_or(valid_to);
        }
        weather_of(&mut p, &words);
        if p.change == "BECMG" {
            if let Some(before) = &prevailing {
                p.wind = p.wind.or(before.wind);
                p.visibility_sm = p.visibility_sm.or(before.visibility_sm);
                if p.layers.is_empty() && !words.iter().any(|w| matches!(*w, "SKC" | "CLR" | "NSC" | "CAVOK")) {
                    p.layers = before.layers.clone();
                }
                if p.weather.is_empty() {
                    p.weather = before.weather.clone();
                }
            }
        }
        if lasting {
            prevailing = Some(p.clone());
        }
        if p.change.is_empty() && p.to <= p.from {
            continue;
        }
        periods.push(p);
    }
    Some(Taf { station: station.to_string(), issued, valid_from, valid_to, periods })
}

/// The periods as wingtip.weather's `fcsts`, JSON.
pub fn to_json(t: &Taf) -> String {
    let mut out = String::from("{\"station\":");
    json::string(&mut out, &t.station);
    out.push_str(&format!(",\"issued\":{},\"valid_from\":{},\"valid_to\":{},\"fcsts\":[", t.issued, t.valid_from, t.valid_to));
    for (k, p) in t.periods.iter().enumerate() {
        if k > 0 {
            out.push(',');
        }
        out.push_str(&format!("{{\"timeFrom\":{},\"timeTo\":{},\"change\":", p.from, p.to));
        json::string(&mut out, &p.change);
        out.push_str(",\"probability\":");
        json::opt_number(&mut out, p.probability.map(f64::from));
        out.push_str(",\"wind_dir_true_deg\":");
        json::opt_number(&mut out, p.wind.and_then(|w| w.dir_true_deg));
        out.push_str(",\"wind_speed_kt\":");
        json::opt_number(&mut out, p.wind.map(|w| w.speed_kt));
        out.push_str(",\"wind_gust_kt\":");
        json::opt_number(&mut out, p.wind.and_then(|w| w.gust_kt));
        out.push_str(",\"visibility_sm\":");
        json::opt_number(&mut out, p.visibility_sm);
        out.push_str(",\"ceiling_ft\":");
        json::opt_number(&mut out, p.ceiling_ft());
        out.push_str(",\"ceiling_unknown\":");
        out.push_str(if p.ceiling_unknown() { "true" } else { "false" });
        out.push_str(",\"wx\":");
        json::string(&mut out, &p.weather.join(" "));
        out.push('}');
    }
    out.push_str("]}");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_us_taf() {
        let near = time::days_from_civil(2026, 11, 2) * time::DAY_S + 12 * 3600;
        let t = parse("TAF KDLH 021120Z 0212/0312 27012KT P6SM BKN040 FM021800 30015G25KT 5SM -SN OVC025 TEMPO 0222/0302 2SM SN BKN012 PROB30 0304/0308 1/2SM FG VV002", near).unwrap();
        let day = time::days_from_civil(2026, 11, 2) * time::DAY_S;
        assert_eq!((t.valid_from, t.valid_to), (day + 12 * 3600, day + 36 * 3600));
        assert_eq!(t.periods.len(), 4);
        assert_eq!((t.periods[0].to, t.periods[0].ceiling_ft()), (day + 18 * 3600, Some(4000.0)));
        assert_eq!((t.periods[1].change.as_str(), t.periods[1].to), ("FM", day + 36 * 3600));
        assert_eq!((t.periods[2].change.as_str(), t.periods[2].visibility_sm, t.periods[2].ceiling_ft()), ("TEMPO", Some(2.0), Some(1200.0)));
        assert_eq!((t.periods[3].change.as_str(), t.periods[3].probability, t.periods[3].ceiling_ft()), ("PROB", Some(30), Some(200.0)));
        assert!(t.periods.iter().all(|p| !p.ceiling_unknown()));
    }

    #[test]
    fn an_overcast_of_no_height_is_a_ceiling_not_known() {
        let near = time::days_from_civil(2026, 11, 2) * time::DAY_S + 12 * 3600;
        let t = parse("TAF KXYZ 021120Z 0212/0312 27012KT P6SM OVC/// FM021800 30015KT P6SM SCT040 BKN///", near).unwrap();
        assert_eq!((t.periods[0].ceiling_ft(), t.periods[0].ceiling_unknown()), (None, true));
        assert!(to_json(&t).contains("\"ceiling_unknown\":true"));
        // Above a scattered layer of known height it is still the ceiling, and not known.
        assert_eq!((t.periods[1].ceiling_ft(), t.periods[1].ceiling_unknown()), (None, true));
    }
}
