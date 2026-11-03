// The engine's C functions (native/ffi, wingtip_engine.h) for the
// Android app's Kotlin (Engine.kt), through JNI: one way in, wt_call, a
// rule by name with its input as JSON and its answer as JSON, and the
// region a point's pack is named by. In C rather than a Rust JNI crate,
// as native/ffi keeps to a plain C interface: nothing to add to the
// engine's build for a second phone, and nothing the iPhone's shim does
// not do too. A string the engine returns is given back to it with
// wt_string_free either way.
#include <jni.h>
#include <stddef.h>

#include "wingtip_engine.h"

static const char *const ENGINE_EXCEPTION = "app/wingtipmaps/android/engine/EngineException";

// JNI's strings are "modified UTF-8": a character outside the Basic
// Multilingual Plane (an emoji) comes as a surrogate pair's six bytes
// and would go back malformed. The engine's inputs and answers are the
// planner's and the pilot's words -- idents, degrees, the middle dot --
// which are all inside it, so the strings go through as they are.
JNIEXPORT jstring JNICALL
Java_app_wingtipmaps_android_engine_Engine_callNative(JNIEnv *env, jclass cls, jstring name, jstring input)
{
    (void)cls;
    const char *name_c = (*env)->GetStringUTFChars(env, name, NULL);
    if (name_c == NULL) {
        return NULL;  // out of memory: the JVM has thrown already
    }
    const char *input_c = (*env)->GetStringUTFChars(env, input, NULL);
    if (input_c == NULL) {
        (*env)->ReleaseStringUTFChars(env, name, name_c);
        return NULL;
    }
    WtCalled answer = wt_call(name_c, input_c);
    (*env)->ReleaseStringUTFChars(env, input, input_c);
    (*env)->ReleaseStringUTFChars(env, name, name_c);

    jstring out = NULL;
    if (answer.ok == 1 && answer.text != NULL) {
        out = (*env)->NewStringUTF(env, answer.text);
    } else {
        // The engine's own words for what was wrong (a name it has no rule
        // for, an input not of the rule's shape), thrown as
        // EngineException so Engine.call fails the way a Kotlin caller
        // expects. A null text with ok set is an answer that held a NUL,
        // which no rule writes.
        jclass exception = (*env)->FindClass(env, ENGINE_EXCEPTION);
        if (exception != NULL) {
            (*env)->ThrowNew(env, exception, answer.text != NULL ? answer.text : "the engine gave no answer");
        }
    }
    wt_string_free(answer.text);
    return out;
}

// The name of the region whose pack holds a point ("n40w088"), for the
// packs the later phases keep for the air.
JNIEXPORT jstring JNICALL
Java_app_wingtipmaps_android_engine_Engine_regionOf(JNIEnv *env, jclass cls, jdouble lat, jdouble lon)
{
    (void)cls;
    char *region = wt_region_of(lat, lon);
    if (region == NULL) {
        return NULL;
    }
    jstring out = (*env)->NewStringUTF(env, region);
    wt_string_free(region);
    return out;
}

// The packs kept on the phone (engine/Packs.kt, CyclePacks.kt): each
// pack a direct ByteBuffer over its memory-mapped file, read in place
// through GetDirectBufferAddress for the one call and never copied, as
// the iPhone's Data(.alwaysMapped) is. Every function gives the engine's
// JSON back as a String, or null where the engine answered NULL (a byte
// array that is no pack), and frees the engine's string either way, as
// callNative above does.

// One pack's bytes and length; a null buffer is no pack (ptr NULL, len 0).
static const uint8_t *pack_bytes(JNIEnv *env, jobject buffer, size_t *len)
{
    *len = 0;
    if (buffer == NULL) {
        return NULL;
    }
    void *address = (*env)->GetDirectBufferAddress(env, buffer);
    jlong capacity = (*env)->GetDirectBufferCapacity(env, buffer);
    if (address == NULL || capacity <= 0) {
        return NULL;
    }
    *len = (size_t)capacity;
    return (const uint8_t *)address;
}

// The engine's string as a Java one, freed either way.
static jstring taken(JNIEnv *env, char *answer)
{
    if (answer == NULL) {
        return NULL;
    }
    jstring out = (*env)->NewStringUTF(env, answer);
    wt_string_free(answer);
    return out;
}

// The packs of an array, their pointers and lengths written into two
// arrays of the array's length for one of the engine's many-pack
// readers; a pack that is no direct buffer counts as empty, which the
// engine passes over. The arrays are the caller's (sized by the array's
// length, at most a few regions), and the buffers stay referenced by the
// Java array for the whole call.
static jsize pack_array(JNIEnv *env, jobjectArray packs, const uint8_t **ptrs, size_t *lens, jsize most)
{
    jsize count = packs == NULL ? 0 : (*env)->GetArrayLength(env, packs);
    if (count > most) {
        count = most;
    }
    for (jsize i = 0; i < count; i++) {
        jobject buffer = (*env)->GetObjectArrayElement(env, packs, i);
        ptrs[i] = pack_bytes(env, buffer, &lens[i]);
        (*env)->DeleteLocalRef(env, buffer);
    }
    return count;
}

// At most this many packs in one call: a map's box or the regions round
// the airplane name a handful of 4-degree regions, never more than this.
#define WT_MOST_PACKS 64

// wt_pack_verify: 1 every byte as written, 0 not, -1 no pack.
JNIEXPORT jint JNICALL
Java_app_wingtipmaps_android_engine_Packs_verify(JNIEnv *env, jclass cls, jobject pack)
{
    (void)cls;
    size_t len;
    const uint8_t *ptr = pack_bytes(env, pack, &len);
    return (jint)wt_pack_verify(ptr, len);
}

// wt_pack_cycle: the pack's cycle, "YYYY-MM-DD"; null where it is no pack.
JNIEXPORT jstring JNICALL
Java_app_wingtipmaps_android_engine_Packs_cycle(JNIEnv *env, jclass cls, jobject pack)
{
    (void)cls;
    size_t len;
    const uint8_t *ptr = pack_bytes(env, pack, &len);
    return taken(env, wt_pack_cycle(ptr, len));
}

// wt_airspace_at: the airspace over a point as JSON (AirspaceAt), from
// one pack or from the rules alone with a null pack; groundFt NaN where
// not known.
JNIEXPORT jstring JNICALL
Java_app_wingtipmaps_android_engine_Packs_airspaceAt(JNIEnv *env, jclass cls, jobject pack, jdouble lat, jdouble lon,
                                                      jdouble ground_ft)
{
    (void)cls;
    size_t len;
    const uint8_t *ptr = pack_bytes(env, pack, &len);
    return taken(env, wt_airspace_at(ptr, len, lat, lon, ground_ft));
}

// wt_ahead: the alerts ahead as JSON from the packs round the airplane;
// alt_ft NaN where not known, tfrs the kept TFRs a tab-separated line
// each or null, downloaded at tfrs_at (Long.MIN_VALUE not known).
JNIEXPORT jstring JNICALL
Java_app_wingtipmaps_android_engine_Packs_ahead(JNIEnv *env, jclass cls, jobjectArray packs, jdouble lat, jdouble lon,
                                                 jdouble track_deg, jdouble gs_kt, jdouble alt_ft, jdouble vs_fpm, jlong now,
                                                 jstring tfrs, jlong tfrs_at)
{
    (void)cls;
    const uint8_t *ptrs[WT_MOST_PACKS];
    size_t lens[WT_MOST_PACKS];
    jsize count = pack_array(env, packs, ptrs, lens, WT_MOST_PACKS);
    const char *tfrs_c = tfrs == NULL ? NULL : (*env)->GetStringUTFChars(env, tfrs, NULL);
    char *answer = wt_ahead(ptrs, lens, (size_t)count, lat, lon, track_deg, gs_kt, alt_ft, vs_fpm, (int64_t)now, tfrs_c,
                            (int64_t)tfrs_at);
    if (tfrs_c != NULL) {
        (*env)->ReleaseStringUTFChars(env, tfrs, tfrs_c);
    }
    return taken(env, answer);
}

// wt_airspace_in_view: the Class B, C and D reaching into the box, JSON
// (AirspaceInView), from the packs of the regions the box meets.
JNIEXPORT jstring JNICALL
Java_app_wingtipmaps_android_engine_Packs_airspaceInView(JNIEnv *env, jclass cls, jobjectArray packs, jdouble south,
                                                          jdouble west, jdouble north, jdouble east)
{
    (void)cls;
    const uint8_t *ptrs[WT_MOST_PACKS];
    size_t lens[WT_MOST_PACKS];
    jsize count = pack_array(env, packs, ptrs, lens, WT_MOST_PACKS);
    return taken(env, wt_airspace_in_view(ptrs, lens, (size_t)count, south, west, north, east));
}

// wt_airports_in_view: the landing fields in the box, biggest first, JSON
// (AirportsInView).
JNIEXPORT jstring JNICALL
Java_app_wingtipmaps_android_engine_Packs_airportsInView(JNIEnv *env, jclass cls, jobjectArray packs, jdouble south,
                                                          jdouble west, jdouble north, jdouble east)
{
    (void)cls;
    const uint8_t *ptrs[WT_MOST_PACKS];
    size_t lens[WT_MOST_PACKS];
    jsize count = pack_array(env, packs, ptrs, lens, WT_MOST_PACKS);
    return taken(env, wt_airports_in_view(ptrs, lens, (size_t)count, south, west, north, east));
}

// wt_navaids_in_view: the VORs in the box by ident, JSON (NavaidsInView).
JNIEXPORT jstring JNICALL
Java_app_wingtipmaps_android_engine_Packs_navaidsInView(JNIEnv *env, jclass cls, jobjectArray packs, jdouble south,
                                                         jdouble west, jdouble north, jdouble east)
{
    (void)cls;
    const uint8_t *ptrs[WT_MOST_PACKS];
    size_t lens[WT_MOST_PACKS];
    jsize count = pack_array(env, packs, ptrs, lens, WT_MOST_PACKS);
    return taken(env, wt_navaids_in_view(ptrs, lens, (size_t)count, south, west, north, east));
}
