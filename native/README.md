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
- Runways, the wind on them and the traffic pattern are the engine's too
  (`runway/`): a wind along and across a runway and the end it favours,
  the runway flown (the pilot's pick, else into the wind, AC 90-66C
  11.5), the pattern's side, entry, exit and altitude, a POH's
  short-field distances and how an end suits the airplane, and the
  pattern's legs on the map and as the planner flies them (the web's
  lib/wind, lib/pattern, lib/runwayFit, lib/takeoffLanding and
  lib/trafficPattern; vfr.runway_wind and vfr.pattern), each a name in
  `call.rs` (`wind_pick`, `runway_end_fit`, `traffic_pattern` ...). The
  Go / No-Go's runway check goes by the same.
- Instrument approaches are the engine's too (`approach/`): a flown
  approach debriefed against its procedure -- the final it flew, full
  scale off the course (AIM 1-1-9, 1-1-17), each fix's altitude (AIM
  5-4-5), the glidepath, the lowest against the pilot's minimums (14 CFR
  91.175(c), (e)), the missed approach or the landing -- and the lesson:
  the briefing, the coached dry run's steps with the descent rate on the
  path (the TPP's table), the side view and the quiz (the web's
  lib/approachDebrief and lib/approachLesson), held to the web's fixture
  `approachKbur.json`, so the iPhone can teach and debrief one offline
  (`approach_find`, `approach_coaching`, `approach_quiz` ... in
  `call.rs`).
- The pilot's own records and text are the engine's too (`pilot/`): a
  checklist typed as text, the logbook to and from a CSV file
  (ForeFlight's export among them, papaparse's reading ported step for
  step), a handbook page's figures read off its photo, and endorsements
  (in force, an instructor's lapsed date under 14 CFR 61.197, the words
  signed, a knowledge test's ACS codes), held to the web's fixtures
  `checklist.json` and `logbookCsv.json`.
- The map's overlays with no network are the engine's too (`view.rs`):
  the Class B, C and D, the landing fields and the VORs inside the map's
  box from the phone's kept packs, each as the planner's in-view endpoint
  answers it (`wt_airspace_in_view`, `wt_airports_in_view`,
  `wt_navaids_in_view`), with what a pack cannot hold -- a live METAR's
  flight category, a navaid's remarks -- answered null or empty.
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
