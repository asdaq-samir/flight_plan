//! wingtip-wording: the FAA's own words in the app's, over wingtip-geo,
//! wingtip-figures and wingtip-airspace (native/README.md).
//!
//! - wording: the FAA's capitals in sentence case, names, the advisories'
//!   intensities, a field's radio and fuel, a VOR's radial, Morse and
//!   service volume.

pub mod wording;

// The modules below this crate by the names they had when the engine was
// one crate, so the code reads them as crate::json and so on.
use wingtip_airspace::rules;
use wingtip_figures::figures;
use wingtip_geo::{geo, json};
