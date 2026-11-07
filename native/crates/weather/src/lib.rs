//! wingtip-weather: the weather and NOTAM products, over wingtip-geo
//! only (native/README.md).
//!
//! - metar, taf, winds, notam, tfr: the products as sent, read strictly;
//! - forecast: a field's flight category from what is known of its
//!   ceiling and visibility, and an hour of its TAF from the groups then;
//! - validity: when a weather report stops counting;
//! - cycles: when an FAA data set's edition stops counting (AIRAC,
//!   the 56-day charts, the obstacle file).

pub mod cycles;
pub mod forecast;
pub mod metar;
pub mod notam;
pub mod taf;
pub mod tfr;
pub mod validity;
pub mod winds;

// The modules below this crate by the names they had when the engine was
// one crate, so the code reads them as crate::json and so on.
use wingtip_geo::{json, time, xml};
