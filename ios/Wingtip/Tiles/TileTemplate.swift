import Foundation

/// Where a chart kind's tiles come from, as the web app has it
/// (web/src/lib/map/tiles.ts): published to a CDN they come straight from
/// there with the cycle a path segment; served by the planner itself,
/// through the gateway, the cycle is a cache-busting query. The revision
/// rides along either way: tiles rendered again within an edition keep
/// their {z}/{x}/{y} and cycle.
///
/// `scale` 2 is the pyramid's 512-pixel tile of the same z/x/y, named
/// {y}@2x.png: drawn from the FAA's sheet at twice the pixels, for the
/// phone's 2x and 3x screens, where MapKit stretched the 256-pixel tile
/// three times. Only where the kind was drawn at it (its layer's
/// `scales`, ChartsModel.template).
struct TileTemplate: Equatable, Sendable {
    let cycle: String
    let revision: Int
    let tilesBase: String?
    let kind: String
    var scale: Int = 1

    /// The name's density mark: none for the 256-pixel tile.
    var density: String { scale == 1 ? "" : "@\(scale)x" }

    func url(z: Int, x: Int, y: Int) -> URL {
        if let base = tilesBase, !base.isEmpty {
            return URL(string: "\(base)/\(cycle)/\(kind)/\(z)/\(x)/\(y)\(density).png?r=\(revision)")!
        }
        return Config.gateway.appending(path: "/api/planner/chart-tile/\(kind)/\(z)/\(x)/\(y)\(density).png")
            .appending(queryItems: [URLQueryItem(name: "c", value: cycle), URLQueryItem(name: "r", value: String(revision))])
    }
}
