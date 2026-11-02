# native

Wingtip's Rust, in two crates:

- `engine/` (`wingtip-engine`): the figures that must come out the same
  wherever they are worked out -- route options' straight lines over the
  grid, whether an airspace volume holds a point, and the cycle pack's
  reader (its format is in `engine/src/pack.rs`). Plain Rust with no
  dependencies, so it builds as it is for the phones: aarch64-apple-ios
  (the native iOS app, from Swift) and aarch64-linux-android (the Android
  shell, a Capacitor plugin from Kotlin), both later through UniFFI.
  Keep it that way: no PyO3, no host-only crates, no network, and files
  read from bytes the caller maps.
- `py/` (`vfr_native`): the engine as vfr imports it, through PyO3. It
  only carries arrays and mapped files across; every figure is the
  engine's. The planner's image builds it (planning-service/Dockerfile)
  and cannot start without it.

The tests share their fixtures with the Python's (`tests/fixtures/native`):

    cargo test --manifest-path native/Cargo.toml -p wingtip-engine
    pytest tests/test_native.py   # with the wheel installed

The cycle pack itself is written by `vfr.pack`, by the planner after its
warm-up once a cycle, to `data/raw/packs/wingtip-<cycle>.pack` (not
committed).
