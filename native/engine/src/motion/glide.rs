//! Own ship's still-air glide (the web's lib/map/glide): the ring on the
//! map, the fields in reach on the Nearest card, and whether the airplane
//! is moving at flying speed at all.

use super::opt;
use crate::figures::debrief::AIRBORNE_KT;
use crate::json::{self, Value};

/// A light single's still-air glide: the Cessna 172S's maximum glide chart
/// (POH figure 3-1, 68 KIAS) is about 1.5 nm for every 1,000 ft, 9 to 1.
pub const GLIDE_NM_PER_1000_FT: f64 = 1.5;
/// Below this over the ground (or slower than AIRBORNE_KT, the debrief's
/// too), the airplane is on the ground or about to be, and there is no
/// ring to draw.
pub const AIRBORNE_AGL_FT: f64 = 500.0;
/// The height to arrive at over a field glided to: its pattern, AC
/// 90-66C's 1,000 ft above it for a propeller airplane, from where a
/// landing can still be flown.
pub const ARRIVE_AGL_FT: f64 = 1000.0;

/// How far own ship glides in still air from its GPS altitude over
/// `ground_ft` -- the nearest field's elevation, as near as the page knows
/// the ground -- nm; None on the ground or with a height not known.
pub fn range_nm(altitude_ft: Option<f64>, speed_kt: Option<f64>, ground_ft: Option<f64>) -> Option<f64> {
    let agl = altitude_ft? - ground_ft?;
    if agl < AIRBORNE_AGL_FT || speed_kt.unwrap_or(0.0) < AIRBORNE_KT {
        return None;
    }
    Some((agl / 1000.0) * GLIDE_NM_PER_1000_FT)
}

/// Whether own ship can glide, in still air, to a field `distance_nm` off
/// and arrive over it at pattern height -- from its GPS altitude over that
/// field's own elevation, not the nearest one's: a field on higher ground
/// is nearer the airplane's height. False where either height is not known.
pub fn reaches(altitude_ft: Option<f64>, speed_kt: Option<f64>, distance_nm: f64, elevation_ft: Option<f64>) -> bool {
    let (Some(alt), Some(elevation)) = (altitude_ft, elevation_ft) else { return false };
    if speed_kt.unwrap_or(0.0) < AIRBORNE_KT {
        return false;
    }
    let spare = alt - elevation - ARRIVE_AGL_FT;
    spare > 0.0 && (spare / 1000.0) * GLIDE_NM_PER_1000_FT >= distance_nm
}

/// Own ship moving at flying speed: in the air, or about to be.
pub fn underway(speed_kt: Option<f64>) -> bool {
    speed_kt.unwrap_or(0.0) >= AIRBORNE_KT
}

/// `glide_range`: nm or null, from `{"altitude_ft"?, "speed_kt"?,
/// "ground_ft"?}`.
pub(super) fn range_rule(v: &Value) -> Result<String, String> {
    let n = "glide_range";
    let mut out = String::new();
    json::opt_number(&mut out, range_nm(opt(n, v, "altitude_ft")?, opt(n, v, "speed_kt")?, opt(n, v, "ground_ft")?));
    Ok(out)
}

/// `glide_reaches`: true or false, from `{"altitude_ft"?, "speed_kt"?,
/// "distance_nm", "elevation_ft"?}`.
pub(super) fn reaches_rule(v: &Value) -> Result<String, String> {
    let n = "glide_reaches";
    let distance = opt(n, v, "distance_nm")?.ok_or("glide_reaches: \"distance_nm\" is missing")?;
    let yes = reaches(opt(n, v, "altitude_ft")?, opt(n, v, "speed_kt")?, distance, opt(n, v, "elevation_ft")?);
    Ok(if yes { "true" } else { "false" }.to_owned())
}

/// `underway`: true or false, from `{"speed_kt"?}`.
pub(super) fn underway_rule(v: &Value) -> Result<String, String> {
    Ok(if underway(opt("underway", v, "speed_kt")?) { "true" } else { "false" }.to_owned())
}
