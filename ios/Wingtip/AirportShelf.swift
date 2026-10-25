import Foundation
import Observation

/// An airport kept on the device: a Favorite or one opened lately, with
/// its name and town so the strip reads without asking the planner
/// (the web app's favoriteAirports and recents, lib/preferences).
struct KeptAirport: Codable, Equatable, Sendable, Identifiable, Hashable {
    let ident: String
    let name: String
    var municipality: String?
    var lat: Double
    var lon: Double

    var id: String { ident }

    init(ident: String, name: String, municipality: String? = nil, lat: Double, lon: Double) {
        self.ident = ident
        self.name = name
        self.municipality = municipality
        self.lat = lat
        self.lon = lon
    }

    init(_ place: AirportPlace) {
        self.init(ident: place.ident, name: place.name, municipality: place.municipality, lat: place.lat, lon: place.lon)
    }
}

/// What the Airport tab's strip shows, picked from the filter menu at
/// its heading's right (the owner's, 2026-10-15).
enum AirportShows: String, CaseIterable, Codable, Sendable {
    case favorites, recents, nearest

    var title: String {
        switch self {
        case .favorites: "Favorites"
        case .recents: "Recents"
        case .nearest: "Nearest"
        }
    }
}

/// The Airport tab's Favorites and Recents, and which of them -- or the
/// nearest fields -- its strip shows, kept on the device as the web app
/// keeps them in the browser. One shelf for the app.
@MainActor
@Observable
final class AirportShelf {
    static let shared = AirportShelf()

    typealias Shows = AirportShows

    /// As many recents as the web app keeps.
    static let recentsKept = 20

    private(set) var favorites: [KeptAirport] = []
    private(set) var recents: [KeptAirport] = []
    private(set) var shows: Shows = .favorites

    func show(_ list: Shows) {
        shows = list
        defaults.set(list.rawValue, forKey: Keys.shows)
    }

    private let defaults: UserDefaults

    enum Keys {
        static let favorites = "airport.favorites"
        static let recents = "airport.recents"
        static let shows = "airport.shows"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        favorites = Self.read(Keys.favorites, from: defaults)
        recents = Self.read(Keys.recents, from: defaults)
        shows = defaults.string(forKey: Keys.shows).flatMap(Shows.init(rawValue:)) ?? .favorites
    }

    func isFavorite(_ ident: String) -> Bool { favorites.contains { $0.ident == ident } }

    /// The star: a Favorite added at the end, or taken off.
    func toggleFavorite(_ airport: KeptAirport) {
        if let at = favorites.firstIndex(where: { $0.ident == airport.ident }) {
            favorites.remove(at: at)
        } else {
            favorites.append(airport)
        }
        save(favorites, Keys.favorites)
    }

    func removeFavorites(at offsets: IndexSet) {
        favorites.remove(atOffsets: offsets)
        save(favorites, Keys.favorites)
    }

    func moveFavorites(from offsets: IndexSet, to destination: Int) {
        favorites.move(fromOffsets: offsets, toOffset: destination)
        save(favorites, Keys.favorites)
    }

    /// A card opened: the field first in Recents, once.
    func opened(_ airport: KeptAirport) {
        recents.removeAll { $0.ident == airport.ident }
        recents.insert(airport, at: 0)
        if recents.count > Self.recentsKept { recents.removeLast(recents.count - Self.recentsKept) }
        save(recents, Keys.recents)
    }

    func removeRecents(at offsets: IndexSet) {
        recents.remove(atOffsets: offsets)
        save(recents, Keys.recents)
    }

    func clearRecents() {
        recents = []
        save(recents, Keys.recents)
    }

    private func save(_ list: [KeptAirport], _ key: String) {
        if let data = try? JSONEncoder().encode(list) { defaults.set(data, forKey: key) }
    }

    private static func read(_ key: String, from defaults: UserDefaults) -> [KeptAirport] {
        guard let data = defaults.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([KeptAirport].self, from: data)) ?? []
    }
}
