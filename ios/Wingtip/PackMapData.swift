import Foundation
import os

/// What the map draws, from the phone's own cycle packs where the engine
/// can answer from them and from the planner otherwise. The packs hold
/// the airports, navaids and airspace of the regions the pilot keeps
/// (vfr.pack's write_phone; the engine's phone module), and the engine's
/// in-view rules read them with no network, as the airspace at a point
/// is read today. Asked first, so a pan in flight with no signal still
/// has its fields; the planner's answer is the fallback, and the one
/// source for a region with no pack. The engine's answers are the
/// planner's own shapes (snake case, AirportsInView and the rest), so one
/// decoder serves both. The owner's ask, 2026-11-03: the map's data from
/// the packs, for speed in flight and for the air with no signal.
enum PackMapData {
    static let log = Logger(subsystem: "app.wingtipmaps.ios", category: "packs")

    /// The planner's answers' snake case into Models.swift, as Planner's
    /// own decoder reads them.
    private static let snakeCase: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()

    /// The rules the engine has not answered yet, each said once in the
    /// log rather than at every pan: a name not in this build's engine,
    /// or no pack for the region, both reasons to ask the planner.
    private static let fallenBack = OSAllocatedUnfairLock(initialState: Set<String>())

    private static func box(south: Double, west: Double, north: Double, east: Double) -> [String: Any?] {
        ["box": ["south": south, "west": west, "north": north, "east": east]]
    }

    /// The engine's answer for `name` decoded as the planner's, or nil
    /// where the engine has no such rule or no pack for the box.
    private static func fromPacks<T: Decodable>(_ type: T.Type, _ name: String, south: Double, west: Double, north: Double, east: Double) -> T? {
        do {
            return try Engine.call(name, json: box(south: south, west: west, north: north, east: east), decoder: snakeCase)
        } catch {
            let first = fallenBack.withLock { seen -> Bool in seen.insert(name).inserted }
            if first { log.debug("\(name, privacy: .public): the planner answers instead (\(String(describing: error), privacy: .public))") }
            return nil
        }
    }

    /// The fields in the box: the packs' (pack_airports_in_view), else the
    /// planner's /api/airports/in-view.
    static func airports(south: Double, west: Double, north: Double, east: Double) async throws -> [AirportPin] {
        struct Answer: Decodable { let airports: [AirportPin] }
        if let kept = fromPacks(Answer.self, "pack_airports_in_view", south: south, west: west, north: north, east: east) {
            return kept.airports
        }
        return try await Planner.airports(south: south, west: west, north: north, east: east)
    }
}
