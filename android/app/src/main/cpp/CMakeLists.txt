# The JNI shim round the engine (wingtip_jni.c), one shared library the
# app loads (Engine.kt), with the engine's static library linked in for
# the ABI being built. The engine comes from native/ffi/build-android.sh,
# which puts each ABI's libwingtip_ffi.a and the header under app/engine/
# (not committed; the workflow builds it first).
cmake_minimum_required(VERSION 3.22.1)
project(wingtip_jni C)

set(ENGINE ${CMAKE_SOURCE_DIR}/../../../engine)

add_library(wingtip_ffi STATIC IMPORTED)
set_target_properties(wingtip_ffi PROPERTIES
    IMPORTED_LOCATION ${ENGINE}/${ANDROID_ABI}/libwingtip_ffi.a
    INTERFACE_INCLUDE_DIRECTORIES ${ENGINE}/include)

add_library(wingtip_jni SHARED wingtip_jni.c)
# A Rust static library carries no record of the system libraries its
# standard library calls (what `--print native-static-libs` lists for
# Android: log, dl, m, and libunwind, which the NDK's clang links by
# itself), so they are named here.
target_link_libraries(wingtip_jni wingtip_ffi log dl m)
