//! vfr_native: wingtip-engine (native/engine) as vfr imports it. Only
//! the crossing from Python lives here -- numpy's arrays and mapped files
//! borrowed in place, errors turned into ValueError; every figure is the
//! engine's.

use pyo3::buffer::{Element, PyBuffer, ReadOnlyCell};
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyBytes;
use std::collections::HashSet;
use wingtip_engine::grid::{self, Cell, Costs, Geom, Point, StraightError, Straighten, Values};
use wingtip_engine::{airspace, flight, geo, metar, notam, pack, phone, taf, tfr, validity, winds, wmm};

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
/// `nm_from(i)` is vfr.geo's distance from point i to every point.
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
/// "sections"} (pack::Pack::read).
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
/// (phone::airspace_at): what the phones answer with no network.
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

#[pyfunction]
#[pyo3(signature = (product_name, observed=None, last_routine=None, valid_to=None))]
fn weather_expires_at(product_name: &str, observed: Option<i64>, last_routine: Option<i64>, valid_to: Option<i64>) -> PyResult<Option<i64>> {
    Ok(validity::expires_at(product(product_name)?, observed, last_routine, valid_to))
}

#[pyfunction]
#[pyo3(signature = (product_name, now, observed=None, last_routine=None, valid_from=None, valid_to=None))]
fn weather_in_force(product_name: &str, now: i64, observed: Option<i64>, last_routine: Option<i64>,
                    valid_from: Option<i64>, valid_to: Option<i64>) -> PyResult<bool> {
    Ok(validity::in_force(product(product_name)?, now, observed, last_routine, valid_from, valid_to))
}

// The products as sent, read by the engine: each answer JSON in the
// planner's own names, None where the text is no such product.

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

#[pyfunction]
fn notams_json(text: &str) -> String {
    notam::to_json(&notam::from_fns(text))
}

#[pyfunction]
fn notam_text_json(raw: &str) -> Option<String> {
    notam::from_text(raw).map(|n| notam::to_json(&[n]))
}

#[pymodule]
fn vfr_native(m: &Bound<'_, PyModule>) -> PyResult<()> {
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
        wrap_pyfunction!(weather_expires_at, m)?, wrap_pyfunction!(weather_in_force, m)?,
        wrap_pyfunction!(metar_json, m)?, wrap_pyfunction!(taf_json, m)?, wrap_pyfunction!(winds_json, m)?,
        wrap_pyfunction!(tfr_detail_json, m)?, wrap_pyfunction!(notams_json, m)?, wrap_pyfunction!(notam_text_json, m)?,
    ] {
        m.add_function(f)?;
    }
    Ok(())
}
