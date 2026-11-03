import AppIntents

/// "Direct to Gopher" to Siri: the app opened and the route flown direct
/// to the place said from where the airplane is, the place found near
/// the route as a clearance's is (RootView, the same lookup the radio's
/// Direct To chip uses). The place is free text, asked for after the
/// phrase.
struct DirectToIntent: AppIntent {
    static let title: LocalizedStringResource = "Direct To"
    static let description = IntentDescription("Flies your route direct to a field, a navaid or a fix from where the airplane is.")
    static let openAppWhenRun: Bool = true

    @Parameter(title: "Place", requestValueDialog: "Direct to where?")
    var place: String

    static var parameterSummary: some ParameterSummary {
        Summary("Direct to \(\.$place)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let said = place.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !said.isEmpty else { return .result(dialog: "Say where to go direct to.") }
        await MainActor.run { PendingCommand.shared.command = .directTo(place: said) }
        return .result(dialog: "Direct to \(said).")
    }
}
