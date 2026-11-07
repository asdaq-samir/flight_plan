//! Endorsements and the checkride's reading (the web app's
//! lib/endorsements and lib/checkride): which signed endorsements are in
//! force, the warning an instructor sees once their own date has passed,
//! an endorsement's words as they will be signed (AC 61-65K's samples,
//! the gateway's EndorsementKind.render), and the ACS codes in a
//! knowledge test report the student pastes in.
//!
//! The days are the gateway's, "YYYY-MM-DD" on the pilot's own calendar,
//! compared as text: no time zone enters here.

use super::js;
use crate::time::days_in_month;

/// The day of a "YYYY-MM-DD" (a longer ISO text read by its first ten);
/// None for no such day.
fn day(iso: &str) -> Option<(i64, u32, u32)> {
    let d = iso.get(..10)?;
    let b = d.as_bytes();
    if !(b[4] == b'-' && b[7] == b'-' && [0, 1, 2, 3, 5, 6, 8, 9].iter().all(|&i| b[i].is_ascii_digit())) {
        return None;
    }
    let (y, m, dd) = (d[..4].parse().ok()?, d[5..7].parse().ok()?, d[8..].parse().ok()?);
    ((1..=12).contains(&m) && dd >= 1 && dd <= days_in_month(y, m)).then_some((y, m, dd))
}

/// A day as the pages say one: "13 Oct 2026".
pub fn said(iso: &str) -> Option<String> {
    const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let (y, m, d) = day(iso)?;
    Some(format!("{d} {} {y}", MONTHS[m as usize - 1]))
}

/// The warning an instructor sees above "Sign as" once their date has
/// passed on the day of signing, or None: on the day itself they are still
/// within it. Never a block: the owner's rule is to make the pilot aware,
/// not restrict them (2026-10-26), so the gateway signs either way and the
/// signature line shows the date. A certificate issued on or after 1 Dec
/// 2024 has no expiration date (14 CFR 61.19(d)(1)) and its date is the
/// end of the recent experience 61.197(a) asks for in the preceding 24
/// calendar months ("RE"); an older one expires 24 calendar months from
/// issue, renewal or reinstatement (61.19(d)(2)), and once expired its
/// privileges wait for reinstatement under 61.199 (61.197(e)) ("EXP").
/// The gateway works the date out; it is only compared here. Err where a
/// date that has passed is not a day.
pub fn lapse_warning(until: Option<&str>, until_kind: Option<&str>, signed_on: &str) -> Result<Option<String>, String> {
    let Some(until) = until.filter(|u| !u.is_empty()) else { return Ok(None) };
    if until >= signed_on {
        return Ok(None);
    }
    let on = said(until).ok_or_else(|| format!("endorsement_lapse: {until:?} is not a day"))?;
    Ok(Some(if until_kind == Some("EXP") {
        format!("Your certificate expired on {on}: 14 CFR 61.197(e) asks for it to be reinstated (61.199) before you sign as an instructor.")
    } else {
        format!("Your recent experience ran out on {on}: 14 CFR 61.197(a) asks for recent experience in the preceding 24 calendar months before you sign as an instructor.")
    }))
}

/// The latest of each kind signed in the app and not voided, by its code,
/// as indices into `signed`, which the record gives newest first; in the
/// order first met.
pub fn in_force(signed: &[(String, bool)]) -> Vec<(String, usize)> {
    let mut out: Vec<(String, usize)> = Vec::new();
    for (i, (code, voided)) in signed.iter().enumerate() {
        if !voided && !out.iter().any(|(c, _)| c == code) {
            out.push((code.clone(), i));
        }
    }
    out
}

/// An endorsement's words with the student's name and the fields filled
/// in, as the gateway's EndorsementKind.render fills them: each {blank}
/// ({letters}) the student's name for {student}, else its field, a blank
/// with no field left empty; every run of space then one space, and none
/// at the ends. What the sheet shows is what is signed: the gateway
/// refuses a signature over words that are not what it makes of the same
/// fields.
pub fn render(template: &str, student: &str, field: &dyn Fn(&str) -> Option<String>) -> String {
    let c: Vec<char> = template.chars().collect();
    let mut filled = String::with_capacity(template.len());
    let mut i = 0;
    while i < c.len() {
        if c[i] == '{' {
            let letters = c[i + 1..].iter().take_while(|x| x.is_ascii_alphabetic()).count();
            if letters > 0 && c.get(i + 1 + letters) == Some(&'}') {
                let key: String = c[i + 1..i + 1 + letters].iter().collect();
                filled.push_str(&if key == "student" { student.to_owned() } else { field(&key).unwrap_or_default() });
                i += letters + 2;
                continue;
            }
        }
        filled.push(c[i]);
        i += 1;
    }
    filled.split(js::is_space).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ")
}

/// The ACS codes in what was pasted -- a report's text, a list, codes
/// typed in lower case -- each once, in the order given (FAA-S-ACS-6C's
/// PA. and FAA-S-ACS-8C's IR. codes: area of operation in Roman numerals,
/// task letter, K, R or S and the element's number, a sub-element's
/// letter lower case, as the ACS writes it: K1a). As
/// /\b(PA|IR)\.([IVX]{1,4})\.([A-Z])\.([KRS])(\d{1,2})([A-Z]?)\b/g finds
/// them in the text upper-cased.
pub fn acs_codes(text: &str) -> Vec<String> {
    let c: Vec<char> = text.to_uppercase().chars().collect();
    let mut found: Vec<String> = Vec::new();
    let mut i = 0;
    while i < c.len() {
        match acs_code_at(&c, i) {
            Some((code, end)) => {
                if !found.contains(&code) {
                    found.push(code);
                }
                i = end;
            }
            None => i += 1,
        }
    }
    found
}

fn acs_code_at(c: &[char], i: usize) -> Option<(String, usize)> {
    if !js::boundary(c, i) || !(c[i..].starts_with(&['P', 'A', '.']) || c[i..].starts_with(&['I', 'R', '.'])) {
        return None;
    }
    let mut j = i + 3;
    let area = c[j..].iter().take_while(|x| matches!(x, 'I' | 'V' | 'X')).count();
    if !(1..=4).contains(&area) || c.get(j + area) != Some(&'.') {
        return None;
    }
    let roman: String = c[j..j + area].iter().collect();
    j += area + 1;
    let task = *c.get(j).filter(|x| x.is_ascii_uppercase())?;
    if c.get(j + 1) != Some(&'.') {
        return None;
    }
    let kind = *c.get(j + 2).filter(|x| matches!(x, 'K' | 'R' | 'S'))?;
    j += 3;
    let digits = c[j..].iter().take_while(|x| x.is_ascii_digit()).count();
    // Two digits before one, a letter before none, as the expression
    // backtracks to find a word's end.
    for n in (1..=digits.min(2)).rev() {
        let after = j + n;
        let letter = c.get(after).filter(|x| x.is_ascii_uppercase());
        for take in [true, false] {
            if take && letter.is_none() {
                continue;
            }
            let end = after + usize::from(take);
            if js::boundary(c, end) {
                let number: String = c[j..after].iter().collect();
                let sub = if take { letter.map(|l| l.to_ascii_lowercase().to_string()).unwrap_or_default() } else { String::new() };
                return Some((format!("{}.{roman}.{task}.{kind}{number}{sub}", &c[i..i + 2].iter().collect::<String>()), end));
            }
        }
    }
    None
}
