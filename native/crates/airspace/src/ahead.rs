//! The alerts ahead of the airplane with no network, from the phone's
//! packs: wingtip.alerts' `ahead` as the phone works it out in the air when
//! the planner cannot be reached -- the Class B, C and D and special-use
//! areas the track goes into in the next five minutes, the TFRs as the
//! phone last downloaded them, and the ground it comes within 500 ft of
//! in the next minute -- as the planner's /api/alerts/ahead answers it
//! (AheadAlert, the same names), with what cannot be known offline said
//! so: the obstacles (the FAA's Digital Obstacle File is not in a pack),
//! and the TFRs' age. Every figure is wingtip.alerts' own; see it for why.
//!
//! The ground is the pack's `terrain` (wingtip.pack's `_terrain`): the ground
//! grid's highest ground pooled to a 60th of a degree, plus the grid's
//! margin, so never under the planner's grid; the planner reads the zoom-12
//! tiles point by point, so the phone's ground can stand some hundreds of
//! feet higher on a ridge and alert sooner, never later.

use crate::json;
use crate::pack::Pack;

/// wingtip.alerts' figures, each a design choice explained there.
pub const LOOK_AHEAD_S: f64 = 300.0;
pub const AIRSPACE_STEP_S: f64 = 5.0;
pub const ALTITUDE_BUFFER_FT: f64 = 200.0;
pub const TERRAIN_LOOK_AHEAD_S: f64 = 60.0;
pub const TERRAIN_WARNING_S: f64 = 30.0;
pub const TERRAIN_STEP_S: f64 = 2.0;
/// Borrowed from 14 CFR 91.119(c)'s 500 ft, so the alert comes before the
/// rule is broken (wingtip.alerts).
pub const TERRAIN_CLEARANCE_FT: f64 = 500.0;
pub const WARNING_CLEARANCE_FT: f64 = 100.0;
pub const SWATH_NM: f64 = 0.25;
pub const NEAR_FIELD_NM: f64 = 3.0;
pub const NEAR_FIELD_AGL_FT: f64 = 1000.0;
pub const AIRBORNE_KT: f64 = 40.0;
/// Class A from here (14 CFR 71.33): a volume with no ceiling reaches it.
const CLASS_A_FT: f64 = 18000.0;
/// wingtip.ground_grid's RESAMPLED_MARGIN_FT, added to every cell it reads.
pub const GROUND_MARGIN_FT: f64 = 150.0;
const GROUND_NONE: i16 = i16::MIN;

fn class_need(class: char) -> Option<(&'static str, &'static str)> {
    Some(match class {
        'B' => ("warning", "An ATC clearance before entering (91.131(a)(1))."),
        'C' => ("caution", "Two-way radio contact with ATC before entering (91.130(c)(1))."),
        'D' => ("caution", "Two-way radio contact with the tower before entering (91.129(c)(1))."),
        _ => return None,
    })
}

fn special_use_need(kind: &str) -> Option<(&'static str, &'static str)> {
    Some(match kind {
        "P" => ("warning", "No flight without the using agency's permission (91.133(a))."),
        "R" => ("caution", "No flight into it while in use without the controlling agency's permission (91.133(a)); ask ATC or Flight Service whether it is (AIM 3-4-3)."),
        "MOA" => ("caution", "Military training may be under way: ask ATC or Flight Service whether it is active (AIM 3-4-5)."),
        "W" => ("caution", "Hazardous military activity may be under way (AIM 3-4-4)."),
        "A" => ("caution", "Heavy pilot training or unusual flying: keep a lookout (AIM 3-4-6)."),
        _ => return None,
    })
}

const TERRAIN_WARNING: &str = "At or near the airplane's altitude: climb or turn now.";
const TERRAIN_CAUTION: &str = "Within 500 ft of the airplane's altitude: climb or turn (91.119(c)).";

/// A point reached from (lat, lon) along a great circle on wingtip.geo's
/// sphere, as its `destination_point` (pyproj's Geod with f = 0) reaches it.
pub fn destination(lat: f64, lon: f64, bearing_deg: f64, nm: f64) -> (f64, f64) {
    let d = nm / crate::geo::EARTH_RADIUS_NM;
    let (p1, l1, b) = (lat.to_radians(), lon.to_radians(), bearing_deg.to_radians());
    let p2 = (p1.sin() * d.cos() + p1.cos() * d.sin() * b.cos()).clamp(-1.0, 1.0).asin();
    let l2 = l1 + (b.sin() * d.sin() * p1.cos()).atan2(d.cos() - p1.sin() * p2.sin());
    let lon2 = (l2.to_degrees() + 540.0).rem_euclid(360.0) - 180.0;
    (p2.to_degrees(), lon2)
}

struct Track {
    times: Vec<f64>,
    along: Vec<f64>,
    lats: Vec<f64>,
    lons: Vec<f64>,
    alts: Option<Vec<f64>>,
    track_deg: f64,
}

impl Track {
    fn new(lat: f64, lon: f64, track_deg: f64, gs_kt: f64, alt_ft: Option<f64>, vs_fpm: f64, seconds: f64, step: f64) -> Track {
        let n = (seconds / step).round() as usize + 1;
        let times: Vec<f64> = (0..n).map(|i| i as f64 * step).collect();
        let along: Vec<f64> = times.iter().map(|t| gs_kt * t / 3600.0).collect();
        let (lats, lons) = along.iter().map(|&d| destination(lat, lon, track_deg, d)).unzip();
        let alts = alt_ft.map(|a| times.iter().map(|t| a + vs_fpm * t / 60.0).collect());
        Track { times, along, lats, lons, alts, track_deg }
    }

    fn bbox(&self, pad_nm: f64) -> [f64; 4] {
        let pad_lat = pad_nm / 60.0;
        let mean = self.lats.iter().sum::<f64>() / self.lats.len() as f64;
        let pad_lon = pad_lat / mean.to_radians().cos().max(0.2);
        let fold = |v: &[f64], f: fn(f64, f64) -> f64, s: f64| v.iter().copied().fold(s, f);
        [
            fold(&self.lons, f64::min, f64::INFINITY) - pad_lon,
            fold(&self.lats, f64::min, f64::INFINITY) - pad_lat,
            fold(&self.lons, f64::max, f64::NEG_INFINITY) + pad_lon,
            fold(&self.lats, f64::max, f64::NEG_INFINITY) + pad_lat,
        ]
    }

    /// (inside now, the first sample in it or within the buffer of it).
    fn entry(&self, holds: &dyn Fn(f64, f64) -> bool, floor: f64, ceiling: f64) -> (bool, Option<usize>) {
        let lateral: Vec<bool> = self.lats.iter().zip(&self.lons).map(|(&la, &lo)| holds(lo, la)).collect();
        match &self.alts {
            None => (lateral[0], lateral.iter().position(|&l| l)),
            Some(alts) => {
                let inside = lateral[0] && floor <= alts[0] && alts[0] <= ceiling;
                let first = (0..alts.len()).find(|&i| {
                    lateral[i] && alts[i] >= floor - ALTITUDE_BUFFER_FT && alts[i] <= ceiling + ALTITUDE_BUFFER_FT
                });
                (inside, first)
            }
        }
    }
}

/// One alert, its fields in the planner's order and names.
#[derive(Clone, Debug, Default)]
pub struct Alert {
    pub id: String,
    pub kind: &'static str,
    pub level: &'static str,
    pub name: String,
    pub class: Option<String>,
    pub need: String,
    pub inside: bool,
    pub seconds: f64,
    pub distance_nm: f64,
    pub lat: f64,
    pub lon: f64,
    pub floor_ft: Option<f64>,
    pub ceiling_ft: Option<f64>,
    pub top_ft: Option<f64>,
    pub clearance_ft: Option<f64>,
    pub times_of_use: Option<String>,
    pub notam_id: Option<String>,
}

fn round_to(v: f64, places: i32) -> f64 {
    let k = 10f64.powi(places);
    (v * k).round() / k
}

fn at(track: &Track, i: usize) -> Alert {
    Alert {
        seconds: track.times[i],
        distance_nm: round_to(track.along[i], 1),
        lat: round_to(track.lats[i], 5),
        lon: round_to(track.lons[i], 5),
        ..Default::default()
    }
}

fn f64_at(b: &[u8], o: usize) -> Option<f64> {
    b.get(o..o + 8).map(|s| f64::from_le_bytes(s.try_into().unwrap()))
}

fn u32_at(b: &[u8], o: usize) -> Option<u32> {
    b.get(o..o + 4).map(|s| u32::from_le_bytes(s.try_into().unwrap()))
}

fn text<'a>(run: &'a [u8], r: &[u8], o: usize) -> Option<&'a str> {
    let (s, l) = (u32_at(r, o)? as usize, u32_at(r, o + 4)? as usize);
    std::str::from_utf8(run.get(s..s + l)?).ok()
}

fn meets(b: [f64; 4], box_: [f64; 4]) -> bool {
    !(b[2] < box_[0] || b[0] > box_[2] || b[3] < box_[1] || b[1] > box_[3])
}

/// The highest ground at a point from the packs' grids, feet, the grid's
/// margin added; None where no pack holds a grid there or no tile reached.
pub fn ground_ft(packs: &[Pack], lat: f64, lon: f64) -> Option<f64> {
    for p in packs {
        let Some(g) = p.section("terrain") else { continue };
        let (south, west) = (f64_at(g, 0)?, f64_at(g, 8)?);
        let (per, rows, cols) = (u32_at(g, 16)? as f64, u32_at(g, 20)? as usize, u32_at(g, 24)? as usize);
        let (r, c) = (((lat - south) * per).floor(), ((lon - west) * per).floor());
        if r < 0.0 || c < 0.0 || r as usize >= rows || c as usize >= cols {
            continue;
        }
        let o = 32 + 2 * (r as usize * cols + c as usize);
        let v = i16::from_le_bytes(g.get(o..o + 2)?.try_into().unwrap());
        return (v != GROUND_NONE).then(|| v as f64 + GROUND_MARGIN_FT);
    }
    None
}

fn classes(packs: &[Pack], track: &Track) -> Vec<Alert> {
    let box_ = track.bbox(1.0);
    let mut found: Vec<((String, char), Alert)> = Vec::new();
    let mut inside_of: Vec<(String, char)> = Vec::new();
    for p in packs {
        let (Some(layer), Some(vols), Some(names)) = (p.layer("airspace"), p.section("airspace.vol"), p.section("airspace.names")) else { continue };
        for i in 0..layer.count {
            let Some(r) = vols.get(32 * i..32 * i + 32) else { continue };
            let class = r[0] as char;
            let Some((level, need)) = class_need(class) else { continue };
            if !meets(layer.bbox(i), box_) {
                continue;
            }
            let (Some(wkb), Some(floor), Some(ceiling), Some(name)) = (layer.wkb(i), f64_at(r, 8), f64_at(r, 16), text(names, r, 24)) else { continue };
            let floor = if r[1] == 0 { 0.0 } else { floor };
            let ceiling_or_a = if ceiling.is_nan() { CLASS_A_FT } else { ceiling };
            let holds = |x: f64, y: f64| crate::airspace::wkb_holds(wkb, x, y).unwrap_or(false);
            let (inside, index) = track.entry(&holds, floor, ceiling_or_a);
            let key = (name.to_string(), class);
            if inside {
                inside_of.push(key);
                continue;
            }
            let Some(index) = index else { continue };
            if found.iter().any(|(k, a)| *k == key && a.seconds <= track.times[index]) {
                continue;
            }
            found.retain(|(k, _)| *k != key);
            found.push((key, Alert {
                id: format!("airspace:{class}:{name}"),
                kind: "airspace",
                level,
                name: name.to_string(),
                need: need.to_string(),
                class: Some(class.to_string()),
                floor_ft: Some(floor),
                ceiling_ft: (!ceiling.is_nan()).then_some(ceiling),
                ..at(track, index)
            }));
        }
    }
    found.into_iter().filter(|(k, _)| !inside_of.contains(k)).map(|(_, a)| a).collect()
}

/// A floor or ceiling in feet MSL, as wingtip.alerts' `_height_msl`.
fn height_msl(value: Option<f64>, agl: bool, ground: Option<f64>, missing: f64) -> f64 {
    match value {
        None => missing,
        Some(v) if agl => match ground {
            Some(g) => v + g,
            None if missing <= 0.0 => v,
            None => missing,
        },
        Some(v) => v,
    }
}

fn special_use(packs: &[Pack], track: &Track, ground: Option<f64>) -> Vec<Alert> {
    let box_ = track.bbox(1.0);
    let mut found: Vec<Alert> = Vec::new();
    for p in packs {
        let (Some(layer), Some(alt), Some(names), Some(rec), Some(times)) =
            (p.layer("sua"), p.section("sua.alt"), p.section("sua.names"), p.section("sua.rec"), p.section("sua.times"))
        else {
            continue;
        };
        for i in 0..layer.count {
            let (Some(a), Some(r)) = (alt.get(32 * i..32 * i + 32), rec.get(24 * i..24 * i + 24)) else { continue };
            let kind = String::from_utf8_lossy(a[..4].split(|&c| c == 0).next().unwrap_or(&[])).into_owned();
            let Some((level, need)) = special_use_need(&kind) else { continue };
            let bbox = layer.bbox(i);
            if !meets(bbox, box_) {
                continue;
            }
            let (Some(wkb), Some(name)) = (layer.wkb(i), text(names, r, 16)) else { continue };
            let (floor_agl, ceiling_agl) = (a[4] == 2, a[5] == 2);
            let floor_v = f64_at(a, 8).filter(|v| !v.is_nan());
            let ceiling_v = f64_at(a, 16).filter(|v| !v.is_nan());
            // The ground under the area for its AGL heights: the middle of
            // its box, the airplane's own where that cannot be read.
            let under = if floor_agl || ceiling_agl {
                ground_ft(packs, (bbox[1] + bbox[3]) / 2.0, (bbox[0] + bbox[2]) / 2.0).or(ground)
            } else {
                ground
            };
            let floor = height_msl(floor_v, floor_agl, under, 0.0);
            let ceiling = height_msl(ceiling_v, ceiling_agl, under, f64::INFINITY);
            let holds = |x: f64, y: f64| crate::airspace::wkb_holds(wkb, x, y).unwrap_or(false);
            let (inside, index) = track.entry(&holds, floor, ceiling);
            let Some(index) = index else { continue };
            if found.iter().any(|f| f.name == name && f.seconds <= track.times[index]) {
                continue;
            }
            found.retain(|f| f.name != name);
            found.push(Alert {
                id: format!("special_use:{name}"),
                kind: "special_use",
                level,
                name: name.to_string(),
                need: need.to_string(),
                inside: inside && index == 0,
                class: Some(kind.clone()),
                floor_ft: if floor_agl { Some(floor) } else { floor_v },
                ceiling_ft: if ceiling_agl { Some(ceiling).filter(|c| c.is_finite()) } else { ceiling_v },
                times_of_use: text(times, a, 24).filter(|t| !t.is_empty()).map(str::to_string),
                ..at(track, index)
            });
        }
    }
    found
}

/// One TFR as the phone kept it: a tab-separated line -- its NOTAM, its
/// title, the rule it is issued under, its floor and ceiling in feet (empty where none), each one's
/// reference (MSL or AGL), when it starts and ends (Unix seconds, empty
/// where not given), and its outer ring as "lon lat" pairs joined by ",".
struct Tfr {
    notam: String,
    title: String,
    rule: String,
    floor: Option<f64>,
    floor_agl: bool,
    ceiling: Option<f64>,
    ceiling_agl: bool,
    from: Option<i64>,
    to: Option<i64>,
    ring: Vec<(f64, f64)>,
}

fn tfrs_of(text: &str) -> Vec<Tfr> {
    text.lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.split('\t').collect();
            if f.len() != 10 {
                return None;
            }
            let num = |s: &str| s.trim().parse::<f64>().ok().filter(|v| v.is_finite());
            let ring: Vec<(f64, f64)> = f[9]
                .split(',')
                .filter_map(|p| {
                    let mut it = p.split_whitespace();
                    Some((num(it.next()?)?, num(it.next()?)?))
                })
                .collect();
            (ring.len() >= 3).then(|| Tfr {
                notam: f[0].to_string(),
                title: f[1].to_string(),
                rule: f[2].to_string(),
                floor: num(f[3]),
                floor_agl: f[4] == "AGL",
                ceiling: num(f[5]),
                ceiling_agl: f[6] == "AGL",
                from: f[7].trim().parse().ok(),
                to: f[8].trim().parse().ok(),
                ring,
            })
        })
        .collect()
}

/// Whether a ring holds a point, by the even-odd rule.
fn ring_holds(ring: &[(f64, f64)], x: f64, y: f64) -> bool {
    let mut inside = false;
    let mut j = ring.len() - 1;
    for i in 0..ring.len() {
        let ((xi, yi), (xj, yj)) = (ring[i], ring[j]);
        if (yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi {
            inside = !inside;
        }
        j = i;
    }
    inside
}

fn tfrs(packs: &[Pack], track: &Track, ground: Option<f64>, now: i64, text: &str) -> Vec<Alert> {
    let until = now + *track.times.last().unwrap() as i64;
    let mut found = Vec::new();
    for t in tfrs_of(text) {
        // In force at some time over the look-ahead (wingtip.tfr's in_force).
        if t.to.is_some_and(|e| e < now) || t.from.is_some_and(|s| s > until) {
            continue;
        }
        let under = if t.floor_agl || t.ceiling_agl {
            let (x, y) = t.ring[0];
            ground_ft(packs, y, x).or(ground)
        } else {
            ground
        };
        let floor = height_msl(t.floor, t.floor_agl, under, 0.0);
        let ceiling = height_msl(t.ceiling, t.ceiling_agl, under, f64::INFINITY);
        let ring = &t.ring;
        let holds = |x: f64, y: f64| ring_holds(ring, x, y);
        let (inside, index) = track.entry(&holds, floor, ceiling);
        let Some(index) = index else { continue };
        found.push(Alert {
            id: format!("tfr:{}", t.notam),
            kind: "tfr",
            level: "warning",
            name: if t.title.is_empty() { format!("TFR {}", t.notam) } else { t.title.clone() },
            need: if t.rule.is_empty() {
                format!("In force: no flight in it but as NOTAM {} allows.", t.notam)
            } else {
                format!("In force: no flight in it but as NOTAM {} allows ({}).", t.notam, t.rule)
            },
            inside: inside && index == 0,
            floor_ft: t.floor.map(|_| floor),
            ceiling_ft: Some(ceiling).filter(|c| c.is_finite()),
            notam_id: Some(t.notam.clone()),
            ..at(track, index)
        });
    }
    found
}

fn clearance_level(seconds: f64, clearance: f64) -> Option<&'static str> {
    if seconds <= TERRAIN_WARNING_S && clearance < WARNING_CLEARANCE_FT {
        Some("warning")
    } else if clearance < TERRAIN_CLEARANCE_FT {
        Some("caution")
    } else {
        None
    }
}

/// The ground the next minute's track comes within 500 ft of: one alert
/// where it is least. None where the packs hold no ground there.
fn terrain(packs: &[Pack], track: &Track) -> Option<Vec<Alert>> {
    let alts = track.alts.as_ref()?;
    let n = track.times.len();
    let mut rows = vec![(track.lats.clone(), track.lons.clone())];
    for side in [-90.0, 90.0] {
        rows.push((0..n).map(|i| destination(track.lats[i], track.lons[i], track.track_deg + side, SWATH_NM)).unzip());
    }
    let mut highest = vec![f64::NEG_INFINITY; n];
    let mut at_row = vec![0usize; n];
    for (k, (lats, lons)) in rows.iter().enumerate() {
        for i in 0..n {
            let g = ground_ft(packs, lats[i], lons[i])?;
            if g > highest[i] {
                highest[i] = g;
                at_row[i] = k;
            }
        }
    }
    let clearance: Vec<f64> = (0..n).map(|i| alts[i] - highest[i]).collect();
    let worst = (0..n)
        .filter_map(|i| clearance_level(track.times[i], clearance[i]).map(|l| (l, i)))
        .min_by(|a, b| (a.0 != "warning").cmp(&(b.0 != "warning")).then(clearance[a.1].partial_cmp(&clearance[b.1]).unwrap()));
    let Some((level, i)) = worst else { return Some(Vec::new()) };
    let (lats, lons) = &rows[at_row[i]];
    Some(vec![Alert {
        id: "terrain".into(),
        kind: "terrain",
        level,
        name: "Terrain".into(),
        need: if level == "warning" { TERRAIN_WARNING } else { TERRAIN_CAUTION }.into(),
        top_ft: Some(round_to(highest[i], -1)),
        clearance_ft: Some(round_to(clearance[i], -1)),
        lat: round_to(lats[i], 5),
        lon: round_to(lons[i], 5),
        ..at(track, i)
    }])
}

/// Whether the airplane is taking off or landing at a field: within 3 nm
/// of one and no more than 1,000 ft over it (wingtip.alerts' `_near_field`),
/// from the packs' airports (NASR's airports, seaplane bases, gliderports
/// and ultralight fields; a heliport or a balloonport is no field).
fn near_field(packs: &[Pack], lat: f64, lon: f64, alt: f64) -> bool {
    let mut best: Option<(f64, Option<f64>)> = None;
    for p in packs {
        let Some(t) = p.section("airports").and_then(|b| std::str::from_utf8(b).ok()).and_then(json::table) else { continue };
        let (Some(la), Some(lo), Some(el), Some(kind)) = (t.col("LAT_DECIMAL"), t.col("LONG_DECIMAL"), t.col("ELEV"), t.col("SITE_TYPE_CODE")) else { continue };
        for row in &t.rows {
            if !matches!(row[kind].as_str(), "A" | "C" | "G" | "U") {
                continue;
            }
            let (Ok(y), Ok(x)) = (row[la].parse::<f64>(), row[lo].parse::<f64>()) else { continue };
            let d = crate::geo::distance_nm(lat, lon, y, x);
            if best.is_none_or(|b| d < b.0) {
                best = Some((d, row[el].parse::<f64>().ok()));
            }
        }
    }
    match best {
        Some((d, elev)) if d <= NEAR_FIELD_NM => elev.is_none_or(|e| alt <= e + NEAR_FIELD_AGL_FT),
        _ => false,
    }
}

/// The alerts ahead, as the planner's {"alerts", "unavailable"} with
/// "tfrs_as_of", JSON. `tfrs` the phone's kept TFRs (one a line, as
/// `Tfr` above) and when it downloaded them; None where it has none.
#[allow(clippy::too_many_arguments)]
pub fn ahead(packs: &[Pack], lat: f64, lon: f64, track_deg: f64, gs_kt: f64, alt_ft: Option<f64>, vs_fpm: f64, now: i64,
             tfr_lines: Option<&str>, tfrs_at: Option<i64>) -> String {
    let mut alerts: Vec<Alert> = Vec::new();
    let mut unavailable: Vec<&str> = Vec::new();
    if gs_kt >= AIRBORNE_KT {
        let track = Track::new(lat, lon, track_deg, gs_kt, alt_ft, vs_fpm, LOOK_AHEAD_S, AIRSPACE_STEP_S);
        let near = Track::new(lat, lon, track_deg, gs_kt, alt_ft, vs_fpm, TERRAIN_LOOK_AHEAD_S, TERRAIN_STEP_S);
        let ground = ground_ft(packs, lat, lon);
        alerts.extend(classes(packs, &track));
        alerts.extend(special_use(packs, &track, ground));
        match tfr_lines {
            Some(text) => alerts.extend(tfrs(packs, &track, ground, now, text)),
            None => unavailable.push("TFRs"),
        }
        match alt_ft {
            Some(alt) => {
                if !near_field(packs, lat, lon, alt) {
                    match terrain(packs, &near) {
                        Some(found) => alerts.extend(found),
                        None => unavailable.push("terrain"),
                    }
                }
                // The FAA's obstacle file is the planner's alone.
                unavailable.push("obstacles");
            }
            None => unavailable.push("terrain and obstacles, with no GPS altitude"),
        }
        alerts.sort_by(|a, b| (a.level != "warning").cmp(&(b.level != "warning")).then(a.seconds.partial_cmp(&b.seconds).unwrap()));
    }
    to_json(&alerts, &unavailable, tfrs_at)
}

fn to_json(alerts: &[Alert], unavailable: &[&str], tfrs_at: Option<i64>) -> String {
    let mut out = String::from("{\"alerts\":[");
    for (k, a) in alerts.iter().enumerate() {
        if k > 0 {
            out.push(',');
        }
        out.push_str("{\"id\":");
        json::string(&mut out, &a.id);
        out.push_str(&format!(",\"kind\":\"{}\",\"level\":\"{}\",\"name\":", a.kind, a.level));
        json::string(&mut out, &a.name);
        out.push_str(",\"class\":");
        json::opt_string(&mut out, a.class.as_deref());
        out.push_str(",\"need\":");
        json::string(&mut out, &a.need);
        out.push_str(&format!(",\"inside\":{},\"seconds\":", a.inside));
        json::number(&mut out, a.seconds);
        for (name, v) in [("distance_nm", Some(a.distance_nm)), ("lat", Some(a.lat)), ("lon", Some(a.lon)), ("floor_ft", a.floor_ft),
                          ("ceiling_ft", a.ceiling_ft), ("top_ft", a.top_ft), ("clearance_ft", a.clearance_ft)] {
            out.push_str(&format!(",\"{name}\":"));
            json::opt_number(&mut out, v);
        }
        out.push_str(",\"times_of_use\":");
        json::opt_string(&mut out, a.times_of_use.as_deref());
        out.push_str(",\"notam_id\":");
        json::opt_string(&mut out, a.notam_id.as_deref());
        out.push('}');
    }
    out.push_str("],\"unavailable\":[");
    for (k, u) in unavailable.iter().enumerate() {
        if k > 0 {
            out.push(',');
        }
        json::string(&mut out, u);
    }
    out.push_str("],\"tfrs_as_of\":");
    match tfrs_at {
        Some(t) => out.push_str(&t.to_string()),
        None => out.push_str("null"),
    }
    out.push('}');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn destination_is_the_sphere_s() {
        // Due north 60 nm is a degree of latitude on wingtip.geo's sphere.
        let (lat, lon) = destination(45.0, -93.0, 0.0, 60.0);
        assert!((lat - 45.999_413).abs() < 1e-4 && (lon + 93.0).abs() < 1e-9, "{lat} {lon}");
        assert!((crate::geo::distance_nm(45.0, -93.0, lat, lon) - 60.0).abs() < 1e-9);
    }

    #[test]
    fn nothing_on_the_ground_and_a_tfr_ahead_in_the_air() {
        let ring = "-93.0 45.05,-92.9 45.05,-92.9 45.15,-93.0 45.15,-93.0 45.05";
        let line = format!("6/1234\tA stadium\t\t\t\t3000\tAGL\t\t\t{ring}");
        let none: [Pack; 0] = [];
        let parked = ahead(&none, 45.0, -92.95, 0.0, 10.0, Some(1000.0), 0.0, 0, Some(&line), Some(0));
        assert!(parked.starts_with("{\"alerts\":[],\"unavailable\":[]"), "{parked}");
        let flying = ahead(&none, 45.0, -92.95, 0.0, 120.0, Some(2000.0), 0.0, 0, Some(&line), Some(0));
        assert!(flying.contains("\"id\":\"tfr:6/1234\""), "{flying}");
        // No packs: no ground to read.
        assert!(flying.contains("\"terrain\""), "{flying}");
    }
}
