import AppIntents

/// "Nearest airports" to Siri: the app opened on the Airport tab's Nearest
/// list, the fields round the phone nearest first (AirportShelf), as the
/// microphone's Nearest Airports chip opens it in the web app.
struct NearestAirportsIntent: AppIntent {
    static let title: LocalizedStringResource = "Nearest Airports"
    static let description = IntentDescription("Opens the airports nearest you, nearest first.")
    static let openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult & ProvidesDialog {
        await MainActor.run { PendingCommand.shared.command = .nearest }
        return .result(dialog: "Showing the nearest airports.")
    }
}
