//! Two-way radio failure under IFR (the roadmap's lost-comms calculator,
//! 14 CFR 91.185, ACS IR.VII.A): the route to fly, the altitude on each
//! segment of it, and when to leave the clearance limit, each worked from
//! the clearance as the rule words it. In VFR conditions there is nothing
//! to work: continue VFR and land as soon as practicable (91.185(b)).
//!
//! app.figures.lost_comms (itself web/src/lib/lostComms.ts and the words
//! of features/pilot/LostCommsPage.tsx): the web's copy holds the same
//! rules and changes with this.

use super::words::alt_ft;
use crate::json;

/// 91.185(c)(1): the route, in the rule's order -- the first that
/// applies: its key, label and the rule's words.
pub const ROUTES: [(&str, &str, &str); 4] = [
    ("assigned", "Assigned", "The route assigned in the last ATC clearance received."),
    ("vectored", "Vectored", "Being radar vectored: direct from the point of radio failure to the fix, route or airway specified in the vector clearance."),
    ("expected", "Expected", "No route assigned: the route ATC has advised may be expected in a further clearance."),
    ("filed", "Filed", "Neither assigned nor expected: the route filed in the flight plan."),
];

/// 91.185(b): what VFR conditions call for, as the page opens.
pub const VFR_WORDS: &str = "In VFR conditions, or on meeting them after the failure: continue VFR and land as soon as practicable (91.185(b)). \
                             In IFR conditions, the rest of this page.";

/// Which of 91.185(c)(2)'s altitudes a segment is flown at.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Because {
    Assigned,
    Minimum,
    Expected,
}

impl Because {
    pub fn key(self) -> &'static str {
        match self {
            Because::Assigned => "assigned",
            Because::Minimum => "minimum",
            Because::Expected => "expected",
        }
    }

    /// How the page says it, after "Fly 6,000 ft: ".
    fn said(self) -> &'static str {
        match self {
            Because::Assigned => "assigned",
            Because::Minimum => "the minimum",
            Because::Expected => "expected",
        }
    }

    pub fn from_key(key: &str) -> Option<Because> {
        match key {
            "assigned" => Some(Because::Assigned),
            "minimum" => Some(Because::Minimum),
            "expected" => Some(Because::Expected),
            _ => None,
        }
    }
}

/// A segment flown: its name, the altitude and why; None where none is known.
#[derive(Clone, Debug, PartialEq)]
pub struct Flown {
    pub name: String,
    pub fly: Option<(f64, Because)>,
}

/// 91.185(c)(2): on each segment, the highest of the altitude assigned,
/// the minimum for IFR operations, and the altitude ATC said to expect --
/// and which it was. None where none is known. Each segment is a name and
/// its minimum, the minimum altitude for IFR operations (14 CFR 91.177:
/// the MEA, or the MOCA within 22 nm of the VOR, 91.177(a)(1); off
/// airways 1,000 ft, 2,000 ft over designated mountainous terrain, above
/// the highest obstacle within 4 nm of the course, 91.177(a)(2)); the
/// expected altitude applies from segment `expected_from` on ("expect
/// 6,000 ten minutes after departure" is from where the airplane is
/// then), before it only the assigned and the minimum count. A tie goes
/// to the first named, as the rule lists them.
pub fn segment_altitudes(segments: &[(String, Option<f64>)], assigned_ft: Option<f64>, expected_ft: Option<f64>,
                         expected_from: i64) -> Vec<Flown> {
    segments
        .iter()
        .enumerate()
        .map(|(i, (name, minimum_ft))| {
            let candidates = [
                (assigned_ft, Because::Assigned),
                (*minimum_ft, Because::Minimum),
                (if i as i64 >= expected_from { expected_ft } else { None }, Because::Expected),
            ];
            let mut fly: Option<(f64, Because)> = None;
            for (ft, because) in candidates {
                if let Some(ft) = ft {
                    if fly.is_none_or(|(highest, _)| ft > highest) {
                        fly = Some((ft, because));
                    }
                }
            }
            Flown { name: name.clone(), fly }
        })
        .collect()
}

/// A segment's altitude as the page says it: "Fly 6,000 ft: expected".
pub fn fly_words(fly: Option<(f64, Because)>) -> String {
    match fly {
        None => "No altitude known".to_owned(),
        Some((ft, because)) => format!("Fly {} ft: {}", alt_ft(Some(ft)), because.said()),
    }
}

/// 91.185(c)(3): when to leave the clearance limit, in words. `efc` and
/// `eta` as the pilot wrote them, empty where not given.
pub fn leave_limit(approach_fix: bool, efc: &str, eta: &str) -> String {
    let at = if eta.is_empty() { String::new() } else { format!(", {eta}") };
    match (approach_fix, efc.is_empty()) {
        (true, false) => format!(
            "Hold at the clearance limit, and begin the descent or the approach as close as possible to the \
             expect-further-clearance time, {efc}."
        ),
        (true, true) => format!(
            "Begin the descent or the approach as close as possible to your estimated time of arrival{at}, \
             from the filed or amended time en route."
        ),
        (false, false) => format!(
            "Leave the clearance limit at the expect-further-clearance time, {efc}, proceed to a fix an approach begins from, \
             and begin the descent or the approach as close as possible to your estimated time of arrival{at}."
        ),
        (false, true) => format!(
            "Leave the clearance limit on arriving over it, proceed to a fix an approach begins from, and begin the descent \
             or the approach as close as possible to your estimated time of arrival{at}."
        ),
    }
}

/// The whole of the planner's /api/lost-comms answer, JSON: VFR's words,
/// the routes in the rule's order, each segment's altitude, why and its
/// words, and when to leave the clearance limit. A segment with no name
/// is "Segment", and the EFC and ETA are taken with their spaces trimmed,
/// as the planner takes them.
pub fn lost_comms_json(segments: &[(String, Option<f64>)], assigned_ft: Option<f64>, expected_ft: Option<f64>,
                       expected_from: i64, approach_fix: bool, efc: &str, eta: &str) -> String {
    let named: Vec<(String, Option<f64>)> = segments
        .iter()
        .map(|(name, min)| (if name.is_empty() { "Segment".to_owned() } else { name.clone() }, *min))
        .collect();
    let mut out = String::from("{\"vfr\":");
    json::string(&mut out, VFR_WORDS);
    out.push_str(",\"routes\":[");
    for (i, (key, label, rule)) in ROUTES.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"key\":");
        json::string(&mut out, key);
        out.push_str(",\"label\":");
        json::string(&mut out, label);
        out.push_str(",\"rule\":");
        json::string(&mut out, rule);
        out.push('}');
    }
    out.push_str("],\"segments\":[");
    for (i, f) in segment_altitudes(&named, assigned_ft, expected_ft, expected_from).iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"name\":");
        json::string(&mut out, &f.name);
        out.push_str(",\"fly\":");
        json::opt_number(&mut out, f.fly.map(|f| f.0));
        out.push_str(",\"because\":");
        json::opt_string(&mut out, f.fly.map(|f| f.1.key()));
        out.push_str(",\"words\":");
        json::string(&mut out, &fly_words(f.fly));
        out.push('}');
    }
    out.push_str("],\"leave\":");
    json::string(&mut out, &leave_limit(approach_fix, efc.trim(), eta.trim()));
    out.push('}');
    out
}
