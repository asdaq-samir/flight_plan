# CI

What runs, when, and how to move it onto the owner's Mac mini.

## What runs

| When | What | About |
|---|---|---|
| A pull request, and main's push after a merge | The unit tests of whatever the change touched (web, Python, Rust, Java), the dependency review, and the browser suite's smoke tests: the ~33 tests tagged `@smoke`, one per journey a pilot takes, on the phone, in one job against the whole stack | 4-5 min |
| A pull request that changes only docs, Markdown, the skills or notebooks | The unit tests it touched; no browser suite | 1-2 min |
| Every night, or Run workflow on CI | Everything: every browser test on the phone, desktop, the iPhones and the iPad, the iOS audit, WCAG and Lighthouse, over ten shards; and the API reference docs built | ~15 min |
| A change to `ios/` or `android/` | Native iOS: built and tested on a simulator. Native Android: unit tests, lint and an APK; its emulator tests run every night | 5-10 min |

The Python suites keep the FAA's reference files (`data/raw`) between
runs, a week at a time, rather than fetching them each run: the planner's
suite was 131 s with them fetched (#452) and 159 s in one run (#474),
against 11 s warm. The planner's cache holds the charts and their tiles
(`charts.nosync`, `chart_tiles.nosync`) too, since its first plans of
C81 -> KDLH read the corridor's sectional tiles: 185 s of a 215 s run
with the charts left out. The other jobs keep the charts in a cache of
their own, so this one is separate (`tests-raw-planner-v2-`).

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

## API compatibility

The iPhone app in the App Store keeps calling the servers for months
after each release, from every phone that has not updated. So a pull
request that changes `planning-service/openapi.json` or
`springboot-app/openapi.json` runs `api-compat` ("API compatibility"):
[oasdiff](https://github.com/oasdiff/oasdiff)'s `breaking` check, its
Docker image pinned by digest, compares each document with main's and
fails on an ERR-level break -- an endpoint, a response field or an enum
value removed or renamed, a request parameter or field made required, a
type narrowed. Adding a field or an endpoint passes. It takes seconds,
runs only when a document changed, and is one of the jobs "CI passed"
waits on.

Prefer the additive change: a new field or endpoint beside the old one,
and the old one removed only once no released app calls it. When a
break is meant, the pull request adds a line for each change to
`.github/api-breaks.txt` (oasdiff's `--err-ignore` file): the date, the
method and path, and oasdiff's words for the change as the failure
printed them -- with backticks round the names, as oasdiff writes them in
its ignore matching (single quotes do not match) -- for example

```
2026-11-06 GET /api/briefing removed the required property `hazards` from the response with the `200` status -- no released app reads it
```

The lines stay after the merge, as the record of what was broken when.
To see the breaks before pushing:

```sh
git show origin/main:planning-service/openapi.json > /tmp/base.json
docker run --rm -v /tmp:/base -v "$PWD:/head" tufin/oasdiff:v1.34.1 \
  breaking /base/base.json /head/planning-service/openapi.json --format singleline
```

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
