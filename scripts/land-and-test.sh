#!/usr/bin/env bash
# Land a fix on the phone first, test it after, with one build: the live
# stack's own (web-build's vite --watch). No second build of my own -- two
# builds and the stack in Docker's 6 GB got one killed (exit 137), and the
# specs ran on the old bundle without a word (2026-10-22, the owner waited
# 30 minutes).
#
#   land-and-test.sh check           type check the worktree (tsc, ~75 s)
#   land-and-test.sh land            check, fast-forward claude/live, wait
#                                    for the phone's bundle, say when it is
#                                    there
#   land-and-test.sh specs <spec...> run specs on that same bundle, once landed
#
# The specs need the bundle served (serve.mjs, beside this script) in a
# container named fp-serve-traffic on port 4173, passing the API to the
# stack's webapp, and a Playwright config of the Mac's own,
# web/e2e/.local.config.ts, which is never committed.
set -euo pipefail
# The checkouts, set for the Mac at hand: the stack's (claude/live, which
# web-build's vite --watch builds for the phone), the worktree landed from
# (claude/one-point-menu), and where the specs' copy of the phone's bundle
# goes. Defaults are the MacBook's layout (2026-11-05); the Mac mini sets
# its own in the environment.
LIVE=${LIVE:-$HOME/Developer/flight_plan-live}
WT=${WT:-$HOME/Developer/flight_plan-brief3}
OUT=${OUT:-$HOME/Developer/flight_plan-traffic/web/dist-traffic}
REPO_SCRIPTS=$WT/scripts
# Whether web-build is between builds: vite --watch drops a change made
# while it builds (2026-10-23, a touch at 03:56:29 into a build that ended
# at 03:56:39 was never built), so the landed files are touched only then.
idle() {
  local log started done_at
  log=$(docker logs --tail 400 flight_plan-web-build-1 2>&1 || true)
  started=$(printf '%s\n' "$log" | grep -n "build started" | tail -1 | cut -d: -f1 || true)
  done_at=$(printf '%s\n' "$log" | grep -n "files generated" | tail -1 | cut -d: -f1 || true)
  [ -z "$started" ] || { [ -n "$done_at" ] && [ "$done_at" -gt "$started" ]; }
}
touch_landed() {
  git -C "$LIVE" diff --name-only "$before" HEAD -- web/src web/index.html web/public | sed "s|^|$LIVE/|" | xargs touch || true
}

# The worktree's types, before anything reaches the phone: vite builds
# what tsc would refuse, and a name renamed in one place and not another
# (setFootHeight, 2026-11-05) went to the phone as a ReferenceError at
# every settle. Light, so not in one-at-a-time's line: about 75 s in 3 GB.
# Errors in the files this worktree changes stop the landing; another
# session's are said and left to it.
check() {
  local out mine
  out=$(docker run --rm -m 3g -v "$WT":/repo -v "$LIVE/web/node_modules":/repo/web/node_modules:ro -w /repo/web node:26-slim \
    sh -c 'npm run -s types >/dev/null && npx tsc --noEmit -p . --tsBuildInfoFile /tmp/tsc.info' 2>&1 | grep -v "npm notice" || true)
  [ -z "$out" ] && { echo "types: clean"; return 0; }
  # The worktree's files as they are, committed or not, and new ones.
  mine=$({ git -C "$WT" diff --name-only claude/live -- web/src; git -C "$WT" ls-files --others --exclude-standard -- web/src; } | sed 's|^web/||')
  if [ -n "$mine" ] && printf '%s\n' "$out" | grep -qF -f <(printf '%s\n' "$mine"); then
    printf '%s\n' "$out" >&2
    echo "TYPE ERRORS in this worktree's files: not landed" >&2
    return 1
  fi
  printf '%s\n' "$out" | head -20
  echo "types: errors above are in files this worktree didn't change (another session's)"
}

case "${1:-}" in
check)
  git -C "$WT" merge --no-edit -q claude/live
  check
  ;;
land)
  git -C "$WT" merge --no-edit -q claude/live
  check
  before=$(git -C "$LIVE" rev-parse HEAD)
  git -C "$LIVE" merge --ff-only -q claude/one-point-menu
  head=$(git -C "$LIVE" log -1 --format=%h)
  landed=$(date +%s)
  echo "landed $head on claude/live"
  # The planner mounts src: restarted where it changed, and waited for.
  if ! git -C "$LIVE" diff --quiet "$before" HEAD -- src planning-service/app; then
    docker restart flight_plan-planning-service-1 >/dev/null
    warm=""
    for _ in $(seq 1 60); do curl -s localhost:8084/ | grep -q '"warm":true' && { warm=1; break; }; sleep 5; done
    [ -n "$warm" ] || { echo "planner NOT warm after 5 minutes" >&2; exit 1; }
    echo "planner restarted, warm"
  fi
  if git -C "$LIVE" diff --quiet "$before" HEAD -- web/src web/index.html web/public; then
    echo "nothing of the web app's changed: ON THE PHONE now"
    exit 0
  fi
  # web-build's vite --watch: up to 4 minutes (a build is 80-90 s); a
  # build error says so and stops.
  # A build already running as the commit landed can finish after it
  # without it (2026-10-22: abb72073 was said "ON THE PHONE" from a build
  # begun 12 s before its file was written). So only a build begun after
  # the landing counts, and if none has begun in 20 s, the landed web
  # files are touched for vite --watch to build them.
  touched=""
  # 8 minutes: a build is 60 to 90 s, and another session's landing can
  # start one just before ours (the 4 minutes ran out three times on
  # 2026-11-05 with the build on its way).
  for i in $(seq 1 96); do
    sleep 5
    if [ -z "$touched" ] && [ "$i" -ge 4 ] && idle && ! docker logs --since "${landed}" flight_plan-web-build-1 2>&1 | grep -q "build started"; then
      touch_landed
      touched=1
    fi
    if docker logs --since "${landed}" flight_plan-web-build-1 2>&1 | grep -qE "error during build|Build failed|RollupError"; then
      docker logs --since "${landed}" flight_plan-web-build-1 2>&1 | grep -E -m5 -A3 "error during build|Build failed|RollupError"
      # Rolldown's "Unable to get file name for unknown file" comes of a
      # file rewritten mid-build (two sessions landing at once) and a
      # build again clears it (2026-11-05, twice): once, by itself.
      if [ -z "${rebuilt:-}" ]; then
        rebuilt=1
        echo "build failed: building once more" >&2
        for _ in $(seq 1 24); do idle && break; sleep 5; done
        touch_landed
        landed=$(date +%s)
        touched=1
        continue
      fi
      echo "BUILD FAILED: the phone still has the last good bundle" >&2
      exit 1
    fi
    built=$(stat -f %m "$LIVE/web/dist/index.html")
    # The last "build started" since the landing, then "files generated" after it.
    since=$(docker logs --since "${landed}" flight_plan-web-build-1 2>&1 || true)
    started=$(printf '%s\n' "$since" | grep -n "build started" | tail -1 | cut -d: -f1 || true)
    done_at=$(printf '%s\n' "$since" | grep -n "files generated" | tail -1 | cut -d: -f1 || true)
    if [ "$built" -gt "$landed" ] && [ -n "$started" ] && [ -n "$done_at" ] && [ "$done_at" -gt "$started" ]; then
      # And begun after the last of the landed files was written: vite
      # --watch read a file another merge rewrote mid-build as it was, and
      # missed the change (2026-10-22, the dark glass, 36ba5574).
      began=$(docker logs -t --since "${landed}" flight_plan-web-build-1 2>&1 | grep "build started" | tail -1 | cut -c1-19 || true)
      began_s=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "$began" +%s 2>/dev/null || echo 0)
      newest=$(git -C "$LIVE" diff --name-only "$before" HEAD -- web/src web/index.html web/public | sed "s|^|$LIVE/|" | xargs stat -f %m 2>/dev/null | sort -n | tail -1 || true)
      if [ -n "$newest" ] && [ "$newest" -ge "$began_s" ]; then
        idle && { touch_landed; landed=$(date +%s); }
        continue
      fi
      echo "ON THE PHONE: $head built at $(date -r "$built" +%H:%M:%S) (reload)"
      exit 0
    fi
  done
  echo "NOT BUILT after 8 minutes: check web-build" >&2
  exit 1
  ;;
specs)
  shift
  [ $# -gt 0 ] || { echo "which specs?" >&2; exit 64; }
  # The phone's bundle, the one tested: copied, not built again -- once
  # web-build is idle, never half way through a rebuild (another session's
  # landing starts one; copied mid-build, the page's chunks were 404s).
  for _ in $(seq 1 60); do
    log=$(docker logs --tail 400 flight_plan-web-build-1 2>&1)
    started=$(printf '%s\n' "$log" | grep -n "build started" | tail -1 | cut -d: -f1)
    done_at=$(printf '%s\n' "$log" | grep -n "files generated" | tail -1 | cut -d: -f1)
    [ -z "$started" ] || { [ -n "$done_at" ] && [ "$done_at" -gt "$started" ]; } && break
    sleep 5
  done
  rsync -a --delete "$LIVE/web/dist/" "$OUT/"
  "$REPO_SCRIPTS/one-at-a-time.sh" "Session1 specs on the live bundle" \
    docker run --rm --network container:fp-serve-traffic -v "$WT/web":/w -v "${SHOTS:-/tmp}":/s \
      -v "$LIVE/web/node_modules":/w/node_modules -w /w -e BASE_URL=http://localhost:4173 \
      mcr.microsoft.com/playwright:v1.55.1-noble npx playwright test -c e2e/.local.config.ts "$@" \
      --workers=2 --retries=1 --no-deps --reporter=list
  ;;
*)
  echo "usage: land-and-test.sh land | specs <spec...> [--project=...]" >&2
  exit 64
  ;;
esac
