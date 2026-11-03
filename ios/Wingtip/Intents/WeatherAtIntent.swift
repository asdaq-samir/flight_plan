import AppIntents

/// "Weather at Milwaukee" to Siri: the field's METAR said as a briefer
/// says it (IntentLookups.metarWords, the web's lib/metarWords to the
/// word), without opening the app, as the microphone's Weather chip says
/// it in the app. The field is free text, asked for after the phrase.
struct WeatherAtIntent: AppIntent {
    static let title: LocalizedStringResource = "Weather at a Field"
    static let description = IntentDescription("Says a field's latest weather report: wind, visibility, ceiling, temperature, altimeter and the flight category.")
    static let openAppWhenRun: Bool = false

    @Parameter(title: "Field", requestValueDialog: "Which field?")
    var field: String

    static var parameterSummary: some ParameterSummary {
        Summary("Weather at \(\.$field)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let ident: String?
        do {
            ident = try await IntentLookups.field(for: field)
        } catch {
            return .result(dialog: "The planner could not be reached to find \(field); check the connection.")
        }
        guard let ident else { return .result(dialog: "\(field) was not found.") }
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
