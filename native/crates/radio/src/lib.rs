//! wingtip-radio: what is heard on the radio, over wingtip-geo only
//! (native/README.md).
//!
//! - clearance: an ATC clearance heard, read into its items, and a call
//!   to us by its call sign (the web's lib/clearance and lib/heardCall);
//! - readback: the pilot's readback of a clearance checked against it;
//! - atis: an ATIS or AWOS/ASOS broadcast as the phone heard it, read
//!   into its figures.

pub mod atis;
pub mod clearance;
pub mod readback;

// The modules below this crate by the names they had when the engine was
// one crate, so the code reads them as crate::json.
use wingtip_geo::json;
