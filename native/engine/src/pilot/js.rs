//! JavaScript's reading of text and numbers, which the pilot's records
//! were first written in (the web app's lib/checklist, lib/logbookCsv,
//! lib/handbookText, lib/checkride): what `\s` and trim() take as space,
//! Number() and parseInt() of a cell, Math.round, a number written as
//! String(n) writes it, and lengths in UTF-16 code units, as the gateway
//! (Java) counts its limits. Kept here so the engine reads a pasted
//! checklist or a logbook file to the character as the web app did.

/// JavaScript's white space and line terminators (ECMA-262 WhiteSpace and
/// LineTerminator), what `\s` matches and trim() takes off: Unicode's
/// White_Space without U+0085, and the byte order mark.
pub fn is_space(c: char) -> bool {
    (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}'
}

/// String.prototype.trim.
pub fn trim(s: &str) -> &str {
    s.trim_matches(is_space)
}

/// A regular expression's `\w` without the u flag: [A-Za-z0-9_].
pub fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// Whether `\b` holds between `chars[i - 1]` and `chars[i]`.
pub fn boundary(chars: &[char], i: usize) -> bool {
    let before = i > 0 && is_word(chars[i - 1]);
    let after = i < chars.len() && is_word(chars[i]);
    before != after
}

/// The first `units` UTF-16 code units of `s`, as String.prototype.slice
/// (0, units) cuts it. Where the cut would fall inside a surrogate pair
/// the pair is left out whole: JavaScript would keep its lone first half,
/// which no Rust string (and no well-formed JSON text) can hold.
pub fn slice_units(s: &str, units: usize) -> &str {
    let mut used = 0;
    for (i, c) in s.char_indices() {
        used += c.len_utf16();
        if used > units {
            return &s[..i];
        }
    }
    s
}

/// The length of `s` in UTF-16 code units, JavaScript's `.length`.
pub fn units(s: &str) -> usize {
    s.chars().map(char::len_utf16).sum()
}

/// Math.round: the nearest whole number, a half toward +infinity.
pub fn round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let down = x.floor();
    if x - down >= 0.5 {
        down + 1.0
    } else {
        down
    }
}

/// Number(s) of a string (ECMA-262 StringToNumber): its spaces trimmed,
/// empty as 0, a decimal literal with an optional sign and exponent,
/// "Infinity", or a 0x/0o/0b whole number; anything else NaN.
pub fn number(s: &str) -> f64 {
    let t = trim(s);
    if t.is_empty() {
        return 0.0;
    }
    let b = t.as_bytes();
    if b.len() > 2 && b[0] == b'0' {
        let radix = match b[1] {
            b'x' | b'X' => 16,
            b'o' | b'O' => 8,
            b'b' | b'B' => 2,
            _ => 0,
        };
        if radix != 0 {
            let mut v = 0.0f64;
            for &d in &b[2..] {
                match (d as char).to_digit(radix) {
                    Some(d) => v = v * radix as f64 + d as f64,
                    None => return f64::NAN,
                }
            }
            return v;
        }
    }
    let (sign, rest) = match b[0] {
        b'+' => (1.0, &t[1..]),
        b'-' => (-1.0, &t[1..]),
        _ => (1.0, t),
    };
    if rest == "Infinity" {
        return sign * f64::INFINITY;
    }
    // [digits][.digits][(e|E)[+-]digits], with a digit before or after the point.
    let r = rest.as_bytes();
    let mut i = 0;
    let int_digits = r.iter().take_while(|c| c.is_ascii_digit()).count();
    i += int_digits;
    let mut frac_digits = 0;
    if r.get(i) == Some(&b'.') {
        i += 1;
        frac_digits = r[i..].iter().take_while(|c| c.is_ascii_digit()).count();
        i += frac_digits;
    }
    if int_digits + frac_digits == 0 {
        return f64::NAN;
    }
    if matches!(r.get(i), Some(b'e' | b'E')) {
        let mut j = i + 1;
        if matches!(r.get(j), Some(b'+' | b'-')) {
            j += 1;
        }
        let exp_digits = r[j.min(r.len())..].iter().take_while(|c| c.is_ascii_digit()).count();
        if exp_digits == 0 {
            return f64::NAN;
        }
        i = j + exp_digits;
    }
    if i != r.len() {
        return f64::NAN;
    }
    // Rust reads "5." and ".5" as JavaScript does, correctly rounded.
    sign * rest.parse::<f64>().unwrap_or(f64::NAN)
}

/// Number.parseInt(s, 10): leading space skipped, a sign, then as many
/// decimal digits as there are; NaN where there are none.
pub fn parse_int(s: &str) -> f64 {
    let t = s.trim_start_matches(is_space);
    let (sign, rest) = match t.as_bytes().first() {
        Some(b'+') => (1.0, &t[1..]),
        Some(b'-') => (-1.0, &t[1..]),
        _ => (1.0, t),
    };
    let digits: &str = &rest[..rest.bytes().take_while(u8::is_ascii_digit).count()];
    if digits.is_empty() {
        return f64::NAN;
    }
    sign * digits.parse::<f64>().unwrap_or(f64::NAN)
}

/// String(n): Number.prototype.toString's shortest digits that read back
/// the same, plainly from 1e-6 up to 1e21 and with an exponent beyond.
pub fn number_string(x: f64) -> String {
    if x.is_nan() {
        return "NaN".to_owned();
    }
    if x == 0.0 {
        return "0".to_owned();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity" } else { "-Infinity" }.to_owned();
    }
    if x < 0.0 {
        return format!("-{}", number_string(-x));
    }
    // Rust's {:e} is the shortest round trip too: "1.2345e3", "5e-7".
    let e = format!("{x:e}");
    let (mantissa, exp) = e.split_once('e').unwrap_or((&e, "0"));
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i64;
    let n = exp.parse::<i64>().unwrap_or(0) + 1;
    if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let sign = if n - 1 < 0 { '-' } else { '+' };
        let first = &digits[..1];
        let rest = &digits[1..];
        if rest.is_empty() {
            format!("{first}e{sign}{}", (n - 1).abs())
        } else {
            format!("{first}.{rest}e{sign}{}", (n - 1).abs())
        }
    }
}

/// Whether the text at `chars[i..]` starts with `word`, ASCII letters in
/// either case (a regular expression's i flag without u: only ASCII folds
/// to ASCII).
pub fn starts_ci(chars: &[char], i: usize, word: &str) -> bool {
    let mut j = i;
    for w in word.chars() {
        match chars.get(j) {
            Some(c) if c.eq_ignore_ascii_case(&w) => j += 1,
            _ => return false,
        }
    }
    true
}

/// Whether `word` is in the text anywhere, ASCII letters in either case.
pub fn contains_ci(chars: &[char], word: &str) -> bool {
    (0..chars.len()).any(|i| starts_ci(chars, i, word))
}

/// Whether `word` stands in the text as a whole word (`\bword\b`), ASCII
/// letters in either case.
pub fn has_word_ci(chars: &[char], word: &str) -> bool {
    let n = word.chars().count();
    (0..chars.len()).any(|i| boundary(chars, i) && starts_ci(chars, i, word) && boundary(chars, i + n))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_as_javascript_reads_and_writes_them() {
        for (s, n) in [("", 0.0), (" 12 ", 12.0), ("1e3", 1000.0), (".5", 0.5), ("5.", 5.0), ("+3", 3.0), ("0x10", 16.0), ("0b11", 3.0)] {
            assert_eq!(number(s), n, "{s:?}");
        }
        for s in ["x", "1.2.3", "1e", "-0x10", "inf", "NaN", ".", "1_000", "e5"] {
            assert!(number(s).is_nan(), "{s:?}");
        }
        assert_eq!(number("-Infinity"), f64::NEG_INFINITY);
        assert_eq!(parse_int(" +3abc"), 3.0);
        assert!(parse_int("abc").is_nan());
        assert_eq!(number_string(1500.0), "1500");
        assert_eq!(number_string(0.1 + 0.2), "0.30000000000000004");
        assert_eq!(number_string(1e21), "1e+21");
        assert_eq!(number_string(1e-7), "1e-7");
        assert_eq!(number_string(1.5e-7), "1.5e-7");
        assert_eq!(number_string(123456789.123), "123456789.123");
        assert_eq!(number_string(0.000001), "0.000001");
        assert_eq!(number_string(-2.0), "-2");
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(-2.5), -2.0);
        assert_eq!(round(0.49999999999999994), 0.0);
    }

    #[test]
    fn text_as_javascript_cuts_it() {
        assert_eq!(trim("\u{feff}\u{a0} a \u{2028}"), "a");
        assert_eq!(trim("\u{85}a"), "\u{85}a");
        assert_eq!(slice_units("ab😀c", 3), "ab");
        assert_eq!(slice_units("ab😀c", 4), "ab😀");
        assert_eq!(units("😀"), 2);
    }
}
