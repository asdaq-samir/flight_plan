//! The route's own pilot-made pieces, as the web app's address writes
//! them and the planner's query reads them (PlanQuery): the pilot's own
//! point off a fix and a fix's ident (`points`), the holds put on the
//! route's points (`holds`), and the instrument procedures and runways
//! picked at its fields (`picks`).
//!
//! Each is read at three boundaries -- the web app's address, the
//! planner's query, the iPhone's route -- and each boundary still decides
//! what to do with a piece it cannot read: the web app leaves it out, the
//! planner answers a 422 naming it. What a piece is, though, is said once,
//! here: every boundary asks the engine (crate::call) whether a piece is
//! one and what it says.

pub mod answers;
pub mod holds;
pub mod picks;
pub mod points;

/// Python's str.strip(): its whitespace is Unicode's White_Space, which
/// Rust's trim takes, and the four separators \x1c to \x1f besides. The
/// planner strips every piece of its query so; JavaScript's trim takes
/// White_Space and the byte-order mark, and leaves those four.
pub fn trim(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || ('\x1c'..='\x1f').contains(&c))
}

/// A piece trimmed and uppercased, as both the address and the planner
/// read one: "kdlh " is KDLH.
pub fn normal(s: &str) -> String {
    upper(trim(s))
}

/// Uppercased as JavaScript's toUpperCase and Python's upper() have it,
/// for every letter that comes out a letter the pieces' forms take: the
/// ASCII ones, the dotless i, the long s and the Latin ligatures (U+FB00
/// to U+FB06), which Unicode uppercases to plain ASCII. Every other letter
/// is kept as it is: no form here takes it, uppercased or not, and
/// Unicode's whole table was 17 KB of the engine's WebAssembly.
pub fn upper(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\u{131}' => out.push('I'),
            '\u{17F}' => out.push('S'),
            '\u{FB00}' => out.push_str("FF"),
            '\u{FB01}' => out.push_str("FI"),
            '\u{FB02}' => out.push_str("FL"),
            '\u{FB03}' => out.push_str("FFI"),
            '\u{FB04}' => out.push_str("FFL"),
            '\u{FB05}' | '\u{FB06}' => out.push_str("ST"),
            c => out.push(c.to_ascii_uppercase()),
        }
    }
    out
}

/// `s` is `min..=max` of the ASCII bytes `ok` takes.
pub(crate) fn all(s: &str, min: usize, max: usize, ok: impl Fn(u8) -> bool) -> bool {
    (min..=max).contains(&s.len()) && s.bytes().all(ok)
}

pub(crate) fn upper_alnum(c: u8) -> bool {
    c.is_ascii_uppercase() || c.is_ascii_digit()
}

/// A number as JavaScript's String(n) writes it, which the address is
/// written with: "1", "1.5", "30". Rust's Display is the shortest that
/// reads back the same, as JavaScript's is, short of the exponents
/// neither a leg nor a distance comes near.
pub fn js_string(n: f64) -> String {
    if n == 0.0 {
        "0".to_owned()
    } else {
        format!("{n}")
    }
}
