//! How a figure is written in the pages' words, as the web app writes it
//! (lib/units) and app.gonogo.words has it: JavaScript's rounding, not
//! Rust's or Python's, so a figure reads the same on every screen.

use crate::geo::py_mod;

/// JavaScript's Math.round: halves up, toward +infinity (words.js_round).
pub fn js_round(n: f64) -> i64 {
    (n + 0.5).floor() as i64
}

/// JavaScript's toFixed (words.to_fixed): the nearest, a tie to the
/// larger magnitude, on the float's exact value. Rust's own `{:.1}` takes
/// an exact tie (0.25) to the even one, so the exact digits are written
/// out -- a double's run out within 1,100 places -- and rounded here.
pub fn to_fixed(n: f64, digits: usize) -> String {
    let exact = format!("{:.1100}", n.abs());
    let point = exact.find('.').unwrap_or(exact.len());
    let mut kept: Vec<u8> = exact.as_bytes()[..point + 1 + digits].to_vec();
    if exact.as_bytes().get(point + 1 + digits).is_some_and(|d| *d >= b'5') {
        // Carry the one up through the kept figures, past the point.
        let mut i = kept.len();
        loop {
            if i == 0 {
                kept.insert(0, b'1');
                break;
            }
            i -= 1;
            match kept[i] {
                b'.' => continue,
                b'9' => kept[i] = b'0',
                d => {
                    kept[i] = d + 1;
                    break;
                }
            }
        }
    }
    if digits == 0 {
        kept.pop();
    }
    // Python's Decimal keeps the sign of a negative that rounds to nothing
    // ("-0.0"), as JavaScript's toFixed does.
    let sign = if n.is_sign_negative() { "-" } else { "" };
    format!("{sign}{}", String::from_utf8(kept).unwrap_or_default())
}

/// A whole number with a comma between each three figures, "12,500", as
/// the FAA writes altitudes (lib/units grouped): rounded on the
/// magnitude, halves away from zero.
pub fn grouped(n: f64) -> String {
    let magnitude = (n.abs() + 0.5).floor() as u64;
    let plain = magnitude.to_string();
    let mut digits = String::new();
    for (i, c) in plain.chars().enumerate() {
        if i > 0 && (plain.len() - i) % 3 == 0 {
            digits.push(',');
        }
        digits.push(c);
    }
    if n < 0.0 && magnitude > 0 {
        format!("-{digits}")
    } else {
        digits
    }
}

/// "12,500"; an em dash for none (lib/units altFt).
pub fn alt_ft(ft: Option<f64>) -> String {
    ft.map_or_else(|| "—".to_owned(), grouped)
}

/// A direction as a pilot writes it, "005°", north "360°" (lib/units
/// bearing).
pub fn bearing(deg: f64) -> String {
    let whole = js_round(deg).rem_euclid(360);
    format!("{:03}°", if whole == 0 { 360 } else { whole })
}

/// A correction signed, "+8°", "−3°" (a minus sign, not a hyphen), none
/// "0°" (lib/units windCorrection).
pub fn wind_correction(deg: f64) -> String {
    let shown = js_round(deg.abs());
    let sign = if shown == 0 { "" } else if deg > 0.0 { "+" } else { "−" };
    format!("{sign}{shown}°")
}

/// A direction 0 to 360 as the pages' own `(d % 360 + 360) % 360`.
pub fn norm360(deg: f64) -> f64 {
    py_mod(py_mod(deg, 360.0) + 360.0, 360.0)
}
