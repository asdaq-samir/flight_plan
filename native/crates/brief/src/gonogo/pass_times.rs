//! When the flight passes a point along its route, and whether a TFR or a
//! special-use area is in force then (web/src/lib/passTimes.ts, the
//! roadmap's 4-D airspace check): the briefing lists what is near the
//! route at any time during the flight, and this says whether it is at the
//! time the airplane gets there.
//!
//! Times are whole microseconds since 1970 (UTC), so a comparison is
//! exact. The engine has no time-zone database: the caller -- the planner
//! with Python's zoneinfo, a phone with its own -- works out the day of
//! the week and the minute of the day in UTC and in the area's own zone,
//! and the times of use are read against them.

/// The minutes either side of a pass time a TFR's window is widened by:
/// an ETA is an estimate, and a few minutes early is still inside.
pub const PASS_MARGIN_MIN: i64 = 30;

/// When the flight is `along_nm` along its route, in minutes after the
/// departure: the legs' times to there, the leg it is in taken pro rata.
/// Each leg is (distance_nm, ete_min, None where it cannot be flown).
/// None where a leg before it has no time, or there are no legs.
pub fn pass_minutes(legs: &[(f64, Option<f64>)], along_nm: f64) -> Option<f64> {
    let mut distance = 0.0;
    let mut minutes = 0.0;
    for (i, &(leg_nm, ete)) in legs.iter().enumerate() {
        let ete = ete?;
        if along_nm <= distance + leg_nm || i == legs.len() - 1 {
            let share = if leg_nm > 0.0 { ((along_nm - distance) / leg_nm).max(0.0).min(1.0) } else { 0.0 };
            return Some(minutes + share * ete);
        }
        distance += leg_nm;
        minutes += ete;
    }
    None
}

/// A TFR's window against the pass time, widened by PASS_MARGIN_MIN:
/// "before", "after" or "in-force"; one with no start or no end is open
/// that way. All in microseconds since 1970.
pub fn tfr_when(at_us: i64, effective_us: Option<i64>, expires_us: Option<i64>) -> &'static str {
    let margin = PASS_MARGIN_MIN * 60_000_000;
    if effective_us.is_some_and(|e| at_us < e - margin) {
        "before"
    } else if expires_us.is_some_and(|e| at_us > e + margin) {
        "after"
    } else {
        "in-force"
    }
}

/// Whether a flight in a hazard from `enter` to `leave` (seconds since
/// 1970) is there while the hazard is valid, from `valid_from` to
/// `valid_to`: "before" it starts or "after" it ends, its window widened
/// by `margin_s` either way (an ETA is an estimate), else "during"; None
/// where it gives no window at all, one open at an end open that way.
/// The planner's exposure of a SIGMET, a G-AIRMET or a TFR met along the
/// route (app.exposure), with PASS_MARGIN_MIN as the margin; with none,
/// whether a TFR is in force at any time of a span (wingtip.tfr.in_force).
pub fn window_when(enter: f64, leave: f64, valid_from: Option<f64>, valid_to: Option<f64>, margin_s: f64) -> Option<&'static str> {
    if valid_from.is_none() && valid_to.is_none() {
        return None;
    }
    Some(if valid_from.is_some_and(|f| leave < f - margin_s) {
        "before"
    } else if valid_to.is_some_and(|t| enter > t + margin_s) {
        "after"
    } else {
        "during"
    })
}

pub const DAY_NAMES: [&str; 7] =["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/// A clock as the times of use are read on: the day of the week (0
/// Sunday) and the minute of the day.
pub type Clock = (u32, u32);

fn word_char(c: Option<&char>) -> bool {
    c.is_some_and(|c| c.is_ascii_alphanumeric() || *c == '_')
}

/// A day's name at `at` standing as a word of its own (the web's
/// `\b(SUN|...)\b`): its day of the week.
fn day_at(text: &[char], at: usize) -> Option<u32> {
    if at > 0 && word_char(text.get(at - 1)) {
        return None;
    }
    let word: String = text.get(at..at + 3)?.iter().collect();
    let day = DAY_NAMES.iter().position(|d| *d == word)? as u32;
    (!word_char(text.get(at + 3))).then_some(day)
}

fn spaces(text: &[char], mut at: usize) -> usize {
    while text.get(at).is_some_and(|c| c.is_whitespace()) {
        at += 1;
    }
    at
}

/// The days a clause of times of use names -- "MON - FRI", "SAT - SUN",
/// "FRI" -- as days of the week; every day where it names none, or
/// "DAILY", which "means 7 days per week" (FAA Order JO 7400.2, 21-2-4).
fn days_of(clause: &[char]) -> [bool; 7] {
    let mut days = [false; 7];
    let mut at = 0;
    while at < clause.len() {
        let Some(first) = day_at(clause, at) else {
            at += 1;
            continue;
        };
        let mut end = at + 3;
        let mut last = first;
        // A range, "MON - FRI", where a day follows the dash.
        let dash = spaces(clause, end);
        if clause.get(dash) == Some(&'-') {
            let next = spaces(clause, dash + 1);
            if let Some(d) = day_at(clause, next) {
                last = d;
                end = next + 3;
            }
        }
        let mut d = first;
        loop {
            days[d as usize] = true;
            if d == last {
                break;
            }
            d = (d + 1) % 7;
        }
        at = end;
    }
    if days.iter().any(|d| *d) {
        days
    } else {
        [true; 7]
    }
}

fn digits(text: &[char], at: usize) -> Option<u32> {
    let two = text.get(at..at + 2)?;
    if two.iter().all(|c| c.is_ascii_digit()) {
        Some(two[0].to_digit(10)? * 10 + two[1].to_digit(10)?)
    } else {
        None
    }
}

/// A time range at `at`, "0800 - 1700", "2200-0600Z", the web's
/// `(\d{2})(\d{2})\s*-\s*(\d{2})(\d{2})\s*(Z|UTC)?`: (from minute, to
/// minute, in UTC, where it ends).
fn range_at(text: &[char], at: usize) -> Option<(u32, u32, bool, usize)> {
    let from = digits(text, at)? * 60 + digits(text, at + 2)?;
    let dash = spaces(text, at + 4);
    if text.get(dash) != Some(&'-') {
        return None;
    }
    let to_at = spaces(text, dash + 1);
    let to = digits(text, to_at)? * 60 + digits(text, to_at + 2)?;
    let after = spaces(text, to_at + 4);
    let rest: String = text.get(after..(after + 3).min(text.len()))?.iter().collect();
    if rest.starts_with("UTC") {
        Some((from, to, true, after + 3))
    } else if rest.starts_with('Z') {
        Some((from, to, true, after + 1))
    } else {
        Some((from, to, false, after))
    }
}

/// Every time range in a clause, left to right, none overlapping.
fn ranges_of(clause: &[char]) -> Vec<(u32, u32, bool)> {
    let mut found = Vec::new();
    let mut at = 0;
    while at < clause.len() {
        match range_at(clause, at) {
            Some((from, to, utc, end)) => {
                found.push((from, to, utc));
                at = end.max(at + 1);
            }
            None => at += 1,
        }
    }
    found
}

/// A clause of the NOTAM's own times: "OTHER TIMES BY NOTAM", "O/T ...".
fn other_times(clause: &str) -> bool {
    let c = clause.trim_start();
    ["OTHER TIMES", "O/T"]
        .iter()
        .any(|p| c.starts_with(p) && !word_char(c[p.len()..].chars().next().as_ref()))
}

/// Whether "H24" stands as a word.
fn h24(text: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    (0..chars.len().saturating_sub(2)).any(|i| {
        chars[i..i + 3] == ['H', '2', '4'] && !(i > 0 && word_char(chars.get(i - 1))) && !word_char(chars.get(i + 3))
    })
}

/// Whether a special-use area's published times of use have it in use when
/// the flight passes, as the FAA writes them (the TIMESOFUSE of its
/// special-use airspace data, after FAA Order JO 7400.2, 21-2-4):
/// "active", "not-scheduled", "by-notam" or "unknown". Every time range is
/// read clause by clause (";", and the "%" the data breaks a long one
/// with), each with its clause's days, a range past midnight with the day
/// it began; not the ranges of an "OTHER TIMES BY NOTAM" clause, which
/// bound the NOTAM's times. Seasons are not read: each season's hours
/// count all year, which can say in use, never the other way. Local hours
/// are read on `local`, the pass in the area's own zone (None with no
/// zone, or one not known: they are not guessed at), "Z" or "UTC" ones on
/// `utc`.
pub fn sua_when(times_of_use: Option<&str>, utc: Clock, local: Option<Clock>) -> &'static str {
    let text = times_of_use.unwrap_or("").to_uppercase();
    if text.is_empty() {
        return "unknown";
    }
    if text.contains("CONTINUOUS") || h24(&text) {
        return "active";
    }
    let (mut read, mut unread) = (false, false);
    for clause in text.split([';', '%']) {
        if other_times(clause) {
            continue;
        }
        let chars: Vec<char> = clause.chars().collect();
        let ranges = ranges_of(&chars);
        if ranges.is_empty() {
            continue;
        }
        let days = days_of(&chars);
        for (from, to, in_utc) in ranges {
            let Some((day_now, minute)) = (if in_utc { Some(utc) } else { local }) else {
                unread = true;
                continue;
            };
            read = true;
            let overnight = from > to;
            let in_hours = if overnight { minute >= from || minute < to } else { from <= minute && minute < to };
            // Past midnight, a range that began the day before is that day's.
            let day = if overnight && minute < to { (day_now + 6) % 7 } else { day_now };
            if in_hours && days[day as usize] {
                return "active";
            }
        }
    }
    let notam = text.contains("NOTAM");
    if unread {
        "unknown"
    } else if !read {
        if notam {
            "by-notam"
        } else {
            "unknown"
        }
    } else if notam {
        "by-notam"
    } else {
        "not-scheduled"
    }
}
