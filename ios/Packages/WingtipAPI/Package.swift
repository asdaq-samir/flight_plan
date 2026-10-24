// swift-tools-version: 5.10
// The planner's client, generated from planning-service/openapi.json at
// build time by Apple's swift-openapi-generator (the json is a symlink
// to the repo's own, so the document and the client never drift). Only
// the paths openapi-generator-config.yaml lists are generated: the whole
// document is 62 paths and 194 schemas, and the app takes them on as it
// needs them. The gateway's document (springboot-app/openapi.json)
// answers "*/*" rather than JSON, which the generator turns into raw
// bodies, so its few calls are written by hand in Gateway.swift.
import PackageDescription

let package = Package(
    name: "WingtipAPI",
    platforms: [.iOS(.v18), .macOS(.v14)],
    products: [
        .library(name: "PlannerAPI", targets: ["PlannerAPI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.7.0"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.7.0"),
    ],
    targets: [
        .target(
            name: "PlannerAPI",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
            ],
            plugins: [
                .plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator"),
            ]
        ),
    ]
)
