//! An approach taught as an instructor teaches it, at the owner's ask
//! ("do it all", 2026-10-30): briefed before anything moves, flown fix by
//! fix with a word at each, and asked back. All of it from the FAA's coded
//! procedure (wingtip.procedures, the CIFP) and the field's radio: what the
//! coded data does not hold -- the minimums above all -- is "See the
//! plate", never a figure made up. A training aid; the plate flies.
//!
//! The web's lib/approachLesson, ported line for line. Its sentences come
//! with it: nearly every one states the procedure's own figures -- a
//! crossing altitude, the course, the descent rate at a ground speed, the
//! miles and the time to the missed approach point, which minimums apply
//! -- and the quiz's wrong choices are the procedure's other values, so
//! the phone that teaches the lesson offline says and asks the very same.

use super::{Drawing, Fix, MissedLeg, FT_PER_NM};
use crate::figures::words::{alt_ft, bearing, feet, grouped, js_num, js_round_f, to_fixed};
use crate::geo::distance_nm;
use crate::motion::rad;
use crate::route::picks::{altitude_lines, Crossing};

/// "See the plate": what the lesson says where the coded data has nothing.
pub const SEE_THE_PLATE: &str = "See the plate";
const SEE_THE_PLATE_LOWER: &str = "see the plate";

/// The rate of descent that holds a path of `angle_deg` at a ground speed
/// of `gs_kt`, ft/min: the ground speed in feet a minute times the path's
/// tangent -- GS × 101.3 × tan(angle), about GS × 5.3 on a 3.00° path, the
/// FAA's Rate of Descent Table in the front of each Terminal Procedures
/// Publication (478 ft/min at 90 kt on 3.0°) and FAA-H-8083-16B, chapter 4.
pub fn descent_fpm(gs_kt: f64, angle_deg: f64) -> f64 {
    ((gs_kt * FT_PER_NM) / 60.0) * rad(angle_deg).tan()
}

/// A descent rate as a pilot sets it on the VSI: to the nearest 10 ft/min.
pub fn rounded_fpm(fpm: f64) -> f64 {
    js_round_f(fpm / 10.0) * 10.0
}

/// An airplane's approach category by its speed, 14 CFR 97.3: VREF, or
/// 1.3 × VSO where no VREF is specified, at the maximum certificated
/// landing weight -- A under 91 kt, B 91 to under 121, C 121 to under 141,
/// D 141 to under 166, E 166 and over. None with neither speed.
pub fn approach_category(vref_kt: Option<f64>, vso_kt: Option<f64>) -> Option<&'static str> {
    let speed = vref_kt.or(vso_kt.map(|v| 1.3 * v))?;
    // Not over zero (or not a number): no speed.
    if speed.partial_cmp(&0.0) != Some(std::cmp::Ordering::Greater) {
        return None;
    }
    Some(if speed < 91.0 {
        "A"
    } else if speed < 121.0 {
        "B"
    } else if speed < 141.0 {
        "C"
    } else if speed < 166.0 {
        "D"
    } else {
        "E"
    })
}

/// Which minimums an approach is flown to, by its kind (AIM 5-4-5 and
/// FAA-H-8083-16B, chapter 4): a decision altitude on a precision approach
/// (ILS, GLS) and on an RNP AR one; an RNAV (GPS) one's lines are a DA
/// (LPV, LNAV/VNAV) or an MDA (LNAV); every other a minimum descent
/// altitude.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MinimumsKind {
    Da,
    Mda,
    DaOrMda,
}

impl MinimumsKind {
    pub fn key(self) -> &'static str {
        match self {
            MinimumsKind::Da => "DA",
            MinimumsKind::Mda => "MDA",
            MinimumsKind::DaOrMda => "DA or MDA",
        }
    }
}

/// Whether `name` starts with the word `word`: what follows it is not a
/// letter, a figure or "_" (a regular expression's \b).
fn starts_with_word(name: &str, word: &str) -> bool {
    name.strip_prefix(word).is_some_and(|rest| !rest.chars().next().is_some_and(|c| c.is_ascii_alphanumeric() || c == '_'))
}

pub fn minimums_kind(name: &str) -> MinimumsKind {
    if starts_with_word(name, "ILS") || starts_with_word(name, "GLS") || name.starts_with("RNAV (RNP)") {
        return MinimumsKind::Da;
    }
    if name.starts_with("RNAV (GPS)") || starts_with_word(name, "GPS") {
        return MinimumsKind::DaOrMda;
    }
    MinimumsKind::Mda
}

/// A fix as said aloud: a runway's threshold ("RW08") by its runway.
pub fn fix_name(ident: &str) -> String {
    let b = ident.as_bytes();
    let runway = b.len() >= 4
        && b.len() <= 5
        && ident.starts_with("RW")
        && b[2].is_ascii_digit()
        && b[3].is_ascii_digit()
        && (b.len() == 4 || matches!(b[4], b'L' | b'R' | b'C'));
    if runway {
        format!("the runway {} threshold", &ident[2..])
    } else {
        ident.to_owned()
    }
}

/// A time as a stopwatch says it: "2:05", as the web writes it.
pub fn stopwatch(seconds: f64) -> String {
    let whole = js_round_f(seconds);
    let secs = js_num(whole % 60.0);
    format!("{}:{}{secs}", js_num((whole / 60.0).floor()), if secs.chars().count() < 2 { "0" } else { "" })
}

/// The first letter capitalised, or lowered, as the sentences join.
fn upper_first(s: &str) -> String {
    let mut c = s.chars();
    c.next().map_or_else(String::new, |f| f.to_uppercase().collect::<String>() + c.as_str())
}

fn lower_first(s: &str) -> String {
    let mut c = s.chars();
    c.next().map_or_else(String::new, |f| f.to_lowercase().collect::<String>() + c.as_str())
}

/// The approach's own fixes in the order flown: its missed approach's left
/// out.
pub fn approach_fixes(d: &Drawing) -> Vec<&Fix> {
    d.fixes.iter().filter(|f| !f.missed).collect()
}

/// The procedure's line in the order flown -- its transition, its final,
/// then its missed approach -- each joint once.
pub fn lesson_path(d: &Drawing) -> Vec<(f64, f64)> {
    let mut path: Vec<(f64, f64)> = Vec::new();
    for role in ["transition", "final", "missed"] {
        for line in d.lines.iter().filter(|l| l.role == role) {
            for &p in &line.points {
                if path.last() != Some(&p) {
                    path.push(p);
                }
            }
        }
    }
    path
}

fn nm(a: (f64, f64), b: (f64, f64)) -> f64 {
    distance_nm(a.0, a.1, b.0, b.1)
}

/// The point of `path` nearest `at`, from `from` on.
fn nearest_from(path: &[(f64, f64)], at: (f64, f64), from: usize) -> usize {
    let (mut best, mut best_nm) = (from, f64::INFINITY);
    for (i, &p) in path.iter().enumerate().skip(from) {
        let d = nm(p, at);
        if d < best_nm {
            (best, best_nm) = (i, d);
        }
    }
    best
}

/// The procedure's line from `a` on to `b`, each end where it is: the way
/// the lesson's airplane flies from one fix to the next. Straight between
/// them where the line has no point near either.
pub fn path_between(path: &[(f64, f64)], a: (f64, f64), b: (f64, f64)) -> Vec<(f64, f64)> {
    if path.len() < 2 {
        return vec![a, b];
    }
    let i = nearest_from(path, a, 0);
    let j = nearest_from(path, b, i);
    let mut out = vec![a];
    if i + 1 < j {
        out.extend_from_slice(&path[i + 1..j]);
    }
    out.push(b);
    out
}

/// How far along `path` its point nearest `at` is, nm.
pub fn along_nm(path: &[(f64, f64)], at: (f64, f64)) -> f64 {
    let i = nearest_from(path, at, 0);
    (1..=i).map(|k| nm(path[k - 1], path[k])).sum::<f64>()
}

fn turn_word(turn: Option<&str>) -> Option<&'static str> {
    match turn {
        Some("L") => Some("left"),
        Some("R") => Some("right"),
        _ => None,
    }
}

/// The altitude a missed approach's leg climbs to, as the plate says it.
fn climb_words(leg: &MissedLeg) -> Option<String> {
    match (leg.min_ft, leg.max_ft) {
        (Some(low), Some(high)) if low == high => Some(format!("at {}", alt_ft(Some(low)))),
        (Some(low), Some(high)) => Some(format!("to between {} and {}", alt_ft(Some(low)), alt_ft(Some(high)))),
        (Some(low), None) => Some(format!("to {}", alt_ft(Some(low)))),
        (None, Some(high)) => Some(format!("at or below {}", alt_ft(Some(high)))),
        (None, None) => None,
    }
}

/// Legs flown on a heading, and held (ARINC 424-18 5.21): the rest on a
/// course.
const HEADING_LEGS: [&str; 5] = ["VA", "VD", "VI", "VM", "VR"];
const HOLD_LEGS: [&str; 3] = ["HM", "HA", "HF"];

/// A leg's fix, where it names one.
fn leg_fix(leg: &MissedLeg) -> Option<&str> {
    leg.fix.as_deref().filter(|f| !f.is_empty())
}

/// Parts joined by spaces, the missing left out.
fn spaced(parts: &[Option<String>]) -> String {
    parts.iter().flatten().filter(|p| !p.is_empty()).cloned().collect::<Vec<_>>().join(" ")
}

/// One leg of a missed approach in the plate's words, None for one these
/// do not say (an arc, a procedure turn): the plate says it.
fn leg_words(leg: &MissedLeg) -> Option<String> {
    let turn = turn_word(leg.turn.as_deref());
    let climb = climb_words(leg);
    let dir = leg
        .course_deg
        .map(|c| format!("{} {}", if HEADING_LEGS.contains(&leg.path.as_str()) { "heading" } else { "course" }, bearing(c)));
    let fix = leg_fix(leg).map(fix_name);
    match leg.path.as_str() {
        "CA" | "VA" | "FA" => {
            // "Climb to 3,000 on heading 093°"; with a turn, "climbing left turn".
            if climb.is_none() && dir.is_none() {
                return None;
            }
            let start = turn.map_or_else(|| "climb".to_owned(), |t| format!("climbing {t} turn"));
            Some(spaced(&[Some(start), climb, dir.map(|d| format!("on {d}"))]))
        }
        "VI" | "CI" => {
            let dir = dir?;
            Some(format!("{} {dir} to intercept", turn.map_or_else(|| "fly".to_owned(), |t| format!("{t} turn to"))))
        }
        "VM" | "FM" => {
            let dir = dir?;
            Some(format!("{} {dir} for radar vectors", turn.map_or_else(|| "fly".to_owned(), |t| format!("{t} turn to"))))
        }
        "CF" | "TF" | "DF" => {
            let fix = fix?;
            let way = match (leg.path.as_str(), &dir) {
                ("DF", _) => format!("direct {fix}"),
                ("CF", Some(d)) => format!("on {d} to {fix}"),
                _ => format!("to {fix}"),
            };
            Some(spaced(&[turn.map(|t| format!("{t} turn")), Some(way), climb.map(|c| format!("climbing {c}"))]))
        }
        path if HOLD_LEGS.contains(&path) => {
            let fix = fix?;
            let parts: Vec<String> = [
                Some(format!("hold at {fix}")),
                turn.map(|t| format!("{t} turns")),
                leg.course_deg.map(|c| format!("{} inbound", bearing(c))),
            ]
            .into_iter()
            .flatten()
            .collect();
            Some(parts.join(", "))
        }
        _ => None,
    }
}

/// The missed approach as the plate's words say it, from its coded legs:
/// "Climb to 1,800 on course 079°, then right turn to heading 210° to
/// intercept, …, then hold at VTU, left turns, 131° inbound." Where a leg
/// is one these words do not say, the rest is the plate's; None with none,
/// or where the first is such a leg.
pub fn missed_words(legs: &[MissedLeg]) -> Option<String> {
    if legs.is_empty() {
        return None;
    }
    let mut parts: Vec<String> = Vec::new();
    for leg in legs {
        match leg_words(leg) {
            Some(words) => parts.push(words),
            None => {
                // Its first leg one these words do not say: all of it the plate's.
                if parts.is_empty() {
                    return None;
                }
                parts.push("as the plate shows".to_owned());
                break;
            }
        }
    }
    Some(format!("{}.", upper_first(&parts.join(", then "))))
}

/// A field's frequency, as its card lists it (OurAirports').
#[derive(Clone, Debug, PartialEq)]
pub struct Frequency {
    pub kind: Option<String>,
    pub description: Option<String>,
    pub mhz: Option<f64>,
}

impl Frequency {
    fn kind_upper(&self) -> String {
        self.kind.as_deref().unwrap_or("").to_uppercase()
    }
}

/// The first of `kinds`, in their order, with a frequency (lib/frequencies
/// frequencyOf).
fn frequency_of<'a>(frequencies: &'a [Frequency], kinds: &[&str]) -> Option<&'a Frequency> {
    kinds.iter().find_map(|k| frequencies.iter().find(|f| f.kind_upper() == *k && f.mhz.is_some()))
}

/// A frequency as the radio shows it: three places, one or two trailing
/// zeros dropped ("125.0", "119.15", "122.725").
fn mhz_text(mhz: f64) -> String {
    let mut text = to_fixed(mhz, 3);
    for _ in 0..2 {
        if text.ends_with('0') {
            text.pop();
        }
    }
    text
}

/// The field's radio a briefing calls, in its order: the weather, approach
/// control, then the tower, or the CTAF at a field with none.
pub fn brief_frequencies(frequencies: &[Frequency]) -> Vec<String> {
    if frequencies.is_empty() {
        return vec![SEE_THE_PLATE.to_owned()];
    }
    let mut lines: Vec<String> = Vec::new();
    let say = |lines: &mut Vec<String>, name: &str, f: Option<&Frequency>| {
        if let Some(mhz) = f.and_then(|f| f.mhz) {
            lines.push(format!("{name} {}", mhz_text(mhz)));
        }
    };
    let weather = frequency_of(frequencies, &["ATIS", "AWOS", "ASOS"]);
    let weather_name = weather.and_then(|w| w.kind.as_deref()).unwrap_or("ATIS").to_uppercase();
    say(&mut lines, &weather_name, weather);
    match frequency_of(frequencies, &["APP", "APCH", "A/D", "APP/DEP"]) {
        Some(approach) => say(&mut lines, "Approach", Some(approach)),
        None => lines.push(format!("Approach: {SEE_THE_PLATE_LOWER}")),
    }
    match frequency_of(frequencies, &["TWR"]) {
        Some(tower) => say(&mut lines, "Tower", Some(tower)),
        None => {
            // The CTAF the field lists (AC 90-66C 9.6): the one so called,
            // else a UNICOM that is also the CTAF, else the UNICOM. MULTICOM's
            // 122.9, the fallback where none is listed, is a guess at this
            // field, so it is not briefed.
            let ctaf = frequency_of(frequencies, &["CTAF"])
                .or_else(|| {
                    frequencies.iter().find(|f| {
                        f.kind_upper().starts_with("UNIC")
                            && f.description.as_deref().unwrap_or("").to_uppercase().contains("CTAF")
                            && f.mhz.is_some()
                    })
                })
                .or_else(|| frequency_of(frequencies, &["UNIC", "UNICOM"]));
            say(&mut lines, "CTAF", ctaf);
        }
    }
    lines
}

/// What a step of the lesson shows on the map: a fix ringed, a part of
/// the procedure's line ("transition", "final", "missed") drawn over.
#[derive(Clone, Debug, PartialEq)]
pub struct Focus {
    pub fix: Option<String>,
    pub segment: Option<&'static str>,
}

fn focus(fix: Option<&str>, segment: Option<&'static str>) -> Focus {
    Focus { fix: fix.map(str::to_owned), segment }
}

/// The parts of the approach the lesson goes by.
struct Parts<'a> {
    fixes: Vec<&'a Fix>,
    faf: Option<&'a Fix>,
    map: Option<&'a Fix>,
    path: Vec<(f64, f64)>,
    missed: Option<String>,
    minimums: MinimumsKind,
    drawing: &'a Drawing,
}

impl<'a> Parts<'a> {
    fn of(d: &'a Drawing) -> Parts<'a> {
        let fixes = approach_fixes(d);
        Parts {
            faf: fixes.iter().copied().find(|f| f.has("FAF")),
            map: fixes.iter().copied().find(|f| f.has("MAP")),
            fixes,
            path: lesson_path(d),
            missed: missed_words(&d.missed_legs),
            minimums: minimums_kind(&d.name),
            drawing: d,
        }
    }

    /// Whether a procedure turn is drawn at a fix (wingtip.procedures).
    fn turn_at(&self, ident: &str) -> bool {
        self.drawing.holds.iter().any(|h| h.fix == ident && h.kind == "procedure turn" && !h.missed)
    }

    /// A fix's distance on to the missed approach point along the line, nm.
    fn nm_to_map(&self, fix: &Fix) -> Option<f64> {
        let map = self.map?;
        Some((along_nm(&self.path, (map.lat, map.lon)) - along_nm(&self.path, (fix.lat, fix.lon))).max(0.0))
    }
}

/// What a fix is in the lesson's words, by the part it plays.
fn fix_title(fix: &Fix, after_faf: bool) -> &'static str {
    if fix.has("IAF") {
        "Initial Approach Fix"
    } else if fix.has("IF") || fix.has("FACF") {
        "Intermediate Fix"
    } else if fix.has("FAF") {
        "Final Approach Fix"
    } else if after_faf {
        "Step-Down Fix"
    } else {
        "Transition Fix"
    }
}

/// A fix's roles after its name, as a plate labels it: "SILEX (IAF)".
fn labelled(fix: &Fix, start: bool) -> String {
    let roles: Vec<&str> = fix.roles.iter().map(String::as_str).filter(|r| *r != "hold" && *r != "FACF").collect();
    let name = fix_name(&fix.ident);
    let said = if start { upper_first(&name) } else { name };
    if roles.is_empty() {
        said
    } else {
        format!("{said} ({})", roles.join(", "))
    }
}

/// A fix's crossing altitude in words, "at or above 3,300 ft", as the
/// chart sets it (crate::route::picks::altitude_lines); None with none.
fn altitude_words(fix: &Fix) -> Option<String> {
    let (crossing, _) = altitude_lines(fix.min_ft, fix.max_ft)?;
    Some(match crossing {
        Crossing::At => format!("at {} ft", alt_ft(fix.min_ft)),
        Crossing::Between => format!("between {} and {} ft", alt_ft(fix.min_ft), alt_ft(fix.max_ft)),
        Crossing::AtOrAbove => format!("at or above {} ft", alt_ft(fix.min_ft)),
        Crossing::AtOrBelow => format!("at or below {} ft", alt_ft(fix.max_ft)),
    })
}

/// The crossing altitude in words, capitalised as a line of its own.
fn cross_words(fix: &Fix) -> String {
    altitude_words(fix).map_or_else(|| format!("Altitude: {SEE_THE_PLATE_LOWER}"), |w| format!("Cross {w}"))
}

/// An item of the briefing: its key, title, lines and what it shows.
#[derive(Clone, Debug, PartialEq)]
pub struct BriefItem {
    pub key: String,
    pub title: &'static str,
    pub lines: Vec<String>,
    pub focus: Focus,
}

/// The approach briefing, the way an instructor has a student brief it
/// before the approach (FAA-H-8083-16B, chapter 4, "Approach Briefing", in
/// the order of the plate's briefing strip and plan view): the procedure,
/// the radio, the final approach course, each fix and its altitude from the
/// IAF to the FAF, the minimums, the missed approach point and the missed
/// approach. Each shows its fix or its part on the map.
pub fn approach_brief(d: &Drawing, frequencies: &[Frequency], vref_kt: Option<f64>, vso_kt: Option<f64>) -> Vec<BriefItem> {
    let parts = Parts::of(d);
    let mut items: Vec<BriefItem> = Vec::new();
    let mut approach = vec![format!("{} at {}", d.name, d.airport)];
    approach.push(match d.transition.as_deref() {
        Some(t) if !t.is_empty() => format!("From {t}"),
        _ => "Vectors to final".to_owned(),
    });
    if d.stale {
        approach.push("Out of date: these are an older cycle's data".to_owned());
    }
    items.push(BriefItem { key: "approach".to_owned(), title: "The Approach", lines: approach, focus: focus(None, None) });
    items.push(BriefItem {
        key: "frequencies".to_owned(),
        title: "Frequencies",
        lines: brief_frequencies(frequencies),
        focus: focus(None, None),
    });
    let mut course = vec![d.final_course_deg.map_or_else(|| SEE_THE_PLATE.to_owned(), |c| format!("{} magnetic", bearing(c)))];
    if let Some(angle) = d.glidepath_deg {
        course.push(format!("Glidepath {}°", to_fixed(angle, 2)));
    }
    items.push(BriefItem { key: "course".to_owned(), title: "Final Approach Course", lines: course, focus: focus(None, Some("final")) });
    let mut after_faf = false;
    for fix in parts.fixes.iter().filter(|f| !f.has("MAP")) {
        let mut lines = vec![labelled(fix, true), cross_words(fix)];
        if parts.turn_at(&fix.ident) {
            lines.push("Procedure turn here".to_owned());
        } else if fix.has("hold") {
            lines.push("Hold here as the plate shows".to_owned());
        }
        if fix.has("FAF") {
            lines.push(match d.glidepath_deg {
                Some(angle) => format!("Descend on the {}° path from here", to_fixed(angle, 2)),
                None => format!("Descend to the {} from here", parts.minimums.key()),
            });
            if let Some(nm) = parts.nm_to_map(fix).filter(|nm| *nm > 0.0) {
                lines.push(format!("{} nm to the missed approach point", to_fixed(nm, 1)));
            }
        }
        items.push(BriefItem {
            key: format!("fix:{}", fix.ident),
            title: fix_title(fix, after_faf),
            lines,
            focus: focus(Some(&fix.ident), None),
        });
        if fix.has("FAF") {
            after_faf = true;
        }
    }
    let mut minimums = vec![match parts.minimums {
        MinimumsKind::DaOrMda => format!("DA (LPV, LNAV/VNAV) or MDA (LNAV): {SEE_THE_PLATE_LOWER}"),
        kind => format!("{}: {SEE_THE_PLATE_LOWER}", kind.key()),
    }];
    if let Some(category) = approach_category(vref_kt, vso_kt) {
        minimums.push(format!("Category {category}"));
    }
    items.push(BriefItem { key: "minimums".to_owned(), title: "Minimums", lines: minimums, focus: focus(None, Some("final")) });
    if let Some(map) = parts.map {
        items.push(BriefItem {
            key: "map".to_owned(),
            title: "Missed Approach Point",
            lines: if parts.minimums == MinimumsKind::Da {
                vec!["At the decision altitude on the glidepath".to_owned(), format!("Coded at {}", fix_name(&map.ident))]
            } else {
                vec![labelled(map, true)]
            },
            focus: focus(Some(&map.ident), None),
        });
    }
    items.push(BriefItem {
        key: "missed".to_owned(),
        title: "Missed Approach",
        lines: vec![parts.missed.clone().unwrap_or_else(|| SEE_THE_PLATE.to_owned())],
        focus: focus(None, Some("missed")),
    });
    items
}

/// A step of the approach flown: what to do, why, where the airplane is,
/// what it shows and the altitude its fix is crossed at (for the profile;
/// None where none is coded, the minimums).
#[derive(Clone, Debug, PartialEq)]
pub struct CoachStep {
    pub key: String,
    pub title: String,
    pub say: String,
    pub why: Option<String>,
    pub at: Option<(f64, f64)>,
    pub focus: Focus,
    pub altitude_ft: Option<f64>,
}

/// The altitude a fix is crossed at, as the profile draws it.
fn crossing_ft(fix: &Fix) -> Option<f64> {
    fix.min_ft.or(fix.max_ft)
}

/// The last fix the missed approach's legs name: where it ends, the hold.
fn missed_hold_fix(d: &Drawing) -> Option<&str> {
    d.missed_legs.iter().rev().find_map(leg_fix)
}

/// The approach flown fix by fix with a word at each, at a ground speed of
/// `gs_kt`: what to do crossing each fix, the descent on the published path
/// at that speed from the FAF and the time to the missed approach point, at
/// the minimums the decision -- land, or the missed approach in its own
/// words (14 CFR 91.175(c) and (e)) -- and then the missed approach flown.
pub fn coaching_steps(d: &Drawing, gs_kt: f64) -> Vec<CoachStep> {
    let parts = Parts::of(d);
    let mut steps: Vec<CoachStep> = Vec::new();
    let course = d.final_course_deg.map(bearing);
    let angle = d.glidepath_deg;
    let minimums = match parts.minimums {
        MinimumsKind::Da => "the DA",
        MinimumsKind::Mda => "the MDA",
        MinimumsKind::DaOrMda => "the DA or MDA",
    };
    let gs = js_num(gs_kt);
    let fixes: Vec<&Fix> = parts.fixes.iter().copied().filter(|f| !f.has("MAP")).collect();
    let faf_at = fixes.iter().position(|f| f.has("FAF"));
    for (i, fix) in fixes.iter().enumerate() {
        let words = altitude_words(fix);
        let name = fix_name(&fix.ident);
        let crossing = format!("Cross {name}{}", words.as_ref().map_or_else(String::new, |w| format!(" {w}")));
        // The next lower altitude the final steps down to, else the minimums.
        let next_down = fixes[i + 1..].iter().find(|f| crossing_ft(f).is_some());
        let descend_to = match next_down {
            Some(next) => format!("{} at {}", alt_ft(crossing_ft(next)), fix_name(&next.ident)),
            None => format!("{minimums} ({SEE_THE_PLATE_LOWER})"),
        };
        let (say, why): (String, Option<String>) = if fix.has("FAF") {
            let say = match angle {
                Some(angle) => format!(
                    "Descend on the {}° path, about {} ft/min at {gs} kt, and start the timer",
                    to_fixed(angle, 2),
                    grouped(rounded_fpm(descent_fpm(gs_kt, angle)))
                ),
                None => format!("Descend to {descend_to} and start the timer"),
            };
            let to_map = parts.nm_to_map(fix).filter(|nm| *nm > 0.0).map_or_else(String::new, |nm| {
                format!(" {} nm to the missed approach point: {} at {gs} kt.", to_fixed(nm, 1), stopwatch((nm / gs_kt) * 3600.0))
            });
            (say, Some(format!("The final approach starts here.{to_map}")))
        } else if faf_at.is_some_and(|f| i > f) {
            (format!("{crossing}, then descend to {descend_to}"), Some("Not below this fix's altitude until it is passed.".to_owned()))
        } else if fix.has("IAF") {
            let say = if parts.turn_at(&fix.ident) { format!("{crossing} and fly the procedure turn the plate shows") } else { crossing };
            (say, Some("The approach begins here: hold each segment's altitude until its next fix.".to_owned()))
        } else if fix.has("IF") || fix.has("FACF") {
            let say = match &course {
                Some(c) => format!("{crossing} and turn onto the final approach course, {c}"),
                None => crossing,
            };
            // The intermediate segment positions the airplane for the final, its
            // speed and configuration set for it (FAA-H-8083-16B, chapter 4).
            (say, Some("The intermediate segment lines you up and slows you to your approach speed before the final.".to_owned()))
        } else {
            (if words.is_some() { crossing } else { format!("Fly to {name}") }, None)
        };
        steps.push(CoachStep {
            key: format!("fix:{}", fix.ident),
            title: format!("Crossing {}", labelled(fix, false)),
            say: format!("{say}."),
            why,
            at: Some((fix.lat, fix.lon)),
            focus: focus(Some(&fix.ident), None),
            altitude_ft: crossing_ft(fix),
        });
    }
    let go_missed = parts.missed.clone().unwrap_or_else(|| "fly the missed approach the plate shows.".to_owned());
    if let Some(map) = parts.map {
        steps.push(CoachStep {
            key: "decision".to_owned(),
            title: match parts.minimums {
                MinimumsKind::Da => "At the Decision Altitude",
                MinimumsKind::Mda => "At the Missed Approach Point",
                MinimumsKind::DaOrMda => "At the DA or Missed Approach Point",
            }
            .to_owned(),
            say: format!("Runway in sight? Land. Otherwise go missed: {}", lower_first(&go_missed)),
            // 14 CFR 91.175(c): below the DA or MDA only in a position to land
            // normally with the visibility and a runway reference in sight; (e):
            // the missed approach at once without them.
            why: Some(
                "Below the minimums only with the runway environment in sight and in position to land; without it, the missed approach at once (14 CFR 91.175(c), (e))."
                    .to_owned(),
            ),
            at: Some((map.lat, map.lon)),
            focus: focus(Some(&map.ident), Some("final")),
            altitude_ft: None,
        });
    }
    let end = d.lines.iter().rev().find(|l| l.role == "missed").and_then(|l| l.points.last().copied());
    if let (Some(missed), Some(end)) = (&parts.missed, end) {
        steps.push(CoachStep {
            key: "missed".to_owned(),
            title: "Going Missed".to_owned(),
            say: missed.clone(),
            // The standard missed approach climb gradient (FAA Order 8260.3),
            // as the dry run climbs it (motion::dry_run MISSED_CLIMB_FT_PER_NM).
            why: Some("Climb at once: a missed approach is built for a climb of 200 ft a mile unless the plate asks for more (FAA Order 8260.3).".to_owned()),
            at: Some(end),
            focus: focus(missed_hold_fix(d), Some("missed")),
            altitude_ft: None,
        });
    }
    steps
}

/// A point of the approach's side view: a fix's distance along the line
/// from the first and the altitude it is crossed at.
#[derive(Clone, Debug, PartialEq)]
pub struct ProfileMark {
    pub ident: String,
    pub along_nm: f64,
    pub ft: Option<f64>,
    pub faf: bool,
    pub map: bool,
}

/// The path down from the FAF: (nm, ft) at each end.
pub type ProfilePath = ((f64, f64), (f64, f64));

/// The approach from the side, a sketch from the coded data: each of its
/// fixes at its distance along the line and the altitude it is crossed at,
/// and where a path angle is coded, the path down from the FAF's altitude at
/// that angle to the missed approach point, as the plate's profile view
/// draws it.
pub fn lesson_profile(d: &Drawing) -> (Vec<ProfileMark>, Option<ProfilePath>) {
    let parts = Parts::of(d);
    let marks: Vec<ProfileMark> = parts
        .fixes
        .iter()
        .map(|f| ProfileMark {
            ident: f.ident.clone(),
            along_nm: along_nm(&parts.path, (f.lat, f.lon)),
            ft: if f.has("MAP") { None } else { crossing_ft(f) },
            faf: f.has("FAF"),
            map: f.has("MAP"),
        })
        .collect();
    let faf = marks.iter().find(|m| m.faf);
    let map = marks.iter().find(|m| m.map);
    let path = match (faf, map, d.glidepath_deg) {
        (Some(faf), Some(map), Some(angle)) if faf.ft.is_some() && map.along_nm > faf.along_nm => {
            let from_ft = faf.ft.unwrap_or_default();
            Some((
                (faf.along_nm, from_ft),
                (map.along_nm, from_ft - (map.along_nm - faf.along_nm) * FT_PER_NM * rad(angle).tan()),
            ))
        }
        _ => None,
    };
    (marks, path)
}

/// A question of the quiz: its choices, the right one's index, where the
/// answer is, and what it shows.
#[derive(Clone, Debug, PartialEq)]
pub struct QuizQuestion {
    pub key: String,
    pub prompt: String,
    pub choices: Vec<String>,
    pub answer: usize,
    pub explain: String,
    pub focus: Focus,
}

/// A string's hash (FNV-1a over its UTF-16 code units, as the web's
/// Math.imul sum), for each question's choices to be in an order of its
/// own, the same each time it is asked on every device.
fn hash(text: &str) -> u32 {
    let mut h: u32 = 2_166_136_261;
    for c in text.encode_utf16() {
        h = (h ^ u32::from(c)).wrapping_mul(16_777_619);
    }
    h
}

/// A question from its answer and its wrong choices: the wrong ones each
/// once, none the answer, at most three; none, no question.
fn question(key: &str, prompt: String, answer: String, wrong: Vec<String>, explain: String, focus: Focus) -> Option<QuizQuestion> {
    let mut others: Vec<String> = Vec::new();
    for w in wrong {
        if !others.contains(&w) {
            others.push(w);
        }
    }
    others.retain(|w| *w != answer);
    others.truncate(3);
    if others.is_empty() {
        return None;
    }
    let at = (hash(key) % (others.len() as u32 + 1)) as usize;
    let mut choices = others;
    choices.insert(at, answer);
    Some(QuizQuestion { key: key.to_owned(), prompt, choices, answer: at, explain, focus })
}

/// Whether an ident is a runway's ("RW" and a figure).
fn is_runway(ident: &str) -> bool {
    ident.starts_with("RW") && ident.as_bytes().get(2).is_some_and(u8::is_ascii_digit)
}

/// The lesson asked back, its answers hidden: multiple choice made from the
/// procedure's own data, each wrong choice another of its own values -- an
/// altitude another fix is crossed at, another fix, another course, the
/// descent rate at another ground speed -- so the right one is known only
/// by knowing the approach. Each answered says where it is.
pub fn approach_quiz(d: &Drawing, gs_kt: f64) -> Vec<QuizQuestion> {
    let parts = Parts::of(d);
    let mut out: Vec<Option<QuizQuestion>> = Vec::new();
    // Every altitude the procedure codes, for the wrong choices.
    let altitudes: Vec<String> = d
        .fixes
        .iter()
        .flat_map(|f| [f.min_ft, f.max_ft])
        .chain(d.missed_legs.iter().flat_map(|l| [l.min_ft, l.max_ft]))
        .flatten()
        .map(feet)
        .collect();
    let idents: Vec<String> = parts.fixes.iter().map(|f| f.ident.clone()).collect();
    for fix in parts.fixes.iter().filter(|f| f.min_ft.is_some() && (f.has("IAF") || f.has("IF") || f.has("FACF") || f.has("FAF"))) {
        let name = fix_name(&fix.ident);
        out.push(question(
            &format!("alt:{}", fix.ident),
            format!("What's the minimum altitude at {name}?"),
            feet(fix.min_ft.unwrap_or_default()),
            altitudes.clone(),
            format!(
                "{name}: cross {}, on the plate's profile view and by the fix on the map.",
                altitude_words(fix).unwrap_or_else(|| "null".to_owned())
            ),
            focus(Some(&fix.ident), None),
        ));
    }
    if let Some(faf) = parts.faf {
        out.push(question(
            "faf",
            "Which fix is the final approach fix?".to_owned(),
            faf.ident.clone(),
            idents.clone(),
            format!("{}, marked FAF on the plate's profile view, ringed on the map.", faf.ident),
            focus(Some(&faf.ident), None),
        ));
    }
    if let Some(final_course) = d.final_course_deg {
        let mut wrong = vec![bearing(final_course + 180.0)];
        wrong.extend(d.missed_legs.iter().filter_map(|l| l.course_deg.map(bearing)));
        out.push(question(
            "course",
            "What's the final approach course?".to_owned(),
            bearing(final_course),
            wrong,
            format!("{} magnetic, on the plate's plan view along the final, drawn over on the map.", bearing(final_course)),
            focus(None, Some("final")),
        ));
    }
    if let Some(angle) = d.glidepath_deg {
        let rate = |gs: f64| format!("{} ft/min", grouped(rounded_fpm(descent_fpm(gs, angle))));
        let deg = to_fixed(angle, 2);
        out.push(question(
            "descent",
            format!("On the {deg}° path at {} kt, about what descent rate?", js_num(gs_kt)),
            rate(gs_kt),
            [60.0, 90.0, 120.0, 150.0].into_iter().filter(|gs| *gs != gs_kt).map(rate).collect(),
            format!("About {}: the ground speed × 101.3 × tan {deg}°, as the TPP's rate of descent table gives it.", rate(gs_kt)),
            focus(parts.faf.map(|f| f.ident.as_str()), Some("final")),
        ));
    }
    if let Some(map) = parts.map {
        let where_ = match parts.minimums {
            MinimumsKind::Da => "the decision altitude",
            MinimumsKind::Mda => "the missed approach point",
            MinimumsKind::DaOrMda => "the DA or the missed approach point",
        };
        out.push(question(
            "decision",
            format!("What do you do at {where_} without the runway in sight?"),
            parts.missed.as_ref().map_or_else(|| "Go missed, as the plate shows".to_owned(), |m| format!("Go missed: {}", lower_first(m))),
            // The two a student most often gets wrong (14 CFR 91.175(c), (e)).
            vec!["Keep descending until the runway is in sight".to_owned(), "Circle over the field until the runway is in sight".to_owned()],
            "The missed approach at once (14 CFR 91.175(e)), as the plate's briefing strip and profile say it; drawn dashed on the map."
                .to_owned(),
            focus(Some(&map.ident), Some("missed")),
        ));
    }
    if let Some(hold_fix) = missed_hold_fix(d) {
        out.push(question(
            "missed-fix",
            "Where does the missed approach take you?".to_owned(),
            hold_fix.to_owned(),
            idents.iter().cloned().chain(d.fixes.iter().map(|f| f.ident.clone())).filter(|i| !is_runway(i)).collect(),
            format!("{hold_fix}, at the end of the missed approach's dashed line on the plate and the map."),
            focus(Some(hold_fix), Some("missed")),
        ));
    }
    out.into_iter().flatten().collect()
}
