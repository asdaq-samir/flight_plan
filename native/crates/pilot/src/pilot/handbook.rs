//! The planning figures in a handbook's specifications page, from the text
//! read off a photo of it (the web app's Tesseract, the iPhone's Vision):
//! the page's own lines, each a label and its figure ("Service Ceiling
//! (ft) 14,300", "SERVICE CEILING .... 13,500 FT."), as Piper's and
//! Cessna's handbooks print them. Each figure comes with the line it was
//! read from, for the pilot to check against the page; one the page does
//! not label plainly is not guessed.
//!
//! The web app's lib/handbookText, moved here whole; its regular
//! expressions are matched by hand, each as JavaScript matches it (ASCII
//! case folding, `\b` between [A-Za-z0-9_] and the rest), since the
//! engine has no regular expression crate.

use super::js;
use crate::json;

/// A statute mile an hour in knots: 1,609.344 m / 1,852 m (the
/// international mile and nautical mile).
pub const MPH_TO_KT: f64 = 1609.344 / 1852.0;

/// A figure and the line it was read from.
#[derive(Clone, Debug, PartialEq)]
pub struct Figure {
    pub value: f64,
    pub words: String,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Figures {
    pub cruise_tas_kt: Option<Figure>,
    pub cruise_power_pct: Option<Figure>,
    pub fuel_burn_gph: Option<Figure>,
    pub usable_fuel_gal: Option<Figure>,
    pub climb_tas_kt: Option<Figure>,
    pub service_ceiling_ft: Option<Figure>,
}

fn chars(s: &str) -> Vec<char> {
    s.chars().collect()
}

fn digit_run(c: &[char], from: usize) -> usize {
    c[from.min(c.len())..].iter().take_while(|x| x.is_ascii_digit()).count()
}

fn space_run(c: &[char], from: usize) -> usize {
    c[from.min(c.len())..].iter().take_while(|&&x| js::is_space(x)).count()
}

/// The page's lines, a label wrapped onto the next line put back on one:
/// a line with a bracket left open, or with no figure at its end, goes on
/// with the next ("Cruising Speed (75% power, sea" / "level) (mph) 121").
pub fn entries(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut open = String::new();
    for raw in text.split('\n') {
        let raw = raw.strip_suffix('\r').unwrap_or(raw);
        // Every run of space one space, and none at the ends.
        let line = raw.split(js::is_space).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ");
        if line.is_empty() {
            continue;
        }
        let joined = if open.is_empty() { line } else { format!("{open} {line}") };
        let unclosed = joined.matches('(').count() > joined.matches(')').count();
        if (unclosed || !ends_with_figure(&joined)) && js::units(&joined) < 160 {
            open = joined;
            continue;
        }
        out.push(joined);
        open.clear();
    }
    if !open.is_empty() {
        out.push(open);
    }
    out
}

/// /\d[\d,.]*\D{0,12}$/: a figure, then no more than twelve code units
/// that are not digits to the end of the line.
fn ends_with_figure(line: &str) -> bool {
    let units: Vec<u16> = line.encode_utf16().collect();
    let is_digit = |u: u16| (b'0' as u16..=b'9' as u16).contains(&u);
    let Some(last) = units.iter().rposition(|&u| is_digit(u)) else { return false };
    let after = &units[last + 1..];
    let marks = after.iter().take_while(|&&u| u == b',' as u16 || u == b'.' as u16).count();
    after.len() - marks <= 12
}

/// Every "(...)" made a space, as /\([^)]*\)/g replaces it: a bracket's
/// own figures are a label's ("(75% power, 7000 ft, mph)").
fn bare(line: &str) -> String {
    let c = chars(line);
    let mut out = String::with_capacity(line.len());
    let mut i = 0;
    while i < c.len() {
        if c[i] == '(' {
            if let Some(close) = c[i + 1..].iter().position(|&x| x == ')') {
                out.push(' ');
                i += close + 2;
                continue;
            }
        }
        out.push(c[i]);
        i += 1;
    }
    out
}

/// A figure as printed: "14,300", "8.4", and "14.300" where the reading
/// took a thousands comma for a point.
pub fn number(s: &str) -> f64 {
    let t = s.replace(',', "");
    let b = t.as_bytes();
    let thousands = (b.len() == 5 || b.len() == 6) && b[b.len() - 4] == b'.' && b.iter().enumerate().all(|(i, d)| i == b.len() - 4 || d.is_ascii_digit());
    if thousands {
        js::number(&t.replacen('.', "", 1))
    } else {
        js::number(&t)
    }
}

/// The line's figure: its last number outside brackets, where a label's
/// own numbers sit inside them ("(75% power, 7000 ft, mph) 132 (135*)") or
/// before it ("75% Power at 8000 Ft ...... 124 KNOTS"); /\d[\d,]*(?:\.\d+)?/g.
pub fn figure(line: &str) -> Option<f64> {
    let c = chars(&bare(line));
    let mut last: Option<String> = None;
    let mut i = 0;
    while i < c.len() {
        if !c[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let mut j = i + 1 + c[i + 1..].iter().take_while(|x| x.is_ascii_digit() || **x == ',').count();
        if c.get(j) == Some(&'.') && c.get(j + 1).is_some_and(char::is_ascii_digit) {
            j += 1 + digit_run(&c, j + 1);
        }
        last = Some(c[i..j].iter().collect());
        i = j;
    }
    last.map(|s| number(&s))
}

/// /\bmph\b|miles per hour|\bm\.?p\.?h\b/i.
fn says_mph(c: &[char]) -> bool {
    js::contains_ci(c, "miles per hour") || ["mph", "m.ph", "mp.h", "m.p.h"].iter().any(|w| js::has_word_ci(c, w))
}

/// Knots, from a line that says miles an hour where it does: its own
/// units, outside brackets, first -- "122 KTS (140 MPH)" is knots, its
/// bracketed miles an hour a second reading of the same speed -- and a
/// unit in brackets only where none is outside them, as Piper's "Best
/// Rate of Climb Speed (mph) 85" puts it.
pub fn knots(line: &str, value: f64) -> f64 {
    let b = chars(&bare(line));
    if ["kt", "kts", "knot", "knots", "ktas"].iter().any(|w| js::has_word_ci(&b, w)) {
        return value;
    }
    if says_mph(&b) || says_mph(&chars(line)) {
        js::round(value * MPH_TO_KT)
    } else {
        value
    }
}

/// The power a line states, /(\d{2,3})\s*%/: NaN where it states none.
pub fn power(line: &str) -> f64 {
    let c = chars(line);
    for i in 0..c.len() {
        let run = digit_run(&c, i);
        if run >= 2 {
            let n = run.min(3);
            let after = i + n;
            if c.get(after + space_run(&c, after)) == Some(&'%') {
                return js::number(&c[i..i + n].iter().collect::<String>());
            }
        }
    }
    f64::NAN
}

fn within(n: Option<f64>, min: f64, max: f64) -> bool {
    n.is_some_and(|n| n.is_finite() && n >= min && n <= max)
}

/// The bounds a light airplane's figure is believed within, each figure
/// by its answer's name: a figure read off a page, or typed in, outside
/// them is a misreading, not the airplane's. Climb fuel burn is not read
/// off a page, only typed in.
pub const BOUNDS: [(&str, f64, f64); 7] = [
    ("cruiseTasKt", 30.0, 400.0),
    ("cruisePowerPct", 40.0, 100.0),
    ("fuelBurnGph", 1.0, 100.0),
    ("usableFuelGal", 5.0, 500.0),
    ("climbTasKt", 30.0, 300.0),
    ("climbFuelBurnGph", 1.0, 150.0),
    ("serviceCeilingFt", 1000.0, 30000.0),
];

/// Whether a figure, by its name in BOUNDS, is within its bounds; a name
/// not there has none.
pub fn figure_within(key: &str, value: f64) -> Option<bool> {
    BOUNDS.iter().find(|(k, _, _)| *k == key).map(|(_, min, max)| within(Some(value), *min, *max))
}

fn bounded(n: Option<f64>, key: &str) -> bool {
    n.is_some_and(|n| figure_within(key, n) == Some(true))
}

/// "word", any space, "word" (/a\s+b/i with `at_least_one`, /a\s*b/i without).
fn spaced_ci(c: &[char], a: &str, b: &str, at_least_one: bool) -> bool {
    let n = a.chars().count();
    (0..c.len()).any(|i| {
        js::starts_ci(c, i, a) && {
            let s = space_run(c, i + n);
            (s > 0 || !at_least_one) && js::starts_ci(c, i + n + s, b)
        }
    })
}

/// "usable", then up to forty that are not digits, then a figure
/// (/usable[^\d]{0,40}(\d[\d,.]*)/i): the figure's text.
fn usable_figure(c: &[char]) -> Option<String> {
    for i in 0..c.len() {
        if !js::starts_ci(c, i, "usable") {
            continue;
        }
        let from = i + 6;
        let gap = c[from..].iter().take_while(|x| !x.is_ascii_digit()).count();
        if gap <= 40 && from + gap < c.len() {
            let start = from + gap;
            let len = 1 + c[start + 1..].iter().take_while(|x| x.is_ascii_digit() || **x == ',' || **x == '.').count();
            return Some(c[start..start + len].iter().collect());
        }
    }
    None
}

/// /\d{3,5}\s*(ft|feet)/i: an altitude in feet.
fn says_feet(c: &[char]) -> bool {
    (0..c.len()).any(|i| {
        let run = digit_run(c, i);
        run >= 3 && (i == 0 || !c[i - 1].is_ascii_digit()) && {
            let after = i + run + space_run(c, i + run);
            js::starts_ci(c, after, "ft") || js::starts_ci(c, after, "feet")
        }
    })
}

/// /\bv\s*no\b/i: Vno, the maximum structural cruising speed.
fn says_vno(c: &[char]) -> bool {
    (0..c.len()).any(|i| {
        js::boundary(c, i) && js::starts_ci(c, i, "v") && {
            let at = i + 1 + space_run(c, i + 1);
            js::starts_ci(c, at, "no") && js::boundary(c, at + 2)
        }
    })
}

/// /fuel\s+(consumption|flow|burn)|gal(lons)?\.?\s*(per|\/)\s*h(ou)?r|\bgph\b/i.
fn says_burn(c: &[char]) -> bool {
    if ["consumption", "flow", "burn"].iter().any(|w| spaced_ci(c, "fuel", w, true)) || js::has_word_ci(c, "gph") {
        return true;
    }
    (0..c.len()).any(|i| {
        if !js::starts_ci(c, i, "gal") {
            return false;
        }
        let mut j = i + 3;
        if js::starts_ci(c, j, "lons") {
            j += 4;
        }
        if c.get(j) == Some(&'.') {
            j += 1;
        }
        j += space_run(c, j);
        if js::starts_ci(c, j, "per") {
            j += 3;
        } else if c.get(j) == Some(&'/') {
            j += 1;
        } else {
            return false;
        }
        j += space_run(c, j);
        if !js::starts_ci(c, j, "h") {
            return false;
        }
        j += 1;
        if js::starts_ci(c, j, "ou") {
            j += 2;
        }
        js::starts_ci(c, j, "r")
    })
}

/// The figure after the cruise's own power where two powers' burns share a
/// line ("75% 8.4 gph 65% 7.0 gph"): /\b75\s*%[^\d]{0,20}(\d+(?:\.\d+)?)/.
fn burn_at_power(c: &[char], pct: &str) -> Option<String> {
    let n = pct.chars().count();
    for i in 0..c.len() {
        if !(js::boundary(c, i) && c[i..].starts_with(&pct.chars().collect::<Vec<_>>())) {
            continue;
        }
        let pc = i + n + space_run(c, i + n);
        if c.get(pc) != Some(&'%') {
            continue;
        }
        let gap = c[pc + 1..].iter().take_while(|x| !x.is_ascii_digit()).count();
        if gap > 20 || pc + 1 + gap >= c.len() {
            continue;
        }
        let start = pc + 1 + gap;
        let mut end = start + digit_run(c, start);
        if c.get(end) == Some(&'.') && c.get(end + 1).is_some_and(char::is_ascii_digit) {
            end += 1 + digit_run(c, end + 1);
        }
        return Some(c[start..end].iter().collect());
    }
    None
}

pub fn figures_of_page(text: &str) -> Figures {
    let lines = entries(text);
    let mut found = Figures::default();

    for line in &lines {
        let c = chars(line);
        let n = figure(line);
        if found.service_ceiling_ft.is_none() && spaced_ci(&c, "service", "ceiling", true) && bounded(n, "serviceCeilingFt") {
            found.service_ceiling_ft = n.map(|value| Figure { value, words: line.clone() });
        }
        // "Best Rate of Climb Speed (mph) 85": a speed, not the rate itself.
        if found.climb_tas_kt.is_none() && js::contains_ci(&c, "climb") && js::contains_ci(&c, "speed") && bounded(n, "climbTasKt") {
            found.climb_tas_kt = n.map(|v| Figure { value: knots(line, v), words: line.clone() });
        }
        // "Usable Fuel (gal) 48" or "Total 56 GAL. usable 53 GAL."
        if found.usable_fuel_gal.is_none() && js::contains_ci(&c, "usable") && !js::contains_ci(&c, "unusable") {
            let v = match usable_figure(&c) {
                Some(after) => Some(number(&after)),
                None => n,
            };
            if bounded(v, "usableFuelGal") {
                found.usable_fuel_gal = v.map(|value| Figure { value, words: line.clone() });
            }
        }
    }

    // Cruise: of the page's cruising speeds, the one at a stated altitude
    // (the handbook's "optimum"), at 75% power where it says, over one at
    // sea level or at a lower, training power; the first of the best.
    let mut cruise: Option<(&String, i32)> = None;
    for l in &lines {
        let c = chars(l);
        // Not the structural cruising speed (Vno), a limit, not a cruise.
        let is_cruise = js::contains_ci(&c, "cruis")
            && !(js::contains_ci(&c, "structural") || says_vno(&c))
            && (js::contains_ci(&c, "speed") || js::contains_ci(&c, "knots") || js::has_word_ci(&c, "kt") || js::has_word_ci(&c, "kts") || js::contains_ci(&c, "mph"))
            && bounded(figure(l), "cruiseTasKt");
        if !is_cruise {
            continue;
        }
        let score = if says_feet(&c) && !spaced_ci(&c, "sea", "level", false) { 2 } else { 0 } + i32::from(power(l) == 75.0);
        if cruise.is_none_or(|(_, best)| score > best) {
            cruise = Some((l, score));
        }
    }
    if let Some((l, _)) = cruise {
        if let Some(v) = figure(l) {
            found.cruise_tas_kt = Some(Figure { value: knots(l, v), words: l.clone() });
        }
        let pct = power(l);
        if bounded(Some(pct), "cruisePowerPct") {
            found.cruise_power_pct = Some(Figure { value: pct, words: l.clone() });
        }
    }

    // Fuel burn: "Fuel Consumption (gal per hr 75%) 8.4", the one at the
    // cruise's power where the page gives several.
    let burns: Vec<&String> = lines.iter().filter(|l| says_burn(&chars(l)) && bounded(figure(l), "fuelBurnGph")).collect();
    let cruise_pct = found.cruise_power_pct.as_ref().map(|f| f.value);
    let burn = burns.iter().find(|l| cruise_pct.is_some_and(|p| power(l) == p)).or(burns.first());
    if let Some(burn) = burn {
        // Two powers' burns read onto one line ("75% 8.4 gph 65% 7.0 gph"):
        // the figure after the cruise's own power, not the line's last.
        let after = cruise_pct.filter(|p| *p != 0.0).and_then(|p| burn_at_power(&chars(&bare(burn)), &js::number_string(p)));
        let v = match after {
            Some(a) => Some(number(&a)),
            None => figure(burn),
        };
        if bounded(v, "fuelBurnGph") {
            found.fuel_burn_gph = v.map(|value| Figure { value, words: (*burn).clone() });
        }
    }

    found
}

/// The figures found as the web app's PageFigures, `{"cruiseTasKt":
/// {"value", "words"}, ...}`, a figure not found left out.
pub fn to_json(f: &Figures) -> String {
    let mut out = String::from("{");
    let all = [
        ("serviceCeilingFt", &f.service_ceiling_ft),
        ("climbTasKt", &f.climb_tas_kt),
        ("usableFuelGal", &f.usable_fuel_gal),
        ("cruiseTasKt", &f.cruise_tas_kt),
        ("cruisePowerPct", &f.cruise_power_pct),
        ("fuelBurnGph", &f.fuel_burn_gph),
    ];
    for (name, fig) in all {
        if let Some(fig) = fig {
            if out.len() > 1 {
                out.push(',');
            }
            out.push_str(&format!("\"{name}\":{{\"value\":"));
            json::number(&mut out, fig.value);
            out.push_str(",\"words\":");
            json::string(&mut out, &fig.words);
            out.push('}');
        }
    }
    out.push('}');
    out
}
