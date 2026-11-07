import CoreLocation
import Foundation

/// The planner's list of the phones' packs of its FAA cycle
/// (/api/cycle-packs, the planner's CyclePacks).
struct CyclePackIndex: Codable, Equatable, Sendable {
    struct Region: Codable, Equatable, Sendable {
        let name: String
        let west: Double
        let south: Double
        let east: Double
        let north: Double
        let bytes: Int
        let crc32: Int
    }

    let cycle: String
    let builtAt: Double
    let toleranceDeg: Double
    let worstNm: Double
    let regionDeg: Int
    let regions: [Region]
}

/// The cycle packs kept on the phone, a region each (wingtip.pack's
/// write_phone), so the airspace over a point is answered with no
/// connection: kept along a route with its chart (Plan.keepForTheAir),
/// and fetched again for the regions kept when the FAA's cycle turns.
/// Under Application Support, not Caches: iOS may not clear them when
/// space is short, as it may the chart's tiles, and they are small.
final class CyclePacks: @unchecked Sendable {
    static let shared = CyclePacks()

    let root: URL
    private let lock = NSLock()

    init(root: URL? = nil) {
        self.root = root ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "cycle-packs", directoryHint: .isDirectory)
    }

    private var indexFile: URL { root.appending(path: "index.json") }

    /// The list the packs on the phone were fetched by.
    var index: CyclePackIndex? {
        guard let data = try? Data(contentsOf: indexFile) else { return nil }
        return try? Planner.snakeCase.decode(CyclePackIndex.self, from: data)
    }

    func path(cycle: String, region: String) -> URL {
        root.appending(path: "\(cycle)/\(region).pack")
    }

    /// The regions a route's corridor crosses: the region of each point
    /// along it, two nm apart, and of points a tenth of a degree (6 nm)
    /// either side, as its chart is kept five nm either side.
    static func regions(along line: [CLLocationCoordinate2D]) -> Set<String> {
        var names = Set<String>()
        for p in KeepRoute.samples(of: line, everyNm: 2) {
            for dlat in [-0.1, 0, 0.1] {
                for dlon in [-0.1, 0, 0.1] {
                    names.insert(Engine.region(lat: p.latitude + dlat, lon: p.longitude + dlon))
                }
            }
        }
        return names
    }

    /// The packs of these regions fetched where the phone has not got
    /// them for the planner's cycle, and the regions already kept fetched
    /// again where the cycle has turned. The phone moves to the new cycle,
    /// and the older one is removed, only once every region it wants of
    /// the new one is on disk: a pack that failed to come leaves the old
    /// cycle's packs in use, so a pilot is never left with no airspace
    /// for the air because one fetch failed. Quiet where the planner
    /// cannot be reached: the next keep tries again, and finds the packs
    /// already fetched in the new cycle's folder.
    func keep(regions wanted: Set<String>) async {
        guard let data = try? await Planner.data(for: Planner.get("/api/cycle-packs")),
              let fresh = try? Planner.snakeCase.decode(CyclePackIndex.self, from: data) else { return }
        let kept = index
        var names = wanted
        if let kept, kept.cycle != fresh.cycle {
            names.formUnion(keptRegions(kept.cycle))
        }
        let listed = Dictionary(uniqueKeysWithValues: fresh.regions.map { ($0.name, $0) })
        try? FileManager.default.createDirectory(at: root.appending(path: fresh.cycle), withIntermediateDirectories: true)
        var whole = true
        for name in names.sorted() {
            guard listed[name] != nil else { continue }
            let file = path(cycle: fresh.cycle, region: name)
            if FileManager.default.fileExists(atPath: file.path) { continue }
            let address = Config.gateway.appending(path: Config.plannerPath("/api/cycle-pack/\(fresh.cycle)/\(name).pack"))
            guard let (bytes, response) = try? await URLSession.shared.data(from: address),
                  (response as? HTTPURLResponse)?.statusCode == 200, Engine.verify(bytes),
                  (try? bytes.write(to: file, options: .atomic)) != nil else {
                whole = false
                continue
            }
        }
        // The same cycle, or none kept before: what came is used as it is,
        // with nothing older to fall back on. A new cycle only when whole.
        if let kept, kept.cycle != fresh.cycle, !whole { return }
        lock.withLock {
            try? data.write(to: indexFile, options: .atomic)
            if let editions = try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) {
                for edition in editions where edition.hasDirectoryPath && edition.lastPathComponent != fresh.cycle {
                    try? FileManager.default.removeItem(at: edition)
                }
            }
        }
    }

    /// The packs kept again for a new cycle where the phone has any.
    func refresh() async {
        guard let kept = index, !keptRegions(kept.cycle).isEmpty else { return }
        await keep(regions: [])
    }

    private func keptRegions(_ cycle: String) -> Set<String> {
        let files = (try? FileManager.default.contentsOfDirectory(at: root.appending(path: cycle), includingPropertiesForKeys: nil)) ?? []
        return Set(files.filter { $0.pathExtension == "pack" }.map { $0.deletingPathExtension().lastPathComponent })
    }

    /// Every pack the phone keeps of the cycle, mapped: the regions its
    /// routes cross, for a clearance's places to be found in the air
    /// (Engine.hear).
    func keptPacks() -> [Data] {
        guard let index else { return [] }
        return keptRegions(index.cycle).sorted().compactMap { try? Data(contentsOf: path(cycle: index.cycle, region: $0), options: .alwaysMapped) }
    }

    /// The airspace over a point from the packs on the phone; nil where
    /// its region's pack was never kept. A region the list has no pack of
    /// has nothing drawn in it, and is answered by the rules alone.
    func airspaceAt(lat: Double, lon: Double) -> AirspaceAt? {
        guard let index else { return nil }
        let region = Engine.region(lat: lat, lon: lon)
        guard index.regions.contains(where: { $0.name == region }) else {
            return Engine.airspaceAt(pack: nil, lat: lat, lon: lon)
        }
        guard let pack = try? Data(contentsOf: path(cycle: index.cycle, region: region), options: .alwaysMapped) else { return nil }
        return Engine.airspaceAt(pack: pack, lat: lat, lon: lon)
    }
}
