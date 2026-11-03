# The native iOS app

Wingtip Maps as a pure SwiftUI app (`ios/`), with no web view: the same
planner and gateway as the website, and only the screens on the phone.
The plan, its phases and gates are in the owner's doc "Native iOS
Transition Plan" (24 October 2026). The Capacitor shell (`web/ios`,
docs/IOS.md) stays the App Store app until this one passes the plan's
last gate.

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
  `native/engine/src/call.rs` lists every name and its input). The Swift
  keeps the words and the formatting, not the rule. The shared fixtures
  in `web/src/lib/fixtures` are read by the web's vitest tests and by
  `ios/WingtipTests/SharedFixturesTests.swift` (project.yml bundles the
  folder into the test target by its path, not a copy), which now hold
  the engine to them through the phone's own bridge. The few rules still
  in Swift are in the table below with their fixtures. Every other figure
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
| A pilot's hold as the planner reads it, its legs' minutes by altitude (vfr.holds; AIM 5-3-8 j.4(a)) | `lib/holds.ts`, `lib/holding.ts` `legMinutes` | the engine: `hold_read`, `hold_write`, `holding_leg_minutes` (`Hold`) | `holds.json` |
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
| A transmission said to us by its call sign, and where its "direct" sends us (AIM 4-2-4) | `lib/heardCall.ts` | the engine: `our_call`, `direct_of` (`HeardCall`) | `heardCalls.json` |
| A clearance's places found with no signal, among the kept regions' airports, navaids and fixes (the planner's vfr.spoken) | `vfr/spoken.py` | the engine's `spoken.rs` (`Engine.hear` on `CyclePacks.keptPacks`) | the engine's own tests, test_spoken.py's cases |

Where the Swift copies still differ, the fixtures leave the case out:

- `FilingForm.hhmm` takes whole minutes, where the web's `hhmmForm`
  rounds a fraction first -- whole minutes are fine, the owner said
  (2026-10-28); the route item files no departure or arrival
  procedure from the phone yet.

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
- on `main`, with the App Store Connect key the owner sets as docs/IOS.md
  lists (the same variables and secret as the shell's), the app is
  archived and uploaded to TestFlight.

`WINGTIP_HOST` is the build's host (the repo variable `WINGTIP_URL`'s);
it is the gateway's address and the app's associated domain.
