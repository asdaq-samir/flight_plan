# Wingtip Maps — for agents

A VFR flight planner for pilots: the FAA chart on a map that works like
Maps on an iPhone, and the route, checkpoints and nav log for a flight.
It is headed for an iOS app. README.md has the services and the layout.

## Branches

- Work goes on `maps-layout` (the owner's) or a `claude/` branch (yours),
  in a pull request to `main`.
- Both merge by themselves once the "CI passed" check is green
  (auto-merge.yml, auto-merge-agents.yml); nothing merges red. After main
  moves, Sync merges it back into maps-layout.
- Never push to `main`. Never force-push. Pull before pushing to
  maps-layout: Sync may have added a merge.
- Every week the Audit workflow checks design, code, speed and aviation,
  and once a month the market, the launch and the marketing. It opens
  `claude/audit-*` pull requests, and issues labelled "audit".
- An issue is "ready" (no decision left for the owner; Build, build.yml,
  takes one a day) or "owner" (the owner decides, then labels it
  "ready"). Only the owner takes "owner" off. Plan (plan.yml) keeps the
  Roadmap issue, whose Now list Build follows, and a weekly digest.
- On a `claude/` pull request, Claude's review is put right on the branch
  ("Address review:" commits) and a CI failure is fixed ("Fix CI:"), each
  at most twice.
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
| `springboot-app/` | `mvn -B test` (needs Docker, for Testcontainers) |
| other services | `ruff check app tests && pytest tests/` in that service |

Python wants `pip install -r requirements-dev.txt` in that directory first.

An API that changes changes its document, which the web app's types come
from: `python -m app.openapi` in planning-service, or `WRITE_OPENAPI=1 mvn
-B test` in springboot-app; then `npm run types` in web; commit all three.

The browser tests (Playwright, `web/e2e`) need the whole stack and run in
CI; write or update the spec for a change a pilot sees, and let CI run it.

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
