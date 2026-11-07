//! A wind on a runway (web/src/lib/wind.ts, wingtip.runway_wind): how much of
//! it is along and how much across, the gust's crosswind against the
//! steady one, when a wind is calm, the end of each runway the reported
//! wind favours, and the end a pilot would pick into a wind the field's
//! own report did not give (lib/pattern windPick).
//!
//! A runway end's heading is OurAirports' true heading where it has one;
//! where not, the runway's number -- its magnetic heading in tens of
//! degrees -- turned true with the field's magnetic variation, which the
//! host works out (wingtip.magnetic, the engine's own WMM). A METAR's wind is
//! true, so the two are compared as they are. A helipad ("H1") or an end
//! with no number has no heading, and no wind of its own.

use super::pick::{runway_in_use, runway_number, Runway};
use crate::figures::words::js_round_f;
use crate::geo::py_mod;

/// A runway's wind as the planner works it out (favoured_end): the end it
/// favours as painted, and its components, knots -- the crosswind signed,
/// the gusts' None where none are reported.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct RunwayWind {
    pub end: String,
    pub headwind_kt: f64,
    pub crosswind_kt: f64,
    pub gust_crosswind_kt: Option<f64>,
    /// Calm now: the end the field's last wind favoured, the one in use.
    pub in_use: bool,
}

/// Degrees to radians as the web's lib/geo turns them, (d × π) / 180.
fn rad(deg: f64) -> f64 {
    (deg * std::f64::consts::PI) / 180.0
}

/// JavaScript's Math.round, a negative half or less to -0 as it does.
pub fn js_round(n: f64) -> f64 {
    let r = js_round_f(n);
    if r == 0.0 && n.is_sign_negative() {
        -0.0
    } else {
        r
    }
}

/// A direction brought into 0 up to 360 as the web's lib/geo normalizeDeg
/// does it, ((d % 360) + 360) % 360.
pub fn js_normalize(d: f64) -> f64 {
    ((d % 360.0) + 360.0) % 360.0
}

/// The headwind of a wind from `from_deg` at `kt` on a heading of
/// `heading_deg`, the same reference both (true for a METAR's wind and a
/// runway's true heading): negative for a tailwind.
pub fn headwind_kt(from_deg: f64, kt: f64, heading_deg: f64) -> f64 {
    kt * rad(from_deg - heading_deg).cos()
}

/// The crosswind of that wind: positive from the right, negative from the
/// left.
pub fn crosswind_kt(from_deg: f64, kt: f64, heading_deg: f64) -> f64 {
    kt * rad(from_deg - heading_deg).sin()
}

/// The crosswind a wind is judged by, steady or in the gusts, whichever
/// is more, unsigned (lib/wind steadyOrGustKt): a pilot meets the gust's
/// crosswind in the flare, so that is the one held against the
/// demonstrated crosswind or a personal minimum -- a design choice that
/// errs toward the stronger wind.
pub fn steady_or_gust_kt(steady_kt: f64, gust_kt: Option<f64>) -> f64 {
    steady_kt.abs().max(gust_kt.unwrap_or(0.0).abs())
}

/// A runway's wind judged by steady_or_gust_kt (lib/wind runwayCrosswindKt).
pub fn runway_crosswind_kt(wind: &RunwayWind) -> f64 {
    steady_or_gust_kt(wind.crosswind_kt, wind.gust_crosswind_kt)
}

/// Whether a reported or forecast wind is calm: a speed of nothing, which
/// a METAR and a TAF code as 00000KT (AIM 7-1-28's key, "00000KT for
/// calm"; a TAF's calm is 3 knots or less, forecast as 00000KT, AIM
/// 7-1-29). No speed at all is a wind not reported, never a calm one.
pub fn is_calm(speed_kt: Option<f64>) -> bool {
    speed_kt == Some(0.0)
}

/// Whether a runway's wind from favoured_end is a calm one: it puts no
/// head-, cross- or gust's crosswind on the end only for a speed of 0. Any
/// reported knot leaves at least 0.71 kt along or across a runway, which
/// rounds to 1, so this is is_calm on the report it was worked out from.
pub fn calm_on_runway(wind: &RunwayWind) -> bool {
    wind.headwind_kt == 0.0 && wind.crosswind_kt == 0.0 && wind.gust_crosswind_kt.is_none()
}

/// A runway end's true heading: the table's, or its number's magnetic
/// heading turned true (variation east positive). None where it has
/// neither -- a helipad, or an ident with no number.
pub fn end_heading_true_deg(ident: Option<&str>, heading_true_deg: Option<f64>, variation_deg: f64) -> Option<f64> {
    if let Some(h) = heading_true_deg.filter(|h| !h.is_nan()) {
        return Some(py_mod(h, 360.0));
    }
    // A runway end's number, and the L, C or R of a parallel: "09", "36R".
    let ident = ident.unwrap_or("").trim().to_uppercase();
    let digits = ident.chars().take_while(char::is_ascii_digit).count();
    let rest = &ident[digits..];
    if !(1..=2).contains(&digits) || !matches!(rest, "" | "L" | "C" | "R") {
        return None;
    }
    let number: f64 = ident[..digits].parse().ok()?;
    Some(py_mod(number * 10.0 + variation_deg, 360.0))
}

/// A report's wind, as much of a METAR as the runways' winds read: true,
/// knots, each None where it is not reported.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Reported {
    pub dir_true_deg: Option<f64>,
    pub speed_kt: Option<f64>,
    pub gust_kt: Option<f64>,
}

/// The end of a runway a report favours (favoured_end): its ident as the
/// data has it, its components -- rounded to the knot where the wind blew,
/// nothing at all where it was calm -- and whether, calm, it is the end the
/// field's last wind favoured, the runway in use.
#[derive(Clone, Debug, PartialEq)]
pub struct Favoured {
    pub end: Option<String>,
    pub headwind_kt: f64,
    pub crosswind_kt: f64,
    pub gust_crosswind_kt: Option<f64>,
    pub calm: bool,
    pub in_use: bool,
}

/// The first of `items` with the most of `key`, as Python's max takes it.
fn first_max<T>(items: impl IntoIterator<Item = T>, key: impl Fn(&T) -> f64) -> Option<T> {
    let mut best: Option<(T, f64)> = None;
    for item in items {
        let k = key(&item);
        if best.as_ref().is_none_or(|(_, b)| k > *b) {
            best = Some((item, k));
        }
    }
    best.map(|(item, _)| item)
}

/// The end of a runway the reported wind favours -- the most headwind --
/// and its components, rounded to the knot, the gust's crosswind where the
/// report has a gust. `ends` is the runway's (ident, true heading or None).
/// Calm is every end at nothing: the end the field's last wind favoured
/// (`recent`, its direction and speed), the runway in use, said so, else
/// the first one named. None with no report, a variable wind or no end
/// with a heading.
pub fn favoured_end(ends: &[(Option<String>, Option<f64>)], report: Option<&Reported>, variation_deg: f64, recent: Option<(f64, f64)>)
                    -> Option<Favoured> {
    let report = report?;
    let speed = report.speed_kt?;
    let headed: Vec<(&Option<String>, f64)> =
        ends.iter().filter_map(|(ident, h)| end_heading_true_deg(ident.as_deref(), *h, variation_deg).map(|h| (ident, h))).collect();
    if headed.is_empty() {
        return None;
    }
    let calm = |end: &Option<String>, in_use: bool| Favoured {
        end: end.clone(), headwind_kt: 0.0, crosswind_kt: 0.0, gust_crosswind_kt: None, calm: true, in_use,
    };
    if speed == 0.0 {
        return Some(match recent {
            Some((dir, kt)) => calm(first_max(&headed, |(_, h)| headwind_kt(dir, kt, *h))?.0, true),
            None => calm(headed[0].0, false),
        });
    }
    let dir = report.dir_true_deg?;
    let (ident, heading) = first_max(&headed, |(_, h)| headwind_kt(dir, speed, *h))?;
    // Python's round, halves to even, as the planner has always rounded them.
    let gust = report.gust_kt.filter(|g| *g != 0.0 && !g.is_nan());
    Some(Favoured {
        end: (*ident).clone(),
        headwind_kt: headwind_kt(dir, speed, *heading).round_ties_even(),
        crosswind_kt: crosswind_kt(dir, speed, *heading).round_ties_even(),
        gust_crosswind_kt: gust.map(|g| crosswind_kt(dir, g, *heading).round_ties_even()),
        calm: false,
        in_use: false,
    })
}

/// Each runway's wind on the end it favours (favoured_end), at a field
/// whose magnetic variation is `variation_deg`, each runway its ends
/// (ident, true heading or None). Calm with the field's last wind
/// (`recent`): the one runway the last wind favoured most is the one in
/// use, on its end into that wind; the rest stay calm on their first end.
pub fn with_winds(runways: &[Vec<(Option<String>, Option<f64>)>], report: Option<&Reported>, variation_deg: f64,
                  recent: Option<(f64, f64)>) -> Vec<Option<Favoured>> {
    let mut out: Vec<Option<Favoured>> = runways.iter().map(|ends| favoured_end(ends, report, variation_deg, None)).collect();
    let Some((dir, kt)) = recent else { return out };
    if report.and_then(|r| r.speed_kt) != Some(0.0) {
        return out;
    }
    let into_last = |ends: &Vec<(Option<String>, Option<f64>)>| {
        ends.iter()
            .filter_map(|(ident, h)| end_heading_true_deg(ident.as_deref(), *h, variation_deg))
            .map(|h| headwind_kt(dir, kt, h))
            .fold(f64::NEG_INFINITY, |a, b| if b > a { b } else { a })
    };
    if let Some(best) = first_max(0..runways.len(), |&k| into_last(&runways[k])) {
        if out[best].is_some() {
            out[best] = favoured_end(&runways[best], report, variation_deg, recent);
        }
    }
    out
}

/// Python's round to nine places, near enough for a tie: two headwinds the
/// same but for the last bits of their sums are the same, a -0 among them
/// (Python's -0.0 == 0.0, which total_cmp would order apart).
fn tie_places(x: f64) -> f64 {
    format!("{x:.9}").parse::<f64>().unwrap_or(x) + 0.0
}

/// A report's wind not the field's own (lib/pattern ReportedWind): the
/// nearest report's, or a forecast's, `station` said where it is not at the
/// field (`distance_nm` 0).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Nearby {
    pub station: String,
    pub distance_nm: f64,
    pub wind: Reported,
}

/// The wind a field's runways are chosen by (lib/pattern WindPick): the end
/// it favours as painted ("27", "" where none is), its head- and crosswind
/// and the gust's crosswind to the knot, whether it is calm, a variable
/// wind's speed, whether calm picked the runway in use, where it was
/// reported when not at the field (station, nm) and the forecast's time.
#[derive(Clone, Debug, PartialEq)]
pub struct WindPick {
    pub ident: String,
    pub headwind_kt: f64,
    pub crosswind_kt: f64,
    pub gust_crosswind_kt: Option<f64>,
    pub calm: bool,
    pub variable_kt: Option<f64>,
    pub in_use: bool,
    pub from: Option<(String, f64)>,
    pub forecast_at: Option<f64>,
}

/// The runway end the wind favours, for a pattern and a takeoff alike
/// (AC 90-66C 11.5, the runway most nearly into the wind): the field's own
/// report's, worked out on each runway (with_winds, runway_in_use); else,
/// for a field that reports none, the nearest report's wind (`nearby`),
/// said as that station's -- the most headwind, the longer runway on a
/// tie. Calm is said as calm, and picks, at the owner's ask ("when winds
/// are calm just pick the currently used or most used runway"), the runway
/// the field's last wind favoured where it is known, else the most used. A
/// variable wind (VRB, FAA Order JO 7900.5) has no direction to land into,
/// and picks as calm does. None with no wind to go by. With `forecast_at`
/// (s since 1970), `nearby` is a TAF's wind for then (the owner's pick,
/// 2026-10-20), the report now set aside.
pub fn wind_pick(runways: &[Runway], nearby: Option<&Nearby>, forecast_at: Option<f64>) -> Option<WindPick> {
    let none = WindPick {
        ident: String::new(), headwind_kt: 0.0, crosswind_kt: 0.0, gust_crosswind_kt: None, calm: true, variable_kt: None, in_use: false,
        from: None, forecast_at,
    };
    // A forecast's wind is worked out here alone: the runways' winds are
    // the field's report now.
    if forecast_at.is_none() {
        if let Some((r, e, true)) = runway_in_use(runways) {
            if let Some(w) = &runways[r].wind {
                let calm = calm_on_runway(w);
                return Some(WindPick {
                    ident: runway_number(&runways[r].ends[e].ident).to_owned(),
                    headwind_kt: w.headwind_kt,
                    crosswind_kt: w.crosswind_kt,
                    gust_crosswind_kt: w.gust_crosswind_kt,
                    calm,
                    in_use: calm && w.in_use,
                    ..none
                });
            }
        }
    }
    let nearby = nearby?;
    let speed = nearby.wind.speed_kt?;
    // Its own TAF, at the field, is said as the field's; another's by name.
    let from = (nearby.distance_nm != 0.0).then(|| (nearby.station.clone(), js_round(nearby.distance_nm)));
    let ends: Vec<(&Runway, &str, f64)> = runways
        .iter()
        .filter(|r| !r.closed)
        .flat_map(|r| r.ends.iter().filter_map(move |e| e.heading_true_deg.map(|h| (r, e.ident.as_str(), h))))
        .collect();
    if ends.is_empty() {
        return None;
    }
    let in_use = || runway_in_use(runways).map_or(String::new(), |(r, e, _)| runway_number(&runways[r].ends[e].ident).to_owned());
    if is_calm(Some(speed)) {
        return Some(WindPick { ident: in_use(), from, ..none });
    }
    let Some(dir) = nearby.wind.dir_true_deg else {
        // A variable wind has no direction to land into: the runway in use
        // or the most used, as calm, at the owner's screenshot (C81 under
        // KUGN's VRB06KT left with no runway at all).
        return Some(WindPick { ident: in_use(), variable_kt: Some(js_round(speed)), from, ..none });
    };
    // The most headwind, the longer runway on a tie (a stable sort, the
    // data's order among equals).
    let mut sorted = ends;
    sorted.sort_by(|a, b| {
        tie_places(headwind_kt(dir, speed, b.2))
            .total_cmp(&tie_places(headwind_kt(dir, speed, a.2)))
            .then_with(|| b.0.length_ft.unwrap_or(0.0).total_cmp(&a.0.length_ft.unwrap_or(0.0)))
    });
    let (_, ident, heading) = sorted[0];
    let gust = nearby.wind.gust_kt.filter(|g| *g != 0.0 && !g.is_nan());
    Some(WindPick {
        ident: runway_number(ident).to_owned(),
        headwind_kt: js_round(headwind_kt(dir, speed, heading)),
        crosswind_kt: js_round(crosswind_kt(dir, speed, heading)),
        gust_crosswind_kt: gust.map(|g| js_round(crosswind_kt(dir, g, heading))),
        calm: false,
        from,
        ..none
    })
}
