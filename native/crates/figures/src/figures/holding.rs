//! Holding-pattern entries and wind (the roadmap's holding visualiser, ACS
//! IR.III.B), as AIM 5-3-8 gives them: the entry from the airplane's
//! heading to the fix against the holding course -- direct from the 180
//! degree sector, teardrop from the 70 degree one on the non-holding side
//! beyond the fix, parallel from the 110 degree one on the holding side --
//! the 70 degree line drawn on the holding side, for left turns mirrored;
//! and the inbound leg at a minute (a minute and a half above 14,000 ft
//! MSL), the outbound heading and time worked to make it so in the wind.
//!
//! app.figures.holding (itself web/src/lib/holding.ts and the words of
//! features/pilot/HoldingPage.tsx) with wingtip.holds' entry and leg time:
//! the web's copy holds the same rules and changes with this.

use super::words::{bearing, js_round, norm360, wind_correction};
use super::diversion::wind_triangle;
use crate::geo::{angle_between, py_mod};
use crate::json;

/// AIM 5-3-8 j.4(a): the inbound leg is a minute at or below 14,000 ft
/// MSL and a minute and a half above it (wingtip.holds' LEG_MIN_LOW,
/// LEG_MIN_HIGH, LEG_MIN_CEILING_FT).
pub const LEG_MIN_LOW: f64 = 1.0;
pub const LEG_MIN_HIGH: f64 = 1.5;
pub const LEG_MIN_CEILING_FT: f64 = 14_000.0;

/// The three entries of AIM 5-3-8 j.3.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Entry {
    Direct,
    Teardrop,
    Parallel,
}

impl Entry {
    pub fn key(self) -> &'static str {
        match self {
            Entry::Direct => "direct",
            Entry::Teardrop => "teardrop",
            Entry::Parallel => "parallel",
        }
    }

    /// Its name on the page.
    pub fn name(self) -> &'static str {
        match self {
            Entry::Direct => "Direct",
            Entry::Teardrop => "Teardrop",
            Entry::Parallel => "Parallel",
        }
    }

    pub fn from_key(key: &str) -> Option<Entry> {
        match key {
            "direct" => Some(Entry::Direct),
            "teardrop" => Some(Entry::Teardrop),
            "parallel" => Some(Entry::Parallel),
            _ => None,
        }
    }
}

/// The inbound leg's minutes where the pilot gave none (AIM 5-3-8 j.4(a);
/// wingtip.holds.default_leg_min): no altitude is taken as at or below 14,000.
pub fn leg_minutes(altitude_ft: Option<f64>) -> f64 {
    match altitude_ft {
        Some(alt) if alt > LEG_MIN_CEILING_FT => LEG_MIN_HIGH,
        _ => LEG_MIN_LOW,
    }
}

/// The entry an airplane arriving on `arrival_deg` (its magnetic course to
/// the fix) makes into a hold whose inbound course is `inbound_deg`
/// (wingtip.holds.entry). AIM 5-3-8 j.3 (and its figure) places the sectors
/// round the fix by where the airplane comes from, cut by a line 70
/// degrees to the holding course; arriving on a course is coming from its
/// reciprocal, so the same sectors read by the course flown, the way an
/// FMS reads them: for right turns, a course within 110 degrees right and
/// 70 left of the inbound course direct, the next 70 round (110 to 180)
/// teardrop, the 110 beyond parallel; left turns the mirror.
pub fn entry(arrival_deg: f64, inbound_deg: f64, right: bool) -> Entry {
    let mut rel = py_mod(arrival_deg - inbound_deg, 360.0);
    if !right {
        rel = py_mod(360.0 - rel, 360.0);
    }
    if rel <= 110.0 || rel >= 290.0 {
        Entry::Direct
    } else if rel <= 180.0 {
        Entry::Teardrop
    } else {
        Entry::Parallel
    }
}

/// The entry for an airplane heading `heading_deg` to the fix of a hold on
/// `inbound_deg`, and the other one where the heading is within 5 degrees
/// of a sector's edge, where the AIM lets a pilot use either entry ("+/- 5
/// degrees in heading is considered to be within allowable good operating
/// limits for determining entry", AIM 5-3-8 j.8(d)).
pub fn holding_entry(inbound_deg: f64, heading_deg: f64, right: bool) -> (Entry, Option<Entry>) {
    let off = norm360(if right { heading_deg - inbound_deg } else { inbound_deg - heading_deg });
    let found = entry(heading_deg, inbound_deg, right);
    let edges = [
        (110.0, Entry::Direct, Entry::Teardrop),
        (180.0, Entry::Teardrop, Entry::Parallel),
        (290.0, Entry::Parallel, Entry::Direct),
    ];
    let either = edges
        .iter()
        .find(|e| angle_between(off, e.0) <= 5.0)
        .map(|&(_, a, b)| if a == found { b } else { a });
    (found, either)
}

/// The bearing from the fix the airplane comes from, against the inbound
/// course, for drawing: where it is on the page round the fix.
pub fn approach_relative(inbound_deg: f64, heading_deg: f64) -> f64 {
    norm360(heading_deg + 180.0 - inbound_deg)
}

/// One leg of the hold in the wind.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HoldLeg {
    pub heading: f64,
    pub wca: f64,
    pub gs: f64,
}

/// The legs flown in the wind (holding_wind).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HoldWind {
    pub leg_min: f64,
    pub inbound: HoldLeg,
    pub outbound: HoldLeg,
    pub outbound_sec: f64,
    pub rule_sec: f64,
}

/// The legs flown in a wind from `wind_from_deg` at `wind_kt` at `tas_kt`,
/// the courses and the wind in the same reference (magnetic, as a
/// clearance gives the course). None where the wind is stronger than the
/// airplane. The outbound heading by the rule of three: three times the
/// inbound correction, the other way ("When outbound, triple the inbound
/// drift correction", AIM 5-3-8 j.8(c)); the outbound time, seconds, for
/// the inbound leg to take its minute at the legs' ground speeds, the
/// turns left out; and a rule of thumb with no FAA figure behind it, a
/// second a knot of the wind along the course (the AIM asks only that the
/// outbound time be set to make the inbound leg's, 5-3-8 j.4(a)).
pub fn holding_wind(inbound_deg: f64, tas_kt: f64, wind_from_deg: f64, wind_kt: f64, altitude_ft: f64) -> Option<HoldWind> {
    let leg_min = leg_minutes(Some(altitude_ft));
    let outbound_deg = norm360(inbound_deg + 180.0);
    let (in_wca, _, in_gs) = wind_triangle(inbound_deg, tas_kt, wind_from_deg, wind_kt)?;
    let (_, _, out_gs) = wind_triangle(outbound_deg, tas_kt, wind_from_deg, wind_kt)?;
    let out_wca = -3.0 * in_wca;
    // The headwind along the inbound course (wingtip.runway_wind.components_kt).
    let headwind_in = wind_kt * (wind_from_deg - inbound_deg).to_radians().cos();
    Some(HoldWind {
        leg_min,
        inbound: HoldLeg { heading: norm360(inbound_deg + in_wca), wca: in_wca, gs: in_gs },
        outbound: HoldLeg { heading: norm360(outbound_deg + out_wca), wca: out_wca, gs: out_gs },
        outbound_sec: (leg_min * 60.0 * in_gs) / out_gs,
        // A headwind inbound is a tailwind outbound: shorten the outbound leg.
        rule_sec: leg_min * 60.0 - headwind_in,
    })
}

/// AIM 5-3-8's words for each entry, for the turns given: the outbound
/// minute is a minute and a half above 14,000 ft MSL (leg_minutes).
pub fn entry_steps(entry: Entry, inbound: f64, right: bool, altitude_ft: f64) -> String {
    let leg = if leg_minutes(Some(altitude_ft)) == 1.0 { "one minute" } else { "a minute and a half" };
    let outbound = py_mod(inbound + 180.0, 360.0);
    let (turns, away) = if right { ("right", "left") } else { ("left", "right") };
    match entry {
        Entry::Direct => format!("Fly to the fix and turn {turns} to follow the pattern: outbound on {}.", bearing(outbound)),
        Entry::Teardrop => {
            let tear = if right { outbound - 30.0 } else { outbound + 30.0 };
            format!(
                "Fly to the fix, then turn to {}, 30° into the holding side, for {leg}; turn {turns} to intercept the inbound course, {}.",
                bearing(tear),
                bearing(inbound)
            )
        }
        Entry::Parallel => format!(
            "At the fix, turn to {}, parallel to the holding course on the non-holding side, for {leg}; then turn {away}, \
             toward the holding side, through more than 180° to intercept the inbound course or return to the fix.",
            bearing(outbound)
        ),
    }
}

/// The rows' lines under the legs' figures, as HoldingPage writes them:
/// inbound, outbound and the time.
pub fn wind_words(w: &HoldWind) -> (String, String, String) {
    let minute = if w.leg_min == 1.0 { "a minute" } else { "a minute and a half" };
    let gs_in = js_round(w.inbound.gs);
    (
        format!("{} for the wind, {gs_in} kt over the ground", wind_correction(w.inbound.wca)),
        format!("Three times the inbound correction, {}, the turns' drift taken up too", wind_correction(w.outbound.wca)),
        format!("So the inbound leg takes {minute} at {gs_in} kt; by the rule of a second a knot, {} s", js_round(w.rule_sec)),
    )
}

/// The whole of the planner's /api/holding answer, JSON: the entry and its
/// steps, the other entry near a sector's edge, where the airplane comes
/// from, and the legs in the wind where a true airspeed, wind and altitude
/// are all given (else `wind` null) -- `wind_problem` where the wind is
/// stronger than the airplane. No altitude is taken as at or below 14,000
/// ft MSL, as the web's page does with its field blank: a minute's leg.
pub fn holding_json(inbound: f64, heading: f64, right: bool, tas_kt: Option<f64>, wind_from: Option<f64>,
                    wind_kt: Option<f64>, altitude_ft: Option<f64>) -> String {
    let (found, either) = holding_entry(inbound, heading, right);
    let mut out = String::from("{\"entry\":");
    json::string(&mut out, found.key());
    out.push_str(",\"entry_name\":");
    json::string(&mut out, found.name());
    out.push_str(",\"steps\":");
    json::string(&mut out, &entry_steps(found, inbound, right, altitude_ft.unwrap_or(0.0)));
    out.push_str(",\"either\":");
    json::opt_string(&mut out, either.map(Entry::key));
    out.push_str(",\"either_name\":");
    json::opt_string(&mut out, either.map(Entry::name));
    out.push_str(",\"approach_relative\":");
    json::number(&mut out, approach_relative(inbound, heading));
    let (mut wind, mut problem) = (None, None);
    if let (Some(tas), Some(from), Some(kt), Some(alt)) = (tas_kt, wind_from, wind_kt, altitude_ft) {
        match holding_wind(inbound, tas, from, kt, alt) {
            Some(w) => wind = Some(w),
            None => problem = Some("A wind stronger than the airplane holds no heading."),
        }
    }
    out.push_str(",\"wind\":");
    match wind {
        Some(w) => wind_json(&mut out, &w),
        None => out.push_str("null"),
    }
    out.push_str(",\"wind_problem\":");
    json::opt_string(&mut out, problem);
    out.push('}');
    out
}

fn leg_json(out: &mut String, leg: &HoldLeg) {
    out.push_str("{\"heading\":");
    json::number(out, leg.heading);
    out.push_str(",\"wca\":");
    json::number(out, leg.wca);
    out.push_str(",\"gs\":");
    json::number(out, leg.gs);
    out.push('}');
}

/// The legs in the wind and their words, as the answer's `wind`.
pub fn wind_json(out: &mut String, w: &HoldWind) {
    let (inbound, outbound, time) = wind_words(w);
    out.push_str("{\"leg_min\":");
    json::number(out, w.leg_min);
    out.push_str(",\"inbound\":");
    leg_json(out, &w.inbound);
    out.push_str(",\"outbound\":");
    leg_json(out, &w.outbound);
    out.push_str(",\"outbound_sec\":");
    json::number(out, w.outbound_sec);
    out.push_str(",\"rule_sec\":");
    json::number(out, w.rule_sec);
    for (key, words) in [("inbound_words", inbound), ("outbound_words", outbound), ("time_words", time)] {
        out.push_str(",\"");
        out.push_str(key);
        out.push_str("\":");
        json::string(out, &words);
    }
    out.push('}');
}
