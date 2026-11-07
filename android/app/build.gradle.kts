import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// The native Android app (docs/NATIVE-ANDROID.md): Jetpack Compose and
// Material 3 over the same planner and gateway the website uses, with the
// shared Rust engine (native/engine) linked in through a C shim
// (src/main/cpp). Nothing of the owner's is kept here: the host and the
// package name come in from outside, as the shell's build takes them.
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    // Room's compiler (records/Records.kt) runs through KSP.
    alias(libs.plugins.ksp)
}

/// The site's host: the gateway's address and the app's App Links domain,
/// from the WINGTIP_HOST the workflow passes (the repo's WINGTIP_URL's
/// host), else the site itself.
val wingtipHost: String =
    (System.getenv("WINGTIP_HOST") ?: providers.gradleProperty("wingtipHost").orNull ?: "")
        .trim().ifEmpty { "wingtipmaps.app" }

/// The app's package name on the phone and on Google Play. Not the
/// shell's (app.wingtipmaps.android), so a tester can have both installed
/// while this one is judged against the plan's gates.
val appId: String =
    (System.getenv("ANDROID_NATIVE_APP_ID") ?: providers.gradleProperty("androidNativeAppId").orNull ?: "")
        .trim().ifEmpty { "app.wingtipmaps.android.native" }

android {
    namespace = "app.wingtipmaps.android"
    compileSdk = 36

    defaultConfig {
        applicationId = appId
        // Android 8.0: the adaptive launcher icon, Java 8's time API and
        // the notification channels the later phases want, all without
        // the support library's shims.
        minSdk = 26
        targetSdk = 35
        // Google Play wants each upload's version code above the last
        // one's: the workflow's run number, once there is a Play lane.
        versionCode = (System.getenv("ANDROID_VERSION_CODE") ?: "1").toInt()
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // Read by Config at run time, and by the manifest's App Links filter.
        buildConfigField("String", "WINGTIP_HOST", "\"$wingtipHost\"")
        manifestPlaceholders["wingtipHost"] = wingtipHost
        // The ABIs the engine is built for (native/ffi/build-android.sh):
        // the phones Play serves, and the emulator CI tests on.
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64")
        }
    }

    // The JNI shim round the engine's static library (src/main/cpp): one C
    // file, built by the NDK's CMake for each ABI above.
    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
        }
    }

    buildTypes {
        release {
            // No shrinking yet: the app is judged in debug builds until
            // the plan's gates, and R8's keep rules for JNI and
            // serialization are a phase of their own.
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    sourceSets {
        // The shared fixtures of the rules the engine runs
        // (web/src/lib/fixtures): the web's own files, read by its vitest
        // tests, by the iOS tests (ios/project.yml) and by EngineTest here
        // from the instrumented tests' assets, so the engine on an Android
        // phone is held to the same examples as everywhere else, and a
        // copy cannot drift.
        getByName("androidTest") {
            assets.srcDirs("../../web/src/lib/fixtures")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.core)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.okhttp)
    implementation(libs.maplibre)
    implementation(libs.material)
    // The flight pieces: own ship's fixes, the records store, the traffic
    // switch, and the process lifecycle the clock and the notifications read.
    implementation(libs.play.services.location)
    implementation(libs.androidx.core.location.altitude)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.lifecycle.process)
    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)

    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.ext.junit)
}
