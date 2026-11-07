//! An ATC clearance as the phone heard it, read into its items -- the web
//! app's lib/clearance and lib/heardCall, here so the native app reads one
//! in the air with no signal. Both are held to the same fixtures
//! (web/src/lib/fixtures/clearances.json and heardCalls.json; the
//! engine's tests/clearance.rs).
//!
//! AIM 4-4-3 lists what a clearance holds: its limit, its departure
//! procedure, the route, the altitudes, the frequency and the beacon code.
//! Figures are said one by one (AIM 4-2-7: "tree", "fife", "niner"), whole
//! thousands and hundreds as words (AIM 4-2-8: "one three thousand five
//! hundred"), flight levels by their figures (AIM 4-2-9), and "then as
//! filed" leaves the filed route after what was said (AIM 5-2-6).

use crate::json;

/// A word, or a number made of the figures said in a row.
#[derive(Clone, Debug, PartialEq)]
pub struct Token {
    pub word: String,
    pub num: Option<String>,
}

/// A part of the route, in the order it was said.
#[derive(Clone, Debug, PartialEq)]
pub enum Item {
    Vectors,
    Heading(i64),
    Airway(String),
    /// A SID ("departure") or a STAR ("arrival") by its name and number.
    Procedure { kind: &'static str, name: String, number: String, transition: Option<String> },
    /// Words naming one place or more, to be found.
    Places(String),
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Clearance {
    pub limit: Option<String>,
    pub route: Vec<Item>,
    pub as_filed: bool,
    pub maintain_ft: Option<i64>,
    pub maintain_limit: Option<String>,
    pub vfr: bool,
    pub expect_ft: Option<i64>,
    pub expect_min: Option<i64>,
    pub frequency: Option<String>,
    pub facility: Option<String>,
    pub squawk: Option<String>,
    pub class_b: bool,
}

/// The ICAO alphabet (AIM 4-2-7, TBL 4-2-7), as a recognizer writes it.
pub fn letter(w: &str) -> Option<char> {
    Some(match w {
        "alpha" | "alfa" => 'A',
        "bravo" => 'B',
        "charlie" => 'C',
        "delta" => 'D',
        "echo" => 'E',
        "foxtrot" => 'F',
        "golf" => 'G',
        "hotel" => 'H',
        "india" => 'I',
        "juliet" | "juliett" => 'J',
        "kilo" => 'K',
        "lima" => 'L',
        "mike" => 'M',
        "november" => 'N',
        "oscar" => 'O',
        "papa" => 'P',
        "quebec" => 'Q',
        "romeo" => 'R',
        "sierra" => 'S',
        "tango" => 'T',
        "uniform" => 'U',
        "victor" => 'V',
        "whiskey" | "whisky" => 'W',
        "xray" => 'X',
        "yankee" => 'Y',
        "zulu" => 'Z',
        _ => return None,
    })
}

/// A figure said one by one (AIM 4-2-7).
pub fn digit(w: &str) -> Option<char> {
    Some(match w {
        "zero" => '0',
        "one" => '1',
        "two" => '2',
        "three" | "tree" => '3',
        "four" | "fower" => '4',
        "five" | "fife" => '5',
        "six" => '6',
        "seven" => '7',
        "eight" | "ait" => '8',
        "nine" | "niner" => '9',
        _ => return None,
    })
}

/// An airway's number said whole (AIM 4-2-8: "Victor Twelve"), and minutes.
fn teen(w: &str) -> Option<&'static str> {
    Some(match w {
        "ten" => "10",
        "eleven" => "11",
        "twelve" => "12",
        "thirteen" => "13",
        "fourteen" => "14",
        "fifteen" => "15",
        "sixteen" => "16",
        "seventeen" => "17",
        "eighteen" => "18",
        "nineteen" => "19",
        _ => return None,
    })
}

fn tens(w: &str) -> Option<char> {
    Some(match w {
        "twenty" => '2',
        "thirty" => '3',
        "forty" => '4',
        "fifty" => '5',
        "sixty" => '6',
        "seventy" => '7',
        "eighty" => '8',
        "ninety" => '9',
        _ => return None,
    })
}

/// The letter each kind of airway is filed by, as said.
fn airway_letter(w: &str) -> Option<char> {
    Some(match w {
        "victor" | "v" => 'V',
        "tango" | "t" => 'T',
        "j" | "jay" | "juliet" | "juliett" => 'J',
        "q" | "quebec" => 'Q',
        _ => return None,
    })
}

fn is_ascii_digits(w: &str) -> bool {
    !w.is_empty() && w.bytes().all(|b| b.is_ascii_digit())
}

/// "125", "125.35": figures, a point and figures.
fn is_numeral(w: &str) -> bool {
    match w.split_once('.') {
        Some((a, b)) => is_ascii_digits(a) && is_ascii_digits(b),
        None => is_ascii_digits(w),
    }
}

fn is_digit(w: &str) -> bool {
    digit(w).is_some() || (w.len() == 1 && is_ascii_digits(w))
}

fn digit_of(w: &str) -> char {
    digit(w).unwrap_or_else(|| w.chars().next().unwrap_or('0'))
}

/// The words a recognizer wrote, lower case: runs of figures (with a
/// point between them) and runs of letters (with an apostrophe inside),
/// "x-ray" one word and "3,000" one number.
fn words_of(text: &str) -> Vec<String> {
    let lower = text.to_lowercase().replace("x-ray", "xray").replace("x ray", "xray");
    let chars: Vec<char> = lower.chars().collect();
    // "3,000": the comma between figures and three more is no break.
    let mut clean = String::with_capacity(chars.len());
    for (i, &c) in chars.iter().enumerate() {
        let thousands = c == ','
            && i > 0
            && chars[i - 1].is_ascii_digit()
            && chars.get(i + 1..i + 4).is_some_and(|s| s.iter().all(|d| d.is_ascii_digit()));
        if !thousands {
            clean.push(c);
        }
    }
    let c: Vec<char> = clean.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < c.len() {
        if c[i].is_ascii_digit() {
            let mut j = i;
            while j < c.len() && c[j].is_ascii_digit() {
                j += 1;
            }
            if j + 1 < c.len() && c[j] == '.' && c[j + 1].is_ascii_digit() {
                j += 1;
                while j < c.len() && c[j].is_ascii_digit() {
                    j += 1;
                }
            }
            out.push(c[i..j].iter().collect());
            i = j;
        } else if c[i].is_ascii_lowercase() {
            let mut j = i;
            while j < c.len() && c[j].is_ascii_lowercase() {
                j += 1;
            }
            if j + 1 < c.len() && c[j] == '\'' && c[j + 1].is_ascii_lowercase() {
                j += 1;
                while j < c.len() && c[j].is_ascii_lowercase() {
                    j += 1;
                }
            }
            out.push(c[i..j].iter().collect());
            i = j;
        } else {
            i += 1;
        }
    }
    out
}

/// The words, with each run of figures one number: "one two five point
/// three five" is 125.35, "three thousand five hundred" 3500, "one zero
/// thousand" 10000 (AIM 4-2-8, 4-2-9). After "thousand" only a "five
/// hundred" goes on: "seven thousand one zero minutes" is 7000 and 10.
pub fn tokens(text: &str) -> Vec<Token> {
    let words = words_of(text);
    let at = |k: usize| words.get(k).map(String::as_str);
    let is_number_word = |w: &str| is_digit(w) || teen(w).is_some() || tens(w).is_some() || is_numeral(w);
    let mut out = Vec::new();
    let mut i = 0;
    while i < words.len() {
        let w = words[i].as_str();
        if !is_number_word(w) {
            out.push(Token { word: w.to_owned(), num: None });
            i += 1;
            continue;
        }
        let mut s = String::new();
        let mut thousands: i64 = 0;
        let start = i;
        // A number written whole by the recognizer stands alone, but for a
        // thousand or a hundred after it.
        if is_numeral(w) && !(w.len() == 1 && is_ascii_digits(w)) {
            s = w.to_owned();
            i += 1;
        } else {
            while let Some(x) = at(i) {
                if is_digit(x) || (x == "oh" && !s.is_empty()) {
                    s.push(if x == "oh" { '0' } else { digit_of(x) });
                } else if let Some(t) = teen(x) {
                    s.push_str(t);
                } else if let Some(t) = tens(x) {
                    match at(i + 1) {
                        Some(next) if is_digit(next) && digit_of(next) != '0' => {
                            s.push(t);
                            s.push(digit_of(next));
                            i += 1;
                        }
                        _ => {
                            s.push(t);
                            s.push('0');
                        }
                    }
                } else {
                    break;
                }
                i += 1;
            }
        }
        if at(i) == Some("thousand") {
            thousands = s.parse::<i64>().unwrap_or(1) * 1000;
            s.clear();
            i += 1;
            match (at(i), at(i + 1)) {
                (Some(next), Some("hundred")) if is_digit(next) => {
                    thousands += (digit_of(next) as i64 - '0' as i64) * 100;
                    i += 2;
                }
                (Some(next), _) if next.len() == 3 && next.ends_with("00") && is_ascii_digits(next) => {
                    thousands += next.parse::<i64>().unwrap_or(0);
                    i += 1;
                }
                _ => {}
            }
        } else if at(i) == Some("hundred") && !s.is_empty() {
            thousands = s.parse::<i64>().unwrap_or(0) * 100;
            s.clear();
            i += 1;
        }
        if matches!(at(i), Some("point") | Some("decimal")) && at(i + 1).is_some_and(is_digit) && thousands == 0 {
            i += 1;
            let mut fraction = String::new();
            while let Some(x) = at(i) {
                if !is_digit(x) {
                    break;
                }
                fraction.push(digit_of(x));
                i += 1;
            }
            s = format!("{s}.{fraction}");
        }
        let num = if thousands != 0 { (thousands + s.parse::<i64>().unwrap_or(0)).to_string() } else { s };
        out.push(Token { word: words[start..i].join(" "), num: Some(num) });
    }
    out
}

/// Aviation's VHF voice band, 118.000 to 136.975 MHz (47 CFR 87.173(b)'s
/// table): a frequency out of it was misheard. A recognizer's "12535" is
/// 125.35.
pub fn frequency_of(num: &str) -> Option<String> {
    let (value, places) = if let Some((_, fraction)) = num.split_once('.') {
        (num.parse::<f64>().ok()?, fraction.len().max(1))
    } else if (5..=7).contains(&num.len()) && num.starts_with('1') && matches!(num.as_bytes()[1], b'1' | b'2' | b'3') && is_ascii_digits(num) {
        (format!("{}.{}", &num[..3], &num[3..]).parse::<f64>().ok()?, (num.len() - 3).max(1))
    } else {
        return None;
    };
    ((118.0..=136.975).contains(&value)).then(|| format!("{value:.places$}"))
}

/// A beacon code: one of AIM 4-1-20's "4096 discrete codes, a four-digit
/// code designation" -- 8 to the fourth, so each figure 0 to 7.
fn is_squawk(code: &str) -> bool {
    code.len() == 4 && code.bytes().all(|b| (b'0'..=b'7').contains(&b))
}

const ALTITUDE_WORDS: &[&str] = &["climb", "maintain", "descend", "cruise", "expect"];
const AFTER_ROUTE_MORE: &[&str] = &["squawk", "contact", "transponder"];
const LIMIT_ENDS_MORE: &[&str] = &["via", "as", "then", "radar", "vectors", "direct", "fly", "heading"];
/// Words between places, not places: "then direct", "to".
const BETWEEN: &[&str] = &["then", "direct", "to", "and", "thence", "via", "the"];
/// "Cleared ILS approach", "cleared visual": an approach, not a route.
const APPROACH_WORDS: &[&str] = &["ils", "rnp", "rnav", "gps", "loc", "visual", "approach", "vor", "ndb"];
/// Whose a frequency is, said before it.
const FACILITIES: &[&str] = &["departure", "center", "approach", "tower", "ground", "clearance", "information", "apron", "radio", "unicom", "director"];

fn after_route(w: &str) -> bool {
    ALTITUDE_WORDS.contains(&w) || AFTER_ROUTE_MORE.contains(&w)
}

fn limit_ends(w: &str) -> bool {
    after_route(w) || LIMIT_ENDS_MORE.contains(&w)
}

/// "departure" as the frequency's, not a SID's.
fn is_facility(toks: &[Token], i: usize) -> bool {
    toks.get(i + 1).is_some_and(|n| n.num.is_some() || ["control", "frequency", "freq", "will", "is", "on"].contains(&n.word.as_str()))
}

/// An altitude at `i` (AIM 4-2-9), with how many tokens it took.
fn altitude_at(toks: &[Token], i: usize) -> Option<(i64, usize)> {
    let word = |k: usize| toks.get(k).map(|t| t.word.as_str());
    let num = |k: usize| toks.get(k).and_then(|t| t.num.as_deref());
    if word(i) == Some("flight") && word(i + 1) == Some("level") {
        if let Some(level) = num(i + 2).and_then(|n| n.parse::<f64>().ok()) {
            return Some(((level * 100.0) as i64, 3));
        }
    }
    if word(i) == Some("fl") {
        if let Some(level) = num(i + 1).and_then(|n| n.parse::<f64>().ok()) {
            return Some(((level * 100.0) as i64, 2));
        }
    }
    let n = num(i)?;
    if n.contains('.') {
        return None;
    }
    let ft = n.parse::<i64>().ok()?;
    (500..60000).contains(&ft).then_some((ft, 1))
}

/// Words for a place as it is looked up: a run of the ICAO alphabet's
/// words (with figures after them) is the letters it spells, "kilo delta
/// lima hotel" KDLH, "charlie eight one" C81.
pub fn place_words(toks: &[Token]) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut i = 0;
    while i < toks.len() {
        let mut j = i;
        let mut spelled = String::new();
        while j < toks.len() {
            let t = &toks[j];
            if let Some(l) = letter(&t.word) {
                spelled.push(l);
            } else if !spelled.is_empty() && t.num.as_deref().is_some_and(|n| !n.contains('.')) {
                spelled.push_str(t.num.as_deref().unwrap());
            } else {
                break;
            }
            j += 1;
        }
        if j - i >= 2 {
            out.push(spelled);
            i = j;
        } else {
            out.push(toks[i].num.clone().unwrap_or_else(|| toks[i].word.clone()));
            i += 1;
        }
    }
    out.join(" ")
}

/// The route's words into its parts.
fn route_of(toks: &[Token]) -> (Vec<Item>, bool) {
    let mut route = Vec::new();
    let mut as_filed = false;
    let mut words: Vec<Token> = Vec::new();
    fn flush(words: &mut Vec<Token>, route: &mut Vec<Item>) {
        let said = place_words(words).trim().to_owned();
        if !said.is_empty() {
            route.push(Item::Places(said));
        }
        words.clear();
    }
    let word = |k: usize| toks.get(k).map(|t| t.word.as_str());
    let mut i = 0;
    while i < toks.len() {
        let t = &toks[i];
        let w = t.word.as_str();
        if w == "as" && word(i + 1) == Some("filed") {
            flush(&mut words, &mut route);
            as_filed = true;
            i += 1;
        } else if w == "radar" && word(i + 1) == Some("vectors") {
            flush(&mut words, &mut route);
            route.push(Item::Vectors);
            i += 1;
        } else if w == "vectors" {
            flush(&mut words, &mut route);
            route.push(Item::Vectors);
        } else if let (Some(l), Some(n)) = (airway_letter(w), toks.get(i + 1).and_then(|n| n.num.as_deref())) {
            if (1..=4).contains(&n.len()) && is_ascii_digits(n) && !words.iter().any(|x| letter(&x.word).is_some()) {
                flush(&mut words, &mut route);
                route.push(Item::Airway(format!("{l}{n}")));
                i += 1;
            } else {
                words.push(t.clone());
            }
        } else if w == "heading" && toks.get(i + 1).and_then(|n| n.num.as_deref()).is_some() {
            flush(&mut words, &mut route);
            let n = toks[i + 1].num.as_deref().unwrap();
            route.push(Item::Heading(n.parse::<f64>().unwrap_or(0.0) as i64));
            i += 1;
        } else if (w == "departure" || w == "arrival") && words.len() >= 2 && words.last().is_some_and(|x| x.num.is_some()) {
            let number = words.last().unwrap().num.clone().unwrap();
            let name = place_words(&words[..words.len() - 1]);
            words.clear();
            let mut transition = None;
            if let Some(end) = (i + 1..toks.len()).find(|&k| toks[k].word == "transition") {
                if end - i <= 4 {
                    let said: Vec<Token> = toks[i + 1..end].iter().filter(|x| !BETWEEN.contains(&x.word.as_str())).cloned().collect();
                    let said = place_words(&said);
                    transition = (!said.is_empty()).then_some(said);
                    i = end;
                }
            }
            route.push(Item::Procedure { kind: if w == "departure" { "departure" } else { "arrival" }, name, number, transition });
        } else if BETWEEN.contains(&w) || w == "fly" || w == "after" {
            flush(&mut words, &mut route);
        } else {
            words.push(t.clone());
        }
        i += 1;
    }
    flush(&mut words, &mut route);
    (route, as_filed)
}

/// The clearance in what was heard: everything after "cleared" (the call
/// sign before it left out), its altitudes, frequency and code wherever
/// they were said -- a squawk alone, as flight following's, is one too.
pub fn read(text: &str) -> Clearance {
    let toks = tokens(text);
    let word = |k: usize| toks.get(k).map(|t| t.word.as_str());
    let mut out = Clearance::default();
    // Where the limit and the route were read, which the rest is not
    // looked for in: the altitudes, frequency and code are said before
    // "cleared" too.
    let (mut from, mut rest) = (toks.len(), 0);
    if let Some(cleared) = toks.iter().position(|t| t.word == "cleared" || t.word == "clear") {
        from = cleared;
        let mut i = cleared + 1;
        if matches!(word(i), Some("into") | Some("through")) {
            // A Class B's: "cleared into the Class Bravo airspace".
            out.class_b = toks[i..(i + 5).min(toks.len())].iter().any(|t| t.word == "bravo" || t.word == "b");
            i = match (i + 1..toks.len()).find(|&k| toks[k].word == "airspace") {
                Some(k) => k + 1,
                None => i + 4,
            };
        } else if word(i).is_some_and(|w| w == "for" || w == "on" || APPROACH_WORDS.contains(&w)) || (word(i) == Some("to") && word(i + 1) == Some("land")) {
            // No route in it, the altitudes after it still read.
        } else {
            if word(i) == Some("to") || toks.get(i).and_then(|t| t.num.as_deref()) == Some("2") {
                i += 1;
            }
            let start = i;
            while i < toks.len() && !limit_ends(&toks[i].word) && !(toks[i].word == "departure" && is_facility(&toks, i)) {
                i += 1;
                if toks[i - 1].word == "airport" {
                    break;
                }
            }
            let limit: Vec<Token> = toks[start..i].iter().filter(|t| t.word != "the").cloned().collect();
            let limit = place_words(&limit);
            out.limit = (!limit.is_empty()).then_some(limit);
            let end = (i..toks.len()).find(|&k| after_route(&toks[k].word) || (toks[k].word == "departure" && is_facility(&toks, k)));
            let (route, as_filed) = route_of(&toks[i..end.unwrap_or(toks.len())]);
            out.route = route;
            out.as_filed = as_filed;
            i = end.unwrap_or(toks.len());
        }
        rest = i;
    }
    let mut i = 0;
    while i < toks.len() {
        if i >= from && i < rest {
            i = rest;
            if i >= toks.len() {
                break;
            }
        }
        let t = &toks[i];
        let w = t.word.as_str();
        if ["maintain", "cruise", "climb", "descend"].contains(&w) && out.maintain_ft.is_none() {
            // "Climb and maintain" is read at its "maintain"; "climb to
            // five thousand", "descend flight level seven zero" at the verb.
            let mut k = i + 1;
            while (w == "climb" || w == "descend") && word(k).is_some_and(|x| ["to", "initially", "altitude"].contains(&x)) {
                k += 1;
            }
            if word(k) == Some("vfr") {
                out.vfr = true;
                k += 1;
            }
            if word(k) == Some("at") && word(k + 1) == Some("or") && matches!(word(k + 2), Some("below") | Some("above")) {
                out.maintain_limit = Some(format!("at or {}", word(k + 2).unwrap()));
                k += 3;
            }
            if let Some((ft, used)) = altitude_at(&toks, k) {
                out.maintain_ft = Some(ft);
                i = k + used - 1;
            }
        } else if w == "expect" && out.expect_ft.is_none() {
            if let Some((ft, used)) = altitude_at(&toks, i + 1) {
                out.expect_ft = Some(ft);
                i += used;
                // "...one zero minutes after departure".
                let minutes = (i + 1..(i + 4).min(toks.len())).find(|&k| ["minutes", "minute", "min"].contains(&toks[k].word.as_str()));
                if let Some(m) = minutes {
                    if m - i > 1 {
                        out.expect_min = toks[m - 1].num.as_deref().and_then(|n| n.parse::<f64>().ok()).map(|n| n as i64);
                    }
                }
            }
        } else if w == "squawk" || w == "transponder" || w == "code" {
            let code = toks[i + 1..(i + 3).min(toks.len())].iter().find_map(|x| x.num.clone());
            if let Some(code) = code {
                if is_squawk(&code) && out.squawk.is_none() {
                    out.squawk = Some(code);
                }
            }
        } else if let Some(num) = &t.num {
            if out.frequency.is_none() {
                let said: Vec<&str> = toks[i.saturating_sub(4)..i].iter().map(|x| x.word.as_str()).collect();
                let facility = said.iter().rev().find(|w| FACILITIES.contains(w)).map(|w| (*w).to_owned());
                if let Some(frequency) = frequency_of(num) {
                    if facility.is_some() || said.contains(&"contact") || said.contains(&"monitor") || said.contains(&"frequency") {
                        out.frequency = Some(frequency);
                        out.facility = facility;
                    }
                }
            }
        }
        i += 1;
    }
    out
}

impl Clearance {
    /// The words of each run of places, in order, for them to be found.
    pub fn place_runs(&self) -> Vec<&str> {
        self.route.iter().filter_map(|i| if let Item::Places(s) = i { Some(s.as_str()) } else { None }).collect()
    }

    /// The clearance as the web app's Clearance is written (its field
    /// names), JSON.
    pub fn to_json(&self) -> String {
        let mut o = String::from("{\"limit\":");
        json::opt_string(&mut o, self.limit.as_deref());
        o.push_str(",\"route\":[");
        for (k, item) in self.route.iter().enumerate() {
            if k > 0 {
                o.push(',');
            }
            match item {
                Item::Vectors => o.push_str("{\"kind\":\"vectors\"}"),
                Item::Heading(d) => o.push_str(&format!("{{\"kind\":\"heading\",\"degrees\":{d}}}")),
                Item::Airway(a) => {
                    o.push_str("{\"kind\":\"airway\",\"ident\":");
                    json::string(&mut o, a);
                    o.push('}');
                }
                Item::Places(s) => {
                    o.push_str("{\"kind\":\"places\",\"said\":");
                    json::string(&mut o, s);
                    o.push('}');
                }
                Item::Procedure { kind, name, number, transition } => {
                    o.push_str(&format!("{{\"kind\":\"{kind}\",\"name\":"));
                    json::string(&mut o, name);
                    o.push_str(",\"number\":");
                    json::string(&mut o, number);
                    o.push_str(",\"transition\":");
                    json::opt_string(&mut o, transition.as_deref());
                    o.push('}');
                }
            }
        }
        o.push_str("],\"asFiled\":");
        o.push_str(if self.as_filed { "true" } else { "false" });
        let int = |o: &mut String, v: Option<i64>| match v {
            Some(v) => o.push_str(&v.to_string()),
            None => o.push_str("null"),
        };
        o.push_str(",\"maintainFt\":");
        int(&mut o, self.maintain_ft);
        o.push_str(",\"maintainLimit\":");
        json::opt_string(&mut o, self.maintain_limit.as_deref());
        o.push_str(",\"vfr\":");
        o.push_str(if self.vfr { "true" } else { "false" });
        o.push_str(",\"expectFt\":");
        int(&mut o, self.expect_ft);
        o.push_str(",\"expectMin\":");
        int(&mut o, self.expect_min);
        o.push_str(",\"frequency\":");
        json::opt_string(&mut o, self.frequency.as_deref());
        o.push_str(",\"facility\":");
        json::opt_string(&mut o, self.facility.as_deref());
        o.push_str(",\"squawk\":");
        json::opt_string(&mut o, self.squawk.as_deref());
        o.push_str(",\"classB\":");
        o.push_str(if self.class_b { "true" } else { "false" });
        o.push('}');
        o
    }
}

/// Two idents one field: "KDLH" and "DLH" (the web's sameField).
pub fn same_field(a: &str, b: &str) -> bool {
    fn bare(s: &str) -> String {
        let s = s.trim().to_uppercase();
        if s.len() == 4 && s.starts_with('K') && s[1..].bytes().all(|c| c.is_ascii_alphanumeric()) {
            s[1..].to_owned()
        } else {
            s
        }
    }
    bare(a) == bare(b)
}

fn is_airway(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 2 && b.len() <= 5 && matches!(b[0], b'V' | b'T' | b'J' | b'Q') && b[1..].iter().all(u8::is_ascii_digit)
}

/// A place found for words said: its ident, none where nothing was.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Found {
    pub said: String,
    pub ident: Option<String>,
    pub name: Option<String>,
    pub kind: Option<&'static str>,
    pub sure: bool,
}

/// A SID or STAR found among its field's: its identifier and transition.
#[derive(Clone, Debug, PartialEq)]
pub struct FoundProcedure {
    pub id: String,
    pub transition: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct FoundPlaces {
    pub limit: Option<Found>,
    pub route: Vec<Vec<Found>>,
    pub departure: Option<FoundProcedure>,
    pub arrival: Option<FoundProcedure>,
}

/// A procedure to pick: its name and the points either side of it.
#[derive(Clone, Debug, PartialEq)]
pub struct Typed {
    pub name: String,
    pub before: Option<String>,
    pub after: Option<String>,
}

/// A route: its ends and its stops.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Route {
    pub dep: String,
    pub stops: Vec<String>,
    pub dest: String,
}

/// The most stops a route takes (the web's MAX_STOPS).
pub const MAX_STOPS: usize = 16;

/// The route a clearance gives, from the route planned: its destination
/// the limit where that is an airport; its stops the places and airways
/// said, the SID's transition after the departure and the STAR's before
/// the destination; with "then as filed" the filed stops after the last
/// one said that is among them, or all of them where none is (AIM 5-2-6).
pub fn cleared_route(c: &Clearance, found: &FoundPlaces, planned: &Route) -> (Route, Vec<Typed>) {
    let dest = match &found.limit {
        Some(Found { kind: Some("airport"), ident: Some(ident), .. }) => ident.clone(),
        _ => planned.dest.clone(),
    };
    let mut said: Vec<String> = Vec::new();
    let mut typed = Vec::new();
    let mut run = 0;
    for item in &c.route {
        match item {
            Item::Places(_) => {
                for p in found.route.get(run).map(Vec::as_slice).unwrap_or(&[]) {
                    if let Some(ident) = &p.ident {
                        said.push(ident.clone());
                    }
                }
                run += 1;
            }
            Item::Airway(a) => said.push(a.clone()),
            Item::Procedure { kind: "departure", .. } => {
                if let Some(d) = &found.departure {
                    typed.push(Typed { name: d.id.clone(), before: (!planned.dep.is_empty()).then(|| planned.dep.clone()), after: d.transition.clone() });
                    if let Some(t) = &d.transition {
                        said.push(t.clone());
                    }
                }
            }
            Item::Procedure { .. } => {
                if let Some(a) = &found.arrival {
                    if let Some(t) = &a.transition {
                        said.push(t.clone());
                    }
                    typed.push(Typed { name: a.id.clone(), before: a.transition.clone(), after: (!dest.is_empty()).then(|| dest.clone()) });
                }
            }
            _ => {}
        }
    }
    let mut stops = said.clone();
    if c.as_filed {
        let last = said.iter().rev().find(|s| !is_airway(s) && planned.stops.iter().any(|p| same_field(p, s)));
        let from = last.and_then(|l| planned.stops.iter().position(|p| same_field(p, l))).map_or(0, |k| k + 1);
        stops.extend(planned.stops[from..].iter().cloned());
    }
    let n = stops.len();
    let ends: Vec<String> = stops
        .into_iter()
        .enumerate()
        .filter(|(i, s)| !((*i == 0 && same_field(s, &planned.dep)) || (*i + 1 == n && same_field(s, &dest))))
        .map(|(_, s)| s)
        .collect();
    let mut kept: Vec<String> = Vec::new();
    for (i, s) in ends.iter().enumerate() {
        if i == 0 || !same_field(s, &ends[i - 1]) {
            kept.push(s.clone());
        }
    }
    kept.truncate(MAX_STOPS);
    (Route { dep: planned.dep.clone(), stops: kept, dest }, typed)
}

// --- calls to us (lib/heardCall) ---------------------------------------

/// Words said in place of the N (AIM 4-2-4 b), the common ones; "Tango"
/// for an air taxi.
const TYPE_WORDS: &[&str] = &[
    "cessna", "skyhawk", "skylane", "skylark", "centurion", "cardinal", "caravan", "citation", "piper", "cherokee", "warrior", "archer",
    "arrow", "dakota", "lance", "saratoga", "seneca", "seminole", "aztec", "navajo", "malibu", "cub", "cirrus", "mooney", "bonanza", "baron",
    "beech", "beechcraft", "king", "diamond", "katana", "grumman", "tiger", "cheetah", "yankee", "experimental", "lancair", "glasair", "vans",
    "rv", "sport", "helicopter", "robinson", "tango", "november",
];

/// How far into a transmission our call sign may begin: a controller says
/// it first; a pilot's readback ends with it.
const CALL_WITHIN: usize = 3;

fn mark(w: &str) -> Option<String> {
    if let Some(l) = letter(w) {
        return Some(l.to_string());
    }
    if let Some(d) = digit(w) {
        return Some(d.to_string());
    }
    let alnum = w.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit());
    (is_ascii_digits(w) || (alnum && w.bytes().any(|b| b.is_ascii_digit()))).then(|| w.to_uppercase())
}

/// Whether the transmission is said to the airplane `tail` ("N123AB"), in
/// the forms AIM 4-2-4 lets its call sign take: the registration whole,
/// with its N or a type's name in its place, or the prefix and its last
/// three; never a longer call sign that ends the same (AIM 4-2-4 a.1).
pub fn our_call(text: &str, tail: &str) -> bool {
    let full = tail.trim().to_uppercase();
    if !(2..=7).contains(&full.len()) || !full.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return false;
    }
    let body = full.strip_prefix('N').unwrap_or(&full).to_owned();
    let last = body[body.len().saturating_sub(3)..].to_owned();
    let lower = text.to_lowercase().replace("x-ray", "xray").replace("x ray", "xray");
    let words: Vec<String> = lower
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_owned)
        .collect();
    let mut i = 0;
    while i < words.len() {
        if mark(&words[i]).is_none() {
            i += 1;
            continue;
        }
        let mut run = String::new();
        let mut j = i;
        while let Some(m) = words.get(j).and_then(|w| mark(w)) {
            run.push_str(&m);
            j += 1;
        }
        let before = if i > 0 { Some(words[i - 1].as_str()) } else { None };
        if i <= CALL_WITHIN
            && (run == full
                || run == format!("N{body}")
                || run == body
                || run == format!("N{last}")
                || (run == last && before.is_some_and(|b| TYPE_WORDS.contains(&b))))
        {
            return true;
        }
        i = j;
    }
    false
}

const AFTER_DIRECT: &[&str] = &[
    "then", "climb", "maintain", "descend", "contact", "squawk", "expect", "cross", "at", "and", "when", "resume", "report", "cleared",
    "fly", "heading", "intercept", "join", "hold", "for", "via", "own", "navigation", "after",
];

/// Each letter and figure, and the words a recognizer writes for it (AIM
/// 4-2-7, TBL 4-2-7; "tree", "fife", "niner"), for the call sign's
/// pattern below: the inverse of `letter` and `digit`.
const SAID: &[(char, &[&str])] = &[
    ('A', &["alpha", "alfa"]), ('B', &["bravo"]), ('C', &["charlie"]), ('D', &["delta"]), ('E', &["echo"]),
    ('F', &["foxtrot"]), ('G', &["golf"]), ('H', &["hotel"]), ('I', &["india"]), ('J', &["juliet", "juliett"]),
    ('K', &["kilo"]), ('L', &["lima"]), ('M', &["mike"]), ('N', &["november"]), ('O', &["oscar"]), ('P', &["papa"]),
    ('Q', &["quebec"]), ('R', &["romeo"]), ('S', &["sierra"]), ('T', &["tango"]), ('U', &["uniform"]),
    ('V', &["victor"]), ('W', &["whiskey", "whisky"]), ('X', &["xray"]), ('Y', &["yankee"]), ('Z', &["zulu"]),
    ('0', &["zero"]), ('1', &["one"]), ('2', &["two"]), ('3', &["three", "tree"]), ('4', &["four", "fower"]),
    ('5', &["five", "fife"]), ('6', &["six"]), ('7', &["seven"]), ('8', &["eight", "ait"]), ('9', &["nine", "niner"]),
];

/// Our call sign as a regular expression over a recognizer's words, for
/// the iOS app to tell a call to us while the phone is locked
/// (SpeechPlugin.swift), as `our_call` hears one: the registration with
/// its N, or a type's name in its place, or the prefix and its last
/// three, within the first words (CALL_WITHIN). None where `tail` is no
/// registration. The web's lib/heardCall callPattern, to the character.
pub fn call_pattern(tail: &str) -> Option<String> {
    let full = tail.trim().to_uppercase();
    if !(2..=7).contains(&full.len()) || !full.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return None;
    }
    let say_chars = |chars: &str| -> String {
        chars
            .chars()
            .map(|ch| {
                let mut ways = vec![ch.to_ascii_lowercase().to_string()];
                if let Some((_, words)) = SAID.iter().find(|(c, _)| *c == ch) {
                    ways.extend(words.iter().map(|w| (*w).to_owned()));
                }
                format!("(?:{})", ways.join("|"))
            })
            .collect::<Vec<_>>()
            .join("[\\s,-]*")
    };
    let body = full.strip_prefix('N').unwrap_or(&full);
    let last = &body[body.len().saturating_sub(3)..];
    let n = say_chars("N");
    let types = TYPE_WORDS.join("|");
    Some(format!(
        "^\\W*(?:[a-z']+\\W+){{0,{CALL_WITHIN}}}?(?:(?:{n}[\\s,-]*)?{}|{n}[\\s,-]*{}|(?:{types})\\W+{})\\b",
        say_chars(body),
        say_chars(last),
        say_chars(last)
    ))
}

/// The place a "direct" sends us to, as words to find, or None.
pub fn direct_of(text: &str) -> Option<String> {
    let toks = tokens(text);
    let at = toks.iter().position(|t| t.word == "direct")?;
    let mut place: Vec<Token> = Vec::new();
    for t in &toks[at + 1..] {
        if place.len() >= 6 {
            break;
        }
        if t.word == "to" || t.word == "the" {
            if place.is_empty() {
                continue;
            }
            break;
        }
        if AFTER_DIRECT.contains(&t.word.as_str()) || (t.num.is_some() && !place.iter().any(|p| letter(&p.word).is_some())) {
            break;
        }
        place.push(t.clone());
    }
    let said = place_words(&place);
    (!said.is_empty()).then_some(said)
}
