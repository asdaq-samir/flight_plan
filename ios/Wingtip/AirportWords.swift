import Foundation

/// How an airport's card and the airspace card write what the planner
/// sends, in the web app's words (lib/frequencies, lib/advisories,
/// lib/airspace, lib/stopServices, features/plan/format): no figure is
/// worked out here, only written. The FAA's wording and the runway rules
/// are the shared engine's (crate::wording, crate::runway), one copy with
/// the web app; the formatting is the app's.
enum AirportWords {
    /// A whole number grouped as pilots read it: "10,162", whatever the
    /// phone's region, as the web app writes it (Formats, whose locale
    /// is fixed for that).
    static func grouped(_ n: Double) -> String { Formats.grouped(n) }

    static func feet(_ ft: Double?) -> String { Formats.feet(ft) }

    /// A figure as sent, without a ".0" it does not have: 3 and 1.5.
    static func plain(_ x: Double) -> String {
        x == x.rounded() && abs(x) < 1e9 ? String(Int(x)) : String(x)
    }

    /// A figure to a tenth, without a ".0" it does not have: "3", "1.5"
    /// -- a tolerance, a handbook figure in its field.
    static func tenths(_ x: Double) -> String { Formats.tenths(x) }

    /// A wind's direction as a pilot writes it: three figures, north 360.
    static func bearing(_ deg: Double) -> String {
        let whole = ((Int(deg.rounded()) % 360) + 360) % 360
        return String(whole == 0 ? 360 : whole).leftPadded(to: 3) + "°"
    }

    /// A bearing as one of the eight compass points in words,
    /// "northeast": the engine's `compass_word`, the web's and Android's.
    static func compassWord(_ deg: Double) -> String {
        (try? Engine.call("compass_word", json: ["bearing_deg": deg])) ?? ""
    }

    /// The eight points of the compass, for "12 nm NE": the engine's
    /// point, written short.
    static func compassPoint(_ deg: Double) -> String {
        let short = ["north": "N", "northeast": "NE", "east": "E", "southeast": "SE",
                     "south": "S", "southwest": "SW", "west": "W", "northwest": "NW"]
        let word = compassWord(deg)
        return short[word] ?? word
    }

    /// Whether a wind is calm, a speed of 0 (AIM 7-1-28): the engine's
    /// `wind_calm`; no speed is not calm.
    static func calm(_ speedKt: Double?) -> Bool {
        let calm: Bool? = try? Engine.call("wind_calm", json: ["speed_kt": speedKt])
        return calm == true
    }

    /// "N42°19.0′ W088°05.4′": tenths of a minute first, so 59.96
    /// minutes never prints as 60.0.
    static func degreesMinutes(lat: Double, lon: Double) -> String {
        func part(_ value: Double, _ positive: String, _ negative: String, _ width: Int) -> String {
            let tenths = Int((abs(value) * 600).rounded())
            let whole = tenths / 600
            let minutes = Double(tenths - whole * 600) / 10
            let degrees = String(whole).leftPadded(to: width)
            return "\(value >= 0 ? positive : negative)\(degrees)°\(String(format: "%04.1f", minutes))′"
        }
        return "\(part(lat, "N", "S", 2)) \(part(lon, "E", "W", 3))"
    }

    // MARK: The nav log's figures

    /// A distance to a tenth, "12.3 nm", as the nav log gives it.
    static func nm(_ x: Double) -> String { Formats.nm(x) }

    /// Fuel to a tenth, "8.4 gal".
    static func gal(_ x: Double) -> String { Formats.gal(x) }

    /// A speed in whole knots, "112 kt".
    static func kt(_ x: Double) -> String { Formats.kt(x) }

    /// A course or heading as the nav log prints it, three figures, "093°".
    static func degrees(_ x: Double) -> String { Formats.degrees(x) }

    /// A point as the planner, the app's links and Maps take one,
    /// "46.84211,-92.19358": five places, about a metre.
    static func point(_ lat: Double, _ lon: Double) -> String { String(format: "%.5f,%.5f", lat, lon) }

    // MARK: Weather

    /// A report's wind: "250° at 12 kt, gusts 18", "Calm" for 00000KT,
    /// "Variable at 4 kt" (FAA Order JO 7900.5's codes as the planner
    /// reads them), "Not reported" with no speed.
    static func windLine(dirTrueDeg: Double?, speedKt: Double?, gustKt: Double?) -> String {
        guard let speedKt else { return "Not reported" }
        // A speed of nothing is calm, as 00000KT codes it (AIM 7-1-28): the
        // engine's `wind_calm`.
        if calm(speedKt) { return "Calm" }
        let from = dirTrueDeg.map(bearing) ?? "Variable"
        let gust = gustKt.map { $0 > 0 ? ", gusts \(Int($0.rounded()))" : "" } ?? ""
        return "\(from) at \(Int(speedKt.rounded())) kt\(gust)"
    }

    /// A report's time as reports give it: "1255Z".
    static func zulu(_ date: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return String(parts.hour ?? 0).leftPadded(to: 2) + String(parts.minute ?? 0).leftPadded(to: 2) + "Z"
    }

    private static let iso = ISO8601DateFormatter()
    private static let isoFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    /// A time as the servers and GPX files send it, with or without
    /// fractions of a second.
    static func date(_ iso: String?) -> Date? {
        guard let iso else { return nil }
        return Self.iso.date(from: iso) ?? isoFraction.date(from: iso)
    }

    /// When a report was made and how long ago: "1255Z · 14 min ago",
    /// the age a pilot weighs a report by.
    static func observed(_ iso: String, now: Date = Date()) -> String? {
        guard let when = date(iso) else { return nil }
        let minutes = max(0, Int((now.timeIntervalSince(when) / 60).rounded()))
        let ago = minutes < 1 ? "just now" : minutes < 90 ? "\(minutes) min ago" : "\(Int((Double(minutes) / 60).rounded())) h ago"
        return "\(zulu(when)) · \(ago)"
    }

    // MARK: Runways

    /// A runway's surface in words: OurAirports' "ASPH-G" is asphalt.
    static func surfaceName(_ surface: String?) -> String? {
        guard let surface, !surface.isEmpty else { return nil }
        let names = [
            "ASP": "asphalt", "ASPH": "asphalt", "CON": "concrete", "CONC": "concrete", "TURF": "turf", "GRS": "grass", "GRASS": "grass",
            "GRVL": "gravel", "GRAVEL": "gravel", "DIRT": "dirt", "WATER": "water", "SNOW": "snow", "COP": "composite", "COM": "composite",
        ]
        let code = surface.split(whereSeparator: { "-/ ".contains($0) }).first.map { String($0).uppercased() } ?? ""
        return names[code] ?? surface.lowercased()
    }

    /// The runway's number as the sectional prints it: "05" is 5 (the
    /// engine's `gonogo_runway_number`).
    static func runwayNumber(_ ident: String) -> String {
        let number: String? = try? Engine.call("gonogo_runway_number", ["ident": ident])
        return number ?? ident
    }

    /// A runway's line under its name: surface, lights, closed, and any
    /// end flown with right traffic -- every pattern turns left unless
    /// the FAA says otherwise (14 CFR 91.126(b)(1)), as the sectional's
    /// "RP 23" marks it.
    static func runwayDetail(_ runway: Runway) -> String {
        let right = (runway.runwayEnds ?? []).filter { $0.traffic == "right" }.map { runwayNumber($0.ident) }
        return [
            surfaceName(runway.surface), runway.lighted ? "lighted" : nil, runway.closed ? "closed" : nil,
            right.isEmpty ? nil : "right traffic \(right.joined(separator: ", "))",
        ].compactMap { $0 }.joined(separator: " · ")
    }

    /// The reported wind on the end it favours, as the planner worked it
    /// out (wingtip.runway_wind): "Favors 27: 10 kt headwind, 6 kt crosswind
    /// from the right, 9 in the gusts"; a calm one only for a speed of 0
    /// (the engine's `runway_calm`).
    static func runwayWind(_ wind: RunwayWind) -> String {
        let calm: Bool? = try? Engine.call("runway_calm", ["wind": wind], encoder: Planner.snakeEncoder)
        if calm == true { return "Calm on \(wind.end)" }
        let along = wind.headwindKt >= 0 ? "\(plain(wind.headwindKt)) kt headwind" : "\(plain(-wind.headwindKt)) kt tailwind"
        let kt = abs(wind.crosswindKt)
        let gust = wind.gustCrosswindKt.map(abs)
        let side = wind.crosswindKt > 0 ? " from the right" : wind.crosswindKt < 0 ? " from the left" : ""
        let gusts = gust.flatMap { $0 != kt ? ", \(plain($0)) in the gusts" : nil } ?? ""
        return "Favors \(wind.end): \(along), \(plain(kt)) kt crosswind\(side)\(gusts)"
    }

    // MARK: Radio

    enum FrequencyKind: String, Decodable { case tower, ground, weather, approach, traffic, other }

    /// A frequency named in words (TWR is "Tower"), its kind for the
    /// row's glyph, and what OurAirports says of it in sentence case where
    /// that adds to the name ("Minneapolis APP/DEP"): the engine's
    /// `frequency_line`. The type as it came where the engine cannot
    /// answer.
    static func frequencyLine(type: String?, description: String?) -> (name: String, kind: FrequencyKind, detail: String?) {
        struct Line: Decodable { let name: String; let kind: FrequencyKind; let detail: String? }
        let line: Line? = try? Engine.call("frequency_line", json: ["type": type, "description": description])
        guard let line else { return (type ?? "Frequency", .other, nil) }
        return (line.name, line.kind, line.detail)
    }

    /// A frequency as pilots write it: 120.7, 122.95, 124.475.
    static func mhz(_ value: Double) -> String {
        var text = String(format: "%.3f", value)
        for _ in 0..<2 where text.hasSuffix("0") { text.removeLast() }
        return text
    }

    // MARK: The FAA's words

    /// The FAA's capitalised text in sentence case, its codes kept:
    /// "INTERMITTENT BY NOTAM 4 HOURS IN ADVANCE" reads "Intermittent by
    /// NOTAM 4 hours in advance"; a class as the AIM writes it, "Class B"
    /// (AIM 3-2-1). Text with any lower case is someone's own writing and
    /// is left as it is; raw reports never come here. The engine's
    /// `faa_words`; the text as it came where the engine cannot answer.
    static func faaWords(_ text: String?) -> String {
        guard let text, !text.isEmpty else { return "" }
        let words: String? = try? Engine.call("faa_words", ["text": text])
        return words ?? text
    }

    /// A name the FAA writes in capitals, written as a name is ("O'Hare"):
    /// the engine's `title_case`.
    static func titleCase(_ text: String) -> String {
        let words: String? = try? Engine.call("title_case", ["text": text])
        return words ?? text
    }

    // MARK: Airspace

    /// "CHICAGO, DUPAGE AIRPORT CLASS D" as "Chicago, Dupage Airport":
    /// the engine's `short_airspace_name`.
    static func shortAirspaceName(_ name: String) -> String {
        let short: String? = try? Engine.call("short_airspace_name", ["name": name])
        return short ?? name
    }

    /// 91.155's minimums in a line, as the planner gives them: "3 sm, 500
    /// below, 1,000 above, 2,000 horizontal", or "1 sm, clear of clouds".
    static func minimumsLine(_ m: VfrMinimums) -> String {
        if m.clearOfClouds { return "\(plain(m.visibilitySm)) sm, clear of clouds" }
        func ft(_ x: Double?) -> String { x.map(grouped) ?? "—" }
        let horizontal = m.horizontalFt == 5280 ? "1 sm" : ft(m.horizontalFt)
        return "\(plain(m.visibilitySm)) sm, \(ft(m.belowFt)) below, \(ft(m.aboveFt)) above, \(horizontal) horizontal"
    }

    /// A band's floor and ceiling: "Surface" where the floor is at or
    /// under the ground there, FL600 for the top of Class A (14 CFR 71.33).
    static func bandRange(_ band: AirspaceBand, ground: Double?) -> String {
        let bottom = ground.map { band.floorFt <= $0 } == true ? "Surface" : "\(grouped(band.floorFt)) ft"
        let top = band.ceilingFt >= 60000 ? "FL600" : "\(grouped(band.ceilingFt)) ft MSL"
        return "\(bottom) to \(top)"
    }

    /// A special-use area's floor and ceiling as the FAA's file gives
    /// them: SFC, a flight level (STD, 14 CFR 1.1), feet AGL or MSL --
    /// "Surface to 18,000 ft", or "the surface" in a sentence's middle.
    /// The engine's `sua_altitudes`.
    static func suaAltitudes(_ area: SpecialUse, midSentence: Bool = false) -> String {
        let words: String? = try? Engine.call("sua_altitudes", json: [
            "floor_ft": area.floorFt, "floor_ref": area.floorRef, "ceiling_ft": area.ceilingFt, "ceiling_ref": area.ceilingRef,
            "mid_sentence": midSentence,
        ])
        return words ?? ""
    }

    // MARK: Services

    /// NASR's fuel codes as the pump is labelled: the jet fuels by name,
    /// the rest (100LL, UL94, MOGAS) as the codes they are (the engine's
    /// `fuel_names`).
    static func fuelNames(_ types: [String]) -> String {
        let names: String? = try? Engine.call("fuel_names", ["types": types])
        return names ?? types.joined(separator: ", ")
    }

    /// How far a place is from the field: the minutes' walk where it is a
    /// walk, else statute miles.
    static func away(_ place: NearbyPlace) -> String {
        if let walk = place.walkMin { return "\(walk) min walk" }
        return "\(Formats.number(Double(place.distanceM) / 1609.344, decimals: 1)) mi"
    }
}
