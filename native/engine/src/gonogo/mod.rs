//! The Brief's Go / No-Go, one copy for the planner (app.gonogo, through
//! vfr_native, for POST /api/go-no-go) and the phones (native/ffi), so
//! neither states a rule of its own (docs/NATIVE.md): the seven findings
//! and the line over them, and what each is worked out from. Each was
//! app.gonogo's Python, itself the web app's TypeScript ported line for
//! line with the same words and sources; where the two had drifted apart
//! the web's rule was taken (the coordinator's decision, 3 Nov 2026). The
//! web app keeps its own copy, and the two change together.
//!
//! - `verdict`: the findings and the line over them (lib/verdict), and
//!   the IFR alternate's say in them (useAlternate, FlightBriefingView);
//! - `minimums`: where the weather is under the pilot's own (lib/minimums,
//!   lib/wind);
//! - `icing`: under IFR, a flight planned into icing (lib/icing);
//! - `frat`: the risk assessment and the airplane's airworthiness
//!   (lib/frat, lib/airworthiness);
//! - `runways`: the runway check at each field (lib/runwayCheck,
//!   lib/takeoffLanding, lib/pattern's runwayFlown);
//! - `weight_balance`: the weight and balance (lib/weightBalance);
//! - `pass_times`: when the flight passes a point, and a TFR's or a
//!   special-use area's times then (lib/passTimes).
//!
//! Each takes plain data and gives plain values, with a `*_json` writer
//! for the planner's answer; the airports, runways, weather and plan they
//! are fed from stay the planner's lookups (app.routers.gonogo), and the
//! time zones the phone's or the planner's own (pass_times).

pub mod calls;
pub mod frat;
pub mod icing;
pub mod minimums;
pub mod pass_times;
pub mod runways;
pub mod verdict;
pub mod weight_balance;

/// A list of strings as JSON.
pub(crate) fn strings(out: &mut String, items: &[String]) {
    out.push('[');
    for (i, s) in items.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        crate::json::string(out, s);
    }
    out.push(']');
}

/// A JavaScript string's truth: there, and not empty.
pub(crate) fn said(s: &Option<String>) -> bool {
    s.as_deref().is_some_and(|s| !s.is_empty())
}
