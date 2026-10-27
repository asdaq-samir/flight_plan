import CoreLocation
import Foundation

/// The chart along a route kept for the air, as the web app's KeepRoute
/// does through the service worker: every tile a corridor round the
/// course line needs at the zooms a pilot flies at, fetched into the
/// store ahead of the flight, so the chart is there with no connection.
enum KeepRoute {
    /// A tile's column and row at a zoom, the web map's own arithmetic.
    struct Tile: Hashable, Sendable {
        let z: Int
        let x: Int
        let y: Int
    }

    static func tile(lat: Double, lon: Double, zoom: Int) -> Tile {
        let n = pow(2.0, Double(zoom))
        let x = Int(((lon + 180) / 360 * n).rounded(.down))
        let latRad = lat * .pi / 180
        let y = Int(((1 - log(tan(latRad) + 1 / cos(latRad)) / .pi) / 2 * n).rounded(.down))
        return Tile(z: zoom, x: min(max(x, 0), Int(n) - 1), y: min(max(y, 0), Int(n) - 1))
    }

    /// The tiles a corridor `halfWidthNm` either side of the line needs
    /// at each zoom from `minZoom` to `maxZoom`, the line sampled every
    /// `stepNm`. The corridor is a box of tiles round each sample, one
    /// tile out from the sample's own at the zooms where a tile is wider
    /// than the corridor, more at the finer zooms.
    static func tiles(along line: [CLLocationCoordinate2D], minZoom: Int, maxZoom: Int, halfWidthNm: Double = 5, stepNm: Double = 2) -> Set<Tile> {
        guard line.count >= 2 else { return [] }
        var wanted = Set<Tile>()
        for zoom in minZoom...maxZoom {
            // A tile's width at the equator in nm, 21,600 nm round.
            let tileNm = 21_600 / pow(2.0, Double(zoom))
            let reach = max(1, Int((halfWidthNm / tileNm).rounded(.up)))
            for point in samples(of: line, everyNm: stepNm) {
                let centre = tile(lat: point.latitude, lon: point.longitude, zoom: zoom)
                for dx in -reach...reach {
                    for dy in -reach...reach {
                        wanted.insert(Tile(z: zoom, x: centre.x + dx, y: centre.y + dy))
                    }
                }
            }
        }
        return wanted
    }

    /// Points along the line a step apart, its vertices included.
    static func samples(of line: [CLLocationCoordinate2D], everyNm step: Double) -> [CLLocationCoordinate2D] {
        var out: [CLLocationCoordinate2D] = []
        for (a, b) in zip(line, line.dropFirst()) {
            let nm = Flight.nm(from: a, to: b)
            let count = max(1, Int((nm / step).rounded(.up)))
            for i in 0..<count {
                let t = Double(i) / Double(count)
                out.append(CLLocationCoordinate2D(latitude: a.latitude + (b.latitude - a.latitude) * t, longitude: a.longitude + (b.longitude - a.longitude) * t))
            }
        }
        if let last = line.last { out.append(last) }
        return out
    }

    /// Fetches every tile not yet in the store, a few at a time, and
    /// reports how many are kept as it goes.
    static func keep(_ tiles: Set<Tile>, template: TileTemplate, store: TileStore = .shared, progress: @escaping @Sendable (Int, Int) -> Void) async {
        let all = Array(tiles)
        let missing = all.filter { store.read(cycle: template.cycle, kind: template.kind, z: $0.z, x: $0.x, y: $0.y) == nil }
        var done = all.count - missing.count
        progress(done, all.count)
        await withTaskGroup(of: Bool.self) { group in
            var queue = missing[...]
            var running = 0
            while !queue.isEmpty || running > 0 {
                while running < 4, let next = queue.popFirst() {
                    running += 1
                    group.addTask {
                        guard let (data, response) = try? await URLSession.shared.data(from: template.url(z: next.z, x: next.x, y: next.y)),
                              (response as? HTTPURLResponse)?.statusCode == 200 else { return false }
                        store.write(data, cycle: template.cycle, kind: template.kind, z: next.z, x: next.x, y: next.y)
                        return true
                    }
                }
                if let _ = await group.next() {
                    running -= 1
                    done += 1
                    progress(done, all.count)
                }
                if Task.isCancelled { break }
            }
        }
    }
}
