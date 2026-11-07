//! A field's radio in words: what each frequency the airport file lists
//! is called and what it is for, which one is the CTAF, and the
//! kneeboard's short list. The web's lib/frequencies had these and the
//! iPhone's AirportWords a copy. A frequency is OurAirports' row, its
//! type and description as the file has them.

use super::faa::{faa_words, js_trim};

/// A frequency as the airport file lists it.
#[derive(Clone, Debug, PartialEq)]
pub struct Frequency {
    pub kind: Option<String>,
    pub description: Option<String>,
    pub mhz: Option<f64>,
}

impl Frequency {
    fn code(&self) -> String {
        self.kind.as_deref().unwrap_or("").to_uppercase()
    }

    fn says_ctaf(&self) -> bool {
        self.description.as_deref().unwrap_or("").to_ascii_uppercase().contains("CTAF")
    }
}

/// What a frequency is for, by its type: the kinds a card draws each with
/// its own glyph and colour.
pub fn kind_of(code: &str) -> &'static str {
    match code {
        "TWR" => "tower",
        "GND" | "CLD" | "CLNC" | "CD" | "GCCD" | "GND/CD" => "ground",
        "ATIS" | "AWOS" | "ASOS" => "weather",
        "APP" | "APCH" | "DEP" | "A/D" | "APP/DEP" => "approach",
        "CTAF" | "UNIC" | "UNICOM" | "MULT" | "MULTICOM" => "traffic",
        _ => "other",
    }
}

/// Its name in words, where the type is a code a pilot reads as one.
pub fn name_of(code: &str) -> Option<&'static str> {
    Some(match code {
        "TWR" => "Tower",
        "GND" => "Ground",
        "CLD" | "CLNC" | "CD" => "Clearance delivery",
        "GCCD" | "GND/CD" => "Ground and clearance",
        "ATIS" => "ATIS",
        "AWOS" => "AWOS",
        "ASOS" => "ASOS",
        "APP" | "APCH" => "Approach",
        "DEP" => "Departure",
        "A/D" | "APP/DEP" => "Approach and departure",
        "CTAF" => "CTAF",
        "UNIC" | "UNICOM" => "UNICOM",
        "MULT" | "MULTICOM" => "MULTICOM",
        "RDO" => "Radio",
        "FSS" => "Flight service",
        "RCO" => "Remote outlet",
        "PTD" => "Pilot to dispatch",
        "OPS" => "Operations",
        "EMR" => "Emergency",
        "AFIS" => "Flight information",
        _ => return None,
    })
}

/// Only the letters and figures, in capitals: whether a description says
/// no more than a name ("APP/DEP" and "Approach and departure" do not
/// match, "TWR" and "TWR" do).
fn said(text: &str) -> String {
    text.chars().filter(char::is_ascii_alphanumeric).map(|c| c.to_ascii_uppercase()).collect()
}

/// A field's frequency as its card lists it: its name in words (TWR is
/// "Tower"), its kind for the row's glyph, and what the file says of it in
/// sentence case (faa_words) where that adds to the name -- "Minneapolis
/// APP/DEP", not a second "TWR" under "Tower". A type with no name of its
/// own is named by its description. (name, kind, detail).
pub fn frequency_line(kind: Option<&str>, description: Option<&str>) -> (String, &'static str, Option<String>) {
    let code = js_trim(kind.unwrap_or("")).to_uppercase();
    let words = match description {
        Some(d) if !d.is_empty() => faa_words(js_trim(d)),
        _ => String::new(),
    };
    let named = name_of(&code);
    let name = match named {
        Some(n) => n.to_owned(),
        None if !words.is_empty() => words.clone(),
        None if !code.is_empty() => code.clone(),
        None => "Frequency".to_owned(),
    };
    let adds = !words.is_empty() && named.is_some_and(|n| said(&words) != said(&code) && said(&words) != said(n));
    (name, kind_of(&code), adds.then_some(words))
}

/// The first frequency the field lists of the first of `types` it has
/// one for, by its index.
pub fn frequency_of(frequencies: &[Frequency], types: &[&str]) -> Option<usize> {
    types.iter().find_map(|t| frequencies.iter().position(|f| f.code() == *t && f.mhz.is_some()))
}

/// The CTAF: the one so called, else a UNICOM that is also the CTAF, else
/// a UNICOM, by its index; None where the field lists none, and the
/// pilot self-announces on MULTICOM's 122.9 (AC 90-66C 9.6, `MULTICOM`).
pub fn ctaf_of(frequencies: &[Frequency]) -> Option<usize> {
    frequency_of(frequencies, &["CTAF"])
        .or_else(|| frequencies.iter().position(|f| f.code().starts_with("UNIC") && f.says_ctaf() && f.mhz.is_some()))
        .or_else(|| frequency_of(frequencies, &["UNIC", "UNICOM"]))
}

/// MULTICOM's frequency, where a field with no tower lists nothing to
/// self-announce on (AC 90-66C 9.6).
pub const MULTICOM_MHZ: f64 = 122.9;

/// The kneeboard's short names for a field's radio, in its order: the
/// tower's before the CTAF's (a towered field's CTAF is for when it is
/// closed).
const RADIO: [(&[&str], &str); 8] = [
    (&["ATIS"], "ATIS"),
    (&["AWOS", "ASOS"], "AWOS"),
    (&["CLD"], "CLR"),
    (&["GND"], "GND"),
    (&["TWR"], "TWR"),
    (&["CTAF"], "CTAF"),
    (&["UNIC", "UNICOM"], "UNICOM"),
    (&["APP", "A/D", "DEP"], "APP"),
];

/// A field's radio as the kneeboard lists it: each by its short name, with
/// its frequency.
pub fn kneeboard_radio(frequencies: &[Frequency]) -> Vec<(&'static str, f64)> {
    let mut out: Vec<(&'static str, f64)> = Vec::new();
    for (types, name) in RADIO {
        let Some(f) = frequencies.iter().find(|f| types.contains(&f.code().as_str()) && f.mhz.is_some()) else { continue };
        let mhz = f.mhz.unwrap_or_default();
        // UNICOM where there is no tower and it is not the CTAF already: a
        // towered field's is the FBO's, not the air's. A UNICOM the table
        // calls the CTAF too ("CTAF/UNICOM") is the CTAF.
        if name == "UNICOM" && out.iter().any(|&(n, m)| n == "TWR" || m == mhz) {
            continue;
        }
        let called = if name == "UNICOM" && f.says_ctaf() && !out.iter().any(|&(n, _)| n == "CTAF") { "CTAF" } else { name };
        out.push((called, mhz));
    }
    // No tower and nothing to self-announce on: MULTICOM's 122.9, as the
    // radio calls say (ctaf_of).
    if ctaf_of(frequencies).is_none() && !out.iter().any(|&(n, _)| n == "TWR") {
        out.push(("MULTICOM", MULTICOM_MHZ));
    }
    out
}
