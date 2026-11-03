import AppIntents

/// "Plan a trip to Las Vegas" to Siri or a Shortcut: the field the place
/// means, found as the web app's microphone finds it (IntentLookups), and
/// the app opened on a route to it from the route's departure or the
/// field nearest the airplane (RootView takes the PendingCommand). At the
/// owner's ask (2026-11-03): Apple's way to Siri, Shortcuts and Spotlight
/// is App Intents, so what the microphone takes in the app Siri takes
/// outside it too. The destination is free text, which Siri asks for
/// after the phrase: a phrase can carry only an entity or an enum.
struct PlanTripIntent: AppIntent {
    static let title: LocalizedStringResource = "Plan a Trip"
    static let description = IntentDescription("Plans a route to a city, an address or an airport, from your route's departure or the field nearest you.")
    static let openAppWhenRun: Bool = true

    @Parameter(title: "Destination", requestValueDialog: "Where to?")
    var destination: String

    static var parameterSummary: some ParameterSummary {
        Summary("Plan a trip to \(\.$destination)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let ident: String?
        do {
            ident = try await IntentLookups.field(for: destination)
        } catch {
            return .result(dialog: "The planner could not be reached to find \(destination); check the connection.")
        }
        guard let ident else { return .result(dialog: "\(destination) was not found.") }
        await MainActor.run { PendingCommand.shared.command = .planTo(ident: ident) }
        return .result(dialog: "Planning a trip to \(ident).")
    }
}
