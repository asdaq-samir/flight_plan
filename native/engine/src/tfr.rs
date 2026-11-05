//! A TFR's XNOTAM detail file from tfr.faa.gov (detail_X_NNNN.xml), read
//! for what a pilot needs, as wingtip.tfr's `parse_detail` reads it: when it
//! is in effect, the rule it is issued under, its purpose, and its lowest
//! floor and highest ceiling over its areas. tests/test_parsers.py holds
//! the two to the same answer on every TFR the FAA lists.

use crate::{json, xml};

/// The rules a TFR is issued under (14 CFR part 91 and 99, and 49 USC
/// 44812 for drones), as wingtip.tfr names them.
const RULES: [(&str, &str); 11] = [
    ("91.137(a)(1)", "disaster or hazard (91.137(a)(1))"),
    ("91.137(a)(2)", "relief aircraft operations (91.137(a)(2))"),
    ("91.137(a)(3)", "sightseeing congestion over an incident or event (91.137(a)(3))"),
    ("91.138", "national disaster in Hawaii (91.138)"),
    ("91.139", "emergency air traffic rules (91.139)"),
    ("91.141", "VIP movement (91.141)"),
    ("91.143", "space operations (91.143)"),
    ("91.144", "high barometric pressure (91.144)"),
    ("91.145", "aerial demonstration or sporting event (91.145)"),
    ("99.7", "special security instructions (99.7)"),
    ("44812", "unmanned aircraft near a public gathering"),
];

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Reference {
    Msl,
    Agl,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Detail {
    pub effective: Option<String>,
    pub expires: Option<String>,
    pub rule: Option<String>,
    pub purpose: Option<String>,
    pub floor: Option<(f64, Reference)>,
    pub ceiling: Option<(f64, Reference)>,
}

/// An XNOTAM time (UTC with no zone, "2026-11-02T14:00:00") as ISO 8601
/// with its Z; None where it is no such time.
pub fn utc(text: &str) -> Option<String> {
    let t = text.trim();
    let b = t.as_bytes();
    let digits = |r: std::ops::Range<usize>| r.clone().all(|i| b.get(i).is_some_and(u8::is_ascii_digit));
    let date_ok = b.len() >= 10 && digits(0..4) && b[4] == b'-' && digits(5..7) && b[7] == b'-' && digits(8..10);
    if !date_ok {
        return None;
    }
    let (month, day): (u32, u32) = (t[5..7].parse().ok()?, t[8..10].parse().ok()?);
    if !(1..=12).contains(&month) || day == 0 || day > 31 {
        return None;
    }
    if b.len() == 10 {
        return Some(format!("{t}T00:00:00Z"));
    }
    let time_ok = b.len() == 19 && b[10] == b'T' && digits(11..13) && b[13] == b':' && digits(14..16) && b[16] == b':' && digits(17..19);
    let (h, m, s): (u32, u32, u32) = (t.get(11..13)?.parse().ok()?, t.get(14..16)?.parse().ok()?, t.get(17..19)?.parse().ok()?);
    (time_ok && h < 24 && m < 60 && s < 60).then(|| format!("{t}Z"))
}

/// A NOTAM's words as a sentence: in capitals, lower case after the first
/// letter (Python's capitalize); otherwise kept as written.
pub fn sentence(text: &str) -> Option<String> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }
    let cased = t.chars().any(|c| c.is_lowercase() || c.is_uppercase());
    let upper = cased && !t.chars().any(char::is_lowercase);
    if !upper {
        return Some(t.to_string());
    }
    let mut chars = t.chars();
    let first = chars.next().map(|c| c.to_uppercase().collect::<String>()).unwrap_or_default();
    Some(first + &chars.as_str().to_lowercase())
}

fn height(area: &xml::Element, side: &str) -> Option<(f64, Reference)> {
    let value = area.text_at(&[&format!("valDistVer{side}")])?;
    let feet: f64 = value.trim().parse().ok().filter(|v: &f64| v.is_finite())?;
    let uom = area.text_at(&[&format!("uomDistVer{side}")]);
    let code = area.text_at(&[&format!("codeDistVer{side}")]);
    let feet = feet * if uom == Some("FL") { 100.0 } else { 1.0 };
    Some((feet, if code == Some("HEI") { Reference::Agl } else { Reference::Msl }))
}

/// The detail of a TFR; None where the file is not XML or holds no NOTAM.
pub fn parse_detail(text: &str) -> Option<Detail> {
    let root = xml::parse(text).ok()?;
    let notam = *root.iter_named("Not").first()?;
    let rule_code = root.iter_named("TfrNot").first().and_then(|t| t.text_at(&["codeType"])).unwrap_or("").trim().to_string();
    let mut floors = Vec::new();
    let mut ceilings = Vec::new();
    for area in root.iter_named("aseTFRArea") {
        floors.extend(height(area, "Lower"));
        ceilings.extend(height(area, "Upper"));
    }
    // The first lowest and the first highest, as Python's min and max keep.
    let floor = floors.iter().copied().fold(None, |best: Option<(f64, Reference)>, h| match best {
        Some(b) if b.0 <= h.0 => Some(b),
        _ => Some(h),
    });
    let ceiling = ceilings.iter().copied().fold(None, |best: Option<(f64, Reference)>, h| match best {
        Some(b) if b.0 >= h.0 => Some(b),
        _ => Some(h),
    });
    let rule = (!rule_code.is_empty()).then(|| {
        RULES.iter().find(|(k, _)| *k == rule_code).map(|(_, v)| v.to_string()).unwrap_or(rule_code.clone())
    });
    Some(Detail {
        effective: notam.text_at(&["dateEffective"]).and_then(utc),
        expires: notam.text_at(&["dateExpire"]).and_then(utc),
        rule,
        purpose: notam.text_at(&["txtDescrPurpose"]).and_then(sentence),
        floor,
        ceiling,
    })
}

fn reference(r: Option<(f64, Reference)>) -> Option<&'static str> {
    r.map(|(_, r)| if r == Reference::Agl { "AGL" } else { "MSL" })
}

/// The detail as wingtip.tfr's dict, JSON.
pub fn to_json(d: &Detail) -> String {
    let mut out = String::from("{\"effective\":");
    json::opt_string(&mut out, d.effective.as_deref());
    out.push_str(",\"expires\":");
    json::opt_string(&mut out, d.expires.as_deref());
    out.push_str(",\"rule\":");
    json::opt_string(&mut out, d.rule.as_deref());
    out.push_str(",\"purpose\":");
    json::opt_string(&mut out, d.purpose.as_deref());
    out.push_str(",\"floor_ft\":");
    json::opt_number(&mut out, d.floor.map(|f| f.0));
    out.push_str(",\"floor_ref\":");
    json::opt_string(&mut out, reference(d.floor));
    out.push_str(",\"ceiling_ft\":");
    json::opt_number(&mut out, d.ceiling.map(|c| c.0));
    out.push_str(",\"ceiling_ref\":");
    json::opt_string(&mut out, reference(d.ceiling));
    out.push('}');
    out
}
