import AppIntents

/// The app's shortcuts, which Siri takes without setting up: the phrases
/// name the app, and a free-text place (a destination, a field) is asked
/// for after the phrase, since a phrase can carry only an entity or an
/// enum. Shown in the Shortcuts app and Spotlight as well.
struct WingtipShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: PlanTripIntent(),
            phrases: [
                "Plan a trip in \(.applicationName)",
                "Plan a trip with \(.applicationName)",
                "Plan a flight in \(.applicationName)",
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
                "Weather in \(.applicationName)",
                "Get the weather in \(.applicationName)",
            ],
            shortTitle: "Weather at a Field",
            systemImageName: "cloud.sun"
        )
        AppShortcut(
            intent: DirectToIntent(),
            phrases: [
                "Direct to in \(.applicationName)",
                "Go direct in \(.applicationName)",
            ],
            shortTitle: "Direct To",
            systemImageName: "location.north.line"
        )
    }
}
