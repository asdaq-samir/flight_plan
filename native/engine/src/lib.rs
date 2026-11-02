//! wingtip-engine: the planner's figures in plain Rust, with no network
//! and nothing but std, so the same code answers on the planner (through
//! native/py, the vfr_native module) and later on the phones, iOS from
//! Swift and Android from Kotlin, both through UniFFI. It must build for
//! aarch64-apple-ios and aarch64-linux-android as it is: no Python, no
//! host-only crates, and the cycle pack read from bytes the caller maps.
//!
//! - grid: route options' straight lines over the grid;
//! - airspace: whether an airspace volume holds a point;
//! - pack: the cycle pack, one file per FAA cycle.

pub mod airspace;
pub mod grid;
pub mod pack;
pub mod sums;
