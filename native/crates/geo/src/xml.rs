//! A small, strict XML reader for the FAA's and the NWS's files -- a TFR's
//! XNOTAM, an FNS NOTAM message, the aviation weather caches -- with no
//! crate: elements, their attributes and text, the five named entities
//! and character references, CDATA, comments and declarations skipped.
//! Names keep only their local part ("event:NOTAM" is "NOTAM"), which is
//! how the files are read here. Anything malformed is an error, never a
//! guess: an unclosed or mismatched tag, a stray '<', an unknown entity.

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Element {
    pub name: String,
    pub attributes: Vec<(String, String)>,
    pub children: Vec<Element>,
    /// The element's own text, its pieces joined (between its children too).
    pub text: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct XmlError {
    pub at: usize,
    pub what: &'static str,
}

impl Element {
    /// The first child with this local name.
    pub fn child(&self, name: &str) -> Option<&Element> {
        self.children.iter().find(|c| c.name == name)
    }

    /// The children with this local name.
    pub fn all<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Element> + 'a {
        self.children.iter().filter(move |c| c.name == name)
    }

    /// A path of local names down from here, the first match at each step.
    pub fn find(&self, path: &[&str]) -> Option<&Element> {
        path.iter().try_fold(self, |at, name| at.child(name))
    }

    /// The text at a path, as ElementTree's findtext: None where there is
    /// no such element, its text (perhaps empty) where there is.
    pub fn text_at(&self, path: &[&str]) -> Option<&str> {
        self.find(path).map(|e| e.text.as_str())
    }

    pub fn attribute(&self, name: &str) -> Option<&str> {
        self.attributes.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }

    /// Every element by this local name, document order.
    pub fn iter_named<'a>(&'a self, name: &'a str) -> Vec<&'a Element> {
        let mut out = Vec::new();
        fn walk<'a>(e: &'a Element, name: &str, out: &mut Vec<&'a Element>) {
            if e.name == name {
                out.push(e);
            }
            for c in &e.children {
                walk(c, name, out);
            }
        }
        walk(self, name, &mut out);
        out
    }

    /// All the text under this element, its children's after its own
    /// (ElementTree's itertext for an element whose text is one piece).
    pub fn all_text(&self) -> String {
        let mut out = self.text.clone();
        for c in &self.children {
            out.push_str(&c.all_text());
        }
        out
    }
}

fn local(name: &str) -> &str {
    name.rsplit(':').next().unwrap_or(name)
}

struct Reader<'a> {
    s: &'a str,
    at: usize,
}

impl<'a> Reader<'a> {
    fn err<T>(&self, what: &'static str) -> Result<T, XmlError> {
        Err(XmlError { at: self.at, what })
    }

    fn rest(&self) -> &'a str {
        &self.s[self.at..]
    }

    fn skip_until(&mut self, end: &str, what: &'static str) -> Result<(), XmlError> {
        match self.rest().find(end) {
            Some(i) => {
                self.at += i + end.len();
                Ok(())
            }
            None => self.err(what),
        }
    }

    fn name(&mut self) -> Result<&'a str, XmlError> {
        let start = self.at;
        for (i, c) in self.rest().char_indices() {
            if c.is_whitespace() || c == '>' || c == '/' || c == '=' {
                if i == 0 {
                    return self.err("a name");
                }
                self.at = start + i;
                return Ok(&self.s[start..start + i]);
            }
        }
        self.err("the end of a name")
    }

    fn spaces(&mut self) {
        let skipped = self.rest().len() - self.rest().trim_start().len();
        self.at += skipped;
    }
}

/// Text with its entities and character references turned back.
pub fn unescape(raw: &str) -> Result<String, &'static str> {
    if !raw.contains('&') {
        return Ok(raw.to_string());
    }
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        let end = after.find(';').ok_or("an entity's ';'")?;
        let entity = &after[..end];
        let c = match entity {
            "lt" => '<',
            "gt" => '>',
            "amp" => '&',
            "quot" => '"',
            "apos" => '\'',
            e if e.starts_with("#x") || e.starts_with("#X") => {
                char::from_u32(u32::from_str_radix(&e[2..], 16).map_err(|_| "a character reference")?).ok_or("a character")?
            }
            e if e.starts_with('#') => char::from_u32(e[1..].parse().map_err(|_| "a character reference")?).ok_or("a character")?,
            _ => return Err("an entity XML names"),
        };
        out.push(c);
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

/// The document's root element.
pub fn parse(text: &str) -> Result<Element, XmlError> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut r = Reader { s: text, at: 0 };
    let mut stack: Vec<Element> = Vec::new();
    let mut root: Option<Element> = None;
    while r.at < r.s.len() {
        let rest = r.rest();
        let Some(lt) = rest.find('<') else {
            if !stack.is_empty() {
                return r.err("the end of an element");
            }
            if !rest.trim().is_empty() {
                return r.err("nothing after the root");
            }
            break;
        };
        if lt > 0 {
            let piece = &rest[..lt];
            match stack.last_mut() {
                Some(top) => top.text.push_str(&unescape(piece).map_err(|what| XmlError { at: r.at, what })?),
                None if piece.trim().is_empty() => {}
                None => return r.err("text outside the root"),
            }
            r.at += lt;
        }
        let rest = r.rest();
        if rest.starts_with("<!--") {
            r.skip_until("-->", "a comment's end")?;
        } else if rest.starts_with("<![CDATA[") {
            let start = r.at + 9;
            r.skip_until("]]>", "a CDATA's end")?;
            let piece = &r.s[start..r.at - 3];
            match stack.last_mut() {
                Some(top) => top.text.push_str(piece),
                None => return r.err("CDATA outside the root"),
            }
        } else if rest.starts_with("<?") {
            r.skip_until("?>", "a declaration's end")?;
        } else if rest.starts_with("<!") {
            r.skip_until(">", "a doctype's end")?;
        } else if rest.starts_with("</") {
            r.at += 2;
            let name = local(r.name()?).to_string();
            r.spaces();
            if !r.rest().starts_with('>') {
                return r.err("a closing tag's '>'");
            }
            r.at += 1;
            let Some(done) = stack.pop() else { return r.err("an opening tag for this one") };
            if done.name != name {
                return r.err("the tag that was opened");
            }
            match stack.last_mut() {
                Some(parent) => parent.children.push(done),
                None if root.is_none() => root = Some(done),
                None => return r.err("one root"),
            }
        } else {
            r.at += 1;
            let mut e = Element { name: local(r.name()?).to_string(), ..Default::default() };
            loop {
                r.spaces();
                let rest = r.rest();
                if rest.starts_with("/>") {
                    r.at += 2;
                    match stack.last_mut() {
                        Some(parent) => parent.children.push(e),
                        None if root.is_none() => root = Some(e),
                        None => return r.err("one root"),
                    }
                    break;
                }
                if rest.starts_with('>') {
                    r.at += 1;
                    stack.push(e);
                    break;
                }
                let key = r.name()?;
                r.spaces();
                if !r.rest().starts_with('=') {
                    return r.err("an attribute's '='");
                }
                r.at += 1;
                r.spaces();
                let quote = match r.rest().chars().next() {
                    Some(q @ ('"' | '\'')) => q,
                    _ => return r.err("a quoted value"),
                };
                r.at += 1;
                let Some(end) = r.rest().find(quote) else { return r.err("a value's closing quote") };
                let value = unescape(&r.rest()[..end]).map_err(|what| XmlError { at: r.at, what })?;
                r.at += end + 1;
                // Namespace declarations say nothing these files are read for.
                if key != "xmlns" && !key.starts_with("xmlns:") {
                    e.attributes.push((local(key).to_string(), value));
                }
            }
        }
    }
    match (root, stack.is_empty()) {
        (Some(root), true) => Ok(root),
        (_, false) => Err(XmlError { at: r.at, what: "the end of an element" }),
        (None, true) => Err(XmlError { at: r.at, what: "a root element" }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_elements_attributes_text_and_entities() {
        let doc = parse("\u{feff}<?xml version=\"1.0\"?><!-- c --><a:root xmlns:a=\"x\"><b k='v &amp; w'>1 &lt; 2</b><c/><d><![CDATA[<pre>]]></d></a:root>").unwrap();
        assert_eq!(doc.name, "root");
        assert_eq!(doc.text_at(&["b"]), Some("1 < 2"));
        assert_eq!(doc.child("b").unwrap().attribute("k"), Some("v & w"));
        assert_eq!(doc.text_at(&["c"]), Some(""));
        assert_eq!(doc.text_at(&["d"]), Some("<pre>"));
        assert_eq!(doc.text_at(&["e"]), None);
    }

    #[test]
    fn refuses_what_is_not_xml() {
        for bad in ["<a><b></a>", "<a>", "<a></a><b/>", "<a>&bogus;</a>", "<a k=v/>", "text", "<a></a>trailing", ""] {
            assert!(parse(bad).is_err(), "{bad}");
        }
    }
}
