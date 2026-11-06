import AppIntents

/// "Plan a trip to KLAS" to Siri or a Shortcut, in one breath: the field
/// an AirportEntity (so the phrase carries it; said as its ident, its
/// name or its town), and the app opened on a route to it from the
/// route's departure or the field nearest the airplane (RootView takes
/// the PendingCommand). At the owner's ask (2026-11-03): Apple's way to
/// Siri, Shortcuts and Spotlight is App Intents, so what the microphone
/// takes in the app Siri takes outside it too. A town or an address said
/// when Siri asks is found as the microphone finds one (AirportEntityQuery,
/// IntentLookups.field): the biggest field by it.
struct PlanTripIntent: AppIntent {
    static let title: LocalizedStringResource = "Plan a Trip"
    static let description = IntentDescription("Plans a route to an airport, from your route's departure or the field nearest you.")
    static let openAppWhenRun: Bool = true

    @Parameter(title: "Airport", requestValueDialog: "Where to?")
    var airport: AirportEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Plan a trip to \(\.$airport)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let ident = airport.id
        await MainActor.run { PendingCommand.shared.command = .planTo(ident: ident) }
        return .result(dialog: "Planning a trip to \(ident).")
    }
}
