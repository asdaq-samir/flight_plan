//! wingtip-engine: the planner's figures in plain Rust, with no network
//! and nothing but std, so the same code answers on the planner (through
//! native/py, the vfr_native module) and on the phones (through
//! native/ffi's C functions: iOS from Swift, Android later from Kotlin).
//! It must build for aarch64-apple-ios and aarch64-linux-android as it
//! is: no Python, no host-only crates, and the cycle pack read from bytes
//! the caller maps.
//!
//! - call: one way in for every host, a rule asked by name with JSON in
//!   and JSON out (the web app's wasm, vfr_native.call, wt_call);
//! - grid: route options' straight lines over the grid;
//! - ahead: the alerts ahead of the airplane from the phone's packs;
//! - airspace: whether an airspace volume holds a point;
//! - pack: the cycle pack, one file per FAA cycle;
//! - geo: great-circle distances, as vfr.geo has them;
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
//! - metar, taf, winds, notam, tfr: the weather and NOTAM products as
//!   sent, read strictly (xml: the small XML reader they share; time:
//!   UTC dates).

pub mod ahead;
pub mod aircraft;
pub mod airspace;
pub mod atis;
pub mod approach;
pub mod call;
pub mod clearance;
pub mod figures;
pub mod flight;
pub mod forecast;
pub mod geo;
pub mod gonogo;
pub mod grid;
pub mod metar;
pub mod motion;
pub mod notam;
mod json;
pub mod pack;
pub mod phone;
pub mod pilot;
pub mod readback;
pub mod route;
pub mod rules;
pub mod runway;
pub mod spoken;
pub mod taf;
pub mod tfr;
pub mod time;
pub mod sums;
pub mod validity;
pub mod view;
pub mod winds;
pub mod wmm;
pub mod wording;
pub mod xml;
