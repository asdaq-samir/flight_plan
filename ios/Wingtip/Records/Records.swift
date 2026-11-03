import Foundation
import SwiftData

/// The pilot's own records on the device -- the airplanes kept as
/// Favorites and Recents, the watches set on them, the routes planned --
/// in one SwiftData store that iCloud carries to their other devices,
/// so a favourite set on the iPad is on the iPhone in the cockpit. They
/// were lists encoded into UserDefaults until 2026-11-03; `migrate`
/// takes those in once. CloudKit's rules are kept by every model here:
/// each attribute optional or given a value, and nothing unique, since
/// two devices may each make the same record before they meet
/// (`Tracking.reload` folds those together).
enum Records {
    static let schema = Schema([KeptAirplaneRecord.self, AirplaneWatchRecord.self, PlannedRoute.self])

    /// The one store, in Application Support beside the last plan. It
    /// goes to iCloud through the app's first container (the
    /// entitlements in project.yml); a build without that capability, or
    /// a store that will not open, still keeps the records on the device,
    /// and only when the disk itself fails are they kept in memory, so
    /// the app always starts.
    static let container: ModelContainer = {
        let url = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "records.store")
        let configurations = [
            ModelConfiguration(schema: schema, url: url, cloudKitDatabase: .automatic),
            ModelConfiguration(schema: schema, url: url, cloudKitDatabase: .none),
        ]
        for (configuration, place) in zip(configurations, ["with iCloud", "on the device"]) {
            do {
                return try ModelContainer(for: schema, configurations: [configuration])
            } catch {
                Log.records.error("the records store would not open \(place, privacy: .public): \(error.localizedDescription, privacy: .public)")
            }
        }
        // Cannot fail: an in-memory store with no file to open.
        return try! ModelContainer(for: schema, configurations: [ModelConfiguration(schema: schema, isStoredInMemoryOnly: true, cloudKitDatabase: .none)])
    }()

    /// A store that lives only as long as the test that made it.
    static func inMemory() throws -> ModelContainer {
        try ModelContainer(for: schema, configurations: [ModelConfiguration(schema: schema, isStoredInMemoryOnly: true, cloudKitDatabase: .none)])
    }

    /// The old UserDefaults keys, each read once into the store and then
    /// removed, so a second launch finds nothing to take in.
    enum OldKeys {
        static let favorites = KeptAirplane.key
        static let recents = "recentAircraft"
        static let watches = "aircraftWatches"
    }

    /// The lists the app kept in UserDefaults before the store, taken in
    /// on the first launch after it: a favourite that was also recent is
    /// one record with both flags; the keys are removed once read.
    static func migrate(from defaults: UserDefaults, into context: ModelContext) {
        let favorites = defaults.decoded([KeptAirplane].self, forKey: OldKeys.favorites) ?? []
        let recents = defaults.decoded([KeptAirplane].self, forKey: OldKeys.recents) ?? []
        let watches = defaults.decoded([AirplaneWatch].self, forKey: OldKeys.watches) ?? []
        guard !favorites.isEmpty || !recents.isEmpty || !watches.isEmpty else {
            for key in [OldKeys.favorites, OldKeys.recents, OldKeys.watches] { defaults.removeObject(forKey: key) }
            return
        }
        var records: [String: KeptAirplaneRecord] = [:]
        let now = Date()
        // The favourites in their order (addedAt a second apart keeps it).
        for (i, kept) in favorites.enumerated() {
            let record = KeptAirplaneRecord(hex: kept.hex, name: kept.name, type: kept.type)
            record.favorite = true
            record.addedAt = now.addingTimeInterval(Double(i) - Double(favorites.count))
            records[kept.hex] = record
        }
        // The recents newest first, as the list was kept.
        for (i, kept) in recents.enumerated() {
            let record = records[kept.hex] ?? KeptAirplaneRecord(hex: kept.hex, name: kept.name, type: kept.type)
            record.recent = true
            record.recentAt = now.addingTimeInterval(-Double(i))
            records[kept.hex] = record
        }
        for record in records.values { context.insert(record) }
        for watch in watches { context.insert(AirplaneWatchRecord(watch)) }
        try? context.save()
        for key in [OldKeys.favorites, OldKeys.recents, OldKeys.watches] { defaults.removeObject(forKey: key) }
    }

    /// Everything the store holds, gone: the account deleted
    /// (Session.deleteAccount), which iCloud carries to the other devices.
    static func erase(in context: ModelContext) {
        try? context.delete(model: KeptAirplaneRecord.self)
        try? context.delete(model: AirplaneWatchRecord.self)
        try? context.delete(model: PlannedRoute.self)
        try? context.save()
    }
}

/// An airplane the pilot kept (the web app's favoriteAircraft and
/// recentAircraft): one record per ICAO address, flagged with the lists
/// it is in, so a favourite that is also recent is one row and a
/// Favorites toggle does not touch the Recents. `addedAt` orders the
/// Favorites as they were added; `recentAt` the Recents, newest first.
@Model
final class KeptAirplaneRecord {
    var hex: String = ""
    var name: String = ""
    var type: String?
    var favorite: Bool = false
    var recent: Bool = false
    var addedAt: Date = Date()
    var recentAt: Date?

    init(hex: String, name: String, type: String?) {
        self.hex = hex
        self.name = name
        self.type = type
    }

    var kept: KeptAirplane { KeptAirplane(hex: hex, name: name, type: type) }
}

/// A watch set on an airplane (AirplaneWatch): its kind kept as the
/// enum's raw word, since a store carries words, not cases.
@Model
final class AirplaneWatchRecord {
    var hex: String = ""
    var name: String = ""
    var kind: String = AirplaneWatch.Kind.takeoff.rawValue
    var setAt: Date = Date()

    init(_ watch: AirplaneWatch) {
        hex = watch.hex
        name = watch.name
        kind = watch.kind.rawValue
    }

    /// nil for a kind a newer build wrote that this one does not know.
    var watch: AirplaneWatch? {
        AirplaneWatch.Kind(rawValue: kind).map { AirplaneWatch(hex: hex, name: name, kind: $0) }
    }
}
