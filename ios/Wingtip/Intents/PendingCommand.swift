import Foundation
import Observation

/// What Siri or a Shortcut asked for (the App Intents beside this), or a
/// link opened in the app (Links), kept until the app is on the screen to
/// do it: an intent runs before the scene it opens has drawn, so it
/// leaves its ask here and the root view takes it (RootView, `.task(id:)`
/// on the command). One at a time; the last asked wins, as the pilot's
/// last word to Siri does.
@MainActor
@Observable
final class PendingCommand {
    static let shared = PendingCommand()

    enum Command: Equatable, Sendable {
        /// A route to the field, from the route's departure or the field
        /// nearest the airplane ("plan a trip to Las Vegas").
        case planTo(ident: String)
        /// A whole route, as a shared link carries one.
        case planRoute(dep: String, stops: [String], dest: String)
        /// Direct to the place said, from where the airplane is.
        case directTo(place: String)
        /// The nearest airports, in the Airport tab.
        case nearest
        /// A field's card, for its weather.
        case weather(ident: String)
        /// An airplane tracked, by its ICAO address, from a shared link.
        case aircraft(hex: String)
        /// A track file (GPX, KML) opened in the app, flown again on the map.
        case track(URL)
    }

    var command: Command?

    /// The command, and none left: taken once by whoever does it.
    func take() -> Command? {
        defer { command = nil }
        return command
    }
}
