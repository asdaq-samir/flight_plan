#!/usr/bin/env bash
# The phones' models of the servers' answers, generated from the same
# OpenAPI documents the web's API client is (`npm run types`:
# planning-service/openapi.json for the planner, springboot-app/openapi.json
# for the gateway), so a field renamed on a server fails the phones' build
# and CI, not a pilot's screen at runtime. quicktype writes models only --
# plain Codable structs and @Serializable data classes, no runtime library --
# and each app keeps its own thin client (ios/Wingtip/API/Planner.swift,
# android/.../api/Planner.kt):
#
#   ios/Wingtip/API/Generated/PlannerModels.swift      types prefixed API
#   ios/Wingtip/API/Generated/GatewayModels.swift      types prefixed GW
#   android/.../api/generated/PlannerModels.kt         package ...api.generated
#   android/.../api/generated/GatewayModels.kt         package ...api.generated.gateway
#
# all committed with a "generated, do not edit" header (neither app's build
# has Node); CI runs this and fails when the committed files differ.
#
#   scripts/api-models-apps.sh
#
# Only the schemas listed below are generated, with every schema they
# refer to: a hand-written model switched to its generated twin adds its
# schema's name here. In Docker, since the owner's Mac has no Node.
#
# How the documents are read:
# - Enums and consts become plain strings, as the hand-written models read
#   them: a value the server adds later must not make a whole answer fail
#   to decode on a phone that has not been updated. A string's format (a
#   date) is dropped too, so a date stays the string the apps read.
# - Tuples (a [lat, lon] pair) become arrays of their one type.
# - Swift: the planner's answers are read by Planner.snakeCase
#   (keyDecodingStrategy .convertFromSnakeCase), which turns "flight_category"
#   into "flightCategory" before it looks for a key, so each CodingKey is
#   rewritten to that converted name (a key quicktype renamed, "class" or
#   "private", keeps its own). The gateway's JSON is camel case already.
# - Kotlin: @SerialName carries the snake case, as Models.kt's did, read by
#   Gateway.json (ignoreUnknownKeys, explicitNulls false).
set -euo pipefail

here=$(cd "$(dirname "$0")/.." && pwd)
docker=${DOCKER:-docker}

# The planner's schemas the phones decode with a generated model. Not
# here yet: AheadAlert and AirportPin, which the engine also writes from
# the cycle packs on the phone (Engine/Ahead.swift, Engine/InView.swift),
# so they wait until the engine's contract is held to the same schema.
PLANNER=(
  AirportPlace AirportSuggestion NearestAirport Traffic
  Briefing RouteOptions RouteProfile Course Candidate
  ChartInfo ProcedureList AircraftProfile
)
# The gateway's. Its answers (PilotDto, LogbookEntryDto and the rest) are
# still read by hand: their names and dates differ from the apps' models,
# a switch of its own.
GATEWAY=(
  AircraftRequest CurrencyDatesRequest InspectionsRequest InstructorRequest
  SquawkRequest VorCheckRequest LogbookImportResult FlightServiceStatus
)

"$docker" run --rm -v "$here:/w" -w /w node:24-slim sh -ec '
  swift_dir=ios/Wingtip/API/Generated
  kotlin_dir=android/app/src/main/kotlin/app/wingtipmaps/android/api/generated
  mkdir -p "$swift_dir" "$kotlin_dir" /tmp/api
  for doc in planning-service springboot-app; do
    node scripts/api-models-apps.mjs prep "$doc/openapi.json" "/tmp/api/$doc.kotlin.json"
    node scripts/api-models-apps.mjs prep "$doc/openapi.json" "/tmp/api/$doc.swift.json" swift
  done

  gen() { # language, document, type prefix or package, file, schema names
    lang=$1 doc=$2 name=$3 file=$4; shift 4
    set -- $(echo "$1" | tr , " ")
    srcs="" top=""
    for s in "$@"; do srcs="$srcs /tmp/api/$doc.$lang.json#/components/schemas/$s"; done
    # One schema alone would be named after the file.
    [ $# -eq 1 ] && top="--top-level $1"
    if [ "$lang" = swift ]; then
      npx -y quicktype@23.2.6 -s schema -l swift $top --type-prefix "$name" --no-initializers \
        --struct-or-class struct --protocol equatable --sendable --access-level internal \
        --mutable-properties --acronym-style camel --density dense -o "$file" $srcs
    else
      npx -y quicktype@23.2.6 -s schema -l kotlin $top --framework kotlinx --acronym-style camel \
        --package "$name" -o "$file" $srcs
    fi
  }

  gen swift planning-service API "$swift_dir/PlannerModels.swift" "$1"
  node scripts/api-models-apps.mjs swift "$swift_dir/PlannerModels.swift" snake
  gen swift springboot-app GW "$swift_dir/GatewayModels.swift" "$2"
  node scripts/api-models-apps.mjs swift "$swift_dir/GatewayModels.swift" camel
  gen kotlin planning-service app.wingtipmaps.android.api.generated "$kotlin_dir/PlannerModels.kt" "$1"
  node scripts/api-models-apps.mjs kotlin "$kotlin_dir/PlannerModels.kt" planning-service/openapi.json
  gen kotlin springboot-app app.wingtipmaps.android.api.generated.gateway "$kotlin_dir/GatewayModels.kt" "$2"
  node scripts/api-models-apps.mjs kotlin "$kotlin_dir/GatewayModels.kt" springboot-app/openapi.json
' sh "$(IFS=,; echo "${PLANNER[*]}")" "$(IFS=,; echo "${GATEWAY[*]}")"
echo "generated: planner ${PLANNER[*]}; gateway ${GATEWAY[*]}"
