---
name: ship
description: Commit, push and land a change in this repo. Covers which branch, what never to stage, how a commit message here reads, pulling before a push, the auto-merge path to main, and following CI through the public API until the change is merged. Use whenever committing, pushing or opening a pull request, and when CI fails.
---

# Ship

A change is shipped when it is merged to `main` with CI green. Until then, say exactly where it stands.

## 1. Before committing
- **Branch:** `maps-layout` (the owner's) or `claude/<topic>` (yours). Never commit to `main`, never force-push, never tag a commit.
- **Verified:** run the `checks` skill for everything the change touched. A green run against a stale image or a container that loaded old code is not evidence.

## 2. Stage by name
```sh
git add <path> <path>
git status --short && git diff --cached --stat
```
- Never `git add -A` or `git add .`.
- Never stage `data/labels/` or `data/processed/`. They hold the owner's ratings and features, changed locally on purpose.
- Never stage `.env`, `infra/local-https/certs/`, `data/raw/` or anything else the user keeps locally.
- If generated files changed (OpenAPI documents, `web/src/lib/api/*.d.ts`), commit them with the change that caused them.

## 3. The message
One paragraph, in plain sentences:
- what changed for the pilot or the developer;
- why;
- the evidence: the tests run, with counts, and any measurement, with its numbers and how it was taken.

Write "airplane". Read `git log -3 --format=%B` first to match the voice. End with the Co-Authored-By trailer.

## 4. Push
```sh
git pull --no-rebase origin maps-layout && git push origin maps-layout
```
Always pull first: Sync merges `main` back into `maps-layout` and may have added a commit. A push to `maps-layout` opens or updates its pull request to `main` with auto-merge on (auto-merge.yml). `claude/*` branches go through auto-merge-agents.yml. Either one merges by itself once the "CI passed" check is green. Nothing merges red.

## 5. Follow CI
- **One push at a time when it matters.** ci.yml cancels the running CI on the same branch when a new push arrives, and the cancelled run's path-filtered jobs (image builds, pdoc) never run again. If a push touched `src/`, a requirements file or a Dockerfile, wait for its run to finish before pushing again.
- **In CI,** `gh` is installed and signed in, so use `gh run view`, `gh pr checks` and the rest.
- **On the owner's Mac there's no `gh` CLI.** Use the public API with `curl`, once a minute: it allows 60 requests an hour unauthenticated. Don't use Python's `urllib`, because the host's Python has no CA bundle.
  ```sh
  curl -s "https://api.github.com/repos/asdaq-samir/flight_plan/actions/runs?head_sha=$(git rev-parse HEAD)"   # the run
  curl -s "https://api.github.com/repos/asdaq-samir/flight_plan/actions/runs/<run id>/jobs"                       # its jobs
  curl -s "https://api.github.com/repos/asdaq-samir/flight_plan/check-runs/<job id>/annotations"                 # why one failed
  ```
- **Read the annotations before guessing.** test-webapp turns each failing Java test into an annotation, and e2e posts one per failed test plus the planner's data and log. Job logs themselves need authentication.
- **Rerunning a failed job** needs the GitHub login that git keeps in the keychain (`git credential fill`): `POST /actions/runs/<id>/rerun-failed-jobs`. The user has allowed this. Never print the token.
- **Pull requests opened by github-actions[bot]** leave their runs at "action_required". Approve them with `POST /actions/runs/<id>/approve`.
- **The Claude review job** isn't part of the "CI passed" gate. When it fails for lack of API credit, that is the user's to top up, not a reason to hold the merge.

## 6. Report
Give the commit, the PR, CI's result per job, and whether it merged. If something is still running or failed, say which and what you did about it.
