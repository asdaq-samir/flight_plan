import Foundation

/// An airplane's checklist as the pilot writes it in plain text (the web
/// app's lib/checklist, kept the same): a line starting "#" a section,
/// every other line an item, its challenge and its response split by a
/// dash or a run of dots, as a printed checklist sets them ("Fuel
/// selector -- Both", "Mixture ..... Rich"). An item before any section is
/// in "Checklist". The limits are the gateway's: 40 characters a title,
/// 80 a challenge or a response. The app writes none of its own: the
/// flight manual's is the airplane's.
enum ChecklistText {
    private static let split = try! NSRegularExpression(pattern: "\\s+(?:-{1,2}|–|—|\\.{2,})\\s+|\\s*\\.{3,}\\s*|\\t+")

    static func parse(_ text: String) -> Checklist {
        var sections: [ChecklistSection] = []
        for raw in text.components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            if line.hasPrefix("#") {
                let title = String(line.drop { $0 == "#" }).trimmingCharacters(in: .whitespaces)
                sections.append(ChecklistSection(title: title.isEmpty ? "Checklist" : String(title.prefix(40)), items: []))
                continue
            }
            if sections.isEmpty { sections.append(ChecklistSection(title: "Checklist", items: [])) }
            let ns = line as NSString
            var parts: [String] = []
            var from = 0
            for match in split.matches(in: line, range: NSRange(location: 0, length: ns.length)) {
                parts.append(ns.substring(with: NSRange(location: from, length: match.range.location - from)))
                from = match.range.location + match.range.length
            }
            parts.append(ns.substring(from: from))
            let challenge = parts[0].trimmingCharacters(in: .whitespaces)
            let response = parts.dropFirst().joined(separator: " ").trimmingCharacters(in: .whitespaces)
            sections[sections.count - 1].items.append(
                ChecklistItem(challenge: String(challenge.prefix(80)), response: response.isEmpty ? nil : String(response.prefix(80))))
        }
        return Checklist(sections: sections.filter { !$0.items.isEmpty })
    }

    static func text(of checklist: Checklist) -> String {
        checklist.sections.map { section in
            (["# \(section.title)"] + section.items.map { item in item.response.map { "\(item.challenge) -- \($0)" } ?? item.challenge })
                .joined(separator: "\n")
        }
        .joined(separator: "\n\n")
    }
}

/// The logbook as a CSV file, out and in (the web app's lib/logbookCsv,
/// kept the same): out in ForeFlight's column names where it has the
/// field; in from that file again or from ForeFlight's own export -- an
/// Aircraft Table, then a Flights Table, each a row of field names
/// (ForeFlight Logbook Guide v14.0, "ForeFlight Template"), its names read
/// whatever their spaces or case. All its landings count as day landings
/// for 61.57(a), the night full-stop ones apart (61.57(b)).
enum LogbookCSV {
    /// RFC 4180: commas, quotes doubled inside quotes, a quoted field's own
    /// commas and line breaks.
    static func rows(_ text: String) -> [[String]] {
        var rows: [[String]] = []
        var row: [String] = []
        var field = ""
        var quoted = false
        var chars = Array(text)
        if chars.first == "\u{FEFF}" { chars.removeFirst() }
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if quoted {
                if c == "\"" {
                    if i + 1 < chars.count, chars[i + 1] == "\"" { field.append("\""); i += 1 } else { quoted = false }
                } else { field.append(c) }
            } else if c == "\"" {
                quoted = true
            } else if c == "," {
                row.append(field); field = ""
            } else if c == "\r\n" || c == "\n" || c == "\r" {
                row.append(field); field = ""
                rows.append(row); row = []
            } else {
                field.append(c)
            }
            i += 1
        }
        if !field.isEmpty || !row.isEmpty { row.append(field); rows.append(row) }
        return rows
    }

    private static func cell(_ s: String) -> String {
        s.contains(where: { $0 == "," || $0 == "\"" || $0 == "\n" || $0 == "\r" }) ? "\"\(s.replacingOccurrences(of: "\"", with: "\"\""))\"" : s
    }

    private static func number(_ v: Double) -> String { v == v.rounded() ? String(Int(v)) : String(v) }

    /// The logbook as a CSV file, oldest flight first.
    static func csv(_ entries: [LogbookEntry]) -> String {
        let names = ["Date", "AircraftID", "TypeCode", "Route", "TotalTime", "Night", "CrossCountry", "Solo", "DualReceived", "Instrument",
                     "AllLandings", "NightLandingsFullStop", "ToweredLandings", "Distance", "LongestLeg", "Approaches", "Holds", "Tracking",
                     "PilotComments"]
        let lines = entries.sorted { $0.flownOn < $1.flownOn }.map { e -> String in
            [e.flownOn, e.aircraft ?? "", e.aircraftType ?? "", e.route ?? "", number(e.totalHours), number(e.nightHours),
             number(e.crossCountryHours), number(e.soloHours ?? 0), number(e.dualHours ?? 0), number(e.instrumentHours),
             String(e.dayLandings + e.nightLandings), String(e.nightLandings), String(e.toweredLandings ?? 0), number(e.distanceNm),
             number(e.longestLegNm ?? 0), String(e.approaches), (e.holding ?? false) ? "1" : "0", (e.tracking ?? false) ? "x" : "",
             e.remarks ?? ""].map(cell).joined(separator: ",")
        }
        return ([names.joined(separator: ",")] + lines).joined(separator: "\r\n") + "\r\n"
    }

    struct Skipped: Equatable { let line: Int; let reason: String }
    struct Imported: Equatable { var entries: [LogbookEntryRequest]; var skipped: [Skipped] }

    /// A field's name as compared: "Total Time" and "TotalTime" are one.
    static func key(_ name: String) -> String { name.lowercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) } }

    private static func hours(_ v: String?) -> Double {
        guard let n = Double((v ?? "").trimmingCharacters(in: .whitespaces)), n.isFinite, n > 0 else { return 0 }
        return (n * 10).rounded() / 10
    }
    private static func count(_ v: String?) -> Int {
        let digits = (v ?? "").trimmingCharacters(in: .whitespaces).prefix { $0.isNumber || $0 == "-" }
        guard let n = Int(digits), n > 0 else { return 0 }
        return n
    }
    private static func truthy(_ v: String?) -> Bool {
        let s = (v ?? "").trimmingCharacters(in: .whitespaces).lowercased()
        return !["", "0", "false", "no", "n"].contains(s)
    }

    /// A date as ForeFlight writes it (2002-01-02), or as a spreadsheet
    /// may have turned it (1/2/2002); nil for neither.
    static func dateOf(_ v: String?) -> String? {
        let s = (v ?? "").trimmingCharacters(in: .whitespaces)
        if s.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil { return s }
        let parts = s.split(separator: "/")
        guard parts.count == 3, parts[0].count <= 2, parts[1].count <= 2, parts[2].count == 4,
              let m = Int(parts[0]), let d = Int(parts[1]), Int(parts[2]) != nil else { return nil }
        return String(format: "%@-%02d-%02d", String(parts[2]), m, d)
    }

    private static func headerRow(_ rows: [[String]], from: Int, _ names: [String]) -> Int {
        guard from < rows.count else { return -1 }
        for i in from..<rows.count {
            let keys = rows[i].map(key)
            if names.allSatisfy(keys.contains) { return i }
        }
        return -1
    }

    /// A logbook CSV read: ForeFlight's, or this logbook's own.
    static func read(_ text: String) -> Imported {
        let rows = rows(text)
        var types: [String: String] = [:]
        let aircraftAt = headerRow(rows, from: 0, ["aircraftid", "typecode", "make"])
        let flightsAt = headerRow(rows, from: aircraftAt + 1, ["date", "aircraftid", "totaltime"])
        if aircraftAt >= 0, flightsAt < 0 || aircraftAt < flightsAt {
            let names = rows[aircraftAt].map(key)
            let end = flightsAt < 0 ? rows.count : flightsAt
            for i in (aircraftAt + 1)..<end {
                let row = rows[i]
                func at(_ n: String) -> String? { names.firstIndex(of: n).flatMap { $0 < row.count ? row[$0].trimmingCharacters(in: .whitespaces) : nil } }
                if let tail = at("aircraftid"), let type = at("typecode"), !tail.isEmpty, !type.isEmpty, tail.lowercased() != "text" { types[tail] = type }
            }
        }
        guard flightsAt >= 0 else { return Imported(entries: [], skipped: [Skipped(line: 1, reason: "No row of field names with Date, AircraftID and TotalTime")]) }
        let names = rows[flightsAt].map(key)
        var entries: [LogbookEntryRequest] = []
        var skipped: [Skipped] = []
        for i in (flightsAt + 1)..<rows.count {
            let row = rows[i]
            func at(_ n: String) -> String? { names.firstIndex(of: n).flatMap { $0 < row.count ? row[$0] : nil } }
            if row.allSatisfy({ $0.trimmingCharacters(in: .whitespaces).isEmpty }) { continue }
            let line = i + 1
            guard let flownOn = dateOf(at("date")) else {
                skipped.append(Skipped(line: line, reason: "No date (\"\(at("date") ?? "")\")"))
                continue
            }
            let total = hours(at("totaltime"))
            if total > 24 {
                skipped.append(Skipped(line: line, reason: "\(number(total)) hours is more than a day: a summary entry, to log as its flights"))
                continue
            }
            let tail = (at("aircraftid") ?? "").trimmingCharacters(in: .whitespaces)
            let route = [at("from"), at("route"), at("to")].map { ($0 ?? "").trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " ")
            let night = count(at("nightlandingsfullstop"))
            let allGiven = !(at("alllandings") ?? "").trimmingCharacters(in: .whitespaces).isEmpty
            let all = allGiven ? count(at("alllandings")) : count(at("daylandingsfullstop")) + night
            // ForeFlight's approaches, "count;type;runway;airport;comments" each.
            let approaches = names.contains("approaches")
                ? count(at("approaches"))
                : names.enumerated().filter { $0.element.range(of: "^approach\\d+$", options: .regularExpression) != nil }
                    .reduce(0) { sum, n in sum + count(n.offset < row.count ? row[n.offset].split(separator: ";").first.map(String.init) : nil) }
            let type = (at("typecode") ?? types[tail] ?? "").trimmingCharacters(in: .whitespaces)
            let remarks = (at("pilotcomments") ?? "").trimmingCharacters(in: .whitespaces)
            let instrument = names.contains("instrument")
                ? hours(at("instrument"))
                : ((hours(at("actualinstrument")) + hours(at("simulatedinstrument"))) * 10).rounded() / 10
            entries.append(LogbookEntryRequest(
                flownOn: flownOn,
                aircraft: tail.isEmpty ? nil : String(tail.prefix(16)),
                aircraftType: type.isEmpty ? nil : String(type.prefix(16)),
                route: route.isEmpty ? nil : String(route.prefix(120)),
                remarks: remarks.isEmpty ? nil : String(remarks.prefix(500)),
                totalHours: total, nightHours: hours(at("night")), crossCountryHours: hours(at("crosscountry")),
                dualHours: hours(at("dualreceived")), soloHours: hours(at("solo")), instrumentHours: instrument,
                dayLandings: max(0, all - night), nightLandings: night, toweredLandings: count(at("toweredlandings")),
                distanceNm: hours(at("distance")), longestLegNm: hours(at("longestleg")), approaches: approaches,
                holding: count(at("holds")) > 0, tracking: truthy(at("tracking"))))
        }
        return Imported(entries: entries, skipped: skipped)
    }

    /// What an import brought in, in a line.
    static func summary(_ read: Imported, _ result: LogbookImportResult) -> String {
        var parts = ["\(result.added) flight\(result.added == 1 ? "" : "s") added"]
        if result.duplicates > 0 { parts.append("\(result.duplicates) already in your logbook") }
        if !read.skipped.isEmpty {
            let some = read.skipped.prefix(3).map { "line \($0.line): \($0.reason)" }.joined(separator: "; ")
            parts.append("\(read.skipped.count) row\(read.skipped.count == 1 ? "" : "s") left out (\(some)\(read.skipped.count > 3 ? "; …" : ""))")
        }
        return parts.joined(separator: ", ") + "."
    }
}

/// Endorsements as AC 61-65K has them signed (the web app's
/// lib/endorsements and lib/checkride): the gateway's template with its
/// blanks filled, and the signature line every endorsement carries.
enum Endorsing {
    /// The template's {blanks} filled: {student} with the name as on the
    /// student's certificate, the rest from the form; runs of space made one.
    static func render(_ template: String, student: String, fields: [String: String]) -> String {
        let blank = try! NSRegularExpression(pattern: "\\{([A-Za-z]+)\\}")
        let ns = template as NSString
        var out = ""
        var from = 0
        for match in blank.matches(in: template, range: NSRange(location: 0, length: ns.length)) {
            out += ns.substring(with: NSRange(location: from, length: match.range.location - from))
            let key = ns.substring(with: match.range(at: 1))
            out += key == "student" ? student : (fields[key] ?? "")
            from = match.range.location + match.range.length
        }
        out += ns.substring(from: from)
        return out.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    /// "/s/ 10-13-2026 J. J. Jones 987654321CFI RE 12-31-2027": the date,
    /// name, certificate number and its end, as AC 61-65K asks.
    static func signatureLine(_ instructor: Instructor, signedOn: String) -> String {
        let kind = instructor.untilKind == "EXP" ? "Exp." : "RE"
        return "/s/ \(Day.acDay(signedOn)) \(instructor.fullName ?? "") \(instructor.certificate ?? "") \(kind) \(Day.acDay(instructor.until ?? ""))"
    }

    /// The warning above "Sign as" once the instructor's date has passed
    /// on the day of signing, or nil; the web's lib/endorsements
    /// lapseWarning, word for word. Never a block: the owner's rule is to
    /// make the pilot aware, not restrict them (2026-10-26), and the
    /// gateway signs either way. A certificate issued on or after 1 Dec
    /// 2024 has no expiration date (14 CFR 61.19(d)(1)) and its date is
    /// the end of the recent experience 61.197(a) asks for in the
    /// preceding 24 calendar months; an older one expires 24 calendar
    /// months from issue, renewal or reinstatement (61.19(d)(2)), and its
    /// privileges then wait for reinstatement under 61.199 (61.197(e)).
    static func lapseWarning(_ instructor: Instructor, signedOn: String) -> String? {
        guard let until = instructor.until, !Day.current(until, today: signedOn) else { return nil }
        return instructor.untilKind == "EXP"
            ? "Your certificate expired on \(Day.said(until)): 14 CFR 61.197(e) asks for it to be reinstated (61.199) before you sign as an instructor."
            : "Your recent experience ran out on \(Day.said(until)): 14 CFR 61.197(a) asks for recent experience in the preceding 24 calendar months before you sign as an instructor."
    }

    /// The latest of each kind signed in the app and not voided; the
    /// record comes newest first.
    static func inForce(_ signed: [SignedEndorsement]) -> [String: SignedEndorsement] {
        var out: [String: SignedEndorsement] = [:]
        for e in signed where !e.voided && out[e.code] == nil { out[e.code] = e }
        return out
    }

    /// A solo cross-country's airports in order: "KUGN KRFD KUGN".
    static func route(_ r: CrossCountryReview) -> String {
        guard let f = r.flight else { return r.makeModel }
        return ([f.departureIdent] + f.stops + [f.destinationIdent]).joined(separator: " ")
    }

    /// Where a solo cross-country put to an instructor stands.
    static func state(_ r: CrossCountryReview) -> String {
        if let e = r.endorsement { return "Endorsed \(Day.said(e.signedOn))" }
        if r.answeredAt != nil { return "Not endorsed: \(r.declinedNote ?? "")" }
        return "Waiting for your instructor"
    }

    /// 14 CFR 61.93(d)(1)-(3): what an instructor must determine of a solo
    /// cross-country themselves before endorsing it; (4) and (5), the
    /// student's endorsements, the record answers.
    static let determinations: [(rule: String, label: String)] = [
        ("61.93(d)(1)", "The student's cross-country planning is correct for the flight"),
        ("61.93(d)(2)", "The current and forecast weather allow it to be completed under VFR"),
        ("61.93(d)(3)", "The student is proficient to conduct it safely"),
    ]

    /// The airports' blanks of a solo cross-country's endorsement, filled
    /// from the flight put to the instructor, as the web app fills them.
    static func reviewFields(_ r: CrossCountryReview) -> [String: String] {
        guard let f = r.flight else { return ["mm": r.makeModel, "date": Day.acDay(r.flightOn)] }
        return [
            "from": f.departureIdent, "to": f.destinationIdent, "via": f.stops.isEmpty ? "direct" : f.stops.joined(separator: ", "),
            "landings": (f.stops + [f.destinationIdent]).joined(separator: ", "), "mm": r.makeModel, "date": Day.acDay(r.flightOn),
        ]
    }

    /// The ACS codes in what was pasted -- a report's text, a list, codes in
    /// lower case -- each once, in the order given; a sub-element's letter
    /// lower case, as the ACS writes it (K1a).
    static func acsCodes(in text: String) -> [String] {
        let code = try! NSRegularExpression(pattern: "\\b(PA|IR)\\.([IVX]{1,4})\\.([A-Z])\\.([KRS])(\\d{1,2})([A-Z]?)\\b")
        let upper = text.uppercased() as NSString
        var found: [String] = []
        for m in code.matches(in: upper as String, range: NSRange(location: 0, length: upper.length)) {
            func g(_ i: Int) -> String { m.range(at: i).location == NSNotFound ? "" : upper.substring(with: m.range(at: i)) }
            let c = "\(g(1)).\(g(2)).\(g(3)).\(g(4))\(g(5))\(g(6).lowercased())"
            if !found.contains(c) { found.append(c) }
        }
        return found
    }
}

/// The FAA's own words for each ACS code (FAA-S-ACS-6C, -8C), the web
/// app's lib/acs.json, kept in the app's bundle.
struct AcsTable: Decodable, Sendable {
    struct TaskWords: Decodable, Sendable { let area: String; let task: String }
    let editions: [String]
    let tasks: [String: TaskWords]
    let elements: [String: String]

    static let bundled: AcsTable? = {
        guard let url = Bundle.main.url(forResource: "acs", withExtension: "json"), let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(AcsTable.self, from: data)
    }()

    /// A code's task and element in the ACS's words; nil for a code this
    /// edition does not have.
    func words(_ code: String) -> String? {
        guard let task = tasks[code.split(separator: ".").prefix(3).joined(separator: ".")] else { return nil }
        return elements[code].map { "\(task.task): \($0)" } ?? task.task
    }
}

/// The airplane form's fields as typed, checked as the gateway checks
/// them (AircraftRequest's @NotBlank/@Positive, the web app's form) before
/// the round trip.
struct AircraftForm: Equatable {
    var tailNumber = ""
    var typeDesignator = ""
    var cruiseTasKt = ""
    var fuelBurnGph = ""
    var cruisePowerPct = ""
    var climbTasKt = ""
    var climbFuelBurnGph = ""
    var usableFuelGal = ""
    var equipment = ""
    var surveillance = ""
    var colour = ""

    init() {}

    init(_ a: OwnAircraftRecord) {
        func s(_ v: Double?) -> String { v.map { $0 == $0.rounded() ? String(Int($0)) : String($0) } ?? "" }
        tailNumber = a.tailNumber; typeDesignator = a.typeDesignator
        cruiseTasKt = s(a.cruiseTasKt); fuelBurnGph = s(a.fuelBurnGph); cruisePowerPct = s(a.cruisePowerPct)
        climbTasKt = s(a.climbTasKt); climbFuelBurnGph = s(a.climbFuelBurnGph); usableFuelGal = s(a.usableFuelGal)
        equipment = a.equipment ?? ""; surveillance = a.surveillance ?? ""; colour = a.colour ?? ""
    }

    private static func number(_ s: String) -> Double? { Double(s.trimmingCharacters(in: .whitespaces)) }

    /// What is wrong, by field, in the web app's words; empty when it may be saved.
    var problems: [String: String] {
        var out: [String: String] = [:]
        let tail = tailNumber.trimmingCharacters(in: .whitespaces), type = typeDesignator.trimmingCharacters(in: .whitespaces)
        if tail.isEmpty { out["tailNumber"] = "Tail number is required" } else if tail.count > 16 { out["tailNumber"] = "At most 16 characters" }
        if type.isEmpty { out["typeDesignator"] = "Type designator is required" } else if type.count > 16 { out["typeDesignator"] = "At most 16 characters" }
        func positive(_ key: String, _ value: String, _ label: String, required: Bool) {
            let t = value.trimmingCharacters(in: .whitespaces)
            if t.isEmpty { if required { out[key] = "\(label) must be a positive number" }; return }
            if (Self.number(t) ?? 0) <= 0 { out[key] = "\(label) must be a positive number" }
        }
        positive("cruiseTasKt", cruiseTasKt, "Cruise speed", required: true)
        positive("fuelBurnGph", fuelBurnGph, "Cruise fuel burn", required: true)
        positive("climbTasKt", climbTasKt, "Climb speed", required: false)
        positive("climbFuelBurnGph", climbFuelBurnGph, "Climb fuel burn", required: false)
        positive("usableFuelGal", usableFuelGal, "Usable fuel", required: false)
        // A power a cruise table has: 40 to 100 percent, the gateway's
        // limits and the planner's.
        let power = cruisePowerPct.trimmingCharacters(in: .whitespaces)
        if !power.isEmpty, !((Self.number(power) ?? 0) >= 40 && (Self.number(power) ?? 0) <= 100) { out["cruisePowerPct"] = "Cruise power must be between 40 and 100%" }
        // Flight plan items 10a and 10b are letters and figures, at most 40
        // and 20 (AIM Appendix 4, TBL 4-2 and 4-3); item 19 plain words.
        let codes = { (s: String, n: Int) in s.count <= n && s.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) } }
        if !codes(equipment.trimmingCharacters(in: .whitespaces), 40) { out["equipment"] = "Letters and figures, as SDFGRY" }
        if !codes(surveillance.trimmingCharacters(in: .whitespaces), 20) { out["surveillance"] = "Letters and figures, as B1" }
        if colour.trimmingCharacters(in: .whitespaces).count > 40 { out["colour"] = "At most 40 characters" }
        return out
    }

    /// The request, when there is nothing wrong.
    var request: AircraftRequest? {
        guard problems.isEmpty, let tas = Self.number(cruiseTasKt), let burn = Self.number(fuelBurnGph) else { return nil }
        func opt(_ s: String) -> Double? { Self.number(s) }
        func words(_ s: String) -> String? { let t = s.trimmingCharacters(in: .whitespaces); return t.isEmpty ? nil : t }
        return AircraftRequest(
            tailNumber: tailNumber.trimmingCharacters(in: .whitespaces).uppercased(), typeDesignator: typeDesignator.trimmingCharacters(in: .whitespaces).uppercased(),
            cruiseTasKt: tas, fuelBurnGph: burn, cruisePowerPct: opt(cruisePowerPct), climbTasKt: opt(climbTasKt),
            climbFuelBurnGph: opt(climbFuelBurnGph), usableFuelGal: opt(usableFuelGal),
            equipment: words(equipment)?.uppercased(), surveillance: words(surveillance)?.uppercased(), colour: words(colour))
    }
}

/// Flash-card drills (the web app's lib/drills, kept the same): the
/// tower's light signals (14 CFR 91.125) and the basic VFR weather
/// minimums (91.155), each worded as the regulation words it, gone
/// through by Leitner's boxes -- a card known moves up a box and comes
/// back later, a card missed goes back to the first. Kept on this device.
enum Drills {
    enum Light: String, Sendable { case green, red, white }

    struct Card: Equatable, Sendable, Identifiable {
        let id: String
        let prompt: String
        let answer: String
        var detail: String?
        var colours: [Light] = []
        var flashing = false
    }

    struct Deck: Sendable {
        let key: String
        let title: String
        let source: String
        let url: URL
        let cards: [Card]
    }

    private struct Signal { let id, name: String; let colours: [Light]; let flashing: Bool; let surface, flight: String; var flightDetail: String? = nil }

    // 14 CFR 91.125's table, word for word as the web app has it.
    private static let signals: [Signal] = [
        Signal(id: "steady-green", name: "Steady green", colours: [.green], flashing: false, surface: "Cleared for takeoff", flight: "Cleared to land"),
        Signal(id: "flashing-green", name: "Flashing green", colours: [.green], flashing: true, surface: "Cleared to taxi", flight: "Return for landing",
               flightDetail: "To be followed by steady green at the proper time."),
        Signal(id: "steady-red", name: "Steady red", colours: [.red], flashing: false, surface: "Stop", flight: "Give way to other aircraft and continue circling"),
        Signal(id: "flashing-red", name: "Flashing red", colours: [.red], flashing: true, surface: "Taxi clear of the runway in use", flight: "Airport unsafe: do not land"),
        Signal(id: "flashing-white", name: "Flashing white", colours: [.white], flashing: true, surface: "Return to starting point on airport", flight: "Not applicable",
               flightDetail: "Flashing white means nothing to an aircraft in flight."),
        Signal(id: "alternating", name: "Alternating red and green", colours: [.red, .green], flashing: true, surface: "Exercise extreme caution", flight: "Exercise extreme caution"),
    ]

    static let lightGun = Deck(
        key: "light-gun", title: "Light gun signals", source: "14 CFR 91.125",
        url: URL(string: "https://www.ecfr.gov/current/title-14/part-91/section-91.125")!,
        cards: signals.flatMap { s in [
            Card(id: "\(s.id)-surface", prompt: "\(s.name), on the ground", answer: s.surface, colours: s.colours, flashing: s.flashing),
            Card(id: "\(s.id)-flight", prompt: "\(s.name), in flight", answer: s.flight, detail: s.flightDetail, colours: s.colours, flashing: s.flashing),
        ] })

    // 14 CFR 91.155(a)'s table; Class A from 91.135, the pattern exception 91.155(b)(2).
    private static let standard = "3 sm; 500 ft below, 1,000 ft above, 2,000 ft horizontal"
    private static let high = "5 sm; 1,000 ft below, 1,000 ft above, 1 sm horizontal"

    static let vfrMinimums = Deck(
        key: "vfr-minimums", title: "VFR weather minimums", source: "14 CFR 91.155",
        url: URL(string: "https://www.ecfr.gov/current/title-14/part-91/section-91.155")!,
        cards: [
            Card(id: "a", prompt: "Class A", answer: "Not applicable", detail: "Class A is flown under IFR (91.135)."),
            Card(id: "b", prompt: "Class B", answer: "3 sm; clear of clouds"),
            Card(id: "c", prompt: "Class C", answer: standard),
            Card(id: "d", prompt: "Class D", answer: standard),
            Card(id: "e-low", prompt: "Class E, below 10,000 ft MSL", answer: standard),
            Card(id: "e-high", prompt: "Class E, at or above 10,000 ft MSL", answer: high),
            Card(id: "g-low-day", prompt: "Class G, 1,200 ft or less above the surface, by day", answer: "1 sm; clear of clouds"),
            Card(id: "g-low-night", prompt: "Class G, 1,200 ft or less above the surface, at night", answer: standard,
                 detail: "Under 3 sm but not under 1 sm at night, an airplane in the traffic pattern within 1/2 mile of the runway may fly clear of clouds (91.155(b)(2))."),
            Card(id: "g-mid-day", prompt: "Class G, more than 1,200 ft above the surface but below 10,000 ft MSL, by day",
                 answer: "1 sm; 500 ft below, 1,000 ft above, 2,000 ft horizontal"),
            Card(id: "g-mid-night", prompt: "Class G, more than 1,200 ft above the surface but below 10,000 ft MSL, at night", answer: standard),
            Card(id: "g-high", prompt: "Class G, more than 1,200 ft above the surface and at or above 10,000 ft MSL", answer: high),
        ])

    /// Days until a card in each box comes round again: the first box the
    /// same session.
    static let intervalDays = [0, 1, 3, 7, 16]
    static let day: TimeInterval = 86_400

    struct Standing: Codable, Equatable, Sendable { var box: Int; var due: Date }
    typealias Progress = [String: Standing]

    static func answered(_ progress: Progress, card: String, knew: Bool, now: Date) -> Progress {
        let box = knew ? min(intervalDays.count, (progress[card]?.box ?? 1) + 1) : 1
        var out = progress
        out[card] = Standing(box: box, due: now.addingTimeInterval(Double(intervalDays[box - 1]) * day))
        return out
    }

    /// The cards due now -- never seen, or past their day -- the lowest
    /// box first, in the deck's order within a box.
    static func due(_ deck: Deck, _ progress: Progress, now: Date) -> [Card] {
        let at = { (c: Card) in progress[c.id] ?? Standing(box: 0, due: .distantPast) }
        return deck.cards.enumerated()
            .filter { at($0.element).due <= now }
            .sorted { (at($0.element).box, $0.offset) < (at($1.element).box, $1.offset) }
            .map(\.element)
    }

    static func nextDue(_ deck: Deck, _ progress: Progress, now: Date) -> Date? {
        deck.cards.compactMap { progress[$0.id]?.due }.filter { $0 > now }.min()
    }

    private static func key(_ deck: Deck) -> String { "drill.\(deck.key)" }

    static func kept(_ deck: Deck) -> Progress {
        guard let data = UserDefaults.standard.data(forKey: key(deck)), let p = try? JSONDecoder().decode(Progress.self, from: data) else { return [:] }
        return p
    }

    static func keep(_ progress: Progress, for deck: Deck) {
        UserDefaults.standard.set(try? JSONEncoder().encode(progress), forKey: key(deck))
    }
}

/// Two-way radio failure under IFR, the parts that are the rule's words
/// (14 CFR 91.185, the web app's lib/lostComms): the route in the rule's
/// order and when to leave the clearance limit. The altitude on each
/// segment, which the web app works out on the page, is left to the
/// planner (not in its API yet).
enum LostComms {
    /// 91.185(c)(1): the route, in the rule's order -- the first that applies.
    static let routes: [(key: String, label: String, rule: String)] = [
        ("assigned", "Assigned", "The route assigned in the last ATC clearance received."),
        ("vectored", "Vectored", "Being radar vectored: direct from the point of radio failure to the fix, route or airway specified in the vector clearance."),
        ("expected", "Expected", "No route assigned: the route ATC has advised may be expected in a further clearance."),
        ("filed", "Filed", "Neither assigned nor expected: the route filed in the flight plan."),
    ]

    /// 91.185(c)(2): the altitude rule, in words.
    static let altitude = "On each segment, the highest of the altitude assigned in the last clearance, the minimum altitude for IFR operations, and the altitude ATC said to expect in a further clearance."

    /// 91.185(c)(3): when to leave the clearance limit, in words.
    static func leaveLimit(approachFix: Bool, efc: String, eta: String) -> String {
        let at = eta.isEmpty ? "" : ", \(eta)"
        if approachFix {
            return efc.isEmpty
                ? "Begin the descent or the approach as close as possible to your estimated time of arrival\(at), from the filed or amended time en route."
                : "Hold at the clearance limit, and begin the descent or the approach as close as possible to the expect-further-clearance time, \(efc)."
        }
        return efc.isEmpty
            ? "Leave the clearance limit on arriving over it, proceed to a fix an approach begins from, and begin the descent or the approach as close as possible to your estimated time of arrival\(at)."
            : "Leave the clearance limit at the expect-further-clearance time, \(efc), proceed to a fix an approach begins from, and begin the descent or the approach as close as possible to your estimated time of arrival\(at)."
    }
}
