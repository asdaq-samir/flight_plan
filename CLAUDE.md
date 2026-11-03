# Wingtip Maps — for agents

A flight planner for pilots, VFR and IFR: the FAA chart on a map that works like
Maps on an iPhone, and the route, checkpoints and nav log for a flight.
It is headed for an iOS app. README.md has the services and the layout.

## Architecture

Functional core, imperative shell: one core every app shares, and a thin
shell per app round it (the owner, 2026-11-03).

- **The core is the Rust engine** (`native/engine`, wingtip-engine). Every
  aviation rule or figure lives there once: altitudes, winds, runways,
  fuel, weather limits, Go / No-Go, holds, procedures, the clearance
  reader, currency, the debrief. No network, no screen, no clock of its
  own. Each rule is a name in `native/engine/src/call.rs`, JSON in and out.
- **Each app is a shell that gets data, keeps state and draws**, and asks
  the engine the rest by name: the web through `callEngine`
  (web/src/lib/engine, the engine built to WebAssembly), the planner
  through `vfr_native.call`, the iPhone through `wt_call`. A rule found in
  a component, a hook, a Swift view or a route handler is a bug: move it
  into the engine and delete the copy.
- **Screens are view and view model** (MVVM): the view draws, one hook (web)
  or observable model (iOS) per screen holds its state and makes its
  calls. How a figure is written on the screen stays with each app.
- **Data comes in at the edges**: the planner's endpoints and the cycle
  packs feed the engine; the engine never fetches.
- Changing a rule: the engine, its test against the shared fixtures
  (web/src/lib/fixtures), `scripts/build-engine-wasm.sh` (the `.wasm` is
  committed and CI checks it matches), and the planner's image rebuilt.

## Branches

- Work goes on `maps-layout` (the owner's) or a `claude/` branch (yours),
  in a pull request to `main`.
- Both merge by themselves once the "CI passed" check is green
  (auto-merge.yml, auto-merge-agents.yml); nothing merges red. After main
  moves, Sync merges it back into maps-layout.
- Never push to `main`. Never force-push. Pull before pushing to
  maps-layout: Sync may have added a merge.
- Write to GitHub gently, as the `ship` skill says: one write at a time,
  ten seconds apart, a long list as one issue's checklist. A burst of API
  writes got the owner's account suspended in October 2026.
- Every week the Audit workflow checks design, code, speed and aviation,
  and once a month the market, the launch and the marketing. It opens
  `claude/audit-*` pull requests, and issues labelled "audit".
- An issue is "ready" (no decision left for the owner; Build, build.yml,
  takes one a day) or "owner" (the owner decides, then labels it
  "ready"). Only the owner takes "owner" off. Plan (plan.yml) keeps the
  Roadmap issue, whose Now list Build follows, and a weekly digest.
- On a `claude/` pull request, Claude's review is put right on the branch
  ("Address review:" commits) and a CI failure is fixed ("Fix CI:"), each
  at most twice. It is set to merge only once that review has run.
- Every night the AI check (ai-check.yml) asks for one real checkpoint
  description and one real briefing, and opens a "ready" issue if either
  comes back empty, cut off or malformed. Every week Cleanup deletes the
  `claude/` branches whose pull request is done.
- How to check, ship, review and audit: the skills in `.claude/skills`.

## Never

- Commit anything under `data/labels/` or `data/processed/`: the owner's
  ratings and features live there, changed locally on purpose. Stage
  paths by name, never `git add -A` or `git add .`.
- Edit `planning-service/app/detection.py` (a kept read is hashed against it).
- Tag a commit.
- Move a panel or a control to another part of the screen without the
  owner saying so in the issue.

## Checks — run what covers your change

| Changed | Run, from that directory |
|---|---|
| `web/` | `npm run types && npx tsc --noEmit && npx eslint . && npx vitest run` |
| `planning-service/` | `ruff check app tests && pytest tests/` |
| `src/vfr`, `tests/` | `ruff check src/vfr tests && pytest tests/` (repo root) |
| `native/` (Rust, `vfr_native`) | `maturin build -m native/Cargo.toml` and install the wheel, then `pytest tests/test_native.py` (repo root); the planner's image builds it, and the planner won't start without it |
| `springboot-app/` | `mvn -B test` (needs Docker, for Testcontainers) |
| other services | `ruff check app tests && pytest tests/` in that service |
| `ios/` (the native app) | CI only: `native-ios.yml` makes the project with XcodeGen and runs `xcodebuild test` on the macOS runner (docs/NATIVE.md) |
| `android/` (the native app) | CI only: `native-android.yml` builds the engine for each ABI, runs the unit tests, lint and a debug APK, then the instrumented tests on an emulator (docs/NATIVE-ANDROID.md) |

Python wants `pip install -r requirements-dev.txt` in that directory first.

An API that changes changes its document, which the web app's types come
from: `python -m app.openapi` in planning-service, or `WRITE_OPENAPI=1 mvn
-B test` in springboot-app; then `npm run types` in web; commit all three.

The browser tests (Playwright, `web/e2e`) need the whole stack and run in
CI; write or update the spec for a change a pilot sees, and let CI run it.
On the owner's Mac run only the specs a change touches, and every browser
run, image build and measurement through `scripts/one-at-a-time.sh`, so
sessions sharing the Mac take turns (the `checks` skill).

## The app on the phone

Judge every screen at an iPhone's width against Apple's Human Interface
Guidelines first.

- Hit areas are 44 points, but controls never grow to get there: a
  pseudo-element (`after:absolute after:-inset-…`) makes the area, and
  rows sit at `gap-2` so the areas meet.
- Stock components (shadcn/ui, Radix) over hand-rolled ones.
- Tappable things are the blue tint; type sizes come from `lib/text.ts`.
- Panels are Liquid Glass sheets with detents, like Apple Maps.
- Errors show where they happen (`lib/problems`), not in a toast.
- Discrete settings are menus or segmented controls, not sliders.

## Aviation

Every figure and rule the code states or computes — altitudes, clearances,
weather minimums, airspace — must be right and say where it comes from
(14 CFR part and section, the AIM paragraph, the FAA data set) in a
comment. A wrong one is a safety problem, not a style one.

## Writing

- Comments say why, in plain sentences, as the code around them does.
- The app's words say "airplane", the FAA's word, and set the FAA's own
  capitalised text in sentence case with its codes kept
  (`lib/advisories` `faaWords`); raw reports stay as sent.
- A commit message is a paragraph: what changed for the pilot or the
  developer, and why, with the evidence (a test, a measurement).
