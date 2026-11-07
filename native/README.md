# native

Wingtip's Rust: the engine, over its crates, and its three faces.

The engine is the lowest of the project's four layers: under the planner
(FastAPI, which works out a flight and asks the engine every rule), Spring
Boot (accounts and saved records; it should hold no aviation logic, but the currency rules are still Java) and the apps (web,
iOS, Android, which draw and ask the engine the rest). Every aviation
rule and figure belongs here once; the ones still written in Python,
Java, TypeScript, Swift or Kotlin are listed, in the order they move, in
issue #482.

- `engine/` (`wingtip-engine`): the figures that must come out the same
  wherever they are worked out -- route options' straight lines over the
  grid, whether an airspace volume holds a point, and the cycle pack's
  reader (its format is in `crates/airspace/src/pack.rs`). A facade over
  the domain crates in `crates/` (below): it holds `call.rs`, the one
  dispatcher, and uses each crate's modules at the paths they had when
  the engine was one crate (`wingtip_engine::gonogo`, `::pack` ...), so
  `py/`, `ffi/`, `wasm/` and the tests name them as before. Plain Rust
  with no dependencies but its own crates, so it builds as it is for the phones: aarch64-apple-ios
  (the native iOS app, from Swift) and aarch64-linux-android (the native
  Android app, from Kotlin), both through `ffi/`.
  Keep it that way: no PyO3, no host-only crates, no network, and files
  read from bytes the caller maps.
- `py/` (`wingtip_native`): the engine as wingtip imports it, through PyO3. It
  only carries arrays and mapped files across; every figure is the
  engine's. wingtip imports it at module level, so every image that copies
  src/ builds it: the planner, the pipeline stages and ML, each with
  the same wingtip-native stage as
  docker/Dockerfile.native (tests/test_dockerfiles.py keeps the copies
  the same, so the engine compiles once per bake and comes from cache
  after). A new image that reads src/ needs the stage too.

## The engine's crates

`crates/<name>` (`wingtip-<name>`), each a layer that may use only the
ones under it, so the compiler keeps the direction (geo cannot reach for
the Go / No-Go) and a build or a test can take one area alone
(`cargo test -p wingtip-weather`). The layers come from the modules'
own uses of each other when the engine was one crate; two that use each
other share a crate. Like the engine, none has a dependency outside the
workspace.

| Crate | Modules | Uses |
|---|---|---|
| `geo` | geo, wmm, grid, sums, flight, time, json, xml | nothing |
| `weather` | metar, taf, winds, forecast, validity, notam, tfr | geo |
| `figures` | figures (debrief, diversion, holding, lost comms, words) | geo |
| `radio` | clearance, readback, atis | geo |
| `pilot` | pilot, aircraft | geo |
| `brief` | gonogo, runway | geo, figures |
| `route` | route, motion, approach | geo, figures |
| `airspace` | airspace, pack, rules, phone, view, spoken, ahead | geo, figures, radio |
| `wording` | wording | geo, figures, airspace |
| `engine/` (facade) | call | all of them |

Why these lines:

- `geo` is the ground: distances, magnetic variation, the wind triangle,
  dates and the JSON every rule reads and writes, used by all.
- `figures` sits just above it because its `figures::words` (a number
  written as the web writes it) is shared by the Go / No-Go, runways,
  routes, the airspace rules and the wording.
- `gonogo` and `runway` are one crate, `brief`: the Go / No-Go's runway
  check goes by the runway pick, and the runway rules read their input
  with the Go / No-Go's helpers, so each uses the other.
- `airspace` takes `radio` because `spoken` finds the places a clearance
  names, and `figures` because `rules` writes its figures with
  `figures::words`; `wording` sits on top of it for `rules`' entry rules
  and call types by class.
- `call.rs` names every rule, so it alone stays in the facade, over all.

Inside a crate, the modules under it are used at the root by the names
they had in the one crate (`use wingtip_geo::json;` in its lib.rs), so
the code still reads `crate::json` and the move changed no rule. A new
module goes in the lowest crate whose modules it needs; one that would
need a crate above its own belongs higher, never in a cycle.

## The contract, and adding a rule

Every name in `engine/src/call.rs` has its input and its answer in
`contract/engine.schema.json`, a JSON Schema written from the Rust, with
the AIM, 14 CFR or ACS source of each figure in its descriptions. The
apps' types come from it rather than from hand-written copies: the web's
`web/src/lib/engine/contract.ts` (json-schema-to-typescript, in `npm run
types`), which types `callEngine` by name, so a renamed field fails the
web's typecheck rather than a screen on a phone; and the phones' answer
types for the names they decode (quicktype, through
`scripts/engine-contract-apps.sh`): `ios/Wingtip/Engine/EngineContract.swift`
and
`android/app/src/main/kotlin/app/wingtipmaps/android/engine/EngineContract.kt`.
`engine/tests/contract.rs` holds the schema's names to the dispatcher's
and the shared fixtures' answers to the schema; `contract.test.ts` holds
the generated file to the schema.

A rule goes in this way, each step in the same pull request:

1. The Rust, in the lowest crate whose modules it needs (above), with its
   source cited in a comment.
2. Its name in `engine/src/call.rs`, reading and writing JSON.
3. Its entry in `contract/engine.schema.json`.
4. `npm run types` in `web/`, and `scripts/engine-contract-apps.sh` when
   a phone decodes the answer with a generated type; commit what they
   write.
5. A test against the shared fixtures in `web/src/lib/fixtures`, so the
   web, the phones and the planner are held to the same examples.
6. `scripts/build-engine-wasm.sh`, and the `.wasm` committed; the
   planner's image rebuilt for the Python side.

Then the callers switch to the name and the old copy is deleted.

## The engine's rules

- The engine also reads an ATC clearance heard into its items and a call
  to us by its call sign (`crates/radio`, the web's lib/clearance and
  lib/heardCall, held to their fixtures in `web/src/lib/fixtures`), and
  finds the places it names in the phone's kept packs with no signal
  (`crates/airspace`, wingtip.spoken's matching): `wt_clearance_hear`.
- The four pilot pages' figures are the engine's too (`crates/figures`): a
  flight debriefed against its flown track (ACS PA.VI.A), the diversion
  drill (PA.VI.C), a hold's entry and its legs in the wind (AIM 5-3-8)
  and lost communications' altitudes (14 CFR 91.185), with their words.
  app.figures only carries the dicts across; the phones get the
  planner's very answers from `wt_debrief`, `wt_diversion`, `wt_holding`
  and `wt_lost_comms`.
- The Brief's Go / No-Go is the engine's too (`crates/brief`): the seven
  findings and the line over them, the pilot's minimums, icing under IFR,
  the risk assessment and the airplane's airworthiness, the runway check,
  the weight and balance and the pass times (the web's lib/verdict and
  the modules it is fed from). Each is a name in `call.rs`
  (`gonogo_verdict`, `gonogo_risk`, `gonogo_runway_checks` ...), asked by
  the web app (callEngine), the planner's app.gonogo (wingtip_native.call)
  and the phones (wt_call).
- Runways, the wind on them and the traffic pattern are the engine's too
  (`crates/brief`): a wind along and across a runway and the end it favours,
  the runway flown (the pilot's pick, else into the wind, AC 90-66C
  11.5), the pattern's side, entry, exit and altitude, a POH's
  short-field distances and how an end suits the airplane, and the
  pattern's legs on the map and as the planner flies them (the web's
  lib/wind, lib/pattern, lib/runwayFit, lib/takeoffLanding and
  lib/trafficPattern; wingtip.runway_wind and wingtip.pattern), each a name in
  `call.rs` (`wind_pick`, `runway_end_fit`, `traffic_pattern` ...). The
  Go / No-Go's runway check goes by the same.
- Instrument approaches are the engine's too (`crates/route`): a flown
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
- The pilot's own records and text are the engine's too (`crates/pilot`): a
  checklist typed as text, the logbook to and from a CSV file
  (ForeFlight's export among them, papaparse's reading ported step for
  step), a handbook page's figures read off its photo, and endorsements
  (in force, an instructor's lapsed date under 14 CFR 61.197, the words
  signed, a knowledge test's ACS codes), held to the web's fixtures
  `checklist.json` and `logbookCsv.json`.
- The map's overlays with no network are the engine's too (`crates/airspace`):
  the Class B, C and D, the landing fields and the VORs inside the map's
  box from the phone's kept packs, each as the planner's in-view endpoint
  answers it (`wt_airspace_in_view`, `wt_airports_in_view`,
  `wt_navaids_in_view`), with what a pack cannot hold -- a live METAR's
  flight category, a navaid's remarks -- answered null or empty.
- The planner's own copies are going (#482 phase 0): the airspace column
  and the Mode C veil (`airspace_column`, `mode_c_veil`), an FNS message's
  NOTAMs (`notams_fns`), a report's ceiling and category (`ceiling_ft`,
  `report_flight_category`, `vfr_basic_minimums`), a hazard's window
  (`gonogo_hazard_window`), the reserve, the atmosphere and the descent
  (`reserve_min`, `isa_temp_c`, `descent_ft_per_nm` ...) and a figure in
  the web's words (`words_*`) are asked by name from wingtip and
  app.gonogo, held to the planner's answers from before the move in
  `web/src/lib/fixtures/plannerRules.json`.
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
  `wingtip_native.call`, the phones through `wt_call` in the header. A rule
  moved into the engine needs only a name there. The module's ABI is in
  `wasm/src/lib.rs`. `scripts/build-engine-wasm.sh` builds it in Docker
  (the Rust image pinned by digest, so the bytes are the same anywhere)
  into `web/src/lib/engine/wingtip-engine.wasm`, which is committed, as
  the web build has no Rust; CI's `test` job builds it again and fails
  where it differs. Rebuild and commit it with any change under
  `engine/`, `crates/` or `wasm/`.

The tests share their fixtures with the Python's (`tests/fixtures/native`):

    cargo test --manifest-path native/Cargo.toml -p wingtip-engine   # the facade's tests
    cargo test --manifest-path native/Cargo.toml -p wingtip-brief    # one crate's
    pytest tests/test_native.py   # with the wheel installed

The cycle pack itself is written by `wingtip.pack`, by the planner after its
warm-up once a cycle, to `data/raw/packs/wingtip-<cycle>.pack` (not
committed); the phones' packs of it, one a 4-degree region with the rings
simplified (`wingtip.pack.write_phone`), to `data/raw/packs/phone/<cycle>/`,
served at `/api/cycle-packs` and `/api/cycle-pack/<cycle>/<region>.pack`.
`tests/test_phone_pack.py` holds the engine's answer from them to the
planner's own code; the iOS app's `CyclePackTests` read the Chicago ones
in `tests/fixtures/native/phone`.
