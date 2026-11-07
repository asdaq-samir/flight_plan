# CI

What runs, when, and how to move it onto the owner's Mac mini.

## What runs

| When | What | About |
|---|---|---|
| A pull request, and main's push after a merge | The unit tests of whatever the change touched (web, Python, Rust, Java), the dependency review, and the browser suite's smoke tests: the ~33 tests tagged `@smoke`, one per journey a pilot takes, on the phone, in one job against the whole stack | 4-5 min |
| A pull request that changes only docs, Markdown, the skills or notebooks | The unit tests it touched; no browser suite | 1-2 min |
| Every night, or Run workflow on CI | Everything: every browser test on the phone, desktop, the iPhones and the iPad, the iOS audit, WCAG and Lighthouse, over ten shards; and the API reference docs built | ~15 min |
| A pull request that touches a phone app (below) | Inside CI's run, so "CI passed" waits for it: Native Android (the engine per ABI, unit tests, lint, a debug APK) and/or Native iOS (XcodeGen, `xcodebuild test` on the simulators) | 5-10 min |
| main's push that touches a phone app, a `claude/native-*` push | Native Android / Native iOS on their own (`native-android.yml`, `native-ios.yml`); TestFlight after iOS on main once its key is set | 5-10 min |
| Every night | Native Android again, then its instrumented tests on an emulator | ~15 min |

## What gates a merge

main's ruleset requires one check, **CI passed** (the `passed` job in
`ci.yml`), and `auto-merge-agents.yml` merges a pull request on it. It
waits for every job in CI's run and fails if any failed or was
cancelled; a job its paths did not need is skipped, which counts as
passing.

The phone builds are among those jobs. They used to be workflows of
their own beside CI, which the ruleset could not require (a
path-filtered workflow stays pending on every pull request it skips), so
#499 merged with the Android app not compiling (fixed in #501). Now
their build is a reusable workflow -- `native-android-build.yml`,
`native-ios-test.yml` -- that `ci.yml` calls as the `android` and `ios`
jobs when its `changes` job finds the pull request touches what the app
builds from:

- **Android:** `android/**` (its generated API models included),
  `native/**`, `web/src/lib/fixtures/**`, `scripts/api-models-apps.*`,
  `native-android-build.yml`.
- **iOS:** `ios/**` (its API models included), `native/**`,
  `web/src/lib/fixtures/**`, `web/src/lib/acs.json`,
  `tests/fixtures/native/**`, `scripts/api-models-apps.*`,
  `native-ios-test.yml`.
- **Both:** a change to `ci.yml` itself, or anything in its `global`
  filter, as for every other job.

Any other pull request skips them and keeps its 4-5 minutes. They are
called on pull requests and on a run of CI started by hand; main's pushes
and the nights run them in `native-android.yml` and `native-ios.yml`
instead, so they are not built twice there. Each of those two keeps its
own concurrency group; a pull request's builds run in CI's.

The iOS job runs on `MAC_RUNNER` (the Mac mini, free) or else GitHub's
macOS runner: free while the repository is public, ten times a Linux
minute's price on a private one, about 5 to 10 macOS minutes for each
pull request that touches the iPhone app, the engine or the shared
fixtures.

The Python suites keep the FAA's reference files (`data/raw`) between
runs, a week at a time, rather than fetching them each run: the planner's
suite was 131 s with them fetched (#452) and 159 s in one run (#474),
against 11 s warm. The planner's cache holds the charts and their tiles
(`charts.nosync`, `chart_tiles.nosync`) too, since its first plans of
C81 -> KDLH read the corridor's sectional tiles: 185 s of a 215 s run
with the charts left out. The other jobs keep the charts in a cache of
their own, so this one is separate (`tests-raw-planner-v2-`).

A pull request merges once "CI passed" is green; Claude's review no
longer gates it and runs only when the "review" label is put on the pull
request (the owner, 2026-11-06), so agents run the checks that cover their
change, and the aviation-check skill, before pushing.

Promote tags the images after main's push is green. A nightly failure is
said in its run and does not hold Promote.

A test belongs in the smoke set (`{ tag: "@smoke" }` on the `test(...)`)
when it is the one that proves a journey works end to end -- planning a
route, the nav log, the map, the brief, sign-in -- and is fast. Everything
else runs at night.

Run the smoke set locally against the running stack:

```sh
npx playwright test --project=mobile --grep @smoke
```

(34 passed in 52 s on the Mac mini, 2026-11-06.)

## Where it runs

Most jobs' machine comes from a repository variable, so moving them is a
setting, not a change to the workflows:

- `LINUX_RUNNER`: the Linux jobs (default `ubuntu-26.04`, GitHub's)
- `MAC_RUNNER`: Native iOS (default GitHub's macOS runner)

Some jobs always run on GitHub's `ubuntu-26.04`, whatever the variable
says, because the Mac mini is Apple silicon and they need x86: `e2e`,
`e2e-images` and `build-images` (the images go to AWS's t3 machines, and
e2e tests those same images), Native Android (the SDK's Linux tools and
emulator are x86 only), and Promote (it builds and pushes for AWS).

A private repository pays for GitHub's runners by the minute (3,000 a
month on Pro, macOS at ten times the rate), and `dependency-review` skips
itself there, since it needs Advanced Security. The rest run on the Mac
mini for free:

- **Linux jobs (`mini-linux`):** a Lima VM, `wingtip-ci`, running Ubuntu
  with its own Docker and the runners. It must be a VM, not a container:
  the jobs use `sudo`, `localhost` and `--network host` as on GitHub's
  machines, and their ports would otherwise meet the live stack's.
- **iOS (`mini`):** a runner on the Mac itself, which has Xcode, rustup
  and xcodegen (in `~/.local/bin`; no Homebrew, no sudo).
- Then **Settings → Secrets and variables → Actions → Variables:** set
  `LINUX_RUNNER` to `mini-linux` and `MAC_RUNNER` to `mini`.

Unset the variables to go back to GitHub's runners. Only once the
repository is private: on a public one any fork's pull request could run
its code on the Mac.
