//! The route's pilot-made pieces (wingtip_engine::route), held to the
//! shared holds fixture (web/src/lib/fixtures/holds.json, which the web's
//! lib/holds and the iPhone's Hold are tested against too) and to the
//! cases the web's lib/holds, lib/procedures and lib/identSchema tests,
//! tests/test_holds.py and the planner's test_stops.py hold their copies
//! to.

use serde_json::{json, Value};
use std::path::PathBuf;
use wingtip_engine::call::call;
use wingtip_engine::route::holds::{self, Leg, Length};
use wingtip_engine::route::picks::{self, Crossing, Pick};
use wingtip_engine::route::points::{self, Kind};

fn ask(name: &str, input: Value) -> Value {
    serde_json::from_str(&call(name, &input.to_string()).unwrap()).unwrap()
}

fn holds_fixture() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web/src/lib/fixtures/holds.json");
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

// --- Holds ------------------------------------------------------------------

#[test]
fn the_shared_holds_fixture_reads_and_writes() {
    let fixture = holds_fixture();
    for case in fixture["parse"].as_array().unwrap() {
        let text = case["text"].as_str().unwrap();
        let read = ask("hold_read", json!({ "text": text }));
        let want = &case["hold"];
        if want.is_null() {
            assert!(read.is_null(), "{text:?} read as {read}");
            continue;
        }
        assert_eq!(read["fix"], want["fix"], "{text:?}");
        assert_eq!(read["inbound"].as_f64(), want["inbound"].as_f64(), "{text:?}");
        assert_eq!(read["right"], want["right"], "{text:?}");
        assert_eq!(read["leg_min"].as_f64(), want["legMin"].as_f64(), "{text:?}");
        assert_eq!(read["leg_nm"].as_f64(), want["legNm"].as_f64(), "{text:?}");
        assert_eq!(read["turns"].as_f64(), want["turns"].as_f64(), "{text:?}");
        assert_eq!(read["minutes"].as_f64(), want["minutes"].as_f64(), "{text:?}");
        assert_eq!(ask("hold_write", json!({ "hold": read })), case["written"], "{text:?}");
    }
    for case in fixture["legMinutes"].as_array().unwrap() {
        let minutes = ask("holding_leg_minutes", json!({ "altitude_ft": case["altitudeFt"] }));
        assert_eq!(minutes.as_f64(), case["minutes"].as_f64());
    }
}

#[test]
fn a_hold_is_read_as_the_planner_reads_it() {
    // tests/test_holds.py and lib/holds.test.ts.
    let hold = holds::read("vpbng/090/30:270:R:1M:2T").unwrap();
    assert_eq!(hold.fix, "VPBNG/090/30");
    assert_eq!((hold.inbound, hold.right, hold.leg, hold.length), (270, true, Leg::Minutes(1.0), Length::Turns(2)));
    let kmsn = holds::read("KMSN:360:L:4N:10M").unwrap();
    assert_eq!((kmsn.inbound, kmsn.right, kmsn.leg, kmsn.length), (0, false, Leg::Nm(4.0), Length::Minutes(10)));
    for bad in ["KMSN:400:L:4N:10M", "KMSN:090:X:1M:2T", "KMSN", "", "KMSN:090:R:1M:2T:X", "KMSN:090:R:1é:2T", "KMSN:090:R:1M:2é", "K MSN:090:R:1M:2T"] {
        assert!(holds::read(bad).is_none(), "{bad:?}");
    }
    assert_eq!(holds::read(" kugn:000:r:1.5m:1t ").unwrap().leg, Leg::Minutes(1.5));
    // Uppercased as JavaScript and Python do it, a dotless i an I.
    assert_eq!(holds::read("kmsın:090:r:1m:2t").unwrap().fix, "KMSIN");
    assert!(holds::read("kmsé:090:r:1m:2t").is_none());
}

#[test]
fn several_holds_at_once_each_with_its_piece() {
    let read = ask("holds_read", json!({ "text": "KMSN:090:L:4N:10M, VPBNG/090/30:180:R:1M:1T ,,not one" }));
    let parts: Vec<_> = read.as_array().unwrap().iter().map(|r| r["part"].as_str().unwrap()).collect();
    assert_eq!(parts, ["KMSN:090:L:4N:10M", "VPBNG/090/30:180:R:1M:1T", "not one"]);
    assert_eq!(read[1]["hold"]["fix"], "VPBNG/090/30");
    assert!(read[2]["hold"].is_null());
    assert_eq!(ask("holds_read", json!({ "text": "" })), json!([]));
}

#[test]
fn a_hold_is_written_with_its_course_in_three_figures() {
    let north = ask("hold_read", json!({ "text": "KMSN:360:R:1M:1T" }));
    assert_eq!(ask("hold_write", json!({ "hold": north })), "KMSN:000:R:1M:1T");
    let leg = json!({ "fix": "BXCMB", "inbound": 5, "right": false, "leg_nm": 2.5, "minutes": 10 });
    assert_eq!(ask("hold_write", json!({ "hold": leg })), "BXCMB:005:L:2.5N:10M");
    assert_eq!(holds::write("KMSN", 90.0, true, Leg::Minutes(1.5), Length::Turns(2)), "KMSN:090:R:1.5M:2T");
    // A hold's legs and length are one or the other.
    assert!(call("hold_write", r#"{"hold": {"fix": "X", "inbound": 1, "right": true, "leg_min": 1, "leg_nm": 1, "turns": 1}}"#).is_err());
    assert!(call("hold_write", r#"{"hold": {"fix": "X", "inbound": 1, "right": true, "leg_min": 1, "turns": 1.5}}"#).is_err());
}

#[test]
fn a_length_coded_and_read_back() {
    // lib/holds.test.ts: lengthCode, lengthOfCode.
    assert_eq!(ask("hold_length_write", json!({ "turns": 2 })), "2T");
    assert_eq!(ask("hold_length_write", json!({ "minutes": 10 })), "10M");
    assert_eq!(ask("hold_length_read", json!({ "text": "2t" })), json!({ "turns": 2 }));
    assert_eq!(ask("hold_length_read", json!({ "text": "30M" })), json!({ "minutes": 30 }));
    for bad in ["0T", "2X", "1000T", "T", "", "+1T"] {
        assert!(ask("hold_length_read", json!({ "text": bad })).is_null(), "{bad:?}");
    }
}

#[test]
fn a_holds_minutes() {
    // tests/test_holds.py: a minute's legs and two standard-rate turns a
    // lap, four minutes; two laps eight; 4 nm legs at 120 kt two minutes.
    let near = |a: f64, b: f64| (a - b).abs() < 1e-9;
    assert!(near(holds::lap_minutes(Leg::Minutes(1.0), 110.0), 4.0));
    assert!(near(holds::held_minutes(Leg::Minutes(1.0), Some(2.0), None, 110.0), 8.0));
    assert!(near(holds::lap_minutes(Leg::Nm(4.0), 120.0), 2.0 * 2.0 + 2.0));
    assert_eq!(holds::held_minutes(Leg::Minutes(1.0), None, Some(15.0), 110.0), 15.0);
    assert!(near(holds::length_minutes(Leg::Minutes(1.0), Length::Turns(2), 110.0), 8.0));
    // No airspeed is flown as a knot, not divided by nothing.
    assert!(holds::lap_minutes(Leg::Nm(4.0), 0.0).is_finite());
    // A standard-rate turn's radius: 0.64 nm at 120 kt.
    assert!((holds::turn_radius_nm(120.0) - 0.6366).abs() < 1e-4);
    let figures = ask("hold_figures", json!({ "hold": { "leg_min": 1, "turns": 2 }, "tas_kt": 110 }));
    assert_eq!(figures["lap_min"], 4.0);
    assert_eq!(figures["held_min"], 8.0);
}

// --- Procedures and runways ------------------------------------------------

fn pick(ident: &str, id: &str, transition: Option<&str>, direct: Option<&str>) -> Pick {
    Pick { ident: ident.into(), id: id.into(), transition: transition.map(Into::into), direct: direct.map(Into::into) }
}

#[test]
fn the_procedures_picked_are_read_as_the_address_and_the_planner_read_them() {
    // lib/procedures.test.ts: what is not one is left out.
    let read = picks::procedures_read("KBUR:I08-Y:LAX,KBUR:JANNY5,bad,KDLH::X");
    let kept: Vec<_> = read.iter().filter_map(|r| r.pick.clone()).collect();
    assert_eq!(kept, [pick("KBUR", "I08-Y", Some("LAX"), None), pick("KBUR", "JANNY5", None, None)]);
    assert_eq!(read.iter().map(|r| r.exact).collect::<Vec<_>>(), [true, true, false, false]);
    // A direct fix after a fourth colon, with or without a transition.
    let direct = picks::procedures_read("KELD:I22::BXCMB,KDLH:R27:HIGHR:WIRSA,KELD:I22::X");
    assert_eq!(direct[0].pick, Some(pick("KELD", "I22", None, Some("BXCMB"))));
    assert_eq!(direct[1].pick, Some(pick("KDLH", "R27", Some("HIGHR"), Some("WIRSA"))));
    assert_eq!(direct[2].pick, Some(pick("KELD", "I22", None, None)));
    assert!(direct[0].exact && direct[1].exact && !direct[2].exact);
    // The planner's: either case; a transition left empty only before a
    // direct fix; nothing after a fourth piece.
    for (part, exact) in [("kdlh:i09:andoe", true), ("KDLH:I09:", false), ("KDLH:I09:ANDOE:X:Y", false), ("KDLH:I09-Y-ZZ", false), ("K:I09", false)] {
        assert_eq!(picks::procedures_read(part)[0].exact, exact, "{part:?}");
    }
    // Where the planner takes one, the address reads the same pick.
    let read = picks::procedures_read(" kdlh:i09:andoe ");
    assert_eq!((read[0].part.as_str(), read[0].pick.clone()), ("kdlh:i09:andoe", Some(pick("KDLH", "I09", Some("ANDOE"), None))));
}

#[test]
fn the_procedures_picked_are_written_back() {
    let picks = [pick("KBUR", "I08-Y", Some("LAX"), None), pick("C81", "R24", None, None)];
    assert_eq!(picks::procedures_write(&picks), "KBUR:I08-Y:LAX,C81:R24");
    let direct = [pick("KELD", "I22", None, Some("BXCMB")), pick("KDLH", "R27", Some("HIGHR"), Some("WIRSA"))];
    assert_eq!(picks::procedures_write(&direct), "KELD:I22::BXCMB,KDLH:R27:HIGHR:WIRSA");
    let written = ask("procedures_write", json!({ "picks": [{ "ident": "KBUR", "id": "I08-Y", "transition": null }] }));
    assert_eq!(written, "KBUR:I08-Y");
}

#[test]
fn a_runway_picked_at_a_field() {
    // planning-service/tests/test_stops.py.
    let read = picks::runways_read("kstl:30r");
    assert_eq!(read[0].1.as_ref().map(|p| (p.field.as_str(), p.runway.as_str())), Some(("STL", "30R")));
    let both = picks::runways_read("KDLH:9,UGN:23R");
    assert_eq!(both.iter().map(|(_, p)| p.as_ref().unwrap().field.clone()).collect::<Vec<_>>(), ["DLH", "UGN"]);
    for bad in ["C81:west", "KSTL:30RR", "K:9", "KSTLAB:9", "KSTL:", ":9", "KDLH:123", "KDLH:NE", "KDLH:9:X", "KDLH"] {
        assert!(picks::runways_read(bad)[0].1.is_none(), "{bad:?}");
    }
    assert_eq!(picks::runways_read(" , KDLH:9C,,").len(), 1);
}

#[test]
fn a_fixs_altitudes_as_the_chart_sets_them() {
    // lib/procedures.test.ts: a minimum underlined, a maximum overlined,
    // both on a mandatory one, the higher over the lower between two.
    assert_eq!(picks::altitude_lines(Some(4600.0), None), Some((Crossing::AtOrAbove, vec![(4600.0, true, false)])));
    assert_eq!(picks::altitude_lines(None, Some(9000.0)), Some((Crossing::AtOrBelow, vec![(9000.0, false, true)])));
    assert_eq!(picks::altitude_lines(Some(3000.0), Some(3000.0)), Some((Crossing::At, vec![(3000.0, true, true)])));
    assert_eq!(
        picks::altitude_lines(Some(11000.0), Some(13000.0)),
        Some((Crossing::Between, vec![(13000.0, false, true), (11000.0, true, false)]))
    );
    assert_eq!(picks::altitude_lines(None, None), None);
    assert_eq!(ask("altitude_lines", json!({})), json!({ "crossing": null, "lines": [] }));
}

// --- Points -------------------------------------------------------------------

#[test]
fn a_points_form() {
    // lib/identSchema.test.ts: stopOf and isFixIdent.
    for (ident, kind) in [
        ("VPBNG/090/30", Some(Kind::Own)),
        ("DLH090030", Some(Kind::Own)),
        ("VPBNG/090/4.5", Some(Kind::Own)),
        ("VPBNG/400/30", Some(Kind::Own)),
        ("VPBNG/90/30", None),
        ("VPBNG/090/30.", None),
        ("VPBNG", Some(Kind::Fix)),
        ("KR", Some(Kind::Fix)),
        ("K", None),
        ("TOOLONG", None),
        ("vpbng", None),
        ("D1H090030", None),
        ("AB123456", Some(Kind::Own)),
        ("ABCDE123456", Some(Kind::Own)),
        ("ABCDEF123456", None),
        ("@42.3,-88.0", None),
        ("KÉ090030", None),
    ] {
        assert_eq!(points::kind(ident), kind, "{ident:?}");
    }
}

#[test]
fn the_pilots_own_point_off_a_fix() {
    // wingtip.fixes.parse_frd, and lib/identSchema's frdOf and frdIdent.
    assert_eq!(points::frd("VPBNG/090/30"), Some(("VPBNG".into(), 90, 30.0)));
    assert_eq!(points::frd("DLH090030"), Some(("DLH".into(), 90, 30.0)));
    assert_eq!(points::frd(" vpbng/360/4.5 "), Some(("VPBNG".into(), 0, 4.5)));
    for bad in ["VPBNG", "VPBNG/400/30", "VPBNG/090/0", "VPBNG/090/999.9", "DLH999999"] {
        assert_eq!(points::frd(bad), None, "{bad:?}");
    }
    assert_eq!(points::frd("VPBNG/090/999"), Some(("VPBNG".into(), 90, 999.0)));
    assert_eq!(points::frd_ident("vpbng", 360.0, 12.25), "VPBNG/000/12.3");
    assert_eq!(points::frd_ident("DLH", -90.0, 30.0), "DLH/270/30");
    assert_eq!(ask("frd_read", json!({ "text": "VPBNG/090/30" })), json!({ "base": "VPBNG", "course": 90, "distance_nm": 30.0 }));
    assert_eq!(ask("frd_write", json!({ "base": "X1", "course": 359.6, "distance_nm": 4.05 })), "X1/000/4.1");
}

#[test]
fn one_field_by_its_faa_or_icao_ident() {
    // lib/procedures.test.ts: sameField; the planner's _bare_field.
    assert!(points::same_field("KBUR", "BUR"));
    assert!(points::same_field("C81", "C81"));
    assert!(!points::same_field("KBUR", "KVNY"));
    assert_eq!(points::bare_field("kdlh"), "DLH");
    assert_eq!(points::bare_field("KABCD"), "KABCD");
    assert_eq!(points::bare_field("K12"), "K12");
}

#[test]
fn bad_asks_are_errors() {
    assert!(call("hold_read", "{}").unwrap_err().contains("\"text\""));
    assert!(call("hold_figures", r#"{"hold": {"leg_min": 1}}"#).is_err());
    assert!(call("procedures_write", r#"{"picks": [{"ident": "KBUR"}]}"#).is_err());
    assert!(call("frd_write", r#"{"base": "X", "course": "N"}"#).is_err());
}
