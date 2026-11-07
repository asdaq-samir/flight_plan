//! wingtip-airspace: the airspace and the cycle packs, over wingtip-geo,
//! wingtip-figures and wingtip-radio (native/README.md).
//!
//! - airspace: whether an airspace volume holds a point;
//! - pack: the cycle pack, one file per FAA cycle;
//! - rules: the airspace over a point in bands, with the rules of each;
//! - phone: the planner's airspace-at-a-point answer from a phone's pack;
//! - view: the map's airspace, airports and VORs in view from the packs,
//!   as the planner's in-view endpoints answer them;
//! - ahead: the alerts ahead of the airplane from the phone's packs;
//! - spoken: the places a clearance names, found in the phone's packs.

pub mod ahead;
pub mod airspace;
pub mod pack;
pub mod phone;
pub mod rules;
pub mod spoken;
pub mod view;

// The modules below this crate by the names they had when the engine was
// one crate, so the code reads them as crate::json and so on.
use wingtip_figures::figures;
use wingtip_geo::{geo, json};
use wingtip_radio::clearance;
