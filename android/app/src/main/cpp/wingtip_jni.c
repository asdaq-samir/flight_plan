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
