# The native Android app

Wingtip Maps, a flight planner for pilots, VFR and IFR, as a Jetpack
Compose app (`android/`), with no web view and no Capacitor: the same
planner and gateway as the website, the same Rust engine as the iOS app
(docs/NATIVE.md) and the web app, and only the screens on the phone. The
owner's decision of 3 November 2026 ("make android native as well"); the
phases and gates are the iOS plan's. The Capacitor shell (`web/android`,
docs/ANDROID.md) stays the Play Store app until this one passes the
plan's last gate, and the two install side by side: this one's package
is `app.wingtipmaps.android.native`.

## What is here

- `android/`: a Gradle project of one module, `app`, in the Kotlin DSL,
  every version in the catalog `gradle/libs.versions.toml`. The wrapper
  is the shell's (Gradle 8.14.3).
- `app/src/main/cpp`: the JNI shim round the engine, in C
  (`wingtip_jni.c`), and the CMake file that links the engine's static
  library for each ABI. The engine itself is built by
  `native/ffi/build-android.sh` into `app/engine/` (not committed; the
  twin of `build-xcframework.sh`).
- `app/src/main/kotlin/app/wingtipmaps/android`:
  - `engine/Engine.kt`: the engine's one way in, `Engine.call(name,
    input)` (`wt_call`), with `EngineException` for the engine's own
    words when it refuses;
  - `api/`: the data layer. `Gateway` (the session's cookies, kept by
    `CookieStore`; the CSRF header; a cache the servers' Cache-Control
    fills), `Planner` (the planner through the gateway's proxy),
    `Models.kt` (the answers' shapes, by hand, in the document's names
    through `@SerialName`), `NavLog.kt` (the nav log's streamed lines);
  - `Charts`, `Session`, `Plan`: the models of state, ViewModels with
    their state in flows (which chart, who is signed in, the route and
    what the planner said of it), and `Links` (the site's links the app
    opens);
  - `tiles/TileTemplate.kt`: the tile address, the web app's and the iOS
    app's;
  - `map/ChartMap.kt`: the chart on MapLibre, and the route's line;
  - `ui/`: Material 3 screens. `RootScreen` (the map under a bottom
    sheet with the four tabs: FPL, Airport, Aircraft, Setup, and the
    figures' strip at the sheet's foot), one file per tab, `Theme` and
    `Figures` (the strip, the problem line, the figures' formatting).
- `app/src/test`: JUnit, on the JVM. `app/src/androidTest`: on an
  emulator, with the web's shared fixtures as the test APK's assets.

## Rules

- A rule the pilot needs offline in flight is computed on the phone by
  the shared engine (`native/engine`), the same Rust the web app, the
  planner and the iOS app run, asked by name through `Engine.call`
  (`native/engine/src/call.rs` lists every name and its input). The
  Kotlin keeps the words and the formatting, not the rule. Every other
  figure comes from the planner; the app shows the server's answer and
  computes none of its own.
- The shared fixtures in `web/src/lib/fixtures` are the test APK's
  assets by their path (`build.gradle.kts`'s `androidTest` source set),
  not a copy: `EngineTest` holds the engine on an Android phone to the
  same examples the web's vitest tests and the iOS tests read, through
  this app's own bridge, so a bridge that mangles a string or a number
  fails CI.
- Material 3 and Google's guide to app architecture: a UI layer of
  composables reading state from ViewModels, with changes flowing one
  way (a screen calls a model's function; the model changes its state;
  the screen draws it); a data layer (`Gateway`, `Planner`) that is the
  only thing talking to the servers; and the engine as the domain, the
  rules. Material's own components over hand-rolled ones -- the bottom
  sheet, the tab row, the exposed dropdown -- so touch targets, type and
  motion are the platform's. A discrete setting is a menu, not a slider.
  The phone's own colours on Android 12 and later (Material You).
- The app's words are the web app's words ("airplane", the FAA's
  sentence-cased text with its codes kept); a problem is said where it
  happened, in the call's own words, not in a toast.

## Why MapLibre

The map is MapLibre Native (`org.maplibre.gl:android-sdk`): the open
native map, with no API key, no account and no vendor's usage terms,
which is why it draws the chart rather than Google Maps. The style is
empty but for one raster source over the FAA chart's tiles
(`TileTemplate`) and the route's line: the chart is the whole picture,
as it is on the website, and no vendor's base map lies under it. Its
tiles go through the app's own OkHttp client, so a tile through the
gateway carries the session's cookie and every tile is kept in the one
cache.

## Building

The owner's Mac has no Java, Gradle, Android SDK or cargo, so everything
happens in `.github/workflows/native-android.yml` on GitHub's Linux
runner:

- a pull request, a push to `main` or to a `claude/native-*` branch that
  touches `android/`, the engine (`native/engine`, `native/ffi`), the
  shared fixtures or the workflow: the engine is built for the three
  ABIs (`native/ffi/build-android.sh`), then
  `testDebugUnitTest lintDebug assembleDebug`, with the debug APK kept
  with the run (`wingtip-native-debug-apk`: it installs on any Android
  phone with "Install unknown apps" allowed), then
  `connectedDebugAndroidTest` on an API 35 x86_64 emulator
  (reactivecircus/android-emulator-runner).
- No Google Play lane yet: the shell's (android.yml) stays until the
  gates.

`WINGTIP_HOST` is the build's host (the repo variable `WINGTIP_URL`'s);
it is the gateway's address and the App Links domain in the manifest.
`ANDROID_NATIVE_APP_ID` would be the package name, once there is a Play
lane for it.

## What phase 0 leaves out

Own ship and the location permission, the chart kept for the air (the
tile store, the route's tiles, the cycle packs), traffic, the briefing,
the checkpoints and the side view, the altitude wheel, the airplane by
N-number, widgets, and the brand's own launcher icon: the launcher shows
a plain airplane until `docs/brand/android-*.svg` are made vector
drawables.
