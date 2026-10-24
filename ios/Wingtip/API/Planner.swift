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

/// The planner, through the gateway.
enum Planner {
    static let client = Client(
        serverURL: Config.gateway,
        transport: URLSessionTransport(),
        middlewares: [PlannerPath()]
    )

    /// Which chart the map draws and where its tiles are (/api/chart).
    static func chart() async throws -> Components.Schemas.ChartInfo {
        try await client.chartInfoApiChartGet().ok.body.json
    }
}
