import Foundation

/// The nav log as the planner streams it (/api/navlog, newline-delimited
/// JSON, app.schemas.NavLogMessage): a "stage" line before each slow
/// piece of work, one "altitude" line once the altitudes are decided,
/// one "leg" line per leg, then "done" with the totals -- or "error"
/// where no route can be flown. Decoded by hand: a stream is not an
/// OpenAPI response.
enum NavLogMessage: Equatable, Sendable {
    case stage(String)
    case altitude(NavLogAltitude)
    case leg(Leg)
    case done(Totals)
    case error(NavLogError)
}

/// The altitude line: which plan is flown, at what, the four plans, the
/// figures for every legal altitude (the wheel's rows), the pilot's own
/// altitude's cautions, and the planner's reasoning (the selection).
struct NavLogAltitude: Codable, Equatable, Sendable {
    var flown: String?
    var altitudeFt: Double?
    var options: [AltitudeOption] = []
    var altitudeFigures: [AltitudeFigure] = []
    var cautions: [AltitudeCaution] = []
    var altitudeSelection: AltitudeSelection?
}

/// One of the planner's four plans (AltitudeOption).
struct AltitudeOption: Codable, Equatable, Sendable, Identifiable {
    let kind: String
    var steps: [AltitudeStep] = []
    var eteMin: Double?
    var fuelGal: Double?
    var tailwindKt: Double?
    var needsOxygen: Bool = false

    var id: String { kind }
    /// The plan's highest altitude, the figure its row shows.
    var altitudeFt: Double? { steps.map(\.altitudeFt).max() }
}

struct AltitudeStep: Codable, Equatable, Sendable {
    let from: String
    let to: String
    let altitudeFt: Double
    let distanceNm: Double
}

/// The flight's figures at one legal altitude (AltitudeFigure).
struct AltitudeFigure: Codable, Equatable, Sendable, Identifiable {
    let altitudeFt: Double
    var eteMin: Double?
    var fuelGal: Double?
    var tailwindKt: Double?
    var everywhere: Bool = true

    var id: Double { altitudeFt }
}

/// What is wrong with an altitude the pilot set (AltitudeCaution): a
/// warning, never a refusal.
struct AltitudeCaution: Codable, Equatable, Sendable, Identifiable {
    let fromIdent: String
    let toIdent: String
    let altitudeFt: Double
    let reasons: [String]

    var id: String { "\(fromIdent)-\(toIdent)" }
}

/// The planner's reasoning for the altitude (AltitudeBreakdown), the
/// parts the profile shows.
struct AltitudeSelection: Codable, Equatable, Sendable {
    var recommendedFt: Double?
    var candidatesFt: [Double] = []
    var floorFt: Double?
    var bandCeilingFt: Double?
    var serviceCeilingFt: Double?
    var cloudBaseFt: Double?
    var airspaceCeilingFt: Double?
    var rules: String?
}

/// One leg of the log, with the figures its row shows.
struct Leg: Codable, Hashable, Sendable, Identifiable {
    var from: String
    var to: String
    var distanceNm: Double
    var altitudeFt: Double
    var trueCourseDeg: Double
    var magneticHeadingDeg: Double
    var wcaDeg: Double = 0
    var trueHeadingDeg: Double = 0
    var magneticVariationDeg: Double = 0
    var climbMin: Double?
    var groundspeedKt: Double?
    var eteMin: Double?
    var fuelGal: Double?
    var tasKt: Double
    var wind: Wind?
    var toc: TopOfClimb?
    var tod: TopOfDescent?
    /// The procedure's path this leg flies, where one was picked.
    var procedure: LegProcedure?

    var id: String { "\(from)-\(to)" }

    struct LegProcedure: Codable, Hashable, Sendable {
        var path: [[Double]] = []
        var nm: Double = 0
        var landing: Bool = false
        var moreNm: Double = 0
        var moreMin: Double = 0
        var moreGal: Double = 0
    }

    struct Wind: Codable, Hashable, Sendable {
        var directionDeg: Double?
        var speedKt: Double?
    }

    struct TopOfClimb: Codable, Hashable, Sendable {
        var alongNm: Double?
    }

    struct TopOfDescent: Codable, Hashable, Sendable {
        var alongNm: Double?
    }
}

/// The flight's totals and its fuel check (navlog.totals, fuel_plan).
struct Totals: Codable, Equatable, Sendable {
    var distanceNm: Double?
    var eteMin: Double?
    var fuelGal: Double?
    var fuelRequiredGal: Double?
    var fuelMarginGal: Double?
    var usableFuelGal: Double?
    var reserveMin: Double?
    var night: Bool?
    /// Where each flight the tanks do not hold could land for fuel, the
    /// whole chain at once (app.routers.plan.fuel_stops_of).
    var fuelStops: [FuelStopSuggestion]? = []
}

/// A field with fuel on the way (FuelStop).
struct FuelStop: Codable, Equatable, Sendable, Identifiable {
    let ident: String
    let name: String
    let city: String
    let lat: Double
    let lon: Double
    let fromNm: Double
    let addedNm: Double
    let landsWithGal: Double
    let minutes: Double
    let fuelTypes: String
    let runwayFt: Int

    var id: String { ident }
}

/// The stops that take a flight from one landing to the next with the
/// reserve left (FuelStopSuggestion).
struct FuelStopSuggestion: Codable, Equatable, Sendable, Identifiable {
    let departure: String
    let destination: String
    let usableGal: Double
    var reason: String? = "fuel"
    var stops: [FuelStop] = []
    var choices: [FuelStop]? = []

    var id: String { "\(departure)-\(destination)" }
}

/// A way round what stops a route (Detour): a Class B's waypoint, or the
/// points round high ground (`via`), each before the stop at `stopIndex`.
struct Detour: Codable, Equatable, Sendable, Identifiable {
    let ident: String
    let kind: String
    let addedNm: Double
    let stopIndex: Int
    var description: String?
    var via: [String]? = []

    var id: String { ident }
}

struct NavLogError: Codable, Equatable, Sendable {
    var detail: String
    var brief: String?
    var reasons: [String]?
    var advice: String?
    var classB: Bool? = false
    var detours: [Detour]? = []
}

enum NavLog {
    /// One line of the stream, or nil for a line of a kind the app has no
    /// use for yet.
    static func decode(line: Data, decoder: JSONDecoder = Planner.snakeCase) throws -> NavLogMessage? {
        struct Kind: Decodable { let type: String }
        let kind = try decoder.decode(Kind.self, from: line).type
        switch kind {
        case "stage":
            struct Stage: Decodable { let detail: String }
            return .stage(try decoder.decode(Stage.self, from: line).detail)
        case "altitude": return .altitude(try decoder.decode(NavLogAltitude.self, from: line))
        case "leg": return .leg(try decoder.decode(Leg.self, from: line))
        case "done":
            struct Done: Decodable { let totals: Totals }
            return .done(try decoder.decode(Done.self, from: line).totals)
        case "error": return .error(try decoder.decode(NavLogError.self, from: line))
        default: return nil
        }
    }

    /// The log for a route, line by line as the planner sends them.
    static func stream(dep: String, dest: String, stops: [String], aircraft: String?, figures: Figures = Figures(), altitudeFt: Double?, nearest: Bool, choice: String?, procedures: [ProcedurePick] = [], extra: [String: String?] = [:]) -> AsyncThrowingStream<NavLogMessage, any Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                var query = figures.query.merging([
                    "dep": dep, "dest": dest, "stops": stops.isEmpty ? nil : stops.joined(separator: ","), "aircraft": aircraft,
                    // The procedures picked, which the legs are flown by and
                    // the descents planned to.
                    "procedures": procedures.isEmpty ? nil : procedures.map(\.param).joined(separator: ","),
                    "altitude_ft": altitudeFt.map { String(Int($0)) },
                    // Picked on the wheel: each leg at its nearest legal
                    // altitude where the pick is one of the planner's.
                    "altitude_nearest": altitudeFt != nil && nearest ? "true" : nil,
                    // One of the four plans; fastest is the planner's own.
                    "altitude_choice": choice.flatMap { $0 == "fastest" ? nil : $0 },
                ]) { _, route in route }
                // The pilot's own edits of the route (RouteExtras): points'
                // altitudes, holds, crossings, a procedure flown direct.
                query.merge(extra) { _, own in own }
                let request = Planner.get("/api/navlog", query)
                do {
                    let (bytes, response) = try await URLSession.shared.bytes(for: request)
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    guard status == 200 else {
                        throw Planner.Failure(status: status, detail: nil)
                    }
                    for try await line in bytes.lines where !line.isEmpty {
                        if let message = try decode(line: Data(line.utf8)) { continuation.yield(message) }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
