import CoreLocation
import Foundation

/// A route's two ends and its stops, as /api/course gives them
/// (AirportEnd), and the line between them.
struct CourseEnd: Codable, Equatable, Sendable {
    let ident: String
    let name: String
    let lat: Double
    let lon: Double
    var kind: String?
    var elevationFt: Double?
}

struct Course: Codable, Equatable, Sendable {
    let departure: CourseEnd
    let destination: CourseEnd
    /// Optional in the type: a synthesized Codable does not fall back to
    /// a `var`'s default when the key is missing (the first build's test).
    var stops: [CourseEnd]?
    let distanceNm: Double
    let bearingDeg: Double
    /// The great-circle line as pairs of latitude and longitude.
    let courseLine: [[Double]]
    var checkpointsReady: Bool? = nil

    var coordinates: [CLLocationCoordinate2D] {
        courseLine.compactMap { $0.count == 2 ? CLLocationCoordinate2D(latitude: $0[0], longitude: $0[1]) : nil }
    }
}

/// The planner, through the gateway's proxy (`/api/planner/…`,
/// PlannerProxyController), with the pilot's session cookie as the
/// website's calls carry it. Each answer decoded from the document's
/// snake case into Models.swift.
enum Planner {
    static let snakeCase: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()

    struct Failure: Error, LocalizedError {
        let status: Int
        let detail: String?
        var errorDescription: String? { detail ?? "The planner answered \(status)." }
    }

    /// A planner call by its path and query.
    static func get(_ path: String, _ query: [String: String?] = [:]) -> URLRequest {
        var parts = URLComponents(url: Config.gateway.appending(path: Config.plannerPath(path)), resolvingAgainstBaseURL: false)!
        let items = query.compactMap { key, value in value.map { URLQueryItem(name: key, value: $0) } }.sorted { $0.name < $1.name }
        parts.queryItems = items.isEmpty ? nil : items
        var request = URLRequest(url: parts.url!)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    static func fetch<T: Decodable>(_ type: T.Type, _ path: String, _ query: [String: String?] = [:]) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: get(path, query))
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else { throw Failure(status: status, detail: detail(of: data)) }
        return try snakeCase.decode(T.self, from: data)
    }

    /// FastAPI's `{"detail": "…"}`, where an answer carries one.
    static func detail(of data: Data) -> String? {
        (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["detail"] as? String
    }

    /// Which chart the map draws and where its tiles are (/api/chart).
    static func chart() async throws -> ChartInfo {
        try await fetch(ChartInfo.self, "/api/chart")
    }

    /// The fields in the map's view, fewer and bigger as it zooms out,
    /// with the flight category of each that reports (/api/airports/in-view).
    static func airports(south: Double, west: Double, north: Double, east: Double) async throws -> [AirportPin] {
        struct Answer: Decodable { let airports: [AirportPin] }
        let box = ["south": String(south), "west": String(west), "north": String(north), "east": String(east)]
        return try await fetch(Answer.self, "/api/airports/in-view", box).airports
    }

    /// Fields by ident or name as they are typed (/api/airports/search).
    static func search(_ q: String) async throws -> [AirportSuggestion] {
        struct Answer: Decodable { let airports: [AirportSuggestion] }
        return try await fetch(Answer.self, "/api/airports/search", ["q": q]).airports
    }

    /// A field's card: its weather, runways, frequencies and pattern
    /// (/api/airport/{ident}).
    static func place(_ ident: String) async throws -> AirportPlace {
        try await fetch(AirportPlace.self, "/api/airport/\(ident)")
    }

    /// The route's checkpoints, the ones picked for the nav log
    /// (/api/checkpoints): read off the chart, so the first ask for a new
    /// route takes a while.
    static func checkpoints(dep: String, dest: String, stops: [String]) async throws -> [Checkpoint] {
        struct Answer: Decodable { let selected: [Checkpoint] }
        return try await fetch(Answer.self, "/api/checkpoints", ["dep": dep, "dest": dest, "stops": stops.isEmpty ? nil : stops.joined(separator: ",")]).selected
    }

    /// The ground and airspace under the route, for the profile
    /// (/api/route-profile).
    static func routeProfile(dep: String, dest: String, stops: [String]) async throws -> RouteProfile {
        try await fetch(RouteProfile.self, "/api/route-profile", ["dep": dep, "dest": dest, "stops": stops.isEmpty ? nil : stops.joined(separator: ",")])
    }

    /// The briefing for the route, with the flight's time where the nav
    /// log has given one, so the forecast is read for the hours flown
    /// (/api/briefing).
    static func briefing(dep: String, dest: String, stops: [String], eteMin: Double?) async throws -> Briefing {
        try await fetch(Briefing.self, "/api/briefing", [
            "dep": dep, "dest": dest, "stops": stops.isEmpty ? nil : stops.joined(separator: ","),
            "ete_min": eteMin.map { String(Int($0.rounded())) },
        ])
    }

    /// What the airplane's track runs into in the next minutes
    /// (/api/airspace/ahead): the planner's alerts, in its words.
    static func ahead(lat: Double, lon: Double, trackDeg: Double, groundspeedKt: Double, altitudeFt: Double?) async throws -> [AheadAlert] {
        struct Answer: Decodable { let alerts: [AheadAlert] }
        return try await fetch(Answer.self, "/api/airspace/ahead", [
            "lat": String(lat), "lon": String(lon), "track": String(Int(trackDeg.rounded())), "gs": String(Int(groundspeedKt.rounded())),
            "alt": altitudeFt.map { String(Int($0.rounded())) },
        ]).alerts
    }

    /// The ways to fly a route (/api/route-options): the planner's grid
    /// search round what the direct line meets.
    static func routeOptions(dep: String, dest: String, stops: [String], aircraft: String) async throws -> RouteOptions {
        try await fetch(RouteOptions.self, "/api/route-options", [
            "dep": dep, "dest": dest, "stops": stops.isEmpty ? nil : stops.joined(separator: ","), "aircraft": aircraft,
        ])
    }

    /// A field's procedures (/api/airport/{ident}/procedures).
    static func procedures(_ ident: String) async throws -> ProcedureList {
        try await fetch(ProcedureList.self, "/api/airport/\(ident)/procedures")
    }

    /// An airplane by its N-number in the FAA's registry (/api/traffic/find).
    static func registered(_ tail: String) async throws -> AircraftRegistration? {
        struct Answer: Decodable { let registered: AircraftRegistration? }
        return try await fetch(Answer.self, "/api/traffic/find", ["q": tail]).registered
    }

    /// The planner's airplane types (/api/aircraft-profiles).
    static func aircraftProfiles() async throws -> [AircraftProfile] {
        struct Answer: Decodable { let profiles: [AircraftProfile] }
        return try await fetch(Answer.self, "/api/aircraft-profiles").profiles
    }

    /// The route as entered, its ends found and its line (/api/course).
    static func course(dep: String, dest: String, stops: [String]) async throws -> Course {
        try await fetch(Course.self, "/api/course", ["dep": dep, "dest": dest, "stops": stops.isEmpty ? nil : stops.joined(separator: ",")])
    }
}
