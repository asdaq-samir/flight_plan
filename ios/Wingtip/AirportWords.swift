import Foundation

/// How an airport's card and the airspace card write what the planner
/// sends, in the web app's words (lib/frequencies, lib/advisories,
/// lib/airspace, lib/stopServices, features/plan/format): no figure is
/// worked out here, only written.
enum AirportWords {
    /// A whole number grouped as pilots read it: "10,162", whatever the
    /// phone's region, as the web app writes it.
    static func grouped(_ n: Double) -> String {
        let magnitude = Int(abs(n).rounded())
        var digits = String(magnitude)
        var at = digits.count - 3
        while at > 0 {
            digits.insert(",", at: digits.index(digits.startIndex, offsetBy: at))
            at -= 3
        }
        return n < 0 && magnitude > 0 ? "-" + digits : digits
    }

    static func feet(_ ft: Double?) -> String { ft.map { "\(grouped($0)) ft" } ?? "—" }

    /// A figure as sent, without a ".0" it does not have: 3 and 1.5.
    static func plain(_ x: Double) -> String {
        x == x.rounded() && abs(x) < 1e9 ? String(Int(x)) : String(x)
    }

    /// A figure to a tenth, without a ".0" it does not have: "3", "1.5"
    /// -- a tolerance, a handbook figure in its field.
    static func tenths(_ x: Double) -> String {
        x == x.rounded() && abs(x) < 1e9 ? String(Int(x)) : String(format: "%.1f", x)
    }

    /// A wind's direction as a pilot writes it: three figures, north 360.
    static func bearing(_ deg: Double) -> String {
        let whole = ((Int(deg.rounded()) % 360) + 360) % 360
        return String(whole == 0 ? 360 : whole).leftPadded(to: 3) + "°"
    }

    /// The eight points of the compass, for "12 nm NE".
    static func compassPoint(_ deg: Double) -> String {
        let points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
        let b = (deg.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
        return points[Int((b / 45).rounded()) % 8]
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

    // MARK: Weather

    /// A report's wind: "250° at 12 kt, gusts 18", "Calm" for 00000KT,
    /// "Variable at 4 kt" (FAA Order JO 7900.5's codes as the planner
    /// reads them), "Not reported" with no speed.
    static func windLine(dirTrueDeg: Double?, speedKt: Double?, gustKt: Double?) -> String {
        guard let speedKt else { return "Not reported" }
        if speedKt == 0 { return "Calm" }
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

    /// The runway's number as the sectional prints it: "05" is 5.
    static func runwayNumber(_ ident: String) -> String {
        var s = Substring(ident)
        while s.count > 1, s.first == "0", s.dropFirst().first?.isNumber == true { s = s.dropFirst() }
        return String(s)
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
    /// out (vfr.runway_wind): "Favors 27: 10 kt headwind, 6 kt crosswind
    /// from the right, 9 in the gusts"; a calm one only for a speed of 0.
    static func runwayWind(_ wind: RunwayWind) -> String {
        if wind.headwindKt == 0, wind.crosswindKt == 0, wind.gustCrosswindKt == nil { return "Calm on \(wind.end)" }
        let along = wind.headwindKt >= 0 ? "\(plain(wind.headwindKt)) kt headwind" : "\(plain(-wind.headwindKt)) kt tailwind"
        let kt = abs(wind.crosswindKt)
        let gust = wind.gustCrosswindKt.map(abs)
        let side = wind.crosswindKt > 0 ? " from the right" : wind.crosswindKt < 0 ? " from the left" : ""
        let gusts = gust.flatMap { $0 != kt ? ", \(plain($0)) in the gusts" : nil } ?? ""
        return "Favors \(wind.end): \(along), \(plain(kt)) kt crosswind\(side)\(gusts)"
    }

    // MARK: Radio

    enum FrequencyKind: String { case tower, ground, weather, approach, traffic, other }

    static let frequencyKinds: [String: FrequencyKind] = [
        "TWR": .tower,
        "GND": .ground, "CLD": .ground, "CLNC": .ground, "CD": .ground, "GCCD": .ground, "GND/CD": .ground,
        "ATIS": .weather, "AWOS": .weather, "ASOS": .weather,
        "APP": .approach, "APCH": .approach, "DEP": .approach, "A/D": .approach, "APP/DEP": .approach,
        "CTAF": .traffic, "UNIC": .traffic, "UNICOM": .traffic, "MULT": .traffic, "MULTICOM": .traffic,
    ]

    static let frequencyNames: [String: String] = [
        "TWR": "Tower", "GND": "Ground", "CLD": "Clearance delivery", "CLNC": "Clearance delivery", "CD": "Clearance delivery",
        "GCCD": "Ground and clearance", "GND/CD": "Ground and clearance",
        "ATIS": "ATIS", "AWOS": "AWOS", "ASOS": "ASOS",
        "APP": "Approach", "APCH": "Approach", "DEP": "Departure", "A/D": "Approach and departure", "APP/DEP": "Approach and departure",
        "CTAF": "CTAF", "UNIC": "UNICOM", "UNICOM": "UNICOM", "MULT": "MULTICOM", "MULTICOM": "MULTICOM",
        "RDO": "Radio", "FSS": "Flight service", "RCO": "Remote outlet",
        "PTD": "Pilot to dispatch", "OPS": "Operations", "EMR": "Emergency", "AFIS": "Flight information",
    ]

    /// A frequency named in words (TWR is "Tower"), its kind for the
    /// row's glyph, and what OurAirports says of it in sentence case where
    /// that adds to the name ("Minneapolis APP/DEP").
    static func frequencyLine(type: String?, description: String?) -> (name: String, kind: FrequencyKind, detail: String?) {
        let code = (type ?? "").trimmingCharacters(in: .whitespaces).uppercased()
        let words = description.map { faaWords($0.trimmingCharacters(in: .whitespaces)) } ?? ""
        let named = frequencyNames[code]
        let name = named ?? (words.isEmpty ? (code.isEmpty ? "Frequency" : code) : words)
        func said(_ text: String) -> String { text.uppercased().filter { $0.isLetter || $0.isNumber } }
        let adds = !words.isEmpty && named != nil && said(words) != said(code) && said(words) != said(named ?? "")
        return (name, frequencyKinds[code] ?? .other, adds ? words : nil)
    }

    /// A frequency as pilots write it: 120.7, 122.95, 124.475.
    static func mhz(_ value: Double) -> String {
        var text = String(format: "%.3f", value)
        for _ in 0..<2 where text.hasSuffix("0") { text.removeLast() }
        return text
    }

    // MARK: The FAA's words

    static let codes: Set<String> = [
        "NOTAM", "TFR", "MOA", "ATC", "ATCAA", "ARTCC", "FAA", "FSS", "DOD", "US", "USA",
        "VFR", "IFR", "MVFR", "LIFR", "AGL", "MSL", "SFC", "UTC", "FL", "NM", "SM",
        "AIRMET", "SIGMET", "PIREP", "METAR", "TAF", "LLWS", "ICG", "TURB",
        "CIG", "BLW", "VIS", "BR", "FG", "HZ", "FU", "DU", "SA", "RA", "SN", "DZ", "TS", "PCPN", "MTN", "MTNS", "OBSC", "OBSCN",
        "CLDS", "BKN", "OVC", "SCT", "FEW", "N", "S", "E", "W", "NE", "NW", "SE", "SW",
        "APP", "DEP", "TWR", "GND", "CTAF", "UNICOM", "ATIS", "AWOS", "ASOS", "CLNC", "DEL", "RDO", "ANG",
    ]
    static let days = ["MON": "Mon", "TUE": "Tue", "WED": "Wed", "THU": "Thu", "FRI": "Fri", "SAT": "Sat", "SUN": "Sun"]

    /// The FAA's capitalised text in sentence case, its codes kept:
    /// "INTERMITTENT BY NOTAM 4 HOURS IN ADVANCE" reads "Intermittent by
    /// NOTAM 4 hours in advance"; a class as the AIM writes it, "Class B"
    /// (AIM 3-2-1). Text with any lower case is someone's own writing and
    /// is left as it is; raw reports never come here.
    static func faaWords(_ text: String?) -> String {
        guard let text, !text.isEmpty else { return "" }
        if text.range(of: "[a-z]", options: .regularExpression) != nil { return text }
        let ns = text as NSString
        let words = try! NSRegularExpression(pattern: #"\bCLASS ([A-G])\b|[A-Z]+-\d[A-Z0-9]*|[A-Z0-9]+"#)
        var out = ""
        var last = 0
        for match in words.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            out += ns.substring(with: NSRange(location: last, length: match.range.location - last))
            let word = ns.substring(with: match.range)
            if match.range(at: 1).location != NSNotFound {
                out += "Class " + ns.substring(with: match.range(at: 1))
            } else if word.rangeOfCharacter(from: .decimalDigits) != nil || codes.contains(word) {
                out += word
            } else if word == "NOTAMS" {
                out += "NOTAMs"
            } else {
                out += days[word] ?? word.lowercased()
            }
            last = match.range.location + match.range.length
        }
        out += ns.substring(from: last)
        // A sentence's first letter, and after a full stop.
        let sentence = NSMutableString(string: out)
        let starts = try! NSRegularExpression(pattern: #"(^|[.!?]\s+)([a-z])"#)
        for match in starts.matches(in: out, range: NSRange(location: 0, length: sentence.length)).reversed() {
            let letter = match.range(at: 2)
            sentence.replaceCharacters(in: letter, with: sentence.substring(with: letter).uppercased())
        }
        return sentence as String
    }

    /// A name the FAA writes in capitals, written as a name is.
    static func titleCase(_ text: String) -> String {
        text.lowercased().capitalized
    }

    // MARK: Airspace

    /// "CHICAGO, DUPAGE AIRPORT CLASS D" as "Chicago, Dupage Airport".
    static func shortAirspaceName(_ name: String) -> String {
        titleCase(name.replacingOccurrences(of: #"\s+CLASS\s+[A-G]\d?$"#, with: "", options: [.regularExpression, .caseInsensitive]))
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
    /// them: SFC, a flight level (STD), feet AGL or MSL.
    static func suaAltitudes(_ area: SpecialUse) -> String {
        func height(_ ft: Double?, _ ref: String?, bottom: Bool) -> String {
            if ref == "SFC" || (bottom && ft == 0) { return "Surface" }
            guard let ft else { return "unstated" }
            if ref == "STD" { return "FL\(Int((ft / 100).rounded()))" }
            return "\(grouped(ft)) ft\(ref == "AGL" ? " AGL" : "")"
        }
        return "\(height(area.floorFt, area.floorRef, bottom: true)) to \(height(area.ceilingFt, area.ceilingRef, bottom: false))"
    }

    // MARK: Services

    /// NASR's fuel codes as the pump is labelled: the jet fuels by name,
    /// the rest (100LL, UL94, MOGAS) as the codes they are.
    static func fuelNames(_ types: [String]) -> String {
        let names = ["A": "Jet A", "A+": "Jet A+", "A1": "Jet A-1", "A1+": "Jet A-1+"]
        return types.map { names[$0] ?? $0 }.joined(separator: ", ")
    }

    /// How far a place is from the field: the minutes' walk where it is a
    /// walk, else statute miles.
    static func away(_ place: NearbyPlace) -> String {
        if let walk = place.walkMin { return "\(walk) min walk" }
        return String(format: "%.1f mi", Double(place.distanceM) / 1609.344)
    }
}

private extension String {
    func leftPadded(to width: Int) -> String {
        count >= width ? self : String(repeating: "0", count: width - count) + self
    }
}
