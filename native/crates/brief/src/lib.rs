//! wingtip-brief: the Brief's Go / No-Go and the runways it checks, over
//! wingtip-geo and wingtip-figures (native/README.md). One crate because
//! the two lean on each other: the Go / No-Go's runway check goes by the
//! runway pick, and the runway rules by name read their input as the Go /
//! No-Go's do.
//!
//! - gonogo: the Brief's Go / No-Go -- its seven findings and the line
//!   over them, the pilot's minimums, icing under IFR, the risk
//!   assessment, the runway check, the weight and balance and the pass
//!   times (the web's lib/verdict and the modules it is fed from);
//! - runway: runways, the wind on them and the traffic pattern -- the end
//!   flown, its pattern's side, entry, altitude and legs, a POH's
//!   short-field distances and how an end suits the airplane.

pub mod gonogo;
pub mod runway;

// The modules below this crate by the names they had when the engine was
// one crate, so the code reads them as crate::json and so on.
use wingtip_figures::figures;
use wingtip_geo::{flight, geo, json};
