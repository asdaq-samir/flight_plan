//! An airplane by its N-number: whether what was typed is one, and the
//! stock profile its registered make and model flies on.

/// Whether `text` is a US registration as 14 CFR 47.15(b) shapes one: N,
/// then no more than five symbols -- "all numbers (N10000), one to four
/// numbers and one suffix letter (N1000A), or one to three numbers and two
/// suffix letters (N100AB)" -- the first figure 1 to 9 ("the first zero in
/// a number must always be preceded by at least one of the numbers 1
/// through 9"), and never the letters I or O. Capitals only, as the
/// registry writes them.
pub fn is_n_number(text: &str) -> bool {
    let Some(rest) = text.strip_prefix('N') else { return false };
    let figures = rest.bytes().take_while(u8::is_ascii_digit).count();
    let letters = &rest.as_bytes()[figures..];
    let first_ok = rest.as_bytes().first().is_some_and(|b| (b'1'..=b'9').contains(b));
    let letters_ok = letters.iter().all(|b| b.is_ascii_uppercase() && *b != b'I' && *b != b'O');
    first_ok
        && letters_ok
        && match letters.len() {
            0 => (1..=5).contains(&figures),
            1 => (1..=4).contains(&figures),
            2 => (1..=3).contains(&figures),
            _ => false,
        }
}

/// A stock profile's test on the registry's make and model.
struct Known {
    /// Found anywhere in the make ("CESSNA AIRCRAFT CO").
    maker: &'static str,
    model: fn(&str) -> bool,
    profile: &'static str,
    /// Only for an airplane built before this year.
    before: Option<f64>,
}

/// `s` is `head` and then nothing, or one of `tail`.
fn then_one_of(s: &str, head: &str, tail: std::ops::RangeInclusive<u8>) -> bool {
    match s.strip_prefix(head) {
        Some("") => true,
        Some(t) => t.len() == 1 && tail.contains(&t.as_bytes()[0]),
        None => false,
    }
}

/// A Cessna 150: F, A, both or neither before 150, a model letter A to M
/// after it or none; and the FA150L.
fn c150(m: &str) -> bool {
    let m2 = m.strip_prefix('F').unwrap_or(m);
    let m3 = m2.strip_prefix('A').unwrap_or(m2);
    then_one_of(m3, "150", b'A'..=b'M') || m == "FA150L"
}

fn c152(m: &str) -> bool {
    m == "152" || m == "A152" || m == "F152"
}

fn c172(m: &str) -> bool {
    then_one_of(m, "172", b'A'..=b'Z')
}

fn c182(m: &str) -> bool {
    m == "182S" || m == "182T"
}

/// The types the planner has handbook figures for (data/aircraft, each
/// file's `source`), by the registry's make and model with case, spaces
/// and hyphens set aside; any other none, its speed and burn the pilot's to
/// give rather than a guess. Kept out where a model shares a name but not
/// the figures: a 182RG or a turbo 182, a PA-28-151/160/180, an Arrow I, II
/// or IV or a turbo Arrow, a turbo SR22T, the avgas DA40. A Bonanza A36 is
/// out: its handbook gives no percent power for its cruise row. The
/// Cherokee 140 by its year: the 1970 'D' handbook's 14,300 ft ceiling to
/// 1972, the 1973 Cruiser manual's 10,950 from 1973 (the owner's page,
/// 2026-10-23) -- and with no year the Cruiser's, the lower ceiling.
const KNOWN: [Known; 13] = [
    Known { maker: "CESSNA", model: c150, profile: "c150", before: None },
    Known { maker: "CESSNA", model: c152, profile: "c152", before: None },
    Known { maker: "CESSNA", model: c172, profile: "c172", before: None },
    Known { maker: "CESSNA", model: c182, profile: "c182", before: None },
    Known { maker: "PIPER", model: |m| m.starts_with("PA28181"), profile: "pa28", before: None },
    Known { maker: "PIPER", model: |m| m == "PA28140", profile: "pa28140", before: Some(1973.0) },
    Known { maker: "PIPER", model: |m| m == "PA28140", profile: "pa28140cruiser", before: None },
    Known { maker: "PIPER", model: |m| m == "PA28161", profile: "pa28161", before: None },
    Known { maker: "PIPER", model: |m| m == "PA28R201", profile: "pa28r201", before: None },
    Known { maker: "MOONEY", model: |m| m == "M20J", profile: "m20j", before: None },
    Known { maker: "CIRRUS", model: |m| m == "SR20", profile: "sr20", before: None },
    Known { maker: "CIRRUS", model: |m| m == "SR22", profile: "sr22", before: None },
    Known { maker: "DIAMOND", model: |m| m == "DA40NG", profile: "da40ng", before: None },
];

/// The stock profile an airplane the FAA's registry names flies on, by its
/// maker, model and year; None for a type the planner has no figures for.
pub fn profile_of(manufacturer: Option<&str>, model: Option<&str>, year: Option<f64>) -> Option<&'static str> {
    let maker = manufacturer.unwrap_or("").to_uppercase();
    let model: String = model.unwrap_or("").to_uppercase().chars().filter(|c| !c.is_whitespace() && *c != '-').collect();
    KNOWN
        .iter()
        .find(|k| maker.contains(k.maker) && (k.model)(&model) && k.before.is_none_or(|b| year.is_some_and(|y| y < b)))
        .map(|k| k.profile)
}
