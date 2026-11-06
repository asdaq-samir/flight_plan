import Foundation

/// The next flight as the Home Screen and Lock Screen widgets show it
/// (FlightWidget in the WingtipWidgets extension): the route, the nav
/// log's totals, the Brief's Go / No-Go and the departure's weather, as
/// last seen in the app. The app writes it (WidgetFeed) and the
/// extension reads it, in the App Group's defaults, the one store the
/// two can share; compiled into both, so each sees one and the same
/// shape. The widget never asks the planner itself: this is the app's
/// own answer, with when it last changed.
struct WidgetSnapshot: Codable, Equatable, Sendable {
    /// The route's ends and stops, as the plan names them (C81, KDLH).
    var dep: String
    var dest: String
    var stops: [String]
    /// The nav log's totals; nil until the log is whole.
    var distanceNm: Double?
    var eteMin: Double?
    var fuelGal: Double?
    /// The Brief's verdict as the planner finds it -- "ok", "caution",
    /// "stop" or "pending" (the web's lib/status) -- and its words; nil
    /// where none has been asked for this route.
    var verdict: String?
    var verdictWords: String?
    /// The departure's METAR as sent, its flight category and its wind
    /// in words; nil where no report is near the field.
    var depMetarRaw: String?
    var depFlightCategory: String?
    var depWind: String?
    /// When any of this last changed.
    var updatedAt: Date

    /// The App Group both targets are entitled to (project.yml), and the
    /// key the snapshot is kept under in its defaults.
    static let suite = "group.app.wingtipmaps"
    static let key = "widgetSnapshot"

    /// The App Group's defaults; nil where the group is not set up, so a
    /// build without the entitlement reads and writes nothing.
    static var store: UserDefaults? { UserDefaults(suiteName: suite) }

    /// The snapshot the app last wrote; nil before the first, or with no
    /// flight planned.
    static func read(from store: UserDefaults? = WidgetSnapshot.store) -> WidgetSnapshot? {
        guard let data = store?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    func write(to store: UserDefaults? = WidgetSnapshot.store) {
        guard let data = try? JSONEncoder().encode(self) else { return }
        store?.set(data, forKey: Self.key)
    }

    /// No flight planned: the widget shows its empty state.
    static func clear(from store: UserDefaults? = WidgetSnapshot.store) {
        store?.removeObject(forKey: key)
    }
}
