//! The engine for the web app, as WebAssembly (wasm32-unknown-unknown):
//! one way in, `wt_call`, a rule by name with its input and answer JSON
//! (wingtip_engine::call), so the browser asks the very code the planner
//! and the phones do. Built by scripts/build-engine-wasm.sh into
//! web/src/lib/engine/wingtip-engine.wasm; web/src/lib/engine/engine.ts
//! is the JavaScript side.
//!
//! The ABI, all in the module's own memory (`memory`, exported):
//!
//! - `wt_alloc(len) -> ptr`: room for `len` bytes, for the caller to write
//!   the name and the input into (UTF-8);
//! - `wt_free(ptr, len)`: gives that room back;
//! - `wt_call(name_ptr, name_len, input_ptr, input_len) -> ptr`: the rule
//!   worked; `ptr` points at an answer laid out as a little-endian u32
//!   status (0 the rule's JSON, 1 an error in words), a little-endian u32
//!   byte length, then that many bytes of UTF-8. The name and the input
//!   are only read, and stay the caller's to free;
//! - `wt_result_free(ptr)`: gives the answer back.
//!
//! A panic in the engine aborts the call (a WebAssembly trap, which
//! JavaScript sees as a RuntimeError) rather than unwinding: the target
//! has no unwinding, and the engine answers bad input with an error, not
//! a panic.

use wingtip_engine::call::call;

/// The answer's header: status and length, each a u32.
const HEAD: usize = 8;

#[no_mangle]
pub extern "C" fn wt_alloc(len: usize) -> *mut u8 {
    let mut room = Vec::<u8>::with_capacity(len);
    let ptr = room.as_mut_ptr();
    std::mem::forget(room);
    ptr
}

/// # Safety
/// `ptr` and `len` are as wt_alloc gave them, and not freed before.
#[no_mangle]
pub unsafe extern "C" fn wt_free(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len));
}

/// # Safety
/// `name_ptr` and `input_ptr` point at `name_len` and `input_len` bytes
/// of the module's memory (as wt_alloc gave them, or any other bytes the
/// caller owns), alive for the call.
#[no_mangle]
pub unsafe extern "C" fn wt_call(name_ptr: *const u8, name_len: usize, input_ptr: *const u8, input_len: usize) -> *mut u8 {
    let text = |ptr: *const u8, len: usize| {
        let bytes = if len == 0 { &[][..] } else { std::slice::from_raw_parts(ptr, len) };
        std::str::from_utf8(bytes).map_err(|_| "the name and the input are UTF-8".to_owned())
    };
    let answer = text(name_ptr, name_len).and_then(|name| call(name, text(input_ptr, input_len)?));
    let (status, body) = match answer {
        Ok(json) => (0u32, json),
        Err(why) => (1u32, why),
    };
    let mut out = Vec::with_capacity(HEAD + body.len());
    out.extend_from_slice(&status.to_le_bytes());
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(body.as_bytes());
    // Exactly HEAD + len long, so wt_result_free can rebuild it from the
    // length in its header.
    Box::into_raw(out.into_boxed_slice()) as *mut u8
}

/// # Safety
/// `ptr` is as wt_call gave it, and not freed before.
#[no_mangle]
pub unsafe extern "C" fn wt_result_free(ptr: *mut u8) {
    let mut len = [0u8; 4];
    len.copy_from_slice(std::slice::from_raw_parts(ptr.add(4), 4));
    let total = HEAD + u32::from_le_bytes(len) as usize;
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, total)));
}
