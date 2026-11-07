//! The pilot's records and text (wingtip_engine::pilot) held to the cases
//! the web app's tests hold lib/checklist, lib/logbookCsv,
//! lib/handbookText, lib/endorsements and lib/checkride to, and to the
//! shared fixtures (web/src/lib/fixtures/checklist.json, logbookCsv.json)
//! the iPhone app's SharedFixturesTests read too -- all through the one
//! way in, `call`, as every host asks.

use serde_json::{json, Value};
use std::path::PathBuf;
use wingtip_engine::call::call;

fn fixture(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web/src/lib/fixtures").join(name);
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn ask(name: &str, input: Value) -> Value {
    serde_json::from_str(&call(name, &input.to_string()).unwrap_or_else(|e| panic!("{name}: {e}"))).unwrap()
}

// --- Checklist ---------------------------------------------------------------

#[test]
fn a_checklist_reads_sections_and_items_each_split_as_printed() {
    let text = [
        "Preflight inspection -- Complete",
        "",
        "# Before takeoff",
        "Fuel selector -- Both",
        "Mixture ..... Rich",
        "Flight controls\tFree and correct",
        "Doors – Closed and latched",
        "Seat belts",
        "#   Empty section",
    ]
    .join("\n");
    let checklist = ask("checklist_read", json!({ "text": text }));
    assert_eq!(
        checklist,
        json!({ "sections": [
            { "title": "Checklist", "items": [{ "challenge": "Preflight inspection", "response": "Complete" }] },
            { "title": "Before takeoff", "items": [
                { "challenge": "Fuel selector", "response": "Both" },
                { "challenge": "Mixture", "response": "Rich" },
                { "challenge": "Flight controls", "response": "Free and correct" },
                { "challenge": "Doors", "response": "Closed and latched" },
                { "challenge": "Seat belts", "response": null },
            ] },
        ] })
    );
    // Written back, and read again as it was.
    let written = ask("checklist_write", json!({ "checklist": checklist }));
    assert_eq!(ask("checklist_read", json!({ "text": written })), checklist);
}

#[test]
fn a_checklist_keeps_a_hyphenated_word_and_cuts_to_the_gateways_lengths() {
    let read = ask("checklist_read", json!({ "text": "Pitot-static heat -- On" }));
    assert_eq!(read["sections"][0]["items"][0], json!({ "challenge": "Pitot-static heat", "response": "On" }));
    let long = ask("checklist_read", json!({ "text": format!("# {}\n{} -- {}", "S".repeat(60), "C".repeat(100), "R".repeat(100)) }));
    let s = &long["sections"][0];
    assert_eq!(s["title"].as_str().unwrap().len(), 40);
    assert_eq!(s["items"][0]["challenge"].as_str().unwrap().len(), 80);
    assert_eq!(s["items"][0]["response"].as_str().unwrap().len(), 80);
    // Counted in UTF-16 code units, as the gateway counts: a pair cut is left out.
    let emoji = ask("checklist_read", json!({ "text": format!("# {}", "😀".repeat(30)) }));
    assert_eq!(emoji["sections"], json!([]));
    let cut = ask("checklist_read", json!({ "text": format!("{}😀 -- x", "é".repeat(79)) }));
    assert_eq!(cut["sections"][0]["items"][0]["challenge"], json!("é".repeat(79)));
}

#[test]
fn the_shared_checklist_fixture() {
    for (i, case) in fixture("checklist.json")["cases"].as_array().unwrap().iter().enumerate() {
        let read = ask("checklist_read", json!({ "text": case["text"] }));
        assert_eq!(read, case["checklist"], "case {i}");
        assert_eq!(ask("checklist_write", json!({ "checklist": read })), case["written"], "case {i}");
    }
}

// --- Logbook CSV ---------------------------------------------------------------

/// ForeFlight's export as its guide lays the template out (ForeFlight
/// Logbook Guide v14.0): a line it asks be kept, the Aircraft Table and the
/// Flights Table, each a row of formats over a row of field names.
const FOREFLIGHT: &str = concat!(
    "ForeFlight Logbook Import,This row is required for importing into ForeFlight. Do not delete or modify.\r\n",
    "\r\n",
    "Aircraft Table,,,,,,,,,,,,,\r\n",
    "Text,Text,Text,YYYY,Text,Text,Text,Text,Text,Text,Boolean,Boolean,Boolean,Boolean\r\n",
    "AircraftID,EquipmentType,TypeCode,Year,Make,Model,Category,Class,GearType,EngineType,Complex,HighPerformance,Pressurized,TAA\r\n",
    "N201TH,Aircraft,C172,2019,Cessna,172,Airplane,ASEL,FT,Piston,,,,\r\n",
    "N54321,Aircraft,PA28,1979,Piper,PA-28-181,Airplane,ASEL,FT,Piston,,,,\r\n",
    "\r\n",
    "Flights Table,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,\r\n",
    "Date,Text,Text,Text,Text,hhmm,hhmm,hhmm,hhmm,hhmm,hhmm,Decimal,Decimal,Decimal,Decimal,Decimal,Decimal,Decimal,Number,Decimal,Number,Number,Number,Number,Number,Decimal,Decimal,Number,Packed Detail,Packed Detail,Decimal,Decimal,Text\r\n",
    "Date,AircraftID,From,To,Route,TimeOut,TimeOff,TimeOn,TimeIn,OnDuty,OffDuty,TotalTime,PIC,SIC,Night,Solo,CrossCountry,NVG,NVGOps,Distance,DayTakeoffs,DayLandingsFullStop,NightTakeoffs,NightLandingsFullStop,AllLandings,ActualInstrument,SimulatedInstrument,Holds,Approach1,Approach2,DualGiven,DualReceived,PilotComments\r\n",
    "2026-09-12,N201TH,KBVU,KVGT,KCDC 67L,,,,,,,3.6,3.6,,1.2,,3.6,,,135.0,2,2,1,1,4,0.8,0.5,1,1;ILS;12L;KVGT;Broke out at 350 AGL,2;RNAV (GPS);30;KBVU;,0.0,0.0,\"Night XC, \"\"hood\"\" back\"\r\n",
    "2026-09-20,N54321,C81,C81,,,,,,,,1.1,1.1,,,,,,,,3,3,,,,,,,,,,1.1,\r\n",
    ",,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,\r\n",
    "2026-09-21,N54321,C81,KDLH,,,,,,,,1500.0,,,,,,,,,,,,,,,,,,,,,Catch-up entry\r\n",
    "not a date,N54321,C81,KDLH,,,,,,,,1.0,,,,,,,,,,,,,,,,,,,,,",
);

#[test]
fn csv_reads_quoted_fields_their_doubled_quotes_and_line_breaks() {
    assert_eq!(ask("csv_rows", json!({ "text": "a,\"b, c\",\"d \"\"e\"\"\",\r\n\"f\ng\",h" })), json!([["a", "b, c", "d \"e\"", ""], ["f\ng", "h"]]));
}

/// The members of `want` as `got` has them.
fn matches(got: &Value, want: Value) {
    for (k, v) in want.as_object().unwrap() {
        assert!(same(&got[k], v), "{k}: {} != {v}", got[k]);
    }
}

#[test]
fn reads_foreflights_export_its_types_approaches_holds_and_landings_ours() {
    let read = ask("logbook_csv_read", json!({ "text": FOREFLIGHT }));
    let entries = read["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 2);
    matches(
        &entries[0],
        json!({
            "flownOn": "2026-09-12", "aircraft": "N201TH", "aircraftType": "C172", "route": "KBVU KCDC 67L KVGT",
            "totalHours": 3.6, "nightHours": 1.2, "crossCountryHours": 3.6, "distanceNm": 135.0,
            // Four landings, one a full stop at night: three by day for 61.57(a).
            "dayLandings": 3.0, "nightLandings": 1.0,
            "instrumentHours": 1.3, "approaches": 3.0, "holding": true, "tracking": false,
            "remarks": "Night XC, \"hood\" back",
        }),
    );
    matches(&entries[1], json!({ "aircraftType": "PA28", "route": "C81 C81", "dualHours": 1.1, "dayLandings": 3.0, "approaches": 0.0, "holding": false }));
    assert_eq!(
        read["skipped"],
        json!([
            { "line": 15, "reason": "1500 hours is more than a day: a summary entry, to log as its flights" },
            { "line": 16, "reason": "No date (\"not a date\")" },
        ])
    );
}

#[test]
fn writes_its_own_oldest_first_and_reads_it_back_as_it_was() {
    let entry = |over: Value| {
        let mut e = json!({
            "id": 1, "flownOn": "2026-10-01", "aircraft": "N12345", "aircraftType": "C172", "route": "C81 KDLH", "totalHours": 3.4, "nightHours": 0.5,
            "crossCountryHours": 3.4, "dayLandings": 2, "nightLandings": 1, "remarks": "Smooth, then \"bumpy\"", "dualHours": 0, "soloHours": 3.4,
            "instrumentHours": 0.3, "toweredLandings": 1, "distanceNm": 230, "longestLegNm": 230, "approaches": 2, "holding": true, "tracking": true,
            "createdAt": "2026-10-01T20:00:00Z",
        });
        for (k, v) in over.as_object().unwrap() {
            e[k] = v.clone();
        }
        e
    };
    let written = ask(
        "logbook_csv_write",
        json!({ "entries": [entry(json!({})), entry(json!({ "id": 2, "flownOn": "2026-09-01", "route": null, "remarks": null, "holding": false, "tracking": false }))] }),
    );
    let written = written.as_str().unwrap();
    assert_eq!(
        written.split("\r\n").next().unwrap(),
        "Date,AircraftID,TypeCode,Route,TotalTime,Night,CrossCountry,Solo,DualReceived,Instrument,AllLandings,NightLandingsFullStop,ToweredLandings,Distance,LongestLeg,Approaches,Holds,Tracking,PilotComments"
    );
    let read = ask("logbook_csv_read", json!({ "text": written }));
    assert_eq!(read["skipped"], json!([]));
    let entries = read["entries"].as_array().unwrap();
    assert_eq!(entries.iter().map(|e| e["flownOn"].clone()).collect::<Vec<_>>(), vec![json!("2026-09-01"), json!("2026-10-01")]);
    let mut as_logged = entry(json!({}));
    as_logged.as_object_mut().unwrap().retain(|k, _| k != "id" && k != "createdAt");
    assert!(same(&entries[1], &as_logged), "{} != {as_logged}", entries[1]);
    matches(&entries[0], json!({ "route": null, "remarks": null, "holding": false, "tracking": false }));
}

#[test]
fn says_so_when_there_is_no_flights_header() {
    let read = ask("logbook_csv_read", json!({ "text": "a,b\n1,2" }));
    assert!(read["skipped"][0]["reason"].as_str().unwrap().contains("Date, AircraftID and TotalTime"));
}

/// A number as JSON compares it: 48 and 48.0 alike.
fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(x, y)| same(x, y)),
        (Value::Object(x), Value::Object(y)) => x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| same(v, w))),
        _ => a == b,
    }
}

#[test]
fn the_shared_logbook_csv_fixture() {
    let f = fixture("logbookCsv.json");
    for (i, case) in f["export"].as_array().unwrap().iter().enumerate() {
        assert_eq!(ask("logbook_csv_write", json!({ "entries": case["entries"] })), case["csv"], "written out, case {i}");
    }
    for case in f["import"].as_array().unwrap() {
        let read = ask("logbook_csv_read", json!({ "text": case["text"] }));
        let want = json!({ "entries": case["entries"], "skipped": case["skipped"] });
        assert!(same(&read, &want), "{}: {read} != {want}", case["name"]);
    }
}

// --- Handbook page -------------------------------------------------------------

fn values(text: &str) -> Value {
    let f = ask("handbook_figures", json!({ "text": text }));
    Value::Object(f.as_object().unwrap().iter().map(|(k, v)| (k.clone(), v["value"].clone())).collect())
}

#[test]
fn a_pipers_page_in_knots_where_it_prints_mph() {
    // The Cherokee 140 "D" handbook's page 1, the owner's photo of it as
    // Tesseract read it: its misreads ("sca", "{flaps", "(142%)") kept.
    let page = "CHEROKEE 140 “D\" SECTION |\nSECTION |\nSPECIFICATIONS\nPERFORMANCE\n\nThe gross weight of 2150 pounds in the following performance\ncharts applies to Serial Nos. 28-25001 and up.\n\nGROSS WEIGHT 2150\n\nTake-off Run (ft) (flaps up) 800\n\nTake-off Distance Over 50-ft\n\nObstacle (ft) {flaps up) 1700\n\nBest Rate of Climb Speed (mph) 85\n\nRate of Climb (ft per min) 660\n\nService Ceiling (ft) 14,300\n\nAbsolute Ceiling 16,800\n\nTop Speed (mph) 139 (142%)\n\nCruising Speed (75% power, sca\n\nlevel) (mph) 121 (124%)\n\nOptimum Cruising Speed (75%\n\npower, 7000 ft, mph) 132 (135)\nInstructional Power Cruise Speed\n(50% power, sea level) 100 (102%)\n\nFuel Consumption (gal per hr 75%) 8.4\n\nFuel Consumption (gal per hr 50%) 5.6\n*WITH FENDERS INSTALLED";
    assert!(same(&values(page), &json!({ "serviceCeilingFt": 14300, "climbTasKt": 74, "cruiseTasKt": 115, "cruisePowerPct": 75, "fuelBurnGph": 8.4 })));
    assert_eq!(ask("handbook_figures", json!({ "text": page }))["serviceCeilingFt"]["words"], json!("Service Ceiling (ft) 14,300"));
}

#[test]
fn a_cessnas_page_its_usable_fuel_off_the_capacity_line() {
    let page = "SPEED:\nMaximum at Sea Level ........ 126 KNOTS\nCruise, 75% Power at 8000 Ft ........ 122 KNOTS\nRATE OF CLIMB AT SEA LEVEL ........ 730 FPM\nSERVICE CEILING ........ 13.500 FT\nFUEL CAPACITY: Total 56 GAL. Usable 53 GAL.";
    assert!(same(&values(page), &json!({ "cruiseTasKt": 122, "cruisePowerPct": 75, "serviceCeilingFt": 13500, "usableFuelGal": 53 })));
}

#[test]
fn a_lines_own_knots_over_the_mph_beside_them_and_not_vno() {
    let page = "Maximum Structural Cruising Speed (Vno) 129 KTS\nCruise, 75% Power at 8000 Ft 122 KTS (140 MPH)\nFuel flow 75% 8.4 gph 65% 7.0 gph";
    assert!(same(&values(page), &json!({ "cruiseTasKt": 122, "cruisePowerPct": 75, "fuelBurnGph": 8.4 })));
}

#[test]
fn nothing_off_a_page_with_no_figures() {
    assert_eq!(values("NORMAL PROCEDURES\nBefore starting engine, check fuel selector."), json!({}));
}

// --- Endorsements and the checkride ---------------------------------------------

fn lapse(until: Value, kind: &str, signed_on: &str) -> Value {
    ask("endorsement_lapse", json!({ "until": until, "until_kind": kind, "signed_on": signed_on }))
}

#[test]
fn an_instructors_date_says_nothing_on_or_before_it() {
    assert_eq!(lapse(json!("2026-10-25"), "RE", "2026-10-25"), Value::Null);
    assert_eq!(lapse(Value::Null, "RE", "2026-10-25"), Value::Null);
}

#[test]
fn recent_experience_run_out_cites_61_197_a() {
    assert_eq!(
        lapse(json!("2025-12-31"), "RE", "2026-10-25"),
        json!("Your recent experience ran out on 31 Dec 2025: 14 CFR 61.197(a) asks for recent experience in the preceding 24 calendar months before you sign as an instructor.")
    );
}

#[test]
fn an_older_certificate_expired_cites_61_197_e() {
    let w = lapse(json!("2025-11-30"), "EXP", "2026-10-25");
    assert!(w.as_str().unwrap().starts_with("Your certificate expired on 30 Nov 2025: 14 CFR 61.197(e)"), "{w}");
    // A date that has passed and is not a day is refused, as the web's date-fns refused it.
    assert!(call("endorsement_lapse", r#"{"until": "2026-02-30", "signed_on": "2026-10-25"}"#).is_err());
}

#[test]
fn the_latest_of_each_kind_not_voided_is_in_force() {
    let signed = json!([{ "code": "A.1", "voided": true }, { "code": "A.1" }, { "code": "A.2", "voided": false }, { "code": "A.1" }]);
    assert_eq!(ask("endorsements_in_force", json!({ "signed": signed })), json!([["A.1", 1], ["A.2", 2]]));
}

#[test]
fn acs_codes_out_of_whatever_was_pasted_each_once() {
    assert_eq!(
        ask("acs_codes", json!({ "text": "PA.I.E.K1, PA.I.D.K2\npa.vi.c.k3 PA.I.E.K1 and IR.III.B.K2b" })),
        json!(["PA.I.E.K1", "PA.I.D.K2", "PA.VI.C.K3", "IR.III.B.K2b"])
    );
    assert_eq!(ask("acs_codes", json!({ "text": "nothing here" })), json!([]));
    // No code runs on into a word: K123 and K1AB are none.
    assert_eq!(ask("acs_codes", json!({ "text": "PA.I.A.K123 PA.I.A.K1AB PA.I.A.K12a" })), json!(["PA.I.A.K12a"]));
}

// AC 61-65K A.10 filled in as the gateway's EndorsementKindTest fills it:
// the two must make the same words, or the gateway refuses the signature.
#[test]
fn an_endorsements_words_a_blank_left_empty_leaving_nothing() {
    let template = "I have reviewed the cross-country planning of {student}. I find the planning and preparation to be correct to make the solo flight from {from} to {to} via {via} with landings at {landings} in a {mm} aircraft on {date}. {conditions}";
    let fields = json!({ "from": "KUGN", "to": "KUGN", "via": "KRFD, KJVL", "landings": "KRFD, KJVL and KUGN", "mm": "Cessna  172", "date": "10-14-2026", "conditions": "" });
    assert_eq!(
        ask("endorsement_render", json!({ "template": template, "student": "Avery B. Student", "fields": fields })),
        json!("I have reviewed the cross-country planning of Avery B. Student. I find the planning and preparation to be correct to make the solo flight from KUGN to KUGN via KRFD, KJVL with landings at KRFD, KJVL and KUGN in a Cessna 172 aircraft on 10-14-2026.")
    );
}

#[test]
fn bad_asks_are_errors() {
    assert!(call("checklist_read", "{}").is_err());
    assert!(call("checklist_write", r#"{"checklist": {"sections": [{"title": 1}]}}"#).is_err());
    assert!(call("logbook_csv_write", r#"{"entries": 1}"#).is_err());
    assert!(call("endorsements_in_force", r#"{"signed": [{}]}"#).is_err());
    assert!(call("endorsement_render", r#"{"template": "x", "fields": []}"#).is_err());
}

#[test]
fn a_figure_typed_in_is_held_to_the_bounds_the_page_is_read_by() {
    let within = |key: &str, value: f64| ask("handbook_within", json!({"key": key, "value": value}));
    assert_eq!(within("cruiseTasKt", 30.0), json!(true));
    assert_eq!(within("cruiseTasKt", 29.9), json!(false));
    assert_eq!(within("climbFuelBurnGph", 150.0), json!(true));
    assert_eq!(within("serviceCeilingFt", 30001.0), json!(false));
    assert!(call("handbook_within", r#"{"key": "wingspan", "value": 3}"#).is_err());
}
