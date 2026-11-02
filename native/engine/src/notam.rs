//! NOTAMs: the FAA NOTAM System's FNS messages (AIXM 5.1, one Event's
//! NOTAM each), read as vfr.notams' `notams` reads them, and a NOTAM's
//! text as sent -- the domestic form ("!ORD 10/709 ORD RWY ... 2610191016-
//! 2610201100") and the ICAO one ("A1234/26 NOTAMN ... B) ... C) ...") --
//! for its number, place and times, which is what a phone gets over
//! FIS-B. The domestic form is the FAA's (FAA JO 7930.2, Notices to Air
//! Missions), the ICAO one Annex 15's. tests/test_parsers.py holds both
//! to the planner's answers.

use crate::{json, xml};

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Notam {
    pub id: String,
    pub icao_id: Option<String>,
    pub names: Option<String>,
    pub kind: Option<String>,
    pub location: Option<String>,
    pub icao_location: Option<String>,
    pub classification: Option<String>,
    pub issued: Option<String>,
    pub starts: Option<String>,
    pub ends: Option<String>,
    pub estimated: bool,
    pub schedule: Option<String>,
    pub text: String,
    pub raw: String,
}

/// "202610270700", "202610270700EST": ISO 8601 UTC, and whether estimated.
fn utc12(text: &str) -> (Option<String>, bool) {
    let b = text.as_bytes();
    if b.len() < 12 || !b[..12].iter().all(u8::is_ascii_digit) {
        return (None, false);
    }
    let n = |r: std::ops::Range<usize>| text[r].parse::<u32>().unwrap();
    let (y, mo, d, h, mi) = (n(0..4), n(4..6), n(6..8), n(8..10), n(10..12));
    if !(1..=12).contains(&mo) || d == 0 || d > crate::time::days_in_month(y as i64, mo) || h > 23 || mi > 59 {
        return (None, false);
    }
    (Some(format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:00Z")), text.ends_with("EST"))
}

/// A gml time ("2026-10-20T02:03:26.000Z") to the minute.
fn iso_minute(text: &str) -> Option<String> {
    let t = text.trim();
    let b = t.as_bytes();
    let dig = |r: std::ops::Range<usize>| r.clone().all(|i| b.get(i).is_some_and(u8::is_ascii_digit));
    let ok = b.len() >= 16 && dig(0..4) && b[4] == b'-' && dig(5..7) && b[7] == b'-' && dig(8..10) && b[10] == b'T'
        && dig(11..13) && b[13] == b':' && dig(14..16);
    if !ok {
        return None;
    }
    // What follows the minutes: seconds and a fraction, then Z or nothing.
    let tail = &t[16..];
    let tail = tail.strip_suffix('Z').or_else(|| tail.strip_suffix("+00:00")).unwrap_or(tail);
    let tail_ok = tail.is_empty()
        || (tail.len() >= 3 && tail.as_bytes()[0] == b':' && tail[1..3].bytes().all(|c| c.is_ascii_digit())
            && (tail.len() == 3 || (tail.as_bytes()[3] == b'.' && tail.len() > 4 && tail[4..].bytes().all(|c| c.is_ascii_digit()))));
    tail_ok.then(|| format!("{}:00Z", &t[..16]))
}

fn is_icao_number(w: &str) -> bool {
    let b = w.as_bytes();
    b.len() == 8 && b[0].is_ascii_uppercase() && b[1..5].iter().all(u8::is_ascii_digit) && b[5] == b'/' && b[6..].iter().all(u8::is_ascii_digit)
}

/// "A1234/26 NOTAMR A1200/26": the number, and the one it replaces or
/// cancels -- the first such anywhere in the text.
fn icao_id(text: &str) -> Option<(String, Option<String>)> {
    let words: Vec<&str> = text.split_whitespace().collect();
    for (i, w) in words.iter().enumerate() {
        if is_icao_number(w) && matches!(words.get(i + 1), Some(&"NOTAMN" | &"NOTAMR" | &"NOTAMC")) {
            let names = words.get(i + 2).filter(|n| is_icao_number(n)).map(|n| n.to_string());
            return Some((w.to_string(), names));
        }
    }
    None
}

/// "!ORD 10/709": the domestic number's location and number.
fn domestic_id(text: &str) -> Option<(String, String)> {
    let rest = text.strip_prefix('!')?;
    let mut words = rest.split_whitespace();
    let place = words.next()?;
    if !place.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return None;
    }
    let number = words.next()?;
    let (m, n) = number.split_once('/')?;
    let n: String = n.chars().take_while(char::is_ascii_digit).take(4).collect();
    let ok = (1..=2).contains(&m.len()) && m.bytes().all(|b| b.is_ascii_digit()) && !n.is_empty();
    ok.then(|| (place.to_string(), format!("{m}/{n}")))
}

fn some(s: &str) -> Option<String> {
    let s = s.trim();
    (!s.is_empty()).then(|| s.to_string())
}

/// The NOTAMs of one FNS message; none where it is not XML.
pub fn from_fns(text: &str) -> Vec<Notam> {
    let Ok(root) = xml::parse(text) else { return Vec::new() };
    let mut out = Vec::new();
    for event in root.iter_named("EventTimeSlice") {
        let Some(notam) = event.find(&["textNOTAM", "NOTAM"]) else { continue };
        let get = |tag: &str| notam.text_at(&[tag]).unwrap_or("").trim().to_string();
        let (mut domestic, mut icao) = (None, None);
        for t in notam.all("translation").filter_map(|t| t.child("NOTAMTranslation")) {
            match t.text_at(&["type"]) {
                Some("LOCAL_FORMAT") => domestic = Some(t.text_at(&["simpleText"]).unwrap_or("").trim().to_string()),
                Some("OTHER:ICAO") => {
                    icao = t.child("formattedText").map(|f| f.all_text().replace("<pre>", "").replace("</pre>", "").trim().to_string());
                }
                _ => {}
            }
        }
        let text = get("text");
        let found = icao_id(icao.as_deref().unwrap_or(&text));
        let (series, number, year) = (get("series"), get("number"), get("year"));
        let icao_number = found.as_ref().map(|f| f.0.clone()).or_else(|| {
            (!series.is_empty() && !number.is_empty() && !year.is_empty())
                .then(|| format!("{series}{number:0>4}/{}", year.chars().rev().take(2).collect::<Vec<_>>().into_iter().rev().collect::<String>()))
        });
        let key = match domestic.as_deref().and_then(domestic_id) {
            Some((place, n)) => Some(format!("{place} {n}")),
            None => icao_number.clone(),
        };
        let Some(key) = key else { continue };
        let ext = |tag: &str| event.find(&["extension", "EventExtension"]).and_then(|e| e.text_at(&[tag])).and_then(some);
        let (starts, _) = utc12(&get("effectiveStart"));
        let (mut ends, mut estimated) = utc12(&get("effectiveEnd"));
        let lifetime = event.find(&["featureLifetime", "TimePeriod", "endPosition"]).and_then(|e| iso_minute(&e.text));
        if let Some(l) = lifetime {
            if ends.as_ref().is_none_or(|e| l < *e) {
                ends = Some(l);
                estimated = false;
            }
        }
        let kind = some(&get("type"));
        let names = match (&found, kind.as_deref()) {
            (Some((_, n)), Some("R" | "C")) => n.clone(),
            _ => None,
        };
        let raw = [domestic.as_deref(), icao.as_deref(), Some(text.as_str())].into_iter().flatten().find(|s| !s.is_empty()).unwrap_or("").to_string();
        out.push(Notam {
            id: key,
            icao_id: icao_number,
            names,
            kind,
            location: some(&get("location")),
            icao_location: ext("icaoLocation"),
            classification: ext("classification"),
            issued: iso_minute(&get("issued")),
            starts,
            ends,
            estimated,
            schedule: some(&get("schedule")),
            text,
            raw,
        });
    }
    out
}

/// A NOTAM's number, place and times from its text as sent: the domestic
/// form's "!LOC N/NNN PLACE ... YYMMDDHHMM-YYMMDDHHMM[EST]" (or -PERM),
/// or the ICAO form's number, A) place and B) and C) times. None where
/// it is neither.
pub fn from_text(raw: &str) -> Option<Notam> {
    let raw = raw.trim();
    let yy = |t: &str| -> (Option<String>, bool) {
        if t.len() >= 10 && t.as_bytes()[..10].iter().all(u8::is_ascii_digit) {
            utc12(&format!("20{t}"))
        } else {
            (None, false)
        }
    };
    let words: Vec<&str> = raw.split_whitespace().collect();
    // A military NOTAM's domestic form carries an ICAO-style number
    // ("!KEDG M0061/26 EDG ..."): the number is its name.
    let military = raw.starts_with('!') && words.get(1).is_some_and(|w| is_icao_number(w));
    let domestic = domestic_id(raw).map(|(place, n)| format!("{place} {n}"));
    if domestic.is_some() || military {
        let location = words.get(2).map(|w| w.to_string());
        let (mut starts, mut ends, mut estimated) = (None, None, false);
        // Its times, the last "YYMMDDHHMM-YYMMDDHHMM" group: a NOTAM in
        // parts ends "END PART 2 OF 2" after them.
        let times = words.iter().rev().find_map(|w| w.split_once('-').filter(|(a, b)| {
            a.len() == 10 && a.bytes().all(|c| c.is_ascii_digit()) && (*b == "PERM" || b.get(..10).is_some_and(|d| d.bytes().all(|c| c.is_ascii_digit())))
        }));
        if let Some((a, b)) = times {
            starts = yy(a).0;
            if b != "PERM" {
                (ends, estimated) = yy(b);
            }
        }
        let id = domestic.unwrap_or_else(|| words[1].to_string());
        let icao_id = military.then(|| words[1].to_string());
        return Some(Notam { id, icao_id, location, starts, ends, estimated, raw: raw.to_string(), ..Default::default() });
    }
    let (id, names) = icao_id(raw)?;
    let after = |tag: &str| words.iter().position(|w| *w == tag).and_then(|i| words.get(i + 1)).copied();
    let location = after("A)").map(str::to_string);
    let starts = after("B)").and_then(|t| yy(t).0);
    let (ends, estimated) = match after("C)") {
        Some("PERM") | None => (None, false),
        Some(t) => {
            let est = t.ends_with("EST") || words.iter().skip_while(|w| **w != "C)").nth(2) == Some(&"EST");
            (yy(t).0, est)
        }
    };
    Some(Notam { id: id.clone(), icao_id: Some(id), names, location, starts, ends, estimated, raw: raw.to_string(), ..Default::default() })
}

/// The NOTAMs as vfr.notams' dicts, JSON.
pub fn to_json(list: &[Notam]) -> String {
    let mut out = String::from("[");
    for (k, n) in list.iter().enumerate() {
        if k > 0 {
            out.push(',');
        }
        out.push_str("{\"id\":");
        json::string(&mut out, &n.id);
        for (name, v) in [
            ("icao_id", &n.icao_id), ("names", &n.names), ("type", &n.kind), ("location", &n.location),
            ("icao_location", &n.icao_location), ("classification", &n.classification), ("issued", &n.issued),
            ("starts", &n.starts), ("ends", &n.ends),
        ] {
            out.push_str(&format!(",\"{name}\":"));
            json::opt_string(&mut out, v.as_deref());
        }
        out.push_str(",\"estimated\":");
        out.push_str(if n.estimated { "true" } else { "false" });
        out.push_str(",\"schedule\":");
        json::opt_string(&mut out, n.schedule.as_deref());
        out.push_str(",\"text\":");
        json::string(&mut out, &n.text);
        out.push_str(",\"raw\":");
        json::string(&mut out, &n.raw);
        out.push('}');
    }
    out.push(']');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_domestic_form() {
        let n = from_text("!ORD 10/709 ORD RWY 04L/22R CLSD EXC TAX 2610191016-2610201100EST").unwrap();
        assert_eq!((n.id.as_str(), n.location.as_deref()), ("ORD 10/709", Some("ORD")));
        assert_eq!((n.starts.as_deref(), n.ends.as_deref(), n.estimated), (Some("2026-10-19T10:16:00Z"), Some("2026-10-20T11:00:00Z"), true));
        assert_eq!(from_text("!SEA 10/100 S43 TWR 122.3 DECOMMISSIONED 2610211700-PERM").unwrap().ends, None);
    }

    #[test]
    fn the_icao_form() {
        let n = from_text("F3298/26 NOTAMN Q) EDMM/QOLAS/IV/M /E /000/024/4820N01111E001 A) EDMM B) 2610200401 C) 2611032359 E) OBST LGT").unwrap();
        assert_eq!((n.id.as_str(), n.location.as_deref(), n.ends.as_deref()), ("F3298/26", Some("EDMM"), Some("2026-11-03T23:59:00Z")));
    }
}
