//! When an FAA data set's edition stops counting: each one is published
//! on a cycle and replaced at the next, and an old one goes on reading as
//! if nothing were wrong -- a frequency changed, an airspace redrawn, a
//! procedure amended -- so the planner and the apps say so when what they
//! use is past its cycle (warn, never refuse: the owner's rule, 2026-10-23).
//!
//! The cycles, from the FAA's own schedule ("28 and 56 Day Product
//! Schedule 2025-2049", aeronav.faa.gov/content/aeronav/DOLES/
//! Product_Schedule.pdf, which marks every other date as the "56-day
//! airspace cycle"):
//!
//! - AIRAC, 28 days: NASR (the "28 Day NASR Subscription", whose editions
//!   take effect 22 Jan 2026, 19 Feb 2026, ... 29 Oct 2026, 26 Nov 2026),
//!   the CIFP and the d-TPP. The schedule's first 2026 date, 22 Jan 2026,
//!   is the epoch here; each year's cycles are numbered from 01 in the
//!   order they start ("2043 has 14 cycles", the schedule says), which is
//!   the d-TPP's folder name ("2611").
//! - Charting, 56 days: the sectional, terminal area and IFR enroute
//!   charts and the Chart Supplement, every other AIRAC date -- the
//!   schedule's "56-day airspace cycle" -- from 3 Sep 2026's edition.
//! - The Digital Obstacle File, "updated every 56 days" (the FAA's DOF
//!   page): each file is named by the last day of the changes it holds
//!   ("DOF_260927.zip", changes to 27 Sep 2026) and released two days
//!   later (29 Sep 2026, a Tuesday: "all normal release dates have
//!   recently been changed from Mondays to Tuesdays"), and it is the file
//!   to use until the next one's release 56 days on (24 Nov 2026).
//!
//! Dates are UTC days. A simplification, toward the safer side: an edition
//! takes effect at 0901Z on its date, and here it counts from 0000Z, so an
//! old one is called out of date up to nine hours before it is, never after.
//! That is for a warning only: a caller choosing which edition to fetch
//! and use must not run ahead of 0901Z, and gives the previous day until then.

use crate::json;
use crate::time::{civil_from_days, days_from_civil, days_in_month};

/// Which schedule a data set is published on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Airac,
    Chart,
    Dof,
}

impl Kind {
    pub fn from_name(name: &str) -> Option<Kind> {
        match name {
            "airac" => Some(Kind::Airac),
            "chart" => Some(Kind::Chart),
            "dof" => Some(Kind::Dof),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Kind::Airac => "airac",
            Kind::Chart => "chart",
            Kind::Dof => "dof",
        }
    }

    /// The cycle's length, days.
    pub fn days(self) -> i64 {
        match self {
            Kind::Airac => 28,
            Kind::Chart | Kind::Dof => 56,
        }
    }

    /// A day an edition took effect (days since 1970-01-01): AIRAC 2601,
    /// the 3 Sep 2026 charts, the DOF released 29 Sep 2026.
    fn epoch(self) -> i64 {
        match self {
            Kind::Airac => days_from_civil(2026, 1, 22),
            Kind::Chart => days_from_civil(2026, 9, 3),
            Kind::Dof => days_from_civil(2026, 9, 29),
        }
    }

    /// The days from the date an edition is named by to the day it is in
    /// use: the DOF's two from its changes' last day to its release, none
    /// for the others, which are named by their effective date.
    fn lag(self) -> i64 {
        match self {
            Kind::Dof => 2,
            Kind::Airac | Kind::Chart => 0,
        }
    }
}

/// Whether an edition counts on a day.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    InForce,
    /// Past its cycle: a newer edition has taken its place.
    Expired,
    /// Its cycle has not started yet (a preview downloaded early).
    NotYet,
    /// Nothing says which edition it is.
    Unknown,
}

impl State {
    pub fn name(self) -> &'static str {
        match self {
            State::InForce => "in_force",
            State::Expired => "expired",
            State::NotYet => "not_yet",
            State::Unknown => "unknown",
        }
    }
}

/// An edition held against the day it is used on.
#[derive(Clone, Debug, PartialEq)]
pub struct Cycle {
    pub kind: Kind,
    /// The edition in force on the day, by the schedule: the day it took
    /// effect (or was released) and, for AIRAC, its number ("2611").
    pub current: i64,
    pub current_ident: Option<String>,
    /// The day the next edition takes its place.
    pub next: i64,
    /// The edition held: the day it counts from, and the day it stops.
    pub effective: Option<i64>,
    pub expires: Option<i64>,
    pub state: State,
    /// How many editions have come out since the one held (0 in force).
    pub behind: i64,
}

/// The day the edition in force on `day` started.
pub fn start_on(kind: Kind, day: i64) -> i64 {
    let epoch = kind.epoch();
    epoch + (day - epoch).div_euclid(kind.days()) * kind.days()
}

/// An AIRAC cycle's number, "YYNN": its year and how many cycles had
/// started in that year up to and including it.
pub fn airac_ident(start: i64) -> String {
    let (year, _, _) = civil_from_days(start);
    let into_year = start - days_from_civil(year, 1, 1);
    format!("{:02}{:02}", year.rem_euclid(100), into_year / 28 + 1)
}

/// The edition named `effective` (a day, as the data set names it; None
/// where nothing says) of a data set on `kind`'s schedule, on `day`.
pub fn cycle(kind: Kind, effective: Option<i64>, day: i64) -> Cycle {
    let current = start_on(kind, day);
    let next = current + kind.days();
    let from = effective.map(|e| e + kind.lag());
    // An edition counts from its day for one cycle: the next one is out
    // by then on every schedule here, so the old one is not to be used.
    let expires = from.map(|f| f + kind.days());
    let (state, behind) = match (from, expires) {
        (Some(f), _) if day < f => (State::NotYet, 0),
        (Some(_), Some(e)) if day >= e => (State::Expired, 1 + (day - e).div_euclid(kind.days())),
        (Some(_), Some(_)) => (State::InForce, 0),
        _ => (State::Unknown, 0),
    };
    Cycle {
        kind,
        current,
        current_ident: (kind == Kind::Airac).then(|| airac_ident(current)),
        next,
        effective: from,
        expires,
        state,
        behind,
    }
}

/// A day as "YYYY-MM-DD".
pub fn day_text(day: i64) -> String {
    let (y, m, d) = civil_from_days(day);
    format!("{y:04}-{m:02}-{d:02}")
}

/// A day from "YYYY-MM-DD"; None where it is no day.
pub fn day_of(text: &str) -> Option<i64> {
    let mut parts = text.trim().splitn(3, '-');
    let year: i64 = parts.next()?.parse().ok()?;
    let month: u32 = parts.next()?.parse().ok()?;
    let day: u32 = parts.next()?.get(..2)?.parse().ok()?;
    if !(1..=12).contains(&month) || day < 1 || day > days_in_month(year, month) {
        return None;
    }
    Some(days_from_civil(year, month, day))
}

/// The answer as JSON, the engine's `data_cycle`.
pub fn to_json(c: &Cycle) -> String {
    let mut out = String::from("{\"kind\":");
    json::string(&mut out, c.kind.name());
    out.push_str(&format!(",\"cycle_days\":{}", c.kind.days()));
    out.push_str(",\"current\":");
    json::string(&mut out, &day_text(c.current));
    out.push_str(",\"current_ident\":");
    json::opt_string(&mut out, c.current_ident.as_deref());
    out.push_str(",\"next\":");
    json::string(&mut out, &day_text(c.next));
    out.push_str(",\"effective\":");
    json::opt_string(&mut out, c.effective.map(day_text).as_deref());
    out.push_str(",\"expires\":");
    json::opt_string(&mut out, c.expires.map(day_text).as_deref());
    out.push_str(",\"state\":");
    json::string(&mut out, c.state.name());
    out.push_str(&format!(",\"behind\":{}}}", c.behind));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(text: &str) -> i64 {
        day_of(text).unwrap()
    }

    #[test]
    fn the_nasr_editions_on_the_faas_page_are_airac_starts() {
        // The "28 Day NASR Subscription" page's effective dates.
        for day in ["2025-12-25", "2026-01-22", "2026-02-19", "2026-10-01", "2026-10-29", "2026-11-26"] {
            assert_eq!(start_on(Kind::Airac, d(day)), d(day), "{day}");
        }
        assert_eq!(start_on(Kind::Airac, d("2026-11-25")), d("2026-10-29"));
    }

    #[test]
    fn airac_numbers_count_from_one_each_year() {
        assert_eq!(airac_ident(d("2026-01-22")), "2601");
        assert_eq!(airac_ident(d("2026-10-29")), "2611");
        // The schedule's 2025 starts on 23 Jan; 2043 has fourteen cycles,
        // its last on 31 Dec.
        assert_eq!(airac_ident(d("2025-01-23")), "2501");
        assert_eq!(airac_ident(d("2043-12-31")), "4314");
    }
}
