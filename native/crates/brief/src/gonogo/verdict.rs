//! The Brief's Go / No-Go (web/src/lib/verdict.ts, which holds the same
//! rules for the web app: the two change together): every tab's own
//! finding about the flight in one list, each a row that opens where it
//! was found -- the weather, the airspace on the route, the altitude, the
//! fuel, the runways, the loading and the risk -- and one line over them
//! saying what they come to. What the pilot reads first on opening the
//! Brief, as a flight service briefer opens with adverse conditions and
//! whether VFR is recommended (AIM 7-1-5(b)(1), (b)(2)). The findings are
//! the planner's; the decision is the pilot in command's (14 CFR 91.3),
//! and the line says so.
//!
//! A finding (lib/status) is "ok", "caution", "stop", "unknown" or
//! "pending". Strings are taken as JavaScript takes them: one empty or
//! absent is not said.

use super::{said, strings};
use crate::figures::words::{js_num, one};
use crate::json;

/// The worst first (lib/status worstOf): a stop over a caution over not
/// known over still pending over nothing found.
pub const WORST_FIRST: [&str; 4] = ["stop", "caution", "unknown", "pending"];

pub fn worst_of(findings: &[&str]) -> &'static str {
    WORST_FIRST.iter().find(|f| findings.contains(f)).copied().unwrap_or("ok")
}

/// The risk assessment's level as a finding.
pub fn risk_finding(level: &str) -> &'static str {
    match level {
        "low" => "ok",
        "caution" => "caution",
        "high" => "stop",
        // RISK_FINDING[level] of a level it does not have: undefined, as
        // no finding the worst-of reads.
        _ => "",
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Weather {
    /// The section was not sent, or not what it decides by (its lists):
    /// nothing was checked, so nothing is said to be clear. A missing
    /// figure is "unknown", as the fuel's is, never "ok" (14 CFR 91.103:
    /// the pilot is to become familiar with all available information).
    pub missing: bool,
    /// The briefing is still being fetched, or failed (its words).
    pub pending: bool,
    pub failed: Option<String>,
    /// AIM 7-1-5's "VFR flight not recommended", its reasons.
    pub vfr_not_recommended: Vec<String>,
    /// Under the pilot's own minimums (minimums).
    pub under_minimums: Vec<String>,
    /// Under IFR, icing possible at an altitude flown (icing), in a line.
    pub icing: Option<String>,
    /// The SIGMETs and G-AIRMETs along the route, by name.
    pub hazards: Vec<String>,
    /// The sources that did not answer, by name.
    pub unchecked: Vec<String>,
    /// The worst the forecast says along the route, in words.
    pub worst: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Airspace {
    /// Not sent, as Weather's.
    pub missing: bool,
    pub pending: bool,
    /// tfr.faa.gov did not answer.
    pub unchecked: bool,
    /// TFRs the route goes through while in force when it gets there.
    pub in_force: Vec<String>,
    /// TFRs near the route that are not.
    pub near: f64,
    /// Special-use areas the legs cross, (name, when) as their times of
    /// use read for the pass (pass_times::sua_when).
    pub special_use: Vec<(String, String)>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Altitude {
    /// Not sent, as Weather's.
    pub missing: bool,
    pub pending: bool,
    /// No VFR altitude fits, in a line.
    pub problem: Option<String>,
    /// A pilot's own altitude's broken rules.
    pub cautions: Vec<String>,
    /// The altitude flown, as the FL chip says it.
    pub flown: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Fuel {
    pub pending: bool,
    /// The least the tanks hold over the fuel and its reserve, any flight
    /// of the route; None where the usable fuel is not known.
    pub margin_gal: Option<f64>,
    pub required_gal: Option<f64>,
    pub reserve_min: Option<f64>,
    /// Under IFR: the reserve is 14 CFR 91.167's, not 91.151's.
    pub ifr: bool,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Runways {
    /// Not sent, as Weather's.
    pub missing: bool,
    pub pending: bool,
    /// Not worked out: no POH tables for this airplane.
    pub worked: bool,
    pub short: Vec<String>,
    pub crosswind: Vec<String>,
    /// Fields whose distances were read past the POH's table -- higher,
    /// hotter, heavier or a stronger tailwind than it goes -- so the
    /// figures are the table's edge, shorter than the airplane will need.
    pub beyond: Vec<String>,
    /// Fields whose distances could not be held against the runway: its
    /// length or the field's elevation is not known.
    pub unchecked: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Balance {
    pub pending: bool,
    pub worked: bool,
    pub problems: Vec<String>,
    pub takeoff: Option<String>,
}

/// The web's VerdictInput: each tab's say, and the risk assessment's
/// (level, line), None while the briefing is awaited.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Input {
    pub weather: Weather,
    pub airspace: Airspace,
    pub altitude: Altitude,
    pub fuel: Fuel,
    pub runways: Runways,
    pub balance: Balance,
    pub risk: Option<(String, String)>,
}

/// One tab's finding, and where it is shown in full: a tab of the
/// planning panel and a section of it by its title.
#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub key: String,
    pub label: String,
    pub tab: String,
    pub section: Option<String>,
    pub finding: String,
    pub detail: String,
}

fn item(key: &str, label: &str, tab: &str, section: &str, (finding, detail): (&str, String)) -> Item {
    Item { key: key.into(), label: label.into(), tab: tab.into(), section: Some(section.into()), finding: finding.into(), detail }
}

/// The reserve as the planner set it: 30 minutes by day, 45 at night
/// (14 CFR 91.151) or under IFR (91.167). Unsaid where it did not send
/// one, rather than a guess at 30, which is short at night.
fn reserve_words(minutes: Option<f64>) -> String {
    minutes.map_or_else(|| "reserve".to_owned(), |m| format!("{} min reserve", js_num(m)))
}

fn plural(n: f64) -> &'static str {
    if n == 1.0 {
        ""
    } else {
        "s"
    }
}

/// What a section not sent says: nothing was checked.
fn not_sent() -> (&'static str, String) {
    ("unknown", "Not worked out".into())
}

fn weather(w: &Weather) -> (&'static str, String) {
    if w.missing && !w.pending && !said(&w.failed) {
        not_sent()
    } else if said(&w.failed) {
        ("unknown", format!("Not fetched: {}", w.failed.as_deref().unwrap_or_default()))
    } else if w.pending {
        ("pending", "Fetching METARs, TAFs and hazards…".into())
    } else if let Some(first) = w.vfr_not_recommended.first() {
        ("stop", format!("VFR not recommended: {first}"))
    } else if let Some(first) = w.under_minimums.first() {
        ("stop", format!("Under your minimums: {first}"))
    } else if said(&w.icing) {
        ("caution", w.icing.clone().unwrap_or_default())
    } else if !w.hazards.is_empty() {
        ("caution", format!("{} along the route", w.hazards.join(", ")))
    } else if !w.unchecked.is_empty() {
        ("caution", format!("Not checked: {}", w.unchecked.join(", ")))
    } else if said(&w.worst) {
        ("ok", format!("No hazards; at worst {}", w.worst.as_deref().unwrap_or_default()))
    } else {
        ("ok", "No hazards along the route".into())
    }
}

fn airspace(a: &Airspace) -> (&'static str, String) {
    let active = a.special_use.iter().find(|(_, when)| when == "active");
    let maybe = a.special_use.iter().find(|(_, when)| when == "by-notam" || when == "unknown");
    if a.pending {
        ("pending", "Checking TFRs along the route…".into())
    } else if a.missing {
        not_sent()
    } else if let Some(first) = a.in_force.first() {
        ("stop", format!("TFR {first} in force when you get there"))
    } else if a.unchecked {
        ("caution", "Not checked: see tfr.faa.gov".into())
    } else if let Some((name, _)) = active {
        ("caution", format!("{name} scheduled in use when you pass"))
    } else if let Some((name, _)) = maybe {
        ("caution", format!("{name}: ask whether it is active"))
    } else if a.near != 0.0 || !a.special_use.is_empty() {
        let mut parts = Vec::new();
        if a.near != 0.0 {
            parts.push(format!("{} TFR{} near, none in force on the route", js_num(a.near), plural(a.near)));
        }
        let areas = a.special_use.len() as f64;
        if areas > 0.0 {
            parts.push(format!("{} special-use area{} not scheduled then", js_num(areas), plural(areas)));
        }
        ("ok", parts.join("; "))
    } else {
        ("ok", "None on the route".into())
    }
}

fn altitude(a: &Altitude) -> (&'static str, String) {
    if said(&a.problem) {
        ("stop", a.problem.clone().unwrap_or_default())
    } else if a.pending {
        ("pending", "Planning altitudes…".into())
    } else if a.missing {
        not_sent()
    } else if let Some(first) = a.cautions.first() {
        ("caution", first.clone())
    } else {
        // `flown ?? "Planned"`: an empty line stays empty.
        ("ok", a.flown.clone().unwrap_or_else(|| "Planned".into()))
    }
}

fn fuel(f: &Fuel) -> (&'static str, String) {
    if f.pending {
        return ("pending", "Working out the fuel…".into());
    }
    match f.margin_gal {
        Some(margin) if margin < 0.0 => {
            let rule = if f.ifr { "91.167" } else { "91.151" };
            ("stop", format!("{} gal short of the fuel and its {} (14 CFR {rule})", js_num(one(-margin)), reserve_words(f.reserve_min)))
        }
        None => (
            "unknown",
            match f.required_gal {
                Some(required) => format!("{} gal needed; the tanks' usable fuel not known", js_num(one(required))),
                None => "Not worked out".into(),
            },
        ),
        Some(margin) => (
            "ok",
            format!(
                "Needs {} gal with taxi and a {}; {} gal spare",
                js_num(one(f.required_gal.unwrap_or(0.0))),
                reserve_words(f.reserve_min),
                js_num(one(margin))
            ),
        ),
    }
}

fn runways(r: &Runways) -> (&'static str, String) {
    if !r.worked {
        ("unknown", "Not worked out for this airplane".into())
    } else if r.pending {
        ("pending", "Waiting on the runways and the weather…".into())
    } else if r.missing {
        not_sent()
    } else if !r.short.is_empty() {
        ("stop", format!("Too short at {}", r.short.join(", ")))
    } else if !r.crosswind.is_empty() || !r.beyond.is_empty() {
        // Past the POH's table the distance is its edge's, not the
        // airplane's (FAA-H-8083-25C, chapter 11: performance charts hold
        // only within their stated conditions), so "within" is not known:
        // a caution naming the field, beside any crosswind's.
        let mut parts = Vec::new();
        if !r.crosswind.is_empty() {
            parts.push(format!("Crosswind past the POH's demonstrated at {}", r.crosswind.join(", ")));
        }
        if !r.beyond.is_empty() {
            parts.push(format!("Past the POH's tables at {}: its distances will be longer", r.beyond.join(", ")));
        }
        ("caution", parts.join("; "))
    } else if !r.unchecked.is_empty() {
        // A runway whose length, or a field whose elevation, is not known
        // cannot be held to the distance needed (14 CFR 91.103(b)): not
        // known, never "within".
        ("unknown", format!("Not checked at {}: runway length or field elevation not known", r.unchecked.join(", ")))
    } else {
        ("ok", "Takeoff and landing within each runway".into())
    }
}

fn balance(b: &Balance) -> (&'static str, String) {
    if b.pending {
        ("pending", "Waiting on the airplane's profile…".into())
    } else if !b.worked {
        ("unknown", "Not worked out for this airplane".into())
    } else if let Some(first) = b.problems.first() {
        ("stop", first.clone())
    } else if said(&b.takeoff) {
        ("ok", format!("{}, within limits", b.takeoff.as_deref().unwrap_or_default()))
    } else {
        ("ok", "Within limits".into())
    }
}

/// Each tab's finding, in the order a pilot goes through them, each with
/// where it is shown in full.
pub fn verdict_items(v: &Input) -> Vec<Item> {
    let risk = match &v.risk {
        Some((level, line)) => (risk_finding(level), line.clone()),
        None => ("pending", "Waiting on the briefing…".into()),
    };
    vec![
        item("weather", "Weather", "enroute", "Adverse Conditions", weather(&v.weather)),
        item("airspace", "TFRs & special use", "preflight", "TFRs & Special Use", airspace(&v.airspace)),
        item("altitude", "Altitude", "enroute", "Cruise Altitude", altitude(&v.altitude)),
        item("fuel", "Fuel", "preflight", "Fuel", fuel(&v.fuel)),
        item("runways", "Runways", "depart", "Takeoff", runways(&v.runways)),
        item("balance", "Weight & balance", "preflight", "Weight & Balance", balance(&v.balance)),
        item("risk", "Risk", "preflight", "Risk Assessment", risk),
    ]
}

/// What the findings come to, in a line over them: (finding, words).
pub fn verdict_line(items: &[Item]) -> (&'static str, String) {
    let findings: Vec<&str> = items.iter().map(|i| i.finding.as_str()).collect();
    let finding = worst_of(&findings);
    let named = |f: &str| items.iter().filter(|i| i.finding == f).map(|i| i.label.as_str()).collect::<Vec<_>>().join(", ");
    let words = match finding {
        "stop" => format!("No-go as planned: {}", named("stop")),
        "caution" => format!("Look again at {}", named("caution")),
        "unknown" => format!("Nothing found against it; not worked out: {}", named("unknown")),
        "pending" => format!("Still checking: {}", named("pending")),
        _ => "Nothing found against this flight".into(),
    };
    (finding, words)
}

/// The IFR alternate's check as the planner answers /api/alternate, only
/// what the finding reads: whether the destination needs one, and the one
/// filed -- its ident, whether it is good (None: the pilot's to check;
/// `good_given` false where the answer has no `good` at all), and its
/// first reason.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Alternates {
    pub required: bool,
    pub alternate: Option<FiledAlternate>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct FiledAlternate {
    pub ident: String,
    pub good: Option<bool>,
    pub good_given: bool,
    pub first_reason: Option<String>,
}

/// What the IFR alternate comes to for the Go / No-Go
/// (features/plan/hooks/useAlternate alternateFinding): a stop where the
/// one filed will not do, a caution where one is needed (14 CFR
/// 91.169(a)(2), (b)) and none is filed or the one filed is the pilot's
/// to check; nothing where none is needed. (finding, detail).
pub fn alternate_finding(data: Option<&Alternates>) -> Option<(&'static str, String)> {
    let data = data.filter(|d| d.required)?;
    let Some(alt) = &data.alternate else {
        return Some(("caution", "An alternate is required (14 CFR 91.169): file one in Weather".into()));
    };
    match (alt.good, alt.good_given) {
        (Some(false), _) => Some(("stop", format!("{} is under its alternate minimums at the ETA there", alt.ident))),
        // `good === null`: one left out says nothing.
        (None, true) => Some(("caution", format!("{}: {}", alt.ident, alt.first_reason.as_deref().unwrap_or("check it")))),
        _ => None,
    }
}

/// The alternate is the weather's to say, where the weather says nothing
/// worse: a caution or a stop of its own, opening its section
/// (FlightBriefingView).
pub fn with_alternate(items: Vec<Item>, found: Option<(&str, &str)>) -> Vec<Item> {
    let Some((finding, detail)) = found else { return items };
    items
        .into_iter()
        .map(|i| {
            if i.key == "weather" && (i.finding == "ok" || (finding == "stop" && i.finding != "stop")) {
                Item { finding: finding.into(), detail: detail.into(), tab: "arrive".into(), section: Some("Alternate".into()), ..i }
            } else {
                i
            }
        })
        .collect()
}

pub fn item_json(out: &mut String, i: &Item) {
    out.push_str("{\"key\":");
    json::string(out, &i.key);
    out.push_str(",\"label\":");
    json::string(out, &i.label);
    out.push_str(",\"tab\":");
    json::string(out, &i.tab);
    out.push_str(",\"section\":");
    json::opt_string(out, i.section.as_deref());
    out.push_str(",\"finding\":");
    json::string(out, &i.finding);
    out.push_str(",\"detail\":");
    json::string(out, &i.detail);
    out.push('}');
}

pub fn items_json(items: &[Item]) -> String {
    let mut out = String::from("[");
    for (n, i) in items.iter().enumerate() {
        if n > 0 {
            out.push(',');
        }
        item_json(&mut out, i);
    }
    out.push(']');
    out
}

pub fn finding_json(found: Option<(&str, String)>) -> String {
    match found {
        None => "null".into(),
        Some((finding, detail)) => {
            let mut out = String::from("{\"finding\":");
            json::string(&mut out, finding);
            out.push_str(",\"detail\":");
            json::string(&mut out, &detail);
            out.push('}');
            out
        }
    }
}

/// The whole verdict as POST /api/go-no-go answers it, JSON {"line":
/// {"finding", "words"}, "items": [...]}: each finding, the alternate's
/// say in the weather's (None where it has none, or under VFR), and the
/// line over them.
pub fn verdict_json(v: &Input, alternate: Option<&Alternates>) -> String {
    let found = alternate_finding(alternate);
    let items = with_alternate(verdict_items(v), found.as_ref().map(|(f, d)| (*f, d.as_str())));
    let (finding, words) = verdict_line(&items);
    let mut out = String::from("{\"line\":{\"finding\":");
    json::string(&mut out, finding);
    out.push_str(",\"words\":");
    json::string(&mut out, &words);
    out.push_str("},\"items\":");
    out.push_str(&items_json(&items));
    out.push('}');
    out
}

/// Strings as JSON, for the planner's lists.
pub fn strings_json(items: &[String]) -> String {
    let mut out = String::new();
    strings(&mut out, items);
    out
}
