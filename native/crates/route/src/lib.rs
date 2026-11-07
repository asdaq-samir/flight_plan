//! wingtip-route: the route and what flies it, over wingtip-geo and
//! wingtip-figures (native/README.md).
//!
//! - route: the route's pilot-made pieces as the address writes them
//!   and the planner reads them -- the pilot's own point off a fix, holds,
//!   procedures and runways picked;
//! - motion: the things that move -- traffic about own ship, a watched
//!   airplane's alerts, the glide range, the plan's profile and its dry
//!   run, a flown track read from its file;
//! - approach: instrument approaches taught (the brief, the coached dry
//!   run, the quiz) and debriefed against the procedure flown.

pub mod approach;
pub mod motion;
pub mod route;

// The modules below this crate by the names they had when the engine was
// one crate, so the code reads them as crate::json and so on.
use wingtip_figures::figures;
use wingtip_geo::{geo, json, time, xml};
