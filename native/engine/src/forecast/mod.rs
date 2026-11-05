//! A field's weather as the app says it: the flight category a ceiling and
//! a visibility fall in, where only some of the figures are known (the
//! web's lib/map/flightCategory, the planner's wingtip.glmp), and an hour of a
//! TAF read from its change groups (the web's lib/hourly). The TAF's text
//! is read by each host (the web by metar-taf-parser); what its groups
//! mean for the hour is decided here, once.

pub mod calls;

use crate::metar;

/// The category a ceiling and a visibility fall in, by AIM 7-1-7's bounds
/// ("Categorical Outlooks"; the worse of the two decides): LIFR "ceiling
/// less than 500 feet and/or visibility less than 1 mile", IFR 500 to less
/// than 1,000 ft or 1 to less than 3, MVFR "1,000 to 3,000 feet and/or
/// visibility 3 to 5 miles inclusive", VFR above both -- statute miles, as
/// US reports give visibility. The bounds are metar::flight_category's, the
/// AWC's (AC 00-45H), which this reuses. No ceiling is no limit. With no
/// visibility only a ceiling under 500 ft decides it, LIFR whatever the
/// visibility is: over that the visibility could still make it worse, and
/// a category said then would be a guess.
pub fn category_of(ceiling_ft: Option<f64>, visibility_sm: Option<f64>) -> Option<&'static str> {
    match visibility_sm {
        None => (ceiling_ft.unwrap_or(f64::INFINITY) < 500.0).then_some("LIFR"),
        Some(_) => metar::flight_category(ceiling_ft, visibility_sm),
    }
}

/// A category's place from best to worst, VFR 0 to LIFR 3; -1 for none or
/// one not known, below them all.
pub fn rank(category: Option<&str>) -> i32 {
    match category {
        Some("VFR") => 0,
        Some("MVFR") => 1,
        Some("IFR") => 2,
        Some("LIFR") => 3,
        _ => -1,
    }
}

/// What of one forecast group the hour's reading turns on.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Figures {
    pub category: Option<String>,
    pub gust_kt: Option<f64>,
    pub thunder: bool,
}

/// A TEMPO, PROB or INTER group in force in the hour; `chance` where it
/// is a PROB30 or PROB40, alone or before a TEMPO.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Group {
    pub figures: Figures,
    pub chance: bool,
}

/// The hour as its groups make it.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Hour {
    /// A BECMG under way whose weather before is worse than after: the
    /// hour is the weather before (the wind stays the new group's).
    pub before_worse: bool,
    /// A TEMPO's or PROB's category where it is worse than the prevailing
    /// one: the weather at times.
    pub at_times: Option<String>,
    /// The strongest gust at times, where above the prevailing's.
    pub at_times_gust_kt: Option<f64>,
    /// Thunder at times, where the prevailing has none.
    pub at_times_thunder: bool,
    /// The worse weather at times comes only from a PROB group: a chance
    /// of it, not weather expected now and then as a TEMPO's is.
    pub at_times_chance: bool,
}

/// One hour of a TAF from the groups in force then, as AC 00-45H (Aviation
/// Weather Services) sets the change groups out: the forecast's first line
/// and each FM group the prevailing weather until the next; a BECMG a
/// change that happens somewhere in its window and holds after it, so
/// while it is `becoming` the hour is the worse of `before` and after (a
/// stock reader's composite takes the new weather from the window's start,
/// which is right only when it gets worse); a TEMPO, PROB or INTER group
/// weather that comes and goes, not the hour's bar but its "at times".
pub fn hour(prevailing: &Figures, becoming: bool, before: Option<&Figures>, supplemental: &[Group]) -> Hour {
    let mut out = Hour::default();
    let mut category = prevailing.category.as_deref();
    let mut thunder = prevailing.thunder;
    if let Some(was) = before.filter(|_| becoming) {
        if rank(was.category.as_deref()) > rank(category) {
            out.before_worse = true;
            category = was.category.as_deref();
            thunder = was.thunder;
        }
    }
    // The gust compared with is the prevailing group's own: a BECMG's wind
    // is the new one from the window's start.
    let gust = prevailing.gust_kt;
    for group in supplemental {
        let then = group.figures.category.as_deref();
        if rank(then) > rank(category) && rank(then) > rank(out.at_times.as_deref()) {
            out.at_times = then.map(str::to_owned);
            out.at_times_chance = group.chance;
        } else if then == out.at_times.as_deref() && !group.chance {
            // A TEMPO saying the same as a PROB: expected at times, not
            // only a chance of it.
            out.at_times_chance = false;
        }
        if let Some(g) = group.figures.gust_kt {
            if g > gust.unwrap_or(0.0) && g > out.at_times_gust_kt.unwrap_or(0.0) {
                out.at_times_gust_kt = Some(g);
            }
        }
        if group.figures.thunder && !thunder {
            out.at_times_thunder = true;
        }
    }
    out
}
