//! Whether an airspace volume's outline holds a point, read straight from
//! its bytes: a shapefile Polygon record, as the FAA's NASR Class Airspace
//! shapefile has it, or the same rings as WKB, as the cycle pack keeps
//! them (crate::pack). Both give the same answer at every point, as pyshp
//! and shapely gave it, which tests/test_native.py holds them to.

fn i32_at(b: &[u8], o: usize) -> Option<i32> {
    b.get(o..o + 4).map(|s| i32::from_le_bytes(s.try_into().unwrap()))
}

fn u32_at(b: &[u8], o: usize) -> Option<u32> {
    b.get(o..o + 4).map(|s| u32::from_le_bytes(s.try_into().unwrap()))
}

fn f64_at(b: &[u8], o: usize) -> Option<f64> {
    b.get(o..o + 8).map(|s| f64::from_le_bytes(s.try_into().unwrap()))
}

/// The rule over all of a shape's rings: inside more of its outer rings
/// (clockwise, as the shapefile format draws them) than of its holes, or
/// inside a hole that no outer ring holds, which pyshp makes an outer ring
/// of its own. Each ring given as its points' bytes (x, y little-endian
/// doubles, one after the other).
struct Rings {
    outer: usize,
    holes: usize,
}

impl Rings {
    fn new() -> Rings {
        Rings { outer: 0, holes: 0 }
    }

    /// A crossing count, and the ring's direction by its signed area.
    fn add(&mut self, points: &[u8], x: f64, y: f64) {
        let count = points.len() / 16;
        if count == 0 {
            return;
        }
        let pt = |k: usize| (f64_at(points, 16 * k).unwrap(), f64_at(points, 16 * k + 8).unwrap());
        let mut inside = false;
        let mut area = 0.0;
        let mut prev = pt(count - 1);
        for k in 0..count {
            let cur = pt(k);
            if (cur.1 > y) != (prev.1 > y) && x < (prev.0 - cur.0) * (y - cur.1) / (prev.1 - cur.1) + cur.0 {
                inside = !inside;
            }
            area += prev.0 * cur.1 - cur.0 * prev.1;
            prev = cur;
        }
        if inside {
            if area < 0.0 {
                self.outer += 1;
            } else {
                self.holes += 1;
            }
        }
    }

    fn holds(&self) -> bool {
        self.outer > self.holes || (self.outer == 0 && self.holes > 0)
    }
}

/// Whether a shapefile Polygon record's content (shape type, box, parts,
/// points, little-endian: ESRI's shapefile technical description, 1998)
/// holds the point. None where the record is cut short.
pub fn shape_holds(content: &[u8], x: f64, y: f64) -> Option<bool> {
    let kind = i32_at(content, 0)?;
    if kind == 0 {
        return Some(false);
    }
    let parts = i32_at(content, 36)? as usize;
    let count = i32_at(content, 40)? as usize;
    let points_at = 44 + 4 * parts;
    if content.len() < points_at + 16 * count {
        return None;
    }
    let mut starts: Vec<usize> = (0..parts).map(|p| i32_at(content, 44 + 4 * p).unwrap() as usize).collect();
    starts.push(count);
    let mut rings = Rings::new();
    for p in 0..parts {
        let (s, e) = (starts[p], starts[p + 1]);
        if s >= e || e > count {
            continue;
        }
        rings.add(&content[points_at + 16 * s..points_at + 16 * e], x, y);
    }
    Some(rings.holds())
}

/// The record's rings as one little-endian WKB Polygon, in the record's
/// order and direction (so not always OGC's outer-first): what the cycle
/// pack keeps. A part the record draws empty or past its points is an
/// empty ring, which holds nothing, as it is skipped above. None where
/// the record is cut short.
pub fn shape_to_wkb(content: &[u8]) -> Option<Vec<u8>> {
    let kind = i32_at(content, 0)?;
    let mut out = vec![1u8];
    out.extend_from_slice(&3u32.to_le_bytes());
    if kind == 0 {
        out.extend_from_slice(&0u32.to_le_bytes());
        return Some(out);
    }
    let parts = i32_at(content, 36)? as usize;
    let count = i32_at(content, 40)? as usize;
    let points_at = 44 + 4 * parts;
    if content.len() < points_at + 16 * count {
        return None;
    }
    let mut starts: Vec<usize> = (0..parts).map(|p| i32_at(content, 44 + 4 * p).unwrap() as usize).collect();
    starts.push(count);
    out.extend_from_slice(&(parts as u32).to_le_bytes());
    for p in 0..parts {
        let (s, e) = (starts[p], starts[p + 1]);
        if s >= e || e > count {
            out.extend_from_slice(&0u32.to_le_bytes());
            continue;
        }
        out.extend_from_slice(&((e - s) as u32).to_le_bytes());
        out.extend_from_slice(&content[points_at + 16 * s..points_at + 16 * e]);
    }
    Some(out)
}

/// Whether a little-endian 2D WKB Polygon (type 3) or MultiPolygon (6),
/// its rings taken as a shapefile's (see Rings), holds the point. None
/// where it is anything else or cut short.
pub fn wkb_holds(wkb: &[u8], x: f64, y: f64) -> Option<bool> {
    let mut rings = Rings::new();
    let mut at = 0usize;
    fn polygon(wkb: &[u8], at: &mut usize, rings: &mut Rings, x: f64, y: f64) -> Option<()> {
        if *wkb.get(*at)? != 1 || u32_at(wkb, *at + 1)? != 3 {
            return None;
        }
        let n = u32_at(wkb, *at + 5)? as usize;
        *at += 9;
        for _ in 0..n {
            let m = u32_at(wkb, *at)? as usize;
            let points = wkb.get(*at + 4..*at + 4 + 16 * m)?;
            rings.add(points, x, y);
            *at += 4 + 16 * m;
        }
        Some(())
    }
    if *wkb.first()? != 1 {
        return None;
    }
    match u32_at(wkb, 1)? {
        3 => polygon(wkb, &mut at, &mut rings, x, y)?,
        6 => {
            let n = u32_at(wkb, 5)? as usize;
            at = 9;
            for _ in 0..n {
                polygon(wkb, &mut at, &mut rings, x, y)?;
            }
        }
        _ => return None,
    }
    Some(rings.holds())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A shapefile Polygon record: a clockwise square with a
    /// counter-clockwise hole in it.
    fn square_with_hole() -> Vec<u8> {
        let outer = [(0.0, 0.0), (0.0, 10.0), (10.0, 10.0), (10.0, 0.0), (0.0, 0.0)];
        let hole = [(4.0, 4.0), (6.0, 4.0), (6.0, 6.0), (4.0, 6.0), (4.0, 4.0)];
        let mut b = Vec::new();
        b.extend_from_slice(&5i32.to_le_bytes());
        for v in [0.0f64, 0.0, 10.0, 10.0] {
            b.extend_from_slice(&v.to_le_bytes());
        }
        b.extend_from_slice(&2i32.to_le_bytes());
        b.extend_from_slice(&10i32.to_le_bytes());
        b.extend_from_slice(&0i32.to_le_bytes());
        b.extend_from_slice(&5i32.to_le_bytes());
        for (x, y) in outer.iter().chain(hole.iter()) {
            b.extend_from_slice(&f64::to_le_bytes(*x));
            b.extend_from_slice(&f64::to_le_bytes(*y));
        }
        b
    }

    #[test]
    fn a_hole_is_not_held_and_the_wkb_agrees() {
        let shape = square_with_hole();
        let wkb = shape_to_wkb(&shape).unwrap();
        for (x, y, held) in [(1.0, 1.0, true), (5.0, 5.0, false), (11.0, 5.0, false), (9.9, 9.9, true)] {
            assert_eq!(shape_holds(&shape, x, y), Some(held));
            assert_eq!(wkb_holds(&wkb, x, y), Some(held));
        }
        assert_eq!(shape_holds(&shape[..50], 1.0, 1.0), None);
        assert_eq!(wkb_holds(&wkb[..30], 1.0, 1.0), None);
    }
}
