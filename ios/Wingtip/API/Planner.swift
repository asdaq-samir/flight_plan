import CoreLocation
import Foundation
import HTTPTypes
import OpenAPIRuntime
import OpenAPIURLSession
import PlannerAPI

/// Rewrites each planner operation's `/api/…` path to the gateway's
/// `/api/planner/…`, so the generated client speaks the planner's own
/// document while every request goes through the gateway, with the
/// pilot's session cookie, as the website's do.
struct PlannerPath: ClientMiddleware {
    func intercept(
        _ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String,
        next: (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var request = request
        if let path = request.path { request.path = Config.plannerPath(path) }
        return try await next(request, body, baseURL)
    }
}

/// A route's two ends and its stops, as /api/course gives them
/// (AirportEnd), and the line between them. Decoded by hand: the course
/// line's pairs of numbers are a shape the generator does not type.
struct CourseEnd: Codable, Equatable, Sendable {
    let ident: String
    let name: String
    let lat: Double
    let lon: Double
    let kind: String?
    let elevationFt: Double?
}

struct Course: Codable, Equatable, Sendable {
    let departure: CourseEnd
    let destination: CourseEnd
    var stops: [CourseEnd] = []
    let distanceNm: Double
    let bearingDeg: Double
    /// The great-circle line as pairs of latitude and longitude.
    let courseLine: [[Double]]
    var checkpointsReady: Bool? = nil

    var coordinates: [CLLocationCoordinate2D] {
        courseLine.compactMap { $0.count == 2 ? CLLocationCoordinate2D(latitude: $0[0], longitude: $0[1]) : nil }
    }
}

/// The planner, through the gateway.
enum Planner {
    static let client = Client(
        serverURL: Config.gateway,
        transport: URLSessionTransport(),
        middlewares: [PlannerPath()]
    )

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

    /// Which chart the map draws and where its tiles are (/api/chart).
    static func chart() async throws -> Components.Schemas.ChartInfo {
        try await client.chartInfoApiChartGet().ok.body.json
    }

    /// The fields in the map's view, fewer and bigger as it zooms out,
    /// with the flight category of each that reports (/api/airports/in-view).
    static func airports(south: Double, west: Double, north: Double, east: Double) async throws -> [Components.Schemas.AirportPin] {
        try await client.airportsInViewApiAirportsInViewGet(query: .init(south: south, west: west, north: north, east: east)).ok.body.json.airports
    }

    /// Fields by ident or name as they are typed (/api/airports/search).
    static func search(_ q: String) async throws -> [Components.Schemas.AirportSuggestion] {
        try await client.airportSearchApiAirportsSearchGet(query: .init(q: q)).ok.body.json.airports
    }

    /// A planner call outside the generated client, by its path and query.
    static func get(_ path: String, _ query: [String: String?]) -> URLRequest {
        var parts = URLComponents(url: Config.gateway.appending(path: Config.plannerPath(path)), resolvingAgainstBaseURL: false)!
        parts.queryItems = query.compactMap { key, value in value.map { URLQueryItem(name: key, value: $0) } }.sorted { $0.name < $1.name }
        var request = URLRequest(url: parts.url!)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    /// The route as entered, its ends found and its line (/api/course).
    static func course(dep: String, dest: String, stops: [String]) async throws -> Course {
        let request = get("/api/course", ["dep": dep, "dest": dest, "stops": stops.isEmpty ? nil : stops.joined(separator: ",")])
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else { throw Failure(status: status, detail: Self.detail(of: data)) }
        return try snakeCase.decode(Course.self, from: data)
    }

    /// FastAPI's `{"detail": "…"}`, where an answer carries one.
    static func detail(of data: Data) -> String? {
        (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["detail"] as? String
    }
}
