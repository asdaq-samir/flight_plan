# The native iOS app

Wingtip Maps as a pure SwiftUI app (`ios/`), with no web view: the same
planner and gateway as the website, and only the screens on the phone.
The plan, its phases and gates are in the owner's doc "Native iOS
Transition Plan" (24 October 2026). It is the iOS app: the Capacitor
shell that wrapped the website went on 2026-11-06, at the owner's word
("native only, delete the wrappers"). The Android twin, the same engine behind Compose and MapLibre,
is docs/NATIVE-ANDROID.md.

## What is here

- `ios/project.yml`: the Xcode project, made by XcodeGen on the runner.
  Nothing under `ios/` is a generated file; the project is never
  committed.
- `ios/Wingtip/API`: the planner's and the gateway's calls, with the
  answers' shapes as Codable by hand (`Models.swift`), in the document's
  own names. Apple's swift-openapi-generator was tried first (24 October)
  and left out every property FastAPI gives as `anyOf` string and null,
  which is most of them, so the generated client was taken out again. A
  model lists only the properties a screen shows; add one when a screen
  needs it, from `planning-service/openapi.json`.
- `ios/Wingtip`: the app. `Config` (the host), `Session` (who is signed
  in), `Charts` (which chart, from `/api/chart`, kept for offline),
  `Tiles` (the tile address, the store on disk, the MapKit overlay) and
  `Views` (the map under the system sheet with the four tabs).
- `ios/WingtipTests`: Swift Testing.

## Rules

- A rule the pilot needs offline in flight is computed on the phone by
  the shared engine (`native/engine`), the same Rust the web app and the
  planner run, asked by name through `Engine.call` (`wt_call`;
  `native/engine/src/call.rs` lists every name, and
  `native/contract/engine.schema.json` types each input and answer). An
  answer the app decodes can use a type generated from that contract,
  `ios/Wingtip/Engine/EngineContract.swift` (`scripts/engine-contract-apps.sh`,
  committed), rather than a Decodable written by hand; callers move over
  one name at a time. The Swift keeps the words and the formatting, not
  the rule, and each screen's state is one observable model the view
  draws. This app is one of the four layers native/README.md describes:
  the planner works out the flight, the gateway (Spring Boot) holds the
  pilot's account and records, and the engine answers every rule. The shared fixtures
  in `web/src/lib/fixtures` are read by the web's vitest tests and by
  `ios/WingtipTests/SharedFixturesTests.swift` (project.yml bundles the
  folder into the test target by its path, not a copy), and
  `BridgeFixturesTests.swift` holds the engine's raw JSON answers to
  them through the phone's own bridge (`Engine.callText` over
  `wt_call`), so a bridge that changes a key, a number, a null or a
  character fails CI though the Rust and web tests pass. The few rules still
  in Swift are in the table below with their fixtures; issue #482 moves
  them into the engine. Every other figure
  comes from the planner; the app shows the server's answer, with its
  date when offline.
- The ACS table (`AcsTable`) is the web's own `web/src/lib/acs.json`,
  bundled by project.yml as `acs.json`.
- Judge every screen on the phone against Apple's Human Interface
  Guidelines first, as CLAUDE.md says for the web app; here the system's
  own controls give the 44-point hit areas, the type scale and the glass.
- The app's words are the web app's words ("airplane", the FAA's
  sentence-cased text with its codes kept).

## The rules on the phone, and their fixtures

| Rule | Web (the reference) | On the phone | Fixture |
|---|---|---|---|
| A pilot's hold as the planner reads it, its legs' minutes by altitude (wingtip.holds; AIM 5-3-8 j.4(a)) | `lib/holds.ts`, `lib/holding.ts` `legMinutes` | the engine: `hold_read`, `hold_write`, `holding_leg_minutes` (`Hold`) | `holds.json` |
| A hold's entry and wind, lost comms' altitudes (AIM 5-3-8; 14 CFR 91.185) | the planner's /api/holding, /api/lost-comms | the engine: `holding`, `lost_comms` (`Engine.holding`, `Engine.lostComms`) | the engine's own tests |
| The route's procedures, a fix off a point, a fix's charted altitudes | `lib/procedures.ts`, `lib/identSchema.ts` | the engine: `procedures_write`, `frd_read`, `frd_write`, `altitude_lines` | the engine's own tests |
| The airplane's checklist written as text | `lib/checklist.ts` | the engine: `checklist_read`, `checklist_write` (`ChecklistText`) | `checklist.json` |
| Flash-card drills: light gun signals (14 CFR 91.125), VFR weather minimums (91.155), Leitner's boxes | `lib/drills.ts` | Swift: `Drills` in `PilotLogic.swift` | `drills.json` |
| Two-way radio failure, the route and when to leave the clearance limit (14 CFR 91.185(c)(1), (c)(3)) | `lib/lostComms.ts` | Swift: `LostComms` in `PilotLogic.swift` | `lostComms.json` |
| Flight plan items 15 and 16 (AIM Appendix 4; 14 CFR 91.121(a)(2)) | `lib/flightPlanForm.ts` | Swift: `FilingForm` in `Views/InFlightViews.swift` | `filingForm.json` |
| Traffic's label and the 1,000 ft "near" (14 CFR 91.159's spacing) | `lib/map/traffic.ts` | the engine: `traffic_marks` (`Traffic.marks`) | `traffic.json` |
| A watched airplane in the air, a takeoff or landing watch going off | `lib/aircraftAlerts.ts` | the engine: `airborne_now`, `alert_fires` (`Tracking`) | the engine's own tests |
| The dry run, and a GPX or KML track read | `navlog/dryRun.ts`, `lib/track.ts` | the engine: `dry_run`, `read_track`, `thin_track` (`DryRun`, `GPXTrack`) | the engine's own tests |
| The logbook as CSV, out and in (ForeFlight Logbook Guide v14.0; 61.57(a), (b)) | `lib/logbookCsv.ts` | the engine: `csv_rows`, `logbook_csv_read`, `logbook_csv_write` (`LogbookCSV`) | `logbookCsv.json` |
| Endorsements' words, the lapse warning (61.197), those in force, ACS codes; a handbook page's figures | `lib/endorsements.ts`, `lib/checkride.ts`, `lib/handbookText.ts` | the engine: `endorsement_render`, `endorsement_lapse`, `endorsements_in_force`, `acs_codes`, `handbook_figures` | the engine's own tests |
| Runway numbers and calm winds (AIM 7-1-28); the FAA's words, airspace names, special-use limits, frequencies, fuel | `lib/pattern.ts`, `lib/wind.ts`, `lib/advisories.ts`, `lib/frequencies.ts`, `lib/airspace.ts`, `lib/stopServices.ts` | the engine: `gonogo_runway_number`, `runway_calm`, `wind_calm`, `faa_words`, `title_case`, `short_airspace_name`, `sua_altitudes`, `frequency_line`, `fuel_names` (`AirportWords`) | the engine's own tests |
| An ATC clearance heard, read into its items and the route it gives (AIM 4-4-3, 5-2-6; figures AIM 4-2-8, 4-2-9) | `lib/clearance.ts` | the engine: `read_clearance`, `cleared_route` (`Clearance`) | `clearances.json` |
| An ATIS or AWOS/ASOS broadcast heard, read into its figures (AIM 4-1-13, 7-1-11; JO 7110.65 2-6-6, 2-7-2) | `lib/atis.ts` | the engine: `read_atis` (`Atis`) | `atis.json` |
| A transmission said to us by its call sign, and where its "direct" sends us (AIM 4-2-4) | `lib/heardCall.ts` | the engine: `our_call`, `direct_of` (`HeardCall`) | `heardCalls.json` |
| A clearance's places found with no signal, among the kept regions' airports, navaids and fixes (the planner's wingtip.spoken) | `wingtip/spoken.py` | the engine's `spoken.rs` (`Engine.hear` on `CyclePacks.keptPacks`) | the engine's own tests, test_spoken.py's cases |

Where the Swift copies still differ, the fixtures leave the case out:

- `FilingForm.hhmm` takes whole minutes, where the web's `hhmmForm`
  rounds a fraction first -- whole minutes are fine, the owner said
  (2026-10-28); the route item files no departure or arrival
  procedure from the phone yet.

## The words, with no signal

The Brief's "The weather in words" and the Go / No-Go's "The flight in
words" (`Wingtip/Words/`) are a few plain sentences over the figures,
each with the chips of the figures it rests on; a chip opens the report
as sent. Every figure is the engine's or the planner's; a model only
writes the sentences, and never a figure of its own:

- `WordsFor` asks the planner first (`PlannerWords`: `POST
  /api/words/{weather,risk}` through the gateway's proxy, Claude on the
  planner, app.words), then this iPhone when the planner fails or
  cannot be reached (`OnDeviceWords`: Apple's on-device model,
  FoundationModels on iOS 26 with Apple Intelligence on), and says why
  in plain words when neither can (an older iOS, the model still
  downloading, no signal and no planner). The caption over the
  sentences says which wrote them ("From the planner", "On this
  iPhone").
- The figures go to the device's model as compact JSON of `{id, label,
  text}` (`WordsFigures`), with the planner's own ids (`metar:KMSN`,
  `taf:KMSN`, `hazard:0`, `tfr:<notam id>`, `finding:fuel`,
  `risk:<factor>`), so a chip means the same thing whichever model
  wrote the sentence. The instructions forbid any figure not in the
  input.
- Every sentence is checked on the phone (`Words.checked`, the
  planner's app.words.checked again): one citing an id it was not
  given, or nothing, is dropped, since a model can cite wrongly, and
  at most ten are kept. `WingtipTests/WordsTests` holds the order of
  the providers and the guard.
- Every use of FoundationModels sits behind `#if
  canImport(FoundationModels)` and `#available(iOS 26, *)`, so the app
  builds on an older SDK and runs on iOS 18 without the words.

## Apple's guidance, and where the app stands

Apple names no architecture; for SwiftUI it asks for a declarative data
flow: views as values of state, state owned once in `@Observable`
models and handed down through the environment, the models asking the
rules (here the engine) for the rest. The app follows that, and these
pieces close the gaps a review against Apple's guidance found (the
owner, 2026-11-03):

- **App Intents** (`Wingtip/Intents/`): plan a trip to a place, the
  nearest airports, the weather at a field and direct to a place, as
  Siri, Shortcuts and Spotlight phrases (`WingtipShortcuts`). The airport
  is an App Entity (`AirportEntity`: the kept route's, the Favorites and
  the Recents suggested, the planner's search behind them), so "Plan a
  trip to KLAS in Wingtip Maps" goes in one breath. An intent that needs
  the app sets `PendingCommand`, which `RootView` applies.
- **Home Screen widgets** (`WingtipWidgets/FlightWidgets.swift`,
  `Wingtip/WidgetFeed.swift`, `Wingtip/Shared/WidgetSnapshot.swift`): the
  next flight's route, figures, Go / No-Go and departure weather on the
  Home Screen and the Lock Screen, from a snapshot the app writes to the
  App Group (`group.app.wingtipmaps`) only as it changes, so the widget
  never asks the planner and never spends its redraw budget idly.
- **Universal links and files** (`Wingtip/Intents/Links.swift`): a route,
  a field or an airplane shared from the site (`/app/plan?dep=…&dest=…`,
  `?place=`, `?flight=`) opens in the app as a `PendingCommand`, and a GPX
  or KML track from Files or Mail is flown again on the map (the document
  types in project.yml). The sign-in link stays `Session.open`'s.
- **A Live Activity** (`Wingtip/FlightActivity.swift`, the
  `WingtipWidgets` extension, `Wingtip/Shared/FlightActivityAttributes`):
  a flight in progress on the Lock Screen and in the Dynamic Island with
  the next checkpoint, the ETA and the fuel, from the dry run or own ship
  under way with a routed plan.
- **The privacy manifest** (`Wingtip/PrivacyInfo.xcprivacy`): what is
  collected and the required-reason APIs used; the session is cookies in
  `HTTPCookieStorage`, and `UserDefaults` holds no secret.
- **Strict concurrency** (`SWIFT_STRICT_CONCURRENCY: complete` in
  project.yml): the compiler's data-race checks as warnings under Swift 5
  mode; the language mode goes to 6 once a runner's log is clean.
- **A string catalog** (`Wingtip/Localizable.xcstrings`,
  `SWIFT_EMIT_LOC_STRINGS`): every `Text` gathered at build, so a second
  language is a column, not a rewrite.
- **Scene restoration**: the tab a scene was on comes back with it
  (`@SceneStorage` in `RootView`).
- **A UI smoke test** (`WingtipUITests/LaunchTests`): the app launched
  and its first screen shown, run by the runner with the unit tests.
- **Time-sensitive notifications** (`Wingtip/Notifications.swift`): a
  call to us on the radio, traffic near own ship and a watched
  airplane's takeoff or landing, told at Apple's time-sensitive level
  only while the app is not in front (on the screen the banner, the
  amber mark or the haptics say it), with permission asked in the
  moment the pilot first asks for one. The entitlement is in
  project.yml.

## The Apple Watch app

`ios/WingtipWatch/` (the owner's ask, 2026-11-03) is a companion of the
iOS app, bundle id `app.wingtipmaps.ios.watchkitapp`, watchOS 10 and
later, embedded in the phone's app and installed with it: three pages,
Timers (a flight timer and a hold/approach timer, each a `Stopwatch`
worked out from the clock at each draw under a `TimelineView`, so it is
right when the display wakes), Checklist (the picked airplane's sections
and items, ticked on the wrist, a section reset by a swipe) and Nearest
(the fields nearest the watch's own fix, or the phone's).

The watch links no engine (the XCFramework has no watchOS slice) and
calls no server. The phone (`Wingtip/WatchLink.swift`) sends the
airplane's checklist, as the gateway gave it, and the pilot's fix as the
WatchConnectivity application context, and answers the watch's nearest
question from the planner (`Planner.nearest`; the cycle packs give the
airspace at a point only, so offline the watch is told the planner is
out of reach). Every message is a small Codable struct in
`Wingtip/Shared/WatchMessages.swift`, compiled into both apps and
round-tripped in `WingtipWatchTests`. No complication yet.

The workflow does not build the watch scheme yet: the `Wingtip` scheme
builds the watch app as the embedded companion, and `WingtipWatch`'s
tests need a watch simulator paired with the iPhone one, picked as a
pair (`xcrun simctl list pairs`) and given as `-destination
"platform=watchOS Simulator,id=…"`. In the developer account the watch
app needs its own app id (`app.wingtipmaps.ios.watchkitapp`) and a
provisioning profile beside the phone's for TestFlight.

Still open, as decisions rather than code: the app on the phone is the
web app in a web view until this one is the product; local records
(plan history, kept airplanes, watches) in SwiftData with iCloud sync
are the other session's batch.

## Speed, and how it is measured

The owner's ask (2026-11-03) for a fast app with no workarounds, done in
these places:

- **Tiles** (`Tiles/ChartTileOverlay`, `TileStore`, `KeepRoute`): the
  overlay draws 512-point tiles composed from four of the pyramid's
  256-pixel tiles, so a 3x screen scales a tile 1.5 times instead of 3
  and needs about 18 of them instead of 55; a composed tile is kept in
  memory (`TileCache`, 64 MB) in front of the disk store and the network,
  concurrent loads of one tile are coalesced, and a kept route's tiles
  bring their parents one and two levels up, so a zoom out is answered
  from the phone. Each load is a signpost (`app.wingtipmaps.ios`, `tiles`).
- **Marks** (`Views/ChartMap`, `Views/AirportMarks`): the airports'
  annotations cluster and carry display priorities by the field's size
  and airspace, so MapKit drops overlaps rather than drawing them; the
  checkpoints' annotations are diffed, not removed and re-added.
- **The map's data from the packs** (`PackMapData`): the airports,
  airspace and navaids in view are asked of the engine's pack readers
  first and of the planner only where no pack answers, so in flight the
  map draws with no signal.
- **Answers cached** (`API/Gateway`): the session keeps a URL cache
  sized for a flight, honouring the planner's and the gateway's
  Cache-Control, so a view come back to is answered from the phone.
- **Measured**: `WingtipTests/PerformanceTests` keeps clock and memory
  figures for the engine's readers and the map's decoding on the runner,
  and `Metrics` subscribes to MetricKit, so launch, hang, battery and
  crash reports come from real phones into the system log.

## Building

The owner's Mac cannot run a current Xcode, so everything happens in
`.github/workflows/native-ios.yml` on GitHub's macOS runner (free for a
public repository):

- a pull request, a push to `main` or to a `claude/native-*` branch that
  touches `ios/`, the web files the app bundles (`web/src/lib/fixtures`,
  `web/src/lib/acs.json`) or the workflow: XcodeGen, then `xcodebuild test` on
  the newest iPhone simulator the runner has and on an iPad (a Pro
  where there is one), for the iPad's own layout, with a picture of
  each one's first screen kept with the run (`native-ios-screens`);
- on `main`, with the App Store Connect key the owner sets (below), the
  app is archived and uploaded to TestFlight.

`WINGTIP_HOST` is the build's host (the repo variable `WINGTIP_URL`'s);
it is the gateway's address and the app's associated domain.

## What only the owner can do, for TestFlight

1. **Join the Apple Developer Program** ($99 a year) and note the Team
   ID (Membership details).
2. **Choose the bundle id**, e.g. `app.wingtipmaps.ios`; it cannot change
   once the app is in App Store Connect.
3. **Create the app in App Store Connect** (My Apps → +): the name, the
   bundle id (register it under Identifiers first, with the Associated
   Domains and Sign in with Apple capabilities), a SKU.
4. **Create an App Store Connect API key** (Users and Access →
   Integrations → App Store Connect API, role App Manager) and download
   its `.p8` once.
5. **In GitHub** (Settings → Secrets and variables → Actions):
   - variables `APPLE_TEAM_ID`, `IOS_BUNDLE_ID`, `APP_STORE_KEY_ID`,
     `APP_STORE_ISSUER_ID`, and `WINGTIP_URL`
     (`https://<the domain>/app/plan`);
   - the secret `APP_STORE_KEY_P8`, the `.p8` file's contents.
6. **On the server**, add `APPLE_TEAM_ID` and `APP_IOS_BUNDLE_ID` to the
   stack's AppSecret (`infra/server/env.example`) and run `deploy.sh`,
   so the site names the app for its links and accepts its Apple
   sign-in.
7. **TestFlight:** add yourself as an internal tester. The next push to
   `main` that changes the app (or Run workflow on Native iOS) uploads a
   build; it appears in TestFlight after Apple processes it.
