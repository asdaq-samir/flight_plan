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
use wingtip_engine::{airspace, pack};

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
    Ok(())
}
