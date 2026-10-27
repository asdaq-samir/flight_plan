import Foundation

/// The pilot, as the gateway knows them (PilotDto).
struct Pilot: Codable, Equatable, Sendable {
    var id: Int64?
    var email: String?
    var displayName: String?
    var fullName: String?
    var homeBase: String?
    var phone: String?
    var developer: Bool?
}

/// The gateway's calls, by hand: its OpenAPI document gives them "*/*"
/// bodies, which a generated client would hand over raw. URLSession keeps
/// the session cookie the gateway sets, so a call made after signing in
/// is the pilot's, as in Safari.
enum Gateway {
    static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        return URLSession(configuration: config)
    }()

    static func request(_ method: String, _ path: String, json: (any Encodable)? = nil, form: [String: String]? = nil) -> URLRequest {
        var request = URLRequest(url: Config.gateway.appending(path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        // Spring Security's CSRF check (SecurityConfig): every POST, PUT and
        // DELETE echoes the XSRF-TOKEN cookie the gateway set in a header,
        // as the web app's client does.
        if method != "GET", let token = csrfToken { request.setValue(token, forHTTPHeaderField: "X-XSRF-TOKEN") }
        if let json {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONEncoder().encode(AnyEncodable(json))
        } else if let form {
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            var parts = URLComponents()
            parts.queryItems = form.map { URLQueryItem(name: $0.key, value: $0.value) }
            request.httpBody = parts.percentEncodedQuery?.data(using: .utf8)
        }
        return request
    }

    /// The gateway's CSRF token, from the cookie it sets on every answer.
    static var csrfToken: String? {
        session.configuration.httpCookieStorage?.cookies(for: Config.gateway)?.first { $0.name == "XSRF-TOKEN" }?.value
    }

    /// One call with the pilot's session: the answer's body and status.
    /// Every gateway call goes through here, and is refused through
    /// `send` or `read` in the gateway's own words.
    static func call(_ method: String, _ path: String, json: (any Encodable)? = nil, form: [String: String]? = nil) async throws -> (Data, Int) {
        let (data, response) = try await session.data(for: request(method, path, json: json, form: form))
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }

    /// A call whose answer is read, or nothing where the server sends no
    /// body; refused outside `ok`, with the gateway's own words.
    @discardableResult
    static func send(_ method: String, _ path: String, json: (any Encodable)? = nil, form: [String: String]? = nil,
                     ok: ClosedRange<Int> = 200...299) async throws -> Data {
        let (data, status) = try await call(method, path, json: json, form: form)
        guard ok.contains(status) else { throw GatewayRefusal(status: status, words: GatewayRefusal.words(in: data)) }
        return data
    }

    static func send<T: Decodable>(_ type: T.Type, _ method: String, _ path: String, json: (any Encodable)? = nil) async throws -> T {
        try JSONDecoder().decode(T.self, from: try await send(method, path, json: json))
    }

    /// A read that is nobody's when signed out: nil for the statuses in
    /// `none` (401, 403 and 204 unless a call says otherwise). The
    /// gateway's JSON is camelCase already, its dates the strings they
    /// come as.
    static func read<T: Decodable>(_ type: T.Type, _ path: String, none: Set<Int> = [204, 401, 403]) async throws -> T? {
        let (data, status) = try await call("GET", path)
        if status == 200 { return try JSONDecoder().decode(T.self, from: data) }
        if none.contains(status) { return nil }
        throw GatewayRefusal(status: status, words: GatewayRefusal.words(in: data))
    }

    /// The pilot signed in, or nil (the gateway's 204) when no one is.
    static func me() async throws -> Pilot? { try await read(Pilot.self, "/api/me", none: [204, 401]) }

    /// Apple's identity token from the system's sheet, checked by the
    /// gateway against this app's bundle id (AppleNativeSignInController).
    static func signInWithApple(identityToken: String) async throws {
        struct Token: Encodable { let identityToken: String }
        try await send("POST", "/api/auth/apple/native", json: Token(identityToken: identityToken), ok: 200...200)
    }

    /// A sign-in link emailed to the pilot; the gateway answers 202
    /// whether or not the address is known.
    static func requestMagicLink(email: String) async throws {
        struct Request: Encodable { let email: String }
        try await send("POST", "/api/auth/magic-link", json: Request(email: email))
    }

    /// The link's one-time token, posted as the website's page posts it.
    static func verifyMagicLink(token: String) async throws {
        try await send("POST", "/api/auth/magic-link/verify", form: ["token": token], ok: 200...399)
    }

    /// Spring Security's own logout, which answers 204.
    static func signOut() async throws {
        _ = try await call("POST", "/logout")
    }
}

/// The gateway's own words for a refusal (ErrorResponse), where it sent
/// any: "Invalid request" with each field's, or the instructor's rule.
struct GatewayRefusal: Error, LocalizedError, Equatable {
    let status: Int
    let words: String?
    var errorDescription: String? { words ?? "The server answered \(status)." }

    static func words(in data: Data) -> String? {
        struct Body: Decodable { var error: String?; var details: [String]? }
        guard let body = try? JSONDecoder().decode(Body.self, from: data), let error = body.error else { return nil }
        let details = body.details ?? []
        return details.isEmpty ? error : "\(error): \(details.joined(separator: "; "))"
    }
}

/// Encodes whatever Encodable it is given, for one request builder.
private struct AnyEncodable: Encodable {
    let value: any Encodable
    init(_ value: any Encodable) { self.value = value }
    func encode(to encoder: any Encoder) throws { try value.encode(to: encoder) }
}
