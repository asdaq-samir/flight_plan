//! The map's view from the phone's packs, with no network: the Class B, C
//! and D, the landing fields and the VORs inside a box, each as the
//! planner's endpoint answers it -- /api/airspace/in-view (AirspaceInView,
//! vfr.airspace_map), /api/airports/in-view (AirportPin, vfr.airports) and
//! /api/navaids/in-view (VorPin, vfr.fixes) -- as JSON with the same field
//! names and the same nulls, so the native app decodes it as it decodes
//! the planner's and draws the chart's overlays from the packs it keeps.
//!
//! What a phone pack (vfr.pack's `write_phone`) holds of each, and what it
//! cannot, which is answered null:
//!
//! - The airspace layer's rings (crate::pack, simplified to the phone's
//!   tolerance) with `airspace.vol` (crate::phone) and `airspace.attr`, one
//!   JSON object a volume: its primary field's `ident`, its `number` among
//!   the nation's Class B, C and D (the planner's `id` is "ORD-67"), whether
//!   its top is excluded (`ceiling_excluded`) and when it is in effect
//!   (`hours_code`, `hours_remark`). A pack written before the attr has
//!   those null, its `id` the class and the name, and no field is the
//!   primary of anything.
//! - The `airports` table (NASR's APT_BASE rows): the fields with a
//!   SITE_TYPE_CODE of A in service, by their ICAO ident where they have
//!   one, else the FAA's. The planner lists OurAirports' fields and names
//!   them as OurAirports does; here the name is NASR's, set in title case.
//!   `kind` is the SIZE column, OurAirports' size written into the pack
//!   (vfr.pack.airport_sizes); a pack without it has every field "other".
//!   `military` is OWNERSHIP_TYPE_CODE's, null from a pack without that
//!   column. `flight_category` is a live METAR's and always null here.
//!   `airspace_class` is read off the pack's own airspace, as
//!   vfr.airspace.surface_classes reads it off the file: the lowest class
//!   whose floor is the surface over the field, else E where a Class E
//!   reaches the surface there, else G. The planner lists the fields that
//!   report their weather first; with no weather here, the biggest first
//!   and then by ident, at most AIRPORT_LIMIT as the planner's default.
//! - The `navaids` table (NAV_BASE rows): the VORs, VOR/DMEs and VORTACs
//!   not shut down, by ident, as vfr.fixes keeps them. `service_volume`
//!   and `hours` are ALT_CODE and OPER_HOURS, null from a pack without
//!   those columns. `remarks` is NAV_RMK's, which no pack holds: always
//!   empty. `fixes` is what the planner answers unasked: empty.
//!
//! A volume's lines are drawn as vfr.airspace_map draws them: every ring
//! oriented with the volume on its left in lon/lat (its outside
//! counter-clockwise, its holes clockwise), then simplified under a pixel
//! for the box asked (`tolerance_for`) and written [lat, lon] to five
//! places, whole rather than clipped. The pack's rings are already
//! simplified to PHONE_TOLERANCE_DEG, so close in a line may have fewer
//! points than the planner's, within that of it. The label's point is the
//! widest horizontal section's middle on the shell's safe bisector, as
//! GEOS's InteriorPointArea (shapely's representative_point) finds it;
//! on the simplified ring it can differ from the planner's by a little.

use crate::json::{self, Value};
use crate::pack::Pack;

/// The planner's defaults: at most this many fields, and this many VORs.
pub const AIRPORT_LIMIT: usize = 300;
pub const NAVAID_LIMIT: usize = 500;

/// vfr.airspace_map's: the finest a line is simplified to, and a box's
/// share of its height, in degrees.
pub const MIN_TOLERANCE_DEG: f64 = 0.00005;
pub const TOLERANCE_PER_BOX: f64 = 1.0 / 12000.0;

/// How far a line may be moved in simplifying it for a box this tall.
pub fn tolerance_for(south: f64, north: f64) -> f64 {
    MIN_TOLERANCE_DEG.max((north - south) * TOLERANCE_PER_BOX)
}

/// vfr.faa_data's MILITARY_OWNERS: the Air Force's, the Navy's, the
/// Army's and the Coast Guard's fields.
const MILITARY_OWNERS: &[&str] = &["MA", "MN", "MR", "CG"];
/// vfr.fixes' VOR_KINDS and NAVAID_KINDS, the likelier to fly to first.
const VOR_KINDS: &[&str] = &["VORTAC", "VOR/DME", "VOR"];
const NAVAID_KINDS: &[&str] = &["VORTAC", "VOR/DME", "VOR", "DME", "TACAN", "NDB/DME", "NDB"];
/// vfr.fixes' SAME_FACILITY_NM: two navaids by one ident this close are
/// one facility filed twice.
const SAME_FACILITY_NM: f64 = 1.0;

/// A point as (lon, lat), the shapes' own order.
type Pt = (f64, f64);

/// (west, south, east, north): min lon, min lat, max lon, max lat, as a
/// layer's boxes are.
type Bbox = [f64; 4];

fn u32_at(b: &[u8], o: usize) -> Option<u32> {
    b.get(o..o + 4).map(|s| u32::from_le_bytes(s.try_into().unwrap()))
}

fn f64_at(b: &[u8], o: usize) -> Option<f64> {
    b.get(o..o + 8).map(|s| f64::from_le_bytes(s.try_into().unwrap()))
}

fn text_at<'a>(names: &'a [u8], record: &[u8], at: usize) -> Option<&'a str> {
    let (o, l) = (u32_at(record, at)? as usize, u32_at(record, at + 4)? as usize);
    std::str::from_utf8(names.get(o..o + l)?).ok()
}

fn meets(b: Bbox, view: Bbox) -> bool {
    !(b[2] < view[0] || b[0] > view[2] || b[3] < view[1] || b[1] > view[3])
}

fn in_box(p: Pt, view: Bbox) -> bool {
    p.0 >= view[0] && p.0 <= view[2] && p.1 >= view[1] && p.1 <= view[3]
}

/// Python's round(v, 5), near enough: a tie at the sixth place is the
/// only difference, and no coordinate lands on one.
fn round5(v: f64) -> f64 {
    (v * 1e5).round() / 1e5
}

// --- Rings --------------------------------------------------------------------

/// A little-endian 2D WKB Polygon or MultiPolygon as its polygons' rings'
/// points; None where it is anything else or cut short.
fn rings_of(wkb: &[u8]) -> Option<Vec<Vec<Vec<Pt>>>> {
    fn polygon(wkb: &[u8], at: &mut usize) -> Option<Vec<Vec<Pt>>> {
        if *wkb.get(*at)? != 1 || u32_at(wkb, *at + 1)? != 3 {
            return None;
        }
        let n = u32_at(wkb, *at + 5)? as usize;
        *at += 9;
        let mut rings = Vec::with_capacity(n);
        for _ in 0..n {
            let m = u32_at(wkb, *at)? as usize;
            let points = wkb.get(*at + 4..*at + 4 + 16 * m)?;
            rings.push((0..m).map(|k| (f64_at(points, 16 * k).unwrap(), f64_at(points, 16 * k + 8).unwrap())).collect());
            *at += 4 + 16 * m;
        }
        Some(rings)
    }
    if *wkb.first()? != 1 {
        return None;
    }
    let mut at = 0;
    match u32_at(wkb, 1)? {
        3 => Some(vec![polygon(wkb, &mut at)?]),
        6 => {
            let n = u32_at(wkb, 5)? as usize;
            at = 9;
            (0..n).map(|_| polygon(wkb, &mut at)).collect()
        }
        _ => None,
    }
}

/// Twice the signed area: positive counter-clockwise in lon/lat.
fn signed_area(ring: &[Pt]) -> f64 {
    let mut area = 0.0;
    for k in 0..ring.len() {
        let (a, b) = (ring[k], ring[(k + 1) % ring.len()]);
        area += a.0 * b.1 - b.0 * a.1;
    }
    area
}

/// Whether the ring holds the point, by crossings.
fn ring_holds(ring: &[Pt], p: Pt) -> bool {
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

/// A polygon as the planner draws it: its shell and its holes.
struct Polygon {
    shell: Vec<Pt>,
    holes: Vec<Vec<Pt>>,
}

/// The pack's rings (a shapefile's: outer rings clockwise, holes
/// counter-clockwise, as pyshp reads them into polygons) as the planner's
/// polygons, each oriented as shapely's orient_polygons orients it: the
/// shell counter-clockwise, the holes clockwise, so every line runs with
/// the volume on its left. A hole no outer ring holds is a polygon of its
/// own, as pyshp makes it.
fn oriented(polygons: Vec<Vec<Vec<Pt>>>) -> Vec<Polygon> {
    let mut out = Vec::new();
    for rings in polygons {
        let rings: Vec<Vec<Pt>> = rings.into_iter().filter(|r| r.len() >= 4).collect();
        let mut shells: Vec<Polygon> = Vec::new();
        let mut orphans = Vec::new();
        let mut holes = Vec::new();
        for ring in rings {
            if signed_area(&ring) < 0.0 {
                shells.push(Polygon { shell: ring.into_iter().rev().collect(), holes: Vec::new() });
            } else {
                holes.push(ring);
            }
        }
        for hole in holes {
            match shells.iter_mut().find(|s| ring_holds(&s.shell, hole[0])) {
                Some(shell) => shell.holes.push(hole.into_iter().rev().collect()),
                None => orphans.push(Polygon { shell: hole, holes: Vec::new() }),
            }
        }
        out.extend(shells);
        out.extend(orphans);
    }
    out
}

/// Whether the segment meets the box (Liang and Barsky's clipping).
fn segment_meets(a: Pt, b: Pt, view: Bbox) -> bool {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let (mut t0, mut t1) = (0.0f64, 1.0f64);
    for (p, q) in [(-dx, a.0 - view[0]), (dx, view[2] - a.0), (-dy, a.1 - view[1]), (dy, view[3] - a.1)] {
        if p == 0.0 {
            if q < 0.0 {
                return false;
            }
        } else {
            let t = q / p;
            if p < 0.0 {
                t0 = t0.max(t);
            } else {
                t1 = t1.min(t);
            }
            if t0 > t1 {
                return false;
            }
        }
    }
    true
}

/// Whether the polygons reach into the box: a line of theirs crosses it,
/// or a corner of it is inside one -- shapely's intersects, for a box.
fn reaches(polygons: &[Polygon], view: Bbox) -> bool {
    let rings = polygons.iter().flat_map(|p| std::iter::once(&p.shell).chain(p.holes.iter()));
    for ring in rings {
        for k in 0..ring.len() {
            if segment_meets(ring[k], ring[(k + 1) % ring.len()], view) {
                return true;
            }
        }
    }
    let corners = [(view[0], view[1]), (view[0], view[3]), (view[2], view[1]), (view[2], view[3])];
    corners.iter().any(|&c| polygons.iter().any(|p| ring_holds(&p.shell, c) && !p.holes.iter().any(|h| ring_holds(h, c))))
}

/// A point's distance from a segment, as GEOS's Distance::pointToSegment.
fn to_segment(p: Pt, a: Pt, b: Pt) -> f64 {
    if a == b {
        return ((p.0 - a.0).powi(2) + (p.1 - a.1).powi(2)).sqrt();
    }
    let len2 = (b.0 - a.0).powi(2) + (b.1 - a.1).powi(2);
    let r = ((p.0 - a.0) * (b.0 - a.0) + (p.1 - a.1) * (b.1 - a.1)) / len2;
    if r <= 0.0 {
        return ((p.0 - a.0).powi(2) + (p.1 - a.1).powi(2)).sqrt();
    }
    if r >= 1.0 {
        return ((p.0 - b.0).powi(2) + (p.1 - b.1).powi(2)).sqrt();
    }
    let s = ((a.1 - p.1) * (b.0 - a.0) - (a.0 - p.0) * (b.1 - a.1)) / len2;
    s.abs() * len2.sqrt()
}

/// The line simplified by Douglas and Peucker's method, as GEOS's
/// DouglasPeuckerLineSimplifier (shapely's simplify without topology
/// kept): its ends stay, and between them every point further than the
/// tolerance from the line through the kept ones.
pub fn simplified(points: &[Pt], tolerance: f64) -> Vec<Pt> {
    fn section(points: &[Pt], i: usize, j: usize, tolerance: f64, keep: &mut Vec<bool>) {
        if i + 1 >= j {
            return;
        }
        let (mut far, mut at) = (0.0, i);
        for k in i + 1..j {
            let d = to_segment(points[k], points[i], points[j]);
            if d > far {
                far = d;
                at = k;
            }
        }
        if far > tolerance {
            keep[at] = true;
            section(points, i, at, tolerance, keep);
            section(points, at, j, tolerance, keep);
        }
    }
    if points.len() < 3 {
        return points.to_vec();
    }
    let mut keep = vec![false; points.len()];
    keep[0] = true;
    keep[points.len() - 1] = true;
    section(points, 0, points.len() - 1, tolerance, &mut keep);
    points.iter().zip(keep).filter(|(_, k)| *k).map(|(p, _)| *p).collect()
}

/// A point inside the polygons, as JTS's and GEOS's InteriorPointArea
/// (shapely's representative_point) finds one: the middle of the widest
/// horizontal section through each polygon on a bisector of it safe of
/// its vertices, the widest of them all.
fn representative(polygons: &[Polygon]) -> Option<Pt> {
    let mut best: Option<(f64, Pt)> = None;
    for polygon in polygons {
        let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
        for p in &polygon.shell {
            lo = lo.min(p.1);
            hi = hi.max(p.1);
        }
        // The bisector between the vertices nearest the middle (every
        // ring's, JTS's ScanLineYOrdinateFinder), so it crosses no vertex.
        let centre = (lo + hi) / 2.0;
        let (mut lo_y, mut hi_y) = (lo, hi);
        for p in std::iter::once(&polygon.shell).chain(polygon.holes.iter()).flatten() {
            if p.1 <= centre {
                lo_y = lo_y.max(p.1);
            } else {
                hi_y = hi_y.min(p.1);
            }
        }
        let y = (hi_y + lo_y) / 2.0;
        let mut xs = Vec::new();
        for ring in std::iter::once(&polygon.shell).chain(polygon.holes.iter()) {
            for k in 0..ring.len() {
                let (a, b) = (ring[k], ring[(k + 1) % ring.len()]);
                if (a.1 > y && b.1 > y) || (a.1 < y && b.1 < y) || a.1 == b.1 {
                    continue;
                }
                xs.push(a.0 + (b.0 - a.0) * (y - a.1) / (b.1 - a.1));
            }
        }
        xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
        for pair in xs.chunks_exact(2) {
            let width = pair[1] - pair[0];
            if best.is_none_or(|b| width > b.0) {
                best = Some((width, ((pair[0] + pair[1]) / 2.0, y)));
            }
        }
    }
    best.map(|b| b.1)
}

// --- Airspace -----------------------------------------------------------------

/// What `airspace.attr` says of a volume; every field None from a pack
/// without it.
#[derive(Default)]
struct Attr {
    ident: Option<String>,
    number: Option<usize>,
    ceiling_excluded: bool,
    hours_code: Option<String>,
    hours_remark: Option<String>,
}

fn attrs_of(pack: &Pack) -> Vec<Attr> {
    let Some(text) = pack.section("airspace.attr").and_then(|b| std::str::from_utf8(b).ok()) else { return Vec::new() };
    let Ok(Value::Array(items)) = json::parse(text) else { return Vec::new() };
    items
        .iter()
        .map(|v| Attr {
            ident: v.get("ident").and_then(Value::as_str).map(str::to_owned),
            number: v.get("number").and_then(Value::as_f64).map(|n| n as usize),
            ceiling_excluded: matches!(v.get("ceiling_excluded"), Some(Value::Bool(true))),
            hours_code: v.get("hours_code").and_then(Value::as_str).map(str::to_owned),
            hours_remark: v.get("hours_remark").and_then(Value::as_str).map(str::to_owned),
        })
        .collect()
}

struct Found {
    number: Option<usize>,
    id: String,
    ident: Option<String>,
    name: String,
    class: char,
    floor_ft: f64,
    ceiling_ft: Option<f64>,
    attr: Attr,
    label: Pt,
    lines: Vec<Vec<Pt>>,
}

/// The planner's AirspaceInView for the box, JSON: the Class B, C and D
/// of the packs reaching into it, in the national file's order where the
/// packs number them, each whole. A volume in two packs (a region's edge
/// runs through it) is answered once.
pub fn airspace_in_view(packs: &[Pack], south: f64, west: f64, north: f64, east: f64) -> String {
    let view: Bbox = [west, south, east, north];
    let tolerance = tolerance_for(south, north);
    let mut found: Vec<Found> = Vec::new();
    for p in packs {
        let (Some(layer), Some(vols), Some(names)) = (p.layer("airspace"), p.section("airspace.vol"), p.section("airspace.names")) else {
            continue;
        };
        let mut attrs = attrs_of(p);
        if attrs.len() != layer.count {
            attrs = Vec::new();
        }
        for i in 0..layer.count {
            let Some(r) = vols.get(32 * i..32 * i + 32) else { continue };
            let class = r[0] as char;
            if !"BCD".contains(class) || !meets(layer.bbox(i), view) {
                continue;
            }
            let (Some(wkb), Some(floor), Some(ceiling), Some(name)) = (layer.wkb(i), f64_at(r, 8), f64_at(r, 16), text_at(names, r, 24)) else {
                continue;
            };
            let Some(polygons) = rings_of(wkb).map(oriented) else { continue };
            if !reaches(&polygons, view) {
                continue;
            }
            let attr = if attrs.is_empty() { Attr::default() } else { std::mem::take(&mut attrs[i]) };
            let id = match (attr.number, &attr.ident) {
                (Some(n), Some(ident)) => format!("{ident}-{n}"),
                (Some(n), None) => format!("{class}-{n}"),
                // No number: the class and the name tell a volume apart
                // in a region, and the same from one box to the next.
                (None, _) => format!("{class}-{name}"),
            };
            if found.iter().any(|f| f.id == id) {
                continue;
            }
            let Some(label) = representative(&polygons) else { continue };
            let lines: Vec<Vec<Pt>> = polygons
                .iter()
                .flat_map(|p| std::iter::once(&p.shell).chain(p.holes.iter()))
                .map(|ring| {
                    // A ring closed, as a polygon's boundary is, before it is
                    // simplified, so its ends stay.
                    let mut closed = ring.clone();
                    closed.push(ring[0]);
                    simplified(&closed, tolerance).into_iter().map(|(x, y)| (round5(x), round5(y))).collect()
                })
                .filter(|line: &Vec<Pt>| line.len() >= 2)
                .collect();
            if lines.is_empty() {
                continue;
            }
            found.push(Found {
                number: attr.number,
                id,
                ident: attr.ident.clone(),
                name: name.to_owned(),
                class,
                // vfr.airspace's floor in feet MSL: the surface, or a
                // height MSL; anything else 0 (floor ref 1 is AGL).
                floor_ft: if r[1] == 2 { floor } else { 0.0 },
                ceiling_ft: (!ceiling.is_nan()).then_some(ceiling),
                attr,
                label,
                lines,
            });
        }
    }
    found.sort_by_key(|f| f.number.unwrap_or(usize::MAX));
    let mut out = String::from("{\"volumes\":[");
    for (k, f) in found.iter().enumerate() {
        if k > 0 {
            out.push(',');
        }
        out.push_str("{\"id\":");
        json::string(&mut out, &f.id);
        out.push_str(",\"ident\":");
        json::opt_string(&mut out, f.ident.as_deref());
        out.push_str(",\"name\":");
        json::string(&mut out, &f.name);
        out.push_str(&format!(",\"airspace_class\":\"{}\",\"floor_ft\":", f.class));
        json::number(&mut out, f.floor_ft);
        out.push_str(&format!(",\"floor_sfc\":{},\"ceiling_ft\":", f.floor_ft == 0.0));
        json::opt_number(&mut out, f.ceiling_ft);
        out.push_str(&format!(",\"ceiling_excluded\":{},\"hours_code\":", f.attr.ceiling_excluded));
        json::opt_string(&mut out, f.attr.hours_code.as_deref());
        out.push_str(",\"hours_remark\":");
        json::opt_string(&mut out, f.attr.hours_remark.as_deref());
        out.push_str(",\"label_lat\":");
        json::number(&mut out, round5(f.label.1));
        out.push_str(",\"label_lon\":");
        json::number(&mut out, round5(f.label.0));
        out.push_str(",\"lines\":[");
        for (l, line) in f.lines.iter().enumerate() {
            if l > 0 {
                out.push(',');
            }
            out.push('[');
            for (m, (x, y)) in line.iter().enumerate() {
                if m > 0 {
                    out.push(',');
                }
                out.push('[');
                json::number(&mut out, *y);
                out.push(',');
                json::number(&mut out, *x);
                out.push(']');
            }
            out.push(']');
        }
        out.push_str("]}");
    }
    out.push_str("]}");
    out
}

// --- Airports -----------------------------------------------------------------

struct Pin {
    ident: String,
    faa_id: String,
    name: String,
    lat: f64,
    lon: f64,
    kind: &'static str,
    military: Option<&'static str>,
    private: bool,
}

fn rank(kind: &str) -> usize {
    ["large", "medium", "small"].iter().position(|k| *k == kind).unwrap_or(3)
}

/// The class of airspace at the surface of the point, from the packs'
/// airspace, as vfr.airspace.surface_classes reads it off the file: the
/// lowest of the Class B, C and D whose floor is the surface there, else
/// E where a Class E reaches the surface (its E2 to E4 areas), else G.
fn surface_class(packs: &[Pack], lat: f64, lon: f64) -> char {
    let (mut best, mut in_e) = (None::<char>, false);
    for p in packs {
        let (Some(layer), Some(vols)) = (p.layer("airspace"), p.section("airspace.vol")) else { continue };
        for i in layer.holding(lon, lat).unwrap_or_default() {
            let Some(r) = vols.get(32 * i..32 * i + 32) else { continue };
            let reaching = r[1] == 0 || (r[1] == 2 && f64_at(r, 8).is_some_and(|f| f <= 0.0));
            if !reaching {
                continue;
            }
            match r[0] as char {
                c @ ('B' | 'C' | 'D') => best = Some(best.map_or(c, |b| b.min(c))),
                'E' => in_e = true,
                _ => {}
            }
        }
    }
    best.unwrap_or(if in_e { 'E' } else { 'G' })
}

/// Each Class B, C and D's primary field, by the ident the airspace file
/// names it by, to the highest class it is the primary of (the planner's
/// `_primaries`); none from packs without `airspace.attr`.
fn primaries(packs: &[Pack]) -> Vec<(String, char)> {
    let mut found: Vec<(String, char)> = Vec::new();
    for p in packs {
        let Some(vols) = p.section("airspace.vol") else { continue };
        for (i, attr) in attrs_of(p).into_iter().enumerate() {
            let (Some(ident), Some(r)) = (attr.ident, vols.get(32 * i..32 * i + 32)) else { continue };
            let class = r[0] as char;
            if !"BCD".contains(class) {
                continue;
            }
            match found.iter_mut().find(|f| f.0 == ident) {
                Some(f) => f.1 = f.1.min(class),
                None => found.push((ident, class)),
            }
        }
    }
    found
}

/// The planner's AirportsInView for the box, JSON: the landing fields of
/// the packs' tables inside it, the biggest first, at most AIRPORT_LIMIT.
pub fn airports_in_view(packs: &[Pack], south: f64, west: f64, north: f64, east: f64) -> String {
    let view: Bbox = [west, south, east, north];
    let mut pins: Vec<Pin> = Vec::new();
    for p in packs {
        let Some(t) = p.section("airports").and_then(|b| std::str::from_utf8(b).ok()).and_then(json::table) else { continue };
        let (id, icao, site, name, lat, lon, status, size, owner, use_) = (
            t.col("ARPT_ID"),
            t.col("ICAO_ID"),
            t.col("SITE_TYPE_CODE"),
            t.col("ARPT_NAME"),
            t.col("LAT_DECIMAL"),
            t.col("LONG_DECIMAL"),
            t.col("ARPT_STATUS"),
            t.col("SIZE"),
            t.col("OWNERSHIP_TYPE_CODE"),
            t.col("FACILITY_USE_CODE"),
        );
        for r in &t.rows {
            let get = |c: Option<usize>| c.and_then(|c| r.get(c)).map(|s| s.trim()).unwrap_or("");
            if get(site) != "A" || get(status) != "O" {
                continue;
            }
            let (Ok(la), Ok(lo)) = (get(lat).parse::<f64>(), get(lon).parse::<f64>()) else { continue };
            if !in_box((lo, la), view) {
                continue;
            }
            // OurAirports' size, where the pack has it; a field it lists
            // no landing field for is not one the planner lists either.
            let kind = match size.map(|_| get(size)) {
                None => "other",
                Some("large") => "large",
                Some("medium") => "medium",
                Some("small") => "small",
                Some(_) => continue,
            };
            let ident = if get(icao).is_empty() { get(id) } else { get(icao) };
            if pins.iter().any(|p| p.ident == ident) {
                continue;
            }
            let military = (owner.is_some() && MILITARY_OWNERS.contains(&get(owner)))
                .then(|| if get(use_) == "PU" { "joint" } else { "military" });
            pins.push(Pin {
                ident: ident.to_owned(),
                faa_id: get(id).to_uppercase(),
                name: crate::spoken::title(get(name)),
                lat: la,
                lon: lo,
                kind,
                military,
                private: get(use_) == "PR" && military.is_none(),
            });
        }
    }
    pins.sort_by(|a, b| rank(a.kind).cmp(&rank(b.kind)).then_with(|| a.ident.cmp(&b.ident)));
    pins.truncate(AIRPORT_LIMIT);
    let primary = primaries(packs);
    let mut out = String::from("{\"airports\":[");
    for (k, p) in pins.iter().enumerate() {
        if k > 0 {
            out.push(',');
        }
        out.push_str("{\"ident\":");
        json::string(&mut out, &p.ident);
        out.push_str(",\"name\":");
        json::string(&mut out, &p.name);
        out.push_str(",\"lat\":");
        json::number(&mut out, p.lat);
        out.push_str(",\"lon\":");
        json::number(&mut out, p.lon);
        out.push_str(&format!(",\"kind\":\"{}\",\"flight_category\":null,\"military\":", p.kind));
        json::opt_string(&mut out, p.military);
        out.push_str(&format!(",\"private\":{},\"airspace_class\":\"{}\",\"primary_of\":", p.private, surface_class(packs, p.lat, p.lon)));
        match primary.iter().find(|f| f.0 == p.faa_id) {
            Some((_, c)) => out.push_str(&format!("\"{c}\"")),
            None => out.push_str("null"),
        }
        out.push('}');
    }
    out.push_str("]}");
    out
}

// --- Navaids ------------------------------------------------------------------

struct Vor {
    ident: String,
    name: Option<String>,
    kind: &'static str,
    freq: Option<String>,
    lat: f64,
    lon: f64,
    mag_var: Option<f64>,
    elevation_ft: Option<f64>,
    channel: Option<String>,
    service_volume: Option<Option<String>>,
    hours: Option<Option<String>>,
    restricted: bool,
}

fn some_text(s: &str) -> Option<String> {
    (!s.is_empty()).then(|| s.to_owned())
}

/// The planner's NavaidsInView for the box, JSON: the VORs of the packs'
/// tables inside it by ident, at most NAVAID_LIMIT, and no fixes.
pub fn navaids_in_view(packs: &[Pack], south: f64, west: f64, north: f64, east: f64) -> String {
    let view: Bbox = [west, south, east, north];
    let mut vors: Vec<Vor> = Vec::new();
    for p in packs {
        let Some(t) = p.section("navaids").and_then(|b| std::str::from_utf8(b).ok()).and_then(json::table) else { continue };
        let (id, kind, name, status, lat, lon, elev, var, hemis, freq, chan, alt, hours) = (
            t.col("NAV_ID"),
            t.col("NAV_TYPE"),
            t.col("NAME"),
            t.col("NAV_STATUS"),
            t.col("LAT_DECIMAL"),
            t.col("LONG_DECIMAL"),
            t.col("ELEV"),
            t.col("MAG_VARN"),
            t.col("MAG_VARN_HEMIS"),
            t.col("FREQ"),
            t.col("CHAN"),
            t.col("ALT_CODE"),
            t.col("OPER_HOURS"),
        );
        for r in &t.rows {
            let get = |c: Option<usize>| c.and_then(|c| r.get(c)).map(|s| s.trim()).unwrap_or("");
            let Some(&kind) = NAVAID_KINDS.iter().find(|k| **k == get(kind)) else { continue };
            let ident = get(id).to_uppercase();
            if ident.is_empty() || get(status) == "SHUTDOWN" {
                continue;
            }
            let (Ok(la), Ok(lo)) = (get(lat).parse::<f64>(), get(lon).parse::<f64>()) else { continue };
            if !in_box((lo, la), view) {
                continue;
            }
            let likelier = |k: &str| NAVAID_KINDS.iter().position(|n| *n == k).unwrap();
            // One facility filed as two kinds at one place is one, the
            // likelier to fly to (vfr.fixes' _read_navaids).
            if let Some(at) = vors.iter().position(|v| v.ident == ident && crate::geo::distance_nm(la, lo, v.lat, v.lon) < SAME_FACILITY_NM) {
                if likelier(kind) < likelier(vors[at].kind) {
                    vors.remove(at);
                } else {
                    continue;
                }
            }
            let mag_var = get(var).parse::<f64>().ok().map(|d| if get(hemis).eq_ignore_ascii_case("W") { -d } else { d });
            vors.push(Vor {
                ident,
                name: some_text(&crate::spoken::title(get(name))),
                kind,
                freq: some_text(get(freq)),
                lat: la,
                lon: lo,
                mag_var,
                elevation_ft: get(elev).parse::<f64>().ok(),
                channel: some_text(get(chan)),
                service_volume: alt.map(|_| some_text(get(alt))),
                hours: hours.map(|_| some_text(get(hours))),
                restricted: get(status).to_uppercase().contains("RESTRICTED"),
            });
        }
    }
    vors.retain(|v| VOR_KINDS.contains(&v.kind));
    vors.sort_by(|a, b| a.ident.cmp(&b.ident));
    vors.truncate(NAVAID_LIMIT);
    let mut out = String::from("{\"vors\":[");
    for (k, v) in vors.iter().enumerate() {
        if k > 0 {
            out.push(',');
        }
        out.push_str("{\"ident\":");
        json::string(&mut out, &v.ident);
        out.push_str(",\"name\":");
        json::opt_string(&mut out, v.name.as_deref());
        out.push_str(&format!(",\"kind\":\"{}\",\"freq\":", v.kind));
        json::opt_string(&mut out, v.freq.as_deref());
        out.push_str(",\"lat\":");
        json::number(&mut out, v.lat);
        out.push_str(",\"lon\":");
        json::number(&mut out, v.lon);
        out.push_str(",\"mag_var\":");
        json::opt_number(&mut out, v.mag_var);
        out.push_str(",\"elevation_ft\":");
        json::opt_number(&mut out, v.elevation_ft);
        out.push_str(",\"channel\":");
        json::opt_string(&mut out, v.channel.as_deref());
        out.push_str(",\"service_volume\":");
        json::opt_string(&mut out, v.service_volume.as_ref().and_then(|s| s.as_deref()));
        out.push_str(",\"hours\":");
        json::opt_string(&mut out, v.hours.as_ref().and_then(|s| s.as_deref()));
        out.push_str(&format!(",\"restricted\":{},\"remarks\":[]}}", v.restricted));
    }
    out.push_str("],\"fixes\":[]}");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rings_are_oriented_with_the_volume_on_the_left() {
        // A shapefile's clockwise square with a counter-clockwise hole.
        let outer = vec![(0.0, 0.0), (0.0, 10.0), (10.0, 10.0), (10.0, 0.0)];
        let hole = vec![(4.0, 4.0), (6.0, 4.0), (6.0, 6.0), (4.0, 6.0)];
        let polygons = oriented(vec![vec![outer, hole]]);
        assert_eq!(polygons.len(), 1);
        assert!(signed_area(&polygons[0].shell) > 0.0);
        assert!(signed_area(&polygons[0].holes[0]) < 0.0);
        // A hole nothing holds is a polygon of its own, left as it is.
        let orphan = vec![(20.0, 20.0), (21.0, 20.0), (21.0, 21.0), (20.0, 21.0)];
        let polygons = oriented(vec![vec![orphan.clone()]]);
        assert_eq!(polygons[0].shell, orphan);
    }

    #[test]
    fn a_box_is_met_by_a_line_through_it_or_a_corner_inside() {
        let square = oriented(vec![vec![vec![(0.0, 0.0), (0.0, 10.0), (10.0, 10.0), (10.0, 0.0)]]]);
        assert!(reaches(&square, [2.0, 2.0, 3.0, 3.0]));
        assert!(reaches(&square, [-1.0, 5.0, 1.0, 6.0]));
        assert!(reaches(&square, [-1.0, -1.0, 11.0, 11.0]));
        assert!(!reaches(&square, [11.0, 11.0, 12.0, 12.0]));
        assert!(!segment_meets((11.0, 0.0), (11.0, 10.0), [0.0, 0.0, 10.0, 10.0]));
    }

    #[test]
    fn simplifying_keeps_the_ends_and_the_far_points() {
        let line = vec![(0.0, 0.0), (1.0, 0.01), (2.0, 0.0), (3.0, 1.0), (4.0, 0.0)];
        // (2, 0) is kept once (3, 1) is: it is far off the line to it.
        assert_eq!(simplified(&line, 0.1), vec![(0.0, 0.0), (2.0, 0.0), (3.0, 1.0), (4.0, 0.0)]);
        assert_eq!(simplified(&line, 0.0), line);
    }

    #[test]
    fn the_label_is_in_the_widest_section() {
        let square = oriented(vec![vec![vec![(0.0, 0.0), (0.0, 10.0), (10.0, 10.0), (10.0, 0.0)], vec![(4.0, 4.0), (6.0, 4.0), (6.0, 6.0), (4.0, 6.0)]]]);
        // The bisector at 5 cuts the hole: two sections of 4, the first
        // kept, as JTS keeps it.
        assert_eq!(representative(&square).unwrap(), (2.0, 5.0));
        let tall = oriented(vec![vec![vec![(0.0, 0.0), (0.0, 10.0), (1.0, 10.0), (1.0, 0.0)]]]);
        assert_eq!(representative(&tall).unwrap(), (0.5, 5.0));
    }
}
