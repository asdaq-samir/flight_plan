//! A pilot's personal minimums -- the weather they have decided they will
//! not take off or land in, stricter than the rules -- and where the
//! briefing's weather is under them (web/src/lib/minimums.ts, with
//! lib/wind's steadyOrGustKt and runwayCrosswindKt). Each off (None) until
//! set.

use crate::figures::words::{alt_ft, js_num, js_opt};

/// The minimums, each off until set: the lowest ceiling (feet above the
/// field, a METAR's or TAF's), the least visibility (statute miles), the
/// most crosswind on the best runway and the most surface wind, gusts
/// included (knots).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Minimums {
    pub ceiling_ft: Option<f64>,
    pub visibility_sm: Option<f64>,
    pub crosswind_kt: Option<f64>,
    pub wind_kt: Option<f64>,
}

/// The choices each minimum is picked from (menus, not sliders), the
/// web's MINIMUM_CHOICES: the native app's menus read the same.
pub const MINIMUM_CHOICES: [(&str, &[i64]); 4] = [
    ("ceiling_ft", &[1000, 1500, 2000, 2500, 3000, 4000, 5000]),
    ("visibility_sm", &[3, 4, 5, 6, 8, 10]),
    ("crosswind_kt", &[5, 8, 10, 12, 15, 17, 20]),
    ("wind_kt", &[10, 15, 20, 25, 30, 35]),
];

// A runway's wind and the crosswind it is judged by are the runway
// module's (crate::runway::wind, lib/wind), shared with the runway pick,
// the runway fit and the check.
pub use crate::runway::wind::{runway_crosswind_kt, steady_or_gust_kt, RunwayWind};

/// The crosswind on the field's best open runway for the wind -- the
/// least, the gusts' where they are more -- and that runway's favoured
/// end. A closed runway is not landed on, so its wind is not counted. A
/// wind reported with no direction (VRB), which gives no runway a
/// component, may blow across any of them, so all of it, gusts included,
/// is taken as crosswind, with no end (`reported`, the field's METAR's
/// speed and gust). Each runway is (closed, its wind).
pub fn best_crosswind(runways: &[(bool, Option<RunwayWind>)], reported: Option<(Option<f64>, Option<f64>)>)
                      -> Option<(Option<String>, f64)> {
    let open: Vec<&Option<RunwayWind>> = runways.iter().filter(|(closed, _)| !closed).map(|(_, w)| w).collect();
    let winds: Vec<&RunwayWind> = open.iter().filter_map(|w| w.as_ref()).collect();
    let Some(first) = winds.first() else {
        let (speed, gust) = reported.unwrap_or((None, None));
        let all = steady_or_gust_kt(speed.unwrap_or(0.0), gust);
        return (all > 0.0 && !open.is_empty()).then_some((None, all));
    };
    // A later wind only where it is less: the first of equals stays.
    let best = winds[1..].iter().fold(*first, |a, b| if runway_crosswind_kt(b) < runway_crosswind_kt(a) { b } else { a });
    Some((Some(best.end.clone()), runway_crosswind_kt(best)))
}

/// A field's current report, as much as the minimums read of it.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Report {
    pub ceiling_ft: Option<f64>,
    pub visibility_sm: Option<f64>,
    pub wind_speed_kt: Option<f64>,
    pub wind_gust_kt: Option<f64>,
}

/// An airport landed at: its ident, its METAR (None with none), and its
/// runways, each (closed, wind).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Landing {
    pub ident: String,
    pub metar: Option<Report>,
    pub runways: Vec<(bool, Option<RunwayWind>)>,
}

/// The briefing as the minimums read it: each airport landed at in turn,
/// the destination and its forecast's (ceiling, visibility) where the
/// forecast has the station, and the worst forecast along the route.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Weather {
    pub landings: Vec<Landing>,
    pub dest: String,
    pub dest_forecast: Option<(Option<f64>, Option<f64>)>,
    pub min_ceiling_ft: Option<f64>,
    pub min_visibility_sm: Option<f64>,
}

/// Where the briefing's weather is under the minimums, each a sentence:
/// every airport landed at's current report (ceiling, visibility, wind,
/// the crosswind on its best runway), the destination's forecast, and the
/// forecast along the route. Empty when it is not, or none is set.
pub fn under_minimums(m: &Minimums, w: &Weather) -> Vec<String> {
    let mut reasons = Vec::new();
    let ceiling = |reasons: &mut Vec<String>, at: &str, ft: Option<f64>| {
        if let (Some(min), Some(ft)) = (m.ceiling_ft, ft) {
            if ft < min {
                reasons.push(format!("{at} ceiling {} ft, under your {} ft", alt_ft(Some(ft)), alt_ft(Some(min))));
            }
        }
    };
    let visibility = |reasons: &mut Vec<String>, at: &str, sm: Option<f64>| {
        if let (Some(min), Some(sm)) = (m.visibility_sm, sm) {
            if sm < min {
                reasons.push(format!("{at} visibility {} sm, under your {} sm", js_num(sm), js_num(min)));
            }
        }
    };
    for field in &w.landings {
        let ident = &field.ident;
        if let Some(metar) = &field.metar {
            ceiling(&mut reasons, ident, metar.ceiling_ft);
            visibility(&mut reasons, ident, metar.visibility_sm);
            let wind = steady_or_gust_kt(metar.wind_speed_kt.unwrap_or(0.0), metar.wind_gust_kt);
            if let Some(most) = m.wind_kt {
                if wind > most {
                    // `gust ? "12G22" : "12"`: a gust of 0 is not said.
                    let reported = match metar.wind_gust_kt {
                        Some(gust) if gust != 0.0 && !gust.is_nan() => format!("{}G{}", js_opt(metar.wind_speed_kt), js_num(gust)),
                        _ => js_opt(metar.wind_speed_kt),
                    };
                    reasons.push(format!("{ident} wind {reported} kt, over your {} kt", js_num(most)));
                }
            }
        }
        let crosswind = best_crosswind(&field.runways, field.metar.map(|r| (r.wind_speed_kt, r.wind_gust_kt)));
        if let (Some(most), Some((end, kt))) = (m.crosswind_kt, crosswind) {
            if kt > most {
                reasons.push(match end {
                    None => format!("{ident} variable wind {} kt, which may all be crosswind, over your {} kt", js_num(kt), js_num(most)),
                    Some(end) => format!("{ident} crosswind {} kt on its best runway ({end}), over your {} kt", js_num(kt), js_num(most)),
                });
            }
        }
    }
    if let Some((ft, sm)) = w.dest_forecast {
        let at = format!("{} forecast", w.dest);
        ceiling(&mut reasons, &at, ft);
        visibility(&mut reasons, &at, sm);
    }
    ceiling(&mut reasons, "Along the route, forecast", w.min_ceiling_ft);
    visibility(&mut reasons, "Along the route, forecast", w.min_visibility_sm);
    reasons
}
