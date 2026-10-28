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

- A rule the pilot needs offline in flight is computed on the phone too,
  in the app's own Swift copy of the web app's, and each such copy is
  checked against a shared fixture: one JSON file of example inputs and
  the outputs the web's implementation gives, in `web/src/lib/fixtures`,
  read both by the web's vitest test beside the module and by
  `ios/WingtipTests/SharedFixturesTests.swift` (project.yml bundles the
  folder into the test target by its path, not a copy), so a copy that
  drifts fails CI. A change to the rule changes the web, the fixture and
  the Swift together. Every other figure comes from the planner; the app
  shows the server's answer, with its date when offline.
- The ACS table (`AcsTable`) is the web's own `web/src/lib/acs.json`,
  bundled by project.yml as `acs.json`.
- Judge every screen on the phone against Apple's Human Interface
  Guidelines first, as CLAUDE.md says for the web app; here the system's
  own controls give the 44-point hit areas, the type scale and the glass.
- The app's words are the web app's words ("airplane", the FAA's
  sentence-cased text with its codes kept).

## The rules on the phone, and their fixtures

| Rule | Web (the reference) | Swift copy | Fixture |
|---|---|---|---|
| A pilot's hold as the planner reads it, its legs' minutes by altitude (vfr.holds; AIM 5-3-8 j.4(a)) | `lib/holds.ts`, `lib/holding.ts` `legMinutes` | `Hold` in `RouteEdits.swift` | `holds.json` |
| The airplane's checklist written as text | `lib/checklist.ts` | `ChecklistText` in `PilotLogic.swift` | `checklist.json` |
| Flash-card drills: light gun signals (14 CFR 91.125), VFR weather minimums (91.155), Leitner's boxes | `lib/drills.ts` | `Drills` in `PilotLogic.swift` | `drills.json` |
| Two-way radio failure, the route and when to leave the clearance limit (14 CFR 91.185(c)(1), (c)(3)) | `lib/lostComms.ts` | `LostComms` in `PilotLogic.swift` | `lostComms.json` |
| Flight plan items 15 and 16 (AIM Appendix 4; 14 CFR 91.121(a)(2)) | `lib/flightPlanForm.ts` | `FilingForm` in `Views/InFlightViews.swift` | `filingForm.json` |
| Traffic's label and the 1,000 ft "near" (14 CFR 91.159's spacing) | `lib/map/traffic.ts` | `Traffic.label`, `Traffic.near` | `traffic.json` |
| The logbook as CSV, out and in (ForeFlight Logbook Guide v14.0; 61.57(a), (b)) | `lib/logbookCsv.ts` | `LogbookCSV` in `PilotLogic.swift` | `logbookCsv.json` |

Where the copies still differ, the fixtures leave the case out:

- Traffic's label with own ship's height unknown, for an airplane under
  50 ft below sea level. (Against own ship both now cut the hundreds
  toward it, the owner's conservative pick, 2026-10-28.)
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
