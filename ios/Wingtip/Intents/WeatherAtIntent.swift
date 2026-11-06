import AppIntents

/// "Weather at KMKE" to Siri, in one breath: the field's METAR said as a
/// briefer says it (IntentLookups.metarWords, the web's lib/metarWords
/// to the word), without opening the app, as the microphone's Weather
/// chip says it in the app. The field is an AirportEntity, so the phrase
/// carries it; a town said when Siri asks is found as the microphone
/// finds one (AirportEntityQuery).
struct WeatherAtIntent: AppIntent {
    static let title: LocalizedStringResource = "Weather at an Airport"
    static let description = IntentDescription("Says an airport's latest weather report: wind, visibility, ceiling, temperature, altimeter and the flight category.")
    static let openAppWhenRun: Bool = false

    @Parameter(title: "Airport", requestValueDialog: "Which airport?")
    var airport: AirportEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Weather at \(\.$airport)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let ident = airport.id
        let place: AirportPlace
        do {
            place = try await Planner.place(ident)
        } catch {
            return .result(dialog: "\(ident)'s weather could not be had; check the connection.")
        }
        guard let metar = place.metar, metar.raw != nil else { return .result(dialog: "No report at \(ident).") }
        let words = IntentLookups.metarWords(name: place.name.isEmpty ? ident : place.name, metar)
        return .result(dialog: IntentDialog(stringLiteral: words))
    }
}
