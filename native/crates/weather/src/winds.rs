//! The FB winds and temperatures aloft as sent (the NWS's "FD" text), as
//! wingtip.weather's `parse_fd_text` reads it: each station's wind and
//! temperature at each altitude, and the window the product is for use
//! in. The coding is AC 00-45H's Winds and Temperatures Aloft Forecast:
//! DDFF wind (tens of degrees true, knots; 50 added to the direction for
//! 100 kt and more; 9900 light and variable), a signed temperature to
//! 24,000 ft and an unsigned, negative one above. tests/test_parsers.py
//! holds the two readers to the same answer on the current products.

use crate::{json, time};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Group {
    /// None where light and variable (9900).
    pub dir_true_deg: Option<f64>,
    pub speed_kt: f64,
    pub temp_c: Option<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Period {
    pub valid_at: i64,
    pub use_from: i64,
    pub use_to: i64,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Product {
    pub period: Option<Period>,
    /// Each station's groups by altitude, in the product's order.
    pub stations: Vec<(String, Vec<(u32, Group)>)>,
}

fn decode_wind(g: &str) -> Option<(Option<f64>, f64)> {
    let w = g.get(..4)?;
    if !w.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if w == "9900" {
        return Some((None, 0.0));
    }
    let (dir, speed): (u32, u32) = (w[..2].parse().ok()?, w[2..].parse().ok()?);
    Some(if dir >= 51 {
        (Some(((dir - 50) * 10) as f64), (speed + 100) as f64)
    } else {
        (Some((dir * 10) as f64), speed as f64)
    })
}

fn decode_temp(g: &str) -> Option<f64> {
    let b = g.as_bytes();
    if g.chars().count() == 7 && (b[4] == b'+' || b[4] == b'-') {
        return g.get(4..7)?.parse().ok();
    }
    if g.chars().count() == 6 && g.get(4..6)?.bytes().all(|c| c.is_ascii_digit()) {
        return Some(-g.get(4..6)?.parse::<f64>().ok()?);
    }
    None
}

/// "VALID 021800Z   FOR USE 1400-2100Z": the times, the day's month the
/// one nearest `now`.
fn period(line: &str, now: i64) -> Option<Period> {
    let words: Vec<&str> = line.split_whitespace().collect();
    let at = words.iter().position(|w| *w == "VALID")?;
    let valid = words.get(at + 1)?.strip_suffix('Z')?;
    if words.get(at + 2) != Some(&"FOR") || words.get(at + 3) != Some(&"USE") {
        return None;
    }
    // "1400-2100Z.": the header's sentence runs on after the window.
    let window = words.get(at + 4)?.trim_end_matches(|c: char| !c.is_ascii_alphanumeric()).strip_suffix('Z')?;
    let (a, b) = window.split_once('-')?;
    let ok = |s: &str, n| s.len() == n && s.bytes().all(|c| c.is_ascii_digit());
    if !ok(valid, 6) || !ok(a, 4) || !ok(b, 4) {
        return None;
    }
    let num = |s: &str| s.parse::<u32>().ok();
    let (day, hour, minute) = (num(&valid[..2])?, num(&valid[2..4])?, num(&valid[4..])?);
    if hour > 23 {
        return None;
    }
    let valid_at = time::nearest_day(now, day, hour, minute)?;
    let midnight = valid_at.div_euclid(time::DAY_S) * time::DAY_S;
    let at_hhmm = |s: &str| -> Option<i64> {
        let (h, m) = (num(&s[..2])? % 24, num(&s[2..])?);
        (m < 60).then_some(midnight + h as i64 * 3600 + m as i64 * 60)
    };
    let mut use_from = at_hhmm(a)?;
    if use_from > valid_at {
        use_from -= time::DAY_S;
    }
    let mut use_to = at_hhmm(b)?;
    if use_to < valid_at {
        use_to += time::DAY_S;
    }
    Some(Period { valid_at, use_from, use_to })
}

/// The product, its station rows placed by the header's columns (a group
/// below a station's own height is left out, which shifts the rest: each
/// is matched to the nearest column). None where it has no "FT" header,
/// which is no product.
pub fn parse(text: &str, now: i64) -> Option<Product> {
    let lines: Vec<&str> = text.lines().collect();
    let header = lines.iter().position(|l| l.starts_with("FT "))?;
    let mut columns: Vec<(usize, u32)> = Vec::new();
    let h = lines[header];
    let hb = h.as_bytes();
    let mut i = 0;
    while i < hb.len() {
        if hb[i].is_ascii_digit() {
            let start = i;
            while i < hb.len() && hb[i].is_ascii_digit() {
                i += 1;
            }
            columns.push((start, h[start..i].parse().ok()?));
        } else {
            i += 1;
        }
    }
    let mut product = Product { period: lines[..header].iter().find_map(|l| period(l, now)), ..Default::default() };
    for line in &lines[header + 1..] {
        if line.trim().is_empty() || columns.is_empty() {
            continue;
        }
        let station = line.get(..3.min(line.len())).unwrap_or("").trim();
        if station.is_empty() {
            continue;
        }
        let rest = line.get(3..).unwrap_or("");
        let mut groups: Vec<(u32, &str)> = Vec::new();
        let rb = rest.as_bytes();
        let mut j = 0;
        while j < rb.len() {
            if rb[j].is_ascii_whitespace() {
                j += 1;
                continue;
            }
            let start = j;
            while j < rb.len() && !rb[j].is_ascii_whitespace() {
                j += 1;
            }
            let pos = start + 3;
            let alt = columns.iter().min_by_key(|(p, _)| (*p as i64 - pos as i64).abs()).unwrap().1;
            // A later group at the same column takes its place, as a dict's would.
            match groups.iter_mut().find(|(a, _)| *a == alt) {
                Some(g) => g.1 = &rest[start..j],
                None => groups.push((alt, &rest[start..j])),
            }
        }
        let decoded: Vec<(u32, Group)> = groups
            .into_iter()
            .filter_map(|(alt, g)| decode_wind(g).map(|(dir, speed)| (alt, Group { dir_true_deg: dir, speed_kt: speed, temp_c: decode_temp(g) })))
            .collect();
        if !decoded.is_empty() {
            match product.stations.iter_mut().find(|(s, _)| s == station) {
                Some(s) => s.1 = decoded,
                None => product.stations.push((station.to_string(), decoded)),
            }
        }
    }
    Some(product)
}

/// The product as wingtip.weather's FdStations, JSON: {"period": {...},
/// "stations": {"ABI": {"6000": {...}}}}.
pub fn to_json(p: &Product) -> String {
    let mut out = String::from("{\"period\":");
    match &p.period {
        Some(per) => out.push_str(&format!(
            "{{\"valid_at\":\"{}\",\"use_from\":\"{}\",\"use_to\":\"{}\"}}",
            time::iso(per.valid_at), time::iso(per.use_from), time::iso(per.use_to)
        )),
        None => out.push_str("null"),
    }
    out.push_str(",\"stations\":{");
    for (k, (station, groups)) in p.stations.iter().enumerate() {
        if k > 0 {
            out.push(',');
        }
        json::string(&mut out, station);
        out.push_str(":{");
        for (n, (alt, g)) in groups.iter().enumerate() {
            if n > 0 {
                out.push(',');
            }
            out.push_str(&format!("\"{alt}\":{{\"wind_dir_true_deg\":"));
            json::opt_number(&mut out, g.dir_true_deg);
            out.push_str(",\"wind_speed_kt\":");
            json::number(&mut out, g.speed_kt);
            out.push_str(",\"temp_c\":");
            json::opt_number(&mut out, g.temp_c);
            out.push('}');
        }
        out.push('}');
    }
    out.push_str("}}");
    out
}
