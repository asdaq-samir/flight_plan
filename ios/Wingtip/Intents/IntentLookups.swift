import Foundation

/// What the intents look up on the planner, shared by them: a place
/// said to Siri turned into a field's ident, as the web app's "plan a
/// trip to Las Vegas" chip does it (PlanWorkspace's planTo: the place as
/// the search finds it, then the biggest field by it), and a field's
/// weather said as a briefer says it (the web's lib/metarWords, to the
/// word, so Siri and the microphone's pill read the same).
enum IntentLookups {
    /// An ident as pilots write one: KLAS, LAS, 3CK -- three or four
    /// letters and figures, said as one word.
    static func looksLikeIdent(_ words: String) -> Bool {
        let w = words.trimmingCharacters(in: .whitespacesAndNewlines)
        return (3...4).contains(w.count) && w.allSatisfy { $0.isLetter || $0.isNumber } && !w.contains(" ")
    }

    /// The field a place's words mean: the ident said, else the place the
    /// search finds (a field, a town, an address) and the biggest field by
    /// it -- a large or medium one, else the nearest. Nil where nothing is
    /// found; thrown where the planner cannot be asked.
    static func field(for words: String) async throws -> String? {
        let said = words.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !said.isEmpty else { return nil }
        if looksLikeIdent(said) { return said.uppercased() }
        guard let found = try await Planner.places(said).first else {
            // Not a place the geocoder knows: a field by its name.
            return try await Planner.search(said).first?.ident
        }
        let fields = try await Planner.nearest(lat: found.lat, lon: found.lon, limit: 10)
        if found.kind == "airport" { return fields.first?.ident }
        return (fields.first { $0.kind == "large" || $0.kind == "medium" } ?? fields.first)?.ident
    }

    /// A number said plainly: 10, not 10.0; 10.5 where it is.
    static func plain(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(value)
    }

    /// A whole number with its thousands grouped, as the web's grouped
    /// writes one ("3,000").
    static func grouped(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        formatter.locale = Locale(identifier: "en_US")
        return formatter.string(from: NSNumber(value: value.rounded())) ?? String(Int(value.rounded()))
    }

    /// A field's METAR as a briefer says it over the phone: the figures in
    /// the order the report has them, the flight category last, spelled
    /// letter by letter so it is heard as letters.
    static func metarWords(name: String, _ m: Metar) -> String {
        var parts: [String] = []
        if let wind = m.windSpeedKt, !AirportWords.calm(wind) {
            let from = m.windDirTrueDeg.map { String(format: "%03d", Int($0.rounded())) } ?? "variable"
            let gust = m.windGustKt.map { " gusting \(plain($0))" } ?? ""
            parts.append("wind \(from) at \(plain(wind))\(gust) knots")
        } else {
            parts.append("wind calm")
        }
        if let sm = m.visibilitySm {
            let said: String
            switch sm {
            case 0.25: said = "a quarter"
            case 0.5: said = "half a"
            case 0.75: said = "three quarters of a"
            default: said = plain(sm)
            }
            parts.append("visibility \(said) mile\(sm > 1 ? "s" : "")")
        }
        parts.append(m.ceilingFt.map { "ceiling \(grouped($0)) feet" } ?? "no ceiling")
        if let temp = m.tempC {
            parts.append("temperature \(plain(temp))" + (m.dewpointC.map { ", dew point \(plain($0))" } ?? ""))
        }
        if let altimeter = m.altimeterInHg { parts.append("altimeter \(String(format: "%.2f", altimeter))") }
        let category = m.flightCategory.map { " \($0.map { String($0) }.joined(separator: " "))." } ?? ""
        return "\(name): \(parts.joined(separator: ", ")).\(category)"
    }
}
