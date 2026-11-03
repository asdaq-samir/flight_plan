//! An airplane's checklist as the pilot writes it, in plain text: a line
//! starting "#" a section, every other line an item, its challenge and its
//! response split by a dash or a run of dots, as a printed checklist sets
//! them ("Fuel selector -- Both", "Mixture ..... Rich"). What the editor
//! shows and what it saves (the gateway's ChecklistDto). An item before
//! any section is in "Checklist". The gateway's limits are the text's: 40
//! characters a section's title, 80 a challenge or a response, counted in
//! UTF-16 code units as Java counts them. The app writes none of its own:
//! the flight manual's is the airplane's.
//!
//! The web app's lib/checklist, moved here whole.

use super::js;
use crate::json;

pub struct Item {
    pub challenge: String,
    pub response: Option<String>,
}

pub struct Section {
    pub title: String,
    pub items: Vec<Item>,
}

/// Where a challenge ends and its response begins, at `q`: the end of the
/// split there, as /\s+(?:-{1,2}|–|—|\.{2,})\s+|\s*\.{3,}\s*|\t+/ matches
/// -- a dash, two, an en or em dash or a run of dots with space either
/// side; three dots or more, spaced or not; or tabs.
fn split_at(c: &[char], q: usize) -> Option<usize> {
    let run = |from: usize, f: &dyn Fn(char) -> bool| c[from.min(c.len())..].iter().take_while(|&&x| f(x)).count();
    let spaces = |from: usize| run(from, &|x| js::is_space(x));
    // A mark between spaces: no shorter run of spaces or of marks leaves
    // a mark where a space must be, so only the longest can match.
    let lead = spaces(q);
    if lead > 0 {
        let p = q + lead;
        let mark = match c.get(p) {
            Some('-') => {
                let dashes = run(p, &|x| x == '-');
                (dashes <= 2).then_some(dashes)
            }
            Some('–' | '—') => Some(1),
            Some('.') => {
                let dots = run(p, &|x| x == '.');
                (dots >= 2).then_some(dots)
            }
            _ => None,
        };
        if let Some(m) = mark {
            let trail = spaces(p + m);
            if trail > 0 {
                return Some(p + m + trail);
            }
        }
    }
    // Three dots or more, with any space either side.
    let dots = run(q + lead, &|x| x == '.');
    if dots >= 3 {
        let end = q + lead + dots;
        return Some(end + spaces(end));
    }
    let tabs = run(q, &|x| x == '\t');
    (tabs > 0).then_some(q + tabs)
}

/// String.prototype.split by that pattern.
fn split(line: &str) -> Vec<String> {
    let c: Vec<char> = line.chars().collect();
    let mut parts = Vec::new();
    let (mut p, mut q) = (0, 0);
    while q < c.len() {
        match split_at(&c, q) {
            Some(e) => {
                parts.push(c[p..q].iter().collect());
                p = e;
                q = p;
            }
            None => q += 1,
        }
    }
    parts.push(c[p..].iter().collect());
    parts
}

/// The checklist in the text.
pub fn read(text: &str) -> Vec<Section> {
    let mut sections: Vec<Section> = Vec::new();
    // Lines end at "\n" or "\r\n" (/\r?\n/); a lone "\r" is in the line.
    for raw in text.split('\n') {
        let line = js::trim(raw.strip_suffix('\r').unwrap_or(raw));
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix('#') {
            let title = js::slice_units(rest.trim_start_matches('#').trim_start_matches(js::is_space), 40);
            sections.push(Section { title: if title.is_empty() { "Checklist".to_owned() } else { title.to_owned() }, items: Vec::new() });
            continue;
        }
        if sections.is_empty() {
            sections.push(Section { title: "Checklist".to_owned(), items: Vec::new() });
        }
        let parts = split(line);
        let response = parts[1..].join(" ");
        let response = js::trim(&response);
        let item = Item {
            challenge: js::slice_units(js::trim(&parts[0]), 80).to_owned(),
            response: (!response.is_empty()).then(|| js::slice_units(response, 80).to_owned()),
        };
        if let Some(last) = sections.last_mut() {
            last.items.push(item);
        }
    }
    sections.retain(|s| !s.items.is_empty());
    sections
}

/// The checklist as ChecklistDto's JSON, `{"sections": [{"title", "items":
/// [{"challenge", "response"}]}]}`, a response null where there is none.
pub fn to_json(sections: &[Section]) -> String {
    let mut out = String::from("{\"sections\":[");
    for (i, s) in sections.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"title\":");
        json::string(&mut out, &s.title);
        out.push_str(",\"items\":[");
        for (j, item) in s.items.iter().enumerate() {
            if j > 0 {
                out.push(',');
            }
            out.push_str("{\"challenge\":");
            json::string(&mut out, &item.challenge);
            out.push_str(",\"response\":");
            json::opt_string(&mut out, item.response.as_deref());
            out.push('}');
        }
        out.push_str("]}");
    }
    out.push_str("]}");
    out
}

/// The checklist written back as text: each section its "# title" line
/// and its items, "challenge -- response", a blank line between sections.
pub fn write(sections: &[Section]) -> String {
    sections
        .iter()
        .map(|s| {
            let mut lines = vec![format!("# {}", s.title)];
            lines.extend(s.items.iter().map(|i| match i.response.as_deref() {
                Some(r) if !r.is_empty() => format!("{} -- {r}", i.challenge),
                _ => i.challenge.clone(),
            }));
            lines.join("\n")
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}
