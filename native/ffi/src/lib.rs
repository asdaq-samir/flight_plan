//! The engine's C functions, for the phones (include/wingtip_engine.h):
//! each takes the pack as a pointer and a length the caller keeps mapped
//! for the call, and a string it returns is the caller's to give back
//! with `wt_string_free`.

use std::ffi::{c_char, CStr, CString};
use wingtip_engine::figures::{debrief, diversion, holding, lost_comms};
use wingtip_engine::{ahead, clearance::Route, flight, pack::Pack, phone, spoken, validity, wmm};

/// SAFETY: the caller passes `len` readable bytes at `ptr` (or a null
/// pointer and 0), alive for the call.
unsafe fn bytes<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if ptr.is_null() || len == 0 {
        &[]
    } else {
        std::slice::from_raw_parts(ptr, len)
    }
}

fn give(s: String) -> *mut c_char {
    CString::new(s).map(CString::into_raw).unwrap_or(std::ptr::null_mut())
}

/// The planner's AirspaceAt for the point as JSON, from a phone's pack:
/// no bytes (a null pointer, 0) for a region the pack list has none of,
/// which has nothing drawn in it. Null where the bytes are not a pack the
/// engine reads. `ground_ft` not a number where the caller does not know
/// the ground's height.
///
/// # Safety
/// `ptr` and `len` as for every function here.
#[no_mangle]
pub unsafe extern "C" fn wt_airspace_at(ptr: *const u8, len: usize, lat: f64, lon: f64, ground_ft: f64) -> *mut c_char {
    let ground = if ground_ft.is_finite() { Some(ground_ft) } else { None };
    let data = bytes(ptr, len);
    let answer = if data.is_empty() {
        phone::airspace_at(None, lat, lon, ground)
    } else {
        let Ok(pack) = Pack::read(data) else { return std::ptr::null_mut() };
        phone::airspace_at(Some(&pack), lat, lon, ground)
    };
    answer.map(give).unwrap_or(std::ptr::null_mut())
}

/// 1 where every byte is as written, 0 where not, -1 where it is no pack.
///
/// # Safety
/// As above.
#[no_mangle]
pub unsafe extern "C" fn wt_pack_verify(ptr: *const u8, len: usize) -> i32 {
    match Pack::read(bytes(ptr, len)) {
        Ok(pack) => pack.verify() as i32,
        Err(_) => -1,
    }
}

/// The pack's cycle, "YYYY-MM-DD"; null where it is no pack.
///
/// # Safety
/// As above.
#[no_mangle]
pub unsafe extern "C" fn wt_pack_cycle(ptr: *const u8, len: usize) -> *mut c_char {
    match Pack::read(bytes(ptr, len)) {
        Ok(pack) => give(pack.cycle),
        Err(_) => std::ptr::null_mut(),
    }
}

/// The name of the region whose pack holds a point ("n40w088").
#[no_mangle]
pub extern "C" fn wt_region_of(lat: f64, lon: f64) -> *mut c_char {
    give(phone::region_of(lat, lon))
}

/// A C string the caller passed, or None for null (or not UTF-8).
///
/// SAFETY: `s` is null or a NUL-terminated string alive for the call.
unsafe fn text<'a>(s: *const c_char) -> Option<&'a str> {
    if s.is_null() {
        None
    } else {
        CStr::from_ptr(s).to_str().ok()
    }
}

/// What the radio said, all the phone can make of it with no signal, as
/// JSON (wingtip_engine::spoken::hear): the clearance read into its
/// items, whether it was said to `tail` (null: no airplane picked) and
/// where its "direct" sends us, the places it named found in the `count`
/// kept packs (`packs[i]`, `lens[i]` bytes each; one not a pack is passed
/// over), and the route it gives from `dep`, `stops` (comma-joined) and
/// `dest`. `near_lat` and `near_lon`, `near_count` points of the route,
/// put the nearer of two places alike first.
///
/// # Safety
/// The strings are null or NUL-terminated; `packs` and `lens` hold
/// `count` entries, each pack readable for its length; `near_lat` and
/// `near_lon` hold `near_count` each. All alive for the call.
#[no_mangle]
pub unsafe extern "C" fn wt_clearance_hear(
    heard: *const c_char,
    tail: *const c_char,
    packs: *const *const u8,
    lens: *const usize,
    count: usize,
    near_lat: *const f64,
    near_lon: *const f64,
    near_count: usize,
    dep: *const c_char,
    stops: *const c_char,
    dest: *const c_char,
) -> *mut c_char {
    let Some(heard) = text(heard) else { return std::ptr::null_mut() };
    let mut places = Vec::new();
    if !packs.is_null() && !lens.is_null() {
        for i in 0..count {
            if let Ok(pack) = Pack::read(bytes(*packs.add(i), *lens.add(i))) {
                places.extend(spoken::places_of(&pack));
            }
        }
    }
    let near: Vec<(f64, f64)> = if near_lat.is_null() || near_lon.is_null() {
        Vec::new()
    } else {
        (0..near_count).map(|i| (*near_lat.add(i), *near_lon.add(i))).collect()
    };
    let planned = Route {
        dep: text(dep).unwrap_or("").to_owned(),
        stops: text(stops).unwrap_or("").split(',').filter(|s| !s.is_empty()).map(str::to_owned).collect(),
        dest: text(dest).unwrap_or("").to_owned(),
    };
    give(spoken::hear(heard, text(tail), places, &near, &planned))
}

/// Whether a transmission was said to the airplane `tail` ("N123AB"),
/// by AIM 4-2-4's forms of its call sign: 1 yes, 0 no.
///
/// # Safety
/// Both strings null or NUL-terminated, alive for the call.
#[no_mangle]
pub unsafe extern "C" fn wt_our_call(heard: *const c_char, tail: *const c_char) -> i32 {
    match (text(heard), text(tail)) {
        (Some(h), Some(t)) => wingtip_engine::clearance::our_call(h, t) as i32,
        _ => 0,
    }
}

/// A string one of these returned, given back.
///
/// # Safety
/// `s` is null or a string from this library, given back once.
#[no_mangle]
pub unsafe extern "C" fn wt_string_free(s: *mut c_char) {
    if !s.is_null() {
        drop(CString::from_raw(s));
    }
}

// The flight's figures, the planner's own (wingtip_engine::flight, wmm,
// validity), for the phones with no signal.

/// The wind triangle: 1 with the correction (+ right), the true heading
/// and the groundspeed written to the three pointers; 0 where no heading
/// holds the course, the pointers untouched.
///
/// # Safety
/// The three pointers are writable doubles, or null for one not wanted.
#[no_mangle]
pub unsafe extern "C" fn wt_wind_triangle(true_course_deg: f64, tas_kt: f64, wind_from_deg: f64, wind_kt: f64,
                                          wca_deg: *mut f64, heading_deg: *mut f64, groundspeed_kt: *mut f64) -> i32 {
    let Some((wca, th, gs)) = flight::wind_triangle(true_course_deg, tas_kt, wind_from_deg, wind_kt) else { return 0 };
    for (ptr, v) in [(wca_deg, wca), (heading_deg, th), (groundspeed_kt, gs)] {
        if !ptr.is_null() {
            *ptr = v;
        }
    }
    1
}

/// The lowest VFR cruising altitude (14 CFR 91.159) at or above a floor.
#[no_mangle]
pub extern "C" fn wt_lowest_vfr_altitude(floor_ft: f64, magnetic_course_deg: f64) -> f64 {
    flight::lowest_vfr_cruising_altitude(floor_ft, magnetic_course_deg)
}

/// The fuel reserve in minutes (14 CFR 91.151, 91.167): ifr and night 0 or 1.
#[no_mangle]
pub extern "C" fn wt_reserve_min(ifr: i32, night: i32) -> f64 {
    flight::reserve_min(ifr != 0, night != 0)
}

/// Density altitude from a pressure altitude and the air's temperature.
#[no_mangle]
pub extern "C" fn wt_density_altitude_ft(pressure_altitude_ft: f64, oat_c: f64) -> f64 {
    flight::density_altitude_ft(flight::density_ratio(pressure_altitude_ft, oat_c))
}

/// Pressure altitude from a field's elevation and its altimeter setting.
#[no_mangle]
pub extern "C" fn wt_pressure_altitude_ft(elevation_ft: f64, altimeter_inhg: f64) -> f64 {
    flight::pressure_altitude_ft(elevation_ft, altimeter_inhg)
}

/// Magnetic variation, degrees east positive, for a decimal year (WMM-2025).
#[no_mangle]
pub extern "C" fn wt_declination(lat: f64, lon: f64, year: f64) -> f64 {
    wmm::declination(lat, lon, year)
}

fn product(kind: i32) -> Option<validity::Product> {
    Some(match kind {
        0 => validity::Product::Metar,
        1 => validity::Product::Speci,
        2 => validity::Product::Taf,
        3 => validity::Product::WindsAloft,
        4 => validity::Product::Advisory,
        _ => return None,
    })
}

fn opt(t: i64) -> Option<i64> {
    (t != i64::MIN).then_some(t)
}

/// Whether a weather report still counts at `now` (Unix seconds): kind 0
/// METAR, 1 SPECI, 2 TAF, 3 winds aloft, 4 AIRMET/SIGMET; a time not
/// known is INT64_MIN. 1 counts, 0 not, -1 no such kind.
#[no_mangle]
pub extern "C" fn wt_weather_in_force(kind: i32, now: i64, observed: i64, last_routine: i64, valid_from: i64, valid_to: i64) -> i32 {
    match product(kind) {
        Some(p) => validity::in_force(p, now, opt(observed), opt(last_routine), opt(valid_from), opt(valid_to)) as i32,
        None => -1,
    }
}

/// The alerts ahead with no network (wingtip_engine::ahead), as the
/// planner's /api/alerts/ahead answers, JSON: `count` packs, each at
/// `ptrs[i]` with `lens[i]` bytes kept mapped for the call (the regions
/// round the airplane); `alt_ft` NAN where the GPS gives none; `tfrs` the
/// kept TFRs, a tab-separated line each, or NULL where there are none,
/// downloaded at `tfrs_at` (INT64_MIN not known). Packs that are not packs
/// are passed over. NULL where the answer cannot be written.
///
/// # Safety
/// `ptrs` and `lens` hold `count` entries, each as for every function
/// here; `tfrs` NULL or a NUL-terminated string.
#[no_mangle]
pub unsafe extern "C" fn wt_ahead(ptrs: *const *const u8, lens: *const usize, count: usize, lat: f64, lon: f64, track_deg: f64,
                                  gs_kt: f64, alt_ft: f64, vs_fpm: f64, now: i64, tfrs: *const c_char, tfrs_at: i64) -> *mut c_char {
    let mut packs = Vec::new();
    if !ptrs.is_null() && !lens.is_null() {
        for i in 0..count {
            if let Ok(p) = Pack::read(bytes(*ptrs.add(i), *lens.add(i))) {
                packs.push(p);
            }
        }
    }
    let lines = if tfrs.is_null() { None } else { CStr::from_ptr(tfrs).to_str().ok() };
    let alt = (!alt_ft.is_nan()).then_some(alt_ft);
    let at = (tfrs_at != i64::MIN).then_some(tfrs_at);
    give(ahead::ahead(&packs, lat, lon, track_deg, gs_kt, alt, vs_fpm, now, lines, at))
}

// The four pilot pages' figures (wingtip_engine::figures), each answered
// as the planner's endpoint answers it, so the phone shows the same words
// and marks with no signal. A figure not known is NAN.

fn known(v: f64) -> Option<f64> {
    (!v.is_nan()).then_some(v)
}

/// Status and answer of wt_call: `ok` 1 with the rule's answer as JSON in
/// `text`, or 0 with what was wrong in words. `text` is the caller's to
/// give back with wt_string_free (NULL only where the answer held a NUL,
/// which no rule writes).
#[repr(C)]
pub struct WtCalled {
    pub ok: i32,
    pub text: *mut c_char,
}

/// The engine's one way in, as the web app and the planner ask it too
/// (wingtip_engine::call): a rule by `name`, its input a JSON object, its
/// answer JSON. The per-rule functions below stay for the app's existing
/// callers.
///
/// # Safety
/// `name` and `input` are NULL or NUL-terminated UTF-8.
#[no_mangle]
pub unsafe extern "C" fn wt_call(name: *const c_char, input: *const c_char) -> WtCalled {
    let read = |p: *const c_char| if p.is_null() { None } else { CStr::from_ptr(p).to_str().ok() };
    let answer = match (read(name), read(input)) {
        (Some(name), Some(input)) => wingtip_engine::call::call(name, input),
        _ => Err("wt_call: the name and the input are NUL-terminated UTF-8".to_owned()),
    };
    match answer {
        Ok(text) => WtCalled { ok: 1, text: give(text) },
        Err(why) => WtCalled { ok: 0, text: give(why) },
    }
}

/// A hold's entry and its legs in the wind (AIM 5-3-8), as the planner's
/// /api/holding answers, JSON. `right` 1 for right turns, 0 left; the
/// wind is worked only where `tas_kt`, `wind_from_deg`, `wind_kt` and
/// `altitude_ft` are all known.
#[no_mangle]
pub extern "C" fn wt_holding(inbound_deg: f64, heading_deg: f64, right: i32, tas_kt: f64, wind_from_deg: f64, wind_kt: f64,
                             altitude_ft: f64) -> *mut c_char {
    give(holding::holding_json(inbound_deg, heading_deg, right != 0, known(tas_kt), known(wind_from_deg), known(wind_kt),
                               known(altitude_ft)))
}

/// Two-way radio failure (14 CFR 91.185), as the planner's /api/lost-comms
/// answers, JSON: `count` segments, `names[i]` (NULL or empty: "Segment")
/// and `minimums_ft[i]` (NAN not known); the altitudes assigned and
/// expected (NAN none), the segment the expected one applies from,
/// `approach_fix` 1 where the clearance limit is a fix an approach begins
/// from, and the EFC and ETA as the pilot wrote them (NULL none).
///
/// # Safety
/// `names` and `minimums_ft` hold `count` entries (or are NULL), each name
/// NULL or NUL-terminated; `efc` and `eta` NULL or NUL-terminated.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn wt_lost_comms(names: *const *const c_char, minimums_ft: *const f64, count: usize, assigned_ft: f64,
                                       expected_ft: f64, expected_from: i64, approach_fix: i32, efc: *const c_char,
                                       eta: *const c_char) -> *mut c_char {
    let segments: Vec<(String, Option<f64>)> = (0..count)
        .map(|i| {
            let name = if names.is_null() { None } else { text(*names.add(i)) };
            let min = if minimums_ft.is_null() { None } else { known(*minimums_ft.add(i)) };
            (name.unwrap_or("").to_owned(), min)
        })
        .collect();
    give(lost_comms::lost_comms_json(&segments, known(assigned_ft), known(expected_ft), expected_from, approach_fix != 0,
                                     text(efc).unwrap_or(""), text(eta).unwrap_or("")))
}

/// The diversion drill (ACS PA.VI.C) in the leg's air the phone has (true
/// airspeed, burn, variation east positive, the wind from, true, and its
/// speed; calm 0 and 0) to a field `distance_nm` away on `tc_deg`, JSON
/// {"solved", "steps", "problem", "checks"} as the planner's
/// /api/diversion has them; `to` the field's ident for the problem's
/// words; the student's estimates NAN where not given.
///
/// # Safety
/// `to` NULL or NUL-terminated.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn wt_diversion(tc_deg: f64, distance_nm: f64, tas_kt: f64, fuel_burn_gph: f64, magnetic_variation_deg: f64,
                                      wind_from_deg: f64, wind_kt: f64, to: *const c_char, mh: f64, gs: f64, ete: f64,
                                      fuel: f64) -> *mut c_char {
    let air = diversion::Air { tas_kt, fuel_burn_gph, magnetic_variation_deg, wind_from_deg, wind_kt };
    give(diversion::diversion_json(&air, tc_deg, distance_nm, text(to).unwrap_or(""), [known(mh), known(gs), known(ete), known(fuel)]))
}

/// A point of the flown track: `t` ms since 1970, `alt_ft` GPS altitude,
/// NAN where the file has none.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct WtTrackPoint {
    pub t: f64,
    pub lat: f64,
    pub lon: f64,
    pub alt_ft: f64,
}

/// A saved flight's checkpoint: `name` and `category` ("departure",
/// "stop", "destination" or its own kind) NUL-terminated; the plan's
/// figures into it NAN where not known.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct WtCheckpoint {
    pub sequence_no: i64,
    pub name: *const c_char,
    pub category: *const c_char,
    pub lat: f64,
    pub lon: f64,
    pub along_track_nm: f64,
    pub true_course_deg: f64,
    pub ete_min: f64,
    pub altitude_ft: f64,
}

/// A flight debriefed against its flown track (ACS PA.VI.A), as the
/// planner's /api/debrief answers, JSON {"debrief": marked or null,
/// "tolerances"}: `point_count` points (any order; put in time order
/// here), `checkpoint_count` checkpoints, and the fields' pattern
/// altitudes, ft MSL, `pattern_idents[i]` at `pattern_ft[i]`, for
/// `pattern_count` fields (a field with none is not graded). NULL where
/// fewer than two checkpoints are given.
///
/// # Safety
/// Each array holds its count of entries (or is NULL with a count of 0),
/// every string NUL-terminated, all alive for the call.
#[no_mangle]
pub unsafe extern "C" fn wt_debrief(points: *const WtTrackPoint, point_count: usize, checkpoints: *const WtCheckpoint,
                                    checkpoint_count: usize, pattern_idents: *const *const c_char, pattern_ft: *const f64,
                                    pattern_count: usize) -> *mut c_char {
    if checkpoints.is_null() || checkpoint_count < 2 {
        return std::ptr::null_mut();
    }
    let track: Vec<debrief::Point> = if points.is_null() {
        Vec::new()
    } else {
        std::slice::from_raw_parts(points, point_count)
            .iter()
            .map(|p| debrief::Point { t: p.t, lat: p.lat, lon: p.lon, alt_ft: known(p.alt_ft) })
            .collect()
    };
    let cps: Vec<debrief::Checkpoint> = std::slice::from_raw_parts(checkpoints, checkpoint_count)
        .iter()
        .map(|c| debrief::Checkpoint {
            sequence_no: c.sequence_no,
            name: text(c.name).unwrap_or("").to_owned(),
            category: text(c.category).unwrap_or("").to_owned(),
            lat: c.lat,
            lon: c.lon,
            along_track_nm: c.along_track_nm,
            true_course_deg: known(c.true_course_deg),
            ete_min: known(c.ete_min),
            altitude_ft: known(c.altitude_ft),
        })
        .collect();
    let patterns: Vec<(String, f64)> = if pattern_idents.is_null() || pattern_ft.is_null() {
        Vec::new()
    } else {
        (0..pattern_count)
            .filter_map(|i| Some((text(*pattern_idents.add(i))?.to_owned(), known(*pattern_ft.add(i))?)))
            .collect()
    };
    give(debrief::answer_json(&cps, &track, &patterns))
}
