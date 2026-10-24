import Foundation

/// The chart's tiles on disk, by cycle and kind, so the chart a pilot has
/// looked at is there in the air with no connection -- what the web app's
/// service worker keeps (vite.config's chart-tiles cache). Under Caches:
/// iOS may clear it when space is short, and the next look fetches again.
final class TileStore: Sendable {
    static let shared = TileStore()

    let root: URL

    init(root: URL? = nil) {
        self.root = root ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appending(path: "chart-tiles", directoryHint: .isDirectory)
    }

    func path(cycle: String, kind: String, z: Int, x: Int, y: Int) -> URL {
        root.appending(path: "\(cycle)/\(kind)/\(z)/\(x)/\(y).png")
    }

    func read(cycle: String, kind: String, z: Int, x: Int, y: Int) -> Data? {
        try? Data(contentsOf: path(cycle: cycle, kind: kind, z: z, x: x, y: y))
    }

    func write(_ data: Data, cycle: String, kind: String, z: Int, x: Int, y: Int) {
        let file = path(cycle: cycle, kind: kind, z: z, x: x, y: y)
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
