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

struct NavLogAltitude: Codable, Equatable, Sendable {
    var flown: String?
    var altitudeFt: Double?
}

/// One leg of the log, with the figures its row shows.
struct Leg: Codable, Equatable, Sendable, Identifiable {
    var from: String
    var to: String
    var distanceNm: Double
    var altitudeFt: Double
    var trueCourseDeg: Double
    var magneticHeadingDeg: Double
    var groundspeedKt: Double?
    var eteMin: Double?
    var fuelGal: Double?
    var tasKt: Double
    var wind: Wind?
    var toc: TopOfClimb?
    var tod: TopOfDescent?

    var id: String { "\(from)-\(to)" }

    struct Wind: Codable, Equatable, Sendable {
        var directionDeg: Double?
        var speedKt: Double?
    }

    struct TopOfClimb: Codable, Equatable, Sendable {
        var alongNm: Double?
    }

    struct TopOfDescent: Codable, Equatable, Sendable {
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
}

struct NavLogError: Codable, Equatable, Sendable {
    var detail: String
    var brief: String?
    var reasons: [String]?
    var advice: String?
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
    static func stream(dep: String, dest: String, stops: [String], aircraft: String?, altitudeFt: Double?) -> AsyncThrowingStream<NavLogMessage, any Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                let request = Planner.get("/api/navlog", [
                    "dep": dep, "dest": dest, "stops": stops.isEmpty ? nil : stops.joined(separator: ","), "aircraft": aircraft,
                    "altitude_ft": altitudeFt.map { String(Int($0)) },
                ])
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
