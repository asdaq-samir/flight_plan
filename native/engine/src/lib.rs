//! wingtip-engine: the planner's figures in plain Rust, with no network
//! and nothing but std, so the same code answers on the planner (through
//! native/py, the wingtip_native module) and on the phones (through
//! native/ffi's C functions: iOS from Swift, Android later from Kotlin).
//! It must build for aarch64-apple-ios and aarch64-linux-android as it
//! is: no Python, no host-only crates, and the cycle pack read from bytes
//! the caller maps.
//!
//! The engine is a facade over its crates (native/crates, the layering in
//! native/README.md): each module is a crate's, used here at the path it
//! had when the engine was one crate, so the hosts and the tests name
//! them as before. Only `call` is the facade's own.
//!
//! - call: one way in for every host, a rule asked by name with JSON in
//!   and JSON out (the web app's wasm, wingtip_native.call, wt_call);
//! - grid: route options' straight lines over the grid;
//! - ahead: the alerts ahead of the airplane from the phone's packs;
//! - airspace: whether an airspace volume holds a point;
//! - pack: the cycle pack, one file per FAA cycle;
//! - geo: great-circle distances, as wingtip.geo has them;
//! - rules: the airspace over a point in bands, with the rules of each;
//! - phone: the planner's airspace-at-a-point answer from a phone's pack;
//! - view: the map's airspace, airports and VORs in view from the packs,
//!   as the planner's in-view endpoints answer them;
//! - clearance: an ATC clearance heard, read into its items, and a call
//!   to us by its call sign (the web's lib/clearance and lib/heardCall);
//! - spoken: the places a clearance names, found in the phone's packs;
//! - figures: the debrief of a flown track (ACS PA.VI.A), the diversion
//!   drill (PA.VI.C), a hold's entry and wind (AIM 5-3-8) and lost
//!   communications' altitudes (14 CFR 91.185), with their words;
//! - motion: the things that move -- traffic about own ship, a watched
//!   airplane's alerts, the glide range, the plan's profile and its dry
//!   run, a flown track read from its file;
//! - gonogo: the Brief's Go / No-Go -- its seven findings and the line
//!   over them, the pilot's minimums, icing under IFR, the risk
//!   assessment, the runway check, the weight and balance and the pass
//!   times (the web's lib/verdict and the modules it is fed from);
//! - pilot: the pilot's records and text -- a checklist, the logbook's
//!   CSV file, a handbook page, endorsements and ACS codes;
//! - route: the route's pilot-made pieces as the address writes them
//!   and the planner reads them -- the pilot's own point off a fix, holds,
//!   procedures and runways picked;
//! - runway: runways, the wind on them and the traffic pattern -- the end
//!   flown, its pattern's side, entry, altitude and legs, a POH's
//!   short-field distances and how an end suits the airplane;
//! - approach: instrument approaches taught (the brief, the coached dry
//!   run, the quiz) and debriefed against the procedure flown;
//! - flight: the wind triangle, 91.159's altitudes, 91.151's reserve, the atmosphere;
//! - wmm: magnetic variation from the World Magnetic Model;
//! - forecast: a field's flight category from what is known of its
//!   ceiling and visibility, and an hour of its TAF from the groups then;
//! - aircraft: the traffic list's filters (an airplane's kind, height,
//!   operator, emergency, how it stands to a field) and an airplane by its
//!   N-number, on its type's stock profile;
//! - wording: the FAA's own words in the app's -- its capitals in sentence
//!   case, names, the advisories' intensities, a field's radio and fuel, a
//!   VOR's radial, Morse and service volume;
//! - validity: when a weather report stops counting;
//! - cycles: when an FAA data set's edition stops counting;
//! - metar, taf, winds, notam, tfr: the weather and NOTAM products as
//!   sent, read strictly (xml: the small XML reader they share; time:
//!   UTC dates).

pub mod call;

pub use wingtip_airspace::{ahead, airspace, pack, phone, rules, spoken, view};
pub use wingtip_brief::{gonogo, runway};
pub use wingtip_figures::figures;
pub use wingtip_geo::{flight, geo, grid, sums, time, wmm, xml};
pub use wingtip_pilot::{aircraft, pilot};
pub use wingtip_radio::{atis, clearance, readback};
pub use wingtip_route::{approach, motion, route};
pub use wingtip_weather::{cycles, forecast, metar, notam, taf, tfr, validity, winds};
pub use wingtip_wording::wording;

// The JSON every rule reads and writes, as call.rs names it; not part of
// the engine's face, as it was not when the engine was one crate.
use wingtip_geo::json;
