import AppIntents

/// The app's shortcuts, which Siri takes without setting up: each phrase
/// names the app, and the airport in it is an AirportEntity, so "Plan a
/// trip to KLAS in Wingtip Maps" goes in one breath. Siri listens for the
/// fields the entity suggests (the kept route's, the Favorites, the
/// Recents: AirportEntityQuery.suggestedEntities), so the app calls
/// `updateAppShortcutParameters()` when those change. A navaid or a fix
/// for Direct To is free text, asked for after the phrase. Shown in the
/// Shortcuts app and Spotlight as well.
struct WingtipShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: PlanTripIntent(),
            phrases: [
                "Plan a trip to \(\.$airport) in \(.applicationName)",
                "Plan a flight to \(\.$airport) in \(.applicationName)",
                "Fly to \(\.$airport) in \(.applicationName)",
                "Plan a trip in \(.applicationName)",
            ],
            shortTitle: "Plan a Trip",
            systemImageName: "airplane"
        )
        AppShortcut(
            intent: NearestAirportsIntent(),
            phrases: [
                "Nearest airports in \(.applicationName)",
                "Show the nearest airports in \(.applicationName)",
            ],
            shortTitle: "Nearest Airports",
            systemImageName: "mappin.and.ellipse"
        )
        AppShortcut(
            intent: WeatherAtIntent(),
            phrases: [
                "Weather at \(\.$airport) in \(.applicationName)",
                "Get the weather at \(\.$airport) in \(.applicationName)",
                "Weather in \(.applicationName)",
            ],
            shortTitle: "Weather at an Airport",
            systemImageName: "cloud.sun"
        )
        AppShortcut(
            intent: DirectToIntent(),
            phrases: [
                "Direct to \(\.$airport) in \(.applicationName)",
                "Go direct to \(\.$airport) in \(.applicationName)",
            ],
            shortTitle: "Direct to an Airport",
            systemImageName: "location.north.line"
        )
        AppShortcut(
            intent: DirectToPlaceIntent(),
            phrases: [
                "Direct to a fix in \(.applicationName)",
                "Go direct in \(.applicationName)",
            ],
            shortTitle: "Direct to a Fix",
            systemImageName: "point.topleft.down.to.point.bottomright.curvepath"
        )
    }
}
