#!/usr/bin/env bash
# Builds the engine's WebAssembly (native/wasm, wingtip-wasm) into
# web/src/lib/engine/wingtip-engine.wasm, which is committed: the web
# app's build and CI's web jobs have no Rust. Run it after any change
# under native/engine, native/crates or native/wasm, and commit the .wasm
# with it; CI's `test` job runs it again and fails where the committed
# file differs.
#
#   scripts/build-engine-wasm.sh
#
# In Docker, so the bytes are the same on the owner's Mac and on GitHub's
# runner: the Rust image pinned by digest (1.89.0, linux/amd64), the
# workspace mounted at the same path, a fresh target directory, and
# Cargo.lock as committed (--locked). The rustc that builds it is the
# only thing that makes the code, and the paths it writes into panic
# messages are /src/... and /usr/local/... either way.
set -euo pipefail

here=$(cd "$(dirname "$0")/.." && pwd)
image=${RUST_IMAGE:-rust:1.89-slim-bookworm@sha256:d7fc7de78bb8c1469933aeecbf801314d30d7d6e9f0578bba4cfa285bfa37fe6}
out=web/src/lib/engine/wingtip-engine.wasm

docker run --rm --platform linux/amd64 -m 3g \
  -v "$here/native:/src/native" \
  -v "$here/web/src/lib/engine:/out" \
  -e CARGO_TARGET_DIR=/tmp/target \
  -e CARGO_INCREMENTAL=0 \
  -e SOURCE_DATE_EPOCH=0 \
  -w /src/native \
  "$image" sh -ec '
    rustup target add wasm32-unknown-unknown >/dev/null 2>&1
    cargo build --locked -p wingtip-wasm --target wasm32-unknown-unknown --profile wasm 2>&1 | tail -3
    cp /tmp/target/wasm32-unknown-unknown/wasm/wingtip_wasm.wasm /out/wingtip-engine.wasm
  '
echo "$out: $(wc -c < "$here/$out" | tr -d ' ') bytes"
