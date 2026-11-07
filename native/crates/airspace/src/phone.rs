//! The airspace over a point from a phone's pack, with no network: the
//! planner's /api/airspace/at answer, as JSON with its field names, for
//! what a pack holds. A phone pack (wingtip.pack's `write_phone`) is a cycle
//! pack of one region, its rings simplified, with these sections besides
//! the layers (crate::pack):
//!
//! - `airspace.vol`, 32 bytes a volume of the `airspace` layer: its class
//!   (an ASCII letter), its floor's reference (0 SFC, 1 AGL, 2 MSL), six
//!   zeros, its floor and its ceiling in feet (f64, the ceiling MSL), and
//!   where its name is in `airspace.names` (u32 offset, u32 length);
//! - `veil.pts`, 32 bytes an airport of 14 CFR part 91 appendix D
//!   section 1: its latitude and longitude (f64), its ident (ASCII,
//!   NUL-padded to 8), where its name is in `veil.names`;
//! - `sua.rec`, 24 bytes an area of the `sua` layer: its floor in feet
//!   (f64, not a number where it has none), where its description (the
//!   planner's SpecialUse, JSON) is in `sua.json` and where its name is
//!   in `sua.names` (u32 offset and length each);
//! - `airspace.attr`, a JSON array, one object a volume of the `airspace`
//!   layer, for the map's volumes in view (crate::view): `ident`,
//!   `number`, `ceiling_excluded`, `hours_code`, `hours_remark`. Since
//!   2026-11-03; a pack without it still reads, with those unknown.
//!
//! The place tables (`airports`, `navaids`, `fixes`: crate::spoken,
//! crate::view) are JSON, `{"columns": [...], "rows": [[...], ...]}` of
//! strings, the NASR columns wingtip.pack's COLUMNS names, read by name: a
//! column a newer pack adds is unknown from an older one, not an error.
//!
//! What a pack cannot know is said so: the ground's height is not in it
//! (the bands are measured from sea level, as the planner's are when it
//! cannot read the ground), nor are the TFRs (unavailable), nor the fix
//! the point is named off.

use crate::json;
use crate::pack::Pack;
use crate::rules::{self, FloorRef, Volume};

/// A phone pack's region: a square of this many degrees (wingtip.pack's
/// REGION_DEG), named by its south-west corner.
pub const REGION_DEG: f64 = 4.0;

/// The region holding a point, "n40w088": the pack a phone looks in.
pub fn region_of(lat: f64, lon: f64) -> String {
    let south = ((lat / REGION_DEG).floor() * REGION_DEG) as i32;
    let west = ((lon / REGION_DEG).floor() * REGION_DEG) as i32;
    format!(
        "{}{:02}{}{:03}",
        if south >= 0 { 'n' } else { 's' },
        south.abs(),
        if west >= 0 { 'e' } else { 'w' },
        west.abs()
    )
}

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

/// The volumes of the pack's airspace holding the point, in its order:
/// none where the region has no airspace drawn. None where a shape is not
/// one the engine reads.
pub fn volumes_at(pack: &Pack, lat: f64, lon: f64) -> Option<Vec<Volume>> {
    let Some(layer) = pack.layer("airspace") else { return Some(Vec::new()) };
    let records = pack.section("airspace.vol")?;
    let names = pack.section("airspace.names")?;
    let mut out = Vec::new();
    for i in layer.holding(lon, lat)? {
        let r = records.get(32 * i..32 * i + 32)?;
        out.push(Volume {
            class: r[0] as char,
            floor_ref: match r[1] {
                0 => FloorRef::Sfc,
                1 => FloorRef::Agl,
                _ => FloorRef::Msl,
            },
            floor_ft: f64_at(r, 8)?,
            ceiling_ft: f64_at(r, 16)?,
            name: text_at(names, r, 24)?.to_owned(),
        });
    }
    Some(out)
}

/// The nearest veil airport within 30 nm: (ident, name, distance in nm).
pub fn mode_c_veil(pack: &Pack, lat: f64, lon: f64) -> Option<(String, String, f64)> {
    let points = pack.section("veil.pts")?;
    let names = pack.section("veil.names")?;
    let mut airports = Vec::new();
    for r in points.chunks_exact(32) {
        let ident = String::from_utf8_lossy(r[16..24].split(|&c| c == 0).next().unwrap_or(&[])).into_owned();
        airports.push((f64_at(r, 0)?, f64_at(r, 8)?, ident, text_at(names, r, 24)?.to_owned()));
    }
    rules::nearest_veil(lat, lon, airports)
}

/// The special-use areas holding the point: one a name, the first in
/// the pack's order, lowest first and those with no floor last -- each
/// as the planner's SpecialUse JSON. None where a shape is not one the
/// engine reads; none found where the region has no areas.
pub fn special_use<'a>(pack: &Pack<'a>, lat: f64, lon: f64) -> Option<Vec<&'a str>> {
    let Some(layer) = pack.layer("sua") else { return Some(Vec::new()) };
    let records = pack.section("sua.rec")?;
    let blobs = pack.section("sua.json")?;
    let names = pack.section("sua.names")?;
    let mut found: Vec<(&str, f64, &str)> = Vec::new();
    for i in layer.holding(lon, lat)? {
        let r = records.get(24 * i..24 * i + 24)?;
        let name = text_at(names, r, 16)?;
        if found.iter().any(|f| f.0 == name) {
            continue;
        }
        found.push((name, f64_at(r, 0)?, text_at(blobs, r, 8)?));
    }
    // Python's sort: (floor is None, floor or 0), stable.
    found.sort_by(|a, b| {
        let key = |f: f64| (f.is_nan(), if f.is_nan() { 0.0 } else { f });
        let (ka, kb) = (key(a.1), key(b.1));
        ka.0.cmp(&kb.0).then(ka.1.partial_cmp(&kb.1).unwrap())
    });
    Some(found.into_iter().map(|f| f.2).collect())
}

/// The planner's AirspaceAt for the point, as JSON. `ground_ft` where the
/// caller knows it. `pack` None for a region with no pack, which has
/// nothing drawn in it: Class G and E by the rules alone. None where a
/// shape is not one the engine reads.
pub fn airspace_at(pack: Option<&Pack>, lat: f64, lon: f64, ground_ft: Option<f64>) -> Option<String> {
    let volumes = match pack {
        Some(p) => volumes_at(p, lat, lon)?,
        None => Vec::new(),
    };
    let veil = pack.and_then(|p| mode_c_veil(p, lat, lon));
    let bands = rules::column(ground_ft.unwrap_or(0.0), &volumes, veil.is_some());
    let areas = match pack {
        Some(p) => special_use(p, lat, lon),
        None => Some(Vec::new()),
    };
    let mut out = String::from("{\"lat\":");
    json::number(&mut out, lat);
    out.push_str(",\"lon\":");
    json::number(&mut out, lon);
    out.push_str(",\"ground_ft\":");
    json::opt_number(&mut out, ground_ft);
    out.push_str(",\"bands\":[");
    for (k, band) in bands.iter().enumerate() {
        if k > 0 {
            out.push(',');
        }
        rules::write_band(&mut out, band);
    }
    out.push_str("],\"mode_c_veil\":");
    match &veil {
        Some((ident, name, d)) => {
            out.push_str("{\"ident\":");
            json::string(&mut out, ident);
            out.push_str(",\"name\":");
            json::string(&mut out, name);
            // As Python's round(d, 1): the nearest tenth, correctly rounded.
            out.push_str(&format!(",\"distance_nm\":{:.1}}}", d));
        }
        None => out.push_str("null"),
    }
    out.push_str(",\"special_use\":[");
    out.push_str(&areas.as_deref().unwrap_or(&[]).join(","));
    out.push_str("],\"special_use_unavailable\":");
    out.push_str(if areas.is_some() { "false" } else { "true" });
    out.push_str(",\"tfrs\":[],\"tfrs_unavailable\":true,\"point\":null}");
    Some(out)
}
