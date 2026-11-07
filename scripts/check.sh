#!/usr/bin/env bash
# The checks CLAUDE.md's "Checks" table names, for one part of the repo or
# for every part a branch changed, run on the owner's Mac the fast way: in
# Docker (the Mac has no node, npm or pytest), each area in its own turn of
# scripts/one-at-a-time.sh, and warm from the first run of any worktree.
#
#   scripts/check.sh <area>...       web py planner nav-log-agent crewai-agent
#                                    engine java ios android
#   scripts/check.sh all-changed     the areas `git diff origin/main...` and
#                                    the uncommitted files touch, in parallel
#   scripts/check.sh --areas         reads paths on stdin, prints their areas
#
# Every agent's worktree used to start cold: npm ci in a fresh node
# container, the engine compiled from nothing, pip into a fresh container,
# Maven's downloads again. What is kept between runs, and shared by every
# worktree:
# - wingtip-check-web:<hash>: node (.nvmrc) with web's node_modules for this
#   package-lock, installed at /node_modules, which Node, TypeScript and
#   ESLint all find by walking up from /repo/web. Built when the lock
#   changes; npm's downloads in BuildKit's cache (id wingtip-npm).
# - wingtip-check-py-<dir>:<hash>: python with that directory's
#   requirements-dev and the wingtip_native wheel built from this native/
#   (CI's `ci` profile). Built when either changes; uv's downloads and the
#   wheel's Rust in BuildKit's caches.
# - Volumes: wingtip-cargo-registry and wingtip-cargo-git (Cargo's
#   downloads), wingtip-cargo-target-tests-<rust>-<arch> (the engine tests'
#   build), wingtip-check-raw (the FAA files the Python tests fetch into
#   data/raw, as CI's cache keeps them), fp-m2 (Maven's repository).
# The test build is never scripts/build-engine-wasm.sh's: that one stays a
# clean, reproducible build in its pinned image. Each worktree is mounted at
# its own path in the engine's container, so Cargo keys its own crates by
# worktree (another worktree's older files can never pass for built) and
# shares only the third-party ones.
# Each image keeps its newest three tags; `docker volume rm` any of the
# volumes at any time costs one cold run.
set -euo pipefail

here=$(cd "$(dirname "$0")/.." && pwd)
PATH=$PATH:$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin:$HOME/.local/bin:$HOME/.cargo/bin

AREAS="web py planner nav-log-agent crewai-agent engine java ios android"
RUST_IMAGE=rust:1.89-slim-bookworm

# The areas a list of changed paths touches, one per line in AREAS' order:
# CI's changes filter (ci.yml, native-ios.yml, native-android.yml) by area.
areas_for() {
  local path found=" "
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    case "$path" in
      web/*|.nvmrc|planning-service/openapi.json|springboot-app/openapi.json|native/contract/*|scripts/api-models-apps.*)
        found+="web " ;;
    esac
    case "$path" in
      src/*|native/*|tests/*|requirements-dev.txt|planning-service/requirements*.txt|docker/requirements*.txt|scripts/build-engine-wasm.sh|web/src/lib/engine/wingtip-engine.wasm|pyproject.toml)
        found+="py " ;;
    esac
    case "$path" in
      planning-service/*|src/*|native/*) found+="planner " ;;
    esac
    case "$path" in
      nav-log-agent/*|src/*) found+="nav-log-agent " ;;
    esac
    case "$path" in
      crewai-agent/*|src/*) found+="crewai-agent " ;;
    esac
    case "$path" in
      native/*|web/src/lib/fixtures/*|tests/fixtures/native/*) found+="engine " ;;
    esac
    case "$path" in
      springboot-app/*) found+="java " ;;
    esac
    case "$path" in
      ios/*|web/src/lib/fixtures/*|web/src/lib/acs.json|native/engine/*|native/crates/*|native/ffi/*|native/Cargo.*|tests/fixtures/native/*)
        found+="ios " ;;
    esac
    case "$path" in
      android/*|web/src/lib/fixtures/*|native/engine/*|native/crates/*|native/ffi/*|native/Cargo.*)
        found+="android " ;;
    esac
  done
  local area
  for area in $AREAS; do
    case "$found" in *" $area "*) echo "$area" ;; esac
  done
}

changed_paths() {
  git -C "$here" fetch -q origin main 2>/dev/null || true
  {
    git -C "$here" diff --name-only origin/main...HEAD
    git -C "$here" diff --name-only HEAD
    git -C "$here" ls-files -o --exclude-standard
  } | sort -u
}

sha() { shasum -a 256 | cut -c1-16; }

# Keeps an image's newest three tags, so a lock that changes back and forth
# between branches is still warm, and the disk is not filled with old ones.
prune_tags() {
  docker image ls "$1" --format '{{.CreatedAt}}|{{.Repository}}:{{.Tag}}' \
    | sort -r | tail -n +4 | cut -d'|' -f2 | xargs -r docker image rm >/dev/null 2>&1 || true
}

web_image() {
  local node tag ctx
  node=$(tr -d ' \n' < "$here/.nvmrc")
  tag=wingtip-check-web:$({ echo "node $node"; cat "$here/web/package.json" "$here/web/package-lock.json"; } | sha)
  if ! docker image inspect "$tag" >/dev/null 2>&1; then
    ctx=$(mktemp -d)
    cp "$here/web/package.json" "$here/web/package-lock.json" "$ctx/"
    echo "check: building $tag (web's packages changed)" >&2
    docker build -q -t "$tag" --build-arg NODE="$node" -f - "$ctx" >/dev/null <<'EOF'
ARG NODE
FROM node:${NODE}-slim
COPY package.json package-lock.json /
RUN --mount=type=cache,id=wingtip-npm,target=/root/.npm \
    cd / && npm ci --no-audit --no-fund --loglevel=error
ENV PATH=/node_modules/.bin:$PATH
EOF
    rm -rf "$ctx"
    prune_tags wingtip-check-web
  fi
  echo "$tag"
}

# A requirements file and every file it names with -r or -c, from the repo
# root, each once.
requirements_of() {
  local file=$1 dir line
  echo "$file"
  dir=$(dirname "$file")
  sed -nE 's/^-[rc][[:space:]]*([^[:space:]#]+).*/\1/p' "$here/$file" | while read -r line; do
    requirements_of "$(cd "$here/$dir" && python3 -c 'import os,sys; print(os.path.relpath(os.path.abspath(sys.argv[1]), sys.argv[2]))' "$line" "$here")"
  done
}

# python for that directory with its requirements-dev and the native wheel.
py_image() {
  local dir=$1 py=$2 extra=$3 name tag ctx req
  name=wingtip-check-py-$( [ "$dir" = . ] && echo root || echo "$dir")
  ctx=$(mktemp -d)
  mkdir -p "$ctx/reqs"
  for req in $(requirements_of "$dir/requirements-dev.txt" | sort -u); do
    mkdir -p "$ctx/reqs/$(dirname "$req")"
    cp "$here/$req" "$ctx/reqs/$req"
  done
  (cd "$here" && git ls-files -z -co --exclude-standard -- native | xargs -0 tar cf - 2>/dev/null) | tar xf - -C "$ctx"
  cat > "$ctx/Dockerfile" <<EOF
# The wheel's stage: the same for every directory, so BuildKit builds it once.
FROM python:3.14-slim AS native
COPY --from=$RUST_IMAGE /usr/local/cargo /usr/local/cargo
COPY --from=$RUST_IMAGE /usr/local/rustup /usr/local/rustup
ENV PATH=/usr/local/cargo/bin:\$PATH CARGO_HOME=/usr/local/cargo RUSTUP_HOME=/usr/local/rustup
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \\
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \\
    rm -f /etc/apt/apt.conf.d/docker-clean \\
    && apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev
RUN --mount=type=cache,id=wingtip-uv,target=/root/.cache/uv pip install -q uv && uv pip install --system -q maturin==1.9.4
COPY native /native
# Touched, so a shared target dir never takes an older worktree's crate for
# this one's: the third-party crates stay built, ours compile again.
RUN --mount=type=cache,id=wingtip-cargo-registry,target=/usr/local/cargo/registry \\
    --mount=type=cache,id=wingtip-check-wheel-target,target=/target,sharing=locked \\
    find /native -type f -exec touch {} + \\
    && CARGO_TARGET_DIR=/target maturin build --profile ci --compatibility linux -m /native/py/Cargo.toml -o /wheels

FROM python:$py-slim
ENV PYTHONDONTWRITEBYTECODE=1
# rasterio's wheel links libexpat, which GitHub's runner has and slim lacks.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \\
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \\
    rm -f /etc/apt/apt.conf.d/docker-clean \\
    && apt-get update && apt-get install -y --no-install-recommends libexpat1
RUN --mount=type=cache,id=wingtip-uv,target=/root/.cache/uv pip install -q uv
COPY reqs /reqs
RUN --mount=type=cache,id=wingtip-uv,target=/root/.cache/uv \\
    ${extra:+uv pip install --system -q $extra &&} uv pip install --system -q -r /reqs/$dir/requirements-dev.txt
RUN --mount=type=cache,id=wingtip-uv,target=/root/.cache/uv \\
    --mount=type=bind,from=native,source=/wheels,target=/wheels \\
    uv pip install --system -q /wheels/*.whl
EOF
  tag=$name:$( (cd "$ctx" && find . -type f | LC_ALL=C sort | xargs shasum -a 256) | sha)
  if ! docker image inspect "$tag" >/dev/null 2>&1; then
    echo "check: building $tag ($dir's requirements or native/ changed)" >&2
    docker build -q -t "$tag" "$ctx" >/dev/null
    prune_tags "$name"
  fi
  rm -rf "$ctx"
  echo "$tag"
}

# The worktree's own path in the engine's container (see the top).
worktree_key() { echo "$(basename "$here")-$(echo "$here" | sha | cut -c1-8)"; }

run_py() {
  local dir=$1 py=$2 lint=$3 extra=${4:-} tag
  tag=$(py_image "$dir" "$py" "$extra")
  docker run --rm -v "$here:/repo" -v wingtip-check-raw:/repo/data/raw -w "/repo/$dir" "$tag" \
    sh -c "ruff check $lint tests && pytest tests/ -q -p no:cacheprovider"
}

# The newest iPhone this Xcode has, by its id (native-ios.yml's pick).
newest_iphone() {
  xcrun simctl list devices available -j | python3 -c '
import json, sys
ds = [d for r, ds in json.load(sys.stdin)["devices"].items() if "iOS" in r for d in ds
      if d["name"].startswith("iPhone") and "Duo" not in d["name"]]
print(sorted(ds, key=lambda d: d["name"])[-1]["udid"] if ds else "")'
}

# The engine built for a phone, kept by the engine's files under
# ~/Library/Caches/wingtip-checks, as CI's caches keep it: a worktree with
# the same engine copies it instead of compiling three targets again.
phone_engine() {
  local kind=$1 out=$2 script=$3 key cache
  key=$(cd "$here" && git ls-files -z -co --exclude-standard -- native/engine native/crates native/ffi 'native/Cargo.*' \
    | xargs -0 shasum -a 256 | sha)
  cache=$HOME/Library/Caches/wingtip-checks/engine-$kind-$key
  if [ ! -d "$cache" ]; then
    "$here/$script"
    mkdir -p "$(dirname "$cache")"
    rm -rf "$cache.tmp" && cp -R "$here/$out" "$cache.tmp" && mv "$cache.tmp" "$cache"
  fi
  rm -rf "${here:?}/$out" && mkdir -p "$(dirname "$here/$out")" && cp -R "$cache" "$here/$out"
}

run_area() {
  local tag key
  case "$1" in
    web)
      tag=$(web_image)
      # A worktree's own node_modules (macOS binaries, or an older lock's)
      # would come first in Node's walk up: hidden behind an empty one.
      local hide=()
      [ -d "$here/web/node_modules" ] && hide=(--tmpfs /repo/web/node_modules)
      docker run --rm -v "$here:/repo" "${hide[@]+"${hide[@]}"}" -w /repo/web "$tag" \
        sh -c 'npm run -s types && npx tsc --noEmit && npx eslint . && npx vitest run'
      ;;
    py) run_py . 3.14 src/wingtip ;;
    planner) run_py planning-service 3.14 app ;;
    nav-log-agent) run_py nav-log-agent 3.14 app "torch --index-url https://download.pytorch.org/whl/cpu" ;;
    crewai-agent) run_py crewai-agent 3.13 app ;;
    engine)
      # CI's own cargo test line (ci.yml's test job), so the crates tested
      # here are always the ones tested there.
      local cmd
      cmd=$(grep -oE 'cargo test --profile ci [^#]*' "$here/.github/workflows/ci.yml" | head -1)
      key=$(worktree_key)
      docker run --rm -v "$here:/w/$key" \
        -v wingtip-cargo-registry:/usr/local/cargo/registry -v wingtip-cargo-git:/usr/local/cargo/git \
        -v "wingtip-cargo-target-tests-1.89-$(docker version -f '{{.Server.Arch}}')":/target \
        -e CARGO_TARGET_DIR=/target -w "/w/$key" "$RUST_IMAGE" sh -c "$cmd"
      ;;
    java)
      docker run --rm -v "$here/springboot-app":/build -v /build/target -v fp-m2:/root/.m2 \
        -v /var/run/docker.sock:/var/run/docker.sock -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal \
        -w /build maven:3.9-eclipse-temurin-25 mvn -B -q test
      ;;
    ios)
      local sim
      phone_engine ios ios/Frameworks/WingtipEngine.xcframework native/ffi/build-xcframework.sh
      xcodegen generate --spec "$here/ios/project.yml" --project "$here/ios" --quiet
      sim=$(newest_iphone)
      [ -n "$sim" ] || { echo "check: no iPhone simulator in this Xcode" >&2; return 1; }
      xcodebuild -quiet -project "$here/ios/Wingtip.xcodeproj" -scheme Wingtip -configuration Debug \
        -destination "platform=iOS Simulator,id=$sim" \
        -derivedDataPath "$HOME/Library/Developer/Xcode/DerivedData/wingtip-check-$(worktree_key)" \
        CODE_SIGNING_ALLOWED=NO test
      ;;
    android)
      local sdk=$HOME/Library/Android/sdk
      export JAVA_HOME=${JAVA_HOME:-$(ls -d "$HOME"/Library/Java/JavaVirtualMachines/jbr-21*/Contents/Home | tail -1)}
      export ANDROID_HOME=${ANDROID_HOME:-$sdk}
      export ANDROID_NDK_HOME=${ANDROID_NDK_HOME:-$(ls -d "$ANDROID_HOME"/ndk/* | sort -V | tail -1)}
      phone_engine android android/app/engine native/ffi/build-android.sh
      (cd "$here/android" && ./gradlew --quiet testDebugUnitTest lintDebug assembleDebug)
      ;;
    *) echo "check: no area '$1' (one of: $AREAS, all-changed)" >&2; return 64 ;;
  esac
}

# One area in its own turn, timed.
in_turn() {
  local area=$1 start status=0
  start=$(date +%s)
  "$here/scripts/one-at-a-time.sh" "check $area ($(basename "$here"))" "$0" --run "$area" || status=$?
  echo "check: $area exit $status, $(( $(date +%s) - start ))s with the wait for a turn" >&2
  return "$status"
}

case "${1:-}" in
  --areas) areas_for; exit 0 ;;
  --run)
    # The time in the turn, apart from the time in line before it. Called
    # plainly, not under `||`, so `set -e` stops an area at its first
    # failing step.
    start=$(date +%s) area=$2
    trap 'echo "check: $area ran in $(( $(date +%s) - start ))s" >&2' EXIT
    run_area "$area"
    exit 0 ;;
  ""|-h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 64 ;;
esac

if [ "$1" = all-changed ]; then
  # shellcheck disable=SC2046
  set -- $(changed_paths | areas_for)
  [ $# -gt 0 ] || { echo "check: nothing changed that a check covers"; exit 0; }
  echo "check: $*" >&2
  # In parallel, each in its own turn; each one's output kept apart and
  # shown when it ends, so two logs never interleave.
  logs=$(mktemp -d)
  pids=()
  for area in "$@"; do
    ( in_turn "$area" > "$logs/$area.log" 2>&1 ) &
    pids+=($!)
  done
  failed=()
  i=0
  for area in "$@"; do
    if wait "${pids[$i]}"; then :; else failed+=("$area"); fi
    echo "===== $area" && cat "$logs/$area.log"
    i=$((i + 1))
  done
  rm -rf "$logs"
  [ ${#failed[@]} -eq 0 ] || { echo "check: failed: ${failed[*]}" >&2; exit 1; }
  exit 0
fi

status=0
for area in "$@"; do in_turn "$area" || status=1; done
exit "$status"
