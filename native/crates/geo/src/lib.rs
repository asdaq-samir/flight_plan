//! wingtip-geo: the bottom of the engine's crates (native/README.md),
//! which every other one may use and which uses none of them.
//!
//! - geo: great-circle distances, as wingtip.geo has them;
//! - wmm: magnetic variation from the World Magnetic Model;
//! - grid: route options' straight lines over the grid (sums: the
//!   Python's float sums, kept exactly);
//! - flight: the wind triangle, 91.159's altitudes, 91.151's reserve, the
//!   atmosphere;
//! - time: UTC dates;
//! - json: the little JSON every rule reads and writes;
//! - xml: the small XML reader the weather products share.

pub mod flight;
pub mod geo;
pub mod grid;
pub mod json;
pub mod sums;
pub mod time;
pub mod wmm;
pub mod xml;
