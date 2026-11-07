//! The airspace over a point in bands, from the ground to FL600, with the
//! rules of each: wingtip.airspace_at's `column`, `minimums`, `equipment`,
//! `speed_kt` and `ENTRY`, written again here so the phone answers as the
//! planner does with no network. tests/test_native.py holds the two to
//! the same answer at every tap it asks.

use crate::json;

/// Class A, from here to FL600 (14 CFR 71.33): IFR only.
pub const CLASS_A_FLOOR_FT: f64 = 18000.0;
/// Class E from here up wherever nothing lower is designated, but not
/// within 1,500 ft of the surface (71.71(b)).
pub const CLASS_E_EVERYWHERE_FT: f64 = 14500.0;
/// Where 91.155's minimums, 91.117's speed and 91.215's transponder rule change.
pub const TEN_THOUSAND_FT: f64 = 10000.0;
/// Class G's minimums differ at and below this height (91.155(a)).
pub const G_LOW_AGL_FT: f64 = 1200.0;
/// Above 10,000 ft MSL a transponder and ADS-B Out are asked for, but
/// not at or below this height above the ground (91.215(b)(5), 91.225(d)(4)).
pub const TRANSPONDER_EXEMPT_AGL_FT: f64 = 2500.0;
/// The Mode C veil's radius round each airport of part 91 appendix D
/// section 1 (91.215(b)(2), 91.225(d)(2)), surface to 10,000 ft MSL.
pub const MODE_C_VEIL_NM: f64 = 30.0;
/// 14 CFR 91.155(c): no VFR beneath a ceiling lower than 1,000 ft within
/// the lateral boundaries of a surface area of controlled airspace ...
pub const SURFACE_AREA_CEILING_FT: f64 = 1000.0;
/// ... and 91.155(d): nor there with a ground visibility under 3 statute
/// miles (without a special VFR clearance) -- the least any VFR minimums
/// come to, and the planner's "VFR flight not recommended" line (AIM 7-1-5).
pub const SURFACE_AREA_VISIBILITY_SM: f64 = 3.0;
/// The top of the column: FL600, where Class A ends (71.33).
const TOP_FT: f64 = 60000.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum FloorRef {
    Sfc,
    Agl,
    Msl,
}

/// One Class B, C, D or E volume holding the point, as wingtip.airspace_at's
/// `_volume` gives it: its floor in feet over its reference, its ceiling
/// in feet MSL.
#[derive(Clone, Debug)]
pub struct Volume {
    pub class: char,
    pub name: String,
    pub floor_ft: f64,
    pub floor_ref: FloorRef,
    pub ceiling_ft: f64,
}

/// 91.155(a)'s visibility and distance from clouds: clear of them where
/// `below_ft` is None.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rule {
    pub visibility_sm: f64,
    pub below_ft: Option<f64>,
    pub above_ft: Option<f64>,
    pub horizontal_ft: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Minimums {
    pub day: Rule,
    pub night: Rule,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Band {
    pub floor_ft: f64,
    pub ceiling_ft: f64,
    pub class: char,
    pub name: Option<String>,
    pub minimums: Option<Minimums>,
    pub entry: &'static str,
    pub equipment: Option<&'static str>,
    pub speed_kt: Option<u32>,
}

fn rule(visibility_sm: f64, clouds: Option<(f64, f64, f64)>) -> Rule {
    Rule {
        visibility_sm,
        below_ft: clouds.map(|c| c.0),
        above_ft: clouds.map(|c| c.1),
        horizontal_ft: clouds.map(|c| c.2),
    }
}

/// 91.155(a)'s basic VFR weather minimums for a band of `class` whose
/// bottom is `floor_msl`, `agl` above the ground there. None in Class A.
pub fn minimums(class: char, floor_msl: f64, agl: f64) -> Option<Minimums> {
    let standard = rule(3.0, Some((500.0, 1000.0, 2000.0)));
    let high = rule(5.0, Some((1000.0, 1000.0, 5280.0)));
    let same = |r: Rule| Some(Minimums { day: r, night: r });
    match class {
        'A' => None,
        'B' => same(rule(3.0, None)),
        'C' | 'D' => same(standard),
        'E' => same(if floor_msl >= TEN_THOUSAND_FT { high } else { standard }),
        // Class G.
        _ if agl < G_LOW_AGL_FT => Some(Minimums { day: rule(1.0, None), night: standard }),
        _ if floor_msl >= TEN_THOUSAND_FT => same(high),
        _ => Some(Minimums { day: rule(1.0, Some((500.0, 1000.0, 2000.0))), night: standard }),
    }
}

/// What it takes to go in.
pub fn entry(class: char) -> &'static str {
    match class {
        'A' => "IFR only: an instrument rating, an IFR flight plan and a clearance (91.135).",
        'B' => "An ATC clearance into the Class B, and a private pilot certificate or a student's endorsement for it (91.131).",
        'C' => "Two-way radio communication with ATC established before entering (91.130).",
        'D' => "Two-way radio communication with the tower established before entering (91.129).",
        'E' => "Nothing for VFR.",
        _ => "Nothing.",
    }
}

/// What a pilot needs to fly into a Class B, C or D airspace area, and the
/// speeds in and under it, each a rule and the section of 14 CFR part 91
/// it comes from (eCFR, current on 2026-10-30), for the airspace's card:
/// the band's `entry`, `equipment` and `speed_kt` itemised. VFR, in the 48
/// states, for a civil airplane with an engine-driven electrical system:
/// the exceptions for gliders, balloons and the rest (91.215(b)(3),
/// 91.225(e)) are left out. The figures are this file's own, so the card
/// and the band cannot disagree on them. Empty for any other class.
pub fn entry_rules(class: char) -> Vec<(String, &'static str)> {
    use crate::figures::words::grouped;
    let ten = grouped(TEN_THOUSAND_FT);
    // 91.117(b): at or below 2,500 ft above the surface within 4 nm of the
    // primary airport of a Class C or D.
    let near_field = format!("200 kt at or below {} ft above the surface within 4 nm of its primary airport", grouped(TRANSPONDER_EXEMPT_AGL_FT));
    match class {
        'B' => vec![
            ("An ATC clearance before you enter".to_owned(), "14 CFR 91.131(a)(1)"),
            ("A two-way radio for ATC's frequencies".to_owned(), "14 CFR 91.131(c)(2)"),
            (
                format!(
                    "A transponder with altitude reporting and ADS-B Out, in it, above it to {ten} ft MSL, and within {} nm of its primary airport",
                    MODE_C_VEIL_NM
                ),
                "14 CFR 91.215(b), 91.225(d)",
            ),
            (
                "At least a private pilot certificate, or a student, sport or recreational pilot's endorsement for it".to_owned(),
                "14 CFR 91.131(b)(1)",
            ),
            (format!("200 kt under its shelves and in a VFR corridor through it; 250 kt below {ten} ft MSL in it"), "14 CFR 91.117(a), (c)"),
        ],
        'C' => vec![
            ("Two-way radio contact with ATC before you enter".to_owned(), "14 CFR 91.130(c)(1)"),
            (
                format!("A transponder with altitude reporting and ADS-B Out, in it and above it to {ten} ft MSL"),
                "14 CFR 91.130(d), 91.215(b), 91.225(d)",
            ),
            (near_field, "14 CFR 91.117(b)"),
        ],
        'D' => vec![("Two-way radio contact with the tower before you enter".to_owned(), "14 CFR 91.129(c)(1)"), (near_field, "14 CFR 91.117(b)")],
        _ => Vec::new(),
    }
}

/// The frequencies to call before entering, by the primary airport's
/// types (NASR FRQ): approach for a Class B or C (91.131(a)(1),
/// 91.130(c)(1)), the tower for a Class D (91.129(c)(1)).
pub fn call_types(class: char) -> &'static [&'static str] {
    if class == 'D' {
        &["TWR"]
    } else {
        &["APP", "TWR"]
    }
}

const TRANSPONDER: &str = "A transponder with altitude reporting and ADS-B Out (91.215, 91.225).";

/// What the airplane must carry to be there (91.215, 91.225), or None
/// where nothing is asked beyond the basics. `above_bc`: over a Class
/// B's or C's ceiling, inside its lateral limits.
pub fn equipment(class: char, floor_msl: f64, agl: f64, in_veil: bool, above_bc: bool) -> Option<&'static str> {
    match class {
        // IFR only: the instrument flight asks for far more than this.
        'A' => None,
        'B' | 'C' => Some(TRANSPONDER),
        // 91.215(b)(2) asks for the transponder in "all airspace" within
        // 30 nm of a Class B primary airport, surface to 10,000 ft MSL.
        'D' if in_veil && floor_msl < TEN_THOUSAND_FT => Some(
            "A two-way radio, and a transponder with altitude reporting and ADS-B Out: \
             inside a 30 nm Mode C veil (91.215(b)(2), 91.225(d)(2)).",
        ),
        'D' => Some("A two-way radio."),
        _ if floor_msl >= TEN_THOUSAND_FT && agl >= TRANSPONDER_EXEMPT_AGL_FT => Some(TRANSPONDER),
        // Above a Class B or C, within its lateral limits, up to 10,000 ft
        // MSL (91.215(b)(4), 91.225(d)(3)).
        _ if above_bc && floor_msl < TEN_THOUSAND_FT => Some(
            "A transponder with altitude reporting and ADS-B Out: above a Class B or C, \
             within its lateral limits, to 10,000 ft MSL (91.215(b)(4), 91.225(d)(3)).",
        ),
        _ if in_veil && floor_msl < TEN_THOUSAND_FT => Some(
            "A transponder with altitude reporting and ADS-B Out: inside a 30 nm Mode C veil (91.215(b)(2), 91.225(d)(2)).",
        ),
        _ => None,
    }
}

/// The 91.117 speed limit, where one applies: 200 kt under a Class B's
/// shelf (91.117(c)), 200 kt at or below 2,500 ft above the surface in a
/// Class C or D (the whole surface band: a point does not know its
/// distance from the airport, and the lower speed is the safe error),
/// and 250 kt below 10,000 ft MSL (91.117(a)).
pub fn speed_kt(class: char, floor_msl: f64, under_b: bool, agl: f64) -> Option<u32> {
    if class == 'A' || floor_msl >= TEN_THOUSAND_FT {
        return None;
    }
    if under_b || (matches!(class, 'C' | 'D') && agl < TRANSPONDER_EXEMPT_AGL_FT) {
        return Some(200);
    }
    Some(250)
}

fn restrictiveness(class: char) -> u8 {
    match class {
        'B' => 0,
        'C' => 1,
        'D' => 2,
        'E' => 3,
        _ => 4,
    }
}

/// The airspace over the point in bands, from the ground to FL600: a B,
/// C or D holds its band where it is drawn, the most restrictive where
/// they overlap; E from its floor (or 14,500 ft where nothing lower is
/// drawn); G under it all; A from 18,000 ft. Bands are split where the
/// rules change -- 1,200 ft above the ground in G, 10,000 ft MSL -- and
/// joined where nothing does.
pub fn column(ground_ft: f64, volumes: &[Volume], in_veil: bool) -> Vec<Band> {
    let floor_msl = |v: &Volume| match v.floor_ref {
        FloorRef::Agl => ground_ft + v.floor_ft,
        FloorRef::Sfc => ground_ft,
        FloorRef::Msl => v.floor_ft,
    };
    let layered: Vec<(f64, f64, &Volume)> = volumes
        .iter()
        .map(|v| {
            let f = floor_msl(v);
            (f, v.ceiling_ft.max(f), v)
        })
        .collect();
    let controlled: Vec<&(f64, f64, &Volume)> = layered.iter().filter(|l| matches!(l.2.class, 'B' | 'C' | 'D')).collect();
    let class_e: Vec<&(f64, f64, &Volume)> = layered.iter().filter(|l| l.2.class == 'E').collect();
    let b_shelves: Vec<f64> = controlled.iter().filter(|l| l.2.class == 'B').map(|l| l.0).collect();

    let mut edges = vec![
        ground_ft,
        ground_ft + G_LOW_AGL_FT,
        ground_ft + TRANSPONDER_EXEMPT_AGL_FT,
        TEN_THOUSAND_FT,
        CLASS_E_EVERYWHERE_FT,
        CLASS_A_FLOOR_FT,
    ];
    for (f, c, _) in &layered {
        edges.push(*f);
        edges.push(*c);
    }
    edges.retain(|e| ground_ft <= *e && *e <= CLASS_A_FLOOR_FT);
    edges.sort_by(|a, b| a.partial_cmp(b).unwrap());
    edges.dedup();

    let mut bands: Vec<Band> = Vec::new();
    for pair in edges.windows(2) {
        let (bottom, top) = (pair[0], pair[1]);
        if top <= bottom {
            continue;
        }
        let middle = (bottom + top) / 2.0;
        let mut holding: Option<&Volume> = None;
        for (f, c, v) in controlled.iter().map(|l| (l.0, l.1, l.2)) {
            if f <= middle && middle < c && holding.is_none_or(|h| restrictiveness(v.class) < restrictiveness(h.class)) {
                holding = Some(v);
            }
        }
        let (class, name) = match holding {
            Some(v) => (v.class, Some(v.name.clone())),
            None if class_e.iter().any(|l| l.0 <= middle && middle < l.1)
                || (middle >= CLASS_E_EVERYWHERE_FT && middle >= ground_ft + 1500.0) =>
            {
                ('E', None)
            }
            None => ('G', None),
        };
        let agl = bottom - ground_ft;
        let under_b = class != 'B' && b_shelves.iter().any(|f| *f > middle);
        let above_bc = controlled.iter().any(|l| matches!(l.2.class, 'B' | 'C') && l.1 <= bottom);
        let band = Band {
            floor_ft: bottom,
            ceiling_ft: top,
            class,
            name,
            minimums: minimums(class, bottom, agl),
            entry: entry(class),
            equipment: equipment(class, bottom, agl, in_veil, above_bc),
            speed_kt: speed_kt(class, bottom, under_b, agl),
        };
        match bands.last_mut() {
            Some(previous)
                if previous.class == band.class
                    && previous.name == band.name
                    && previous.minimums == band.minimums
                    && previous.equipment == band.equipment
                    && previous.speed_kt == band.speed_kt =>
            {
                previous.ceiling_ft = top;
            }
            _ => bands.push(band),
        }
    }
    bands.push(Band {
        floor_ft: CLASS_A_FLOOR_FT,
        ceiling_ft: TOP_FT,
        class: 'A',
        name: None,
        minimums: None,
        entry: entry('A'),
        equipment: equipment('A', CLASS_A_FLOOR_FT, CLASS_A_FLOOR_FT - ground_ft, in_veil, false),
        speed_kt: None,
    });
    bands
}

fn write_rule(out: &mut String, r: &Rule) {
    out.push_str("{\"visibility_sm\":");
    json::number(out, r.visibility_sm);
    out.push_str(",\"clear_of_clouds\":");
    out.push_str(if r.below_ft.is_none() { "true" } else { "false" });
    out.push_str(",\"below_ft\":");
    json::opt_number(out, r.below_ft);
    out.push_str(",\"above_ft\":");
    json::opt_number(out, r.above_ft);
    out.push_str(",\"horizontal_ft\":");
    json::opt_number(out, r.horizontal_ft);
    out.push('}');
}

/// A band as the planner's AirspaceBand writes it.
pub fn write_band(out: &mut String, b: &Band) {
    out.push_str("{\"floor_ft\":");
    json::number(out, b.floor_ft);
    out.push_str(",\"ceiling_ft\":");
    json::number(out, b.ceiling_ft);
    out.push_str(",\"class\":");
    json::string(out, &b.class.to_string());
    out.push_str(",\"name\":");
    json::opt_string(out, b.name.as_deref());
    out.push_str(",\"minimums\":");
    match &b.minimums {
        Some(m) => {
            out.push_str("{\"day\":");
            write_rule(out, &m.day);
            out.push_str(",\"night\":");
            write_rule(out, &m.night);
            out.push('}');
        }
        None => out.push_str("null"),
    }
    out.push_str(",\"entry\":");
    json::string(out, b.entry);
    out.push_str(",\"equipment\":");
    json::opt_string(out, b.equipment);
    out.push_str(",\"speed_kt\":");
    match b.speed_kt {
        Some(s) => out.push_str(&s.to_string()),
        None => out.push_str("null"),
    }
    out.push('}');
}

/// The column as the planner asks it (call.rs `airspace_column`), from
/// `{"ground_ft"?, "volumes": [{"class", "name"?, "floor_ft", "floor_ref":
/// "SFC"|"AGL"|"MSL", "ceiling_ft"}], "in_veil"?}`: the bands, each as
/// the planner's AirspaceBand writes it. The planner reads the volumes
/// out of its own NASR shapefile or cycle pack (wingtip.airspace_at) and
/// asks the rules here, the phone's very ones.
pub fn column_json(v: &json::Value) -> Result<String, String> {
    use json::Value;
    let bad = |what: &str| format!("airspace_column: {what}");
    let num = |o: &Value, key: &str| -> Result<f64, String> {
        o.get(key).and_then(Value::as_f64).ok_or_else(|| bad(&format!("a volume's \"{key}\" is not a number")))
    };
    let ground_ft = match v.get("ground_ft") {
        None | Some(Value::Null) => 0.0,
        Some(g) => g.as_f64().ok_or_else(|| bad("\"ground_ft\" is not a number"))?,
    };
    let in_veil = match v.get("in_veil") {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(_) => return Err(bad("\"in_veil\" is not true or false")),
    };
    let listed = match v.get("volumes") {
        None | Some(Value::Null) => &[][..],
        Some(l) => l.as_array().ok_or_else(|| bad("\"volumes\" is not a list"))?,
    };
    let mut volumes = Vec::with_capacity(listed.len());
    for o in listed {
        let class = o.get("class").and_then(Value::as_str).unwrap_or("").trim();
        let class = match class.chars().next() {
            Some(c) if class.len() == 1 && matches!(c, 'B' | 'C' | 'D' | 'E') => c,
            _ => return Err(bad(&format!("a volume's class is B, C, D or E, not {class:?}"))),
        };
        let floor_ref = match o.get("floor_ref").and_then(Value::as_str) {
            Some("SFC") => FloorRef::Sfc,
            Some("AGL") => FloorRef::Agl,
            Some("MSL") => FloorRef::Msl,
            other => return Err(bad(&format!("a volume's floor_ref is SFC, AGL or MSL, not {other:?}"))),
        };
        volumes.push(Volume {
            class,
            name: o.get("name").and_then(Value::as_str).unwrap_or("").to_owned(),
            floor_ft: num(o, "floor_ft")?,
            floor_ref,
            ceiling_ft: num(o, "ceiling_ft")?,
        });
    }
    let mut out = String::from("[");
    for (k, band) in column(ground_ft, &volumes, in_veil).iter().enumerate() {
        if k > 0 {
            out.push(',');
        }
        write_band(&mut out, band);
    }
    out.push(']');
    Ok(out)
}

/// The nearest of the Mode C veil airports (14 CFR part 91 appendix D
/// section 1), each (lat, lon, ident, name), within MODE_C_VEIL_NM of the
/// point: (ident, name, distance in nm); None outside every veil.
pub fn nearest_veil(lat: f64, lon: f64, airports: impl IntoIterator<Item = (f64, f64, String, String)>) -> Option<(String, String, f64)> {
    let mut best: Option<(String, String, f64)> = None;
    for (a_lat, a_lon, ident, name) in airports {
        let d = crate::geo::distance_nm(lat, lon, a_lat, a_lon);
        if d <= MODE_C_VEIL_NM && best.as_ref().is_none_or(|b| d < b.2) {
            best = Some((ident, name, d));
        }
    }
    best
}

/// The veil as the planner asks it (call.rs `mode_c_veil`), from `{"lat",
/// "lon", "airports": [{"ident", "name"?, "lat"?, "lon"?}]}`: `{"ident",
/// "name", "distance_nm"}` to a tenth, or null. An airport with no place
/// is passed over.
pub fn veil_json(v: &json::Value) -> Result<String, String> {
    use json::Value;
    let num = |o: &Value, key: &str| match o.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(n) => n.as_f64().map(Some).ok_or_else(|| format!("mode_c_veil: \"{key}\" is not a number")),
    };
    let (lat, lon) = match (num(v, "lat")?, num(v, "lon")?) {
        (Some(lat), Some(lon)) => (lat, lon),
        _ => return Err("mode_c_veil: \"lat\" and \"lon\" are numbers".to_owned()),
    };
    let listed = v.get("airports").and_then(Value::as_array).ok_or_else(|| "mode_c_veil: \"airports\" is not a list".to_owned())?;
    let mut airports = Vec::new();
    for a in listed {
        if let (Some(a_lat), Some(a_lon)) = (num(a, "lat")?, num(a, "lon")?) {
            let text = |key: &str| a.get(key).and_then(Value::as_str).unwrap_or("").to_owned();
            airports.push((a_lat, a_lon, text("ident"), text("name")));
        }
    }
    let mut out = String::new();
    match nearest_veil(lat, lon, airports) {
        Some((ident, name, d)) => {
            out.push_str("{\"ident\":");
            json::string(&mut out, &ident);
            out.push_str(",\"name\":");
            json::opt_string(&mut out, Some(name.as_str()).filter(|n| !n.is_empty()));
            // As Python's round(d, 1): the nearest tenth, correctly rounded.
            out.push_str(&format!(",\"distance_nm\":{d:.1}}}"));
        }
        None => out.push_str("null"),
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn volume(class: char, floor_ft: f64, floor_ref: FloorRef, ceiling_ft: f64) -> Volume {
        Volume { class, name: format!("{class} test"), floor_ft, floor_ref, ceiling_ft }
    }

    #[test]
    fn a_class_d_under_open_sky() {
        // A Class D to 3,300 ft over 800 ft ground, Class E at 700 ft round it.
        let bands = column(800.0, &[volume('D', 0.0, FloorRef::Sfc, 3300.0), volume('E', 700.0, FloorRef::Agl, 18000.0)], false);
        assert_eq!(bands[0].class, 'D');
        assert_eq!(bands.last().unwrap().class, 'A');
        assert_eq!((bands[0].floor_ft, bands[0].ceiling_ft), (800.0, 3300.0));
        assert_eq!(bands[0].speed_kt, Some(200));
        assert_eq!(bands.last().unwrap().ceiling_ft, TOP_FT);
    }

    #[test]
    fn the_91_117_speed_limit_by_class_and_height() {
        // 91.117(b): 200 kt at or below 2,500 ft above the surface in a
        // Class C or D; (a): 250 kt below 10,000 ft MSL; (c): 200 kt under
        // a Class B. (Moved from tests/test_airspace_at.py, #482.)
        for (class, floor, agl, under_b, limit) in [
            ('D', 640.0, 0.0, false, Some(200)),
            ('C', 640.0, 2499.0, false, Some(200)),
            ('C', 3140.0, 2500.0, false, Some(250)),
            ('D', 3140.0, 2500.0, false, Some(250)),
            ('E', 640.0, 0.0, false, Some(250)),
            ('G', 640.0, 0.0, false, Some(250)),
            ('B', 3000.0, 2000.0, false, Some(250)),
            ('E', 640.0, 0.0, true, Some(200)),
            ('E', 10000.0, 9000.0, false, None),
            ('A', 18000.0, 17000.0, false, None),
        ] {
            assert_eq!(speed_kt(class, floor, under_b, agl), limit, "{class} {floor} {agl} {under_b}");
        }
    }

    #[test]
    fn the_91_155_minimums_by_class() {
        for (class, floor, agl, day_vis, clear) in [
            ('B', 3000.0, 2000.0, 3.0, true),
            ('C', 0.0, 0.0, 3.0, false),
            ('D', 0.0, 0.0, 3.0, false),
            ('E', 5000.0, 4000.0, 3.0, false),
            ('E', 11000.0, 9000.0, 5.0, false),
            ('G', 1000.0, 500.0, 1.0, true),
        ] {
            let day = minimums(class, floor, agl).unwrap().day;
            assert_eq!((day.visibility_sm, day.below_ft.is_none()), (day_vis, clear), "{class} {floor}");
        }
        assert!(minimums('A', 18000.0, 17000.0).is_none());
    }

    #[test]
    fn g_alone_splits_at_1200_agl() {
        let bands = column(0.0, &[], false);
        assert_eq!(bands[0].class, 'G');
        assert_eq!(bands[0].ceiling_ft, 1200.0);
        assert_eq!(bands[0].minimums.unwrap().day.visibility_sm, 1.0);
    }
}
