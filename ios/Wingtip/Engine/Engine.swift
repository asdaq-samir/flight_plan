import Foundation
import WingtipEngine

/// wingtip-engine, the planner's own Rust, through its C functions
/// (native/ffi): the same figures the planner works out, here with no
/// network. Each pack is handed over mapped for the call alone.
enum Engine {
    /// The planner's AirspaceAt for a point, from the region's phone pack
    /// (nil for a region with no pack: nothing is drawn there), as
    /// /api/airspace/at answers it but for what a pack cannot hold -- the
    /// ground's height, the TFRs, the fix the point is named off. Nil where
    /// the bytes are not a pack the engine reads.
    static func airspaceAt(pack: Data?, lat: Double, lon: Double, groundFt: Double? = nil) -> AirspaceAt? {
        let ground = groundFt ?? .nan
        let answer: UnsafeMutablePointer<CChar>?
        if let pack, !pack.isEmpty {
            answer = pack.withUnsafeBytes { raw in
                wt_airspace_at(raw.bindMemory(to: UInt8.self).baseAddress, raw.count, lat, lon, ground)
            }
        } else {
            answer = wt_airspace_at(nil, 0, lat, lon, ground)
        }
        guard let json = taken(answer) else { return nil }
        return try? Planner.snakeCase.decode(AirspaceAt.self, from: Data(json.utf8))
    }

    /// Whether every byte of a pack is as the planner wrote it.
    static func verify(_ pack: Data) -> Bool {
        pack.withUnsafeBytes { raw in wt_pack_verify(raw.bindMemory(to: UInt8.self).baseAddress, raw.count) } == 1
    }

    /// The region whose pack holds a point ("n40w088").
    static func region(lat: Double, lon: Double) -> String {
        taken(wt_region_of(lat, lon)) ?? ""
    }

    /// A string the engine returned, read and given back.
    private static func taken(_ pointer: UnsafeMutablePointer<CChar>?) -> String? {
        guard let pointer else { return nil }
        defer { wt_string_free(pointer) }
        return String(cString: pointer)
    }
}
