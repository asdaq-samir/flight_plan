import Foundation

/// The figures the web app works out on its pages, worked out by the
/// planner for this app (app.figures), which computes none of its own:
/// a flown track's debrief (POST /api/debrief), the diversion drill (GET
/// /api/diversion), a hold's entry and wind (GET /api/holding) and lost
/// communications' altitudes (POST /api/lost-comms). Each answer decoded
/// from the planner's snake case.

// MARK: - The debrief

/// A saved flight with its nav log (the gateway's FlightDto): what its
/// debrief is read against. Only the checkpoints are wanted here.
struct SavedFlightDetail: Codable, Equatable, Sendable {
    let id: Int64
    var checkpoints: [SaveFlightCheckpoint]
}

/// POST /api/debrief's question (DebriefAsk): the flight's checkpoints and
/// the track's points, sent in snake case (sequence_no, alt_ft…).
struct DebriefAsk: Encodable, Sendable {
    let checkpoints: [SaveFlightCheckpoint]
    let points: [SavedTrackPoint]
}

struct LegGrade: Codable, Equatable, Sendable {
    let from: String
    let to: String
    var plannedAltFt: Double?
    var altitudeWithin: Double?
    var worstAltFt: Double?
    var courseDeg: Double?
    var courseWithin: Double?
    var worstOffNm: Double?
    let ok: Bool
}

struct CheckpointPass: Codable, Equatable, Sendable {
    let name: String
    let category: String
    let landed: Bool
    var dueMin: Double?
    var passedMin: Double?
    var closestNm: Double?
    var lateMin: Double?
    var ok: Bool?
}

struct PatternEntry: Codable, Equatable, Sendable {
    let ident: String
    let altFt: Double
    let patternFt: Double
    let offFt: Double
    let ok: Bool
}

struct DebriefProfilePoint: Codable, Equatable, Sendable {
    let alongNm: Double
    let altFt: Double
}

struct DebriefLinePoint: Codable, Equatable, Sendable {
    let lat: Double
    let lon: Double
    let off: Bool
}

/// The flight debriefed (Debrief): takeoff and landing in ms since 1970.
struct Debrief: Codable, Equatable, Sendable {
    let takeoff: Double
    let landing: Double
    let flownMin: Double
    var plannedMin: Double?
    let legs: [LegGrade]
    let passes: [CheckpointPass]
    let patterns: [PatternEntry]
    let profile: [DebriefProfilePoint]
    let line: [DebriefLinePoint]
    let hasAltitude: Bool
    let notes: [String]
}

/// ACS PA.VI.A's and PA.III.B's tolerances, the planner's, for headings.
struct DebriefTolerances: Codable, Equatable, Sendable {
    let altitudeFt: Double
    let courseDeg: Double
    let offRouteNm: Double
    let etaMin: Double
    let patternFt: Double
}

struct DebriefAnswer: Codable, Equatable, Sendable {
    /// None where the track never flew faster than taxiing.
    var debrief: Debrief?
    let tolerances: DebriefTolerances
}

// MARK: - The diversion drill

struct DiversionWind: Codable, Equatable, Sendable {
    let windDirTrueDeg: Double
    let windSpeedKt: Double
}

struct DiversionSolved: Codable, Equatable, Sendable {
    let tc: Double
    let distanceNm: Double
    let wca: Double
    let th: Double
    let mh: Double
    let gs: Double
    let ete: Double
    let fuel: Double
}

struct DiversionStep: Codable, Equatable, Sendable {
    let name: String
    let value: String
}

/// A student's estimate against the exact figure (EstimateCheck).
struct EstimateCheck: Codable, Equatable, Sendable {
    let key: String
    let label: String
    let unit: String
    let allowance: Double
    var typed: Double?
    var exact: Double?
    var written: String?
    var reasonable: Bool?
}

struct DiversionAnswer: Codable, Equatable, Sendable {
    let to: String
    let name: String
    let altitudeFt: Double
    let tasKt: Double
    let fuelBurnGph: Double
    let magneticVariationDeg: Double
    var wind: DiversionWind?
    var solved: DiversionSolved?
    let steps: [DiversionStep]
    var problem: String?
    let checks: [EstimateCheck]
}

// MARK: - Holding

struct HoldLeg: Codable, Equatable, Sendable {
    let heading: Double
    let wca: Double
    let gs: Double
}

struct HoldingWind: Codable, Equatable, Sendable {
    let legMin: Double
    let inbound: HoldLeg
    let outbound: HoldLeg
    let outboundSec: Double
    let inboundWords: String
    let outboundWords: String
    let timeWords: String
}

struct HoldingAnswer: Codable, Equatable, Sendable {
    let entry: String
    let entryName: String
    let steps: String
    var either: String?
    var eitherName: String?
    let approachRelative: Double
    var wind: HoldingWind?
    var windProblem: String?
}

// MARK: - Lost communications

struct LostCommsSegmentAsk: Codable, Equatable, Sendable {
    var name: String
    var minimumFt: Double?
}

/// POST /api/lost-comms's question (LostCommsAsk), in snake case.
struct LostCommsAsk: Encodable, Equatable, Sendable {
    var segments: [LostCommsSegmentAsk]
    var assignedFt: Double?
    var expectedFt: Double?
    var expectedFrom: Int
    var approachFix: Bool
    var efc: String
    var eta: String
}

struct LostCommsRoute: Codable, Equatable, Sendable {
    let key: String
    let label: String
    let rule: String
}

struct FlownSegment: Codable, Equatable, Sendable {
    let name: String
    var fly: Double?
    var because: String?
    let words: String
}

struct LostCommsAnswer: Codable, Equatable, Sendable {
    let vfr: String
    let routes: [LostCommsRoute]
    let segments: [FlownSegment]
    let leave: String
}

// MARK: - The calls

extension Planner {
    /// A flight's track debriefed against its nav log (POST /api/debrief).
    static func debrief(checkpoints: [SaveFlightCheckpoint], points: [SavedTrackPoint]) async throws -> DebriefAnswer {
        try await postRead(DebriefAnswer.self, "/api/debrief", DebriefAsk(checkpoints: checkpoints, points: points))
    }

    /// The diversion from a point to a field in the planner's air there,
    /// the student's estimates checked where given (GET /api/diversion).
    static func diversion(lat: Double, lon: Double, to ident: String, altitudeFt: Double, aircraft: String, figures: Figures,
                          estimates: [String: Double]) async throws -> DiversionAnswer {
        var query: [String: String?] = [
            "lat": String(lat), "lon": String(lon), "to": ident, "altitude_ft": String(Int(altitudeFt.rounded())), "aircraft": aircraft,
            "cruise_tas_kt": figures.cruiseTasKt.map { String($0) }, "fuel_burn_gph": figures.fuelBurnGph.map { String($0) },
            "cruise_power_pct": figures.cruisePowerPct.map { String($0) },
        ]
        for (key, value) in estimates { query[key] = String(value) }
        return try await fetch(DiversionAnswer.self, "/api/diversion", query)
    }

    /// A hold's entry and, given the air, its legs (GET /api/holding).
    static func holding(inbound: Double, heading: Double, turns: String, tasKt: Double?, windFrom: Double?, windKt: Double?,
                        altitudeFt: Double?) async throws -> HoldingAnswer {
        try await fetch(HoldingAnswer.self, "/api/holding", [
            "inbound": String(inbound), "heading": String(heading), "turns": turns,
            "tas_kt": tasKt.map { String($0) }, "wind_from": windFrom.map { String($0) }, "wind_kt": windKt.map { String($0) },
            "altitude_ft": altitudeFt.map { String($0) },
        ])
    }

    /// Lost communications' altitudes and leaving the limit (POST /api/lost-comms).
    static func lostComms(_ ask: LostCommsAsk) async throws -> LostCommsAnswer {
        try await postRead(LostCommsAnswer.self, "/api/lost-comms", ask)
    }
}

extension Gateway {
    /// One of the pilot's saved flights with its nav log (/api/flights/{id}).
    static func flightDetail(_ id: Int64) async throws -> SavedFlightDetail {
        try await send(SavedFlightDetail.self, "GET", "/api/flights/\(id)")
    }
}
