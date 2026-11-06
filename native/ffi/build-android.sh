#!/usr/bin/env bash
# The engine for the Android app: wingtip-ffi built as a static library for
# the three ABIs Google Play and the emulator want -- 64-bit ARM (every
# phone sold today), 32-bit ARM (the old ones Play still serves) and
# x86_64 (the emulator CI tests on) -- and put where the app's CMake build
# (android/app/src/main/cpp/CMakeLists.txt) links it into the JNI shim,
# with its C header. The twin of build-xcframework.sh for the iPhone.
# Needs rustup and an Android NDK: ANDROID_NDK_HOME, or the
# ANDROID_NDK_LATEST_HOME GitHub's runner sets (native-android.yml).
# Writes android/app/engine/, which is not committed.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
native=$(dirname "$here")
out="$native/../android/app/engine"
ndk="${ANDROID_NDK_HOME:-${ANDROID_NDK_LATEST_HOME:-}}"
if [ -z "$ndk" ]; then
  echo "build-android.sh: set ANDROID_NDK_HOME to an Android NDK" >&2
  exit 1
fi
# The NDK's prebuilt clang for the machine building, and the API level
# the app's minSdk names (android/app/build.gradle.kts): the engine is
# linked against the same Android libc the app runs on.
case "$(uname -s)" in
  Darwin) host=darwin-x86_64 ;;
  *) host=linux-x86_64 ;;
esac
bin="$ndk/toolchains/llvm/prebuilt/$host/bin"
api=26
# Rust's target, the ABI folder the app's build expects, and the clang's
# own name for the target (the 32-bit ARM one differs).
targets=(
  "aarch64-linux-android arm64-v8a aarch64-linux-android"
  "armv7-linux-androideabi armeabi-v7a armv7a-linux-androideabi"
  "x86_64-linux-android x86_64 x86_64-linux-android"
)
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
lib=libwingtip_ffi.a
for entry in "${targets[@]}"; do
  read -r target abi triple <<< "$entry"
  clang="$bin/${triple}${api}-clang"
  # Cargo's and the cc crate's names for the target's tools, each with the
  # target's dashes made underscores.
  under=${target//-/_}
  export "CARGO_TARGET_$(echo "$under" | tr '[:lower:]' '[:upper:]')_LINKER=$clang"
  export "CC_$under=$clang"
  export "AR_$under=$bin/llvm-ar"
  cargo build --release --manifest-path "$native/Cargo.toml" -p wingtip-ffi --target "$target"
  mkdir -p "$out/$abi"
  cp "$native/target/$target/release/$lib" "$out/$abi/$lib"
done
mkdir -p "$out/include"
cp "$here/include/wingtip_engine.h" "$out/include/wingtip_engine.h"
echo "built $out"
