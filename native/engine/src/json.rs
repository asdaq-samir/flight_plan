//! The little JSON the engine writes for the phones (crate::phone): no
//! parser, no dependency, the planner's own field names.

/// A string, quoted and escaped (RFC 8259, section 7).
pub fn string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

/// A number as Python's json writes a float: the shortest that reads
/// back the same, with a ".0" on a whole one. Not a number is null.
pub fn number(out: &mut String, v: f64) {
    if !v.is_finite() {
        out.push_str("null");
    } else {
        out.push_str(&format!("{v:?}"));
    }
}

pub fn opt_number(out: &mut String, v: Option<f64>) {
    match v {
        Some(v) => number(out, v),
        None => out.push_str("null"),
    }
}

pub fn opt_string(out: &mut String, s: Option<&str>) {
    match s {
        Some(s) => string(out, s),
        None => out.push_str("null"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn written_as_python_writes_it() {
        let mut out = String::new();
        number(&mut out, 500.0);
        out.push(' ');
        number(&mut out, 1234.5);
        out.push(' ');
        string(&mut out, "O'Hare \"B\"\n");
        assert_eq!(out, "500.0 1234.5 \"O'Hare \\\"B\\\"\\n\"");
    }
}
