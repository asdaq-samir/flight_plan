//! Places said aloud, found as idents -- vfr.spoken, here so the native
//! app finds them in the air with no signal, among the places the phone
//! keeps: the airports, navaids and fixes of each region it holds a pack
//! of (crate::phone, vfr.pack's `write_phone`), the regions its routes
//! cross. The planner looks nationwide; offline, a place outside the kept
//! regions is not found, and is said so.
//!
//! - A navaid by its name: "Gopher" is GEP (NASR NAV_BASE's NAME).
//! - A fix said as a word, by its sound among those near the route:
//!   PYKLA as "pickla", unsure until the pilot has read it.
//! - An airport by its name followed by "airport" (AIM 4-4-3 a).
//! - Anything spelled in the phonetic alphabet by its ident.
//!
//! The SIDs and STARs are the CIFP's, which no pack holds: offline they
//! are shown as said, not found.

use crate::clearance::{Found, FoundPlaces};
use crate::json;
use crate::pack::Pack;

/// A place a clearance may name.
#[derive(Clone, Debug, PartialEq)]
pub struct Place {
    pub ident: String,
    pub name: Option<String>,
    /// "airport", "navaid" or "fix".
    pub what: &'static str,
    pub lat: f64,
    pub lon: f64,
}

/// How alike two sounds must be for a sound-alike fix to be offered.
const ALIKE: f64 = 0.75;

fn kind_word(w: &str) -> Option<&'static str> {
    Some(match w {
        "airport" | "field" | "international" | "regional" | "municipal" => "airport",
        "vor" | "vortac" | "tacan" | "dme" | "ndb" | "beacon" => "navaid",
        "intersection" | "waypoint" | "fix" => "fix",
        _ => return None,
    })
}

const FILLER: &[&str] = &["the", "a", "an", "of", "and", "to"];

fn letters_upper(word: &str) -> String {
    word.to_uppercase().chars().filter(|c| c.is_ascii_uppercase()).collect()
}

/// A word's sound as its consonants: its first letter (any vowel as A),
/// then each consonant sound once -- "pickla" and PYKLA are one sound.
pub fn sound(word: &str) -> String {
    let mut s = letters_upper(word);
    if s.is_empty() {
        return s;
    }
    for (spelled, said) in [("PH", "F"), ("CK", "K"), ("GH", "G"), ("SCH", "SK"), ("TH", "T"), ("WR", "R"), ("KN", "N"), ("X", "KS"), ("Q", "K"), ("Z", "S"), ("C", "K"), ("DG", "J")] {
        s = s.replace(spelled, said);
    }
    let mut chars = s.chars();
    let first = chars.next().unwrap();
    let mut out = String::from(if "AEIOUY".contains(first) { 'A' } else { first });
    for ch in chars {
        if "AEIOUYHW".contains(ch) || out.ends_with(ch) {
            continue;
        }
        out.push(ch);
    }
    out
}

/// A word's sound with its vowels kept as one: "pickla" and PYKLA are
/// both PAKLA, where PCKLE is PKLA.
pub fn spelled(word: &str) -> String {
    let mut s = letters_upper(word);
    for (spelled, said) in [("PH", "F"), ("CK", "K"), ("GH", "G"), ("X", "KS"), ("Q", "K"), ("Z", "S"), ("C", "K")] {
        s = s.replace(spelled, said);
    }
    s = s.replace(['H', 'W'], "");
    let mut out = String::new();
    let mut vowels = false;
    for ch in s.chars() {
        if "AEIOUY".contains(ch) {
            if !vowels {
                out.push('A');
            }
            vowels = true;
        } else {
            out.push(ch);
            vowels = false;
        }
    }
    let mut squeezed = String::new();
    for ch in out.chars() {
        if !squeezed.ends_with(ch) {
            squeezed.push(ch);
        }
    }
    squeezed
}

/// difflib.SequenceMatcher(None, a, b).ratio(), for strings this short
/// (no junk, no popular characters): twice the characters in matching
/// blocks over both lengths.
pub fn ratio(a: &str, b: &str) -> f64 {
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    let total = a.len() + b.len();
    if total == 0 {
        return 1.0;
    }
    fn longest(a: &[char], b: &[char], alo: usize, ahi: usize, blo: usize, bhi: usize) -> (usize, usize, usize) {
        let (mut besti, mut bestj, mut bestsize) = (alo, blo, 0);
        let mut j2len = vec![0usize; b.len() + 1];
        for (i, &ac) in a.iter().enumerate().take(ahi).skip(alo) {
            let mut next = vec![0usize; b.len() + 1];
            for (j, &bc) in b.iter().enumerate().take(bhi).skip(blo) {
                if bc == ac {
                    let k = if j > 0 { j2len[j - 1] } else { 0 } + 1;
                    next[j] = k;
                    if k > bestsize {
                        besti = i + 1 - k;
                        bestj = j + 1 - k;
                        bestsize = k;
                    }
                }
            }
            j2len = next;
        }
        (besti, bestj, bestsize)
    }
    let mut matched = 0;
    let mut queue = vec![(0, a.len(), 0, b.len())];
    while let Some((alo, ahi, blo, bhi)) = queue.pop() {
        let (i, j, k) = longest(&a, &b, alo, ahi, blo, bhi);
        if k > 0 {
            matched += k;
            if alo < i && blo < j {
                queue.push((alo, i, blo, j));
            }
            if i + k < ahi && j + k < bhi {
                queue.push((i + k, ahi, j + k, bhi));
            }
        }
    }
    2.0 * matched as f64 / total as f64
}

fn alike(a: &str, b: &str) -> f64 {
    ratio(&sound(a), &sound(b))
}

fn closer(a: &str, b: &str) -> f64 {
    ratio(&spelled(a), &spelled(b))
}

/// The words of a point as said, and the kind its last word asks for.
pub fn words_of(said: &str) -> (Vec<String>, Option<&'static str>) {
    let lower = said.to_lowercase();
    let mut words: Vec<String> = lower
        .split(|c: char| !(c.is_ascii_lowercase() || c.is_ascii_digit() || c == '\''))
        .filter(|w| !w.is_empty() && !FILLER.contains(w))
        .map(str::to_owned)
        .collect();
    let mut kind = None;
    while let Some(k) = words.last().and_then(|w| kind_word(w)) {
        kind = kind.or(Some(k));
        words.pop();
    }
    (words, kind)
}

/// A name as words, its marks gone: "WILKES BARRE" for Wilkes-Barre.
pub fn name_words(name: &str) -> String {
    name.to_uppercase()
        .split(|c: char| !(c.is_ascii_uppercase() || c.is_ascii_digit() || c == '\''))
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn row(said: &str, p: &Place, sure: bool) -> Found {
    Found { said: said.to_owned(), ident: Some(p.ident.clone()), name: p.name.clone(), kind: Some(p.what), sure }
}

/// The airport an airport's name said is, the nearest first (`places` in
/// order of nearness): one whose name holds the words, or fewer of them,
/// the longest run first.
fn airport_named<'a>(words: &[String], places: &'a [Place]) -> Option<&'a Place> {
    for n in (1..=words.len()).rev() {
        for i in 0..=words.len() - n {
            let run = words[i..i + n].join(" ").to_uppercase();
            if n == 1 && run.len() < 4 {
                continue;
            }
            let hit = places.iter().find(|p| {
                p.what == "airport" && p.name.as_deref().is_some_and(|name| format!(" {} ", name_words(name)).contains(&format!(" {run} ")))
            });
            if hit.is_some() {
                return hit;
            }
        }
    }
    None
}

/// The place `said` names among `places`, the nearest to the route first;
/// None where nothing is near enough. As vfr.spoken.point.
pub fn point(said: &str, places: &[Place]) -> Option<Found> {
    let (words, kind) = words_of(said);
    if words.is_empty() {
        return None;
    }
    let joined = words.concat().to_uppercase();
    let spaced = words.join(" ").to_uppercase();
    let wanted: Vec<&Place> = places.iter().filter(|p| kind.is_none_or(|k| p.what == k)).collect();
    let exact: Vec<&&Place> = wanted.iter().filter(|p| p.ident.to_uppercase() == joined).collect();
    if let Some(p) = exact.first() {
        if p.what != "fix" {
            return Some(row(said, p, true));
        }
    }
    if kind == Some("airport") {
        if let Some(a) = airport_named(&words, places) {
            return Some(row(said, a, true));
        }
    }
    if let Some(p) = wanted.iter().find(|p| p.name.as_deref().is_some_and(|n| name_words(n) == spaced)) {
        return Some(row(said, p, true));
    }
    if let Some(p) = exact.first() {
        return Some(row(said, p, true));
    }
    if words.len() != 1 {
        return None;
    }
    let mut scored: Vec<(f64, f64, &Place)> = wanted
        .iter()
        .filter(|p| p.what != "airport")
        .map(|p| (alike(&joined, &p.ident).max(alike(&joined, p.name.as_deref().unwrap_or(""))), closer(&joined, &p.ident), *p))
        .collect();
    // Stable, as Python's sorted: of equals, the nearer stays first.
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap().then(b.1.partial_cmp(&a.1).unwrap()));
    match scored.first() {
        Some((s, _, p)) if *s >= ALIKE => Some(row(said, p, false)),
        _ => None,
    }
}

/// The places a run of words names one after another, the longest names
/// first; a word that names nothing kept, unfound. As vfr.spoken.points.
pub fn points(said: &str, places: &[Place]) -> Vec<Found> {
    let (words, _) = words_of(said);
    let mut out = Vec::new();
    let mut i = 0;
    while i < words.len() {
        let mut took = false;
        for j in (i + 1..=words.len()).rev() {
            if let Some(found) = point(&words[i..j].join(" "), places) {
                if found.sure || j == i + 1 {
                    out.push(found);
                    i = j;
                    took = true;
                    break;
                }
            }
        }
        if !took {
            out.push(Found { said: words[i].clone(), ..Found::default() });
            i += 1;
        }
    }
    out
}

/// The places a clearance named, found among `places`: its limit and each
/// run of its route. No SID or STAR: the CIFP is not in a pack.
pub fn find(limit: Option<&str>, runs: &[&str], places: &[Place]) -> FoundPlaces {
    FoundPlaces {
        limit: limit.map(|l| point(l, places).unwrap_or(Found { said: l.to_owned(), ..Found::default() })),
        route: runs.iter().map(|r| points(r, places)).collect(),
        departure: None,
        arrival: None,
    }
}

/// The navaid kinds a route flies over, as vfr.fixes keeps them.
const NAVAID_KINDS: &[&str] = &["VORTAC", "VOR/DME", "VOR", "DME", "TACAN", "NDB/DME", "NDB"];

/// "SIOUX FALLS" as "Sioux Falls", as Python's str.title() writes it.
pub fn title(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut start = true;
    for c in s.chars() {
        if c.is_alphabetic() {
            out.extend(if start { c.to_uppercase().collect::<Vec<_>>() } else { c.to_lowercase().collect() });
            start = false;
        } else {
            out.push(c);
            start = true;
        }
    }
    out
}

/// The airports, navaids and fixes of a phone pack's tables (vfr.pack's
/// COLUMNS: NASR's APT_BASE, NAV_BASE and FIX_BASE, a row each): the
/// airports open to the public in service by their ICAO ident where they
/// have one, the navaids in service of the kinds a route flies over, by
/// their names, and every fix.
pub fn places_of(pack: &Pack) -> Vec<Place> {
    let mut out = Vec::new();
    let table = |name: &str| pack.section(name).and_then(|b| std::str::from_utf8(b).ok()).and_then(json::table);
    let num = |s: &str| s.trim().parse::<f64>().ok();
    if let Some(t) = table("airports") {
        let (id, icao, site, name, lat, lon, status) =
            (t.col("ARPT_ID"), t.col("ICAO_ID"), t.col("SITE_TYPE_CODE"), t.col("ARPT_NAME"), t.col("LAT_DECIMAL"), t.col("LONG_DECIMAL"), t.col("ARPT_STATUS"));
        for r in &t.rows {
            let get = |c: Option<usize>| c.and_then(|c| r.get(c)).map(String::as_str).unwrap_or("");
            if get(site) != "A" || get(status) == "CI" {
                continue;
            }
            let (Some(la), Some(lo)) = (num(get(lat)), num(get(lon))) else { continue };
            let ident = if get(icao).is_empty() { get(id) } else { get(icao) };
            out.push(Place { ident: ident.to_owned(), name: Some(title(get(name))), what: "airport", lat: la, lon: lo });
        }
    }
    if let Some(t) = table("navaids") {
        let (id, kind, name, status, lat, lon) = (t.col("NAV_ID"), t.col("NAV_TYPE"), t.col("NAME"), t.col("NAV_STATUS"), t.col("LAT_DECIMAL"), t.col("LONG_DECIMAL"));
        for r in &t.rows {
            let get = |c: Option<usize>| c.and_then(|c| r.get(c)).map(String::as_str).unwrap_or("");
            if !NAVAID_KINDS.contains(&get(kind)) || !get(status).starts_with("OPERATIONAL") {
                continue;
            }
            let (Some(la), Some(lo)) = (num(get(lat)), num(get(lon))) else { continue };
            out.push(Place { ident: get(id).to_owned(), name: Some(title(get(name))), what: "navaid", lat: la, lon: lo });
        }
    }
    if let Some(t) = table("fixes") {
        let (id, lat, lon) = (t.col("FIX_ID"), t.col("LAT_DECIMAL"), t.col("LONG_DECIMAL"));
        for r in &t.rows {
            let get = |c: Option<usize>| c.and_then(|c| r.get(c)).map(String::as_str).unwrap_or("");
            let (Some(la), Some(lo)) = (num(get(lat)), num(get(lon))) else { continue };
            out.push(Place { ident: get(id).to_owned(), name: None, what: "fix", lat: la, lon: lo });
        }
    }
    out
}

/// The places in nearness to the route's points (flat-earth distances,
/// enough for an order): of two that sound alike, the one by the route.
pub fn by_nearness(mut places: Vec<Place>, near: &[(f64, f64)]) -> Vec<Place> {
    if near.is_empty() {
        return places;
    }
    let squeeze = (near.iter().map(|p| p.0).sum::<f64>() / near.len() as f64).to_radians().cos();
    let d = |p: &Place| near.iter().map(|(la, lo)| (p.lat - la).powi(2) + ((p.lon - lo) * squeeze).powi(2)).fold(f64::INFINITY, f64::min);
    places.sort_by(|a, b| d(a).partial_cmp(&d(b)).unwrap());
    places
}

fn found_json(o: &mut String, f: &Found) {
    o.push_str("{\"said\":");
    json::string(o, &f.said);
    o.push_str(",\"ident\":");
    json::opt_string(o, f.ident.as_deref());
    o.push_str(",\"name\":");
    json::opt_string(o, f.name.as_deref());
    o.push_str(",\"kind\":");
    json::opt_string(o, f.kind);
    o.push_str(if f.sure { ",\"sure\":true}" } else { ",\"sure\":false}" });
}

/// What was heard, all the phone can make of it with no signal, as JSON:
/// the clearance (the web's Clearance), whether it was said to `tail`
/// and where its "direct" sends us, the places found in the kept packs
/// (the planner's ClearancePlaces, with the direct's), and the route it
/// gives from the one planned with the SID and STAR to pick (none
/// offline). `near`, the route's points, puts the nearer of two places
/// alike first.
pub fn hear(text: &str, tail: Option<&str>, places: Vec<Place>, near: &[(f64, f64)], planned: &crate::clearance::Route) -> String {
    use crate::clearance::{cleared_route, direct_of, our_call, read};
    let places = by_nearness(places, near);
    let c = read(text);
    let runs = c.place_runs();
    let found = find(c.limit.as_deref(), &runs, &places);
    let direct = direct_of(text);
    let direct_found = direct.as_deref().and_then(|d| points(d, &places).into_iter().find(|f| f.ident.is_some()));
    let (route, typed) = cleared_route(&c, &found, planned);
    let mut o = String::from("{\"clearance\":");
    o.push_str(&c.to_json());
    o.push_str(",\"forUs\":");
    o.push_str(if tail.is_some_and(|t| our_call(text, t)) { "true" } else { "false" });
    o.push_str(",\"direct\":");
    json::opt_string(&mut o, direct.as_deref());
    o.push_str(",\"directFound\":");
    match &direct_found {
        Some(f) => found_json(&mut o, f),
        None => o.push_str("null"),
    }
    o.push_str(",\"found\":{\"limit\":");
    match &found.limit {
        Some(f) => found_json(&mut o, f),
        None => o.push_str("null"),
    }
    o.push_str(",\"route\":[");
    for (k, run) in found.route.iter().enumerate() {
        if k > 0 {
            o.push(',');
        }
        o.push('[');
        for (m, f) in run.iter().enumerate() {
            if m > 0 {
                o.push(',');
            }
            found_json(&mut o, f);
        }
        o.push(']');
    }
    o.push_str("],\"departure\":null,\"arrival\":null},\"route\":{\"dep\":");
    json::string(&mut o, &route.dep);
    o.push_str(",\"stops\":[");
    for (k, s) in route.stops.iter().enumerate() {
        if k > 0 {
            o.push(',');
        }
        json::string(&mut o, s);
    }
    o.push_str("],\"dest\":");
    json::string(&mut o, &route.dest);
    o.push_str("},\"typed\":[");
    for (k, t) in typed.iter().enumerate() {
        if k > 0 {
            o.push(',');
        }
        o.push_str("{\"name\":");
        json::string(&mut o, &t.name);
        o.push_str(",\"before\":");
        json::opt_string(&mut o, t.before.as_deref());
        o.push_str(",\"after\":");
        json::opt_string(&mut o, t.after.as_deref());
        o.push('}');
    }
    o.push_str("]}");
    o
}

#[cfg(test)]
mod tests {
    use super::*;

    fn place(ident: &str, name: Option<&str>, what: &'static str, lat: f64, lon: f64) -> Place {
        Place { ident: ident.into(), name: name.map(Into::into), what, lat, lon }
    }

    /// tests/test_spoken.py's places, round KMSP and KDLH.
    fn places() -> Vec<Place> {
        vec![
            place("GEP", Some("Gopher"), "navaid", 45.15, -93.37),
            place("DLH", Some("Duluth"), "navaid", 46.80, -92.20),
            place("FSD", Some("Sioux Falls"), "navaid", 43.65, -96.78),
            place("PYKLA", None, "fix", 46.83, -91.85),
            place("KVUSI", None, "fix", 45.8, -92.9),
            place("BUNYN", None, "fix", 45.3, -93.1),
            place("KDLH", Some("Duluth International Airport"), "airport", 46.84, -92.19),
        ]
    }

    #[test]
    fn a_sound_is_its_consonants() {
        assert_eq!(sound("pickla"), "PKL");
        assert_eq!(sound("PYKLA"), "PKL");
        assert_eq!(sound("bunyan"), sound("BUNYN"));
        assert_eq!(sound("snows"), sound("SNOWZ"));
        assert_eq!(sound("ohana"), sound("OANNA"));
        assert_eq!(spelled("pickla"), "PAKLA");
        assert_eq!(spelled("PCKLE"), "PKLA");
    }

    #[test]
    fn ratio_is_difflibs() {
        // difflib.SequenceMatcher(None, a, b).ratio(), from Python.
        assert!((ratio("PKL", "PKL") - 1.0).abs() < 1e-12);
        assert!((ratio("ABCD", "BCDA") - 0.75).abs() < 1e-12);
        assert!((ratio("PAKLA", "PKLA") - 8.0 / 9.0).abs() < 1e-12);
        assert_eq!(ratio("", "X"), 0.0);
    }

    #[test]
    fn an_ident_or_a_name_is_found_outright() {
        assert_eq!(point("GEP", &places()).unwrap().ident.as_deref(), Some("GEP"));
        let g = point("the Gopher VOR", &places()).unwrap();
        assert_eq!((g.ident.as_deref(), g.kind, g.sure), (Some("GEP"), Some("navaid"), true));
        assert_eq!(point("Sioux Falls", &places()).unwrap().ident.as_deref(), Some("FSD"));
    }

    #[test]
    fn a_fix_said_as_a_word_is_found_by_its_sound_unsure() {
        let f = point("pickla", &places()).unwrap();
        assert_eq!((f.ident.as_deref(), f.sure), (Some("PYKLA"), false));
        let mut more = vec![place("PCKLE", None, "fix", 46.9, -91.9)];
        more.extend(places());
        assert_eq!(point("pickla", &more).unwrap().ident.as_deref(), Some("PYKLA"));
        assert!(point("zebra", &places()).is_none());
    }

    #[test]
    fn airport_after_a_name_is_the_field() {
        // AIM 4-4-3 a: an airport and its navaid often share a name.
        assert_eq!(point("the Duluth airport", &places()).unwrap().ident.as_deref(), Some("KDLH"));
        assert_eq!(point("Duluth", &places()).unwrap().ident.as_deref(), Some("DLH"));
    }

    #[test]
    fn a_route_with_no_commas_is_its_places_in_order() {
        let found = points("Gopher Sioux Falls pickla wibble", &places());
        let idents: Vec<_> = found.iter().map(|f| f.ident.clone()).collect();
        assert_eq!(idents, vec![Some("GEP".into()), Some("FSD".into()), Some("PYKLA".into()), None]);
        assert_eq!(found[3].said, "wibble");
    }

    #[test]
    fn a_navaids_name_comes_before_a_fix_spelled_as_the_word() {
        let p = vec![
            place("FLINT", None, "fix", 43.0, -83.7),
            place("FNT", Some("Flint"), "navaid", 42.97, -83.74),
            place("LVZ", Some("Wilkes-Barre"), "navaid", 41.27, -75.69),
        ];
        assert_eq!(point("Flint", &p).unwrap().ident.as_deref(), Some("FNT"));
        assert_eq!(point("flint intersection", &p).unwrap().ident.as_deref(), Some("FLINT"));
        let idents: Vec<_> = points("Wilkes Barre Flint", &p).into_iter().map(|f| f.ident).collect();
        assert_eq!(idents, vec![Some("LVZ".into()), Some("FNT".into())]);
    }

    #[test]
    fn names_are_titled_as_python_titles_them() {
        assert_eq!(title("SIOUX FALLS"), "Sioux Falls");
        assert_eq!(title("WILKES-BARRE"), "Wilkes-Barre");
    }
}
