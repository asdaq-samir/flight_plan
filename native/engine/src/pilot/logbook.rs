//! The logbook as a CSV file, out and in: out in columns named as
//! ForeFlight's logbook template names its own where it has one, so a
//! spreadsheet or another logbook reads them; in from that file again, or
//! from ForeFlight's own export -- an Aircraft Table, then a Flights Table,
//! each a row of formats over a row of field names (ForeFlight Logbook
//! Guide v14.0, "ForeFlight Template") -- its names read whatever their
//! spaces or case ("Total Time", "TotalTime").
//!
//! What ForeFlight keeps that this logbook does not (times out and in,
//! Hobbs and tach, people) is left; what it keeps apart this logbook keeps
//! together: its actual and simulated instrument as the instrument time,
//! its approaches' counts as the approaches, its holds as holding, and its
//! landings as day landings (all of them, which 14 CFR 61.57(a) counts by
//! day or night) beside the night full-stop ones (61.57(b)).
//!
//! The web app's lib/logbookCsv, moved here whole; the entries are the
//! gateway's LogbookEntryRequest, camelCase, as the apps send them.

use super::csv;
use super::js;
use crate::json::{self, Value};

/// The columns written, ForeFlight's names where it has the field, each
/// with the entry's member it is written from.
const OUT: [(&str, &str); 19] = [
    ("Date", "flownOn"),
    ("AircraftID", "aircraft"),
    ("TypeCode", "aircraftType"),
    ("Route", "route"),
    ("TotalTime", "totalHours"),
    ("Night", "nightHours"),
    ("CrossCountry", "crossCountryHours"),
    ("Solo", "soloHours"),
    ("DualReceived", "dualHours"),
    ("Instrument", "instrumentHours"),
    // Every landing, by day and at night: dayLandings + nightLandings.
    ("AllLandings", ""),
    ("NightLandingsFullStop", "nightLandings"),
    ("ToweredLandings", "toweredLandings"),
    ("Distance", "distanceNm"),
    ("LongestLeg", "longestLegNm"),
    ("Approaches", "approaches"),
    // 1 where it held, 0 where not, as ForeFlight counts holds.
    ("Holds", "holding"),
    ("Tracking", "tracking"),
    ("PilotComments", "remarks"),
];

/// A value as the file has it: a number as JavaScript writes it, a yes as
/// ForeFlight's template writes a boolean ("x"), nothing for no value.
fn cell(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::Bool(b)) => if *b { "x" } else { "" }.to_owned(),
        Some(Value::Number(n)) => js::number_string(*n),
        Some(Value::String(s)) => s.clone(),
        // Never in an entry; as JavaScript's String() writes them.
        Some(Value::Array(items)) => items.iter().map(|v| cell(Some(v))).collect::<Vec<_>>().join(","),
        Some(Value::Object(_)) => "[object Object]".to_owned(),
    }
}


/// JavaScript's truth of a value, for `holding ? 1 : 0`.
fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => *n != 0.0 && !n.is_nan(),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// `dayLandings + nightLandings` as JavaScript adds them, for a file
/// written from whatever the record holds: numbers summed (none given is
/// NaN, null 0, a boolean 0 or 1), and text where either is text, joined.
fn all_landings(day: Option<&Value>, night: Option<&Value>) -> String {
    let text = |v: Option<&Value>| match v {
        None => "undefined".to_owned(),
        Some(Value::Null) => "null".to_owned(),
        Some(Value::Bool(b)) => b.to_string(),
        other => cell(other),
    };
    let num = |v: Option<&Value>| match v {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        Some(Value::Number(n)) => *n,
        Some(_) => f64::NAN,
    };
    let is_text = |v: Option<&Value>| matches!(v, Some(Value::String(_) | Value::Array(_) | Value::Object(_)));
    if is_text(day) || is_text(night) {
        text(day) + &text(night)
    } else {
        js::number_string(num(day) + num(night))
    }
}

/// The logbook as a CSV file, oldest flight first (the order the entries
/// came in kept between flights of one day), a line break after the last.
pub fn write(entries: &[Value]) -> String {
    let mut sorted: Vec<&Value> = entries.iter().collect();
    let day = |e: &Value| match e.get("flownOn") {
        Some(Value::String(s)) => s.clone(),
        Some(v) => cell(Some(v)),
        None => "undefined".to_owned(),
    };
    sorted.sort_by_key(|e| day(e));
    let mut rows = vec![OUT.iter().map(|(name, _)| (*name).to_owned()).collect::<Vec<_>>()];
    for e in sorted {
        rows.push(
            OUT.iter()
                .map(|(name, field)| match *name {
                    "AllLandings" => all_landings(e.get("dayLandings"), e.get("nightLandings")),
                    "Holds" => if truthy(e.get(field)) { "1" } else { "0" }.to_owned(),
                    _ => cell(e.get(field)),
                })
                .collect(),
        );
    }
    csv::unparse(&rows) + "\r\n"
}

/// A field's name as compared: "Total Time" and "TotalTime" are one.
fn key(name: &str) -> String {
    name.to_lowercase().chars().filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit()).collect()
}

/// Hours to the tenth, as the logbook keeps them; nothing readable, or
/// nothing above zero, is 0.
fn hours(v: Option<&str>) -> f64 {
    let n = js::number(js::trim(v.unwrap_or("")));
    if n.is_finite() && n > 0.0 {
        js::round(n * 10.0) / 10.0
    } else {
        0.0
    }
}

/// A count: the whole number a cell starts with, above zero, else 0.
fn count(v: Option<&str>) -> f64 {
    let n = js::parse_int(js::trim(v.unwrap_or("")));
    if n.is_finite() && n > 0.0 {
        n
    } else {
        0.0
    }
}

/// A yes: anything but nothing, 0, false, no or n, in any case.
fn yes(v: Option<&str>) -> bool {
    match v {
        None | Some("") => false,
        Some(s) => !matches!(js::trim(s).to_ascii_lowercase().as_str(), "" | "0" | "false" | "no" | "n"),
    }
}

/// A date as ForeFlight writes it (2002-01-02), or as a spreadsheet may
/// have turned it (1/2/2002); None for neither. The figures are not
/// checked against the calendar: the gateway refuses a day that is none.
fn date_of(v: Option<&str>) -> Option<String> {
    let s = js::trim(v.unwrap_or(""));
    let b = s.as_bytes();
    let digits = |r: &[u8]| !r.is_empty() && r.iter().all(u8::is_ascii_digit);
    if b.len() == 10 && b[4] == b'-' && b[7] == b'-' && digits(&b[..4]) && digits(&b[5..7]) && digits(&b[8..]) {
        return Some(s.to_owned());
    }
    let parts: Vec<&str> = s.split('/').collect();
    if let [m, d, y] = parts[..] {
        if (1..=2).contains(&m.len()) && digits(m.as_bytes()) && (1..=2).contains(&d.len()) && digits(d.as_bytes()) && y.len() == 4 && digits(y.as_bytes()) {
            return Some(format!("{y}-{m:0>2}-{d:0>2}"));
        }
    }
    None
}

/// The header row of a table: the first row from `from` with all of these.
fn header_row(rows: &[Vec<String>], from: usize, names: &[&str]) -> Option<usize> {
    (from..rows.len()).find(|&i| {
        let keys: Vec<String> = rows[i].iter().map(|c| key(c)).collect();
        names.iter().all(|n| keys.iter().any(|k| k == n))
    })
}

/// A row left out of an import, by its line in the file and why.
pub struct Skipped {
    pub line: usize,
    pub reason: String,
}

/// A logbook CSV read: ForeFlight's, or this logbook's own. The entries
/// as LogbookEntryRequest's JSON, each an object; the rows left out.
pub fn read(text_in: &str) -> (Vec<String>, Vec<Skipped>) {
    let rows = csv::rows(text_in.strip_prefix('\u{feff}').unwrap_or(text_in));
    // ForeFlight's Aircraft Table: each tail's type code.
    let mut types: Vec<(String, String)> = Vec::new();
    let aircraft_at = header_row(&rows, 0, &["aircraftid", "typecode", "make"]);
    let flights_at = header_row(&rows, aircraft_at.map_or(0, |a| a + 1), &["date", "aircraftid", "totaltime"]);
    if let Some(a) = aircraft_at {
        let names: Vec<String> = rows[a].iter().map(|c| key(c)).collect();
        let col = |n: &str| names.iter().position(|k| k == n);
        for row in &rows[a + 1..flights_at.unwrap_or(rows.len())] {
            let cell = |n: &str| col(n).and_then(|i| row.get(i)).map(|c| js::trim(c));
            if let (Some(tail), Some(kind)) = (cell("aircraftid"), cell("typecode")) {
                if !tail.is_empty() && !kind.is_empty() && tail.to_lowercase() != "text" {
                    match types.iter_mut().find(|(t, _)| t == tail) {
                        Some(known) => known.1 = kind.to_owned(),
                        None => types.push((tail.to_owned(), kind.to_owned())),
                    }
                }
            }
        }
    }
    let Some(flights_at) = flights_at else {
        return (Vec::new(), vec![Skipped { line: 1, reason: "No row of field names with Date, AircraftID and TotalTime".to_owned() }]);
    };
    let names: Vec<String> = rows[flights_at].iter().map(|c| key(c)).collect();
    let has = |n: &str| names.iter().any(|k| k == n);
    let mut entries = Vec::new();
    let mut skipped = Vec::new();
    for (i, row) in rows.iter().enumerate().skip(flights_at + 1) {
        if row.iter().all(|c| js::trim(c).is_empty()) {
            continue;
        }
        let at = |n: &str| names.iter().position(|k| k == n).and_then(|i| row.get(i)).map(String::as_str);
        let line = i + 1;
        let Some(flown_on) = date_of(at("date")) else {
            skipped.push(Skipped { line, reason: format!("No date (\"{}\")", at("date").unwrap_or("")) });
            continue;
        };
        let total = hours(at("totaltime"));
        if total > 24.0 {
            skipped.push(Skipped { line, reason: format!("{} hours is more than a day: a summary entry, to log as its flights", js::number_string(total)) });
            continue;
        }
        let tail = js::trim(at("aircraftid").unwrap_or(""));
        let route = [at("from"), at("route"), at("to")].iter().map(|s| js::trim(s.unwrap_or(""))).filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" ");
        let night = count(at("nightlandingsfullstop"));
        // All its landings, by day or night, as day landings for 61.57(a),
        // the night full-stop ones apart; where it gives no total, its day
        // full-stop ones.
        let all = if at("alllandings").is_some_and(|s| !js::trim(s).is_empty()) {
            count(at("alllandings"))
        } else {
            count(at("daylandingsfullstop")) + night
        };
        // ForeFlight's approaches, "count;type;runway;airport;comments" each.
        let approaches = if has("approaches") {
            count(at("approaches"))
        } else {
            names
                .iter()
                .filter(|n| n.len() > 8 && n.starts_with("approach") && n[8..].bytes().all(|b| b.is_ascii_digit()))
                .map(|n| count(at(n).map(|c| c.split(';').next().unwrap_or(""))))
                .sum::<f64>()
        };
        let kind = match at("typecode") {
            Some(c) => c,
            None => types.iter().find(|(t, _)| t == tail).map_or("", |(_, k)| k.as_str()),
        };
        let instrument = if has("instrument") {
            hours(at("instrument"))
        } else {
            js::round((hours(at("actualinstrument")) + hours(at("simulatedinstrument"))) * 10.0) / 10.0
        };
        let text_or_null = |out: &mut String, s: &str| if s.is_empty() { out.push_str("null") } else { json::string(out, s) };
        let mut e = String::from("{\"flownOn\":");
        json::string(&mut e, &flown_on);
        e.push_str(",\"aircraft\":");
        text_or_null(&mut e, js::slice_units(tail, 16));
        e.push_str(",\"aircraftType\":");
        text_or_null(&mut e, js::slice_units(js::trim(kind), 16));
        e.push_str(",\"route\":");
        text_or_null(&mut e, js::slice_units(&route, 120));
        let num = |e: &mut String, name: &str, v: f64| {
            e.push_str(&format!(",\"{name}\":"));
            e.push_str(&js::number_string(v));
        };
        num(&mut e, "totalHours", total);
        num(&mut e, "nightHours", hours(at("night")));
        num(&mut e, "crossCountryHours", hours(at("crosscountry")));
        num(&mut e, "dayLandings", (all - night).max(0.0));
        num(&mut e, "nightLandings", night);
        e.push_str(",\"remarks\":");
        text_or_null(&mut e, js::slice_units(js::trim(at("pilotcomments").unwrap_or("")), 500));
        num(&mut e, "dualHours", hours(at("dualreceived")));
        num(&mut e, "soloHours", hours(at("solo")));
        num(&mut e, "instrumentHours", instrument);
        num(&mut e, "toweredLandings", count(at("toweredlandings")));
        num(&mut e, "distanceNm", hours(at("distance")));
        num(&mut e, "longestLegNm", hours(at("longestleg")));
        num(&mut e, "approaches", approaches);
        e.push_str(&format!(",\"holding\":{}", count(at("holds")) > 0.0));
        e.push_str(&format!(",\"tracking\":{}}}", yes(at("tracking"))));
        entries.push(e);
    }
    (entries, skipped)
}

/// `read`'s answer as JSON: `{"entries": [...], "skipped": [{"line", "reason"}]}`.
pub fn read_json(text: &str) -> String {
    let (entries, skipped) = read(text);
    let mut out = String::from("{\"entries\":[");
    out.push_str(&entries.join(","));
    out.push_str("],\"skipped\":[");
    for (i, s) in skipped.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&format!("{{\"line\":{},\"reason\":", s.line));
        json::string(&mut out, &s.reason);
        out.push('}');
    }
    out.push_str("]}");
    out
}
