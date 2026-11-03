import Foundation
import WingtipEngine

/// What the map draws, from the packs kept on the phone (the engine's
/// view module through wt_airspace_in_view, wt_airports_in_view and
/// wt_navaids_in_view): the planner's own answers for /api/airspace/in-view,
/// /api/airports/in-view and /api/navaids/in-view, worked out on the phone
/// from the regions the pilot keeps, so a pan in flight with no signal
/// still has its fields, rings and VORs (PackMapData asks here first).
/// A field's live flight category is the planner's alone: null here.
extension CyclePacks {
    /// The packs of every region the box touches, mapped for one call; nil
    /// where none of them was ever kept.
    private func packs(south: Double, west: Double, north: Double, east: Double) -> [Data]? {
        guard let index else { return nil }
        // The regions are 4° squares (Engine.region): every 2° across the
        // box and its far edges names each one the box touches.
        var names = Set<String>()
        var lat = south
        while lat <= north + 2 {
            var lon = west
            while lon <= east + 2 {
                names.insert(Engine.region(lat: min(lat, north), lon: min(lon, east)))
                lon += 2
            }
            lat += 2
        }
        let packs = names.sorted().compactMap { try? Data(contentsOf: path(cycle: index.cycle, region: $0), options: .alwaysMapped) }
        return packs.isEmpty ? nil : packs
    }

    /// One of the engine's in-view answers, decoded as the planner's.
    private func inView<T: Decodable>(_ type: T.Type, south: Double, west: Double, north: Double, east: Double,
                                      _ call: (UnsafePointer<UnsafePointer<UInt8>?>?, UnsafePointer<Int>?, Int, Double, Double, Double, Double) -> UnsafeMutablePointer<CChar>?) -> T? {
        guard let packs = packs(south: south, west: west, north: north, east: east) else { return nil }
        let answer: UnsafeMutablePointer<CChar>? = Self.withPointers(packs[...], [], []) { ptrs, lens in
            ptrs.withUnsafeBufferPointer { p in
                lens.withUnsafeBufferPointer { l in
                    call(p.baseAddress, l.baseAddress, ptrs.count, south, west, north, east)
                }
            }
        }
        guard let answer else { return nil }
        defer { wt_string_free(answer) }
        return try? Planner.snakeCase.decode(T.self, from: Data(String(cString: answer).utf8))
    }

    /// The fields in the box (AirportsInView), biggest first; nil with no pack.
    func airportsInView(south: Double, west: Double, north: Double, east: Double) -> [AirportPin]? {
        struct Answer: Decodable { let airports: [AirportPin] }
        return inView(Answer.self, south: south, west: west, north: north, east: east, wt_airports_in_view)?.airports
    }

    /// The Class B, C, D and surface E volumes in the box with their rings
    /// (AirspaceInView), as JSON text for the map's own decoder; nil with no pack.
    func airspaceInView(south: Double, west: Double, north: Double, east: Double) -> Data? {
        guard let packs = packs(south: south, west: west, north: north, east: east) else { return nil }
        let answer: UnsafeMutablePointer<CChar>? = Self.withPointers(packs[...], [], []) { ptrs, lens in
            ptrs.withUnsafeBufferPointer { p in
                lens.withUnsafeBufferPointer { l in
                    wt_airspace_in_view(p.baseAddress, l.baseAddress, ptrs.count, south, west, north, east)
                }
            }
        }
        guard let answer else { return nil }
        defer { wt_string_free(answer) }
        return Data(String(cString: answer).utf8)
    }

    /// The VORs in the box (NavaidsInView's vors); nil with no pack.
    func navaidsInView(south: Double, west: Double, north: Double, east: Double) -> Data? {
        guard let packs = packs(south: south, west: west, north: north, east: east) else { return nil }
        let answer: UnsafeMutablePointer<CChar>? = Self.withPointers(packs[...], [], []) { ptrs, lens in
            ptrs.withUnsafeBufferPointer { p in
                lens.withUnsafeBufferPointer { l in
                    wt_navaids_in_view(p.baseAddress, l.baseAddress, ptrs.count, south, west, north, east)
                }
            }
        }
        guard let answer else { return nil }
        defer { wt_string_free(answer) }
        return Data(String(cString: answer).utf8)
    }

    /// Each pack's bytes held for the one call (as Ahead.swift holds them).
    static func withPointers<R>(_ packs: ArraySlice<Data>, _ ptrs: [UnsafePointer<UInt8>?], _ lens: [Int],
                                _ body: ([UnsafePointer<UInt8>?], [Int]) -> R) -> R {
        guard let first = packs.first else { return body(ptrs, lens) }
        return first.withUnsafeBytes { raw in
            withPointers(packs.dropFirst(), ptrs + [raw.bindMemory(to: UInt8.self).baseAddress], lens + [raw.count], body)
        }
    }
}
