//! Instrument approaches taught and debriefed (crate::approach): every
//! case of the web's approachDebrief.test.ts and approachLesson.test.ts,
//! asked by name as each host asks. The debrief's procedures are KBUR's
//! ILS Y RWY 08 and RNAV (GPS) Z RWY 08 as the planner draws them from the
//! CIFP of 1 Oct 2026, read from the fixture the web's tests read
//! (web/src/lib/fixtures/approachKbur.json).

use serde_json::{json, Value};
use std::path::PathBuf;
use wingtip_engine::call::call;
use wingtip_engine::geo::{bearing_deg, destination, distance_nm};

fn ask(name: &str, input: Value) -> Value {
    let text = call(name, &input.to_string()).unwrap_or_else(|e| panic!("{name}: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{name} answered {text}: {e}"))
}

fn kbur() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web/src/lib/fixtures/approachKbur.json");
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn drawing(id: &str) -> Value {
    kbur()[id].clone()
}

const FT_PER_NM: f64 = 6076.12;
const RW08: (f64, f64) = (34.197911, -118.369142);

type Ll = (f64, f64);

fn ll(p: &Value) -> Ll {
    (p[0].as_f64().unwrap(), p[1].as_f64().unwrap())
}

fn nm(a: Ll, b: Ll) -> f64 {
    distance_nm(a.0, a.1, b.0, b.1)
}

fn bearing(a: Ll, b: Ll) -> f64 {
    bearing_deg(a.0, a.1, b.0, b.1)
}

fn dest(a: Ll, course: f64, d: f64) -> Ll {
    destination(a.0, a.1, course, d)
}

#[derive(Default)]
struct Fly {
    off: Option<Box<dyn Fn(f64) -> f64>>,
    alt: Option<Box<dyn Fn(f64) -> f64>>,
    after: usize,
    after_alt: Option<Box<dyn Fn(f64) -> f64>>,
    after_kt: Option<Box<dyn Fn(f64) -> f64>>,
}

/// A track flown along a line of points at 120 kt, a point a second: each
/// `off(to_go)` nm right of it (left negative) and at `alt(to_go)` ft,
/// to_go the distance left to the line's end; then `after` seconds beyond
/// it on the same course, at `after_alt(s)` and `after_kt(s)`. The web
/// test's `fly`.
fn fly(line: &[Ll], o: Fly) -> Vec<Value> {
    let legs: Vec<(Ll, Ll, f64)> = line.windows(2).map(|w| (w[0], w[1], nm(w[0], w[1]))).collect();
    let total: f64 = legs.iter().map(|l| l.2).sum();
    let t0 = 1_761_836_400_000.0; // 2026-10-30T15:00:00Z
    let kt = 120.0;
    let mut points = Vec::new();
    let mut s = 0.0;
    let mut along = 0.0;
    while along <= total {
        let (mut rest, mut k) = (along, 0);
        while k < legs.len() - 1 && rest > legs[k].2 {
            rest -= legs[k].2;
            k += 1;
        }
        let (a, b, len) = legs[k];
        let course = bearing(a, b);
        let on = dest(a, course, rest.min(len));
        let to_go = total - along;
        let off = o.off.as_ref().map_or(0.0, |f| f(to_go));
        let p = if off != 0.0 { dest(on, course + if off > 0.0 { 90.0 } else { -90.0 }, off.abs()) } else { on };
        let alt = o.alt.as_ref().map(|f| f(to_go));
        points.push(json!({"t": t0 + s * 1000.0, "lat": p.0, "lon": p.1, "alt_ft": alt}));
        s += 1.0;
        along = (s * kt) / 3600.0;
    }
    let end = line[line.len() - 1];
    let course = bearing(line[line.len() - 2], end);
    let mut past = 0.0;
    for k in 1..=o.after {
        let k = k as f64;
        past += o.after_kt.as_ref().map_or(kt, |f| f(k)) / 3600.0;
        let p = dest(end, course, past);
        let alt = o.after_alt.as_ref().map(|f| f(k));
        points.push(json!({"t": t0 + (s + k - 1.0) * 1000.0, "lat": p.0, "lon": p.1, "alt_ft": alt}));
    }
    points
}

/// A procedure's way in, as a line to fly: its transition and its final,
/// from 2 nm before its first fix on the course into it.
fn way_in(d: &Value) -> Vec<Ll> {
    let mut line: Vec<Ll> = Vec::new();
    for l in d["lines"].as_array().unwrap() {
        if l["role"] == "missed" {
            continue;
        }
        for p in l["points"].as_array().unwrap().iter().map(ll) {
            if line.last().is_none_or(|&q| nm(q, p) > 0.001) {
                line.push(p);
            }
        }
    }
    let first = dest(line[0], bearing(line[1], line[0]), 2.0);
    std::iter::once(first).chain(line).collect()
}

fn final_of(d: &Value) -> Vec<Ll> {
    let mut f = d.clone();
    let lines: Vec<Value> = d["lines"].as_array().unwrap().iter().filter(|l| l["role"] != "transition").cloned().collect();
    f["lines"] = Value::Array(lines);
    way_in(&f)
}

fn length_of(line: &[Ll]) -> f64 {
    line.windows(2).map(|w| nm(w[0], w[1])).sum()
}

fn gp() -> Value {
    drawing("I08-Y")["runway_path"].clone()
}

fn glidepath_ft(nm_out: f64) -> f64 {
    ask("glidepath_ft", json!({"runway_path": gp(), "nm_out": nm_out})).as_f64().unwrap()
}

fn gp_ft() -> f64 {
    gp()["ft"].as_f64().unwrap()
}

/// The ILS flown as charted: 3,700 to SILEX, 3,000 to the glide slope,
/// then down it to the runway.
fn on_ils() -> Box<dyn Fn(f64) -> f64> {
    Box::new(|to_go| glidepath_ft(to_go).min(if to_go > 11.0 { 3700.0 } else { 3000.0 }))
}

/// A missed approach from the runway, its climb begun `wait` s past it.
fn missed_after(wait: f64) -> Box<dyn Fn(f64) -> f64> {
    let ft = gp_ft();
    Box::new(move |s| if s <= wait { ft } else { ft + ((s - wait) * 1000.0) / 60.0 })
}

fn debrief(d: &Value, points: &[Value], minimums: Option<f64>) -> Value {
    ask("approach_debrief", json!({"drawing": d, "points": points, "minimums_ft": minimums}))
}

fn texts(d: &Value) -> Vec<String> {
    d["findings"].as_array().unwrap().iter().map(|f| f["text"].as_str().unwrap().to_owned()).collect()
}

fn findings_toned(d: &Value, tones: &[&str]) -> Vec<Value> {
    d["findings"].as_array().unwrap().iter().filter(|f| tones.contains(&f["tone"].as_str().unwrap())).cloned().collect()
}

fn find(drawings: &[Value], points: &[Value], picked: Option<&str>) -> Vec<Value> {
    ask("approach_find", json!({"drawings": drawings, "points": points, "picked": picked})).as_array().unwrap().clone()
}

fn ils_track(after: usize, wait: f64) -> Vec<Value> {
    fly(&final_of(&drawing("I08-Y")), Fly { alt: Some(on_ils()), after, after_alt: Some(missed_after(wait)), ..Default::default() })
}

fn ils_landing() -> Vec<Value> {
    fly(
        &final_of(&drawing("I08-Y")),
        Fly {
            alt: Some(on_ils()),
            after: 120,
            after_alt: Some(Box::new(|_| 727.0)),
            after_kt: Some(Box::new(|s| (120.0 - s * 3.0).max(5.0))),
            ..Default::default()
        },
    )
}

// --- the figures it is held to

#[test]
fn the_glidepath_at_the_faf_is_the_charts_glide_slope_altitude() {
    // ARINC 424-18 5.29 code "I" at BUDDE: 3,000 ft, the glide slope at
    // 2,753 ft; 3.00° up from RW08's 787 ft (its 727 ft threshold and 60
    // ft crossing height), over the curve of the earth.
    let ils = drawing("I08-Y");
    let budde = ils["fixes"].as_array().unwrap().iter().find(|f| f["ident"] == "BUDDE").unwrap();
    let out = nm((budde["lat"].as_f64().unwrap(), budde["lon"].as_f64().unwrap()), RW08);
    assert!((glidepath_ft(out) - 2753.0).abs() < 15.0);
}

#[test]
fn guidance_is_read_from_the_coded_identifier() {
    for (id, want) in [
        ("I08-Y", "localizer"),
        ("L08-Z", "localizer"),
        ("R08-Z", "gps"),
        ("RNV-A", "gps"),
        ("S08", "other"),
        ("VDM-A", "other"),
        ("GPS-B", "gps"),
        ("L08L-Y", "localizer"),
        ("P26L", "gps"),
        ("RNV-", "other"),
        ("", "other"),
    ] {
        assert_eq!(ask("approach_guidance", json!({"id": id})), json!(want), "{id}");
    }
}

#[test]
fn the_localizers_full_scale_is_350_ft_at_the_threshold_opening_at_2_5_deg() {
    // AIM 1-1-9: 700 ft full fly-left to full fly-right at the threshold.
    // At 5 nm out: 350 + 30,381 × tan 2.5° = 1,676 ft, 0.28 nm.
    use wingtip_engine::approach::debrief::{LOCALIZER_DEG, LOCALIZER_THRESHOLD_FT};
    let half = (LOCALIZER_THRESHOLD_FT + 5.0 * FT_PER_NM * (LOCALIZER_DEG * std::f64::consts::PI / 180.0).tan()) / FT_PER_NM;
    assert!((half - 0.276).abs() < 0.005);
}

// --- an ILS flown as charted

#[test]
fn an_ils_flown_as_charted_scores_clean() {
    let d = debrief(&drawing("I08-Y"), &ils_track(120, 12.0), None);
    assert!(!d.is_null());
    assert!(d["fit_nm"].as_f64().unwrap() < 0.01);
    assert_eq!(findings_toned(&d, &["stop", "caution"]), Vec::<Value>::new());
    assert!(texts(&d).iter().any(|t| t.starts_with("Within full scale all the way")));
    let idents: Vec<&str> = d["crossings"].as_array().unwrap().iter().map(|c| c["ident"].as_str().unwrap()).collect();
    assert_eq!(idents, ["SILEX", "BUDDE", "RW08"]);
    assert!(!d["plan"]["track"].as_array().unwrap().iter().any(|p| p["off"] == true));
}

#[test]
fn the_missed_approachs_start_is_timed_from_the_map() {
    let d = debrief(&drawing("I08-Y"), &ils_track(120, 12.0), None);
    assert_eq!(d["outcome"]["kind"], "missed");
    let s = d["outcome"]["seconds_after_map"].as_f64().unwrap();
    assert!((10.0..=14.0).contains(&s), "{s}");
    assert!(texts(&d).iter().any(|t| {
        t.strip_prefix("Missed approach started 1")
            .and_then(|r| r.strip_suffix(" s after the MAP"))
            .is_some_and(|n| n.len() == 1 && ('0'..='4').contains(&n.chars().next().unwrap()))
    }));
}

#[test]
fn a_landing_is_said_as_one() {
    let d = debrief(&drawing("I08-Y"), &ils_landing(), None);
    assert_eq!(d["outcome"]["kind"], "landed");
    assert!(texts(&d).iter().any(|t| t.starts_with("Landed")));
}

#[test]
fn it_is_found_among_the_fields_approaches_the_rnav_named_with_it() {
    let found = find(&[drawing("R08-Z"), drawing("I08-Y")], &ils_track(120, 12.0), None);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0]["id"], "I08-Y");
    assert!(found[0]["also_fits"].as_array().unwrap().contains(&json!("RNAV (GPS) Z RWY 08")));
}

#[test]
fn the_one_the_pilot_picked_wins_where_two_fit_alike() {
    // Both laterally on the same final and neither's glidepath followed:
    // no altitudes.
    let flat = fly(&final_of(&drawing("I08-Y")), Fly { after: 60, ..Default::default() });
    assert_eq!(find(&[drawing("I08-Y"), drawing("R08-Z")], &flat, Some("R08-Z"))[0]["id"], "R08-Z");
}

// --- what it flags

#[test]
fn a_track_a_mile_off_the_final_is_flagged_full_scale_on_final() {
    // A mile left from 4.5 to 2.5 nm out, back on by the runway.
    let off = |t: f64| {
        if t < 4.5 && t > 2.5 {
            -1.0
        } else if t <= 2.5 && t > 2.0 {
            -(t - 2.0) * 2.0
        } else {
            0.0
        }
    };
    let track = fly(
        &final_of(&drawing("I08-Y")),
        Fly { alt: Some(on_ils()), off: Some(Box::new(off)), after: 60, after_alt: Some(missed_after(5.0)), ..Default::default() },
    );
    let d = debrief(&drawing("I08-Y"), &track, None);
    let lateral = d["findings"].as_array().unwrap().iter().find(|f| f["text"].as_str().unwrap().starts_with("Full scale left of the course")).unwrap();
    assert_eq!(lateral["tone"], "stop");
    let text = lateral["text"].as_str().unwrap();
    assert!(text.ends_with("on final, 1.0 nm off at most"), "{text}");
    let miles: f64 = text.split("for ").nth(1).unwrap().split(" nm").next().unwrap().parse().unwrap();
    assert!(miles > 1.8 && miles < 3.1, "{miles}");
    assert!(d["plan"]["track"].as_array().unwrap().iter().any(|p| p["off"] == true));
}

#[test]
fn a_track_that_never_came_near_the_faf_is_no_approach_of_it() {
    let wide = fly(&final_of(&drawing("I08-Y")), Fly { off: Some(Box::new(|_| 2.0)), alt: Some(on_ils()), ..Default::default() });
    assert_eq!(ask("approach_attempts", json!({"drawing": drawing("I08-Y"), "points": wide})), json!([]));
    assert!(debrief(&drawing("I08-Y"), &wide, None).is_null());
    assert!(find(&[drawing("I08-Y"), drawing("R08-Z")], &wide, None).is_empty());
}

#[test]
fn on_an_rnav_a_mile_off_before_the_faf_is_within_terminal_full_scale_after_it_is_not() {
    let mikei = drawing("R08-Z:MIKEI");
    let line = way_in(&mikei);
    let mikei_to_go = length_of(&line[1..]);
    let alt = move |t: f64| {
        if t > mikei_to_go - 2.0 {
            7000.0
        } else if t > 6.0 {
            4100.0
        } else if t > 5.2 {
            3000.0
        } else {
            1200.0
        }
    };
    let half = |t: f64| if (t > 7.0 && t < 9.0) || (t > 1.5 && t < 3.0) { 0.6 } else { 0.0 };
    let track = fly(
        &line,
        Fly {
            alt: Some(Box::new(alt)),
            off: Some(Box::new(half)),
            after: 90,
            after_alt: Some(Box::new(|s| 1200.0 + s * 15.0)),
            ..Default::default()
        },
    );
    let d = debrief(&mikei, &track, None);
    let full: Vec<String> = texts(&d).into_iter().filter(|t| t.starts_with("Full scale")).collect();
    // ±1 nm before the ramp (AIM 1-1-17), ±0.3 nm down the final.
    assert_eq!(full.len(), 1, "{full:?}");
    assert!(full[0].starts_with("Full scale right of the course") && full[0].contains(" on final"), "{}", full[0]);
}

#[test]
fn a_track_under_a_fixs_altitude_before_it_is_flagged() {
    // The RNAV via MIKEI, down to 3,500 a mile and a half before SILEX's
    // 4,100 (at or above).
    let mikei = drawing("R08-Z:MIKEI");
    let line = way_in(&mikei);
    let silex_to_go = length_of(&line[2..]);
    let alt = move |t: f64| {
        if t > silex_to_go + 1.5 {
            7000.0
        } else if t > 5.5 {
            3500.0
        } else {
            1200.0
        }
    };
    let track = fly(&line, Fly { alt: Some(Box::new(alt)), after: 60, after_alt: Some(Box::new(|s| 1200.0 + s * 15.0)), ..Default::default() });
    let d = debrief(&mikei, &track, None);
    let silex = d["findings"].as_array().unwrap().iter().find(|f| f["text"].as_str().unwrap().contains("SILEX")).unwrap().clone();
    assert_eq!(silex, json!({"tone": "stop", "text": "At SILEX: 600 ft below 4,100"}));
    let under = d["crossings"].as_array().unwrap().iter().find(|c| c["ident"] == "SILEX").unwrap()["under_ft"].as_f64().unwrap();
    assert!((under - 600.0).abs() < 0.5, "{under}");
}

#[test]
fn under_a_step_down_inside_the_final_is_marked_for_an_mdas_minimums() {
    // RNAV Z 08 with a step-down fix halfway down its final at 1,800.
    let rnav = drawing("R08-Z");
    let final_line = rnav["lines"].as_array().unwrap().iter().find(|l| l["role"] == "final").unwrap().clone();
    let (bubne, himen) = (ll(&final_line["points"][1]), ll(&final_line["points"][2]));
    let mid = ((bubne.0 + himen.0) / 2.0, (bubne.1 + himen.1) / 2.0);
    let mut stepped = rnav.clone();
    stepped["lines"] = Value::Array(
        rnav["lines"]
            .as_array()
            .unwrap()
            .iter()
            .map(|l| {
                if l["role"] == "final" {
                    let mut l = l.clone();
                    l["points"] = json!([l["points"][0], [bubne.0, bubne.1], [mid.0, mid.1], [himen.0, himen.1]]);
                    l
                } else {
                    l.clone()
                }
            })
            .collect(),
    );
    let fixes = rnav["fixes"].as_array().unwrap();
    let mut new_fixes: Vec<Value> = fixes[..2].to_vec();
    new_fixes.push(json!({"ident": "STEPP", "lat": mid.0, "lon": mid.1, "roles": [], "min_ft": 1800, "max_ft": null, "missed": false}));
    new_fixes.extend_from_slice(&fixes[2..]);
    stepped["fixes"] = Value::Array(new_fixes);
    let mid_to_go = nm(mid, himen);
    let alt = move |t: f64| {
        if t > 5.4 {
            4100.0
        } else if t > mid_to_go + 1.0 {
            2400.0
        } else {
            1500.0
        }
    };
    let track =
        fly(&final_of(&stepped), Fly { alt: Some(Box::new(alt)), after: 60, after_alt: Some(Box::new(|s| 1500.0 + s * 15.0)), ..Default::default() });
    let d = debrief(&stepped, &track, None);
    let stepp = d["findings"].as_array().unwrap().iter().find(|f| f["text"].as_str().unwrap().contains("STEPP")).unwrap().clone();
    assert_eq!(stepp, json!({"tone": "caution", "text": "At STEPP: 300 ft below 1,800 (an MDA's step-down, not a glidepath's)"}));
}

#[test]
fn under_the_pilots_minimums_before_a_missed_approach_is_flagged() {
    let d = debrief(&drawing("I08-Y"), &ils_track(60, 3.0), Some(1000.0));
    let down = d["findings"].as_array().unwrap().iter().find(|f| f["text"].as_str().unwrap().starts_with("Down to")).unwrap();
    assert_eq!(down["tone"], "stop");
    // Typed again: at or above lower minimums, and the old finding gone.
    let lower = ask(
        "approach_minimums",
        json!({"findings": d["findings"], "lowest_ft": d["lowest_ft"], "outcome": d["outcome"]["kind"], "minimums_ft": 700}),
    );
    let mins: Vec<&Value> = lower.as_array().unwrap().iter().filter(|f| f["minimums"] == true).collect();
    assert_eq!(mins, [&json!({"tone": "ok", "text": "Lowest before the MAP: 787 ft, at or above 700", "minimums": true})]);
}

#[test]
fn under_the_minimums_to_land_is_what_91_175_c_allows() {
    let d = debrief(&drawing("I08-Y"), &ils_landing(), Some(1000.0));
    let f = d["findings"].as_array().unwrap().iter().find(|f| f["minimums"] == true).unwrap().clone();
    assert_eq!(f, json!({"tone": "info", "text": "Below 1,000 to land: 91.175(c) asks for the runway in sight there", "minimums": true}));
}

#[test]
fn below_the_glide_slopes_full_scale_is_flagged() {
    let ils = on_ils();
    let low = move |t: f64| if t < 4.0 && t > 2.0 { ils(t) - 400.0 } else { ils(t) };
    let track = fly(&final_of(&drawing("I08-Y")), Fly { alt: Some(Box::new(low)), after: 60, after_alt: Some(missed_after(5.0)), ..Default::default() });
    let d = debrief(&drawing("I08-Y"), &track, None);
    assert!(d["findings"]
        .as_array()
        .unwrap()
        .iter()
        .any(|f| f["tone"] == "stop" && f["text"].as_str().unwrap().starts_with("Below the glide slope's full scale")));
    let gp = texts(&d).into_iter().find(|t| t.starts_with("Glidepath")).unwrap();
    assert!(gp.ends_with("to 400 ft below it"), "{gp}");
}

// --- what it has to go on

#[test]
fn a_track_with_no_altitudes_is_debriefed_on_its_course_alone() {
    let d = debrief(&drawing("I08-Y"), &fly(&final_of(&drawing("I08-Y")), Fly { after: 60, ..Default::default() }), None);
    assert_eq!(d["has_altitude"], false);
    assert!(texts(&d).iter().any(|t| t == "The track has no altitudes: the course alone is debriefed"));
    assert!(d["crossings"].as_array().unwrap().iter().all(|c| c["alt_ft"].is_null() && c["under_ft"].is_null()));
    assert_eq!(d["outcome"]["kind"], "unknown");
    assert_eq!(d["profile"]["track"], json!([]));
}

fn with_transition(vectors: &Value, drawings: &[Value], points: &[Value]) -> Option<String> {
    let best = ask(
        "approach_transition",
        json!({"faf_at": vectors["faf_at"], "passed": vectors["way_in"]["passed"], "drawings": drawings, "points": points}),
    );
    let chosen = if best.is_null() { vectors } else { &best };
    chosen["transition"].as_str().map(str::to_owned)
}

#[test]
fn the_transition_flown_is_found_and_the_vectors_where_none_was() {
    let ils = on_ils();
    let via_lax = fly(
        &way_in(&drawing("I08-Y:LAX")),
        Fly {
            alt: Some(Box::new(move |t| if t > 11.0 { 4600.0 } else { ils(t) })),
            after: 60,
            after_alt: Some(missed_after(5.0)),
            ..Default::default()
        },
    );
    let vectors = find(&[drawing("I08-Y")], &via_lax, None)[0].clone();
    assert!(vectors["transition"].is_null());
    assert_eq!(with_transition(&vectors, &[drawing("I08-Y:LAX")], &via_lax).as_deref(), Some("LAX"));
    let straight_in = ils_track(60, 5.0);
    let from_vectors = find(&[drawing("I08-Y")], &straight_in, None)[0].clone();
    assert_eq!(with_transition(&from_vectors, &[drawing("I08-Y:LAX")], &straight_in), None);
}

#[test]
fn two_attempts_are_two_approaches() {
    let once = ils_track(60, 5.0);
    let again: Vec<Value> = once
        .iter()
        .map(|p| {
            let mut p = p.clone();
            p["t"] = json!(p["t"].as_f64().unwrap() + 20.0 * 60_000.0);
            p
        })
        .collect();
    // The way back round, far off the final, between them.
    let last_t = once.last().unwrap()["t"].as_f64().unwrap();
    let between: Vec<Value> =
        (0..30).map(|k| json!({"t": last_t + (k as f64 + 1.0) * 30_000.0, "lat": 34.4, "lon": -118.5 + k as f64 * 0.001, "alt_ft": 3000})).collect();
    let all: Vec<Value> = once.into_iter().chain(between).chain(again).collect();
    assert_eq!(find(&[drawing("I08-Y")], &all, None).len(), 2);
}

#[test]
fn bad_asks_are_errors_not_panics() {
    assert!(call("approach_debrief", "{}").is_err());
    assert!(call("approach_debrief", r#"{"drawing": 3, "points": []}"#).is_err());
    let d = drawing("I08-Y");
    let attempt = json!({"drawing": d, "points": [{"t": 0, "lat": 34.2, "lon": -118.5}], "attempt": {"faf": 5, "from": 0, "to": 9}});
    assert!(call("approach_debrief", &attempt.to_string()).is_err());
    assert_eq!(ask("approach_debrief", json!({"drawing": d, "points": []})), Value::Null);
    assert_eq!(ask("approach_find", json!({"drawings": [d], "points": []})), json!([]));
    assert!(call("approach_minimums", r#"{"findings": [{"tone": "loud", "text": "x"}], "outcome": "missed"}"#).is_err());
}

// --- the lesson (approachLesson.test.ts): KDLH's ILS 09 via DLH as the
// CIFP of 29 Oct 2026 codes it, its places rounded, and a bare VOR.

fn kdlh() -> Value {
    json!({
        "airport": "KDLH", "kind": "approach", "id": "I09", "name": "ILS RWY 09", "transition": "DLH", "cycle": "261029", "stale": false,
        "glidepath_deg": 3, "final_course_deg": 93,
        "lines": [
            {"role": "transition", "name": "DLH", "points": [[46.80, -92.20], [46.84, -92.36]]},
            {"role": "final", "name": null, "points": [[46.84, -92.36], [46.84, -92.33], [46.84, -92.30], [46.842, -92.21]]},
            {"role": "missed", "name": null, "points": [[46.842, -92.21], [46.843, -92.17], [47.0, -92.1]]},
        ],
        "holds": [
            {"fix": "DL", "turn": "R", "inbound_deg": 92, "missed": false, "kind": "hold", "points": [[46.84, -92.36], [46.83, -92.40], [46.84, -92.36]]},
            {"fix": "CHERL", "turn": "R", "inbound_deg": 196, "missed": true, "kind": "hold", "points": [[47.0, -92.1], [47.02, -92.12], [47.0, -92.1]]},
        ],
        "fixes": [
            {"ident": "DLH", "lat": 46.80, "lon": -92.20, "roles": [], "min_ft": null, "max_ft": null, "missed": false},
            {"ident": "DL", "lat": 46.84, "lon": -92.36, "roles": ["IAF", "hold"], "min_ft": 3300, "max_ft": null, "missed": false},
            {"ident": "CFBSJ", "lat": 46.84, "lon": -92.33, "roles": ["FACF"], "min_ft": 3300, "max_ft": null, "missed": false},
            {"ident": "PYKLA", "lat": 46.84, "lon": -92.30, "roles": ["FAF"], "min_ft": 3300, "max_ft": null, "missed": false, "vertical_angle_deg": 3},
            {"ident": "RW09", "lat": 46.842, "lon": -92.21, "roles": ["MAP"], "min_ft": null, "max_ft": null, "missed": false, "vertical_angle_deg": 3},
            {"ident": "CHERL", "lat": 47.0, "lon": -92.1, "roles": ["hold"], "min_ft": 4500, "max_ft": null, "missed": true},
        ],
        "missed_legs": [
            {"path": "CA", "fix": null, "course_deg": 93, "turn": null, "min_ft": 3000, "max_ft": null},
            {"path": "VI", "fix": null, "course_deg": 320, "turn": "L", "min_ft": null, "max_ft": null},
            {"path": "CF", "fix": "CHERL", "course_deg": 17, "turn": null, "min_ft": 4500, "max_ft": null},
            {"path": "HM", "fix": "CHERL", "course_deg": 197, "turn": "R", "min_ft": 4500, "max_ft": null},
        ],
    })
}

fn bare() -> Value {
    json!({
        "airport": "KXYZ", "kind": "approach", "id": "V27", "name": "VOR RWY 27", "transition": null, "cycle": "261029", "stale": false, "missed_legs": [],
        "lines": [{"role": "final", "name": null, "points": [[45, -93], [45, -93.1], [45, -93.2], [45, -93.25]]}],
        "holds": [],
        "fixes": [
            {"ident": "AAAAA", "lat": 45, "lon": -93, "roles": ["FAF"], "min_ft": 2500, "max_ft": null, "missed": false},
            {"ident": "BBBBB", "lat": 45, "lon": -93.1, "roles": [], "min_ft": 1900, "max_ft": null, "missed": false},
            {"ident": "CCCCC", "lat": 45, "lon": -93.2, "roles": [], "min_ft": 1520, "max_ft": null, "missed": false},
            {"ident": "RW27", "lat": 45, "lon": -93.25, "roles": ["MAP"], "min_ft": null, "max_ft": null, "missed": false},
        ],
    })
}

fn radio() -> Value {
    json!([
        {"type": "ATIS", "description": "ATIS", "frequency_mhz": 124.1},
        {"type": "APP", "description": "MINNEAPOLIS APP", "frequency_mhz": 125.0},
        {"type": "TWR", "description": "DULUTH TWR", "frequency_mhz": 118.3},
        {"type": "GND", "description": "GND", "frequency_mhz": 121.9},
    ])
}

fn fpm(gs: f64, angle: f64) -> f64 {
    ask("approach_descent_fpm", json!({"gs_kt": gs, "angle_deg": angle})).as_f64().unwrap()
}

#[test]
fn descent_rate_is_the_faas_table() {
    // The TPP's Rate of Descent Table, 3.0°: 318 at 60 kt, 478 at 90, 637 at 120.
    assert!((fpm(60.0, 3.0) - 318.0).abs() < 0.5);
    assert!((fpm(90.0, 3.0) - 478.0).abs() < 0.5);
    assert!((fpm(120.0, 3.0) - 637.0).abs() < 0.5);
    // About ground speed x 5.3 on 3.00°.
    assert!((fpm(100.0, 3.0) / 100.0 - 5.3).abs() < 0.05);
    // Steeper is faster: 3.5° at 90 kt, 557.
    assert!((fpm(90.0, 3.5) - 557.0).abs() < 0.5);
    assert_eq!(ask("approach_rounded_fpm", json!({"fpm": fpm(90.0, 3.0)})), json!(480.0));
}

#[test]
fn approach_category_is_97_3s() {
    let cat = |vref: Value, vso: Value| ask("approach_category", json!({"vref_kt": vref, "vso_kt": vso}));
    assert_eq!(cat(json!(90.9), Value::Null), json!("A"));
    assert_eq!(cat(json!(91), Value::Null), json!("B"));
    assert_eq!(cat(json!(120.9), Value::Null), json!("B"));
    assert_eq!(cat(json!(121), Value::Null), json!("C"));
    assert_eq!(cat(json!(141), Value::Null), json!("D"));
    assert_eq!(cat(json!(166), Value::Null), json!("E"));
    // 1.3 x 60 = 78, A; 1.3 x 70 = 91, B. VREF first where both are known.
    assert_eq!(cat(Value::Null, json!(60)), json!("A"));
    assert_eq!(cat(Value::Null, json!(70)), json!("B"));
    assert_eq!(cat(json!(85), json!(70)), json!("A"));
    assert_eq!(cat(Value::Null, Value::Null), Value::Null);
    assert_eq!(cat(json!(0), json!(70)), Value::Null);
}

#[test]
fn minimums_kind_is_a_da_an_mda_or_either() {
    for (name, want) in [
        ("ILS RWY 09", "DA"),
        ("RNAV (RNP) Y RWY 08", "DA"),
        ("RNAV (GPS) Y RWY 26L", "DA or MDA"),
        ("LOC RWY 09", "MDA"),
        ("VOR/DME-A", "MDA"),
        ("GPS-A", "DA or MDA"),
        ("GPSX", "MDA"),
        ("ILS", "DA"),
    ] {
        assert_eq!(ask("approach_minimums_kind", json!({"name": name})), json!(want), "{name}");
    }
}

fn missed_words(legs: Value) -> Value {
    ask("approach_missed_words", json!({"legs": legs}))
}

#[test]
fn the_missed_approach_in_the_plates_words() {
    assert_eq!(
        missed_words(kdlh()["missed_legs"].clone()),
        json!("Climb to 3,000 on course 093°, then left turn to heading 320° to intercept, then on course 017° to CHERL climbing to 4,500, then hold at CHERL, right turns, 197° inbound.")
    );
    assert_eq!(
        missed_words(json!([
            {"path": "CA", "fix": null, "course_deg": 270, "turn": null, "min_ft": 2000, "max_ft": null},
            {"path": "RF", "fix": "X", "course_deg": null, "turn": "R", "min_ft": null, "max_ft": null},
        ])),
        json!("Climb to 2,000 on course 270°, then as the plate shows.")
    );
    assert_eq!(missed_words(json!([{"path": "AF", "fix": "X", "course_deg": null, "turn": "R", "min_ft": null, "max_ft": null}])), Value::Null);
    assert_eq!(missed_words(json!([])), Value::Null);
    assert_eq!(ask("approach_missed_words", json!({})), Value::Null);
    assert_eq!(
        missed_words(json!([
            {"path": "VA", "fix": null, "course_deg": 0, "turn": "R", "min_ft": 3000, "max_ft": null},
            {"path": "DF", "fix": "ABC", "course_deg": null, "turn": null, "min_ft": null, "max_ft": null},
        ])),
        json!("Climbing right turn to 3,000 on heading 360°, then direct ABC.")
    );
}

fn brief(input: Value) -> Vec<Value> {
    ask("approach_brief", input).as_array().unwrap().clone()
}

fn by_key(items: &[Value], key: &str) -> Value {
    items.iter().find(|i| i["key"] == key).unwrap().clone()
}

#[test]
fn the_brief_goes_as_a_briefing_does() {
    let b = brief(json!({"drawing": kdlh(), "frequencies": radio()}));
    let keys: Vec<&str> = b.iter().map(|i| i["key"].as_str().unwrap()).collect();
    assert_eq!(keys, ["approach", "frequencies", "course", "fix:DLH", "fix:DL", "fix:CFBSJ", "fix:PYKLA", "minimums", "map", "missed"]);
    assert_eq!(by_key(&b, "fix:DL")["title"], "Initial Approach Fix");
    assert_eq!(by_key(&b, "fix:CFBSJ")["title"], "Intermediate Fix");
    assert_eq!(by_key(&b, "fix:PYKLA")["title"], "Final Approach Fix");
    let faf = by_key(&b, "fix:PYKLA")["lines"].clone();
    assert!(faf.as_array().unwrap().contains(&json!("Cross at or above 3,300 ft")));
    assert!(faf.as_array().unwrap().contains(&json!("Descend on the 3.00° path from here")));
    assert_eq!(by_key(&b, "frequencies")["lines"], json!(["ATIS 124.1", "Approach 125.0", "Tower 118.3"]));
    assert_eq!(by_key(&b, "course")["lines"], json!(["093° magnetic", "Glidepath 3.00°"]));
    // The minimums are never the coded data's: the plate's.
    assert_eq!(by_key(&b, "minimums")["lines"], json!(["DA: see the plate"]));
    assert_eq!(by_key(&b, "map")["lines"][0], "At the decision altitude on the glidepath");
    assert!(by_key(&b, "missed")["lines"][0].as_str().unwrap().starts_with("Climb to 3,000 on course 093°"));
    // Each shows its fix or its part on the map.
    assert_eq!(by_key(&b, "fix:DL")["focus"], json!({"fix": "DL", "segment": null}));
    assert_eq!(by_key(&b, "missed")["focus"], json!({"fix": null, "segment": "missed"}));
}

#[test]
fn the_brief_says_the_airplanes_category() {
    let b = brief(json!({"drawing": kdlh(), "vso_kt": 48}));
    assert_eq!(by_key(&b, "minimums")["lines"], json!(["DA: see the plate", "Category A"]));
}

#[test]
fn the_brief_says_see_the_plate_and_makes_up_nothing() {
    let b = brief(json!({"drawing": bare()}));
    assert_eq!(by_key(&b, "frequencies")["lines"], json!(["See the plate"]));
    assert_eq!(by_key(&b, "course")["lines"], json!(["See the plate"]));
    assert_eq!(by_key(&b, "missed")["lines"], json!(["See the plate"]));
    assert_eq!(by_key(&b, "minimums")["lines"], json!(["MDA: see the plate"]));
    assert!(by_key(&b, "approach")["lines"].as_array().unwrap().contains(&json!("Vectors to final")));
    assert_eq!(by_key(&b, "fix:BBBBB")["title"], "Step-Down Fix");
    assert!(by_key(&b, "fix:AAAAA")["lines"].as_array().unwrap().contains(&json!("Descend to the MDA from here")));
    assert_eq!(by_key(&b, "map")["lines"], json!(["The runway 27 threshold (MAP)"]));
}

#[test]
fn the_brief_says_a_procedures_data_are_out_of_date() {
    let mut stale = kdlh();
    stale["stale"] = json!(true);
    assert!(brief(json!({"drawing": stale}))[0]["lines"].as_array().unwrap().contains(&json!("Out of date: these are an older cycle's data")));
}

#[test]
fn brief_frequencies_brief_only_what_the_field_lists() {
    let f = |r: Value| ask("approach_brief_frequencies", json!({"frequencies": r}));
    assert_eq!(f(json!([{"type": "UNICOM", "description": "UNICOM", "frequency_mhz": 122.8}])), json!(["Approach: see the plate", "CTAF 122.8"]));
    // ctafOf's MULTICOM 122.9 is a guess, not this field's.
    assert_eq!(f(json!([{"type": "GND", "description": "GND", "frequency_mhz": 121.7}])), json!(["Approach: see the plate"]));
    assert_eq!(f(Value::Null), json!(["See the plate"]));
}

fn coach(d: Value, gs: f64) -> Vec<Value> {
    ask("approach_coaching", json!({"drawing": d, "gs_kt": gs})).as_array().unwrap().clone()
}

fn path_of(d: Value) -> Value {
    ask("approach_lesson_path", json!({"drawing": d}))
}

fn along(path: &Value, lat: f64, lon: f64) -> f64 {
    ask("approach_along_nm", json!({"path": path, "at": {"lat": lat, "lon": lon}})).as_f64().unwrap()
}

#[test]
fn coaching_flies_the_approach_fix_by_fix() {
    let steps = coach(kdlh(), 90.0);
    let keys: Vec<&str> = steps.iter().map(|s| s["key"].as_str().unwrap()).collect();
    assert_eq!(keys, ["fix:DLH", "fix:DL", "fix:CFBSJ", "fix:PYKLA", "decision", "missed"]);
    let faf = &steps[3];
    assert_eq!(faf["title"], "Crossing PYKLA (FAF)");
    assert_eq!(faf["say"], "Descend on the 3.00° path, about 480 ft/min at 90 kt, and start the timer.");
    // PYKLA to the threshold along the line, and the time at 90 kt.
    let path = path_of(kdlh());
    let miles = along(&path, 46.842, -92.21) - along(&path, 46.84, -92.30);
    let secs = ((miles / 90.0) * 3600.0).round() as i64;
    assert_eq!(
        faf["why"],
        json!(format!("The final approach starts here. {miles:.1} nm to the missed approach point: {}:{:02} at 90 kt.", secs / 60, secs % 60))
    );
    assert_eq!(steps[2]["say"], "Cross CFBSJ at or above 3,300 ft and turn onto the final approach course, 093°.");
    assert_eq!(steps[4]["title"], "At the Decision Altitude");
    assert!(steps[4]["say"].as_str().unwrap().starts_with("Runway in sight? Land. Otherwise go missed: climb to 3,000 on course 093°"));
    assert_eq!(steps[5]["focus"], json!({"fix": "CHERL", "segment": "missed"}));
    assert_eq!(steps[5]["at"], json!({"lat": 47.0, "lon": -92.1}));
}

#[test]
fn coaching_gives_the_descent_rate_for_the_ground_speed_picked() {
    assert!(coach(kdlh(), 120.0)[3]["say"].as_str().unwrap().contains("about 640 ft/min at 120 kt"));
}

#[test]
fn coaching_steps_down_where_there_is_no_path() {
    let steps = coach(bare(), 90.0);
    let keys: Vec<&str> = steps.iter().map(|s| s["key"].as_str().unwrap()).collect();
    assert_eq!(keys, ["fix:AAAAA", "fix:BBBBB", "fix:CCCCC", "decision"]);
    assert_eq!(steps[0]["say"], "Descend to 1,900 at BBBBB and start the timer.");
    assert_eq!(steps[1]["say"], "Cross BBBBB at or above 1,900 ft, then descend to 1,520 at CCCCC.");
    assert_eq!(steps[2]["say"], "Cross CCCCC at or above 1,520 ft, then descend to the MDA (see the plate).");
    assert_eq!(steps[3]["title"], "At the Missed Approach Point");
    assert_eq!(steps[3]["say"], "Runway in sight? Land. Otherwise go missed: fly the missed approach the plate shows.");
}

fn quiz(d: Value, gs: f64) -> Vec<Value> {
    ask("approach_quiz", json!({"drawing": d, "gs_kt": gs})).as_array().unwrap().clone()
}

fn answer(q: &Value) -> Value {
    q["choices"][q["answer"].as_u64().unwrap() as usize].clone()
}

#[test]
fn the_quiz_asks_from_the_procedures_own_data() {
    let q = quiz(kdlh(), 90.0);
    let keys: Vec<&str> = q.iter().map(|q| q["key"].as_str().unwrap()).collect();
    assert_eq!(keys, ["alt:DL", "alt:CFBSJ", "alt:PYKLA", "faf", "course", "descent", "decision", "missed-fix"]);
    assert_eq!(answer(&by_key(&q, "faf")), "PYKLA");
    assert!(by_key(&q, "course")["choices"].as_array().unwrap().contains(&json!("093°")));
    assert_eq!(answer(&by_key(&q, "descent")), "480 ft/min");
    assert_eq!(answer(&by_key(&q, "missed-fix")), "CHERL");
}

#[test]
fn the_quiz_never_offers_the_answer_as_a_wrong_choice_nor_any_choice_twice() {
    for d in [kdlh(), bare()] {
        for q in quiz(d, 90.0) {
            let choices = q["choices"].as_array().unwrap();
            let mut seen = choices.clone();
            seen.dedup();
            seen.sort_by_key(|c| c.to_string());
            seen.dedup();
            assert_eq!(seen.len(), choices.len());
            assert_eq!(choices.iter().filter(|c| **c == answer(&q)).count(), 1);
            assert!((2..=4).contains(&choices.len()));
        }
    }
}

#[test]
fn the_quiz_puts_the_answer_in_the_same_place_each_time() {
    assert_eq!(quiz(kdlh(), 90.0), quiz(kdlh(), 90.0));
    // The place is FNV-1a over the key's UTF-16 units, as the web hashed
    // it: "faf" hashes to 2,969,044,746, 2 mod 4 with three wrong choices.
    assert_eq!(by_key(&quiz(kdlh(), 90.0), "faf")["answer"], json!(2));
}

#[test]
fn the_quiz_asks_nothing_it_cannot_offer_a_wrong_choice_for() {
    let mut lone = bare();
    let first = lone["fixes"][0].clone();
    lone["fixes"] = json!([first]);
    assert_eq!(quiz(lone, 90.0), Vec::<Value>::new());
}

#[test]
fn the_lessons_line_runs_transition_final_missed() {
    let path = path_of(kdlh());
    assert_eq!(path.as_array().unwrap().len(), 7);
    let leg = ask(
        "approach_path_between",
        json!({"path": path, "a": {"lat": 46.84, "lon": -92.36}, "b": {"lat": 46.84, "lon": -92.30}}),
    );
    assert_eq!(leg, json!([{"lat": 46.84, "lon": -92.36}, {"lat": 46.84, "lon": -92.33}, {"lat": 46.84, "lon": -92.30}]));
    let empty = ask("approach_path_between", json!({"path": [], "a": {"lat": 1, "lon": 1}, "b": {"lat": 2, "lon": 2}}));
    assert_eq!(empty.as_array().unwrap().len(), 2);
}

#[test]
fn the_side_view_draws_the_path_down_from_the_fafs_altitude() {
    let p = ask("approach_profile", json!({"drawing": kdlh()}));
    let idents: Vec<&str> = p["marks"].as_array().unwrap().iter().map(|m| m["ident"].as_str().unwrap()).collect();
    assert_eq!(idents, ["DLH", "DL", "CFBSJ", "PYKLA", "RW09"]);
    assert!(p["marks"][4]["ft"].is_null());
    // 318 ft a mile on 3.00°, from 3,300 at PYKLA.
    let miles = p["path"]["to"]["nm"].as_f64().unwrap() - p["path"]["from"]["nm"].as_f64().unwrap();
    assert_eq!(p["path"]["from"]["ft"], json!(3300.0));
    assert!((p["path"]["to"]["ft"].as_f64().unwrap() - (3300.0 - miles * 318.4)).abs() < 5.0);
    assert!(ask("approach_profile", json!({"drawing": bare()}))["path"].is_null());
}

#[test]
fn fix_name_says_a_threshold_by_its_runway() {
    assert_eq!(ask("approach_fix_name", json!({"ident": "RW09"})), json!("the runway 09 threshold"));
    assert_eq!(ask("approach_fix_name", json!({"ident": "RW36C"})), json!("the runway 36C threshold"));
    assert_eq!(ask("approach_fix_name", json!({"ident": "PYKLA"})), json!("PYKLA"));
    assert_eq!(ask("approach_fix_name", json!({"ident": "RW9"})), json!("RW9"));
    assert_eq!(wingtip_engine::approach::lesson::stopwatch(125.0), "2:05");
}
