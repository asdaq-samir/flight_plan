//! wingtip_native: wingtip-engine (native/engine) as wingtip imports it. Only
//! the crossing from Python lives here -- numpy's arrays and mapped files
//! borrowed in place, errors turned into ValueError; every figure is the
//! engine's.

use pyo3::buffer::{Element, PyBuffer, ReadOnlyCell};
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyBytes;
use std::collections::HashSet;
use wingtip_engine::grid::{self, Cell, Costs, Geom, Point, StraightError, Straighten, Values};
use wingtip_engine::figures::{debrief, diversion, holding, lost_comms, words};
use wingtip_engine::{ahead, airspace, flight, geo, metar, notam, pack, phone, taf, tfr, validity, winds, wmm};

/// A C-contiguous array's elements, numpy's own memory read in place.
struct Ro<'a, T: Element>(&'a [ReadOnlyCell<T>]);

impl<T: Element + Copy> Values<T> for Ro<'_, T> {
    fn at(&self, i: usize) -> T {
        self.0[i].get()
    }

    fn count(&self) -> usize {
        self.0.len()
    }
}

fn cells<'a, T: Element>(py: Python<'a>, buffer: &'a PyBuffer<T>, dims: usize) -> PyResult<Ro<'a, T>> {
    if buffer.dimensions() != dims {
        return Err(PyValueError::new_err(format!("an array of {dims} dimensions")));
    }
    buffer.as_slice(py).map(Ro).ok_or_else(|| PyValueError::new_err("an array in C order"))
}

/// Bytes, a bytearray, a memoryview or a mapped file, read in place. The
/// object is held for the call, under the GIL, and the planner maps its
/// files read-only, so the bytes do not change under the engine.
fn bytes_of<'a>(buffer: &'a PyBuffer<u8>) -> PyResult<&'a [u8]> {
    if !buffer.is_c_contiguous() {
        return Err(PyValueError::new_err("bytes in one piece"));
    }
    // SAFETY: a contiguous buffer of len_bytes bytes, alive as long as
    // `buffer`, which the borrow ties the slice to.
    Ok(unsafe { std::slice::from_raw_parts(buffer.buf_ptr() as *const u8, buffer.len_bytes()) })
}

fn geom(lat0: f64, lon0: f64, cell: f64, rows: i64, cols: i64) -> PyResult<Geom> {
    Geom::new(lat0, lon0, cell, rows, cols).ok_or_else(|| PyValueError::new_err("an empty grid"))
}

#[pyfunction]
#[allow(clippy::too_many_arguments)]
fn line_cells(a: Point, b: Point, lat0: f64, lon0: f64, cell: f64, rows: i64, cols: i64) -> PyResult<Vec<Cell>> {
    Ok(grid::line_cells(geom(lat0, lon0, cell, rows, cols)?, a, b))
}

#[pyfunction]
#[allow(clippy::too_many_arguments)]
fn line_minutes(py: Python<'_>, a: Point, b: Point, nm: f64, lat0: f64, lon0: f64, cell: f64,
                marginal: PyBuffer<i64>, dear: PyBuffer<f64>, offshore: PyBuffer<f64>, gs: PyBuffer<f64>,
                marginal_cost: f64, water_cost: f64) -> PyResult<f64> {
    let (rows, cols) = (marginal.shape()[0], marginal.shape()[1]);
    let g = geom(lat0, lon0, cell, rows as i64, cols as i64)?;
    let ends = HashSet::new();
    let (m, d, o, s) = (cells(py, &marginal, 2)?, cells(py, &dear, 2)?, cells(py, &offshore, 2)?, cells(py, &gs, 3)?);
    let costs = Costs::new(rows, cols, &m, &m, &d, &o, &s, &ends).map_err(PyValueError::new_err)?;
    Ok(costs.minutes(&grid::line_cells(g, a, b), a, b, nm, marginal_cost, water_cost))
}

/// _straightened's turns, as indices into the points (grid::straightened).
/// `nm_from(i)` is wingtip.geo's distance from point i to every point.
#[pyfunction]
#[allow(clippy::too_many_arguments)]
fn straightened(py: Python<'_>, points: Vec<Point>, lat0: f64, lon0: f64, cell: f64, closed: PyBuffer<i64>,
                marginal: PyBuffer<i64>, dear: PyBuffer<f64>, offshore: PyBuffer<f64>, gs: PyBuffer<f64>,
                ends: Vec<Cell>, leg_nm: PyBuffer<f64>, nm_from: &Bound<'_, PyAny>, marginal_cost: f64,
                slower_min: f64, water_cost: f64) -> PyResult<Vec<usize>> {
    if closed.dimensions() != 2 {
        return Err(PyValueError::new_err("the grid's closed cells, rows by columns"));
    }
    let (rows, cols) = (closed.shape()[0], closed.shape()[1]);
    let g = geom(lat0, lon0, cell, rows as i64, cols as i64)?;
    let ends: HashSet<Cell> = ends.into_iter().collect();
    let (c, m, d, o, s) = (cells(py, &closed, 2)?, cells(py, &marginal, 2)?, cells(py, &dear, 2)?,
                           cells(py, &offshore, 2)?, cells(py, &gs, 3)?);
    if gs.shape()[2] != 8 {
        return Err(PyValueError::new_err("groundspeeds eight ways a cell"));
    }
    let costs = Costs::new(rows, cols, &c, &m, &d, &o, &s, &ends).map_err(PyValueError::new_err)?;
    let leg_nm = leg_nm.to_vec(py)?;
    let how = Straighten { marginal_cost, slower_min, water_cost };
    let nm = |i: usize| -> PyResult<Vec<f64>> { PyBuffer::<f64>::get(&nm_from.call1((i,))?)?.to_vec(py) };
    grid::straightened(g, &costs, &points, &leg_nm, nm, &how).map_err(|e| match e {
        StraightError::Legs => PyValueError::new_err("a leg's miles for each pair of points"),
        StraightError::Distances(err) => err,
    })
}

#[pyfunction]
fn shape_holds(content: PyBuffer<u8>, lon: f64, lat: f64) -> PyResult<bool> {
    airspace::shape_holds(bytes_of(&content)?, lon, lat)
        .ok_or_else(|| PyValueError::new_err("a shapefile record cut short"))
}

/// Tests only: an oracle for the pack's shapes in tests/test_native.py.
#[pyfunction]
fn wkb_holds(wkb: PyBuffer<u8>, lon: f64, lat: f64) -> PyResult<bool> {
    airspace::wkb_holds(bytes_of(&wkb)?, lon, lat).ok_or_else(|| PyValueError::new_err("not a WKB polygon"))
}

/// A shapefile Polygon record's rings as the pack's WKB (airspace::shape_to_wkb).
#[pyfunction]
fn shape_to_wkb<'py>(py: Python<'py>, content: PyBuffer<u8>) -> PyResult<Bound<'py, PyBytes>> {
    let wkb = airspace::shape_to_wkb(bytes_of(&content)?)
        .ok_or_else(|| PyValueError::new_err("a shapefile record cut short"))?;
    Ok(PyBytes::new(py, &wkb))
}

fn read_pack(bytes: &[u8]) -> PyResult<pack::Pack<'_>> {
    pack::Pack::read(bytes).map_err(|e| PyValueError::new_err(format!("not a cycle pack: {e:?}")))
}

/// The pack's header and sections: {"cycle", "built_at", "crc32",
/// "sections"} (pack::Pack::read). Tests only: tests/test_native.py's
/// oracle.
#[pyfunction]
fn pack_header(py: Python<'_>, data: PyBuffer<u8>) -> PyResult<Py<PyAny>> {
    let p = read_pack(bytes_of(&data)?)?;
    let header = pyo3::types::PyDict::new(py);
    header.set_item("cycle", &p.cycle)?;
    header.set_item("built_at", p.built_at)?;
    header.set_item("crc32", p.crc32)?;
    header.set_item("sections", p.names().map(str::to_owned).collect::<Vec<_>>())?;
    Ok(header.into_any().unbind())
}

/// Tests only: tests/test_native.py's oracle.
#[pyfunction]
fn pack_verify(data: PyBuffer<u8>) -> PyResult<bool> {
    Ok(read_pack(bytes_of(&data)?)?.verify())
}

/// The shapes of the pack's `layer` holding the point, in its order
/// (pack::Layer::holding).
#[pyfunction]
fn pack_holding(data: PyBuffer<u8>, layer: &str, lon: f64, lat: f64) -> PyResult<Vec<usize>> {
    let p = read_pack(bytes_of(&data)?)?;
    let l = p.layer(layer).ok_or_else(|| PyValueError::new_err(format!("no layer {layer} in the pack")))?;
    l.holding(lon, lat).ok_or_else(|| PyValueError::new_err(format!("a shape in {layer} the engine cannot read")))
}

/// The planner's AirspaceAt for the point as JSON, from a phone's pack
/// (phone::airspace_at): what the phones answer with no network. Tests
/// only: tests/test_phone_pack.py's oracle.
#[pyfunction]
#[pyo3(signature = (data, lat, lon, ground_ft=None))]
fn airspace_at_json(data: Option<PyBuffer<u8>>, lat: f64, lon: f64, ground_ft: Option<f64>) -> PyResult<String> {
    let answer = match &data {
        Some(d) => phone::airspace_at(Some(&read_pack(bytes_of(d)?)?), lat, lon, ground_ft),
        None => phone::airspace_at(None, lat, lon, ground_ft),
    };
    answer.ok_or_else(|| PyValueError::new_err("a shape in the pack the engine cannot read"))
}

/// The region whose phone pack holds a point (phone::region_of).
#[pyfunction]
fn region_of(lat: f64, lon: f64) -> String {
    phone::region_of(lat, lon)
}

/// The geodesic distance in nm (geo::distance_nm), against pyproj's.
#[pyfunction]
fn distance_nm(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    geo::distance_nm(lat1, lon1, lat2, lon2)
}

// The flight's figures (wingtip_engine::flight, wmm, validity): one copy
// for the planner and the phones.

#[pyfunction]
fn wind_correction_deg(true_course_deg: f64, wind_from_deg: f64, wind_kt: f64, tas_kt: f64) -> f64 {
    flight::wind_correction_deg(true_course_deg, wind_from_deg, wind_kt, tas_kt)
}

#[pyfunction]
fn groundspeed_kt(true_course_deg: f64, wind_from_deg: f64, wind_kt: f64, tas_kt: f64, wca_deg: f64) -> f64 {
    flight::groundspeed_kt(true_course_deg, wind_from_deg, wind_kt, tas_kt, wca_deg)
}

#[pyfunction]
fn wind_triangle(true_course_deg: f64, tas_kt: f64, wind_from_deg: f64, wind_kt: f64) -> Option<(f64, f64, f64)> {
    flight::wind_triangle(true_course_deg, tas_kt, wind_from_deg, wind_kt)
}

#[pyfunction]
fn is_eastbound(magnetic_course_deg: f64) -> bool {
    flight::is_eastbound(magnetic_course_deg)
}

#[pyfunction]
fn lowest_vfr_cruising_altitude(floor_ft: f64, magnetic_course_deg: f64) -> f64 {
    flight::lowest_vfr_cruising_altitude(floor_ft, magnetic_course_deg)
}

#[pyfunction]
fn reserve_min(ifr: bool, night: bool) -> f64 {
    flight::reserve_min(ifr, night)
}

#[pyfunction]
fn isa_temp_c(altitude_ft: f64) -> f64 {
    flight::isa_temp_c(altitude_ft)
}

#[pyfunction]
fn density_ratio(altitude_ft: f64, oat_c: f64) -> f64 {
    flight::density_ratio(altitude_ft, oat_c)
}

#[pyfunction]
fn density_altitude_ft(sigma: f64) -> f64 {
    flight::density_altitude_ft(sigma)
}

#[pyfunction]
fn pressure_altitude_ft(elevation_ft: f64, altimeter_inhg: f64) -> f64 {
    flight::pressure_altitude_ft(elevation_ft, altimeter_inhg)
}

#[pyfunction]
fn declination(lat: f64, lon: f64, year: f64) -> f64 {
    wmm::declination(lat, lon, year)
}

fn product(name: &str) -> PyResult<validity::Product> {
    Ok(match name {
        "metar" => validity::Product::Metar,
        "speci" => validity::Product::Speci,
        "taf" => validity::Product::Taf,
        "winds" => validity::Product::WindsAloft,
        "advisory" => validity::Product::Advisory,
        _ => return Err(PyValueError::new_err("metar, speci, taf, winds or advisory")),
    })
}

/// Tests only: an oracle for tests/test_flight_rules.py.
#[pyfunction]
#[pyo3(signature = (product_name, now, observed=None, last_routine=None, valid_from=None, valid_to=None))]
fn weather_in_force(product_name: &str, now: i64, observed: Option<i64>, last_routine: Option<i64>,
                    valid_from: Option<i64>, valid_to: Option<i64>) -> PyResult<bool> {
    Ok(validity::in_force(product(product_name)?, now, observed, last_routine, valid_from, valid_to))
}

// The products as sent, read by the engine: each answer JSON in the
// planner's own names, None where the text is no such product.

/// Tests only: metar_json and taf_json are tests/test_parsers.py's oracles.
#[pyfunction]
fn metar_json(raw: &str) -> Option<String> {
    metar::parse(raw).map(|m| metar::to_json(&m))
}

#[pyfunction]
fn taf_json(raw: &str, near: i64) -> Option<String> {
    taf::parse(raw, near).map(|t| taf::to_json(&t))
}

#[pyfunction]
fn winds_json(text: &str, now: i64) -> Option<String> {
    winds::parse(text, now).map(|p| winds::to_json(&p))
}

/// A TFR's detail; ValueError where the file is not XML, None where it
/// holds no NOTAM.
#[pyfunction]
fn tfr_detail_json(text: &str) -> PyResult<Option<String>> {
    if let Err(e) = wingtip_engine::xml::parse(text) {
        return Err(PyValueError::new_err(format!("not XML: {} at {}", e.what, e.at)));
    }
    Ok(tfr::parse_detail(text).map(|d| tfr::to_json(&d)))
}

/// Tests only: an oracle for tests/test_parsers.py.
#[pyfunction]
fn notam_text_json(raw: &str) -> Option<String> {
    notam::from_text(raw).map(|n| notam::to_json(&[n]))
}

/// The alerts ahead from phone packs (wingtip_engine::ahead), JSON. Tests
/// only: tests/test_phone_pack.py's oracle.
#[pyfunction]
#[pyo3(signature = (packs, lat, lon, track_deg, gs_kt, alt_ft, vs_fpm, now, tfr_lines=None, tfrs_at=None))]
#[allow(clippy::too_many_arguments)]
fn ahead_json(packs: Vec<PyBuffer<u8>>, lat: f64, lon: f64, track_deg: f64, gs_kt: f64, alt_ft: Option<f64>, vs_fpm: f64,
              now: i64, tfr_lines: Option<&str>, tfrs_at: Option<i64>) -> PyResult<String> {
    let mut read = Vec::new();
    for b in &packs {
        read.push(read_pack(bytes_of(b)?)?);
    }
    Ok(ahead::ahead(&read, lat, lon, track_deg, gs_kt, alt_ft, vs_fpm, now, tfr_lines, tfrs_at))
}

// The four pilot pages' figures (wingtip_engine::figures): app.figures
// carries only the dicts across, every rule and word is the engine's.

/// A direction as a pilot writes it, "005°" (figures::words::bearing).
#[pyfunction]
fn figures_bearing(deg: f64) -> String {
    words::bearing(deg)
}

/// A correction signed, "+8°", "−3°" (figures::words::wind_correction).
#[pyfunction]
fn figures_wind_correction(deg: f64) -> String {
    words::wind_correction(deg)
}

fn entry_of(key: &str) -> PyResult<holding::Entry> {
    holding::Entry::from_key(key).ok_or_else(|| PyValueError::new_err("direct, teardrop or parallel"))
}

/// The entry by AIM 5-3-8's sectors and the other one near an edge, keys.
#[pyfunction]
fn holding_entry(inbound_deg: f64, heading_deg: f64, right: bool) -> (&'static str, Option<&'static str>) {
    let (entry, either) = holding::holding_entry(inbound_deg, heading_deg, right);
    (entry.key(), either.map(holding::Entry::key))
}

#[pyfunction]
fn holding_entry_name(key: &str) -> PyResult<&'static str> {
    Ok(entry_of(key)?.name())
}

#[pyfunction]
fn holding_approach_relative(inbound_deg: f64, heading_deg: f64) -> f64 {
    holding::approach_relative(inbound_deg, heading_deg)
}

#[pyfunction]
#[pyo3(signature = (altitude_ft=None))]
fn holding_leg_minutes(altitude_ft: Option<f64>) -> f64 {
    holding::leg_minutes(altitude_ft)
}

/// The legs in the wind and their words as JSON; None where the wind is
/// stronger than the airplane (holding::holding_wind).
#[pyfunction]
fn holding_wind_json(inbound_deg: f64, tas_kt: f64, wind_from_deg: f64, wind_kt: f64, altitude_ft: f64) -> Option<String> {
    holding::holding_wind(inbound_deg, tas_kt, wind_from_deg, wind_kt, altitude_ft).map(|w| {
        let mut out = String::new();
        holding::wind_json(&mut out, &w);
        out
    })
}

#[pyfunction]
fn holding_entry_steps(entry: &str, inbound: f64, right: bool, altitude_ft: f64) -> PyResult<String> {
    Ok(holding::entry_steps(entry_of(entry)?, inbound, right, altitude_ft))
}

/// The rows' words for legs already worked out: inbound, outbound, time.
#[pyfunction]
fn holding_wind_words(leg_min: f64, inbound_wca: f64, inbound_gs: f64, outbound_wca: f64, rule_sec: f64) -> (String, String, String) {
    let leg = |wca, gs| holding::HoldLeg { heading: 0.0, wca, gs };
    holding::wind_words(&holding::HoldWind {
        leg_min, inbound: leg(inbound_wca, inbound_gs), outbound: leg(outbound_wca, 0.0), outbound_sec: 0.0, rule_sec,
    })
}

/// 91.185(c)(1)'s routes in order, (key, label, rule), and (b)'s words.
#[pyfunction]
fn lost_comms_routes() -> (Vec<(&'static str, &'static str, &'static str)>, &'static str) {
    (lost_comms::ROUTES.to_vec(), lost_comms::VFR_WORDS)
}

/// Each segment's (name, altitude, why) by 91.185(c)(2).
#[pyfunction]
#[pyo3(signature = (segments, assigned_ft, expected_ft, expected_from))]
fn lost_comms_altitudes(segments: Vec<(String, Option<f64>)>, assigned_ft: Option<f64>, expected_ft: Option<f64>,
                        expected_from: i64) -> Vec<(String, Option<f64>, Option<&'static str>)> {
    lost_comms::segment_altitudes(&segments, assigned_ft, expected_ft, expected_from)
        .into_iter()
        .map(|f| (f.name, f.fly.map(|f| f.0), f.fly.map(|f| f.1.key())))
        .collect()
}

#[pyfunction]
#[pyo3(signature = (fly, because))]
fn lost_comms_fly_words(fly: Option<f64>, because: Option<&str>) -> PyResult<String> {
    let flown = match (fly, because) {
        (Some(ft), Some(b)) => Some((ft, lost_comms::Because::from_key(b)
            .ok_or_else(|| PyValueError::new_err("assigned, minimum or expected"))?)),
        _ => None,
    };
    Ok(lost_comms::fly_words(flown))
}

#[pyfunction]
fn lost_comms_leave(approach_fix: bool, efc: &str, eta: &str) -> String {
    lost_comms::leave_limit(approach_fix, efc, eta)
}

/// The drill's estimates and their allowances: (key, label, unit, allowance).
#[pyfunction]
fn diversion_allowances() -> Vec<(&'static str, &'static str, &'static str, f64)> {
    diversion::ALLOWANCES.to_vec()
}

/// The diversion worked out, (tc, distance_nm, wca, th, mh, gs, ete,
/// fuel); None where no heading holds the course (diversion::divert).
#[pyfunction]
#[allow(clippy::too_many_arguments, clippy::type_complexity)]
fn diversion_divert(tc_deg: f64, distance_nm: f64, tas_kt: f64, fuel_burn_gph: f64, magnetic_variation_deg: f64,
                    wind_from_deg: f64, wind_kt: f64) -> Option<(f64, f64, f64, f64, f64, f64, f64, f64)> {
    let air = diversion::Air { tas_kt, fuel_burn_gph, magnetic_variation_deg, wind_from_deg, wind_kt };
    diversion::divert(&air, tc_deg, distance_nm).map(|d| (d.tc, d.distance_nm, d.wca, d.th, d.mh, d.gs, d.ete, d.fuel))
}

/// The drill's wind triangle, (wca, th, gs); None where no heading holds.
#[pyfunction]
fn diversion_wind_triangle(tc: f64, tas: f64, wind_from_deg: f64, wind_kt: f64) -> Option<(f64, f64, f64)> {
    diversion::wind_triangle(tc, tas, wind_from_deg, wind_kt)
}

/// The drill's whole answer from the leg's air, JSON {"solved", "steps",
/// "problem", "checks"}: `to` the field's ident, the estimates in
/// ALLOWANCES' order (diversion::diversion_json).
#[pyfunction]
#[allow(clippy::too_many_arguments)]
#[pyo3(signature = (tc_deg, distance_nm, tas_kt, fuel_burn_gph, magnetic_variation_deg, wind_from_deg, wind_kt, to, mh=None, gs=None, ete=None, fuel=None))]
fn diversion_json(tc_deg: f64, distance_nm: f64, tas_kt: f64, fuel_burn_gph: f64, magnetic_variation_deg: f64, wind_from_deg: f64,
                  wind_kt: f64, to: &str, mh: Option<f64>, gs: Option<f64>, ete: Option<f64>, fuel: Option<f64>) -> String {
    let air = diversion::Air { tas_kt, fuel_burn_gph, magnetic_variation_deg, wind_from_deg, wind_kt };
    diversion::diversion_json(&air, tc_deg, distance_nm, to, [mh, gs, ete, fuel])
}

/// The entry into a hold for an airplane arriving on a course, a key
/// (holding::entry, wingtip.holds.entry).
#[pyfunction]
fn hold_entry(arrival_deg: f64, inbound_deg: f64, right: bool) -> &'static str {
    holding::entry(arrival_deg, inbound_deg, right).key()
}

#[pyfunction]
fn diversion_reasonable(key: &str, typed: f64, exact: f64) -> PyResult<bool> {
    diversion::reasonable(key, typed, exact).ok_or_else(|| PyValueError::new_err("mh, gs, ete or fuel"))
}

/// A track's point as app.figures passes it: (t ms, lat, lon, alt_ft).
type TrackPoint = (f64, f64, f64, Option<f64>);
/// A checkpoint: (sequence_no, name, category, lat, lon, along_track_nm,
/// true_course_deg, ete_min, altitude_ft).
type SavedCheckpoint = (i64, String, String, f64, f64, f64, Option<f64>, Option<f64>, Option<f64>);

fn track(points: Vec<TrackPoint>) -> Vec<debrief::Point> {
    points.into_iter().map(|(t, lat, lon, alt_ft)| debrief::Point { t, lat, lon, alt_ft }).collect()
}

/// The track's flights, (first, last) indices (debrief::airborne).
#[pyfunction]
fn debrief_airborne(points: Vec<TrackPoint>) -> Vec<(usize, usize)> {
    debrief::airborne(&track(points))
}

/// The flight debriefed, unmarked, as JSON; None where the track never
/// flew (debrief::debrief). The points in time order.
#[pyfunction]
fn debrief_json(checkpoints: Vec<SavedCheckpoint>, points: Vec<TrackPoint>, patterns: Vec<(String, f64)>) -> Option<String> {
    let cps: Vec<debrief::Checkpoint> = checkpoints
        .into_iter()
        .map(|(sequence_no, name, category, lat, lon, along_track_nm, true_course_deg, ete_min, altitude_ft)| debrief::Checkpoint {
            sequence_no, name, category, lat, lon, along_track_nm, true_course_deg, ete_min, altitude_ft,
        })
        .collect();
    debrief::debrief(&cps, &track(points), &patterns).map(|d| debrief::to_json(&d, false))
}

/// Each finding's mark against PA.VI.A's tolerances: the legs' ok from
/// (worst_alt_ft, worst_off_nm); the passes' (landed, late_min, ok) from
/// (category, due_min, passed_min); the patterns' (off_ft, ok) from
/// (alt_ft, pattern_ft).
#[pyfunction]
#[allow(clippy::type_complexity)]
fn debrief_marks(legs: Vec<(Option<f64>, Option<f64>)>, passes: Vec<(String, Option<f64>, Option<f64>)>,
                 patterns: Vec<(f64, f64)>) -> (Vec<bool>, Vec<(bool, Option<f64>, Option<bool>)>, Vec<(f64, bool)>) {
    (
        legs.into_iter().map(|(alt, off)| debrief::leg_ok(alt, off)).collect(),
        passes.into_iter().map(|(category, due, passed)| debrief::pass_marks(&category, due, passed)).collect(),
        patterns.into_iter().map(|(alt, pattern)| debrief::pattern_marks(alt, pattern)).collect(),
    )
}

/// The tolerances the debrief holds a flight to, as JSON.
#[pyfunction]
fn debrief_tolerances_json() -> String {
    debrief::tolerances_json()
}

/// The engine's one way in, as the web app and the phones ask it: a rule
/// by name (wingtip_engine::call), its input and answer JSON text. A name
/// not known or input not of the rule's shape is a ValueError with the
/// engine's words.
#[pyfunction]
fn call(name: &str, input: &str) -> PyResult<String> {
    wingtip_engine::call::call(name, input).map_err(PyValueError::new_err)
}

#[pymodule]
fn wingtip_native(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(call, m)?)?;
    m.add_function(wrap_pyfunction!(line_cells, m)?)?;
    m.add_function(wrap_pyfunction!(line_minutes, m)?)?;
    m.add_function(wrap_pyfunction!(straightened, m)?)?;
    m.add_function(wrap_pyfunction!(shape_holds, m)?)?;
    m.add_function(wrap_pyfunction!(wkb_holds, m)?)?;
    m.add_function(wrap_pyfunction!(shape_to_wkb, m)?)?;
    m.add_function(wrap_pyfunction!(pack_header, m)?)?;
    m.add_function(wrap_pyfunction!(pack_verify, m)?)?;
    m.add_function(wrap_pyfunction!(pack_holding, m)?)?;
    m.add_function(wrap_pyfunction!(airspace_at_json, m)?)?;
    m.add_function(wrap_pyfunction!(distance_nm, m)?)?;
    m.add_function(wrap_pyfunction!(region_of, m)?)?;
    for f in [
        wrap_pyfunction!(wind_correction_deg, m)?, wrap_pyfunction!(groundspeed_kt, m)?, wrap_pyfunction!(wind_triangle, m)?,
        wrap_pyfunction!(is_eastbound, m)?, wrap_pyfunction!(lowest_vfr_cruising_altitude, m)?, wrap_pyfunction!(reserve_min, m)?,
        wrap_pyfunction!(isa_temp_c, m)?, wrap_pyfunction!(density_ratio, m)?, wrap_pyfunction!(density_altitude_ft, m)?,
        wrap_pyfunction!(pressure_altitude_ft, m)?, wrap_pyfunction!(declination, m)?,
        wrap_pyfunction!(weather_in_force, m)?,
        wrap_pyfunction!(ahead_json, m)?, wrap_pyfunction!(metar_json, m)?, wrap_pyfunction!(taf_json, m)?, wrap_pyfunction!(winds_json, m)?,
        wrap_pyfunction!(tfr_detail_json, m)?, wrap_pyfunction!(notam_text_json, m)?,
        wrap_pyfunction!(figures_bearing, m)?, wrap_pyfunction!(figures_wind_correction, m)?,
        wrap_pyfunction!(holding_entry, m)?, wrap_pyfunction!(holding_entry_name, m)?, wrap_pyfunction!(holding_approach_relative, m)?,
        wrap_pyfunction!(holding_leg_minutes, m)?, wrap_pyfunction!(holding_wind_json, m)?, wrap_pyfunction!(holding_entry_steps, m)?,
        wrap_pyfunction!(holding_wind_words, m)?,
        wrap_pyfunction!(lost_comms_routes, m)?, wrap_pyfunction!(lost_comms_altitudes, m)?, wrap_pyfunction!(lost_comms_fly_words, m)?,
        wrap_pyfunction!(lost_comms_leave, m)?,
        wrap_pyfunction!(diversion_allowances, m)?, wrap_pyfunction!(diversion_divert, m)?, wrap_pyfunction!(diversion_reasonable, m)?,
        wrap_pyfunction!(diversion_wind_triangle, m)?, wrap_pyfunction!(diversion_json, m)?, wrap_pyfunction!(hold_entry, m)?,
        wrap_pyfunction!(debrief_airborne, m)?, wrap_pyfunction!(debrief_json, m)?, wrap_pyfunction!(debrief_marks, m)?,
        wrap_pyfunction!(debrief_tolerances_json, m)?,
    ] {
        m.add_function(f)?;
    }
    Ok(())
}
