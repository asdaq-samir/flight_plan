import CoreLocation
import Foundation
import Observation
import UIKit

/// An airplane kept by this device: by its ICAO address, the name it is
/// known by (its registration first) and its type, as the web app's
/// Favorites and Recents keep one (lib/preferences KeptAircraft).
struct KeptAircraft: Codable, Hashable, Sendable, Identifiable {
    let hex: String
    let name: String
    var type: String?

    var id: String { hex }
}

/// A point of a flown path: when (s since 1970), where, how high (feet;
/// nil on the ground or where it was not sent).
struct PathPoint: Codable, Equatable, Sendable {
    let t: Double
    let lat: Double
    let lon: Double
    let altFt: Double?

    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lon) }
}

/// What a pilot asked to be told of an airplane, from its card (the web
/// app's lib/aircraftAlerts): that it takes off, or that it lands. Said
/// once, aloud and over the map, then let go, as FlightAware's are.
struct AirplaneWatch: Codable, Hashable, Sendable, Identifiable {
    enum Kind: String, Codable, Sendable { case takeoff, land }
    let hex: String
    let name: String
    let kind: Kind

    var id: String { "\(hex):\(kind.rawValue)" }
}

/// An airplane being tracked, as FlightAware and ForeFlight track one (the
/// web app's lib/map/tracking): which, whether the map keeps it in the
/// middle, its last report and the path flown since its trace was read;
/// a past flight of it picked, and the pilot's own flown track, drawn on
/// the map in their heights' colours. With the airplanes kept as
/// Favorites and Recents, and the watches set on them.
@MainActor
@Observable
final class Tracking {
    static let shared = Tracking()

    private(set) var hex: String?
    /// The map keeps it in the middle until the pilot drags the map.
    var follow = true
    private(set) var latest: TrafficAircraft?
    private(set) var latestAt: Date?
    private(set) var path: [PathPoint] = []
    /// A past flight picked on its card.
    var past: [PathPoint] = []
    /// The pilot's own flown track, shown from a saved flight.
    var flown: [PathPoint] = []
    private(set) var favorites: [KeptAircraft] = Tracking.load("favoriteAircraft")
    private(set) var recents: [KeptAircraft] = Tracking.load("recentAircraft")
    private(set) var watches: [AirplaneWatch] = Tracking.load("aircraftWatches")
    /// The last watch that went off, for the banner over the map.
    var fired: String?
    /// Whether each watched airplane was in the air, where known.
    private var airborne: [String: Bool] = [:]

    /// At most this many points of a tracked flight's path, as the web
    /// app's PATH_POINTS.
    static let pathPoints = 2000
    /// Recents kept, newest first.
    static let recentCount = 12

    /// A flight tracked from now, the map following it; its report where
    /// the one picking it has it, so its card and the map have it at once.
    func track(_ hex: String?, plane: TrafficAircraft? = nil) {
        let hex = hex?.lowercased()
        guard hex != self.hex else { return }
        self.hex = hex
        follow = true
        path = []
        past = []
        latest = plane
        latestAt = plane.map { Date().addingTimeInterval(-($0.seenS ?? 0)) }
    }

    /// Today's trace, read once its card has it: the path before the
    /// reports heard since.
    func seed(_ trail: [TrailPoint], for hex: String) {
        guard hex.lowercased() == self.hex, !trail.isEmpty else { return }
        let first = path.first?.t ?? .infinity
        let before = trail.filter { $0.t < first }.map { PathPoint(t: $0.t, lat: $0.lat, lon: $0.lon, altFt: $0.altFt) }
        path = Array((before + path).suffix(Self.pathPoints))
    }

    /// A report of the tracked airplane: its latest, and a point of its path.
    func reported(_ plane: TrafficAircraft, at: Date) {
        guard plane.hex.lowercased() == hex else { return }
        if let latestAt, at <= latestAt, latest != nil, path.last != nil { return }
        latest = plane
        latestAt = at
        path = Array((path + [PathPoint(t: at.timeIntervalSince1970, lat: plane.lat, lon: plane.lon, altFt: plane.altitudeFt)]).suffix(Self.pathPoints))
    }

    /// The map's airplanes, each answer: the tracked one's report among them.
    func heard(_ planes: [TrafficAircraft]) {
        guard let hex, let plane = planes.first(where: { $0.hex.lowercased() == hex }) else { return }
        reported(plane, at: Date().addingTimeInterval(-(plane.seenS ?? 0)))
    }

    // MARK: Favorites and Recents

    func isFavorite(_ hex: String) -> Bool { favorites.contains { $0.hex == hex.lowercased() } }

    func toggleFavorite(_ kept: KeptAircraft) {
        if isFavorite(kept.hex) { favorites.removeAll { $0.hex == kept.hex } } else { favorites.append(kept) }
        Self.save(favorites, "favoriteAircraft")
    }

    func remember(_ kept: KeptAircraft) {
        recents = Array(([kept] + recents.filter { $0.hex != kept.hex }).prefix(Self.recentCount))
        Self.save(recents, "recentAircraft")
    }

    func forget(recent hex: String) {
        recents.removeAll { $0.hex == hex }
        Self.save(recents, "recentAircraft")
    }

    // MARK: Watches

    func watching(_ hex: String, _ kind: AirplaneWatch.Kind) -> Bool { watches.contains { $0.hex == hex.lowercased() && $0.kind == kind } }

    func toggleWatch(_ watch: AirplaneWatch) {
        if watches.contains(watch) { watches.removeAll { $0 == watch } } else { watches.append(watch) }
        Self.save(watches, "aircraftWatches")
    }

    /// Whether the airplane is in the air (the web app's airborneNow): in
    /// the air where heard there; on the ground where it has landed, or
    /// where nothing was known and it has not been heard for half an hour
    /// or ever (parked out of the receivers' hearing, PARKED_UNHEARD_S);
    /// else what was known, as one gone quiet in the pattern has not
    /// landed until it is known to have.
    static func airborneNow(before: Bool?, _ now: FlightStatus) -> Bool? {
        if now.airborne == true { return true }
        if now.arrived != nil { return false }
        if before == nil { return now.heardS == nil || (now.heardS ?? 0) >= 30 * 60 ? false : nil }
        return before
    }

    /// The words a watch goes off with, or nil where it has not: "N654FL
    /// took off from 10C", "N654FL landed at KDAW".
    static func fired(_ watch: AirplaneWatch, before: Bool?, now: Bool?, status: FlightStatus) -> String? {
        switch watch.kind {
        case .takeoff:
            guard before == false, now == true else { return nil }
            return status.departed.map { "\(watch.name) took off from \($0.ident)" } ?? "\(watch.name) took off"
        case .land:
            guard before == true, now == false, let field = status.arrived else { return nil }
            return "\(watch.name) landed at \(field.ident)"
        }
    }

    /// While the map is shown: the tracked airplane's state every ten
    /// seconds, where the map's own answers do not have it (it is out of
    /// their radius), and each watched airplane's every fifteen.
    func run() async {
        var tick = 0
        while !Task.isCancelled {
            if let hex, latestAt.map({ Date().timeIntervalSince($0) > 10 }) ?? true,
               let status = try? await Planner.flightStatus(hex), let plane = status.aircraft {
                reported(plane, at: Date().addingTimeInterval(-(plane.seenS ?? 0)))
            }
            if tick % 3 == 0 {
                for hex in Set(watches.map(\.hex)) {
                    guard let status = try? await Planner.flightStatus(hex) else { continue }
                    let before = airborne[hex]
                    let now = Self.airborneNow(before: before, status)
                    for watch in watches where watch.hex == hex {
                        if let words = Self.fired(watch, before: before, now: now, status: status) {
                            fired = words
                            SpokenAlerts.shared.say("\(words).", force: true)
                            watches.removeAll { $0 == watch }
                            Self.save(watches, "aircraftWatches")
                        }
                    }
                    if let now { airborne[hex] = now }
                }
            }
            tick += 1
            try? await Task.sleep(for: .seconds(5))
        }
    }

    // MARK: Kept on the device

    nonisolated private static func load<T: Decodable>(_ key: String) -> [T] {
        guard let data = UserDefaults.standard.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([T].self, from: data)) ?? []
    }

    nonisolated private static func save<T: Encodable>(_ items: [T], _ key: String) {
        UserDefaults.standard.set(try? JSONEncoder().encode(items), forKey: key)
    }
}

/// A flown path's colour by its height, as FlightAware colours a track
/// and the web app does (heightColour): green from the ground through
/// yellow and orange to red at 30,000 ft and purple at 40,000 and above;
/// grey on the ground. A design choice, no rule.
enum HeightColour {
    /// The hue, degrees, of a height; nil on the ground.
    static func hue(_ altFt: Double?) -> Double? {
        guard let altFt else { return nil }
        let t = min(1, max(0, altFt / 40_000))
        return ((120 - 180 * t) + 360).truncatingRemainder(dividingBy: 360)
    }

    /// The colour: the web app's hsl(h 85% 45%), in hue, saturation and
    /// brightness; iOS's grey on the ground.
    static func colour(_ altFt: Double?) -> UIColor {
        guard let hue = hue(altFt) else { return .systemGray }
        return UIColor(hue: hue / 360, saturation: 0.919, brightness: 0.8325, alpha: 1)
    }

    /// A path in runs of one colour (its height to the 1,000 ft), each run
    /// starting where the last ended so the line is whole.
    static func runs(_ path: [PathPoint]) -> [(band: Double?, points: [CLLocationCoordinate2D])] {
        var runs: [(band: Double?, points: [CLLocationCoordinate2D])] = []
        for (i, point) in path.enumerated() {
            let band = point.altFt.map { ($0 / 1000).rounded() * 1000 }
            if let last = runs.last, last.band == band {
                runs[runs.count - 1].points.append(point.coordinate)
            } else {
                runs.append((band, i > 0 ? [path[i - 1].coordinate, point.coordinate] : [point.coordinate]))
            }
        }
        return runs
    }
}
