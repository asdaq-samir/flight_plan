//! The little JSON the engine writes for the phones (crate::phone), with
//! the planner's own field names, and the one shape it reads: a phone
//! pack's place tables (crate::spoken), `{"columns": [...], "rows":
//! [[...], ...]}` of strings, as vfr.pack writes them. No dependency.

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

/// A phone pack's table: its columns, and each row's cells as strings.
pub struct Table {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

impl Table {
    pub fn col(&self, name: &str) -> Option<usize> {
        self.columns.iter().position(|c| c == name)
    }
}

struct Reader<'a> {
    b: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn space(&mut self) {
        while self.b.get(self.at).is_some_and(|c| c.is_ascii_whitespace()) {
            self.at += 1;
        }
    }

    fn eat(&mut self, c: u8) -> Option<()> {
        self.space();
        (self.b.get(self.at) == Some(&c)).then(|| self.at += 1)
    }

    fn peek(&mut self) -> Option<u8> {
        self.space();
        self.b.get(self.at).copied()
    }

    /// A string, or a number or null as its text ("" for null).
    fn cell(&mut self) -> Option<String> {
        match self.peek()? {
            b'"' => self.string(),
            b'n' => {
                self.at += 4;
                Some(String::new())
            }
            _ => {
                let start = self.at;
                while self.b.get(self.at).is_some_and(|c| c.is_ascii_digit() || b"+-.eE".contains(c)) {
                    self.at += 1;
                }
                std::str::from_utf8(&self.b[start..self.at]).ok().map(str::to_owned)
            }
        }
    }

    fn string(&mut self) -> Option<String> {
        self.eat(b'"')?;
        let mut out = Vec::new();
        loop {
            let c = *self.b.get(self.at)?;
            self.at += 1;
            match c {
                b'"' => return String::from_utf8(out).ok(),
                b'\\' => {
                    let e = *self.b.get(self.at)?;
                    self.at += 1;
                    match e {
                        b'n' => out.push(b'\n'),
                        b't' => out.push(b'\t'),
                        b'r' => out.push(b'\r'),
                        b'b' => out.push(8),
                        b'f' => out.push(12),
                        b'u' => {
                            let hex = std::str::from_utf8(self.b.get(self.at..self.at + 4)?).ok()?;
                            self.at += 4;
                            let mut code = u32::from_str_radix(hex, 16).ok()?;
                            // A surrogate pair, as Python's json escapes one.
                            if (0xD800..0xDC00).contains(&code) && self.b.get(self.at..self.at + 2) == Some(&b"\\u"[..]) {
                                let low = u32::from_str_radix(std::str::from_utf8(self.b.get(self.at + 2..self.at + 6)?).ok()?, 16).ok()?;
                                self.at += 6;
                                code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
                            }
                            let mut buf = [0u8; 4];
                            out.extend_from_slice(char::from_u32(code)?.encode_utf8(&mut buf).as_bytes());
                        }
                        other => out.push(other),
                    }
                }
                c => out.push(c),
            }
        }
    }

    fn cells(&mut self) -> Option<Vec<String>> {
        self.eat(b'[')?;
        let mut out = Vec::new();
        if self.eat(b']').is_some() {
            return Some(out);
        }
        loop {
            out.push(self.cell()?);
            if self.eat(b',').is_none() {
                self.eat(b']')?;
                return Some(out);
            }
        }
    }
}

/// A pack's table, `{"columns": [...], "rows": [[...], ...]}`; None where
/// the text is not one.
pub fn table(text: &str) -> Option<Table> {
    let mut r = Reader { b: text.as_bytes(), at: 0 };
    r.eat(b'{')?;
    let (mut columns, mut rows) = (None, None);
    loop {
        let key = r.string()?;
        r.eat(b':')?;
        if key == "columns" {
            columns = Some(r.cells()?);
        } else if key == "rows" {
            r.eat(b'[')?;
            let mut all = Vec::new();
            if r.eat(b']').is_none() {
                loop {
                    all.push(r.cells()?);
                    if r.eat(b',').is_none() {
                        r.eat(b']')?;
                        break;
                    }
                }
            }
            rows = Some(all);
        } else {
            return None;
        }
        if r.eat(b',').is_none() {
            r.eat(b'}')?;
            break;
        }
    }
    Some(Table { columns: columns?, rows: rows? })
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

    #[test]
    fn a_packs_table_is_read() {
        let t = table(r#"{"columns": ["NAV_ID", "NAME"], "rows": [["GEP", "GOPHER"], ["X", "O\u2019HARE \"B\""], []]}"#).unwrap();
        assert_eq!(t.columns, vec!["NAV_ID", "NAME"]);
        assert_eq!(t.rows[1], vec!["X", "O\u{2019}HARE \"B\""]);
        assert_eq!(t.col("NAME"), Some(1));
        assert!(table("[1]").is_none());
    }
}
