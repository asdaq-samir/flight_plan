//! A flight risk assessment before each flight (web/src/lib/frat.ts and
//! lib/airworthiness.ts; the roadmap's FRAT, after the FAA Risk Management
//! Handbook's PAVE and IMSAFE, FAA-H-8083-2): points for what raises the
//! risk of this flight -- from the briefing (VFR not recommended, the
//! pilot's own minimums, a TFR on the route, SIGMETs and G-AIRMETs,
//! night), from the nav log's fuel check, from the pilot's own airplane's
//! inspections, from the pilot's logbook (the flight review, the medical,
//! recent landings) -- and for what only the pilot knows: IMSAFE, and the
//! pressures on the day.
//!
//! The points and where they turn the assessment amber and red are the
//! planner's own guide, not the FAA's and not a rule: the decision is the
//! pilot in command's (91.3, 91.103). What makes a flight unlawful --
//! alcohol within 8 hours, a lapsed flight review or medical, tanks that
//! do not hold the fuel, an annual past due -- is high whatever else is.
//!
//! Dates are the pilot's days, "yyyy-mm-dd", compared as strings as the
//! web compares them.

use crate::json;

/// One factor: why it counts (the rule or the reason), its points, and
/// whether it makes the flight unlawful as planned (`stop`: high,
/// whatever the points). A self check's keeps its group.
#[derive(Clone, Debug, PartialEq)]
pub struct Factor {
    pub key: String,
    pub label: String,
    pub why: Option<String>,
    pub points: i64,
    pub stop: bool,
    pub group: Option<String>,
}

fn factor(key: &str, label: impl Into<String>, why: impl Into<String>, points: i64, stop: bool) -> Factor {
    Factor { key: key.into(), label: label.into(), why: Some(why.into()), points, stop, group: None }
}

/// A check only the pilot can answer: key, group, label, why, points,
/// stop.
pub struct SelfCheck {
    pub key: &'static str,
    pub group: &'static str,
    pub label: &'static str,
    pub why: &'static str,
    pub points: i64,
    pub stop: bool,
}

const fn check(key: &'static str, group: &'static str, label: &'static str, why: &'static str, points: i64) -> SelfCheck {
    SelfCheck { key, group, label, why, points, stop: false }
}

/// What only the pilot can say, ticked where it is so: the IMSAFE
/// checklist and PAVE's pressures and unfamiliarity.
pub const SELF_CHECKS: [SelfCheck; 9] = [
    check("illness", "You", "Ill, or not over it yet", "IMSAFE: illness", 5),
    check("medication", "You", "On a medication that could impair you", "61.53, IMSAFE: medication", 5),
    check("stress", "You", "Under stress: work, home or money", "IMSAFE: stress", 3),
    SelfCheck { key: "alcohol", group: "You", label: "Alcohol in the last 8 hours, or still feeling it", why: "91.17", points: 0, stop: true },
    check("fatigue", "You", "Under 8 hours' sleep, or a long day already", "IMSAFE: fatigue", 4),
    check("eating", "You", "Hungry or thirsty", "IMSAFE: eating", 1),
    check("pressure", "The day", "Somewhere to be by a time, or people counting on it", "PAVE: external pressures", 3),
    check("unfamiliar", "The day", "A field or a route new to you", "PAVE: environment", 2),
    check("rusty", "The day", "Not flown this airplane in 30 days", "PAVE: aircraft", 3),
];

/// At these points the assessment is amber, and at these red.
pub const CAUTION_FROM: i64 = 6;
pub const HIGH_FROM: i64 = 12;

/// Each level's name and what to do at it.
pub const LEVELS: [(&str, &str, &str); 3] = [
    ("low", "Low", "Go, with the usual care."),
    ("caution", "Raised", "Bring it down where you can (a later time, a shorter leg, an instructor along), or talk it over."),
    ("high", "High", "Don't go as planned."),
];

pub fn level_name(level: &str) -> &str {
    LEVELS.iter().find(|l| l.0 == level).map_or(level, |l| l.1)
}

pub fn level_words(level: &str) -> Option<&'static str> {
    LEVELS.iter().find(|l| l.0 == level).map(|l| l.2)
}

/// The pilot's own airplane's inspections and tests as its owner recorded
/// them, each its last good day, "yyyy-mm-dd" (None not recorded).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Inspections {
    pub annual_good_through: Option<String>,
    pub elt_inspection_good_through: Option<String>,
    pub elt_battery_due_on: Option<String>,
    pub static_check_good_through: Option<String>,
    pub transponder_check_good_through: Option<String>,
    pub hundred_hour_due_at_hours: Option<f64>,
    pub hours_now: Option<f64>,
}

fn given(s: &Option<String>) -> Option<&str> {
    s.as_deref().filter(|s| !s.is_empty())
}

/// Whether the pilot's own airplane may be flown on the day, by the
/// inspections and tests its owner has recorded: each recorded one past
/// its last good day is a factor. What has not been recorded says
/// nothing, either way.
///
/// - The annual (14 CFR 91.409(a)) and the ELT's inspection (91.207(d))
///   or its battery past the date marked on it (91.207(c)): no flight as
///   planned. The ELT's are not owed on a training flight within 50 nm of
///   its departure, among 91.207(f)'s exceptions, which the pilot weighs.
/// - The altimeter and static test (91.411(a)): no IFR in controlled
///   airspace, so a stop under IFR and nothing under VFR.
/// - The transponder test (91.413(a)): the transponder may not be used,
///   which keeps the flight out of the airspace 91.215(b) requires one in
///   -- a caution, as a flight can stay out of it.
/// - The 100-hour (91.409(b)): owed only for hire, or for instruction in
///   an airplane the instructor provides -- a caution.
pub fn inspection_factors(i: &Inspections, day: &str, ifr: bool) -> Vec<Factor> {
    let past = |good_through: &Option<String>| given(good_through).is_some_and(|g| g < day);
    let mut factors = Vec::new();
    if past(&i.annual_good_through) {
        factors.push(factor("annual", "The airplane's annual inspection is past due", "91.409(a)", 0, true));
    }
    if past(&i.elt_inspection_good_through) {
        factors.push(factor("elt", "The ELT's inspection is past due", "91.207(d), but for 91.207(f)'s exceptions", 0, true));
    }
    // The battery is to be replaced by the date marked: on it, it is due.
    if given(&i.elt_battery_due_on).is_some_and(|d| d <= day) {
        factors.push(factor("eltBattery", "The ELT's battery is past its replacement date", "91.207(c), but for 91.207(f)'s exceptions", 0,
                            true));
    }
    if ifr && past(&i.static_check_good_through) {
        factors.push(factor("static", "The altimeter and static test is past due: no IFR in controlled airspace", "91.411(a)", 0, true));
    }
    if past(&i.transponder_check_good_through) {
        factors.push(factor("transponder", "The transponder test is past due: stay out of the airspace that needs one",
                            "91.413(a), 91.215(b)", 3, false));
    }
    if let (Some(due), Some(now)) = (i.hundred_hour_due_at_hours, i.hours_now) {
        if now >= due {
            factors.push(factor("hundredHour", "The 100-hour inspection is due",
                                "91.409(b): carrying anyone for hire, or flight instruction for hire in an airplane you provide", 2, false));
        }
    }
    factors
}

/// How far a 91.213(d) determination reaches: VFR by day, by day and
/// night, or every kind of flight (91.205(b)-(d)).
pub fn reach(deferred_for: &str) -> Option<i64> {
    match deferred_for {
        "VFR_DAY" => Some(0),
        "VFR" => Some(1),
        "ALL" => Some(2),
        _ => None,
    }
}

/// A squawk not yet fixed: what it says, whether the item is inoperative,
/// and how far its 91.213(d) determination reaches, where one was made.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Squawk {
    pub text: String,
    pub inoperative: bool,
    pub deferred_for: Option<String>,
}

/// The airplane's open squawks on the day: an instrument or equipment
/// that does not work stops the flight unless its 91.213(d) determination
/// was made for this kind of flight (by day, at night, under IFR: what
/// 91.205 does not ask by day it may at night or under IFR); the others
/// are a caution to read before flight (91.7(b)).
pub fn squawk_factors(open: &[Squawk], night: bool, ifr: bool) -> Vec<Factor> {
    let needs = if ifr { 2 } else if night { 1 } else { 0 };
    // A reach the web's REACH does not have compares as undefined: never
    // less, so that squawk is not one that grounds.
    let grounding: Vec<&Squawk> = open
        .iter()
        .filter(|s| s.inoperative && s.deferred_for.as_deref().map_or(true, |d| reach(d).is_some_and(|r| r < needs)))
        .collect();
    let mut factors = Vec::new();
    if !grounding.is_empty() {
        let texts: Vec<&str> = grounding.iter().map(|s| s.text.as_str()).collect();
        factors.push(factor("inoperative", format!("Inoperative and not deferred for this flight: {}", texts.join("; ")), "91.213(d)", 0,
                            true));
    }
    let others = open.len() - grounding.len();
    if others > 0 {
        let (s, it) = if others == 1 { ("", "it") } else { ("s", "them") };
        factors.push(factor("squawks", format!("{others} open squawk{s}: read {it} before flight"), "91.7(b)", 1, false));
    }
    factors
}

/// The pilot's currency from their logbook: the dates the last days each
/// holds, "yyyy-mm-dd" (None not known).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Currency {
    pub flights: f64,
    pub total_hours: f64,
    pub day_passengers_until: Option<String>,
    pub night_passengers_until: Option<String>,
    pub instrument_current_until: Option<String>,
    pub ipc_needed_after: Option<String>,
    pub flight_review_until: Option<String>,
    pub medical_expires_on: Option<String>,
}

/// The airplane's VOR check (91.171) as the input has it: no airplane of
/// the pilot's own (a stock profile, the web's undefined), one with none
/// recorded (null), or the check's last good day and whether its error
/// was within limits.
#[derive(Clone, Debug, Default, PartialEq)]
pub enum VorCheck {
    #[default]
    Absent,
    None,
    Checked { good_through: String, within_limit: bool },
}

/// The web's FratInput.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Input {
    pub vfr_not_recommended: bool,
    pub under_minimums: Vec<String>,
    pub tfr_on_route: bool,
    /// SIGMETs and G-AIRMETs along the route during the flight.
    pub hazards: i64,
    pub night: bool,
    /// The nav log's fuel margin, gallons; below zero the tanks do not
    /// hold the fuel and its reserve.
    pub fuel_margin_gal: Option<f64>,
    pub ifr: bool,
    pub vor_check: VorCheck,
    pub inspections: Option<Inspections>,
    pub squawks: Option<Vec<Squawk>>,
    pub currency: Option<Currency>,
    /// The day of the flight, "yyyy-mm-dd", to read the dates on.
    pub day: String,
    /// The self checks ticked, by key.
    pub ticked: Vec<String>,
}

/// What the briefing, the nav log and the logbook raise.
fn found(f: &Input) -> Vec<Factor> {
    let day = f.day.as_str();
    let mut factors = Vec::new();
    if f.vfr_not_recommended {
        factors.push(factor("vnr", "VFR flight not recommended", "The briefing (AIM 7-1-5)", HIGH_FROM, false));
    }
    if let Some(first) = f.under_minimums.first() {
        factors.push(factor("minimums", "Under your personal minimums", first.clone(), HIGH_FROM, false));
    }
    if f.tfr_on_route {
        factors.push(factor("tfr", "A TFR on the route when you get there", "Route round it, or go another time", HIGH_FROM, false));
    }
    if f.hazards > 0 {
        let s = if f.hazards == 1 { "" } else { "s" };
        factors.push(factor("hazards", format!("{} SIGMET or G-AIRMET{s} along the route", f.hazards), "Adverse conditions",
                            (2 * f.hazards).min(6), false));
    }
    if f.night {
        factors.push(factor("night", "At night", "PAVE: environment", 3, false));
    }
    // Under IFR by VOR, a check within 30 days (91.171): without one, by
    // GPS alone -- a caution, not a stop.
    if f.ifr {
        let good = match &f.vor_check {
            VorCheck::Absent => true,
            VorCheck::None => false,
            VorCheck::Checked { good_through, within_limit } => *within_limit && good_through.as_str() >= day,
        };
        if !good {
            factors.push(factor("vor", "No VOR check in the last 30 days", "91.171: to navigate IFR by VOR", 2, false));
        }
    }
    if let Some(i) = &f.inspections {
        factors.extend(inspection_factors(i, day, f.ifr));
    }
    if let Some(s) = &f.squawks {
        factors.extend(squawk_factors(s, f.night, f.ifr));
    }
    if f.fuel_margin_gal.is_some_and(|m| m < 0.0) {
        factors.push(factor("fuel", "The tanks do not hold the fuel and its reserve", if f.ifr { "91.167" } else { "91.151" }, 0, true));
    }
    if let Some(c) = f.currency.as_ref().filter(|c| c.flights > 0.0) {
        let before = |d: &Option<String>| given(d).is_some_and(|d| d < day);
        let lapsed = |d: &Option<String>| given(d).is_none_or(|d| d < day);
        if before(&c.flight_review_until) {
            factors.push(factor("review", "Your flight review has lapsed", "61.56", 0, true));
        }
        if before(&c.medical_expires_on) {
            factors.push(factor("medical", "Your medical has expired", "61.23", 0, true));
        }
        // Under IFR: instrument currency (61.57(c)), or after six months
        // more lapsed only a proficiency check (61.57(d)).
        if f.ifr && lapsed(&c.instrument_current_until) {
            let ipc = before(&c.ipc_needed_after);
            factors.push(if ipc {
                factor("instrument", "Instrument currency lapsed: a proficiency check is needed", "61.57(d)", 0, true)
            } else {
                factor("instrument", "Not instrument current", "61.57(c): 6 approaches, holding, tracking", 0, true)
            });
        }
        if lapsed(&c.day_passengers_until) {
            factors.push(factor("recent", "Not three takeoffs and landings in the last 90 days",
                                "61.57(a)(1): same category and class; no passengers, and rusty", 3, false));
        }
        if f.night && lapsed(&c.night_passengers_until) {
            // `night` is 14 CFR 1.1's, from the end of civil twilight;
            // 61.57(b) binds from an hour after sunset to an hour before
            // sunrise, a little later, so this errs toward the caution and
            // says the window.
            factors.push(factor("recent-night", "Not three night takeoffs and landings to a full stop in the last 90 days",
                                "61.57(b): needed from 1 h after sunset to 1 h before sunrise", 3, false));
        }
        if c.total_hours < 100.0 {
            factors.push(factor("low-time", "Under 100 hours in your logbook", "PAVE: pilot", 2, false));
        }
    }
    factors
}

pub struct Assessment {
    pub score: i64,
    /// "low", "caution" or "high".
    pub level: &'static str,
    /// What raised it, the briefing's and the logbook's first, then the
    /// self checks ticked, in their own order.
    pub factors: Vec<Factor>,
}

/// The whole assessment: the factors found and the ones ticked, their
/// points, and the level they make.
pub fn assess(f: &Input) -> Assessment {
    let mut factors = found(f);
    for c in SELF_CHECKS.iter().filter(|c| f.ticked.iter().any(|t| t == c.key)) {
        factors.push(Factor {
            key: c.key.into(), label: c.label.into(), why: Some(c.why.into()), points: c.points, stop: c.stop, group: Some(c.group.into()),
        });
    }
    let score = factors.iter().map(|x| x.points).sum();
    let level = if factors.iter().any(|x| x.stop) || score >= HIGH_FROM {
        "high"
    } else if score >= CAUTION_FROM {
        "caution"
    } else {
        "low"
    };
    Assessment { score, level, factors }
}

/// An assessment in a few words: "Raised · 8 points".
pub fn risk_line(level: &str, score: i64) -> String {
    format!("{} · {score} point{}", level_name(level), if score == 1 { "" } else { "s" })
}

/// A factor's mark as the web's RiskAssessment draws it beside what the
/// briefing, the nav log and the logbook raised: a stop where it makes the
/// flight unlawful or is high on its own, else a caution. A self check
/// gets none: the page ticks it, and draws no mark (RiskAssessment.tsx).
pub fn mark(f: &Factor) -> Option<&'static str> {
    if f.group.is_some() {
        None
    } else if f.stop || f.points >= HIGH_FROM {
        Some("stop")
    } else {
        Some("caution")
    }
}

pub fn factor_json(out: &mut String, f: &Factor) {
    out.push_str("{\"key\":");
    json::string(out, &f.key);
    out.push_str(",\"label\":");
    json::string(out, &f.label);
    out.push_str(",\"why\":");
    json::opt_string(out, f.why.as_deref());
    out.push_str(&format!(",\"points\":{},\"stop\":{}", f.points, f.stop));
    if let Some(group) = &f.group {
        out.push_str(",\"group\":");
        json::string(out, group);
    }
    out.push_str(",\"finding\":");
    json::opt_string(out, mark(f));
    out.push('}');
}

pub fn factors_json(factors: &[Factor]) -> String {
    let mut out = String::from("[");
    for (i, f) in factors.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        factor_json(&mut out, f);
    }
    out.push(']');
    out
}

/// The assessment as POST /api/go-no-go's `risk` answers it, JSON: its
/// points, level, line and what to do, and every factor with its mark.
pub fn assessment_json(a: &Assessment) -> String {
    let mut out = format!("{{\"score\":{},\"level\":\"{}\",\"line\":", a.score, a.level);
    json::string(&mut out, &risk_line(a.level, a.score));
    out.push_str(",\"words\":");
    json::opt_string(&mut out, level_words(a.level));
    out.push_str(",\"factors\":");
    out.push_str(&factors_json(&a.factors));
    out.push('}');
    out
}

/// The self checks as the Brief's Risk page lists them, in order, JSON:
/// each its key, group, label, why, points and stop, with no mark.
pub fn self_checks_json() -> String {
    let checks: Vec<Factor> = SELF_CHECKS
        .iter()
        .map(|c| Factor { key: c.key.into(), label: c.label.into(), why: Some(c.why.into()), points: c.points, stop: c.stop,
                          group: Some(c.group.into()) })
        .collect();
    factors_json(&checks)
}
