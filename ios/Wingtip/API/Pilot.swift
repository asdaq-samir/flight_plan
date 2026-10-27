import Foundation

/// The pilot's own things on the gateway: saved flights, the logbook and
/// the currency it works out (FlightController, LogbookController). The
/// gateway's dates and figures are shown as given; the app computes no
/// currency of its own (61.56, 61.57 live in the gateway).
struct SavedFlight: Codable, Equatable, Sendable, Identifiable {
    let id: Int64
    let departureIdent: String
    let destinationIdent: String
    var stops: [String] = []
    var aircraftTailNumber: String?
    var cruiseAltitudeFt: Int?
    var totalDistanceNm: Double?
    var totalEteMin: Double?
    var totalFuelGal: Double?
    var plannedFor: String?
    var createdAt: String?
}

struct SaveFlightCheckpoint: Codable, Equatable, Sendable {
    let sequenceNo: Int
    let name: String
    let category: String
    let lat: Double
    let lon: Double
    let alongTrackNm: Double
    var altitudeFt: Double?
    var legDistanceNm: Double?
    var trueCourseDeg: Double?
    var magneticHeadingDeg: Double?
    var groundspeedKt: Double?
    var eteMin: Double?
    var fuelGal: Double?
}

struct SaveFlightRequest: Codable, Equatable, Sendable {
    let departureIdent: String
    let destinationIdent: String
    var stops: [String] = []
    var aircraftId: Int64?
    var cruiseAltitudeFt: Int?
    var totalDistanceNm: Double?
    var totalEteMin: Double?
    var totalFuelGal: Double?
    var plannedFor: String?
    var checkpoints: [SaveFlightCheckpoint] = []
}

struct LogbookEntry: Codable, Equatable, Sendable, Identifiable {
    let id: Int64
    let flownOn: String
    var aircraft: String?
    var aircraftType: String?
    var route: String?
    var remarks: String?
    var totalHours: Double = 0
    var nightHours: Double = 0
    var crossCountryHours: Double = 0
    var instrumentHours: Double = 0
    var dayLandings: Int = 0
    var nightLandings: Int = 0
    var approaches: Int = 0
    var distanceNm: Double = 0
    // The columns a student's 61.109 experience and instrument currency
    // (61.57(c)) are counted from; optional, read where the gateway sends them.
    var dualHours: Double?
    var soloHours: Double?
    var toweredLandings: Int?
    var longestLegNm: Double?
    var holding: Bool?
    var tracking: Bool?
}

/// What the gateway says of the pilot's currency (CurrencyDto): the
/// dates each of 61.57's windows runs to, the flight review and the
/// medical, and the hours behind them.
struct Currency: Codable, Equatable, Sendable {
    var totalHours: Double = 0
    var nightHours: Double = 0
    var crossCountryHours: Double = 0
    var flights: Int = 0
    var landings: Int = 0
    var dayPassengersUntil: String?
    var nightPassengersUntil: String?
    var instrumentCurrentUntil: String?
    var ipcNeededAfter: String?
    var ipcOn: String?
    var flightReviewOn: String?
    var flightReviewUntil: String?
    var medicalExpiresOn: String?
    var approachesInWindow: Int = 0
    var holdingInWindow: Bool = false
    var trackingInWindow: Bool = false
}

/// The student's training (TrainingDto) and its parts, the fields shown.
struct Training: Codable, Equatable, Sendable {
    var fullName: String?
    var instructors: [InstructorLink] = []
    var signed: [SignedEndorsement] = []
    var reviews: [CrossCountryReview] = []
    var experience: [ExperienceItem] = []
    /// AC 61-65K's endorsements the gateway offers, those recorded from
    /// paper, and the knowledge test report's ACS codes.
    var kinds: [EndorsementKind]?
    var endorsements: [RecordedEndorsement]?
    var knowledgeTestCodes: [String]?
}

struct InstructorLink: Codable, Equatable, Sendable, Identifiable {
    let id: Int64
    let email: String
    var name: String?
    var accepted: Bool = false
    var askedAt: String?
    var certificate: String?
}

struct SignedEndorsement: Codable, Equatable, Sendable, Identifiable {
    let id: Int64
    let code: String
    let text: String
    let signedOn: String
    var until: String?
    var voided: Bool = false
    /// The signature line as signed, and whom for (on an instructor's record).
    var signature: String?
    var studentName: String?
    var fields: [String: String]?
}

struct ReviewCheck: Codable, Equatable, Sendable {
    let label: String
    let detail: String
    let rule: String
    var met: Bool = false
}

struct CrossCountryReview: Codable, Equatable, Sendable, Identifiable {
    let id: Int64
    let flightOn: String
    let makeModel: String
    var checks: [ReviewCheck] = []
    var answeredAt: String?
    var declinedNote: String?
    var instructorName: String?
    var askedAt: String?
    var note: String?
    var studentId: Int64?
    var studentName: String?
    /// The flight as saved (FlightSummaryDto), and the endorsement signed
    /// for it, once one is.
    var flight: SavedFlight?
    var endorsement: SignedEndorsement?
}

/// One line of the experience logged against a requirement
/// (ExperienceItemDto): what is had and needed, in its unit, and the
/// rule it comes from, judged by the gateway.
struct ExperienceItem: Codable, Equatable, Sendable {
    let key: String
    let label: String
    let rule: String
    let unit: String
    let have: Double
    let need: Double
    var met: Bool = false

    var words: String {
        func n(_ v: Double) -> String { v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v) }
        return "\(n(have)) of \(n(need)) \(unit)"
    }
}

extension Gateway {
    static func training() async throws -> Training? { try await read(Training.self, "/api/training") }

    /// An instructor asked in by their address (/api/training/instructors).
    static func askInstructor(email: String) async throws {
        struct Ask: Encodable { let email: String }
        try await send("POST", "/api/training/instructors", json: Ask(email: email))
    }

    static func flights() async throws -> [SavedFlight] { try await read([SavedFlight].self, "/api/flights") ?? [] }
    static func logbook() async throws -> [LogbookEntry] { try await read([LogbookEntry].self, "/api/logbook") ?? [] }
    static func currency() async throws -> Currency? { try await read(Currency.self, "/api/logbook/currency") }

    /// A flight saved as planned (POST /api/flights).
    static func save(_ flight: SaveFlightRequest) async throws {
        try await send("POST", "/api/flights", json: flight)
    }

    static func deleteFlight(_ id: Int64) async throws {
        try await send("DELETE", "/api/flights/\(id)")
    }
}
