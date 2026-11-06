import Foundation
import WingtipEngine

/// The alerts ahead with no network, from the packs kept on the phone
/// (wingtip_engine::ahead through wt_ahead): what the planner's
/// /api/airspace/ahead answers -- the Class B, C and D and special-use
/// areas in the next five minutes, the ground within 500 ft in the next
/// minute -- worked out on the phone when the planner cannot be reached.
/// The obstacles are the planner's alone, and the TFRs are not kept on
/// the phone yet: both are said to be missing, never read as clear.
extension CyclePacks {
    struct Ahead: Decodable {
        let alerts: [AheadAlert]
        let unavailable: [String]
    }

    /// Nil where no pack round the point was ever kept.
    func ahead(lat: Double, lon: Double, trackDeg: Double, groundspeedKt: Double, altitudeFt: Double?,
               now: Date = Date()) -> Ahead? {
        guard let index else { return nil }
        // The regions within a third of a degree: five minutes' track at
        // 200 kt is 17 nm, a quarter of a degree.
        var names = Set<String>()
        for dlat in [-0.3, 0, 0.3] {
            for dlon in [-0.3, 0, 0.3] {
                names.insert(Engine.region(lat: lat + dlat, lon: lon + dlon))
            }
        }
        let packs = names.sorted().compactMap { try? Data(contentsOf: path(cycle: index.cycle, region: $0), options: .alwaysMapped) }
        guard !packs.isEmpty else { return nil }
        let answer: UnsafeMutablePointer<CChar>? = Self.withPointers(packs[...], [], []) { ptrs, lens in
            ptrs.withUnsafeBufferPointer { p in
                lens.withUnsafeBufferPointer { l in
                    wt_ahead(p.baseAddress, l.baseAddress, ptrs.count, lat, lon, trackDeg, groundspeedKt, altitudeFt ?? .nan, 0,
                             Int64(now.timeIntervalSince1970), nil, .min)
                }
            }
        }
        guard let answer else { return nil }
        defer { wt_string_free(answer) }
        return try? Planner.snakeCase.decode(Ahead.self, from: Data(String(cString: answer).utf8))
    }

    // withPointers: InView.swift, shared with the in-view readers.
}
