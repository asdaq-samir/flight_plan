import Foundation
import MapKit
import OSLog
import UIKit

/// The FAA chart as the map's ground: an MKTileOverlay that replaces
/// Apple's map (no other base map, as the web app has none) and draws
/// 512-point tiles, each composed of four of the pyramid's 256-pixel
/// tiles one level finer. On a 3x screen a 256-point tile is scaled up
/// three times and a phone's screen needs about 55 of them; a 512-point
/// tile is scaled 1.5 times and the screen needs about 18, so the chart
/// is sharper and MapKit has a third of the tiles to place (the owner's
/// ask, 2026-11-03: the native app fast and sharp). The pyramid on disk
/// and on the CDN is unchanged.
///
/// Where the pyramid was drawn at twice the pixels too (TileTemplate's
/// `scale` 2), the children are its 512-pixel tiles and the 512-point
/// tile is 1024 pixels, two to a point: a 3x screen stretches it half
/// again rather than three times, and the chart's lettering, drawn from
/// the FAA's sheet at that size, stays crisp.
///
/// A tile is answered from memory (TileCache, the composed tiles), else
/// composed from the children in the store on disk, else from the
/// network, the children kept on disk as they come so the chart a pilot
/// looked at is there in the air. A tile asked for twice while it loads
/// is fetched once. Each load is a signpost interval ("tile") under the
/// app's "tiles" log category, so Instruments and the runner's logs show
/// where a pan's time goes and which level answered.
final class ChartTileOverlay: MKTileOverlay {
    let template: TileTemplate
    let store: TileStore
    private let cache: TileCache
    private let session = URLSession(configuration: .default)
    private let signposter = OSSignposter(subsystem: "app.wingtipmaps.ios", category: "tiles")
    /// The loads under way, by tile, with everyone waiting for each: a
    /// pan that asks for a tile twice before it is in gets one fetch.
    // Unchecked state, as the waiting closures are not Sendable: the lock
    // is what makes them safe to hold and hand back.
    private let inFlight = OSAllocatedUnfairLock(uncheckedState: [String: [(Data?, (any Error)?) -> Void]]())

    /// The pyramid's zooms, kept: a 512-point tile at the overlay's z is
    /// made of the pyramid's tiles at z + 1, so the overlay's levels are
    /// the pyramid's less one, and its finest tile is made of the
    /// pyramid's finest.
    let pyramidMinZoom: Int
    let pyramidMaxZoom: Int

    init(template: TileTemplate, minZoom: Int, maxZoom: Int, store: TileStore = .shared, cache: TileCache = .shared) {
        self.template = template
        self.store = store
        self.cache = cache
        self.pyramidMinZoom = minZoom
        self.pyramidMaxZoom = maxZoom
        super.init(urlTemplate: nil)
        canReplaceMapContent = true
        tileSize = CGSize(width: ChartTileOverlay.side, height: ChartTileOverlay.side)
        minimumZ = max(0, minZoom - 1)
        maximumZ = maxZoom - 1
    }

    /// The composed tile's side in points, and the pyramid's tiles' in pixels.
    static let side = 512
    static let childSide = 256

    override func url(forTilePath path: MKTileOverlayPath) -> URL {
        // The pyramid's own address of the top-left child, for anything
        // that asks (MapKit does not: loadTile answers every tile here).
        template.url(z: path.z + 1, x: path.x * 2, y: path.y * 2)
    }

    override func loadTile(at path: MKTileOverlayPath, result: @escaping (Data?, (any Error)?) -> Void) {
        let (z, x, y) = (path.z, path.x, path.y)
        let key = TileCache.key(cycle: template.cycle, kind: template.kind, z: z, x: x, y: y, scale: template.scale)
        let signpostID = signposter.makeSignpostID()
        let interval = signposter.beginInterval("tile", id: signpostID, "\(z)/\(x)/\(y)")
        if let kept = cache.read(key) {
            signposter.endInterval("tile", interval, "memory")
            result(kept, nil)
            return
        }
        // Only the first asker loads; the rest are answered with it.
        let first = inFlight.withLockUnchecked { waiting -> Bool in
            if waiting[key] != nil {
                waiting[key]!.append(result)
                return false
            }
            waiting[key] = [result]
            return true
        }
        guard first else { return }
        let template = template, store = store, cache = cache, session = session, signposter = signposter
        let inFlight = inFlight
        Task.detached(priority: .userInitiated) {
            var fromNetwork = false
            // The four pyramid tiles one level finer, in reading order:
            // top-left, top-right, bottom-left, bottom-right.
            let children = [(2 * x, 2 * y), (2 * x + 1, 2 * y), (2 * x, 2 * y + 1), (2 * x + 1, 2 * y + 1)]
            var images: [UIImage?] = Array(repeating: nil, count: 4)
            await withTaskGroup(of: (Int, Data?, Bool).self) { group in
                for (i, (cx, cy)) in children.enumerated() {
                    group.addTask {
                        if let kept = store.read(cycle: template.cycle, kind: template.kind, z: z + 1, x: cx, y: cy, scale: template.scale) {
                            return (i, kept, false)
                        }
                        guard let (data, response) = try? await session.data(from: template.url(z: z + 1, x: cx, y: cy)),
                              (response as? HTTPURLResponse)?.statusCode == 200 else {
                            // A tile the chart has none of (the sea, past the
                            // country's edge) stays blank: no error on the map.
                            return (i, nil, true)
                        }
                        store.write(data, cycle: template.cycle, kind: template.kind, z: z + 1, x: cx, y: cy, scale: template.scale)
                        return (i, data, true)
                    }
                }
                for await (i, data, fetched) in group {
                    if fetched { fromNetwork = true }
                    if let data { images[i] = UIImage(data: data) }
                }
            }
            let composed = images.contains(where: { $0 != nil }) ? ChartTileOverlay.compose(images, scale: template.scale) : nil
            if let composed { cache.write(composed, for: key) }
            // Where the tile came from, as a value: a signpost's message is
            // an OSLogMessage, which a ternary of literals cannot build.
            let source = fromNetwork ? "network" : (composed == nil ? "none" : "disk")
            signposter.endInterval("tile", interval, "\(source, privacy: .public)")
            let waiting = inFlight.withLockUnchecked { waiting -> [(Data?, (any Error)?) -> Void] in
                waiting.removeValue(forKey: key) ?? []
            }
            for answer in waiting { answer(composed, nil) }
        }
    }

    /// One 512-point tile from its four children, each in its quadrant;
    /// a child missing leaves its quadrant clear. Drawn with UIKit's
    /// renderer at scale 1, so a pixel of the pyramid is a pixel here --
    /// 512 of them on a side, or 1024 from the 512-pixel children of
    /// `scale` 2 -- and encoded as PNG, which MapKit decodes as it does a
    /// fetched tile, laying it out in the overlay's 512 points.
    nonisolated static func compose(_ children: [UIImage?], scale: Int = 1) -> Data? {
        let side = CGFloat(ChartTileOverlay.side * scale), half = CGFloat(ChartTileOverlay.childSide * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format)
        let image = renderer.image { _ in
            let places = [CGPoint(x: 0, y: 0), CGPoint(x: half, y: 0), CGPoint(x: 0, y: half), CGPoint(x: half, y: half)]
            for (child, place) in zip(children, places) {
                child?.draw(in: CGRect(origin: place, size: CGSize(width: half, height: half)))
            }
        }
        return image.pngData()
    }
}
