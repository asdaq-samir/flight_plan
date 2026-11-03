//! The little JSON the engine writes for the phones (crate::phone), with
//! the planner's own field names; a phone pack's place tables
//! (crate::spoken), `{"columns": [...], "rows": [[...], ...]}` of
//! strings, as vfr.pack writes them; and any JSON value (`parse`), which
//! is how every host asks the engine a rule by name (crate::call). No
//! dependency, so the engine stays plain std for the phones and the web.

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

/// Any value written back as JSON: an object's members in their order,
/// numbers as `number` writes them.
pub fn value(out: &mut String, v: &Value) {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => number(out, *n),
        Value::String(s) => string(out, s),
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                value(out, item);
            }
            out.push(']');
        }
        Value::Object(members) => {
            out.push('{');
            for (i, (k, item)) in members.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                string(out, k);
                out.push(':');
                value(out, item);
            }
            out.push('}');
        }
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

/// A JSON value as read (RFC 8259): numbers as f64, the way JavaScript
/// and Python's json read them; an object's members in their order.
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    /// The member `key` of an object; None where it is missing, or this is
    /// not an object.
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Object(members) => members.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Value::Number(n) => Some(*n),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::String(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&[Value]> {
        match self {
            Value::Array(items) => Some(items),
            _ => None,
        }
    }
}

/// How deep arrays and objects may nest: far past any rule's input, and
/// short of the stack a phone's or a browser's thread has, so a hostile
/// `[[[[...` is an error rather than a crash.
const MAX_DEPTH: usize = 64;

impl Reader<'_> {
    fn fail<T>(&self, what: &str) -> Result<T, String> {
        Err(format!("JSON: {what} at byte {}", self.at))
    }

    fn value(&mut self, depth: usize) -> Result<Value, String> {
        if depth > MAX_DEPTH {
            return self.fail("nested too deep");
        }
        match self.peek() {
            None => self.fail("a value expected, the text ended"),
            Some(b'{') => {
                self.at += 1;
                let mut members = Vec::new();
                if self.eat(b'}').is_some() {
                    return Ok(Value::Object(members));
                }
                loop {
                    if self.peek() != Some(b'"') {
                        return self.fail("a member's name expected");
                    }
                    let Some(key) = self.string() else { return self.fail("a bad string") };
                    if self.eat(b':').is_none() {
                        return self.fail("':' expected");
                    }
                    let v = self.value(depth + 1)?;
                    members.push((key, v));
                    if self.eat(b',').is_none() {
                        return match self.eat(b'}') {
                            Some(()) => Ok(Value::Object(members)),
                            None => self.fail("',' or '}' expected"),
                        };
                    }
                }
            }
            Some(b'[') => {
                self.at += 1;
                let mut items = Vec::new();
                if self.eat(b']').is_some() {
                    return Ok(Value::Array(items));
                }
                loop {
                    items.push(self.value(depth + 1)?);
                    if self.eat(b',').is_none() {
                        return match self.eat(b']') {
                            Some(()) => Ok(Value::Array(items)),
                            None => self.fail("',' or ']' expected"),
                        };
                    }
                }
            }
            Some(b'"') => match self.string() {
                Some(s) => Ok(Value::String(s)),
                None => self.fail("a bad string"),
            },
            Some(b't') => self.word("true", Value::Bool(true)),
            Some(b'f') => self.word("false", Value::Bool(false)),
            Some(b'n') => self.word("null", Value::Null),
            Some(c) if c == b'-' || c.is_ascii_digit() => {
                let start = self.at;
                self.at += 1;
                while self.b.get(self.at).is_some_and(|c| c.is_ascii_digit() || b"+-.eE".contains(c)) {
                    self.at += 1;
                }
                // Rust's parse is correctly rounded, as JavaScript's and
                // Python's are, so a figure crosses to the bit. It takes
                // "inf" and "NaN" too, which never get here: only a digit
                // or a minus starts a number.
                let text = std::str::from_utf8(&self.b[start..self.at]).unwrap_or("");
                match text.parse::<f64>() {
                    Ok(n) if n.is_finite() => Ok(Value::Number(n)),
                    _ => {
                        self.at = start;
                        self.fail("a bad number")
                    }
                }
            }
            Some(_) => self.fail("a value expected"),
        }
    }

    fn word(&mut self, word: &str, v: Value) -> Result<Value, String> {
        if self.b[self.at..].starts_with(word.as_bytes()) {
            self.at += word.len();
            Ok(v)
        } else {
            self.fail("a value expected")
        }
    }
}

/// Any JSON text read into its value; Err with what was wrong and where.
/// Nothing but space may follow the value.
pub fn parse(text: &str) -> Result<Value, String> {
    let mut r = Reader { b: text.as_bytes(), at: 0 };
    let v = r.value(0)?;
    r.space();
    if r.at < r.b.len() {
        return r.fail("text after the value");
    }
    Ok(v)
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

    #[test]
    fn any_value_is_read() {
        let v = parse(r#" {"a": [1, -2.5e3, true, false, null], "s": "x\"\u00e9\ud83d\ude00", "o": {}} "#).unwrap();
        assert_eq!(
            v.get("a"),
            Some(&Value::Array(vec![Value::Number(1.0), Value::Number(-2500.0), Value::Bool(true), Value::Bool(false), Value::Null]))
        );
        assert_eq!(v.get("s").and_then(Value::as_str), Some("x\"\u{e9}\u{1F600}"));
        assert_eq!(v.get("o"), Some(&Value::Object(vec![])));
        // The shortest text that reads back the same, read back to the bit.
        assert_eq!(parse("0.1").unwrap(), Value::Number(0.1));
        assert_eq!(parse("1759417200000").unwrap(), Value::Number(1_759_417_200_000.0));
    }

    #[test]
    fn bad_json_says_where() {
        for bad in ["", "{", "[1,]", "{\"a\" 1}", "{a: 1}", "tru", "1 2", "\"open", "NaN", "-", "1e999", "[1] x"] {
            assert!(parse(bad).is_err(), "{bad:?} read");
        }
        assert_eq!(parse("{\"a\": x}").unwrap_err(), "JSON: a value expected at byte 6");
        let deep = "[".repeat(100) + &"]".repeat(100);
        assert!(parse(&deep).unwrap_err().contains("nested too deep"));
    }
}
