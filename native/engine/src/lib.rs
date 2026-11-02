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
//! - clearance: an ATC clearance heard, read into its items, and a call
//!   to us by its call sign (the web's lib/clearance and lib/heardCall);
//! - spoken: the places a clearance names, found in the phone's packs.

pub mod airspace;
pub mod clearance;
pub mod geo;
pub mod grid;
mod json;
pub mod pack;
pub mod phone;
pub mod rules;
pub mod spoken;
pub mod sums;
