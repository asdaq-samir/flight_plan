#!/usr/bin/env bash
# The phones' types for the engine's answers, generated from its contract
# (native/contract/engine.schema.json) by quicktype, as the web's are by
# json-schema-to-typescript (`npm run types`): the iPhone's
# ios/Wingtip/Engine/EngineContract.swift and Android's
# android/app/src/main/kotlin/app/wingtipmaps/android/engine/EngineContract.kt,
# both committed (neither app's build has Node). Run it after changing the
# schema or ANSWERS below, and commit the two files.
#
#   scripts/engine-contract-apps.sh
#
# Only the answers the apps decode with a generated type are listed: a
# caller switched from its hand-written Decodable or @Serializable class
# adds its rule's name here. In Docker, since the owner's Mac has no Node.
set -euo pipefail

here=$(cd "$(dirname "$0")/.." && pwd)
docker=${DOCKER:-docker}
schema=native/contract/engine.schema.json
ANSWERS=(traffic_marks alert_fires altitude_lines)

sources=()
for name in "${ANSWERS[@]}"; do
  sources+=("$schema#/properties/$name/properties/answer")
done

"$docker" run --rm -v "$here:/w" -w /w node:24-slim sh -ec '
  swift=ios/Wingtip/Engine/EngineContract.swift
  kotlin=android/app/src/main/kotlin/app/wingtipmaps/android/engine/EngineContract.kt
  npx -y quicktype@23.2.6 -s schema -l swift --type-prefix Engine --no-initializers \
    --struct-or-class struct --protocol equatable --sendable --access-level internal \
    --density dense -o "$swift" "$@"
  npx -y quicktype@23.2.6 -s schema -l kotlin --framework kotlinx \
    --package app.wingtipmaps.android.engine -o "$kotlin" "$@"
  # quicktype writes a list answer as a typealias of kotlinx JsonArray,
  # which takes no type argument and does not compile; a caller decodes
  # List<the element> itself.
  sed -i "/^typealias [A-Za-z]* = JsonArray</d" "$kotlin"
' sh "${sources[@]}"
echo "generated from $schema: ${ANSWERS[*]}"
