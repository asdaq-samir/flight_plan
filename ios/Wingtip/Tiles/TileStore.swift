import Foundation

/// The chart's tiles on disk, by cycle and kind, so the chart a pilot has
/// looked at is there in the air with no connection -- what the web app's
/// service worker keeps (vite.config's chart-tiles cache). Under Caches:
/// iOS may clear it when space is short, and the next look fetches again.
/// The disk holds the pyramid's own 256-pixel tiles; the tiles the map
/// draws are composed of them (ChartTileOverlay) and kept in memory
/// (TileCache).
final class TileStore: Sendable {
    static let shared = TileStore()

    let root: URL

    init(root: URL? = nil) {
        self.root = root ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appending(path: "chart-tiles", directoryHint: .isDirectory)
    }

    /// A tile's file, named as the pyramid names it: {y}@2x.png for the
    /// 512-pixel tile (TileTemplate.scale), so the two never stand in for
    /// each other.
    func path(cycle: String, kind: String, z: Int, x: Int, y: Int, scale: Int = 1) -> URL {
        root.appending(path: "\(cycle)/\(kind)/\(z)/\(x)/\(y)\(scale == 1 ? "" : "@\(scale)x").png")
    }

    func read(cycle: String, kind: String, z: Int, x: Int, y: Int, scale: Int = 1) -> Data? {
        try? Data(contentsOf: path(cycle: cycle, kind: kind, z: z, x: x, y: y, scale: scale))
    }

    func write(_ data: Data, cycle: String, kind: String, z: Int, x: Int, y: Int, scale: Int = 1) {
        let file = path(cycle: cycle, kind: kind, z: z, x: x, y: y, scale: scale)
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: file, options: .atomic)
    }

    /// Bytes kept, for Setup's "Kept for the air" line.
    func bytes() -> Int64 {
        guard let files = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.fileSizeKey]) else { return 0 }
        var total: Int64 = 0
        for case let file as URL in files {
            total += Int64((try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        }
        return total
    }

    /// Everything but the cycle flown now: an edition gone by is no use.
    func keepOnly(cycle: String) {
        guard let editions = try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) else { return }
        for edition in editions where edition.lastPathComponent != cycle {
            try? FileManager.default.removeItem(at: edition)
        }
    }
}

/// The composed 512-point tiles the map has drawn, in memory, so a tile
/// scrolled back into view is handed over again rather than read from
/// disk, decoded and composed again: the first level of the three
/// (memory, the disk store, the network). An NSCache: it is safe from any
/// thread and iOS trims it under memory pressure, which is why it holds
/// the PNG bytes and not decoded images. Up to about 64 MB, some 700
/// tiles at a typical 90 KB: a few screens at every zoom a flight uses
/// (about a third as many of the 1024-pixel tiles composed from the
/// pyramid's 512-pixel ones, which iOS trims first under pressure anyway).
final class TileCache: @unchecked Sendable {
    static let shared = TileCache()

    private let cache = NSCache<NSString, NSData>()

    init(bytes: Int = 64 * 1024 * 1024) {
        cache.totalCostLimit = bytes
    }

    static func key(cycle: String, kind: String, z: Int, x: Int, y: Int, scale: Int = 1) -> String {
        "\(cycle)/\(kind)/\(z)/\(x)/\(y)@\(ChartTileOverlay.side)x\(scale)"
    }

    func read(_ key: String) -> Data? {
        cache.object(forKey: key as NSString) as Data?
    }

    func write(_ data: Data, for key: String) {
        cache.setObject(data as NSData, forKey: key as NSString, cost: data.count)
    }

    func removeAll() {
        cache.removeAllObjects()
    }
}
