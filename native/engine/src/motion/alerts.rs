//! What a pilot can ask to be told of another airplane, from its card's
//! Alert (the web's lib/aircraftAlerts, the phone's Tracking): that it
//! takes off, that it lands, that it comes near own ship or near an
//! airport -- each said once, as it happens, as FlightAware's alert for a
//! flight is. The words each app writes; when one goes off is here.

use super::{num, opt, opt_bool};
use crate::geo::{bearing_deg, distance_nm};
use crate::json::{self, Value};

/// Unheard this long, s, and not known to have landed, an airplane not
/// heard taking off is taken to be on the ground: parked out of the
/// receivers' hearing, not flying out of it.
pub const PARKED_UNHEARD_S: f64 = 30.0 * 60.0;

/// Whether the airplane is in the air, from its state now and what was
/// known before: in the air where it is heard there; on the ground where
/// it has landed somewhere, or where nothing was known and it has not been
/// heard for PARKED_UNHEARD_S or ever; else what was known, as an airplane
/// gone quiet in the pattern has not landed until it is known to have.
/// None where it is not known.
pub fn airborne_now(before: Option<bool>, airborne: bool, arrived: bool, heard_s: Option<f64>) -> Option<bool> {
    if airborne {
        return Some(true);
    }
    if arrived {
        return Some(false);
    }
    match before {
        None => match heard_s {
            None => Some(false),
            Some(s) if s >= PARKED_UNHEARD_S => Some(false),
            Some(_) => None,
        },
        known => known,
    }
}

/// The kinds of alert.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    TakeOff,
    Land,
    /// Within some miles of own ship, or of an airport: which the caller
    /// says by the place it gives.
    Near,
}

/// Whether an alert goes off now.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Fires {
    pub fires: bool,
    /// Near something: whether it is that near now, kept for the next
    /// answer so it is said once; None for the others.
    pub inside: Option<bool>,
    /// Near something and gone off: how far, nm, and from which way, the
    /// true bearing from the place to it.
    pub nm: Option<f64>,
    pub bearing_deg: Option<f64>,
}

const QUIET: Fires = Fires { fires: false, inside: None, nm: None, bearing_deg: None };

/// Whether an alert goes off, from what was known at the last answer
/// (`before_airborne`, and `was_inside` for one near something) and now:
/// takes off where it was known on the ground and is in the air; lands
/// where it was in the air and is down at a field (`arrived`); near
/// something where it has come within `limit_nm` of `to` (own ship's fix,
/// or the airport) since the last answer.
pub fn fires(
    kind: Kind,
    before_airborne: Option<bool>,
    was_inside: bool,
    airborne: Option<bool>,
    arrived: bool,
    plane: Option<(f64, f64)>,
    to: Option<(f64, f64)>,
    limit_nm: f64,
) -> Fires {
    match kind {
        Kind::TakeOff => Fires { fires: before_airborne == Some(false) && airborne == Some(true), ..QUIET },
        Kind::Land => Fires { fires: before_airborne == Some(true) && airborne == Some(false) && arrived, ..QUIET },
        Kind::Near => {
            let (Some(p), Some(to)) = (plane, to) else { return QUIET };
            let nm = distance_nm(to.0, to.1, p.0, p.1);
            let inside = nm <= limit_nm;
            if !inside || was_inside {
                return Fires { inside: Some(inside), ..QUIET };
            }
            Fires { fires: true, inside: Some(true), nm: Some(nm), bearing_deg: Some(bearing_deg(to.0, to.1, p.0, p.1)) }
        }
    }
}

/// `airborne_now`: true, false or null, from `{"before": bool|null,
/// "airborne": bool, "arrived": bool, "heard_s"?}` -- the planner's
/// FlightStatus's airborne, whether it has an arrival, and its heard_s.
pub(super) fn airborne_now_rule(v: &Value) -> Result<String, String> {
    let n = "airborne_now";
    let now = airborne_now(
        opt_bool(n, v, "before")?,
        opt_bool(n, v, "airborne")?.unwrap_or(false),
        opt_bool(n, v, "arrived")?.unwrap_or(false),
        opt(n, v, "heard_s")?,
    );
    Ok(match now {
        None => "null",
        Some(true) => "true",
        Some(false) => "false",
    }
    .to_owned())
}

fn place(n: &str, v: &Value, key: &str) -> Result<Option<(f64, f64)>, String> {
    match v.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(p) => Ok(Some((num(n, p, "lat")?, num(n, p, "lon")?))),
    }
}

/// `alert_fires`: {"fires", "inside", "nm", "bearing_deg"}, from `{"kind":
/// "takeoff"|"land"|"near", "before_airborne": bool|null, "was_inside"?,
/// "airborne": bool|null, "arrived"?, "plane": {lat, lon}|null, "to":
/// {lat, lon}|null, "limit_nm"?}`.
pub(super) fn fires_rule(v: &Value) -> Result<String, String> {
    let n = "alert_fires";
    let kind = match v.get("kind").and_then(Value::as_str) {
        Some("takeoff") => Kind::TakeOff,
        Some("land") => Kind::Land,
        Some("near") => Kind::Near,
        other => return Err(format!("{n}: \"kind\" is \"takeoff\", \"land\" or \"near\", not {other:?}")),
    };
    let f = fires(
        kind,
        opt_bool(n, v, "before_airborne")?,
        opt_bool(n, v, "was_inside")?.unwrap_or(false),
        opt_bool(n, v, "airborne")?,
        opt_bool(n, v, "arrived")?.unwrap_or(false),
        place(n, v, "plane")?,
        place(n, v, "to")?,
        opt(n, v, "limit_nm")?.unwrap_or(0.0),
    );
    let mut out = String::from("{\"fires\":");
    out.push_str(if f.fires { "true" } else { "false" });
    out.push_str(",\"inside\":");
    out.push_str(match f.inside {
        None => "null",
        Some(true) => "true",
        Some(false) => "false",
    });
    out.push_str(",\"nm\":");
    json::opt_number(&mut out, f.nm);
    out.push_str(",\"bearing_deg\":");
    json::opt_number(&mut out, f.bearing_deg);
    out.push('}');
    Ok(out)
}
