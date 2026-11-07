import Foundation

/// An ATIS or AWOS/ASOS broadcast as the phone heard it, read into its
/// figures by the engine (wingtip_engine::atis, `read_atis`) -- the web
/// app's lib/atis, both held to the same fixture (atis.json, the engine's
/// tests/atis.rs and SharedFixturesTests). AIM 4-1-13 orders what a
/// broadcast says: the letter, the time, wind, visibility, sky,
/// temperature and dew point, altimeter, the approaches and runways in
/// use. A figure not said is nil; the phone computes none of them.
struct Atis: Codable, Equatable, Sendable {
    struct Wind: Codable, Equatable, Sendable {
        var fromDeg: Int?
        var kt: Int?
        var gustKt: Int?
        var variable: Bool
    }

    struct Layer: Codable, Equatable, Sendable {
        /// clear, few, scattered, broken, overcast, obscured.
        var cover: String
        var baseFt: Int?
    }

    struct Runways: Codable, Equatable, Sendable {
        var landing: [String]
        var departing: [String]
    }

    /// The information letter, "C".
    var information: String?
    /// "1852Z".
    var timeZ: String?
    var wind: Wind?
    var visibilitySm: Double?
    var sky: [Layer]
    var tempC: Int?
    var dewpointC: Int?
    var altimeterInhg: Double?
    /// "ILS runway 19R", "visual".
    var approach: String?
    var runways: Runways
    /// What else was said, a clause each.
    var remarks: [String]
    /// The transcript as heard.
    var raw: String

    /// The rule answers in snake_case, as the fixture is written.
    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    /// The broadcast in what was heard, read by the engine; nil where the
    /// engine cannot answer.
    static func read(_ text: String) -> Atis? {
        try? Engine.call("read_atis", ["text": text], decoder: decoder)
    }

    /// Whether anything of a broadcast was heard at all.
    var heardAny: Bool {
        information != nil || timeZ != nil || wind != nil || visibilitySm != nil || !sky.isEmpty || altimeterInhg != nil
            || approach != nil || !runways.landing.isEmpty || !runways.departing.isEmpty
    }

    /// The one line that matters at the hold-short line: the runway in
    /// use and the altimeter (the web's glanceWords).
    var glance: String {
        var parts: [String] = []
        if let runways = runwayWords { parts.append("Runway \(runways)") } else if let approach { parts.append(approach) }
        if let altimeterInhg { parts.append("\(Formats.number(altimeterInhg, decimals: 2)) inHg") }
        return parts.isEmpty ? "Nothing of a broadcast was heard" : parts.joined(separator: " · ")
    }

    /// The runways as said: both ways, or landing and departing apart.
    var runwayWords: String? {
        if !runways.landing.isEmpty, runways.landing == runways.departing { return runways.landing.joined(separator: ", ") }
        var parts: [String] = []
        if !runways.landing.isEmpty { parts.append("Landing \(runways.landing.joined(separator: ", "))") }
        if !runways.departing.isEmpty { parts.append("Departing \(runways.departing.joined(separator: ", "))") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// The table under the line, a row a figure, only the figures heard
    /// (the web's atisRows).
    var rows: [(label: String, value: String)] {
        var rows: [(label: String, value: String)] = []
        if let information { rows.append(("Information", timeZ.map { "\(information) · \($0)" } ?? information)) } else if let timeZ { rows.append(("Observed", timeZ)) }
        if let wind { rows.append(("Wind", Self.windWords(wind))) }
        if let visibilitySm { rows.append(("Visibility", Self.visibilityWords(visibilitySm))) }
        if !sky.isEmpty { rows.append(("Sky", Self.skyWords(sky))) }
        if let tempC { rows.append(("Temperature", "\(tempC) °C" + (dewpointC.map { ", dew point \($0) °C" } ?? ""))) }
        if let altimeterInhg { rows.append(("Altimeter", "\(Formats.number(altimeterInhg, decimals: 2)) inHg")) }
        if let approach { rows.append(("Approach", approach)) }
        if let runwayWords { rows.append(("Runways", runwayWords)) }
        for remark in remarks { rows.append(("Remarks", remark)) }
        return rows
    }

    /// "210° at 12 kt, gusts 18", "Calm", "Light and variable".
    static func windWords(_ w: Wind) -> String {
        // Calm is a speed of 0 (AIM 7-1-28), the engine's wind_calm.
        if AirportWords.calm(w.kt.map(Double.init)) { return "Calm" }
        let speed = w.kt.map { "\($0) kt" }
        var head: String?
        if let from = w.fromDeg {
            head = String(format: "%03d°", from) + (w.variable ? " variable" : "")
        } else if w.variable {
            head = speed != nil ? "Variable" : "Light and variable"
        }
        var parts: [String] = []
        if let head, let speed { parts.append("\(head) at \(speed)") } else if let said = head ?? speed { parts.append(said) }
        if let gust = w.gustKt { parts.append("gusts \(gust)") }
        return parts.joined(separator: ", ")
    }

    /// "10 sm", "2½ sm", "¾ sm".
    static func visibilityWords(_ sm: Double) -> String {
        let whole = Int(sm.rounded(.down))
        let frac = sm - Double(whole)
        let part: String
        switch frac {
        case 0.25: part = "¼"
        case 0.5: part = "½"
        case 0.75: part = "¾"
        case 0: part = ""
        default: part = String(String(frac).dropFirst())
        }
        return "\(whole > 0 || part.isEmpty ? String(whole) : "")\(part) sm"
    }

    /// The ATIS's covers as a METAR codes them, for the engine's ceiling.
    private static let metarCover = ["clear": "CLR", "few": "FEW", "scattered": "SCT", "broken": "BKN", "overcast": "OVC", "obscured": "VV"]

    /// The engine's answer to ceiling_visibility.
    private struct CeilingVisibility: Decodable { let ceilingFt: Double? }

    /// The layers as said, the ceiling marked: the engine's ceiling
    /// (ceiling_visibility, 14 CFR 1.1's definition: the lowest broken or
    /// overcast layer, or an obscuration), as the web's.
    static func skyWords(_ sky: [Layer]) -> String {
        if sky.isEmpty { return "—" }
        let layers: [[String: Any?]] = sky.map { ["cover": metarCover[$0.cover] ?? $0.cover, "base_ft": $0.baseFt] }
        let found: CeilingVisibility? = try? Engine.call("ceiling_visibility", json: ["layers": layers], decoder: Planner.snakeCase)
        let ceiling = found?.ceilingFt.flatMap { ft in sky.lastIndex { $0.baseFt.map(Double.init) == ft } }
        return sky.enumerated().map { k, l in
            let cover = l.cover.prefix(1).uppercased() + l.cover.dropFirst()
            let base = l.baseFt.map { " \(AirportWords.feet(Double($0)))" } ?? ""
            return cover + base + (k == ceiling ? " (ceiling)" : "")
        }.joined(separator: " · ")
    }
}
