//! vfr's hot loops, in Rust: route options' straight lines over the grid
//! (vfr.route_options) and whether a Class Airspace shape holds a point
//! (vfr.airspace_at). Each function gives exactly what the Python it
//! stands in for gives -- the same samples, the same sums in the same
//! order -- and tests/test_native.py runs both on the same cases.

use pyo3::buffer::{PyBuffer, ReadOnlyCell};
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use std::collections::HashSet;

/// Where the grid is: its corner, its cell's size in degrees, its size.
#[derive(Clone, Copy)]
struct Geom {
    lat0: f64,
    lon0: f64,
    cell: f64,
    rows: i64,
    cols: i64,
}

/// _Grid.line_cells: the line sampled a third of a cell apart with
/// numpy's linspace (i * (1 / (n - 1)), the last exactly 1), each sample's
/// cell truncated and clipped as astype(int) and np.clip do, a cell kept
/// where it differs from the one before.
fn cells_of(g: Geom, a: (f64, f64), b: (f64, f64)) -> Vec<(i64, i64)> {
    let span = (b.0 - a.0).abs().max((b.1 - a.1).abs());
    let steps = std::cmp::max(2, (span / (g.cell / 3.0)) as i64 + 1);
    let step = 1.0 / (steps - 1) as f64;
    let (d_lat, d_lon) = (b.0 - a.0, b.1 - a.1);
    let mut out: Vec<(i64, i64)> = Vec::with_capacity(steps as usize);
    for i in 0..steps {
        let t = if i == steps - 1 { 1.0 } else { i as f64 * step + 0.0 };
        let r = (((a.0 + d_lat * t) - g.lat0) / g.cell) as i64;
        let c = (((a.1 + d_lon * t) - g.lon0) / g.cell) as i64;
        let cell = (r.clamp(0, g.rows - 1), c.clamp(0, g.cols - 1));
        if out.last() != Some(&cell) {
            out.push(cell);
        }
    }
    out
}

/// numpy's sum of float64 (pairwise_sum in loops_utils.h): eight running
/// sums in blocks of up to 128, halves above that.
fn pairwise(a: &[f64]) -> f64 {
    let n = a.len();
    if n < 8 {
        let mut res = 0.0;
        for x in a {
            res += x;
        }
        res
    } else if n <= 128 {
        let mut r = [a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7]];
        let mut i = 8;
        while i < n - (n % 8) {
            for j in 0..8 {
                r[j] += a[i + j];
            }
            i += 8;
        }
        let mut res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
        while i < n {
            res += a[i];
            i += 1;
        }
        res
    } else {
        let mut n2 = n / 2;
        n2 -= n2 % 8;
        pairwise(&a[..n2]) + pairwise(&a[n2..])
    }
}

/// Python's sum() of floats since 3.12: Neumaier's compensated sum.
struct Neumaier {
    f: f64,
    c: f64,
}

impl Neumaier {
    fn add(&mut self, x: f64) {
        let t = self.f + x;
        if self.f.abs() >= x.abs() {
            self.c += (self.f - t) + x;
        } else {
            self.c += (x - t) + self.f;
        }
        self.f = t;
    }

    fn value(&self) -> f64 {
        if self.c != 0.0 && self.c.is_finite() {
            self.f + self.c
        } else {
            self.f
        }
    }
}

/// A C-contiguous array's elements, borrowed: numpy's own memory, read
/// in place.
fn cells<'a, T: pyo3::buffer::Element>(py: Python<'a>, buffer: &'a PyBuffer<T>, dims: usize)
    -> PyResult<&'a [ReadOnlyCell<T>]> {
    if buffer.dimensions() != dims {
        return Err(PyValueError::new_err(format!("an array of {dims} dimensions")));
    }
    buffer.as_slice(py).ok_or_else(|| PyValueError::new_err("an array in C order"))
}

struct Costs<'a> {
    cols: usize,
    closed: &'a [ReadOnlyCell<i64>],
    marginal: &'a [ReadOnlyCell<i64>],
    dear: &'a [ReadOnlyCell<f64>],
    offshore: &'a [ReadOnlyCell<f64>],
    gs: &'a [ReadOnlyCell<f64>],
    ends: &'a HashSet<(i64, i64)>,
}

impl Costs<'_> {
    fn at(&self, c: (i64, i64)) -> usize {
        c.0 as usize * self.cols + c.1 as usize
    }

    fn is_open(&self, c: (i64, i64)) -> bool {
        self.closed[self.at(c)].get() < 0 || self.ends.contains(&c)
    }

    fn is_marginal(&self, c: (i64, i64)) -> bool {
        self.marginal[self.at(c)].get() >= 0
    }

    /// _line_minutes: the way nearest the line's bearing (Python's round,
    /// half to even), each cell's rate averaged as np.mean does.
    fn minutes(&self, cells: &[(i64, i64)], a: (f64, f64), b: (f64, f64), nm: f64, marginal_cost: f64,
               water_cost: f64) -> f64 {
        if nm == 0.0 {
            return 0.0;
        }
        let bearing = ((b.1 - a.1) * ((a.0 + b.0) / 2.0).to_radians().cos()).atan2(b.0 - a.0);
        let dr = bearing.cos().round_ties_even() as i64;
        let dc = bearing.sin().round_ties_even() as i64;
        // _STEPS: rows -1, 0, 1 by columns -1, 0, 1, without (0, 0).
        let mut k = ((dr + 1) * 3 + (dc + 1)) as usize;
        if k > 4 {
            k -= 1;
        }
        let rates: Vec<f64> = cells
            .iter()
            .map(|&c| {
                let at = self.at(c);
                let m = if self.marginal[at].get() >= 0 { marginal_cost } else { 0.0 };
                (1.0 + self.dear[at].get() + m + water_cost * self.offshore[at].get()) / self.gs[at * 8 + k].get()
            })
            .collect();
        nm * (pairwise(&rates) / rates.len() as f64) * 60.0
    }
}

fn geom(lat0: f64, lon0: f64, cell: f64, rows: i64, cols: i64) -> PyResult<Geom> {
    if rows < 1 || cols < 1 || !(cell > 0.0) {
        return Err(PyValueError::new_err("an empty grid"));
    }
    Ok(Geom { lat0, lon0, cell, rows, cols })
}

#[pyfunction]
#[allow(clippy::too_many_arguments)]
fn line_cells(a: (f64, f64), b: (f64, f64), lat0: f64, lon0: f64, cell: f64, rows: i64, cols: i64)
    -> PyResult<Vec<(i64, i64)>> {
    Ok(cells_of(geom(lat0, lon0, cell, rows, cols)?, a, b))
}

#[pyfunction]
#[allow(clippy::too_many_arguments)]
fn line_minutes(py: Python<'_>, a: (f64, f64), b: (f64, f64), nm: f64, lat0: f64, lon0: f64, cell: f64,
                marginal: PyBuffer<i64>, dear: PyBuffer<f64>, offshore: PyBuffer<f64>, gs: PyBuffer<f64>,
                marginal_cost: f64, water_cost: f64) -> PyResult<f64> {
    let (rows, cols) = (marginal.shape()[0], marginal.shape()[1]);
    let g = geom(lat0, lon0, cell, rows as i64, cols as i64)?;
    let ends = HashSet::new();
    let costs = grid_costs(py, cols, rows, &marginal, &marginal, &dear, &offshore, &gs, &ends)?;
    Ok(costs.minutes(&cells_of(g, a, b), a, b, nm, marginal_cost, water_cost))
}

/// The grid's arrays, each the grid's size (gs eight ways a cell).
#[allow(clippy::too_many_arguments)]
fn grid_costs<'a>(py: Python<'a>, cols: usize, rows: usize, closed: &'a PyBuffer<i64>, marginal: &'a PyBuffer<i64>,
                  dear: &'a PyBuffer<f64>, offshore: &'a PyBuffer<f64>, gs: &'a PyBuffer<f64>,
                  ends: &'a HashSet<(i64, i64)>) -> PyResult<Costs<'a>> {
    let n = rows * cols;
    let costs = Costs { cols, closed: cells(py, closed, 2)?, marginal: cells(py, marginal, 2)?, dear: cells(py, dear, 2)?,
                        offshore: cells(py, offshore, 2)?, gs: cells(py, gs, 3)?, ends };
    if [costs.closed.len(), costs.marginal.len(), costs.dear.len(), costs.offshore.len()].iter().any(|&l| l != n)
        || costs.gs.len() != n * 8 || gs.shape()[2] != 8 {
        return Err(PyValueError::new_err("the grid's arrays, each its size, groundspeeds eight ways"));
    }
    Ok(costs)
}

/// _straightened's turns, as indices into the points: from each turn the
/// farthest point on whose straight line crosses no more closed cells than
/// the way did, is no more than `slower_min` slower, and (with a marginal
/// cost) crosses no more marginal cells. `nm_from(i)` is the distance from
/// point i to every point, vfr.geo's, so the miles are PROJ's own.
#[pyfunction]
#[allow(clippy::too_many_arguments)]
fn straightened(py: Python<'_>, points: Vec<(f64, f64)>, lat0: f64, lon0: f64, cell: f64, closed: PyBuffer<i64>,
                marginal: PyBuffer<i64>, dear: PyBuffer<f64>, offshore: PyBuffer<f64>, gs: PyBuffer<f64>,
                ends: Vec<(i64, i64)>, leg_nm: PyBuffer<f64>, nm_from: &Bound<'_, PyAny>, marginal_cost: f64,
                slower_min: f64, water_cost: f64) -> PyResult<Vec<usize>> {
    if closed.dimensions() != 2 {
        return Err(PyValueError::new_err("the grid's closed cells, rows by columns"));
    }
    let (rows, cols) = (closed.shape()[0], closed.shape()[1]);
    let g = geom(lat0, lon0, cell, rows as i64, cols as i64)?;
    let ends: HashSet<(i64, i64)> = ends.into_iter().collect();
    let costs = grid_costs(py, cols, rows, &closed, &marginal, &dear, &offshore, &gs, &ends)?;
    let leg_nm = leg_nm.to_vec(py)?;
    let n = points.len();
    if leg_nm.len() + 1 != n {
        return Err(PyValueError::new_err("a leg's miles for each pair of points"));
    }
    let mut legs = Vec::with_capacity(n.saturating_sub(1));
    let mut leg_closed: Vec<Vec<(i64, i64)>> = Vec::with_capacity(n.saturating_sub(1));
    let mut leg_marginal = Vec::with_capacity(n.saturating_sub(1));
    for k in 0..n.saturating_sub(1) {
        let cells = cells_of(g, points[k], points[k + 1]);
        legs.push(costs.minutes(&cells, points[k], points[k + 1], leg_nm[k], marginal_cost, water_cost));
        leg_closed.push(cells.iter().copied().filter(|&c| !costs.is_open(c)).collect());
        leg_marginal.push(cells.iter().filter(|&&c| costs.is_marginal(c)).count());
    }
    let mut out = vec![0usize];
    let mut i = 0usize;
    while i + 1 < n {
        // The way's own from i to each j: its closed cells as a set (a turn's
        // cell is on both its legs), its minutes as Python's sum() adds them,
        // and its marginal cells.
        let mut crossed: Vec<usize> = vec![0; n];
        let mut spent: Vec<f64> = vec![0.0; n];
        let mut marginals: Vec<usize> = vec![0; n];
        let mut seen: HashSet<(i64, i64)> = HashSet::new();
        let mut sum = Neumaier { f: 0.0, c: 0.0 };
        let mut count = 0usize;
        for j in i + 1..n {
            seen.extend(leg_closed[j - 1].iter().copied());
            sum.add(legs[j - 1]);
            count += leg_marginal[j - 1];
            crossed[j] = seen.len();
            spent[j] = sum.value();
            marginals[j] = count;
        }
        let mut row: Option<Vec<f64>> = None;
        let mut j = n - 1;
        while j > i + 1 {
            let cells = cells_of(g, points[i], points[j]);
            let shut = cells.iter().filter(|&&c| !costs.is_open(c)).count();
            if shut <= crossed[j] {
                if row.is_none() {
                    let nm = PyBuffer::<f64>::get(&nm_from.call1((i,))?)?;
                    row = Some(nm.to_vec(py)?);
                }
                let nm = row.as_ref().unwrap()[j];
                if costs.minutes(&cells, points[i], points[j], nm, marginal_cost, water_cost) <= spent[j] + slower_min
                    && (marginal_cost == 0.0 || cells.iter().filter(|&&c| costs.is_marginal(c)).count() <= marginals[j])
                {
                    break;
                }
            }
            j -= 1;
        }
        out.push(j);
        i = j;
    }
    Ok(out)
}

/// Whether a shapefile Polygon record's content (shape type, box, parts,
/// points, little-endian) holds the point: inside more of its outer rings
/// (clockwise, as the format draws them) than of its holes, or inside a
/// hole that no outer ring holds, which pyshp makes an outer ring of its
/// own. A crossing count per ring.
fn holds_point(content: &[u8], x: f64, y: f64) -> Option<bool> {
    let i32_at = |o: usize| content.get(o..o + 4).map(|b| i32::from_le_bytes(b.try_into().unwrap()));
    let f64_at = |o: usize| content.get(o..o + 8).map(|b| f64::from_le_bytes(b.try_into().unwrap()));
    let kind = i32_at(0)?;
    if kind == 0 {
        return Some(false);
    }
    let parts = i32_at(36)? as usize;
    let count = i32_at(40)? as usize;
    let points_at = 44 + 4 * parts;
    if content.len() < points_at + 16 * count {
        return None;
    }
    let mut starts: Vec<usize> = (0..parts).map(|p| i32_at(44 + 4 * p).unwrap() as usize).collect();
    starts.push(count);
    let (mut outer, mut holes) = (0usize, 0usize);
    for p in 0..parts {
        let (s, e) = (starts[p], starts[p + 1]);
        if s >= e || e > count {
            continue;
        }
        let pt = |k: usize| (f64_at(points_at + 16 * k).unwrap(), f64_at(points_at + 16 * k + 8).unwrap());
        let mut inside = false;
        let mut area = 0.0;
        let mut prev = pt(e - 1);
        for k in s..e {
            let cur = pt(k);
            if (cur.1 > y) != (prev.1 > y) && x < (prev.0 - cur.0) * (y - cur.1) / (prev.1 - cur.1) + cur.0 {
                inside = !inside;
            }
            area += prev.0 * cur.1 - cur.0 * prev.1;
            prev = cur;
        }
        if inside {
            if area < 0.0 {
                outer += 1;
            } else {
                holes += 1;
            }
        }
    }
    Some(outer > holes || (outer == 0 && holes > 0))
}

#[pyfunction]
fn shape_holds(content: &[u8], lon: f64, lat: f64) -> PyResult<bool> {
    holds_point(content, lon, lat).ok_or_else(|| PyValueError::new_err("a shapefile record cut short"))
}

#[pymodule]
fn vfr_native(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(line_cells, m)?)?;
    m.add_function(wrap_pyfunction!(line_minutes, m)?)?;
    m.add_function(wrap_pyfunction!(straightened, m)?)?;
    m.add_function(wrap_pyfunction!(shape_holds, m)?)?;
    Ok(())
}
