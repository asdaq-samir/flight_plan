import Foundation

/// An airplane's checklist as the pilot writes it in plain text (the
/// engine's `checklist_read` and `checklist_write`, the web app's
/// lib/checklist): a line starting "#" a section, every other line an
/// item, its challenge and its response split by a dash or a run of dots,
/// as a printed checklist sets them ("Fuel selector -- Both", "Mixture
/// ..... Rich"). An item before any section is in "Checklist". The limits
/// are the gateway's: 40 characters a title, 80 a challenge or a
/// response. The app writes none of its own: the flight manual's is the
/// airplane's.
enum ChecklistText {
    /// Nothing read where the engine cannot answer, which is never for
    /// text.
    static func parse(_ text: String) -> Checklist {
        let read: Checklist? = try? Engine.call("checklist_read", ["text": text])
        return read ?? Checklist(sections: [])
    }

    static func text(of checklist: Checklist) -> String {
        let written: String? = try? Engine.call("checklist_write", ["checklist": checklist])
        return written ?? ""
    }
}

/// The logbook as a CSV file, out and in (the engine's
/// `logbook_csv_write` and `logbook_csv_read`, the web app's
/// lib/logbookCsv): out in ForeFlight's column names where it has the
/// field; in from that file again or from ForeFlight's own export -- an
/// Aircraft Table, then a Flights Table, each a row of field names
/// (ForeFlight Logbook Guide v14.0, "ForeFlight Template"), its names read
/// whatever their spaces or case. All its landings count as day landings
/// for 61.57(a), the night full-stop ones apart (61.57(b)). The entries
/// are the gateway's, camel case, as the engine reads and writes them.
enum LogbookCSV {
    /// RFC 4180's rows of fields (the engine's `csv_rows`).
    static func rows(_ text: String) -> [[String]] {
        let rows: [[String]]? = try? Engine.call("csv_rows", ["text": text])
        return rows ?? []
    }

    /// The logbook as a CSV file, oldest flight first.
    static func csv(_ entries: [LogbookEntry]) -> String {
        let written: String? = try? Engine.call("logbook_csv_write", ["entries": entries])
        return written ?? ""
    }

    struct Skipped: Equatable, Decodable { let line: Int; let reason: String }
    struct Imported: Equatable, Decodable { var entries: [LogbookEntryRequest]; var skipped: [Skipped] }

    /// A logbook CSV read: ForeFlight's, or this logbook's own. A file the
    /// engine could not answer for is one row left out, said so.
    static func read(_ text: String) -> Imported {
        do {
            return try Engine.call("logbook_csv_read", ["text": text])
        } catch {
            return Imported(entries: [], skipped: [Skipped(line: 1, reason: error.localizedDescription)])
        }
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
    /// student's certificate, the rest from the form; runs of space made
    /// one (the engine's `endorsement_render`).
    static func render(_ template: String, student: String, fields: [String: String]) -> String {
        let words: String? = try? Engine.call("endorsement_render", json: ["template": template, "student": student, "fields": fields])
        return words ?? template
    }

    /// "/s/ 10-13-2026 J. J. Jones 987654321CFI RE 12-31-2027": the date,
    /// name, certificate number and its end, as AC 61-65K asks.
    static func signatureLine(_ instructor: Instructor, signedOn: String) -> String {
        let kind = instructor.untilKind == "EXP" ? "Exp." : "RE"
        return "/s/ \(Day.acDay(signedOn)) \(instructor.fullName ?? "") \(instructor.certificate ?? "") \(kind) \(Day.acDay(instructor.until ?? ""))"
    }

    /// The warning above "Sign as" once the instructor's date has passed
    /// on the day of signing, or nil; the engine's `endorsement_lapse`,
    /// the web's lib/endorsements lapseWarning word for word. Never a
    /// block: the owner's rule is to make the pilot aware, not restrict
    /// them (2026-10-26), and the gateway signs either way. A certificate
    /// issued on or after 1 Dec 2024 has no expiration date (14 CFR
    /// 61.19(d)(1)) and its date is the end of the recent experience
    /// 61.197(a) asks for in the preceding 24 calendar months; an older
    /// one expires 24 calendar months from issue, renewal or reinstatement
    /// (61.19(d)(2)), and its privileges then wait for reinstatement under
    /// 61.199 (61.197(e)).
    static func lapseWarning(_ instructor: Instructor, signedOn: String) -> String? {
        do {
            return try Engine.call("endorsement_lapse", json: [
                "until": instructor.until, "until_kind": instructor.untilKind, "signed_on": signedOn,
            ])
        } catch {
            return nil
        }
    }

    /// The latest of each kind signed in the app and not voided; the
    /// record comes newest first (the engine's `endorsements_in_force`,
    /// which answers each code with its index into the record).
    static func inForce(_ signed: [SignedEndorsement]) -> [String: SignedEndorsement] {
        let asked: [[String: Any]] = signed.map { ["code": $0.code, "voided": $0.voided] }
        guard let pairs = (try? Engine.callJSON("endorsements_in_force", ["signed": asked])) as? [[Any]] else { return [:] }
        var out: [String: SignedEndorsement] = [:]
        for pair in pairs {
            guard pair.count == 2, let code = pair[0] as? String, let at = pair[1] as? Int, signed.indices.contains(at) else { continue }
            out[code] = signed[at]
        }
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
    /// lower case, as the ACS writes it (K1a). The engine's `acs_codes`.
    static func acsCodes(in text: String) -> [String] {
        let codes: [String]? = try? Engine.call("acs_codes", ["text": text])
        return codes ?? []
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
            climbFuelBurnGph: opt(climbFuelBurnGph),
            climbTasKt: opt(climbTasKt),
            colour: words(colour),
            cruisePowerPct: opt(cruisePowerPct),
            cruiseTasKt: tas,
            equipment: words(equipment)?.uppercased(),
            fuelBurnGph: burn,
            surveillance: words(surveillance)?.uppercased(),
            tailNumber: tailNumber.trimmingCharacters(in: .whitespaces).uppercased(),
            typeDesignator: typeDesignator.trimmingCharacters(in: .whitespaces).uppercased(),
            usableFuelGal: opt(usableFuelGal))
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
        UserDefaults.standard.decoded(Progress.self, forKey: key(deck)) ?? [:]
    }

    static func keep(_ progress: Progress, for deck: Deck) {
        UserDefaults.standard.setEncoded(progress, forKey: key(deck))
    }
}

/// Two-way radio failure under IFR, the parts that are the rule's words
/// (14 CFR 91.185): the route in the rule's order, VFR's words and when to
/// leave the clearance limit, each the engine's (lost_comms), the web's
/// and the planner's own; the altitude on each segment the engine's too
/// (LostCommsSegmentsSections).
enum LostComms {
    /// The engine's answer with no segments: its words alone.
    static func words(approachFix: Bool = false, efc: String = "", eta: String = "") -> LostCommsAnswer? {
        try? Engine.lostComms(LostCommsAsk(segments: [], assignedFt: nil, expectedFt: nil, expectedFrom: 0,
                                           approachFix: approachFix, efc: efc, eta: eta))
    }

    /// 91.185(c)(1): the route, in the rule's order -- the first that applies.
    static var routes: [LostCommsRoute] { words()?.routes ?? [] }

    /// 91.185(b): what VFR conditions call for, as the page opens.
    static var vfr: String { words()?.vfr ?? "" }

    /// 91.185(c)(2): the altitude rule, in words.
    static let altitude = "On each segment, the highest of the altitude assigned in the last clearance, the minimum altitude for IFR operations, and the altitude ATC said to expect in a further clearance."

    /// 91.185(c)(3): when to leave the clearance limit, in words.
    static func leaveLimit(approachFix: Bool, efc: String, eta: String) -> String {
        words(approachFix: approachFix, efc: efc, eta: eta)?.leave ?? ""
    }
}
