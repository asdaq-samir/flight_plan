import Foundation

/// Where a chart kind's tiles come from, as the web app has it
/// (web/src/lib/map/tiles.ts): published to a CDN they come straight from
/// there with the cycle a path segment; served by the planner itself,
/// through the gateway, the cycle is a cache-busting query. The revision
/// rides along either way: tiles rendered again within an edition keep
/// their {z}/{x}/{y} and cycle.
struct TileTemplate: Equatable, Sendable {
    let cycle: String
    let revision: Int
    let tilesBase: String?
    let kind: String

    func url(z: Int, x: Int, y: Int) -> URL {
        if let base = tilesBase, !base.isEmpty {
            return URL(string: "\(base)/\(cycle)/\(kind)/\(z)/\(x)/\(y).png?r=\(revision)")!
        }
        return Config.gateway.appending(path: "/api/planner/chart-tile/\(kind)/\(z)/\(x)/\(y).png")
            .appending(queryItems: [URLQueryItem(name: "c", value: cycle), URLQueryItem(name: "r", value: String(revision))])
    }
}
