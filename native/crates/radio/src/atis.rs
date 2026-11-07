//! An ATIS or AWOS/ASOS broadcast as the phone's recognizer wrote it,
//! read into its figures -- the web app's lib/atis and the native app's
//! Atis, both held to the same fixture (web/src/lib/fixtures/atis.json;
//! native/engine/tests/atis.rs), so the phone at the hold-short line reads
//! one with no signal.
//!
//! AIM 4-1-13 (ATIS) says what a broadcast holds, in order: the airport's
//! name and the information letter, the time of the weather, the wind,
//! visibility, obstructions to vision, sky condition, temperature, dew
//! point, altimeter, the approaches and runways in use, NOTAMs and
//! "advise on initial contact you have information (letter)". JO
//! 7110.65's phraseology says how each figure is said: the wind as "WIND
//! (direction) AT (speed)", with "GUSTS (speed)", "WIND VARIABLE AT
//! (speed)" or "WIND CALM" (2-6-6, Reporting Weather Conditions); the
//! visibility as "VISIBILITY (value)" in statute miles and fractions; the
//! altimeter as "ALTIMETER (setting)" figure by figure (2-7-2); the sky as
//! the METAR's layers read out, "FEW CLOUDS AT (height)", "CEILING
//! (height) BROKEN", "SKY CLEAR". An AWOS or ASOS says the same figures
//! itself (AIM 7-1-11, Weather Observing Programs), with "automated
//! weather observation" in place of a letter and "temperature (value)
//! Celsius". Figures are said one by one (AIM 4-2-7: "niner"), whole
//! thousands and hundreds as words (AIM 4-2-8), which the clearance
//! reader's tokens already join into numbers, as a recognizer that wrote
//! "29.92" or "4,500" itself is read the same way.

use crate::clearance::{letter, tokens, Token};
use crate::json;

/// The wind as said: from where (true, as a broadcast's is: AIM 7-1-11
/// gives the voice wind in degrees true, the tower's in magnetic -- shown
/// as said either way), how fast, its gusts, and whether it is variable.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Wind {
    pub from_deg: Option<i64>,
    pub kt: Option<i64>,
    pub gust_kt: Option<i64>,
    pub variable: bool,
}

/// One cloud layer: its cover in the METAR's words (clear, few,
/// scattered, broken, overcast, obscured) and its base above the ground.
#[derive(Clone, Debug, PartialEq)]
pub struct Layer {
    pub cover: &'static str,
    pub base_ft: Option<i64>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Atis {
    pub information: Option<char>,
    /// "1852Z".
    pub time_z: Option<String>,
    pub wind: Option<Wind>,
    pub visibility_sm: Option<f64>,
    pub sky: Vec<Layer>,
    pub temp_c: Option<i64>,
    pub dewpoint_c: Option<i64>,
    pub altimeter_inhg: Option<f64>,
    /// "ILS runway 19R", "visual", "RNAV GPS runway 7".
    pub approach: Option<String>,
    pub landing: Vec<String>,
    pub departing: Vec<String>,
    /// What else was said, a clause each: NOTAMs, the weather in sight,
    /// the density altitude.
    pub remarks: Vec<String>,
    pub raw: String,
}

/// A word a leftover run is trimmed of at either end, and that makes no
/// remark on its own: the broadcast's connectives and units.
const FILLER: &[&str] = &[
    "and", "at", "the", "a", "an", "is", "are", "in", "on", "to", "of", "with", "this", "that", "for", "or", "weather",
    "observation", "observations", "special", "automated", "degrees", "celsius", "knots", "knot", "miles", "mile", "statute",
    "sky", "condition", "conditions", "time", "expect", "greater", "more", "than", "less", "use", "airport", "information",
    "zulu", "z", "utc", "wind", "winds", "visibility", "temperature", "dew", "dewpoint", "point", "altimeter", "setting",
    "runway", "runways", "clouds", "cloud", "layer", "notams", "notam", "notices", "notice", "airmen", "all", "aircraft", "please",
    "readback", "read", "back", "hold", "short", "instructions", "advise", "initial", "contact", "you", "have", "received",
    "departure", "arrival", "ground", "tower", "frequency", "clearance", "delivery", "available",
];

/// A word in a one-word run worth keeping: the weather in sight, which
/// an ATIS says between the visibility and the sky (AIM 4-1-13).
const PHENOMENA: &[&str] = &[
    "mist", "haze", "fog", "rain", "snow", "drizzle", "thunderstorm", "thunderstorms", "smoke", "showers", "sleet", "hail", "squalls", "dust", "sand",
];

/// The kind of approach, as said, and as written.
fn approach_kind(w: &str) -> Option<&'static str> {
    Some(match w {
        "ils" => "ILS",
        "rnav" => "RNAV",
        "gps" => "GPS",
        "rnp" => "RNP",
        "vor" => "VOR",
        "ndb" => "NDB",
        "lda" => "LDA",
        "loc" | "localizer" => "localizer",
        "visual" | "visuals" => "visual",
        _ => return None,
    })
}

fn cover_of(w: &str) -> Option<&'static str> {
    Some(match w {
        "few" => "few",
        "scattered" => "scattered",
        "broken" => "broken",
        "overcast" => "overcast",
        "obscured" => "obscured",
        _ => return None,
    })
}

/// A whole number said, as an integer; none for "29.92".
fn int_of(t: &Token) -> Option<i64> {
    t.num.as_deref().filter(|n| !n.contains('.')).and_then(|n| n.parse().ok())
}

/// The reading in progress: the tokens, and which of them a figure took.
struct Read<'a> {
    toks: &'a [Token],
    used: Vec<bool>,
    out: Atis,
}

impl Read<'_> {
    fn word(&self, i: usize) -> &str {
        self.toks.get(i).map(|t| t.word.as_str()).unwrap_or("")
    }

    fn int(&self, i: usize) -> Option<i64> {
        self.toks.get(i).and_then(int_of)
    }

    fn num(&self, i: usize) -> Option<&str> {
        self.toks.get(i).and_then(|t| t.num.as_deref())
    }

    fn take(&mut self, from: usize, to: usize) {
        for k in from..to.min(self.toks.len()) {
            self.used[k] = true;
        }
    }

    /// The letter at `i` ("charlie", or a recognizer's bare "c").
    fn letter_at(&self, i: usize) -> Option<char> {
        let w = self.word(i);
        letter(w).or_else(|| (w.len() == 1 && w.as_bytes()[0].is_ascii_lowercase()).then(|| w.to_ascii_uppercase().chars().next().unwrap()))
    }

    /// A runway's ident at `i`: its number, 1 to 36, and its side.
    fn runway_at(&self, i: usize) -> Option<(String, usize)> {
        let n = self.int(i).filter(|n| (1..=36).contains(n))?;
        // A runway's figures are said one by one ("one niner right"), so a
        // number with a point in it, or a 4-figure time, is not one.
        if self.num(i).is_some_and(|s| s.len() > 2) {
            return None;
        }
        let side = match self.word(i + 1) {
            "left" | "l" => "L",
            "right" | "r" => "R",
            "center" | "centre" | "c" => "C",
            _ => "",
        };
        Some((format!("{n}{side}"), i + if side.is_empty() { 1 } else { 2 }))
    }

    /// A visibility at `i` in statute miles: "one zero", "two and one
    /// half", "three quarters", "less than one quarter", "2.5".
    fn visibility_at(&self, i: usize) -> Option<(f64, usize)> {
        let mut j = i;
        while matches!(self.word(j), "is" | "less" | "than" | "a") {
            j += 1;
        }
        let frac = |j: usize, whole: f64| -> Option<(f64, usize)> {
            match self.word(j + 1) {
                "half" => Some((whole / 2.0, j + 2)),
                "quarter" | "quarters" => Some((whole / 4.0, j + 2)),
                _ => None,
            }
        };
        let (mut v, mut j) = if let Some(n) = self.num(j) {
            let n: f64 = n.parse().ok()?;
            frac(j, n).unwrap_or((n, j + 1))
        } else if matches!(self.word(j), "half" | "quarter") {
            (if self.word(j) == "half" { 0.5 } else { 0.25 }, j + 1)
        } else {
            return None;
        };
        if self.word(j) == "and" {
            if let Some((f, k)) = self.num(j + 1).and_then(|n| n.parse::<f64>().ok()).and_then(|n| frac(j + 1, n)) {
                v += f;
                j = k;
            }
        }
        while matches!(self.word(j), "statute" | "miles" | "mile" | "sm") {
            j += 1;
        }
        Some((v, j))
    }

    /// A temperature at `i`: "one eight", "minus zero three", "18 celsius".
    fn celsius_at(&self, i: usize) -> Option<(i64, usize)> {
        let mut j = i;
        if self.word(j) == "is" {
            j += 1;
        }
        let sign = if matches!(self.word(j), "minus" | "negative") {
            j += 1;
            -1
        } else {
            1
        };
        let n = self.int(j)?;
        j += 1;
        while matches!(self.word(j), "celsius" | "degrees") {
            j += 1;
        }
        Some((sign * n, j))
    }

    fn wind(&mut self, i: usize) -> usize {
        let mut j = i + 1;
        while matches!(self.word(j), "is" | "from") {
            j += 1;
        }
        let mut w = Wind::default();
        match self.word(j) {
            "calm" => {
                w.kt = Some(0);
                j += 1;
            }
            "light" if self.word(j + 1) == "and" && self.word(j + 2) == "variable" => {
                w.variable = true;
                j += 3;
            }
            "variable" => {
                w.variable = true;
                j += 1;
            }
            _ => {
                let Some(from) = self.int(j).filter(|n| (0..=360).contains(n)) else { return i + 1 };
                w.from_deg = Some(from);
                j += 1;
                if self.word(j) == "degrees" {
                    j += 1;
                }
            }
        }
        if self.word(j) == "at" {
            if let Some(kt) = self.int(j + 1) {
                w.kt = Some(kt);
                j += 2;
                if self.word(j) == "knots" {
                    j += 1;
                }
            }
        }
        if matches!(self.word(j), "gust" | "gusts" | "gusting") {
            let mut k = j + 1;
            if self.word(k) == "to" {
                k += 1;
            }
            if let Some(g) = self.int(k) {
                w.gust_kt = Some(g);
                j = k + 1;
                if self.word(j) == "knots" {
                    j += 1;
                }
            }
        }
        // "variable between one eight zero and two four zero": the wind's
        // direction varies, which the METAR writes as 180V240.
        if self.word(j) == "variable" && self.word(j + 1) == "between" && self.int(j + 2).is_some() && self.word(j + 3) == "and" && self.int(j + 4).is_some() {
            w.variable = true;
            j += 5;
        }
        // "wind zero zero zero at zero" is calm (the METAR's 00000KT).
        if w.kt == Some(0) {
            w.from_deg = None;
        }
        self.take(i, j);
        self.out.wind = Some(w);
        j
    }

    fn sky_layer(&mut self, i: usize) -> usize {
        let cover = cover_of(self.word(i)).unwrap_or("broken");
        let mut j = i + 1;
        while matches!(self.word(j), "clouds" | "cloud" | "layer" | "at") {
            j += 1;
        }
        let mut from = i;
        let base = if let Some(b) = self.int(j) {
            j += 1;
            Some(b)
        } else if i > 0 && !self.used[i - 1] && self.int(i - 1).is_some() {
            // "two thousand five hundred scattered": the height first.
            from = i - 1;
            self.int(i - 1)
        } else {
            None
        };
        self.take(from, j);
        self.out.sky.push(Layer { cover, base_ft: base });
        j
    }

    fn approach(&mut self, i: usize) -> usize {
        // The phrase round "approach": back to the last figure taken, at
        // most eight words, for its kinds and runways; on through "in use"
        // and a runway after it.
        let mut start = i;
        while start > 0 && i - start < 8 && !self.used[start - 1] {
            start -= 1;
        }
        let mut kinds: Vec<String> = Vec::new();
        let mut runways: Vec<String> = Vec::new();
        let mut first = None;
        let mut k = start;
        while k < i {
            if let Some(kind) = approach_kind(self.word(k)) {
                first.get_or_insert(k);
                // Kinds said together ("RNAV GPS") are one approach.
                if k > start && approach_kind(self.word(k - 1)).is_some() {
                    let last = kinds.pop().unwrap_or_default();
                    kinds.push(format!("{last} {kind}"));
                } else {
                    kinds.push(kind.to_owned());
                }
                k += 1;
            } else if self.word(k) == "runway" && first.is_some() {
                match self.runway_at(k + 1) {
                    Some((r, next)) => {
                        runways.push(r);
                        k = next;
                    }
                    None => k += 1,
                }
            } else {
                k += 1;
            }
        }
        let Some(first) = first else { return i + 1 };
        let mut j = i + 1;
        if self.word(j) == "in" && self.word(j + 1) == "use" {
            j += 2;
        }
        if self.word(j) == "runway" {
            if let Some((r, next)) = self.runway_at(j + 1) {
                runways.push(r);
                j = next;
                if self.word(j) == "in" && self.word(j + 1) == "use" {
                    j += 2;
                }
            }
        }
        let mut said = kinds.join(" and ");
        if !runways.is_empty() {
            said.push_str(if runways.len() == 1 { " runway " } else { " runways " });
            said.push_str(&runways.join(" and "));
        }
        self.take(first, j);
        if self.out.approach.is_none() {
            self.out.approach = Some(said);
        }
        j
    }

    /// "landing and departing runway one niner right", "arriving runway
    /// two five, departing runway three one left", "runway in use one two".
    fn runways(&mut self, i: usize) -> usize {
        let mode = |w: &str| match w {
            "landing" | "arriving" | "arrival" | "arrivals" => Some((true, false)),
            "departing" | "departure" | "departures" => Some((false, true)),
            _ => None,
        };
        let (mut landing, mut departing) = match self.word(i) {
            "runway" | "runways" | "using" | "active" => (true, true),
            w => match mode(w) {
                Some(m) => m,
                None => return i + 1,
            },
        };
        let mut j = i + 1;
        if self.word(j) == "and" {
            if let Some((l, d)) = mode(self.word(j + 1)) {
                landing |= l;
                departing |= d;
                j += 2;
            }
        }
        while matches!(self.word(j), "runway" | "runways" | "on" | "in" | "use" | "is" | "are") {
            j += 1;
        }
        let mut found = Vec::new();
        while let Some((r, next)) = self.runway_at(j) {
            found.push(r);
            j = next;
            if self.word(j) == "and" && self.runway_at(j + 1).is_some() {
                j += 1;
            }
        }
        if found.is_empty() {
            return i + 1;
        }
        self.take(i, j);
        if landing {
            self.out.landing.extend(found.iter().cloned());
        }
        if departing {
            self.out.departing.extend(found);
        }
        j
    }

    /// The leftover runs of words, each a remark: trimmed of filler, and
    /// dropped where one word is left unless it is weather.
    fn remarks(&mut self, after: usize) {
        let mut i = after;
        while i < self.toks.len() {
            if self.used[i] {
                i += 1;
                continue;
            }
            let start = i;
            while i < self.toks.len() && !self.used[i] {
                i += 1;
            }
            let mut a = start;
            let mut b = i;
            while a < b && FILLER.contains(&self.word(a)) {
                a += 1;
            }
            while b > a && FILLER.contains(&self.word(b - 1)) {
                b -= 1;
            }
            if b - a >= 2 || (b - a == 1 && PHENOMENA.contains(&self.word(a))) {
                let words: Vec<&str> = self.toks[a..b].iter().map(|t| t.num.as_deref().unwrap_or(&t.word)).collect();
                self.out.remarks.push(words.join(" "));
            }
        }
    }
}

/// The broadcast read, as far as it was heard: a figure not said, or
/// not understood, is left out rather than guessed.
pub fn read(text: &str) -> Atis {
    let toks = tokens(text);
    let n = toks.len();
    let mut r = Read { toks: &toks, used: vec![false; n], out: Atis { raw: text.trim().to_owned(), ..Atis::default() } };
    // Where the first figure was taken: the words before it name the
    // field and are no remark.
    let mut first_taken = n;
    let mut i = 0;
    while i < n {
        if r.used[i] {
            i += 1;
            continue;
        }
        let w = r.word(i).to_owned();
        let next = match w.as_str() {
            // The closing line, with the letter said again.
            "advise" if r.word(i + 1) == "on" || r.word(i + 1) == "you" => {
                let mut j = i + 1;
                while j < n && j - i < 10 && !(r.word(j) == "information" && r.letter_at(j + 1).is_some()) {
                    j += 1;
                }
                let j = if j < n && j - i < 10 { j + 2 } else { i + 4 };
                r.take(i, j);
                j
            }
            "information" => match r.letter_at(i + 1) {
                Some(l) => {
                    r.out.information.get_or_insert(l);
                    r.take(i, i + 2);
                    i + 2
                }
                None => i + 1,
            },
            "zulu" | "z" | "utc" if i > 0 => {
                // The time before it: "one eight five two", or a recognizer's
                // "18:52" in two figures.
                let (digits, from) = match (r.num(i - 1), i.checked_sub(2).and_then(|k| r.num(k))) {
                    (Some(a), Some(b)) if a.len() == 2 && b.len() == 2 && !r.used[i - 2] => (format!("{b}{a}"), i - 2),
                    (Some(a), _) if (3..=4).contains(&a.len()) => (format!("{a:0>4}"), i - 1),
                    _ => (String::new(), i),
                };
                let ok = digits.len() == 4 && digits[..2].parse::<u32>().is_ok_and(|h| h < 24) && digits[2..].parse::<u32>().is_ok_and(|m| m < 60);
                if ok && r.out.time_z.is_none() {
                    r.out.time_z = Some(format!("{digits}Z"));
                    let from = if from > 0 && r.word(from - 1) == "time" { from - 1 } else { from };
                    r.take(from, i + 1);
                }
                i + 1
            }
            "wind" | "winds" => r.wind(i),
            "visibility" => match r.visibility_at(i + 1) {
                Some((v, j)) => {
                    r.out.visibility_sm.get_or_insert(v);
                    r.take(i, j);
                    j
                }
                None => i + 1,
            },
            "few" | "scattered" | "broken" | "overcast" => r.sky_layer(i),
            "ceiling" => {
                // "ceiling one thousand two hundred broken"; said without its
                // cover, a ceiling is at least broken (14 CFR 1.1's "ceiling").
                let mut j = i + 1;
                if r.word(j) == "is" {
                    j += 1;
                }
                // "indefinite ceiling three hundred sky obscured" (AIM
                // 7-1-11): an obscuration's vertical visibility, a ceiling.
                let from = if i > 0 && r.word(i - 1) == "indefinite" { i - 1 } else { i };
                match r.int(j) {
                    Some(base) => {
                        let cover = cover_of(r.word(j + 1)).unwrap_or(if r.word(j + 1) == "sky" && r.word(j + 2) == "obscured" { "obscured" } else { "broken" });
                        let end = j + 1 + if cover_of(r.word(j + 1)).is_some() { 1 } else if cover == "obscured" { 2 } else { 0 };
                        r.take(from, end);
                        r.out.sky.push(Layer { cover, base_ft: Some(base) });
                        end
                    }
                    None => i + 1,
                }
            }
            "clear" if matches!(r.word(i + 1), "below" | "skies" | "sky") || (i > 0 && matches!(r.word(i - 1), "sky" | "skies" | "condition" | "conditions")) => {
                let from = if i > 0 && matches!(r.word(i - 1), "sky" | "skies" | "condition" | "conditions") { i - 1 } else { i };
                let mut j = i + 1;
                if r.word(j) == "below" && r.int(j + 1).is_some() {
                    j += 2;
                } else if matches!(r.word(j), "skies" | "sky") {
                    j += 1;
                }
                r.take(from, j);
                r.out.sky.push(Layer { cover: "clear", base_ft: None });
                j
            }
            "temperature" => match r.celsius_at(i + 1) {
                Some((t, j)) => {
                    r.out.temp_c.get_or_insert(t);
                    r.take(i, j);
                    j
                }
                None => i + 1,
            },
            "dew" | "dewpoint" => {
                let from = i + if w == "dew" && r.word(i + 1) == "point" { 2 } else { 1 };
                match r.celsius_at(from) {
                    Some((t, j)) => {
                        r.out.dewpoint_c.get_or_insert(t);
                        r.take(i, j);
                        j
                    }
                    None => i + 1,
                }
            }
            "altimeter" => {
                let mut j = i + 1;
                while matches!(r.word(j), "setting" | "is") {
                    j += 1;
                }
                // Four figures, "two niner niner two", or the recognizer's
                // "29.92" or "29 92"; a setting outside 25 to 32 inches was
                // misheard (ASOS reports to 31.00 and is set on the ground
                // from 28.00).
                let (value, end) = match (r.num(j), r.num(j + 1)) {
                    (Some(a), _) if a.contains('.') => (a.parse::<f64>().ok(), j + 1),
                    (Some(a), _) if a.len() == 4 => (format!("{}.{}", &a[..2], &a[2..]).parse().ok(), j + 1),
                    (Some(a), Some(b)) if a.len() == 2 && b.len() == 2 => (format!("{a}.{b}").parse().ok(), j + 2),
                    _ => (None, j),
                };
                match value.filter(|v| (25.0..=32.0).contains(v)) {
                    Some(v) => {
                        r.out.altimeter_inhg.get_or_insert(v);
                        r.take(i, end);
                        end
                    }
                    None => i + 1,
                }
            }
            "approach" | "approaches" => r.approach(i),
            "landing" | "arriving" | "arrival" | "arrivals" | "departing" | "departure" | "departures" => r.runways(i),
            "runway" | "runways" if r.word(i + 1) == "in" && r.word(i + 2) == "use" => r.runways(i),
            "using" | "active" if r.word(i + 1) == "runway" || r.word(i + 1) == "runways" => r.runways(i),
            "remarks" | "remark" => {
                // Everything after it is remarks, to the closing line.
                let mut j = i + 1;
                while j < n && !(r.word(j) == "advise" && (r.word(j + 1) == "on" || r.word(j + 1) == "you")) {
                    j += 1;
                }
                r.take(i, i + 1);
                let words: Vec<&str> = r.toks[i + 1..j].iter().map(|t| t.num.as_deref().unwrap_or(&t.word)).collect();
                if !words.is_empty() {
                    r.out.remarks.push(words.join(" "));
                }
                r.take(i + 1, j);
                j
            }
            _ => i + 1,
        };
        if next > i + 1 || r.used[i] {
            first_taken = first_taken.min(i);
        }
        i = next.max(i + 1);
    }
    r.remarks(first_taken);
    r.out
}

/// A number written whole where it is one: 10, not 10.0, as the fixture
/// has it and the web's JSON.parse reads it either way.
fn figure(out: &mut String, v: f64) {
    if v.fract() == 0.0 && v.abs() < 1e15 {
        out.push_str(&format!("{}", v as i64));
    } else {
        json::number(out, v);
    }
}

fn opt_int(out: &mut String, v: Option<i64>) {
    match v {
        Some(v) => out.push_str(&v.to_string()),
        None => out.push_str("null"),
    }
}

fn strings(out: &mut String, items: &[String]) {
    out.push('[');
    for (k, s) in items.iter().enumerate() {
        if k > 0 {
            out.push(',');
        }
        json::string(out, s);
    }
    out.push(']');
}

impl Atis {
    /// The reading as the rule `read_atis` answers it: `{information,
    /// time_z, wind: {from_deg, kt, gust_kt, variable}|null,
    /// visibility_sm, sky: [{cover, base_ft}], temp_c, dewpoint_c,
    /// altimeter_inhg, approach, runways: {landing, departing}, remarks,
    /// raw}`, a figure not heard null.
    pub fn to_json(&self) -> String {
        let mut o = String::from("{\"information\":");
        json::opt_string(&mut o, self.information.map(String::from).as_deref());
        o.push_str(",\"time_z\":");
        json::opt_string(&mut o, self.time_z.as_deref());
        o.push_str(",\"wind\":");
        match &self.wind {
            None => o.push_str("null"),
            Some(w) => {
                o.push_str("{\"from_deg\":");
                opt_int(&mut o, w.from_deg);
                o.push_str(",\"kt\":");
                opt_int(&mut o, w.kt);
                o.push_str(",\"gust_kt\":");
                opt_int(&mut o, w.gust_kt);
                o.push_str(&format!(",\"variable\":{}}}", w.variable));
            }
        }
        o.push_str(",\"visibility_sm\":");
        match self.visibility_sm {
            Some(v) => figure(&mut o, v),
            None => o.push_str("null"),
        }
        o.push_str(",\"sky\":[");
        for (k, l) in self.sky.iter().enumerate() {
            if k > 0 {
                o.push(',');
            }
            o.push_str(&format!("{{\"cover\":\"{}\",\"base_ft\":", l.cover));
            opt_int(&mut o, l.base_ft);
            o.push('}');
        }
        o.push_str("],\"temp_c\":");
        opt_int(&mut o, self.temp_c);
        o.push_str(",\"dewpoint_c\":");
        opt_int(&mut o, self.dewpoint_c);
        o.push_str(",\"altimeter_inhg\":");
        match self.altimeter_inhg {
            Some(v) => json::number(&mut o, v),
            None => o.push_str("null"),
        }
        o.push_str(",\"approach\":");
        json::opt_string(&mut o, self.approach.as_deref());
        o.push_str(",\"runways\":{\"landing\":");
        strings(&mut o, &self.landing);
        o.push_str(",\"departing\":");
        strings(&mut o, &self.departing);
        o.push_str("},\"remarks\":");
        strings(&mut o, &self.remarks);
        o.push_str(",\"raw\":");
        json::string(&mut o, &self.raw);
        o.push('}');
        o
    }
}
