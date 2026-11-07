//! How a figure is written in the pages' words, as the web app writes it
//! (lib/units, features/plan/format) and app.gonogo.words has it:
//! JavaScript's rounding and its numbers in text, not Rust's or Python's,
//! so a figure reads the same on every screen.

use crate::geo::py_mod;

/// JavaScript's Math.round: halves up, toward +infinity (words.js_round).
/// Not floor(n + 0.5), whose sum rounds 0.49999999999999994 up to 1.
pub fn js_round(n: f64) -> i64 {
    js_round_f(n) as i64
}

/// Math.round as a double, for figures past an i64's reach.
pub fn js_round_f(n: f64) -> f64 {
    let floor = n.floor();
    if n - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    }
}

/// To a tenth, as lib/verdict's `one`: Math.round(n * 10) / 10.
pub fn one(n: f64) -> f64 {
    js_round_f(n * 10.0) / 10.0
}

/// A number as JavaScript writes it into a string (Number's toString, a
/// template literal's `${n}`): 28 for 28.0, 2.3, 0.00001; an exponent
/// below a millionth and from 1e21, "1e-7", "1.5e+21"; -0 as "0".
pub fn js_num(n: f64) -> String {
    if n.is_nan() {
        return "NaN".to_owned();
    }
    if n.is_infinite() {
        return if n > 0.0 { "Infinity" } else { "-Infinity" }.to_owned();
    }
    if n == 0.0 {
        return "0".to_owned();
    }
    let magnitude = n.abs();
    if (1e-6..1e21).contains(&magnitude) {
        // Rust's Display is the shortest digits that read back the same,
        // never with an exponent: JavaScript's, in this range.
        return format!("{n}");
    }
    let e = format!("{n:e}");
    match e.split_once('e') {
        Some((mantissa, exp)) if !exp.starts_with('-') => format!("{mantissa}e+{exp}"),
        _ => e,
    }
}

/// An optional number in a template literal: "null" for none.
pub fn js_opt(n: Option<f64>) -> String {
    n.map_or_else(|| "null".to_owned(), js_num)
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
    let magnitude = js_round_f(n.abs());
    // The whole number's exact digits, past a u64's reach too (1e21 is
    // 22 figures, as toLocaleString writes them).
    let plain = format!("{magnitude:.0}");
    let mut digits = String::new();
    for (i, c) in plain.chars().enumerate() {
        if i > 0 && (plain.len() - i) % 3 == 0 {
            digits.push(',');
        }
        digits.push(c);
    }
    if n < 0.0 && magnitude > 0.0 {
        format!("-{digits}")
    } else {
        digits
    }
}

/// "12,500"; an em dash for none (lib/units altFt).
pub fn alt_ft(ft: Option<f64>) -> String {
    ft.map_or_else(|| "—".to_owned(), grouped)
}

/// The same with its unit, "12,500 ft" (lib/units feet).
pub fn feet(ft: f64) -> String {
    format!("{} ft", grouped(ft))
}

/// Pounds, "2,550 lb" (lib/units pounds).
pub fn pounds(lb: f64) -> String {
    format!("{} lb", grouped(lb))
}

/// A cruising altitude as the owner asked it written, hundreds of feet in
/// three figures: "FL-045" for 4,500 ft, "FL-___" with none yet (lib/units
/// flightLevel; the owner, 2026-10-27: "make it in the format FL-***", and
/// 2026-11-04: "FL should have three underscores").
/// The figures padded as String(n).padStart(3, "0") pads them, a minus
/// sign and all.
pub fn flight_level(ft: Option<f64>) -> String {
    match ft {
        None => "FL-___".to_owned(),
        Some(ft) => {
            let hundreds = js_num(js_round_f(ft / 100.0));
            format!("FL-{}{hundreds}", "0".repeat(3usize.saturating_sub(hundreds.chars().count())))
        }
    }
}

/// Ceiling and visibility the way a briefer says them, "3,500 ft · 6 sm",
/// "no ceiling · —" (features/plan/format ceilingAndVisibility).
pub fn ceiling_and_visibility(ceiling_ft: Option<f64>, visibility_sm: Option<f64>) -> String {
    let ceiling = ceiling_ft.map_or_else(|| "no ceiling".to_owned(), |ft| format!("{} ft", alt_ft(Some(ft))));
    let visibility = visibility_sm.map_or_else(|| "—".to_owned(), |sm| format!("{} sm", js_num(sm)));
    format!("{ceiling} · {visibility}")
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
