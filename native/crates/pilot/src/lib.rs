//! wingtip-pilot: the pilot's records and the airplanes, over wingtip-geo
//! only (native/README.md).
//!
//! - pilot: the pilot's records and text -- a checklist, the logbook's
//!   CSV file, a handbook page, endorsements and ACS codes;
//! - aircraft: the traffic list's filters (an airplane's kind, height,
//!   operator, emergency, how it stands to a field) and an airplane by its
//!   N-number, on its type's stock profile.

pub mod aircraft;
pub mod pilot;

// The modules below this crate by the names they had when the engine was
// one crate, so the code reads them as crate::json and so on.
use wingtip_geo::{geo, json, time};
