import CoreData
import CoreLocation
import Foundation
import Observation
import SwiftData
import UIKit

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
    /// The Favorites, the Recents (newest first) and the watches, as the
    /// store holds them (Records): read whole after each change and when
    /// iCloud brings another device's, since the lists are a dozen rows
    /// and the views want arrays.
    private(set) var favorites: [KeptAirplane] = []
    private(set) var recents: [KeptAirplane] = []
    private(set) var watches: [AirplaneWatch] = []
    @ObservationIgnored private let context: ModelContext
    /// The store the context is of, held: a context keeps no hold on its
    /// container, and one given here and dropped by its maker (a test's in
    /// memory) was freed under it, SwiftData trapping at the next insert.
    @ObservationIgnored private let container: ModelContainer
    @ObservationIgnored private var remote: Task<Void, Never>?
    /// The last watch that went off, for the banner over the map.
    var fired: String?
    /// Whether each watched airplane was in the air, where known.
    private var airborne: [String: Bool] = [:]

    /// At most this many points of a tracked flight's path, as the web
    /// app's PATH_POINTS.
    static let pathPoints = 2000
    /// Recents kept, newest first.
    static let recentCount = 12

    /// The app's store, and the UserDefaults the lists were in before
    /// it, taken in on the first launch after the change; a test gives
    /// its own of each.
    init(container: ModelContainer = Records.container, defaults: UserDefaults = .standard) {
        self.container = container
        context = container.mainContext
        Records.migrate(from: defaults, into: context)
        reload()
        // Another device's change, brought by iCloud, read in as it lands.
        remote = Task { [weak self] in
            for await _ in NotificationCenter.default.notifications(named: .NSPersistentStoreRemoteChange) {
                self?.reload()
            }
        }
    }

    /// The lists from the store. Two devices that each kept the same
    /// airplane before they met have two records of it: they are folded
    /// into one here, with both lists' flags, so neither shows twice.
    func reload() {
        let kept = (try? context.fetch(FetchDescriptor<KeptAirplaneRecord>(sortBy: [SortDescriptor(\.addedAt)]))) ?? []
        var one: [String: KeptAirplaneRecord] = [:]
        for record in kept {
            guard let first = one[record.hex] else { one[record.hex] = record; continue }
            first.favorite = first.favorite || record.favorite
            first.recent = first.recent || record.recent
            first.recentAt = [first.recentAt, record.recentAt].compactMap { $0 }.max()
            context.delete(record)
        }
        let planes = one.values.sorted { $0.addedAt < $1.addedAt }
        favorites = planes.filter(\.favorite).map(\.kept)
        recents = planes.filter(\.recent).sorted { ($0.recentAt ?? .distantPast) > ($1.recentAt ?? .distantPast) }.map(\.kept)
        let watched = (try? context.fetch(FetchDescriptor<AirplaneWatchRecord>(sortBy: [SortDescriptor(\.setAt)]))) ?? []
        watches = watched.compactMap(\.watch)
        if context.hasChanges { try? context.save() }
    }

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

    func toggleFavorite(_ kept: KeptAirplane) {
        let record = self.record(kept)
        record.favorite.toggle()
        if record.favorite { record.addedAt = Date() }
        prune(record)
        saved()
    }

    func remember(_ kept: KeptAirplane) {
        let record = self.record(kept)
        record.recent = true
        record.recentAt = Date()
        record.name = kept.name
        record.type = kept.type ?? record.type
        // The oldest beyond a dozen leave the Recents, and the store
        // where they were only recent.
        let recent = ((try? context.fetch(FetchDescriptor<KeptAirplaneRecord>(predicate: #Predicate { $0.recent == true }))) ?? [])
            .sorted { ($0.recentAt ?? .distantPast) > ($1.recentAt ?? .distantPast) }
        for old in recent.dropFirst(Self.recentCount) {
            old.recent = false
            prune(old)
        }
        saved()
    }

    func forget(recent hex: String) {
        for record in records(hex) {
            record.recent = false
            prune(record)
        }
        saved()
    }

    /// Signing out: the Favorites are the pilot's own, the Recents the
    /// device's (Session.forgetPilot).
    func forgetFavorites() {
        for record in (try? context.fetch(FetchDescriptor<KeptAirplaneRecord>(predicate: #Predicate { $0.favorite == true }))) ?? [] {
            record.favorite = false
            prune(record)
        }
        saved()
    }

    /// The account deleted: every record, here and on iCloud.
    func erase() {
        Records.erase(in: context)
        reload()
    }

    private func records(_ hex: String) -> [KeptAirplaneRecord] {
        let hex = hex.lowercased()
        return (try? context.fetch(FetchDescriptor<KeptAirplaneRecord>(predicate: #Predicate { $0.hex == hex }))) ?? []
    }

    /// The airplane's record, made where it has none.
    private func record(_ kept: KeptAirplane) -> KeptAirplaneRecord {
        if let had = records(kept.hex).first { return had }
        let record = KeptAirplaneRecord(hex: kept.hex.lowercased(), name: kept.name, type: kept.type)
        context.insert(record)
        return record
    }

    /// A record in neither list is no record.
    private func prune(_ record: KeptAirplaneRecord) {
        if !record.favorite, !record.recent { context.delete(record) }
    }

    /// A change kept, and the lists read back from it.
    private func saved() {
        try? context.save()
        reload()
    }

    // MARK: Watches

    func watching(_ hex: String, _ kind: AirplaneWatch.Kind) -> Bool { watches.contains { $0.hex == hex.lowercased() && $0.kind == kind } }

    func toggleWatch(_ watch: AirplaneWatch) {
        if watches.contains(watch) {
            remove(watch)
        } else {
            context.insert(AirplaneWatchRecord(watch))
            // A watch is asked for so as to be told: the moment to ask for
            // notifications, where the pilot sees what they are for.
            Task { await Notifications.allow() }
        }
        saved()
    }

    /// A watch let go: gone off, or turned off on the card.
    private func remove(_ watch: AirplaneWatch) {
        let (hex, kind) = (watch.hex, watch.kind.rawValue)
        let found = (try? context.fetch(FetchDescriptor<AirplaneWatchRecord>(predicate: #Predicate { $0.hex == hex && $0.kind == kind }))) ?? []
        for record in found { context.delete(record) }
    }

    /// Whether the airplane is in the air (the engine's `airborne_now`,
    /// the web app's airborneNow): in the air where heard there; on the
    /// ground where it has landed, or where nothing was known and it has
    /// not been heard for half an hour or ever (parked out of the
    /// receivers' hearing); else what was known, as one gone quiet in the
    /// pattern has not landed until it is known to have. What was known
    /// where the engine cannot answer.
    static func airborneNow(before: Bool?, _ now: FlightStatus) -> Bool? {
        do {
            return try Engine.call("airborne_now", json: [
                "before": before, "airborne": now.airborne == true, "arrived": now.arrived != nil, "heard_s": now.heardS,
            ])
        } catch {
            return before
        }
    }

    /// The words a watch goes off with, or nil where it has not: "N654FL
    /// took off from 10C", "N654FL landed at KDAW". Whether it goes off is
    /// the engine's (`alert_fires`: off where it was known on the ground
    /// and is in the air, down where it was in the air and has arrived at a
    /// field); the words are the app's.
    static func fired(_ watch: AirplaneWatch, before: Bool?, now: Bool?, status: FlightStatus) -> String? {
        let go: EngineAlertFiresAnswer? = try? Engine.call("alert_fires", json: [
            "kind": watch.kind.rawValue, "before_airborne": before, "airborne": now, "arrived": status.arrived != nil,
        ])
        guard go?.fires == true else { return nil }
        switch watch.kind {
        case .takeoff:
            return status.departed.map { "\(watch.name) took off from \($0.ident)" } ?? "\(watch.name) took off"
        case .land:
            guard let field = status.arrived else { return nil }
            return "\(watch.name) landed at \(field.ident)"
        }
    }

    /// While the map is shown: the tracked airplane's state every ten
    /// seconds, where the map's own answers do not have it (it is out of
    /// their radius), and each watched airplane's every fifteen; both on
    /// the app's one clock (Ticker), twice as slow with the app put away.
    func run() async {
        let tracked = Ticker.shared.every(5) { [weak self] in await self?.askTracked() }
        let watched = Ticker.shared.every(15) { [weak self] in await self?.askWatched() }
        defer {
            tracked.cancel()
            watched.cancel()
        }
        await Ticker.untilCancelled()
    }

    /// The tracked airplane's report, where none has come in ten seconds.
    private func askTracked() async {
        guard let hex, latestAt.map({ Date().timeIntervalSince($0) > 10 }) ?? true,
              let status = try? await Planner.flightStatus(hex), let plane = status.aircraft else { return }
        reported(plane, at: Date().addingTimeInterval(-(plane.seenS ?? 0)))
    }

    /// Each watched airplane's state, and any watch that goes off on it.
    private func askWatched() async {
        for hex in Set(watches.map(\.hex)) {
            let status: FlightStatus
            do {
                status = try await Planner.flightStatus(hex)
            } catch {
                Log.records.notice("the watched airplane \(hex, privacy: .public) could not be asked about: \(error.localizedDescription, privacy: .public)")
                continue
            }
            let before = airborne[hex]
            let now = Self.airborneNow(before: before, status)
            for watch in watches where watch.hex == hex {
                if let words = Self.fired(watch, before: before, now: now, status: status) {
                    Log.records.notice("watch went off: \(words, privacy: .public)")
                    // The banner over the map and the voice in the app; a
                    // time-sensitive notification with the app put away.
                    fired = words
                    SpokenAlerts.shared.say("\(words).", force: true)
                    Notifications.tell(watch.kind == .takeoff ? "Took off" : "Landed", words, id: watch.id)
                    remove(watch)
                    saved()
                }
            }
            if let now { airborne[hex] = now }
        }
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
