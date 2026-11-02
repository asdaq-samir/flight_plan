//! The engine's C functions, for the phones (include/wingtip_engine.h):
//! each takes the pack as a pointer and a length the caller keeps mapped
//! for the call, and a string it returns is the caller's to give back
//! with `wt_string_free`.

use std::ffi::{c_char, CString};
use wingtip_engine::{flight, pack::Pack, phone, validity, wmm};

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
