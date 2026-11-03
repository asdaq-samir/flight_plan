//! CSV as the web app read and wrote it with papaparse 5.7.0 (RFC 4180:
//! commas, quotes doubled inside quotes, a quoted field's own commas and
//! line breaks), step for step, so a logbook file reads into the same
//! rows on the phone as in the browser: the line ending guessed from the
//! text outside quotes, the delimiter guessed from the first ten rows
//! (a comma, a tab, a bar, a semicolon -- as a spreadsheet set to another
//! language saves one -- or the ASCII record and unit separators), a
//! quote only opening a quoted field at its start, an empty row kept so a
//! row's place is its line. Worked in UTF-16 code units, as JavaScript's
//! strings are, so the guess looks at the same first megabyte.

const QUOTE: u16 = b'"' as u16;
const CR: u16 = b'\r' as u16;
const LF: u16 = b'\n' as u16;
const BOM: u16 = 0xFEFF;
/// The delimiters tried, in papaparse's order (Papa.parse's
/// delimitersToGuess default; RECORD_SEP and UNIT_SEP last).
const DELIMITERS: [u16; 6] = [b',' as u16, b'\t' as u16, b'|' as u16, b';' as u16, 0x1E, 0x1F];

fn index_of(s: &[u16], pat: &[u16], from: usize) -> Option<usize> {
    if from > s.len() || pat.len() > s.len() {
        return None;
    }
    (from..=s.len() - pat.len()).find(|&i| &s[i..i + pat.len()] == pat)
}

fn is_space_unit(u: u16) -> bool {
    char::from_u32(u as u32).is_some_and(super::js::is_space)
}

/// Text from code units; never split inside a pair here, as every cut
/// falls at an ASCII delimiter, quote or line break.
fn text(s: &[u16]) -> String {
    String::from_utf16_lossy(s)
}

/// A quoted field's text, its doubled quotes made single.
fn unquoted(s: &[u16]) -> String {
    let mut out = Vec::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        out.push(s[i]);
        i += if s[i] == QUOTE && s.get(i + 1) == Some(&QUOTE) { 2 } else { 1 };
    }
    text(&out)
}

/// papaparse's guessLineEndings: within the first megabyte, the quoted
/// text taken out, "\n" where there is no "\r" or a "\n" comes first,
/// else "\r\n" where at least half the "\r"s are followed by "\n", else "\r".
fn guess_newline(input: &[u16]) -> Vec<u16> {
    let head = &input[..input.len().min(1024 * 1024)];
    // /"([^]*?)"/gm replaced with nothing: each quote and the next taken out
    // with all between them.
    let mut kept = Vec::with_capacity(head.len());
    let mut i = 0;
    while i < head.len() {
        if head[i] == QUOTE {
            if let Some(close) = index_of(head, &[QUOTE], i + 1) {
                i = close + 1;
                continue;
            }
        }
        kept.push(head[i]);
        i += 1;
    }
    let r: Vec<&[u16]> = kept.split(|&u| u == CR).collect();
    let n_first = kept.split(|&u| u == LF).next().map_or(0, <[u16]>::len);
    let n_count = kept.iter().filter(|&&u| u == LF).count() + 1;
    let n_appears_first = n_count > 1 && n_first < r[0].len();
    if r.len() == 1 || n_appears_first {
        return vec![LF];
    }
    let with_n = r.iter().filter(|piece| piece.first() == Some(&LF)).count();
    if with_n as f64 >= r.len() as f64 / 2.0 {
        vec![CR, LF]
    } else {
        vec![CR]
    }
}

/// papaparse's Parser.parse with no comments, no header and no step: the
/// rows, at most `preview` of them where one is given.
fn parse_with(input: &[u16], delim: u16, newline: &[u16], preview: Option<usize>) -> Vec<Vec<String>> {
    let mut data: Vec<Vec<String>> = Vec::new();
    if input.is_empty() {
        return data;
    }
    let delim_s = [delim];
    let nl_len = newline.len();
    let len = input.len();
    let mut row: Vec<String> = Vec::new();
    let mut cursor = 0usize;
    let mut next_delim = index_of(input, &delim_s, 0);
    let mut next_newline = index_of(input, newline, 0);
    let full = |data: &Vec<Vec<String>>| preview.is_some_and(|p| data.len() >= p);

    loop {
        if input.get(cursor) == Some(&QUOTE) {
            // A quoted field: find its closing quote.
            let mut quote_search = cursor;
            cursor += 1;
            loop {
                let Some(found) = index_of(input, &[QUOTE], quote_search + 1) else {
                    // Unterminated: the rest of the text, as it stands.
                    row.push(text(&input[cursor..]));
                    data.push(row);
                    return data;
                };
                quote_search = found;
                if quote_search == len - 1 {
                    row.push(unquoted(&input[cursor..quote_search]));
                    data.push(row);
                    return data;
                }
                if input[quote_search + 1] == QUOTE {
                    quote_search += 1;
                    continue;
                }
                if next_delim.is_some_and(|d| d < quote_search + 1) {
                    next_delim = index_of(input, &delim_s, quote_search + 1);
                }
                if next_newline.is_some_and(|n| n < quote_search + 1) {
                    next_newline = index_of(input, newline, quote_search + 1);
                }
                // Spaces between the closing quote and what ends the field
                // are let be (papaparse's extraSpaces). Math.min(-1, n) is -1:
                // with no delimiter ahead, none are.
                let check_up_to = match (next_delim, next_newline) {
                    (d, None) => d,
                    (None, Some(_)) => None,
                    (Some(d), Some(n)) => Some(d.min(n)),
                };
                let extra = |index: Option<usize>| -> usize {
                    match index {
                        Some(index) if index > quote_search + 1 => {
                            let between = &input[quote_search + 1..index];
                            if between.iter().all(|&u| is_space_unit(u)) {
                                between.len()
                            } else {
                                0
                            }
                        }
                        _ => 0,
                    }
                };
                let spaces = extra(check_up_to);
                if input.get(quote_search + 1 + spaces) == Some(&delim) {
                    row.push(unquoted(&input[cursor..quote_search]));
                    cursor = quote_search + 1 + spaces + 1;
                    next_delim = index_of(input, &delim_s, cursor);
                    next_newline = index_of(input, newline, cursor);
                    break;
                }
                let spaces = extra(next_newline);
                let at = quote_search + 1 + spaces;
                if input.get(at..at + nl_len) == Some(newline) {
                    row.push(unquoted(&input[cursor..quote_search]));
                    cursor = at + nl_len;
                    data.push(std::mem::take(&mut row));
                    next_newline = index_of(input, newline, cursor);
                    next_delim = index_of(input, &delim_s, cursor);
                    if full(&data) {
                        return data;
                    }
                    break;
                }
                // A quote inside the quoted field, not doubled: papaparse
                // notes it malformed and looks on from the one after it.
                quote_search += 1;
            }
            continue;
        }

        if let Some(d) = next_delim {
            if next_newline.is_none_or(|n| d < n) {
                row.push(text(&input[cursor..d]));
                cursor = d + 1;
                next_delim = index_of(input, &delim_s, cursor);
                continue;
            }
        }
        if let Some(n) = next_newline {
            row.push(text(&input[cursor..n]));
            cursor = n + nl_len;
            data.push(std::mem::take(&mut row));
            next_newline = index_of(input, newline, cursor);
            if full(&data) {
                return data;
            }
            continue;
        }
        break;
    }
    row.push(text(&input[cursor..]));
    data.push(row);
    data
}

/// papaparse's guessDelimiter: of the candidates that split the first ten
/// rows into two fields or more on average, the one whose rows' counts
/// vary least, the larger average breaking a tie; a comma where none does.
fn guess_delimiter(input: &[u16], newline: &[u16]) -> u16 {
    let mut best: Option<(u16, f64, f64)> = None;
    for delim in DELIMITERS {
        let preview = parse_with(input, delim, newline, Some(10));
        let mut delta = 0.0f64;
        let mut sum = 0.0f64;
        let mut prev: Option<usize> = None;
        for row in &preview {
            let count = row.len();
            sum += count as f64;
            if let Some(p) = prev {
                if count > 0 {
                    delta += (count as f64 - p as f64).abs();
                    prev = Some(count);
                }
            } else {
                prev = Some(count);
            }
        }
        let avg = if preview.is_empty() { 0.0 } else { sum / preview.len() as f64 };
        if avg > 1.99 && best.is_none_or(|(_, d, a)| delta < d || (delta == d && avg > a)) {
            best = Some((delim, delta, avg));
        }
    }
    best.map_or(b',' as u16, |(d, _, _)| d)
}

/// Papa.parse(text, {skipEmptyLines: false}).data: one byte order mark
/// taken off, the line ending and the delimiter guessed, every row.
pub fn rows(text_in: &str) -> Vec<Vec<String>> {
    let mut input: Vec<u16> = text_in.encode_utf16().collect();
    if input.first() == Some(&BOM) {
        input.remove(0);
    }
    let newline = guess_newline(&input);
    let delim = guess_delimiter(&input, &newline);
    parse_with(&input, delim, &newline, None)
}

/// A value as Papa.unparse writes it: quoted where a reader would read it
/// otherwise -- a comma, a quote, a line break or a byte order mark in it,
/// or a space at either end -- its quotes doubled.
pub fn cell(value: &str) -> String {
    let needs = value.contains([',', '"', '\r', '\n', '\u{feff}']) || value.starts_with(' ') || value.ends_with(' ');
    if needs {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_owned()
    }
}

/// Rows as Papa.unparse writes them with its defaults: commas, "\r\n"
/// between the rows and none after the last.
pub fn unparse(rows: &[Vec<String>]) -> String {
    rows.iter().map(|row| row.iter().map(|c| cell(c)).collect::<Vec<_>>().join(",")).collect::<Vec<_>>().join("\r\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_quoted_fields_as_papaparse_does() {
        assert_eq!(
            rows("a,\"b, c\",\"d \"\"e\"\"\",\r\n\"f\ng\",h"),
            vec![vec!["a", "b, c", "d \"e\"", ""], vec!["f\ng", "h"]]
        );
        assert_eq!(rows("a;b;c\n1;2;3"), vec![vec!["a", "b", "c"], vec!["1", "2", "3"]]);
        assert_eq!(rows(""), Vec::<Vec<String>>::new());
        assert_eq!(rows("a\n"), vec![vec!["a"], vec![""]]);
        assert_eq!(rows("\"open,a\nb"), vec![vec!["open,a\nb"]]);
    }

    #[test]
    fn writes_as_unparse_does() {
        let row = |cells: &[&str]| cells.iter().map(|c| c.to_string()).collect::<Vec<_>>();
        assert_eq!(unparse(&[row(&["a", " b", "c,d", "e\"f"]), row(&["", "x"])]), "a,\" b\",\"c,d\",\"e\"\"f\"\r\n,x");
    }
}
