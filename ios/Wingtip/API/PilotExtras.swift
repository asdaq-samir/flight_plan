import Foundation

// The pilot's own records on the gateway, past what Pilot.swift reads:
// their airplanes with checklists, squawks, inspections and VOR checks,
// the logbook written to, the account's contact and its deletion, and the
// instructor's side of training. Shapes as springboot-app/openapi.json
// gives them, in its own camelCase names; dates are the "2026-10-25"
// strings it sends. Every rule (61.57's windows, 91.171's limits, 91.409's
// months) is worked out by the gateway; the app shows its answers.

/// One of the pilot's airplanes in full (AircraftDto): the figures the
/// nav log flies it on, its flight plan items, and the gateway's record
/// of its inspections, open squawks and last VOR check.
struct OwnAircraftRecord: Codable, Equatable, Sendable, Identifiable {
    let id: Int64
    let tailNumber: String
    let typeDesignator: String
    let cruiseTasKt: Double
    let fuelBurnGph: Double
    var usableFuelGal: Double?
    var cruisePowerPct: Double?
    var climbTasKt: Double?
    var climbFuelBurnGph: Double?
    var equipment: String?
    var surveillance: String?
    var colour: String?
    var createdAt: String?
    var inspections: Inspections?
    var openSquawks: [Squawk]?
    var vorCheck: VorCheck?
}

/// The inspections as the owner records them, with the last day each is
/// good for as the gateway works it out (InspectionsDto): the annual
/// (14 CFR 91.409(a)), the 100-hour (91.409(b)), the altimeter and static
/// (91.411), the transponder (91.413) and the ELT (91.207(c), (d)).
struct Inspections: Codable, Equatable, Sendable {
    var annualOn: String?
    var annualGoodThrough: String?
    var staticCheckOn: String?
    var staticCheckGoodThrough: String?
    var transponderCheckOn: String?
    var transponderCheckGoodThrough: String?
    var eltInspectedOn: String?
    var eltInspectionGoodThrough: String?
    var eltBatteryDueOn: String?
    var hoursNow: Double?
    var hundredHourAtHours: Double?
    var hundredHourDueAtHours: Double?
}

/// What the inspections' form saves (InspectionsRequest): a blank is null.
struct InspectionsRequest: Codable, Equatable, Sendable {
    var annualOn: String?
    var staticCheckOn: String?
    var transponderCheckOn: String?
    var eltInspectedOn: String?
    var eltBatteryDueOn: String?
    var hoursNow: Double?
    var hundredHourAtHours: Double?

    init(_ i: Inspections?) {
        annualOn = i?.annualOn; staticCheckOn = i?.staticCheckOn; transponderCheckOn = i?.transponderCheckOn
        eltInspectedOn = i?.eltInspectedOn; eltBatteryDueOn = i?.eltBatteryDueOn
        hoursNow = i?.hoursNow; hundredHourAtHours = i?.hundredHourAtHours
    }
}

/// A squawk (SquawkDto): open until fixed; an inoperative instrument or
/// equipment carries the kinds of flight its 14 CFR 91.213(d)
/// determination covers.
struct Squawk: Codable, Equatable, Sendable, Identifiable {
    let id: Int64
    let reportedOn: String
    let text: String
    var inoperative: Bool
    var deferredFor: String?
    var fixedOn: String?
    var fixNote: String?

    var request: SquawkRequest {
        SquawkRequest(reportedOn: reportedOn, text: text, inoperative: inoperative, deferredFor: deferredFor, fixedOn: fixedOn, fixNote: fixNote)
    }
}

struct SquawkRequest: Codable, Equatable, Sendable {
    var reportedOn: String
    var text: String
    var inoperative: Bool
    var deferredFor: String?
    var fixedOn: String?
    var fixNote: String?
}

/// The kinds of flight a 91.213(d) determination can be made for, in the
/// rule's order (91.205(b)-(d)), as the web app's SquawksPage words them.
enum Deferral {
    static let reaches: [(value: String?, label: String)] = [
        (nil, "Not deferred"),
        ("VFR_DAY", "Deferred for VFR by day"),
        ("VFR", "Deferred for VFR, day and night"),
        ("ALL", "Deferred for every kind"),
    ]

    /// How an open squawk stands: nothing for one that leaves the
    /// equipment working.
    static func standing(_ s: Squawk) -> String? {
        guard s.inoperative else { return nil }
        guard let to = s.deferredFor else { return "Inoperative, not deferred" }
        return reaches.first { $0.value == to }?.label ?? to
    }
}

/// The airplane's last VOR check for IFR (VorCheckDto, 14 CFR 91.171):
/// the gateway gives the limit for its kind and the last day it is good
/// for, 30 days on (91.171(a)(2)).
struct VorCheck: Codable, Equatable, Sendable {
    let checkedOn: String
    let errorDeg: Double
    let goodThrough: String
    let kind: String
    let limitDeg: Double
    var place: String?
    let withinLimit: Bool
}

struct VorCheckRequest: Codable, Equatable, Sendable {
    var checkedOn: String
    var errorDeg: Double
    var kind: String
    var place: String?
}

/// The ways 91.171 lets a VOR be checked, with the largest bearing error
/// each allows, as the picker names them: 4 degrees at a VOT or a repair
/// station's test signal (91.171(b)(1)) or a ground checkpoint
/// (91.171(b)(2)), 6 at an airborne checkpoint (91.171(b)(3)) or on an
/// airway's radial in flight (91.171(b)(4)), and 4 between two receivers
/// (91.171(c)). The gateway judges the check by its own limitDeg.
enum VorCheckKind {
    static let all: [(value: String, label: String, limitDeg: Int)] = [
        ("VOT", "VOT", 4),
        ("REPAIR_STATION", "Repair station signal", 4),
        ("GROUND", "Ground checkpoint", 4),
        ("AIRBORNE", "Airborne checkpoint", 6),
        ("RADIAL", "Airway radial in flight", 6),
        ("DUAL", "Dual receivers", 4),
    ]

    static func label(_ kind: String) -> String { all.first { $0.value == kind }?.label ?? kind }
}

/// An airplane's checklist as its owner writes it (ChecklistDto).
struct Checklist: Codable, Equatable, Sendable {
    var sections: [ChecklistSection]
}

struct ChecklistSection: Codable, Equatable, Sendable {
    var title: String
    var items: [ChecklistItem]
}

struct ChecklistItem: Codable, Equatable, Sendable {
    var challenge: String
    var response: String?
}

/// The airplane as the form saves it (AircraftRequest).
struct AircraftRequest: Codable, Equatable, Sendable {
    var tailNumber: String
    var typeDesignator: String
    var cruiseTasKt: Double
    var fuelBurnGph: Double
    var cruisePowerPct: Double?
    var climbTasKt: Double?
    var climbFuelBurnGph: Double?
    var usableFuelGal: Double?
    var equipment: String?
    var surveillance: String?
    var colour: String?
}

/// A flight logged (LogbookEntryRequest): a paper logbook's columns.
struct LogbookEntryRequest: Codable, Equatable, Sendable {
    var flownOn: String
    var aircraft: String?
    var aircraftType: String?
    var route: String?
    var remarks: String?
    var totalHours: Double = 0
    var nightHours: Double = 0
    var crossCountryHours: Double = 0
    var dualHours: Double = 0
    var soloHours: Double = 0
    var instrumentHours: Double = 0
    var dayLandings: Int = 0
    var nightLandings: Int = 0
    var toweredLandings: Int = 0
    var distanceNm: Double = 0
    var longestLegNm: Double = 0
    var approaches: Int = 0
    var holding: Bool = false
    var tracking: Bool = false

    /// A new flight's form: today, one landing by day, the airplane flown.
    static func blank(aircraft: String?) -> LogbookEntryRequest {
        LogbookEntryRequest(flownOn: Day.today(), aircraft: aircraft, dayLandings: 1)
    }

    init(flownOn: String, aircraft: String? = nil, aircraftType: String? = nil, route: String? = nil, remarks: String? = nil,
         totalHours: Double = 0, nightHours: Double = 0, crossCountryHours: Double = 0, dualHours: Double = 0, soloHours: Double = 0,
         instrumentHours: Double = 0, dayLandings: Int = 0, nightLandings: Int = 0, toweredLandings: Int = 0,
         distanceNm: Double = 0, longestLegNm: Double = 0, approaches: Int = 0, holding: Bool = false, tracking: Bool = false) {
        self.flownOn = flownOn; self.aircraft = aircraft; self.aircraftType = aircraftType; self.route = route; self.remarks = remarks
        self.totalHours = totalHours; self.nightHours = nightHours; self.crossCountryHours = crossCountryHours
        self.dualHours = dualHours; self.soloHours = soloHours; self.instrumentHours = instrumentHours
        self.dayLandings = dayLandings; self.nightLandings = nightLandings; self.toweredLandings = toweredLandings
        self.distanceNm = distanceNm; self.longestLegNm = longestLegNm; self.approaches = approaches
        self.holding = holding; self.tracking = tracking
    }

    /// An entry as its form opens it.
    init(_ e: LogbookEntry) {
        self.init(flownOn: e.flownOn, aircraft: e.aircraft, aircraftType: e.aircraftType, route: e.route, remarks: e.remarks,
                  totalHours: e.totalHours, nightHours: e.nightHours, crossCountryHours: e.crossCountryHours,
                  dualHours: e.dualHours ?? 0, soloHours: e.soloHours ?? 0, instrumentHours: e.instrumentHours,
                  dayLandings: e.dayLandings, nightLandings: e.nightLandings, toweredLandings: e.toweredLandings ?? 0,
                  distanceNm: e.distanceNm, longestLegNm: e.longestLegNm ?? 0, approaches: e.approaches,
                  holding: e.holding ?? false, tracking: e.tracking ?? false)
    }

    /// Blank words sent as null, not as "".
    var trimmed: LogbookEntryRequest {
        var out = self
        func blankNil(_ s: String?) -> String? { let t = (s ?? "").trimmingCharacters(in: .whitespaces); return t.isEmpty ? nil : t }
        out.aircraft = blankNil(aircraft); out.aircraftType = blankNil(aircraftType); out.route = blankNil(route); out.remarks = blankNil(remarks)
        return out
    }
}

/// The dates the pilot gives the currency (CurrencyDatesRequest).
struct CurrencyDatesRequest: Codable, Equatable, Sendable {
    var flightReviewOn: String?
    var medicalExpiresOn: String?
    var ipcOn: String?
}

struct Reminders: Codable, Equatable, Sendable { var on: Bool }

struct LogbookImportResult: Codable, Equatable, Sendable {
    var added: Int
    var duplicates: Int
}

/// An AC 61-65K endorsement as the gateway offers it to sign
/// (EndorsementKindDto): its words with blanks, the paragraph and the
/// 14 CFR section it comes from, and how many days it runs.
struct EndorsementKind: Codable, Equatable, Sendable, Identifiable {
    let code: String
    let label: String
    let paragraph: String
    let rule: String
    let template: String
    var validDays: Int?
    var fields: [EndorsementField]
    var id: String { code }
}

struct EndorsementField: Codable, Equatable, Sendable {
    let key: String
    let label: String
    let example: String
    var required: Bool
}

/// An endorsement recorded from paper (EndorsementDto): the day it was
/// signed, and the day it runs to where it runs out.
struct RecordedEndorsement: Codable, Equatable, Sendable {
    let code: String
    let endorsedOn: String
    var until: String?
}

/// The instructor's own record (InstructorDto): their certificate as
/// endorsements print it, who asks them in, their students, the solo
/// cross-countries put to them and what they signed.
struct Instructor: Codable, Equatable, Sendable {
    var fullName: String?
    var certificate: String?
    var until: String?
    var untilKind: String?
    var asking: [StudentRow]
    var students: [StudentRow]
    var kinds: [EndorsementKind]
    var reviews: [CrossCountryReview]
    var signed: [SignedEndorsement]
}

struct StudentRow: Codable, Equatable, Sendable, Identifiable {
    let linkId: Int64
    let studentId: Int64
    let name: String
    let email: String
    var accepted: Bool
    var askedAt: String?
    var experienceMet: Int
    var experienceOf: Int
    var reviewsWaiting: Int
    var soloUntil: String?
    var id: Int64 { linkId }
}

struct InstructorRequest: Codable, Equatable, Sendable {
    var fullName: String
    var certificate: String
    var until: String
    var untilKind: String
}

struct SignRequest: Codable, Equatable, Sendable {
    var code: String
    var fields: [String: String]
    var reviewId: Int64?
    var signedOn: String
    var text: String
}

struct AskReviewRequest: Codable, Equatable, Sendable {
    var flightId: Int64
    var flightOn: String
    var instructorId: Int64
    var makeModel: String
    var note: String?
}

extension Gateway {
    // The airplanes.
    static func aircraftRecords() async throws -> [OwnAircraftRecord] { try await read([OwnAircraftRecord].self, "/api/aircraft") ?? [] }
    static func addAircraft(_ r: AircraftRequest) async throws -> OwnAircraftRecord { try await send(OwnAircraftRecord.self, "POST", "/api/aircraft", json: r) }
    static func updateAircraft(_ id: Int64, _ r: AircraftRequest) async throws -> OwnAircraftRecord {
        try await send(OwnAircraftRecord.self, "PUT", "/api/aircraft/\(id)", json: r)
    }
    static func deleteAircraft(_ id: Int64) async throws { try await send("DELETE", "/api/aircraft/\(id)") }
    static func checklist(_ id: Int64) async throws -> Checklist { try await send(Checklist.self, "GET", "/api/aircraft/\(id)/checklist") }
    static func saveChecklist(_ id: Int64, _ c: Checklist) async throws -> Checklist {
        try await send(Checklist.self, "PUT", "/api/aircraft/\(id)/checklist", json: c)
    }
    static func saveInspections(_ id: Int64, _ r: InspectionsRequest) async throws -> OwnAircraftRecord {
        try await send(OwnAircraftRecord.self, "PUT", "/api/aircraft/\(id)/inspections", json: r)
    }
    static func squawks(_ id: Int64) async throws -> [Squawk] { try await send([Squawk].self, "GET", "/api/aircraft/\(id)/squawks") }
    static func addSquawk(_ id: Int64, _ r: SquawkRequest) async throws -> Squawk {
        try await send(Squawk.self, "POST", "/api/aircraft/\(id)/squawks", json: r)
    }
    static func updateSquawk(_ id: Int64, _ squawk: Int64, _ r: SquawkRequest) async throws -> Squawk {
        try await send(Squawk.self, "PUT", "/api/aircraft/\(id)/squawks/\(squawk)", json: r)
    }
    static func deleteSquawk(_ id: Int64, _ squawk: Int64) async throws { try await send("DELETE", "/api/aircraft/\(id)/squawks/\(squawk)") }
    static func recordVorCheck(_ id: Int64, _ r: VorCheckRequest) async throws -> OwnAircraftRecord {
        try await send(OwnAircraftRecord.self, "PUT", "/api/aircraft/\(id)/vor-check", json: r)
    }

    // The logbook.
    static func addLogbookEntry(_ r: LogbookEntryRequest) async throws { try await send("POST", "/api/logbook", json: r.trimmed) }
    static func updateLogbookEntry(_ id: Int64, _ r: LogbookEntryRequest) async throws { try await send("PUT", "/api/logbook/\(id)", json: r.trimmed) }
    static func deleteLogbookEntry(_ id: Int64) async throws { try await send("DELETE", "/api/logbook/\(id)") }
    static func setCurrencyDates(_ r: CurrencyDatesRequest) async throws -> Currency { try await send(Currency.self, "PUT", "/api/logbook/currency", json: r) }
    static func reminders() async throws -> Reminders? { try await read(Reminders.self, "/api/logbook/reminders") }
    static func setReminders(_ on: Bool) async throws -> Reminders { try await send(Reminders.self, "PUT", "/api/logbook/reminders", json: Reminders(on: on)) }
    static func importLogbook(_ entries: [LogbookEntryRequest]) async throws -> LogbookImportResult {
        struct Body: Encodable { let entries: [LogbookEntryRequest] }
        return try await send(LogbookImportResult.self, "POST", "/api/logbook/import", json: Body(entries: entries))
    }

    // The account.
    static func setContact(phone: String?, homeBase: String?) async throws -> Pilot {
        struct Body: Encodable { let phone: String?; let homeBase: String? }
        return try await send(Pilot.self, "PUT", "/api/me/contact", json: Body(phone: phone, homeBase: homeBase))
    }
    /// Everything that was the pilot's, and every session they hold
    /// (DELETE /api/me, 204); a 502 deleted nothing.
    static func deleteAccount() async throws { try await send("DELETE", "/api/me") }

    // The student's side of training.
    static func setTrainingName(_ name: String) async throws -> Training {
        struct Body: Encodable { let fullName: String }
        return try await send(Training.self, "PUT", "/api/training/name", json: Body(fullName: name))
    }
    static func setKnowledgeTest(_ codes: [String]) async throws -> Training {
        struct Body: Encodable { let codes: [String] }
        return try await send(Training.self, "PUT", "/api/training/knowledge-test", json: Body(codes: codes))
    }
    /// An endorsement signed on paper, recorded by its day; nil takes it off.
    static func recordEndorsement(_ code: String, on day: String?) async throws -> Training {
        struct Body: Encodable { let endorsedOn: String }
        if let day { return try await send(Training.self, "PUT", "/api/training/endorsements/\(code)", json: Body(endorsedOn: day)) }
        return try await send(Training.self, "DELETE", "/api/training/endorsements/\(code)")
    }
    static func dropInstructor(_ id: Int64) async throws -> Training { try await send(Training.self, "DELETE", "/api/training/instructors/\(id)") }
    static func askReview(_ r: AskReviewRequest) async throws -> Training { try await send(Training.self, "POST", "/api/training/reviews", json: r) }
    static func withdrawReview(_ id: Int64) async throws -> Training { try await send(Training.self, "DELETE", "/api/training/reviews/\(id)") }

    // The instructor's side.
    static func instructor() async throws -> Instructor? { try await read(Instructor.self, "/api/instructor") }
    static func setInstructor(_ r: InstructorRequest) async throws -> Instructor { try await send(Instructor.self, "PUT", "/api/instructor", json: r) }
    static func stopInstructing() async throws -> Instructor { try await send(Instructor.self, "DELETE", "/api/instructor") }
    static func acceptStudent(_ linkId: Int64) async throws -> Instructor {
        try await send(Instructor.self, "POST", "/api/instructor/students/\(linkId)/accept")
    }
    static func leaveStudent(_ linkId: Int64) async throws -> Instructor { try await send(Instructor.self, "DELETE", "/api/instructor/students/\(linkId)") }
    static func voidEndorsement(_ id: Int64) async throws -> Instructor {
        try await send(Instructor.self, "POST", "/api/instructor/endorsements/\(id)/void")
    }
    static func declineReview(_ id: Int64, note: String) async throws -> Instructor {
        struct Body: Encodable { let note: String }
        return try await send(Instructor.self, "POST", "/api/instructor/reviews/\(id)/decline", json: Body(note: note))
    }
    static func studentTraining(_ studentId: Int64) async throws -> Training {
        try await send(Training.self, "GET", "/api/instructor/students/\(studentId)/training")
    }
    static func sign(_ studentId: Int64, _ r: SignRequest) async throws -> Training {
        try await send(Training.self, "POST", "/api/instructor/students/\(studentId)/endorsements", json: r)
    }
}

/// A day as the gateway sends one ("2026-10-25", the pilot's own
/// calendar day) and as the pages say it.
enum Day {
    private static func formatter(_ format: String, in zone: TimeZone = .current) -> DateFormatter {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = zone
        f.dateFormat = format
        return f
    }
    private static let iso = formatter("yyyy-MM-dd")
    private static let page = formatter("d MMM yyyy")
    private static let ac = formatter("MM-dd-yyyy")

    /// The day a moment falls on in the pilot's own calendar, as the
    /// gateway and the planner read one; in another zone where asked.
    static func string(_ date: Date, in zone: TimeZone = .current) -> String {
        zone == iso.timeZone ? iso.string(from: date) : formatter("yyyy-MM-dd", in: zone).string(from: date)
    }
    static func date(_ day: String) -> Date? { iso.date(from: String(day.prefix(10))) }
    static func today() -> String { string(Date()) }
    /// "13 Oct 2026", as the web app's pages say a day.
    static func said(_ day: String) -> String { date(day).map { page.string(from: $0) } ?? day }
    /// "10-13-2026", as AC 61-65K's samples write one.
    static func acDay(_ day: String) -> String { date(day).map { ac.string(from: $0) } ?? day }
    /// Whether a last good day is today or later. The days are the
    /// gateway's; the app only compares them with today's.
    static func current(_ through: String?, today: String = Day.today()) -> Bool {
        guard let through else { return false }
        return String(through.prefix(10)) >= today
    }
}
