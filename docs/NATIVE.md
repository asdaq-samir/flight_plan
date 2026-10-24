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
- `ios/Packages/WingtipAPI`: the planner's Swift client, generated as the
  package builds by Apple's swift-openapi-generator from
  `planning-service/openapi.json` (a symlink into the repo, so the
  document and the client cannot drift). `openapi-generator-config.yaml`
  lists the paths generated; add one when a screen needs it. The
  gateway's few account calls are written by hand (`API/Gateway.swift`):
  its document answers `*/*`, which the generator would hand over raw.
- `ios/Wingtip`: the app. `Config` (the host), `Session` (who is signed
  in), `Charts` (which chart, from `/api/chart`, kept for offline),
  `Tiles` (the tile address, the store on disk, the MapKit overlay) and
  `Views` (the map under the system sheet with the four tabs).
- `ios/WingtipTests`: Swift Testing.

## Rules

- No aviation figure is computed on the phone. Every rule stays in the
  planner; the app shows the server's answer, with its date when offline.
- Judge every screen on the phone against Apple's Human Interface
  Guidelines first, as CLAUDE.md says for the web app; here the system's
  own controls give the 44-point hit areas, the type scale and the glass.
- The app's words are the web app's words ("airplane", the FAA's
  sentence-cased text with its codes kept).

## Building

The owner's Mac cannot run a current Xcode, so everything happens in
`.github/workflows/native-ios.yml` on GitHub's macOS runner (free for a
public repository):

- a pull request or a push to `main` that touches `ios/`, the planner's
  OpenAPI document or the workflow: XcodeGen, then `xcodebuild test` on
  the newest iPhone simulator the runner has;
- the step "The generated planner client's operations" prints the
  generated client's method names, so a call can be written right
  without an Xcode of one's own (the planner's operation ids, in
  lower camel case: `chart_info_api_chart_get` is `chartInfoApiChartGet`);
- on `main`, with the App Store Connect key the owner sets as docs/IOS.md
  lists (the same variables and secret as the shell's), the app is
  archived and uploaded to TestFlight.

`WINGTIP_HOST` is the build's host (the repo variable `WINGTIP_URL`'s);
it is the gateway's address and the app's associated domain.
