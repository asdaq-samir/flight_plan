//! The FAA's words in the app's (wingtip_engine::wording), asked as every
//! host asks them, by name through `call`: every case the web's tests
//! held lib/advisories, lib/frequencies, lib/stopServices, lib/airspace,
//! lib/airspaceRules, lib/navaid and lib/magnetic to, and the planner's
//! app.gonogo.words.

use wingtip_engine::call::call;

fn text(name: &str, input: &str) -> String {
    let answer = call(name, input).unwrap_or_else(|e| panic!("{name} {input}: {e}"));
    serde_free_string(&answer)
}

/// A JSON string answer, unquoted (the engine escapes only `"`, `\` and
/// control characters).
fn serde_free_string(json: &str) -> String {
    assert!(json.starts_with('"') && json.ends_with('"'), "{json}");
    json[1..json.len() - 1].replace("\\\"", "\"").replace("\\\\", "\\")
}

fn faa(t: &str) -> String {
    text("faa_words", &format!("{{\"text\": {t:?}}}"))
}

#[test]
fn the_faas_capitals_in_sentence_case_keep_the_codes_and_figures() {
    assert_eq!(faa("INTERMITTENT BY NOTAM 4 HOURS IN ADVANCE"), "Intermittent by NOTAM 4 hours in advance");
    assert_eq!(faa("0700 - 2200 LOCAL, MON - FRI; OTHER TIMES BY NOTAM"), "0700 - 2200 local, Mon - Fri; other times by NOTAM");
    assert_eq!(faa("AIR SPEED LOSS OR GAIN OF 20KTS OR MORE BELOW 2000 FT AGL"), "Air speed loss or gain of 20KTS or more below 2000 ft AGL");
    // A cause made of contractions alone stays as the FAA wrote it.
    assert_eq!(faa("CIG BLW 010 VIS BLW 3SM BR FG"), "CIG BLW 010 VIS BLW 3SM BR FG");
    assert_eq!(faa("Security: VIP movement"), "Security: VIP movement");
    // A designator whole, a class as the AIM writes it, days as days.
    assert_eq!(faa("R-4401A"), "R-4401A");
    assert_eq!(faa("ACTIVE IN R-5311A"), "Active in R-5311A");
    assert_eq!(faa("CHICAGO CLASS B"), "Chicago Class B");
    assert_eq!(faa("0800 - 1600, TUE-SAT"), "0800 - 1600, Tue-Sat");
    assert_eq!(faa("NOTAMS. THEN MORE!  OK? yes"), "NOTAMS. THEN MORE!  OK? yes");
    assert_eq!(faa("SEE NOTAMS. THEN MORE!  CLOSED? NO"), "See NOTAMs. Then more!  Closed? No");
    assert_eq!(faa("ÉCOLE CLASS C"), "École Class C");
    assert_eq!(faa("X_CLASS B"), "X_class b");
    assert_eq!(text("faa_words", "{}"), "");
    assert_eq!(text("faa_words", r#"{"text": null}"#), "");
    assert_eq!(call("faa_words", r#"{"texts": ["CHICAGO CLASS B", null, "Mixed"]}"#).unwrap(), r#"["Chicago Class B","","Mixed"]"#);
    assert!(call("faa_words", r#"{"text": 3}"#).is_err());
}

#[test]
fn a_name_in_capitals_is_written_as_a_name() {
    assert_eq!(text("title_case", r#"{"text": "CHICAGO CLASS B"}"#), "Chicago Class B");
    assert_eq!(text("title_case", r#"{"text": "ROCKFORD"}"#), "Rockford");
    assert_eq!(text("title_case", r#"{"text": "O'HARE"}"#), "O'Hare");
    let place = |t: &str| text("place_name", &format!("{{\"text\": {t:?}}}"));
    assert_eq!(place("LA CROSSE"), "La Crosse");
    assert_eq!(place("EAU CLAIRE"), "Eau Claire");
    assert_eq!(place("STERLING/ROCKFALLS"), "Sterling/Rockfalls");
    assert_eq!(place("MCCOOK"), "McCook");
    assert_eq!(place("Madison"), "Madison");
    assert_eq!(place("FT. MYERS (PAGE)"), "Ft. Myers (Page)");
    assert_eq!(text("place_name", "{}"), "");
    let short = |t: &str| text("short_airspace_name", &format!("{{\"name\": {t:?}}}"));
    assert_eq!(short("CHICAGO, DUPAGE AIRPORT CLASS D"), "Chicago, Dupage Airport");
    assert_eq!(short("MILWAUKEE  class  c2"), "Milwaukee");
    assert_eq!(short("CLASS B"), "Class B");
    assert_eq!(short("ROCKFORD B2X"), "Rockford B2x");
}

#[test]
fn the_advisories_hazards_and_intensities() {
    assert_eq!(text("sigmet_hazard", r#"{"hazard": "CONVECTIVE"}"#), "Convective");
    assert_eq!(text("sigmet_hazard", r#"{"hazard": "MTN OBSCN"}"#), "Mountain obscuration");
    assert_eq!(text("sigmet_hazard", r#"{"hazard": null, "kind": "SIGMET"}"#), "SIGMET");
    assert_eq!(text("sigmet_hazard", r#"{"hazard": "", "kind": ""}"#), "Hazard");
    assert_eq!(text("sigmet_hazard", r#"{"hazard": "VOLCANIC ERUPTION"}"#), "Volcanic eruption");
    assert_eq!(text("gairmet_title", r#"{"hazard": "Icing", "severity": "MOD"}"#), "Icing, moderate");
    assert_eq!(text("gairmet_title", r#"{"hazard": "IFR", "severity": null}"#), "IFR");
    assert_eq!(text("gairmet_title", r#"{"hazard": "Turbulence", "severity": "Odd"}"#), "Turbulence, odd");
    assert_eq!(text("pirep_conditions", r#"{"turbulence": "MOD", "icing": "NEG"}"#), "Turbulence moderate · No icing");
    assert_eq!(text("pirep_conditions", r#"{"turbulence": "lgt-mod", "icing": "TRC"}"#), "Turbulence light to moderate · Icing trace");
    assert_eq!(call("pirep_conditions", r#"{"turbulence": null, "icing": ""}"#).unwrap(), "null");
}

#[test]
fn a_special_use_areas_limits_as_the_chart_writes_them() {
    let sua = |t: &str| text("sua_altitudes", t);
    assert_eq!(sua(r#"{"floor_ft": 0, "floor_ref": "SFC", "ceiling_ft": 18000, "ceiling_ref": "MSL"}"#), "Surface to 18,000 ft");
    assert_eq!(sua(r#"{"floor_ft": 8000, "floor_ref": "MSL", "ceiling_ft": 18000, "ceiling_ref": "STD"}"#), "8,000 ft to FL180");
    assert_eq!(sua(r#"{"floor_ft": 500, "floor_ref": "AGL", "ceiling_ft": null, "ceiling_ref": null}"#), "500 ft AGL to unstated");
    assert_eq!(sua(r#"{"floor_ft": 0, "floor_ref": "MSL", "ceiling_ft": 1450, "ceiling_ref": "AGL", "mid_sentence": true}"#), "the surface to 1,450 ft AGL");
    assert_eq!(sua("{}"), "unstated to unstated");
}

#[test]
fn a_fields_fuel_and_radio() {
    assert_eq!(text("fuel_names", r#"{"types": ["100LL", "A", "UL94"]}"#), "100LL, Jet A, UL94");
    assert_eq!(text("fuel_names", r#"{"types": ["A+", "A1", "A1+"]}"#), "Jet A+, Jet A-1, Jet A-1+");
    let line = |t: &str, d: &str| call("frequency_line", &format!("{{\"type\": {t}, \"description\": {d}}}")).unwrap();
    assert_eq!(line(r#""TWR""#, r#""TWR""#), r#"{"name":"Tower","kind":"tower","detail":null}"#);
    assert_eq!(line(r#""UNIC""#, r#""UNICOM""#), r#"{"name":"UNICOM","kind":"traffic","detail":null}"#);
    assert_eq!(line(r#""A/D""#, r#""MINNEAPOLIS APP/DEP""#), r#"{"name":"Approach and departure","kind":"approach","detail":"Minneapolis APP/DEP"}"#);
    assert_eq!(line(r#""ATIS""#, r#""ATIS""#), r#"{"name":"ATIS","kind":"weather","detail":null}"#);
    assert!(line(r#""GCCD""#, r#""GND/CLNC DEL""#).starts_with(r#"{"name":"Ground and clearance","kind":"ground""#));
    assert_eq!(line(r#""POST""#, r#""ANG COMD POST""#), r#"{"name":"ANG comd post","kind":"other","detail":null}"#);
    assert_eq!(line("null", "null"), r#"{"name":"Frequency","kind":"other","detail":null}"#);
    assert_eq!(line(r#"" twr ""#, r#""""#), r#"{"name":"Tower","kind":"tower","detail":null}"#);
}

fn freqs(list: &[(&str, f64, &str)]) -> String {
    let items: Vec<String> =
        list.iter().map(|(t, mhz, d)| format!("{{\"type\": {t:?}, \"description\": {d:?}, \"frequency_mhz\": {mhz}}}")).collect();
    format!("[{}]", items.join(","))
}

#[test]
fn the_ctaf_and_the_kneeboards_list() {
    let ctaf = |l: &[(&str, f64, &str)]| call("ctaf_of", &format!("{{\"frequencies\": {}}}", freqs(l))).unwrap();
    assert_eq!(ctaf(&[("UNIC", 122.8, "UNIC"), ("CTAF", 122.7, "CTAF")]), "1");
    assert_eq!(ctaf(&[("UNIC", 123.0, "CTAF/UNICOM")]), "0");
    assert_eq!(ctaf(&[("UNIC", 122.95, "UNIC")]), "0");
    assert_eq!(ctaf(&[("AWOS", 118.375, "AWOS")]), r#"{"type":"MULTICOM","description":"MULTICOM","frequency_mhz":122.9}"#);
    let knee = |l: &[(&str, f64, &str)]| call("kneeboard_radio", &format!("{{\"frequencies\": {}}}", freqs(l))).unwrap();
    assert_eq!(knee(&[("AWOS", 118.375, "AWOS")]), r#"[["AWOS",118.375],["MULTICOM",122.9]]"#);
    assert_eq!(knee(&[("UNIC", 123.0, "CTAF/UNICOM")]), r#"[["CTAF",123.0]]"#);
    assert_eq!(knee(&[("ATIS", 135.4, "ATIS"), ("TWR", 118.3, "TWR"), ("UNIC", 122.95, "UNIC")]), r#"[["ATIS",135.4],["TWR",118.3]]"#);
    assert_eq!(knee(&[("TWR", 118.3, "TWR")]), r#"[["TWR",118.3]]"#);
    let of = |types: &str| {
        call("frequency_of", &format!("{{\"frequencies\": {}, \"types\": {types}}}", freqs(&[("gnd", 121.7, ""), ("ASOS", 119.0, "")]))).unwrap()
    };
    assert_eq!(of(r#"["AWOS", "ASOS"]"#), "1");
    assert_eq!(of(r#"["GND"]"#), "0");
    assert_eq!(of(r#"["TWR"]"#), "null");
}

#[test]
fn class_b_c_and_d_entry_rules_each_with_its_section() {
    let rules = |c: &str| call("airspace_entry_rules", &format!("{{\"class\": {c:?}}}")).unwrap();
    let b = rules("B");
    assert!(b.starts_with(r#"{"rules":[{"rule":"An ATC clearance before you enter","cite":"14 CFR 91.131(a)(1)"}"#), "{b}");
    assert!(b.contains(r#"above it to 10,000 ft MSL, and within 30 nm of its primary airport","cite":"14 CFR 91.215(b), 91.225(d)""#), "{b}");
    // 91.117(b)'s 200 kt is C's and D's; B's is (c) under it.
    assert!(b.contains(r#""cite":"14 CFR 91.117(a), (c)""#), "{b}");
    assert!(b.ends_with(r#""call":["APP","TWR"]}"#), "{b}");
    assert!(rules("C").contains(r#""rule":"Two-way radio contact with ATC before you enter","cite":"14 CFR 91.130(c)(1)""#));
    let d = rules("D");
    assert!(d.contains(r#""cite":"14 CFR 91.129(c)(1)""#));
    assert!(d.contains(r#""200 kt at or below 2,500 ft above the surface within 4 nm of its primary airport","cite":"14 CFR 91.117(b)""#));
    // No transponder rule of D's own (91.215(b) names A, B and C).
    assert!(!d.contains("transponder"));
    assert!(d.ends_with(r#""call":["TWR"]}"#));
    assert!(call("airspace_entry_rules", r#"{"class": "BC"}"#).is_err());
}

// Joliet's VOR/DME as NASR files it (NAV_BASE, 2026-10-29): 2° E.
const JOT: (f64, f64) = (41.54641852, -88.31841055);

fn jot(var: &str) -> String {
    format!("{{\"ident\": \"JOT\", \"lat\": {}, \"lon\": {}, \"mag_var\": {var}}}", JOT.0, JOT.1)
}

#[test]
fn a_vors_radial_its_morse_and_its_service_volume() {
    let radial = |var: &str, lat: f64, lon: f64| call("radial_of", &format!("{{\"station\": {}, \"at\": {{\"lat\": {lat}, \"lon\": {lon}}}}}", jot(var))).unwrap();
    // Due north of a 2° E VOR is its 358 radial, 178 to fly to it, 30 nm.
    let north = radial("2", JOT.0 + 0.5, JOT.1);
    assert!(north.starts_with(r#"{"radial":358.0,"to_course":178.0,"nm":30.02"#), "{north}");
    // A west declination the other way: 4° W puts due east on its 094.
    let east = radial("-4", JOT.0, JOT.1 + 0.5);
    assert!(east.starts_with(r#"{"radial":93.8"#), "{east}");
    assert_eq!(radial("null", JOT.0, JOT.1), "null");
    let far = r#"{"ident": "XXX", "lat": 45, "lon": -90, "mag_var": 0}"#;
    let frd = call("fix_radial_distance", &format!("{{\"at\": {{\"lat\": {}, \"lon\": {}}}, \"stations\": [{far}, {}]}}", JOT.0 + 0.2, JOT.1, jot("2")));
    assert_eq!(frd.unwrap(), "\"JOT 358° 12 nm\"");
    assert_eq!(call("fix_radial_distance", r#"{"at": {"lat": 41, "lon": -88}, "stations": []}"#).unwrap(), "null");
    assert_eq!(text("morse", r#"{"ident": "JOT"}"#), "·−−−  −−−  −");
    assert_eq!(text("morse", r#"{"ident": "k-9"}"#), "−·−  −−−−·");
    assert_eq!(text("service_volume", r#"{"code": "T"}"#), "Terminal · 25 nm, 1,000–12,000 ft above it");
    assert_eq!(text("service_volume", r#"{"code": "VL"}"#), "VOR Low · 40 nm under 5,000 ft above it, 70 nm to 18,000");
    assert_eq!(call("service_volume", r#"{"code": "X"}"#).unwrap(), "null");
    assert_eq!(text("navaid_hours", r#"{"hours": "24"}"#), "Continuous");
    assert_eq!(call("navaid_hours", r#"{"hours": ""}"#).unwrap(), "null");
}

#[test]
fn the_variation_agrees_with_noaas_calculator() {
    // The rows tests/test_magnetic.py holds wingtip.magnetic to.
    for (lat, lon, noaa) in [(44.58, -90.14, -2.55629), (42.33, -88.08, -3.89582), (43.02, -89.0, -3.274)] {
        let at: f64 = call("magnetic_variation", &format!("{{\"lat\": {lat}, \"lon\": {lon}, \"date\": \"2026-09-21\"}}")).unwrap().parse().unwrap();
        assert!((at - noaa).abs() < 0.05, "{lat} {lon}: {at} against {noaa}");
    }
    // West and negative east of the agonic line, east and positive west.
    let at = |lat: f64, lon: f64, date: &str| -> f64 {
        call("magnetic_variation", &format!("{{\"lat\": {lat}, \"lon\": {lon}, \"date\": {date:?}}}")).unwrap().parse().unwrap()
    };
    assert!(at(41.9, -87.6, "2026-09-21") < 0.0);
    assert!(at(47.6, -122.3, "2026-09-21") > 0.0);
    // A date past the model held at its edge rather than failing.
    assert!((at(42.3, -88.1, "2099-01-01") - at(42.3, -88.1, "2029-11-12")).abs() < 0.05);
    assert!(call("magnetic_variation", r#"{"lat": 1, "lon": 1, "date": "2026-02-30"}"#).is_err());
    assert!(call("magnetic_variation", r#"{"lat": 1, "lon": 1, "date": "today"}"#).is_err());
}
