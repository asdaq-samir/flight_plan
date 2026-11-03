# native

Wingtip's Rust, in four crates:

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

- The engine also reads an ATC clearance heard into its items and a call
  to us by its call sign (`clearance.rs`, the web's lib/clearance and
  lib/heardCall, held to their fixtures in `web/src/lib/fixtures`), and
  finds the places it names in the phone's kept packs with no signal
  (`spoken.rs`, vfr.spoken's matching): `wt_clearance_hear`.
- The four pilot pages' figures are the engine's too (`figures/`): a
  flight debriefed against its flown track (ACS PA.VI.A), the diversion
  drill (PA.VI.C), a hold's entry and its legs in the wind (AIM 5-3-8)
  and lost communications' altitudes (14 CFR 91.185), with their words.
  app.figures only carries the dicts across; the phones get the
  planner's very answers from `wt_debrief`, `wt_diversion`, `wt_holding`
  and `wt_lost_comms`.
- The Brief's Go / No-Go is the engine's too (`gonogo/`): the seven
  findings and the line over them, the pilot's minimums, icing under IFR,
  the risk assessment and the airplane's airworthiness, the runway check,
  the weight and balance and the pass times (the web's lib/verdict and
  the modules it is fed from). Each is a name in `call.rs`
  (`gonogo_verdict`, `gonogo_risk`, `gonogo_runway_checks` ...), asked by
  the web app (callEngine), the planner's app.gonogo (vfr_native.call)
  and the phones (wt_call).
- `ffi/` (`wingtip-ffi`): the engine's C functions for the phones
  (`ffi/include/wingtip_engine.h`), a static library: the airspace over a
  point from a phone's cycle pack, as the planner's /api/airspace/at
  answers it. A plain C interface rather than UniFFI, whose bindgen
  brings dozens of crates for five functions.
  `ffi/build-xcframework.sh` builds it for the iPhone and the simulator
  into `ios/Frameworks/WingtipEngine.xcframework` (native-ios.yml, on
  GitHub's macOS runner), which the app imports as `WingtipEngine`.

- `wasm/` (`wingtip-wasm`): the engine for the web app, as WebAssembly
  with no wasm-bindgen. Every host asks a rule the same way, by name with
  JSON in and JSON out (`engine/src/call.rs`, which lists the rules and
  their inputs): the browser through `wt_call` in the module
  (`web/src/lib/engine/engine.ts`, `callEngine`), the planner through
  `vfr_native.call`, the phones through `wt_call` in the header. A rule
  moved into the engine needs only a name there. The module's ABI is in
  `wasm/src/lib.rs`. `scripts/build-engine-wasm.sh` builds it in Docker
  (the Rust image pinned by digest, so the bytes are the same anywhere)
  into `web/src/lib/engine/wingtip-engine.wasm`, which is committed, as
  the web build has no Rust; CI's `test` job builds it again and fails
  where it differs. Rebuild and commit it with any change under
  `engine/` or `wasm/`.

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
