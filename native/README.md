# native

Wingtip's Rust, in two crates:

- `engine/` (`wingtip-engine`): the figures that must come out the same
  wherever they are worked out -- route options' straight lines over the
  grid, whether an airspace volume holds a point, and the cycle pack's
  reader (its format is in `engine/src/pack.rs`). Plain Rust with no
  dependencies, so it builds as it is for the phones: aarch64-apple-ios
  (the native iOS app, from Swift) and aarch64-linux-android (the Android
  shell, a Capacitor plugin from Kotlin, later), both through `ffi/`.
  Keep it that way: no PyO3, no host-only crates, no network, and files
  read from bytes the caller maps.
- `py/` (`vfr_native`): the engine as vfr imports it, through PyO3. It
  only carries arrays and mapped files across; every figure is the
  engine's. The planner's image builds it (planning-service/Dockerfile)
  and cannot start without it.

- `ffi/` (`wingtip-ffi`): the engine's C functions for the phones
  (`ffi/include/wingtip_engine.h`), a static library: the airspace over a
  point from a phone's cycle pack, as the planner's /api/airspace/at
  answers it. A plain C interface rather than UniFFI, whose bindgen
  brings dozens of crates for five functions.
  `ffi/build-xcframework.sh` builds it for the iPhone and the simulator
  into `ios/Frameworks/WingtipEngine.xcframework` (native-ios.yml, on
  GitHub's macOS runner), which the app imports as `WingtipEngine`.

The tests share their fixtures with the Python's (`tests/fixtures/native`):

    cargo test --manifest-path native/Cargo.toml -p wingtip-engine
    pytest tests/test_native.py   # with the wheel installed

The cycle pack itself is written by `vfr.pack`, by the planner after its
warm-up once a cycle, to `data/raw/packs/wingtip-<cycle>.pack` (not
committed); the phones' packs of it, one a 4-degree region with the rings
simplified (`vfr.pack.write_phone`), to `data/raw/packs/phone/<cycle>/`,
served at `/api/cycle-packs` and `/api/cycle-pack/<cycle>/<region>.pack`.
`tests/test_phone_pack.py` holds the engine's answer from them to the
planner's own code; the iOS app's `CyclePackTests` read the Chicago ones
in `tests/fixtures/native/phone`.
