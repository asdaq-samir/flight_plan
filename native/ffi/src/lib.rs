//! The engine's C functions, for the phones (include/wingtip_engine.h):
//! each takes the pack as a pointer and a length the caller keeps mapped
//! for the call, and a string it returns is the caller's to give back
//! with `wt_string_free`.

use std::ffi::{c_char, CString};
use wingtip_engine::{pack::Pack, phone};

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
