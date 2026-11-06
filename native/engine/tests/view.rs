//! The map's view from the phone's packs (wingtip_engine::view) against
//! the planner's own answers: the Chicago phone packs the iOS app's tests
//! read (tests/fixtures/native/phone, the Chicago cut with the NASR
//! airports and navaids tables and airspace.attr), and what the planner
//! answered on 2026-11-03 for the same boxes over Chicago
//! (tests/fixtures/native/phone/view, /api/airspace/in-view,
//! /api/airports/in-view and /api/navaids/in-view as captured with curl),
//! field by field, allowing for what a pack cannot hold -- a live METAR's
//! flight category, a navaid's remarks -- and for what it holds
//! differently: NASR's names and positions of fields where the planner
//! has OurAirports', and rings simplified to the phone's tolerance. The
//! cut holds only some of Chicago's volumes (tests/test_native.py's taps'),
//! so the planner answers volumes the packs cannot: every volume the
//! packs do answer is held to the planner's, and a field's airspace class
//! is held to it unless its volume is one the cut lacks.

use serde_json::Value;
use std::collections::BTreeSet;
use std::path::PathBuf;
use std::time::Instant;
use wingtip_engine::pack::Pack;
use wingtip_engine::view;

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/native/phone")
}

fn pack_bytes() -> Vec<Vec<u8>> {
    ["n40w088", "n40w092"].iter().map(|r| std::fs::read(fixtures().join(format!("{r}.pack"))).unwrap()).collect()
}

fn planner(what: &str, tag: &str) -> Value {
    serde_json::from_slice(&std::fs::read(fixtures().join("view").join(format!("{what}_{tag}.json"))).unwrap()).unwrap()
}

/// The boxes the planner was asked: a phone's view a degree across, and
/// one close in over O'Hare, each as (tag, south, west, north, east).
const BOXES: [(&str, f64, f64, f64, f64); 2] = [
    ("south_41.5_west_-88.5_north_42.5_east_-87.5", 41.5, -88.5, 42.5, -87.5),
    ("south_41.8_west_-88.2_north_42.2_east_-87.6", 41.8, -88.2, 42.2, -87.6),
];

/// shapely's representative_point on the pack's own rings (oriented), as
/// wingtip.airspace_map takes it, for volumes of n40w088 (2026-11-03), by
/// the engine's id of each: (id, lat, lon) to five places.
const SHAPELY_LABELS: [(&str, f64, f64); 5] = [
    ("GYY-0", 41.61472, -87.41278),
    ("MDW-4", 41.78398, -87.75242),
    ("MDW-3", 41.74262, -87.59743),
    ("ORD-7", 41.98889, -87.45778),
    ("PWK-12", 42.12274, -87.90153),
];

/// Whether the ring holds the point, by crossings (the engine's own rule).
fn holds(ring: &[(f64, f64)], p: (f64, f64)) -> bool {
    let mut inside = false;
    let mut prev = *ring.last().unwrap();
    for &cur in ring {
        if (cur.1 > p.1) != (prev.1 > p.1) && p.0 < (prev.0 - cur.0) * (p.1 - cur.1) / (prev.1 - cur.1) + cur.0 {
            inside = !inside;
        }
        prev = cur;
    }
    inside
}

/// A line's points as the planner writes them, [lat, lon].
type Line = Vec<(f64, f64)>;

fn keys(v: &Value) -> BTreeSet<String> {
    v.as_object().unwrap().keys().cloned().collect()
}

fn num(v: &Value) -> f64 {
    v.as_f64().unwrap()
}

/// A point's distance from a polyline, in degrees.
fn off_line(p: (f64, f64), line: &[(f64, f64)]) -> f64 {
    let mut best = f64::INFINITY;
    for w in line.windows(2) {
        let (a, b) = (w[0], w[1]);
        let len2 = (b.0 - a.0).powi(2) + (b.1 - a.1).powi(2);
        let r = if len2 == 0.0 { 0.0 } else { (((p.0 - a.0) * (b.0 - a.0) + (p.1 - a.1) * (b.1 - a.1)) / len2).clamp(0.0, 1.0) };
        let q = (a.0 + r * (b.0 - a.0), a.1 + r * (b.1 - a.1));
        best = best.min(((p.0 - q.0).powi(2) + (p.1 - q.1).powi(2)).sqrt());
    }
    best
}

fn points(line: &Value) -> Vec<(f64, f64)> {
    line.as_array().unwrap().iter().map(|p| (num(&p[0]), num(&p[1]))).collect()
}

fn signed_area(ring: &[(f64, f64)]) -> f64 {
    (0..ring.len()).map(|k| {
        let (a, b) = (ring[k], ring[(k + 1) % ring.len()]);
        a.1 * b.0 - b.1 * a.0
    }).sum()
}

#[test]
fn the_airspace_in_view_is_the_planners_volumes_and_lines() {
    let bytes = pack_bytes();
    let packs: Vec<Pack> = bytes.iter().map(|b| Pack::read(b).unwrap()).collect();
    for (tag, south, west, north, east) in BOXES {
        let ours: Value = serde_json::from_str(&view::airspace_in_view(&packs, south, west, north, east)).unwrap();
        let theirs = planner("airspace", tag);
        let (ours, theirs) = (ours["volumes"].as_array().unwrap(), theirs["volumes"].as_array().unwrap());
        let key = |v: &Value| format!("{} {} {} {}", v["name"], v["airspace_class"], v["floor_ft"], v["ceiling_ft"]);
        let (a, b): (BTreeSet<String>, BTreeSet<String>) = (ours.iter().map(key).collect(), theirs.iter().map(key).collect());
        println!("{tag}: {} volumes of the planner's {}; the cut lacks {:?}", a.len(), b.len(), b.difference(&a).collect::<Vec<_>>());
        assert!(a.is_subset(&b), "{tag}: not the planner's: {:?}", a.difference(&b).collect::<Vec<_>>());
        assert!(a.len() * 3 >= b.len() * 2, "{tag}: too few of the planner's volumes");
        for got in ours {
            let want = theirs.iter().find(|v| key(v) == key(got)).unwrap();
            assert_eq!(keys(got), keys(want), "{tag}: the fields of {}", want["id"]);
            // The id's number is the volume's place among the nation's,
            // which the Chicago cut's packs count from the cut: the ident
            // before it is the planner's.
            let ident = want["ident"].as_str().map(str::to_owned).unwrap_or_else(|| want["airspace_class"].as_str().unwrap().to_owned());
            assert!(got["id"].as_str().unwrap().starts_with(&format!("{ident}-")), "{tag}: {} vs {}", got["id"], want["id"]);
            for field in ["ident", "floor_sfc", "ceiling_excluded", "hours_code", "hours_remark"] {
                assert_eq!(got[field], want[field], "{tag}: {} {field}", want["id"]);
            }
            let (ours_lines, their_lines) = (got["lines"].as_array().unwrap(), want["lines"].as_array().unwrap());
            assert_eq!(ours_lines.len(), their_lines.len(), "{tag}: {} lines", want["id"]);
            // The label: a shelf's widest section on the simplified ring can
            // be another of its arms than on the file's (Midway's 1,900 ft
            // shelf), so the label is held to be inside the volume, and to
            // shapely's own point on the pack's rings (SHAPELY_LABELS).
            let label = (num(&got["label_lat"]), num(&got["label_lon"]));
            let (shells, holes): (Vec<Line>, Vec<Line>) = ours_lines.iter().map(points).partition(|l| signed_area(l) > 0.0);
            assert!(shells.iter().any(|s| holds(s, label)) && !holes.iter().any(|h| holds(h, label)), "{tag}: {} label {label:?} outside", want["id"]);
            if label != (num(&want["label_lat"]), num(&want["label_lon"])) {
                println!("{tag}: {} label {label:?} where the planner's is {} {}", want["id"], want["label_lat"], want["label_lon"]);
            }
            if let Some((_, lat, lon)) = SHAPELY_LABELS.iter().find(|s| s.0 == got["id"].as_str().unwrap()) {
                assert_eq!(label, (*lat, *lon), "{tag}: {} shapely's label", got["id"]);
            }
            // Each line's points on the planner's line and the planner's
            // on it, within the phone's tolerance and the planner's own
            // simplifying; each running the same way round.
            for theirs in their_lines {
                let theirs = points(theirs);
                let nearest = ours_lines.iter().map(points).min_by(|x, y| {
                    off_line(theirs[0], x).partial_cmp(&off_line(theirs[0], y)).unwrap()
                }).unwrap();
                for &p in &theirs {
                    assert!(off_line(p, &nearest) < 0.00025, "{tag}: {} point {p:?} off the pack's line", want["id"]);
                }
                for &p in &nearest {
                    assert!(off_line(p, &theirs) < 0.00025, "{tag}: {} point {p:?} off the planner's line", want["id"]);
                }
                assert_eq!(signed_area(&nearest) > 0.0, signed_area(&theirs) > 0.0, "{tag}: {} runs the other way", want["id"]);
                assert!(nearest.len() <= theirs.len() + 2, "{tag}: {} has {} points to the planner's {}", want["id"], nearest.len(), theirs.len());
            }
        }
    }
}

#[test]
fn the_airports_in_view_are_the_planners_fields() {
    let bytes = pack_bytes();
    let packs: Vec<Pack> = bytes.iter().map(|b| Pack::read(b).unwrap()).collect();
    for (tag, south, west, north, east) in BOXES {
        let ours: Value = serde_json::from_str(&view::airports_in_view(&packs, south, west, north, east)).unwrap();
        let theirs = planner("airports", tag);
        let (ours, theirs) = (ours["airports"].as_array().unwrap(), theirs["airports"].as_array().unwrap());
        let ident = |v: &Value| v["ident"].as_str().unwrap().to_owned();
        let (a, b): (BTreeSet<String>, BTreeSet<String>) = (ours.iter().map(ident).collect(), theirs.iter().map(ident).collect());
        // The planner lists OurAirports' fields the FAA lists, the pack
        // NASR's fields OurAirports lists: the same fields but for the odd
        // one filed under another ident on one side.
        let common = a.intersection(&b).count();
        println!("{tag}: {} fields, the planner {}, {common} alike; only ours {:?}, only the planner's {:?}", a.len(), b.len(),
                 a.difference(&b).collect::<Vec<_>>(), b.difference(&a).collect::<Vec<_>>());
        assert!(common * 10 >= b.len() * 9 && common * 10 >= a.len() * 9, "{tag}");
        for want in theirs {
            let Some(got) = ours.iter().find(|v| ident(v) == ident(want)) else { continue };
            assert_eq!(keys(got), keys(want), "{tag}: the fields of {}", want["ident"]);
            for field in ["kind", "military", "private"] {
                assert_eq!(got[field], want[field], "{tag}: {} {field}", want["ident"]);
            }
            // A field under a volume the cut lacks (Lewis under Romeoville's
            // Class D) is answered as under none.
            for (field, none) in [("airspace_class", Value::String("G".into())), ("primary_of", Value::Null)] {
                if got[field] != want[field] {
                    println!("{tag}: {} {field} {} where the planner says {}", want["ident"], got[field], want[field]);
                    assert_eq!(got[field], none, "{tag}: {} {field}", want["ident"]);
                }
            }
            assert!(got["flight_category"].is_null());
            assert!((num(&got["lat"]) - num(&want["lat"])).abs() < 0.01 && (num(&got["lon"]) - num(&want["lon"])).abs() < 0.01, "{tag}: {}", want["ident"]);
            assert!(!got["name"].as_str().unwrap().is_empty());
        }
        // The biggest first and then by ident, as the planner orders them
        // with no field reporting.
        let order: Vec<(usize, String)> = ours.iter().map(|v| {
            (["large", "medium", "small"].iter().position(|k| *k == v["kind"].as_str().unwrap()).unwrap_or(3), ident(v))
        }).collect();
        let mut sorted = order.clone();
        sorted.sort();
        assert_eq!(order, sorted, "{tag}");
    }
}

#[test]
fn the_navaids_in_view_are_the_planners_vors() {
    let bytes = pack_bytes();
    let packs: Vec<Pack> = bytes.iter().map(|b| Pack::read(b).unwrap()).collect();
    for (tag, south, west, north, east) in BOXES {
        let ours: Value = serde_json::from_str(&view::navaids_in_view(&packs, south, west, north, east)).unwrap();
        let theirs = planner("navaids", tag);
        assert_eq!(ours["fixes"], Value::Array(vec![]));
        let (ours, theirs) = (ours["vors"].as_array().unwrap(), theirs["vors"].as_array().unwrap());
        assert_eq!(ours.len(), theirs.len(), "{tag}");
        for (got, want) in ours.iter().zip(theirs) {
            assert_eq!(keys(got), keys(want), "{tag}: the fields of {}", want["ident"]);
            for field in ["ident", "name", "kind", "freq", "lat", "lon", "mag_var", "elevation_ft", "channel", "service_volume", "hours", "restricted"] {
                assert_eq!(got[field], want[field], "{tag}: {} {field}", want["ident"]);
            }
            // NAV_RMK is not in a pack.
            assert_eq!(got["remarks"], Value::Array(vec![]));
        }
    }
}

#[test]
fn nothing_in_view_is_nothing() {
    let bytes = pack_bytes();
    let packs: Vec<Pack> = bytes.iter().map(|b| Pack::read(b).unwrap()).collect();
    assert_eq!(view::airspace_in_view(&[], 41.5, -88.5, 42.5, -87.5), "{\"volumes\":[]}");
    assert_eq!(view::airports_in_view(&[], 41.5, -88.5, 42.5, -87.5), "{\"airports\":[]}");
    assert_eq!(view::navaids_in_view(&[], 41.5, -88.5, 42.5, -87.5), "{\"vors\":[],\"fixes\":[]}");
    // Open sea, in a region the packs are not of.
    assert_eq!(view::airspace_in_view(&packs, 30.0, -140.0, 31.0, -139.0), "{\"volumes\":[]}");
    assert_eq!(view::airports_in_view(&packs, 30.0, -140.0, 31.0, -139.0), "{\"airports\":[]}");
}

/// A pan asks all three for a phone's view: a degree across, both packs.
/// The least of many runs, as the Mac that measures is busy with the
/// stack; the release build's figure is the one that counts.
#[test]
fn a_phone_view_is_answered_quickly() {
    let bytes = pack_bytes();
    let packs: Vec<Pack> = bytes.iter().map(|b| Pack::read(b).unwrap()).collect();
    let (south, west, north, east) = (41.5, -88.5, 42.5, -87.5);
    let mut least = [std::time::Duration::MAX; 4];
    let mut sizes = [0usize; 3];
    for _ in 0..30 {
        let t = Instant::now();
        let airspace = view::airspace_in_view(&packs, south, west, north, east);
        least[0] = least[0].min(t.elapsed());
        let t = Instant::now();
        let airports = view::airports_in_view(&packs, south, west, north, east);
        least[1] = least[1].min(t.elapsed());
        let t = Instant::now();
        let navaids = view::navaids_in_view(&packs, south, west, north, east);
        least[2] = least[2].min(t.elapsed());
        let t = Instant::now();
        let places: usize = packs.iter().map(|p| wingtip_engine::spoken::places_of(p).len()).sum();
        least[3] = least[3].min(t.elapsed());
        sizes = [airspace.len(), airports.len(), navaids.len()];
        assert!(places > 0);
    }
    println!("least of 30: airspace {:?} ({} bytes), airports {:?} ({} bytes), navaids {:?} ({} bytes); the tables read {:?}",
             least[0], sizes[0], least[1], sizes[1], least[2], sizes[2], least[3]);
    // Loose for a debug build.
    assert!(least[0] + least[1] + least[2] < std::time::Duration::from_millis(500));
}
