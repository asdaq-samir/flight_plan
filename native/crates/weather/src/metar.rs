//! METARs and SPECIs as sent -- the raw text a phone gets from ADS-B's
//! FIS-B with no internet -- decoded into the figures the planner reads
//! from the Aviation Weather Center's decoded feed (wingtip.weather's
//! `_parse_metars`): the wind, visibility, ceiling, weather, temperature
//! and dewpoint, altimeter and flight category. The groups are the
//! Federal Meteorological Handbook No. 1's (FMH-1, ch. 12, coding) and
//! WMO No. 306's for the reports from outside the US. tests/test_parsers.py
//! holds the decoder to the AWC's own decoding of every report in its
//! current cache and lists where they differ.

use crate::json;

/// A wind group: "27015G25KT", "VRB03KT", "00000KT", "27015MPS".
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Wind {
    /// None where variable (VRB).
    pub dir_true_deg: Option<f64>,
    pub speed_kt: f64,
    pub gust_kt: Option<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Layer {
    /// FEW, SCT, BKN, OVC, or VV for an obscured sky.
    pub cover: String,
    pub base_ft_agl: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Metar {
    pub station: String,
    pub speci: bool,
    /// Day of the month, hour and minute, UTC ("021400Z").
    pub day: u32,
    pub hour: u32,
    pub minute: u32,
    pub wind: Option<Wind>,
    pub visibility_sm: Option<f64>,
    /// Visibility at or past the most the report says ("P6SM", CAVOK, 9999).
    pub visibility_plus: bool,
    pub layers: Vec<Layer>,
    pub weather: Vec<String>,
    pub temp_c: Option<f64>,
    pub dewpoint_c: Option<f64>,
    pub altimeter_inhg: Option<f64>,
    /// Whether the report gives the sky at all: a layer, clear, or CAVOK.
    pub sky_reported: bool,
}

/// Knots in a metre a second (WMO No. 306's MPS winds): 1 kt = 1852 m/h.
const KT_PER_MPS: f64 = 3600.0 / 1852.0;
/// Statute miles in a metre (5,280 ft of 0.3048 m).
const SM_PER_M: f64 = 1.0 / 1609.344;
/// Inches of mercury in a hectopascal (Q groups): 1 inHg = 33.8639 hPa.
const INHG_PER_HPA: f64 = 1.0 / 33.8639;

pub(crate) fn wind(group: &str) -> Option<Wind> {
    // A report is ASCII; a group that is not is no group (and is not cut
    // inside a character).
    if !group.is_ascii() {
        return None;
    }
    let (body, factor) = if let Some(b) = group.strip_suffix("KT") {
        (b, 1.0)
    } else if let Some(b) = group.strip_suffix("MPS") {
        (b, KT_PER_MPS)
    } else {
        return None;
    };
    if body.len() < 5 {
        return None;
    }
    let (dir, rest) = body.split_at(3);
    let dir_true_deg = match dir {
        "VRB" => None,
        d if d.bytes().all(|b| b.is_ascii_digit()) => Some(d.parse::<f64>().ok()?),
        _ => return None,
    };
    let (speed, gust) = match rest.split_once('G') {
        Some((s, g)) => (s, Some(g)),
        None => (rest, None),
    };
    let num = |s: &str| (!s.is_empty() && s.len() <= 3 && s.bytes().all(|b| b.is_ascii_digit())).then(|| s.parse::<f64>().ok()).flatten();
    let speed_kt = (num(speed)? * factor).round();
    // "000" is calm only with no speed; with one it is no direction at all.
    let dir_true_deg = dir_true_deg.filter(|&d| d != 0.0 || speed_kt == 0.0);
    let gust_kt = match gust {
        Some(g) => Some((num(g)? * factor).round()),
        None => None,
    };
    Some(Wind { dir_true_deg, speed_kt, gust_kt })
}

/// A visibility in statute miles from "10SM", "1/2SM", "M1/4SM", "P6SM"
/// (with the whole miles of "1 1/2SM" given as `whole`): the value and
/// whether it is "at least".
pub(crate) fn statute_miles(group: &str, whole: Option<f64>) -> Option<(f64, bool)> {
    let body = group.strip_suffix("SM")?;
    let (body, plus) = match body.strip_prefix('P') {
        Some(b) => (b, true),
        None => (body.strip_prefix('M').unwrap_or(body), false),
    };
    let value = match body.split_once('/') {
        Some((n, d)) => {
            let (n, d): (f64, f64) = (n.parse().ok()?, d.parse().ok()?);
            if d == 0.0 {
                return None;
            }
            n / d
        }
        None => body.parse().ok()?,
    };
    Some((value + whole.unwrap_or(0.0), plus))
}

/// A sky group: "BKN012", "OVC250CB", "VV002", "SKC", "CLR", "NSC".
fn layer(group: &str) -> Option<Option<Layer>> {
    if !group.is_ascii() {
        return None;
    }
    if matches!(group, "SKC" | "CLR" | "NSC" | "NCD") {
        return Some(None);
    }
    let (cover, rest) = if let Some(r) = group.strip_prefix("VV") {
        ("VV", r)
    } else if group.len() >= 6 && ["FEW", "SCT", "BKN", "OVC"].contains(&&group[..3]) {
        (&group[..3], &group[3..])
    } else {
        return None;
    };
    let height = rest.get(..3)?;
    let tail = &rest[3..];
    if !(tail.is_empty() || tail == "CB" || tail == "TCU" || tail == "///") {
        return None;
    }
    let base_ft_agl = if height == "///" { None } else { Some(height.parse::<f64>().ok()? * 100.0) };
    Some(Some(Layer { cover: cover.to_string(), base_ft_agl }))
}

const DESCRIPTORS: [&str; 8] = ["MI", "PR", "BC", "DR", "BL", "SH", "TS", "FZ"];
const PHENOMENA: [&str; 22] = [
    "DZ", "RA", "SN", "SG", "IC", "PL", "GR", "GS", "UP", "BR", "FG", "FU", "VA", "DU", "SA", "HZ", "PY", "PO", "SQ", "FC", "SS", "DS",
];

/// A present-weather group (FMH-1 ch. 12, present weather): an intensity or VC, then
/// descriptors and phenomena two letters at a time.
pub(crate) fn is_weather(group: &str) -> bool {
    let g = group.strip_prefix(['+', '-']).unwrap_or(group);
    let g = g.strip_prefix("VC").unwrap_or(g);
    if g.is_empty() || g.len() % 2 != 0 || !g.is_ascii() {
        return false;
    }
    let pairs: Vec<&str> = (0..g.len()).step_by(2).map(|i| &g[i..i + 2]).collect();
    let mut seen_phenomenon = false;
    for (i, p) in pairs.iter().enumerate() {
        if PHENOMENA.contains(p) {
            seen_phenomenon = true;
        } else if !(DESCRIPTORS.contains(p) && !seen_phenomenon) {
            return false;
        }
        // "TS" or "SH" alone is weather; any other lone descriptor is not.
        if i == pairs.len() - 1 && !seen_phenomenon && !matches!(*p, "TS" | "SH") {
            return false;
        }
    }
    true
}

fn temperature(t: &str) -> Option<f64> {
    if t.is_empty() {
        return None;
    }
    let (sign, digits) = match t.strip_prefix('M') {
        Some(d) => (-1.0, d),
        None => (1.0, t),
    };
    (digits.len() == 2 && digits.bytes().all(|b| b.is_ascii_digit())).then(|| sign * digits.parse::<f64>().unwrap())
}

/// The remarks' tenths of a degree: "T00561033" is 5.6 over -3.3 (FMH-1
/// ch. 12, the hourly temperature and dewpoint remark), a stray ";" or
/// "$" after it aside.
fn tenths(group: &str) -> Option<(f64, Option<f64>)> {
    let g = group.trim_end_matches([';', '$', '=']).strip_prefix('T')?;
    if !(g.len() == 4 || g.len() == 8) || !g.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let read = |s: &str| {
        let v = s[1..].parse::<f64>().unwrap() / 10.0;
        if &s[..1] == "1" { -v } else { v }
    };
    Some((read(&g[..4]), (g.len() == 8).then(|| read(&g[4..]))))
}

/// The flight category as the AWC sets it from the ceiling and the
/// visibility (AC 00-45H's flight categories): LIFR under 500 ft or
/// under a mile; IFR under 1,000 or under 3; MVFR up to 3,000 or up to
/// 5; else VFR. None where neither is reported.
pub fn flight_category(ceiling_ft: Option<f64>, visibility_sm: Option<f64>) -> Option<&'static str> {
    if ceiling_ft.is_none() && visibility_sm.is_none() {
        return None;
    }
    let c = ceiling_ft.unwrap_or(f64::INFINITY);
    let v = visibility_sm.unwrap_or(f64::INFINITY);
    Some(if c < 500.0 || v < 1.0 {
        "LIFR"
    } else if c < 1000.0 || v < 3.0 {
        "IFR"
    } else if c <= 3000.0 || v <= 5.0 {
        "MVFR"
    } else {
        "VFR"
    })
}

/// The ceiling of a report's sky, ft above the ground, and whether it is
/// not known: the lowest broken, overcast or obscured layer -- FEW and SCT
/// are no ceiling (14 CFR 1.1, "ceiling": "the height above the earth's
/// surface of the lowest layer of clouds or obscuring phenomena that is
/// reported as 'broken', 'overcast', or 'obscuration'") -- each layer
/// (cover, base), lowest first as reports list them (FMH-1 ch. 9). An
/// obscured sky is a ceiling at its vertical visibility: a raw report
/// writes it VV002, the AWC's feed marks the layer OVX with its height as
/// the base in a METAR and gives it only as `vertical_visibility_ft` in a
/// TAF. Counting BKN and OVC alone left fog at the surface, the lowest
/// ceiling there is, as none at all.
///
/// The lowest such layer sent with no height ("BKN///", "OVC///",
/// "VV///": an automated station's sensor could not measure it, FMH-1
/// ch. 9; the AWC's data API sends the layer with no base) leaves the
/// ceiling not known, not absent: (None, true). One with no height above
/// a measured ceiling leaves it known. A vertical visibility given apart
/// is the obscuration from the surface, under every layer, so it settles
/// the ceiling.
pub fn sky_ceiling_of<'a>(layers: impl IntoIterator<Item = (&'a str, Option<f64>)>, vertical_visibility_ft: Option<f64>) -> (Option<f64>, bool) {
    let mut ceilings = layers.into_iter().filter(|(cover, _)| matches!(*cover, "BKN" | "OVC" | "OVX" | "VV")).peekable();
    if vertical_visibility_ft.is_none() && ceilings.peek().is_some_and(|(_, base)| base.is_none()) {
        return (None, true);
    }
    let lowest = ceilings
        .filter_map(|(_, base)| base)
        .chain(vertical_visibility_ft)
        .fold(None, |m: Option<f64>, b| Some(m.map_or(b, |m| m.min(b))));
    (lowest, false)
}

/// The ceiling (sky_ceiling_of), None where there is none or it is not
/// known.
pub fn ceiling_of<'a>(layers: impl IntoIterator<Item = (&'a str, Option<f64>)>, vertical_visibility_ft: Option<f64>) -> Option<f64> {
    sky_ceiling_of(layers, vertical_visibility_ft).0
}

/// A report's layers' ceiling and whether it is not known (sky_ceiling_of).
pub fn sky_ceiling(layers: &[Layer]) -> (Option<f64>, bool) {
    sky_ceiling_of(layers.iter().map(|l| (l.cover.as_str(), l.base_ft_agl)), None)
}

/// The flight category where the ceiling may not be known: with a
/// ceiling of no height reported it could be at any height, so only a
/// visibility under a mile -- LIFR whatever the ceiling -- says it;
/// anything better is a guess, and VFR from it would call a sky that may
/// be on the ground good (the audit, 2026-11-06). None then.
pub fn flight_category_of(ceiling_ft: Option<f64>, ceiling_unknown: bool, visibility_sm: Option<f64>) -> Option<&'static str> {
    if ceiling_unknown {
        return visibility_sm.is_some_and(|v| v < 1.0).then_some("LIFR");
    }
    flight_category(ceiling_ft, visibility_sm)
}

/// A visibility in metres (WMO No. 306) in statute miles, as US reports
/// give it: 9999 is "10 km or more", which the AWC writes 6+.
pub fn metres_to_sm(metres: f64) -> f64 {
    if metres >= 9999.0 {
        6.0
    } else {
        metres * SM_PER_M
    }
}

impl Metar {
    /// The ceiling (sky_ceiling), None where there is none or it is not
    /// known (ceiling_unknown tells them apart).
    pub fn ceiling_ft(&self) -> Option<f64> {
        sky_ceiling(&self.layers).0
    }

    /// A broken, overcast or obscured layer is the lowest and was sent
    /// with no height: the ceiling is not known, not absent.
    pub fn ceiling_unknown(&self) -> bool {
        sky_ceiling(&self.layers).1
    }
}

/// A report as sent, "METAR KDLH 021355Z ... RMK ...". None where the
/// station and time cannot be read; groups it does not know are passed
/// over, as the AWC passes them over.
pub fn parse(raw: &str) -> Option<Metar> {
    let mut words = raw.split_whitespace().peekable();
    let mut m = Metar::default();
    match words.peek().copied() {
        Some("METAR") => {
            words.next();
        }
        Some("SPECI") => {
            m.speci = true;
            words.next();
        }
        _ => {}
    }
    let station = words.next()?;
    if !(station.len() == 4 && station.bytes().all(|b| b.is_ascii_alphanumeric())) {
        return None;
    }
    m.station = station.to_string();
    let time = words.next()?.strip_suffix('Z')?;
    if time.len() != 6 || !time.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    (m.day, m.hour, m.minute) = (time[..2].parse().ok()?, time[2..4].parse().ok()?, time[4..].parse().ok()?);
    let words: Vec<&str> = words.collect();
    let mut i = 0;
    let mut remarks = false;
    let mut inches = false;
    while i < words.len() {
        let w = words[i];
        i += 1;
        if !w.is_ascii() {
            continue;
        }
        // The tenths remark wherever it is: a report with "RMK" mistyped
        // ("RMAO2") still carries it.
        if let Some((t, d)) = tenths(w).filter(|_| remarks || w.len() >= 5) {
            m.temp_c = Some(t);
            if d.is_some() {
                m.dewpoint_c = d;
            }
            continue;
        }
        if remarks {
            continue;
        }
        match w {
            "RMK" => remarks = true,
            "AUTO" | "COR" | "NOSIG" | "BECMG" | "TEMPO" => {
                // The trend that follows is a forecast, not the report.
                if matches!(w, "BECMG" | "TEMPO") {
                    while i < words.len() && words[i] != "RMK" {
                        i += 1;
                    }
                }
            }
            "CAVOK" => {
                // Ceiling and visibility OK: 10 km or more, no cloud below
                // 5,000 ft (WMO No. 306): the AWC writes it 6+.
                m.visibility_sm = Some(6.0);
                m.visibility_plus = true;
                m.sky_reported = true;
            }
            // Kilometres, as some states report ten or more ("18KM").
            _ if m.visibility_sm.is_none() && w.len() > 2 && w.ends_with("KM") && w[..w.len() - 2].bytes().all(|b| b.is_ascii_digit()) => {
                m.visibility_sm = Some(w[..w.len() - 2].parse::<f64>().unwrap() * 1000.0 * SM_PER_M);
            }
            _ if m.wind.is_none() && m.visibility_sm.is_none() && wind(w).is_some() => m.wind = wind(w),
            // A variable direction "250V310" says nothing the figures carry.
            _ if w.len() == 7 && w.as_bytes()[3] == b'V' && w.bytes().filter(u8::is_ascii_digit).count() == 6 => {}
            _ if m.visibility_sm.is_none() && w.len() == 1 && w.as_bytes()[0].is_ascii_digit()
                && words.get(i).is_some_and(|n| n.contains('/') && n.ends_with("SM")) =>
            {
                let whole = w.parse::<f64>().ok();
                m.visibility_sm = statute_miles(words[i], whole).map(|(v, _)| v);
                i += 1;
            }
            _ if m.visibility_sm.is_none() && w.ends_with("SM") => {
                if let Some((v, plus)) = statute_miles(w, None) {
                    m.visibility_sm = Some(v);
                    m.visibility_plus = plus;
                }
            }
            // Metres (WMO No. 306): 9999 is 10 km or more.
            _ if m.visibility_sm.is_none() && w.len() == 4 && w.bytes().all(|b| b.is_ascii_digit()) => {
                let metres: f64 = w.parse().unwrap();
                m.visibility_sm = Some(metres_to_sm(metres));
                m.visibility_plus = metres >= 9999.0;
            }
            _ if w.starts_with('R') && w.contains('/') && w.len() > 4 => {} // runway visual range
            _ if layer(w).is_some() => {
                m.sky_reported = true;
                m.layers.extend(layer(w).unwrap());
            }
            _ if is_weather(w) => m.weather.push(w.to_string()),
            _ if w.len() >= 3 && w.contains('/') && !w.contains("SM") => {
                let (t, d) = w.split_once('/').unwrap();
                // The dewpoint a temperature, or missing ("29/", "29//"):
                // anything else run on to it is no temperature group.
                let dew_ok = d.is_empty() || d.bytes().all(|b| b == b'/') || temperature(d).is_some();
                if let Some(t) = temperature(t).filter(|_| dew_ok) {
                    m.temp_c = Some(t);
                    m.dewpoint_c = temperature(d);
                }
            }
            // The inches group where there is one: the setting itself, to a
            // hundredth; a Q group's hectopascals only where there is not.
            _ if w.len() == 5 && w.starts_with('A') && w[1..].bytes().all(|b| b.is_ascii_digit()) => {
                m.altimeter_inhg = Some(w[1..].parse::<f64>().unwrap() / 100.0);
                inches = true;
            }
            _ if w.len() == 5 && w.starts_with('Q') && w[1..].bytes().all(|b| b.is_ascii_digit()) => {
                if !inches {
                    m.altimeter_inhg = Some((w[1..].parse::<f64>().unwrap() * INHG_PER_HPA * 100.0).round() / 100.0);
                }
            }
            _ => {}
        }
    }
    Some(m)
}

/// The figures the planner keeps of a report, as JSON with
/// wingtip.weather's names.
pub fn to_json(m: &Metar) -> String {
    let mut out = String::from("{\"station\":");
    json::string(&mut out, &m.station);
    out.push_str(",\"speci\":");
    out.push_str(if m.speci { "true" } else { "false" });
    out.push_str(",\"wind_dir_true_deg\":");
    json::opt_number(&mut out, m.wind.and_then(|w| w.dir_true_deg));
    out.push_str(",\"wind_speed_kt\":");
    json::opt_number(&mut out, m.wind.map(|w| w.speed_kt));
    out.push_str(",\"wind_gust_kt\":");
    json::opt_number(&mut out, m.wind.and_then(|w| w.gust_kt));
    out.push_str(",\"visibility_sm\":");
    json::opt_number(&mut out, m.visibility_sm);
    out.push_str(",\"ceiling_ft\":");
    json::opt_number(&mut out, m.ceiling_ft());
    out.push_str(",\"ceiling_unknown\":");
    out.push_str(if m.ceiling_unknown() { "true" } else { "false" });
    out.push_str(",\"wx\":");
    json::string(&mut out, &m.weather.join(" "));
    out.push_str(",\"temp_c\":");
    json::opt_number(&mut out, m.temp_c);
    out.push_str(",\"dewpoint_c\":");
    json::opt_number(&mut out, m.dewpoint_c);
    out.push_str(",\"altimeter_in_hg\":");
    json::opt_number(&mut out, m.altimeter_inhg);
    out.push_str(",\"flight_category\":");
    // With no sky or no visibility given, the category is not known.
    let known = m.sky_reported && m.visibility_sm.is_some();
    json::opt_string(&mut out, if known { flight_category_of(m.ceiling_ft(), m.ceiling_unknown(), m.visibility_sm) } else { None });
    out.push('}');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_ceiling_layer_with_no_height_is_a_ceiling_not_known() {
        // 10 SM under an overcast of no height: not VFR, not known (14 CFR 1.1).
        let m = parse("METAR KXYZ 021355Z AUTO 27005KT 10SM OVC/// 10/05 A2992 RMK AO2").unwrap();
        assert_eq!((m.ceiling_ft(), m.ceiling_unknown()), (None, true));
        assert_eq!(flight_category_of(m.ceiling_ft(), m.ceiling_unknown(), m.visibility_sm), None);
        assert!(to_json(&m).contains("\"ceiling_unknown\":true,") && to_json(&m).contains("\"flight_category\":null"));
        for sky in ["BKN///", "VV///"] {
            let m = parse(&format!("METAR KXYZ 021355Z AUTO 27005KT 10SM {sky} 10/05 A2992")).unwrap();
            assert!(m.ceiling_unknown(), "{sky}");
        }
        // Under a mile it is LIFR whatever the ceiling.
        let m = parse("METAR KXYZ 021355Z AUTO 00000KT 1/4SM FG VV/// 10/10 A2992").unwrap();
        assert_eq!(flight_category_of(m.ceiling_ft(), m.ceiling_unknown(), m.visibility_sm), Some("LIFR"));
        // One with no height above a measured ceiling leaves it known.
        let m = parse("METAR KXYZ 021355Z AUTO 27005KT 10SM BKN008 OVC/// 10/05 A2992").unwrap();
        assert_eq!((m.ceiling_ft(), m.ceiling_unknown()), (Some(800.0), false));
        assert_eq!(flight_category_of(m.ceiling_ft(), m.ceiling_unknown(), m.visibility_sm), Some("IFR"));
        // A few or scattered of no height is no ceiling either way.
        let m = parse("METAR KXYZ 021355Z AUTO 27005KT 10SM FEW/// 10/05 A2992").unwrap();
        assert_eq!((m.ceiling_ft(), m.ceiling_unknown()), (None, false));
        assert_eq!(flight_category_of(m.ceiling_ft(), m.ceiling_unknown(), m.visibility_sm), Some("VFR"));
    }

    #[test]
    fn a_us_report() {
        let m = parse("METAR KDLH 021355Z 27015G25KT 1 1/2SM -RA BR BKN008 OVC015 M02/M04 A2992 RMK AO2 T10171039").unwrap();
        assert_eq!(m.wind, Some(Wind { dir_true_deg: Some(270.0), speed_kt: 15.0, gust_kt: Some(25.0) }));
        assert_eq!(m.visibility_sm, Some(1.5));
        assert_eq!(m.weather, ["-RA", "BR"]);
        assert_eq!(m.ceiling_ft(), Some(800.0));
        assert_eq!((m.temp_c, m.dewpoint_c), (Some(-1.7), Some(-3.9)));
        assert_eq!(m.altimeter_inhg, Some(29.92));
        assert_eq!(flight_category(m.ceiling_ft(), m.visibility_sm), Some("IFR"));
    }

    #[test]
    fn a_report_from_outside_the_us() {
        let m = parse("METAR SBVT 021400Z 05009KT 5000 BR SCT004 OVC013 25/24 Q1016").unwrap();
        assert!((m.visibility_sm.unwrap() - 3.107).abs() < 0.001);
        assert!((m.altimeter_inhg.unwrap() - 30.00).abs() < 0.005);
        assert_eq!(m.ceiling_ft(), Some(1300.0));
    }

    #[test]
    fn nothing_from_a_line_that_is_no_report() {
        for bad in ["", "METAR", "METAR KDLH", "METAR KDLH 0213Z", "hello world 021355Z"] {
            assert!(parse(bad).is_none(), "{bad}");
        }
    }
}
