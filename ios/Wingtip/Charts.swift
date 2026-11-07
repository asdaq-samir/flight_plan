import Foundation
import Observation

/// Which chart the map draws (/api/chart): its cycle, its layers and
/// where its tiles are. Kept from the last answer, so the map draws from
/// its tile store with no connection at all.
@MainActor
@Observable
final class Charts {
    private(set) var info: ChartInfo?
    private(set) var problem: String?

    private static let kept = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appending(path: "chart.json")

    func load() async {
        if info == nil, let data = try? Data(contentsOf: Self.kept),
           let last = try? JSONDecoder().decode(ChartInfo.self, from: data) {
            info = last
        }
        do {
            let fresh = try await Planner.chart()
            info = fresh
            problem = nil
            try? FileManager.default.createDirectory(at: Self.kept.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? JSONEncoder().encode(fresh).write(to: Self.kept, options: .atomic)
            TileStore.shared.keepOnly(cycle: fresh.chartCycle)
            // The airspace kept for the air, fetched again where the FAA's
            // cycle has turned since it was.
            Task.detached { await CyclePacks.shared.refresh() }
        } catch {
            problem = info == nil ? "The chart could not be fetched: \(error.localizedDescription)" : nil
            Log.map.error("the chart could not be fetched (\(self.info == nil ? "none kept" : "the kept one stands", privacy: .public)): \(error.localizedDescription, privacy: .public)")
        }
    }

    /// The sectional, the base layer the map opens on (web/src/lib/map/
    /// tiles.ts chartPair: "sec", else the first base layer).
    var base: ChartLayer? {
        guard let layers = info?.chartLayers else { return nil }
        return layers.first { $0.kind == "sec" } ?? layers.first { $0.base }
    }

    var template: TileTemplate? {
        guard let info, let base else { return nil }
        // The 512-pixel tiles wherever the kind was drawn at them: every
        // iPhone's screen is 2x or 3x.
        return TileTemplate(cycle: info.chartCycle, revision: info.chartRevision ?? 0, tilesBase: info.chartTilesBase, kind: base.kind,
                            scale: base.scales?.contains(2) == true ? 2 : 1)
    }
}
