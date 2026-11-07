//! The pilot's readback of a clearance checked against it (AIM 4-4-7 b:
//! pilots read back "those parts of ATC clearances and instructions
//! containing altitude assignments, vectors, or runway assignments", and
//! 4-4-7 b.3 the altimeter, frequencies and codes): the limit, the places
//! of the route, the altitude to maintain and the one to expect, the
//! frequency and the squawk, each as the clearance reader finds it in the
//! readback (crate::clearance) or, said bare as a readback often is ("five
//! thousand, one two five point three five, four five one two"), as its
//! figures among the readback's. What was missed or said differently is a
//! warning in the microphone's pill (the web's RadioLayer); it never stops
//! anything. The web's lib/readback asks for it as `readback_check`; held
//! to web/src/lib/fixtures/readbacks.json (the engine's
//! tests/clearance.rs).

use crate::clearance::{place_words, read, tokens, Clearance, Item};
use crate::json;

/// One item missed or said differently: which, what was cleared, and
/// what was said (None where it was not read back).
#[derive(Clone, Debug, PartialEq)]
pub struct Missed {
    pub item: &'static str,
    pub cleared: String,
    pub said: Option<String>,
}

/// A whole number with its thousands grouped ("4,000"), as the web's
/// lib/units grouped writes one.
pub fn grouped(n: i64) -> String {
    let digits = n.abs().to_string();
    let mut out = String::new();
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(ch);
    }
    if n < 0 {
        format!("-{out}")
    } else {
        out
    }
}

/// An altitude as ATC says it (AIM 4-2-9): feet below 18,000, a flight
/// level from there up.
pub fn altitude_words(ft: i64) -> String {
    if ft >= 18000 {
        format!("FL{}", (ft as f64 / 100.0).round() as i64)
    } else {
        format!("{} ft", grouped(ft))
    }
}

/// A place's words as they are compared: lower case, "the" and "airport"
/// left out.
fn place_key(said: &str) -> String {
    said.to_lowercase().split_whitespace().filter(|w| *w != "the" && *w != "airport").collect::<Vec<_>>().join(" ")
}

/// The items of `cleared` the readback `said` missed or had differently;
/// none where it matches.
pub fn check(cleared: &Clearance, said: &str) -> Vec<Missed> {
    let back = read(said);
    let toks = tokens(said);
    let figures: Vec<&str> = toks.iter().filter_map(|t| t.num.as_deref()).collect();
    let words = format!(" {} ", place_key(&place_words(&toks)));
    let mut out = Vec::new();
    // A figure read bare counts as read back (a flight level as its own
    // figure, "flight level two one zero"); one the reader found counts
    // as what was said. Figures said one after another with no word
    // between are one figure to the tokens, as they are to a recognizer.
    let has_figure = |text: &str| figures.iter().any(|f| *f == text);
    let bare_ft = |ft: i64| has_figure(&ft.to_string()) || (ft >= 18000 && has_figure(&(ft / 100).to_string()));
    let bare_text = |s: &str| has_figure(s);
    let mut figure_ft = |item: &'static str, cleared_ft: Option<i64>, said_ft: Option<i64>| {
        let Some(c) = cleared_ft else { return };
        let heard = said_ft.or(if bare_ft(c) { Some(c) } else { None });
        if heard != Some(c) {
            out.push(Missed { item, cleared: altitude_words(c), said: heard.map(altitude_words) });
        }
    };
    figure_ft("altitude", cleared.maintain_ft, back.maintain_ft);
    figure_ft("expect", cleared.expect_ft, back.expect_ft);
    let mut figure_text = |item: &'static str, cleared_text: Option<&str>, said_text: Option<&str>| {
        let Some(c) = cleared_text else { return };
        let heard = said_text.or(if bare_text(c) { Some(c) } else { None });
        if heard != Some(c) {
            out.push(Missed { item, cleared: c.to_owned(), said: heard.map(str::to_owned) });
        }
    };
    figure_text("frequency", cleared.frequency.as_deref(), back.frequency.as_deref());
    figure_text("squawk", cleared.squawk.as_deref(), back.squawk.as_deref());
    // The limit and the route first, as the web lists them: the order is
    // the warning line's.
    let mut first = Vec::new();
    if let Some(limit) = &cleared.limit {
        let key = place_key(limit);
        let heard = match &back.limit {
            Some(l) => Some(place_key(l)),
            None if words.contains(&format!(" {key} ")) => Some(key.clone()),
            None => None,
        };
        if heard.as_deref() != Some(key.as_str()) {
            first.push(Missed { item: "limit", cleared: limit.clone(), said: heard.and(back.limit.clone()) });
        }
    }
    for item in &cleared.route {
        match item {
            Item::Places(said_places) => {
                for place in place_key(said_places).split(' ').filter(|p| !p.is_empty()) {
                    if !words.contains(&format!(" {place} ")) {
                        let cleared = if place.to_uppercase() == place { place.to_owned() } else { said_places.clone() };
                        first.push(Missed { item: "route", cleared, said: None });
                    }
                }
            }
            Item::Airway(ident) => {
                if !words.contains(&format!(" {} ", ident.to_lowercase())) {
                    first.push(Missed { item: "route", cleared: ident.clone(), said: None });
                }
            }
            Item::Heading(degrees) => {
                if !figures.contains(&degrees.to_string().as_str()) {
                    first.push(Missed { item: "route", cleared: format!("heading {degrees}"), said: None });
                }
            }
            Item::Vectors | Item::Procedure { .. } => {}
        }
    }
    first.extend(out);
    first
}

/// The warning line: "Readback: altitude 5,000 ft said, 4,000 ft cleared;
/// squawk 4512 not read back." -- or "Readback complete."
pub fn words(items: &[Missed]) -> String {
    if items.is_empty() {
        return "Readback complete.".to_owned();
    }
    fn name(item: &str) -> &str {
        match item {
            "limit" => "cleared to",
            other => other,
        }
    }
    let parts: Vec<String> = items
        .iter()
        .map(|i| match &i.said {
            None => format!("{} {} not read back", name(i.item), i.cleared),
            Some(said) => format!("{} {} said, {} cleared", name(i.item), said, i.cleared),
        })
        .collect();
    format!("Readback: {}.", parts.join("; "))
}

/// The check as JSON for the apps: `{"items": [{"item", "cleared",
/// "said"}], "words"}`.
pub fn check_json(cleared_text: &str, said: &str) -> String {
    let items = check(&read(cleared_text), said);
    let mut o = String::from("{\"items\":[");
    for (i, m) in items.iter().enumerate() {
        if i > 0 {
            o.push(',');
        }
        o.push_str("{\"item\":");
        json::string(&mut o, m.item);
        o.push_str(",\"cleared\":");
        json::string(&mut o, &m.cleared);
        o.push_str(",\"said\":");
        json::opt_string(&mut o, m.said.as_deref());
        o.push('}');
    }
    o.push_str("],\"words\":");
    json::string(&mut o, &words(&items));
    o.push('}');
    o
}
