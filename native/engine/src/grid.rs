//! Route options' straight lines over the grid (wingtip.route_options): the
//! cells a line crosses, its minutes, and the loop that straightens a way
//! through cell centres into the fewest turns. Each gives exactly what the
//! Python it stood in for gave -- the same samples, the same sums in the
//! same order -- as the shared fixtures (tests/fixtures/native) hold it to.

use crate::sums::{pairwise, Neumaier};
use std::collections::HashSet;

/// A grid's array, read an element at a time: a Vec here, numpy's own
/// memory in the planner, whatever the phone holds later.
pub trait Values<T: Copy> {
    fn at(&self, i: usize) -> T;
    fn count(&self) -> usize;
}

impl<T: Copy> Values<T> for Vec<T> {
    fn at(&self, i: usize) -> T {
        self[i]
    }

    fn count(&self) -> usize {
        self.len()
    }
}

pub type Cell = (i64, i64);
/// (latitude, longitude) in degrees.
pub type Point = (f64, f64);

/// Where the grid is: its corner, its cell's size in degrees, its size.
#[derive(Clone, Copy, Debug)]
pub struct Geom {
    pub lat0: f64,
    pub lon0: f64,
    pub cell: f64,
    pub rows: i64,
    pub cols: i64,
}

impl Geom {
    pub fn new(lat0: f64, lon0: f64, cell: f64, rows: i64, cols: i64) -> Option<Geom> {
        (rows >= 1 && cols >= 1 && cell > 0.0).then_some(Geom { lat0, lon0, cell, rows, cols })
    }
}

/// _Grid.line_cells: the line sampled a third of a cell apart with
/// numpy's linspace (i * (1 / (n - 1)), the last exactly 1), each sample's
/// cell truncated and clipped as astype(int) and np.clip do, a cell kept
/// where it differs from the one before.
pub fn line_cells(g: Geom, a: Point, b: Point) -> Vec<Cell> {
    let span = (b.0 - a.0).abs().max((b.1 - a.1).abs());
    let steps = std::cmp::max(2, (span / (g.cell / 3.0)) as i64 + 1);
    let step = 1.0 / (steps - 1) as f64;
    let (d_lat, d_lon) = (b.0 - a.0, b.1 - a.1);
    let mut out: Vec<Cell> = Vec::with_capacity(steps as usize);
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

/// The grid's costs: closed and marginal cells (negative where not), the
/// extra cost of dear and offshore cells, and the groundspeed eight ways
/// out of each cell; each the grid's size, rows by columns.
pub struct Costs<'a> {
    cols: usize,
    closed: &'a dyn Values<i64>,
    marginal: &'a dyn Values<i64>,
    dear: &'a dyn Values<f64>,
    offshore: &'a dyn Values<f64>,
    gs: &'a dyn Values<f64>,
    ends: &'a HashSet<Cell>,
}

impl<'a> Costs<'a> {
    #[allow(clippy::too_many_arguments)]
    pub fn new(rows: usize, cols: usize, closed: &'a dyn Values<i64>, marginal: &'a dyn Values<i64>,
               dear: &'a dyn Values<f64>, offshore: &'a dyn Values<f64>, gs: &'a dyn Values<f64>,
               ends: &'a HashSet<Cell>) -> Result<Costs<'a>, &'static str> {
        let n = rows * cols;
        if [closed.count(), marginal.count(), dear.count(), offshore.count()].iter().any(|&l| l != n)
            || gs.count() != n * 8 {
            return Err("the grid's arrays, each its size, groundspeeds eight ways");
        }
        Ok(Costs { cols, closed, marginal, dear, offshore, gs, ends })
    }

    fn at(&self, c: Cell) -> usize {
        c.0 as usize * self.cols + c.1 as usize
    }

    pub fn is_open(&self, c: Cell) -> bool {
        self.closed.at(self.at(c)) < 0 || self.ends.contains(&c)
    }

    pub fn is_marginal(&self, c: Cell) -> bool {
        self.marginal.at(self.at(c)) >= 0
    }

    /// _line_minutes: the way nearest the line's bearing (Python's round,
    /// half to even), each cell's rate averaged as np.mean does.
    pub fn minutes(&self, cells: &[Cell], a: Point, b: Point, nm: f64, marginal_cost: f64, water_cost: f64) -> f64 {
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
                let m = if self.marginal.at(at) >= 0 { marginal_cost } else { 0.0 };
                (1.0 + self.dear.at(at) + m + water_cost * self.offshore.at(at)) / self.gs.at(at * 8 + k)
            })
            .collect();
        nm * (pairwise(&rates) / rates.len() as f64) * 60.0
    }
}

/// What straightening a way asks for beyond the grid.
pub struct Straighten {
    pub marginal_cost: f64,
    pub slower_min: f64,
    pub water_cost: f64,
}

#[derive(Debug)]
pub enum StraightError<E> {
    /// A leg's miles were not given for each pair of points.
    Legs,
    /// The caller's distances failed.
    Distances(E),
}

/// _straightened's turns, as indices into the points: from each turn the
/// farthest point on whose straight line crosses no more closed cells than
/// the way did, is no more than `slower_min` slower, and (with a marginal
/// cost) crosses no more marginal cells. `nm_from(i)` is the distance from
/// point i to every point, asked for only where needed: the planner's are
/// PROJ's own, so the miles are the same wherever the engine runs.
pub fn straightened<E>(g: Geom, costs: &Costs, points: &[Point], leg_nm: &[f64],
                       mut nm_from: impl FnMut(usize) -> Result<Vec<f64>, E>, how: &Straighten)
    -> Result<Vec<usize>, StraightError<E>> {
    let n = points.len();
    if leg_nm.len() + 1 != n {
        return Err(StraightError::Legs);
    }
    let (mc, wc) = (how.marginal_cost, how.water_cost);
    let mut legs = Vec::with_capacity(n - 1);
    let mut leg_closed: Vec<Vec<Cell>> = Vec::with_capacity(n - 1);
    let mut leg_marginal = Vec::with_capacity(n - 1);
    for k in 0..n - 1 {
        let cells = line_cells(g, points[k], points[k + 1]);
        legs.push(costs.minutes(&cells, points[k], points[k + 1], leg_nm[k], mc, wc));
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
        let mut seen: HashSet<Cell> = HashSet::new();
        let mut sum = Neumaier::default();
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
            let cells = line_cells(g, points[i], points[j]);
            let shut = cells.iter().filter(|&&c| !costs.is_open(c)).count();
            if shut <= crossed[j] {
                if row.is_none() {
                    row = Some(nm_from(i).map_err(StraightError::Distances)?);
                }
                let nm = row.as_ref().unwrap()[j];
                if costs.minutes(&cells, points[i], points[j], nm, mc, wc) <= spent[j] + how.slower_min
                    && (mc == 0.0 || cells.iter().filter(|&&c| costs.is_marginal(c)).count() <= marginals[j])
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_line_along_a_row_crosses_each_cell_once() {
        let g = Geom::new(40.0, -100.0, 0.25, 4, 10).unwrap();
        let cells = line_cells(g, (40.125, -99.875), (40.125, -97.625));
        assert_eq!(cells, (0..10).map(|c| (0, c)).collect::<Vec<_>>());
    }

    #[test]
    fn a_line_off_the_grid_is_clipped_to_its_edge() {
        let g = Geom::new(40.0, -100.0, 0.25, 2, 2).unwrap();
        assert_eq!(line_cells(g, (39.0, -101.0), (39.0, -101.0)), vec![(0, 0)]);
        assert!(Geom::new(0.0, 0.0, 0.0, 1, 1).is_none());
    }
}
