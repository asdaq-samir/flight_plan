//! wingtip-figures: the four pilot pages' figures, over wingtip-geo only
//! (native/README.md). Its `figures::words` are the numbers written as
//! the web writes them, which most crates above it share.
//!
//! - figures: the debrief of a flown track (ACS PA.VI.A), the diversion
//!   drill (PA.VI.C), a hold's entry and wind (AIM 5-3-8) and lost
//!   communications' altitudes (14 CFR 91.185), with their words.

pub mod figures;

// The modules below this crate by the names they had when the engine was
// one crate, so the code reads them as crate::json and so on.
use wingtip_geo::{flight, geo, json};
