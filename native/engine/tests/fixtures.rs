//! The engine against the shared fixtures (tests/fixtures/native), which
//! tests/test_native.py reads as well: two real routes' grids with the
//! turns, minutes and cells the Python gave on them, and the Chicago
//! airspace with the records shapely found holding real taps.

use flate2::read::GzDecoder;
use serde_json::Value;
use std::collections::HashSet;
use std::io::Read;
use std::path::PathBuf;
use wingtip_engine::airspace::{shape_holds, shape_to_wkb, wkb_holds};
use wingtip_engine::grid::{line_cells, straightened, Cell, Costs, Geom, Point, Straighten};

/// From route_options: a cell is a quarter of a degree.
const CELL_DEG: f64 = 0.25;

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/native")
}

fn gunzip(name: &str) -> Vec<u8> {
    let mut out = Vec::new();
    GzDecoder::new(std::fs::read(fixtures().join(name)).unwrap().as_slice()).read_to_end(&mut out).unwrap();
    out
}

fn f64s(b: &[u8]) -> Vec<f64> {
    b.chunks_exact(8).map(|c| f64::from_le_bytes(c.try_into().unwrap())).collect()
}

fn i64s(b: &[u8]) -> Vec<i64> {
    b.chunks_exact(8).map(|c| i64::from_le_bytes(c.try_into().unwrap())).collect()
}

fn point(v: &Value) -> Point {
    (v[0].as_f64().unwrap(), v[1].as_f64().unwrap())
}

fn floats(v: &Value) -> Vec<f64> {
    v.as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect()
}

fn route(name: &str) {
    let raw = gunzip(&format!("route-{name}.grid.gz"));
    let line = raw.iter().position(|&b| b == b'\n').unwrap();
    let header: Value = serde_json::from_slice(&raw[..line]).unwrap();
    let mut at = line + 1;
    let mut arrays = std::collections::HashMap::new();
    for spec in header["arrays"].as_array().unwrap() {
        let size: usize = spec[2].as_array().unwrap().iter().map(|d| d.as_u64().unwrap() as usize).product::<usize>() * 8;
        arrays.insert(spec[0].as_str().unwrap().to_owned(), raw[at..at + size].to_vec());
        at += size;
    }
    let shape = &header["arrays"][0][2];
    let (rows, cols) = (shape[0].as_u64().unwrap() as usize, shape[1].as_u64().unwrap() as usize);
    let (closed, marginal) = (i64s(&arrays["closed"]), i64s(&arrays["marginal"]));
    let (dear, offshore, gs) = (f64s(&arrays["dear"]), f64s(&arrays["offshore"]), f64s(&arrays["gs"]));
    let ends: HashSet<Cell> = header["ends"].as_array().unwrap().iter()
        .map(|e| (e[0].as_i64().unwrap(), e[1].as_i64().unwrap())).collect();
    let corner = point(&header["corner"]);
    let g = Geom::new(corner.0, corner.1, CELL_DEG, rows as i64, cols as i64).unwrap();
    let costs = Costs::new(rows, cols, &closed, &marginal, &dear, &offshore, &gs, &ends).unwrap();
    // _line_minutes asks with no ends.
    let none = HashSet::new();
    let legs_costs = Costs::new(rows, cols, &marginal, &marginal, &dear, &offshore, &gs, &none).unwrap();
    let cases: Value = serde_json::from_slice(&gunzip(&format!("route-{name}.json.gz"))).unwrap();
    let cases = cases.as_array().unwrap();
    assert!(!cases.is_empty());
    for case in cases {
        let points: Vec<Point> = case["points"].as_array().unwrap().iter().map(point).collect();
        let leg_nm = floats(&case["leg_nm"]);
        let nm_from: Vec<Vec<f64>> = case["nm_from"].as_array().unwrap().iter().map(floats).collect();
        let how = Straighten {
            marginal_cost: case["marginal_cost"].as_f64().unwrap(),
            slower_min: case["slower_min"].as_f64().unwrap(),
            water_cost: case["water_cost"].as_f64().unwrap(),
        };
        let turns = straightened(g, &costs, &points, &leg_nm, |i| Ok::<_, ()>(nm_from[i].clone()), &how).unwrap();
        let want: Vec<Point> = case["turns"].as_array().unwrap().iter().map(point).collect();
        assert_eq!(turns.iter().map(|&k| points[k]).collect::<Vec<_>>(), want, "{name}");
        let legs: Vec<f64> = points.windows(2).zip(&leg_nm).map(|(w, &nm)| {
            if nm == 0.0 { 0.0 } else {
                legs_costs.minutes(&line_cells(g, w[0], w[1]), w[0], w[1], nm, how.marginal_cost, how.water_cost)
            }
        }).collect();
        assert_eq!(legs, floats(&case["legs_min"]), "{name}");
        for (p, want) in points[1..].iter().zip(case["cells_from_first"].as_array().unwrap()) {
            let want: Vec<Cell> = want.as_array().unwrap().iter()
                .map(|c| (c[0].as_i64().unwrap(), c[1].as_i64().unwrap())).collect();
            assert_eq!(line_cells(g, points[0], *p), want, "{name}");
        }
    }
}

#[test]
fn kmsp_kden_turns_where_the_python_turned() {
    route("KMSP-KDEN");
}

#[test]
fn kdlh_kstl_turns_where_the_python_turned() {
    route("KDLH-KSTL");
}

#[test]
fn chicago_taps_find_the_records_shapely_found() {
    let shp = gunzip("chicago_airspace.shp.gz");
    let shx = std::fs::read(fixtures().join("chicago_airspace.shx")).unwrap();
    // The .shx: from byte 100, each record's offset and length in 16-bit
    // words, big-endian (ESRI's shapefile technical description, 1998).
    let records: Vec<&[u8]> = shx[100..].chunks_exact(8).map(|e| {
        let offset = u32::from_be_bytes(e[..4].try_into().unwrap()) as usize * 2 + 8;
        let length = u32::from_be_bytes(e[4..].try_into().unwrap()) as usize * 2;
        &shp[offset..offset + length]
    }).collect();
    let wkbs: Vec<Vec<u8>> = records.iter().map(|r| shape_to_wkb(r).unwrap()).collect();
    let taps: Value = serde_json::from_slice(&std::fs::read(fixtures().join("chicago_airspace.json")).unwrap()).unwrap();
    for (name, tap) in taps.as_object().unwrap() {
        let (lat, lon) = point(&tap["at"]);
        let want: Vec<usize> = tap["records"].as_array().unwrap().iter().map(|v| v.as_u64().unwrap() as usize).collect();
        let found: Vec<usize> = (0..records.len()).filter(|&i| shape_holds(records[i], lon, lat).unwrap()).collect();
        assert_eq!(found, want, "{name}");
        let from_wkb: Vec<usize> = (0..wkbs.len()).filter(|&i| wkb_holds(&wkbs[i], lon, lat).unwrap()).collect();
        assert_eq!(from_wkb, want, "{name}");
    }
}
