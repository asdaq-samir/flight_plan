//! wingtip-engine: the planner's figures in plain Rust, with no network
//! and nothing but std, so the same code answers on the planner (through
//! native/py, the vfr_native module) and on the phones (through
//! native/ffi's C functions: iOS from Swift, Android later from Kotlin).
//! It must build for aarch64-apple-ios and aarch64-linux-android as it
//! is: no Python, no host-only crates, and the cycle pack read from bytes
//! the caller maps.
//!
//! - grid: route options' straight lines over the grid;
//! - airspace: whether an airspace volume holds a point;
//! - pack: the cycle pack, one file per FAA cycle;
//! - geo: great-circle distances, as vfr.geo has them;
//! - rules: the airspace over a point in bands, with the rules of each;
//! - phone: the planner's airspace-at-a-point answer from a phone's pack;
//! - flight: the wind triangle, 91.159's altitudes, 91.151's reserve, the atmosphere;
//! - wmm: magnetic variation from the World Magnetic Model;
//! - validity: when a weather report stops counting;
//! - metar, taf, winds, notam, tfr: the weather and NOTAM products as
//!   sent, read strictly (xml: the small XML reader they share; time:
//!   UTC dates).

pub mod airspace;
pub mod flight;
pub mod geo;
pub mod grid;
pub mod metar;
pub mod notam;
mod json;
pub mod pack;
pub mod phone;
pub mod rules;
pub mod taf;
pub mod tfr;
pub mod time;
pub mod sums;
pub mod validity;
pub mod winds;
pub mod wmm;
pub mod xml;
