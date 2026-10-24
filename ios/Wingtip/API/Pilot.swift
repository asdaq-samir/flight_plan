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
    var flightReviewOn: String?
    var flightReviewUntil: String?
    var medicalExpiresOn: String?
    var approachesInWindow: Int = 0
    var holdingInWindow: Bool = false
    var trackingInWindow: Bool = false
}

extension Gateway {
    /// JSON from the gateway: its dates as the strings they come as.
    private static func fetch<T: Decodable>(_ type: T.Type, _ path: String) async throws -> T? {
        let (data, response) = try await session.data(for: request("GET", path))
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        switch status {
        case 200: return try JSONDecoder().decode(T.self, from: data)
        case 401, 403, 204: return nil
        default: throw Failure(status: status)
        }
    }

    static func flights() async throws -> [SavedFlight] { try await fetch([SavedFlight].self, "/api/flights") ?? [] }
    static func logbook() async throws -> [LogbookEntry] { try await fetch([LogbookEntry].self, "/api/logbook") ?? [] }
    static func currency() async throws -> Currency? { try await fetch(Currency.self, "/api/logbook/currency") }

    /// A flight saved as planned (POST /api/flights).
    static func save(_ flight: SaveFlightRequest) async throws {
        let (_, response) = try await session.data(for: request("POST", "/api/flights", json: flight))
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(status) else { throw Failure(status: status) }
    }

    static func deleteFlight(_ id: Int64) async throws {
        let (_, response) = try await session.data(for: request("DELETE", "/api/flights/\(id)"))
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(status) else { throw Failure(status: status) }
    }
}
