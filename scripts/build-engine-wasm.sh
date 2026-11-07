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
#
# Then Binaryen's wasm-opt -Oz, the stock size pass rustc does not run,
# pinned to one release by its checksum so its output is the same bytes
# wherever it runs: every phone downloads the module before the first
# draw. The features it may use are the ones rustc 1.89 already emits for
# wasm32-unknown-unknown (its defaults since 1.82 and 1.87), so the
# optimised module asks no more of a browser than the unoptimised one.
set -euo pipefail

here=$(cd "$(dirname "$0")/.." && pwd)
image=${RUST_IMAGE:-rust:1.89-slim-bookworm@sha256:d7fc7de78bb8c1469933aeecbf801314d30d7d6e9f0578bba4cfa285bfa37fe6}
binaryen=version_133
binaryen_sha256=2dc9c7813f5375db93d96ead4b78222fcc3e2677bbb832297af4797782a37489
out=web/src/lib/engine/wingtip-engine.wasm

# Fetched here, as the image has neither curl nor wget; checked inside it.
tools=$(mktemp -d)
trap 'rm -rf "$tools"' EXIT
tarball=binaryen-$binaryen-x86_64-linux.tar.gz
curl -fsSL -o "$tools/$tarball" "https://github.com/WebAssembly/binaryen/releases/download/$binaryen/$tarball"

docker run --rm --platform linux/amd64 -m 3g \
  -v "$here/native:/src/native" \
  -v "$here/web/src/lib/engine:/out" \
  -v "$tools:/tools:ro" \
  -e CARGO_TARGET_DIR=/tmp/target \
  -e CARGO_INCREMENTAL=0 \
  -e SOURCE_DATE_EPOCH=0 \
  -e TARBALL="$tarball" \
  -e BINARYEN_SHA256="$binaryen_sha256" \
  -w /src/native \
  "$image" sh -ec '
    rustup target add wasm32-unknown-unknown >/dev/null 2>&1
    cargo build --locked -p wingtip-wasm --target wasm32-unknown-unknown --profile wasm 2>&1 | tail -3
    echo "$BINARYEN_SHA256  /tools/$TARBALL" | sha256sum -c - >/dev/null
    mkdir /tmp/binaryen && tar xzf "/tools/$TARBALL" -C /tmp/binaryen --strip-components=1
    /tmp/binaryen/bin/wasm-opt -Oz --strip-debug --strip-producers \
      --enable-mutable-globals --enable-sign-ext --enable-reference-types --enable-multivalue \
      --enable-bulk-memory --enable-nontrapping-float-to-int \
      /tmp/target/wasm32-unknown-unknown/wasm/wingtip_wasm.wasm -o /out/wingtip-engine.wasm
  '
echo "$out: $(wc -c < "$here/$out" | tr -d ' ') bytes"
