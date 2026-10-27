import Foundation

// The planner's and the gateway's answers the in-flight, traffic and
// route-editing screens read (planning-service/openapi.json, the
// gateway's springboot-app/openapi.json), Codable by hand as Models.swift
// has them: the planner's in its snake case through Planner.snakeCase,
// every property the document lets it leave out an optional.

/// A point of an airplane's track today (TrailPoint): when, s since 1970,
/// where, and its height, none on the ground.
struct TrailPoint: Codable, Equatable, Sendable {
    let t: Double
    let lat: Double
    let lon: Double
    var altFt: Double?
}

/// The field a tracked airplane took off from today, and when (FlightDeparted).
struct FlightDeparted: Codable, Equatable, Sendable {
    let at: Double
    let ident: String
    var name: String?
}

/// A US airplane's record in the FAA's registry (AircraftRegistration),
/// the parts its card shows. The owner's town, never the street.
struct FAARecord: Codable, Equatable, Sendable {
    let nNumber: String
    var aircraftType: String?
    var airworthiness: String?
    var airworthinessDate: String?
    var city: String?
    var coOwners: Int?
    var country: String?
    var engine: String?
    var engineType: String?
    var expires: String?
    var fractional: Bool?
    var horsepower: Int?
    var manufacturer: String?
    var modeSHex: String?
    var model: String?
    var owner: String?
    var ownerType: String?
    var seats: Int?
    var standing: String?
    var state: String?
    var status: String?
    var thrustLb: Int?
    var year: Int?
}

/// An airplane being tracked (FlightDetail): what it is and who flies it,
/// where it took off from and its track today.
struct FlightDetail: Codable, Equatable, Sendable {
    let hex: String
    var departed: FlightDeparted?
    var description: String?
    var `operator`: String?
    var registration: String?
    var type: String?
    var year: String?
    var faa: FAARecord?
    var trail: [TrailPoint]?
}

/// A field one of an airplane's flights began or ended at (PastFlightField).
struct PastFlightField: Codable, Hashable, Sendable {
    let ident: String
    var city: String?
    var name: String?
    var region: String?
}

/// Where and when an airplane last landed (FlightArrival).
struct FlightArrival: Codable, Equatable, Sendable {
    let at: Double
    let ident: String
    var city: String?
    var name: String?
    var region: String?
}

/// An airplane's state now, for the alerts set on it (FlightStatus).
struct FlightStatus: Codable, Equatable, Sendable {
    let hex: String
    var airborne: Bool?
    var aircraft: TrafficAircraft?
    var arrived: FlightArrival?
    var departed: PastFlightField?
    var heardS: Double?
}

/// One of an airplane's flights found (PastFlightSummary): off and on,
/// s since 1970.
struct PastFlightSummary: Codable, Hashable, Sendable, Identifiable {
    let id: Int
    let inAir: Bool
    let landed: Bool
    let maxAltFt: Double
    let off: Double
    let on: Double
    var origin: PastFlightField?
    var destination: PastFlightField?

    /// Back where it left from: a local flight.
    var local: Bool { !inAir && origin != nil && origin?.ident == destination?.ident }
}

struct PastFlights: Codable, Equatable, Sendable {
    let hex: String
    var flights: [PastFlightSummary]?
    var nextUntil: String?
    var registration: String?
    var type: String?
    var unreadDays: Int?
}

/// A report of a past flight (PastFlightPoint).
struct PastFlightPoint: Codable, Equatable, Sendable {
    let t: Double
    let lat: Double
    let lon: Double
    var altFt: Double?
    var gsKt: Double?
    var trackDeg: Double?
    var vrateFpm: Double?
}

struct PastFlight: Codable, Equatable, Sendable {
    let id: Int
    let points: [PastFlightPoint]
}

/// Where each airplane is based (AircraftBases), by ICAO address.
struct AircraftBases: Codable, Equatable, Sendable {
    var based: [String: PastFlightField?]
    var pending: [String]
}

/// Airplanes found by name (TrafficFound): those in the air, and the
/// FAA's record of one named by its N-number where none is.
struct TrafficFound: Codable, Equatable, Sendable {
    var aircraft: [TrafficAircraft]
    /// False where adsb.lol could not be asked yet: what can be shown is.
    var checked: Bool?
    var registered: FAARecord?
    var source: String?
}

/// A flight number's scheduled route (FlightRoute), from Virtual Radar
/// Server's route database: not the flight plan filed.
struct RouteAirport: Codable, Equatable, Sendable {
    let ident: String
    var location: String?
    var name: String?
}

struct FlightRoute: Codable, Equatable, Sendable {
    var airports: [RouteAirport]
    var plausible: Bool?
}

/// A procedure's fix as the chart sets it (ProcedureFix): its altitudes,
/// the least and the most, and its roles (IAF, FAF…).
struct ProcedureFix: Codable, Equatable, Sendable, Identifiable {
    let ident: String
    let lat: Double
    let lon: Double
    var maxFt: Int?
    var minFt: Int?
    var missed: Bool?
    var roles: [String]?

    var id: String { ident }

    /// The chart's altitude in words, as an approach chart sets it (the
    /// FAA's Aeronautical Chart User's Guide: a minimum altitude
    /// underlined, a maximum overlined, a mandatory both): "at 3,000 ft",
    /// "at or above 2,400 ft", "between 3,000 and 4,000 ft".
    var charted: String? {
        switch (minFt, maxFt) {
        case let (low?, high?) where low == high: return "at \(low.formatted()) ft"
        case let (low?, high?): return "between \(low.formatted()) and \(high.formatted()) ft"
        case let (low?, nil): return "at or above \(low.formatted()) ft"
        case let (nil, high?): return "at or below \(high.formatted()) ft"
        default: return nil
        }
    }
}

struct ProcedureDrawing: Codable, Equatable, Sendable {
    let airport: String
    let id: String
    let kind: String
    let name: String
    var transition: String?
    var fixes: [ProcedureFix]
}

/// One line of the checkpoints' notes as they are written
/// (CheckpointNoteMessage): "start", one "checkpoint" each, "error", "done".
struct NoteLine: Codable, Equatable, Sendable {
    let type: String
    var count: Int?
    var id: String?
    var lat: Double?
    var lon: Double?
    var description: String?
    var source: String?
    var detail: String?
}

/// Flight Service, where the gateway has it connected (FlightServiceStatus).
struct FlightServiceStatus: Codable, Equatable, Sendable {
    let connected: Bool
    let provider: String
}

/// A flight plan as the gateway files it (FlightPlanFilingRequest), its
/// items as FAA Form 7233-4 writes them (AIM Appendix 4).
struct FlightPlanFilingRequest: Codable, Equatable, Sendable {
    var rules: String
    var aircraftId: String
    var aircraftType: String
    var departure: String
    var departureTime: String
    var cruisingSpeed: String
    var cruisingLevel: String
    var route: String
    var destination: String
    var eetMinutes: Int
    var enduranceMinutes: Int
    var personsOnBoard: Int?
}

/// A saved flight's flown track (TrackDto): t in ms since 1970, GPS
/// altitude in feet.
struct SavedTrackPoint: Codable, Equatable, Sendable {
    let t: Int64
    let lat: Double
    let lon: Double
    var altFt: Double?
}

struct SavedTrack: Codable, Equatable, Sendable {
    var points: [SavedTrackPoint]
    var source: String
}

extension Planner {
    static func flight(_ hex: String) async throws -> FlightDetail {
        try await fetch(FlightDetail.self, "/api/traffic/flight/\(hex)")
    }

    static func flightStatus(_ hex: String) async throws -> FlightStatus {
        try await fetch(FlightStatus.self, "/api/traffic/flight/\(hex)/status")
    }

    /// Ten flights, newest first; with `until` and `before`, the ten before.
    static func pastFlights(_ hex: String, until: String? = nil, before: Double? = nil) async throws -> PastFlights {
        try await fetch(PastFlights.self, "/api/traffic/flight/\(hex)/history", ["until": until, "before": before.map { String(Int($0)) }])
    }

    static func pastFlight(_ hex: String, id: Int) async throws -> PastFlight {
        try await fetch(PastFlight.self, "/api/traffic/flight/\(hex)/history/\(id)")
    }

    static func based(_ hexes: [String]) async throws -> AircraftBases {
        try await fetch(AircraftBases.self, "/api/traffic/based", ["hex": hexes.prefix(60).joined(separator: ",")])
    }

    static func findTraffic(_ q: String) async throws -> TrafficFound {
        try await fetch(TrafficFound.self, "/api/traffic/find", ["q": q])
    }

    /// A flight number's route; nil for one that is not an airline's.
    static func flightRoute(callsign: String, lat: Double?, lon: Double?) async throws -> FlightRoute? {
        try await fetch(FlightRoute?.self, "/api/traffic/route", ["callsign": callsign, "lat": lat.map { String($0) }, "lon": lon.map { String($0) }])
    }

    static func procedure(_ ident: String, id: String, transition: String?) async throws -> ProcedureDrawing {
        try await fetch(ProcedureDrawing.self, "/api/airport/\(ident)/procedures/\(id)", ["transition": transition])
    }

    struct NoteRoute: Encodable {
        let departureIdent: String
        let destinationIdent: String
        let stops: [String]
    }

    struct NoteSave: Encodable {
        let departureIdent: String
        let destinationIdent: String
        let stops: [String]
        let lat: Double
        let lon: Double
        let description: String
    }

    /// One "how to spot it" line per checkpoint, as they are written: each
    /// a billed call, so asked for only on the pilot's tap.
    static func describeCheckpoints(dep: String, dest: String, stops: [String]) -> AsyncThrowingStream<NoteLine, any Error> {
        lines({ try await request("POST", "/api/checkpoint-notes/generate", json: NoteRoute(departureIdent: dep, destinationIdent: dest, stops: stops), csrf: true) }) {
            try snakeCase.decode(NoteLine.self, from: $0)
        }
    }

    /// A pilot's own note on a checkpoint, saved.
    static func saveNote(dep: String, dest: String, stops: [String], lat: Double, lon: Double, text: String) async throws {
        let note = NoteSave(departureIdent: dep, destinationIdent: dest, stops: stops, lat: lat, lon: lon, description: text)
        _ = try await data(for: request("POST", "/api/checkpoint-notes", json: note, csrf: true), ok: 200...299)
    }

    /// Every note of the pilot's own forgotten; how many.
    static func forgetNotes() async throws -> Int {
        struct Answer: Decodable { let removed: Int }
        return try snakeCase.decode(Answer.self, from: try await data(for: request("DELETE", "/api/checkpoint-notes/mine", json: nil, csrf: true))).removed
    }
}

extension Gateway {
    /// Flight Service's state; nil where it cannot be asked (signed out).
    static func flightService() async throws -> FlightServiceStatus? {
        try await read(FlightServiceStatus.self, "/api/flight-service")
    }

    /// Filed, Flight Service's reference for it.
    static func file(_ plan: FlightPlanFilingRequest) async throws -> String {
        struct Filed: Decodable { let reference: String }
        return try await send(Filed.self, "POST", "/api/flight-service/flight-plans", json: plan).reference
    }

    /// Flight Service's standard briefing for the flight, as its text.
    static func standardBriefing(_ plan: FlightPlanFilingRequest) async throws -> String {
        String(decoding: try await send("POST", "/api/flight-service/briefings", json: plan), as: UTF8.self)
    }

    /// A saved flight's flown track; nil where none is kept.
    static func track(_ flight: Int64) async throws -> SavedTrack? {
        try await read(SavedTrack.self, "/api/flights/\(flight)/track", none: [204, 404])
    }

    static func saveTrack(_ flight: Int64, _ track: SavedTrack) async throws {
        try await send("PUT", "/api/flights/\(flight)/track", json: track)
    }

    static func deleteTrack(_ flight: Int64) async throws {
        try await send("DELETE", "/api/flights/\(flight)/track")
    }
}
