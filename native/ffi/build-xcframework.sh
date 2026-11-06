#!/usr/bin/env bash
# The engine for the iOS app: wingtip-ffi built for the iPhone and for the
# simulator on both Apple silicon and Intel Macs, put in one XCFramework
# with its C header and module map, so Swift can `import WingtipEngine`.
# Run on a Mac with Xcode and rustup (GitHub's macOS runner, native-ios.yml);
# writes ios/Frameworks/WingtipEngine.xcframework, which is not committed.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
native=$(dirname "$here")
out="$native/../ios/Frameworks/WingtipEngine.xcframework"
targets=(aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios)
rustup target add "${targets[@]}"
for target in "${targets[@]}"; do
  cargo build --release --manifest-path "$native/Cargo.toml" -p wingtip-ffi --target "$target"
done
lib=libwingtip_ffi.a
sim="$native/target/ios-simulator"
mkdir -p "$sim"
lipo -create "$native/target/aarch64-apple-ios-sim/release/$lib" "$native/target/x86_64-apple-ios/release/$lib" -output "$sim/$lib"
rm -rf "$out"
xcodebuild -create-xcframework \
  -library "$native/target/aarch64-apple-ios/release/$lib" -headers "$here/include" \
  -library "$sim/$lib" -headers "$here/include" \
  -output "$out"
echo "built $out"
