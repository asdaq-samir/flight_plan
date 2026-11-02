//! The engine's C functions, for the phones (include/wingtip_engine.h):
//! each takes the pack as a pointer and a length the caller keeps mapped
//! for the call, and a string it returns is the caller's to give back
//! with `wt_string_free`.

use std::ffi::{c_char, CStr, CString};
use wingtip_engine::{clearance::Route, pack::Pack, phone, spoken};

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
