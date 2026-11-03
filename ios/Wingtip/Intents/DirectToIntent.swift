import AppIntents

/// "Direct to KFCM" to Siri, in one breath: the app opened and the route
/// flown direct to the field from where the airplane is (RootView, the
/// same lookup the radio's Direct To chip uses). The field is an
/// AirportEntity, so the phrase carries it. A navaid or a fix, which no
/// airport entity names, goes by DirectToPlaceIntent, which asks.
struct DirectToIntent: AppIntent {
    static let title: LocalizedStringResource = "Direct to an Airport"
    static let description = IntentDescription("Flies your route direct to an airport from where the airplane is.")
    static let openAppWhenRun: Bool = true

    @Parameter(title: "Airport", requestValueDialog: "Direct to which airport?")
    var airport: AirportEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Direct to \(\.$airport)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let ident = airport.id
        await MainActor.run { PendingCommand.shared.command = .directTo(place: ident) }
        return .result(dialog: "Direct to \(ident).")
    }
}

/// "Direct to Gopher" to Siri: the place said -- a navaid, a fix or a
/// field -- found near the route as a clearance's is (RootView, the
/// engine's spoken places), where DirectToIntent takes only a field.
/// The place is free text, asked for after the phrase, since a phrase
/// carries only an entity or an enum.
struct DirectToPlaceIntent: AppIntent {
    static let title: LocalizedStringResource = "Direct to a Fix"
    static let description = IntentDescription("Flies your route direct to a navaid, a fix or a field said by name from where the airplane is.")
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
