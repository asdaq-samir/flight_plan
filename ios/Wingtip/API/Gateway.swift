import Foundation

/// The pilot, as the gateway knows them (PilotDto).
struct Pilot: Codable, Equatable, Sendable {
    var id: Int64?
    var email: String?
    var displayName: String?
    var fullName: String?
    var homeBase: String?
    var developer: Bool?
}

/// The gateway's account calls, by hand: its OpenAPI document gives them
/// "*/*" bodies, which a generated client would hand over raw. URLSession
/// keeps the session cookie the gateway sets, so a call made after
/// signing in is the pilot's, as in Safari.
enum Gateway {
    struct Failure: Error, LocalizedError {
        let status: Int
        var errorDescription: String? { "The server answered \(status)." }
    }

    private static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        return URLSession(configuration: config)
    }()

    private static func request(_ method: String, _ path: String, json: (any Encodable)? = nil, form: [String: String]? = nil) -> URLRequest {
        var request = URLRequest(url: Config.gateway.appending(path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
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

    /// The pilot signed in, or nil (the gateway's 204) when no one is.
    static func me() async throws -> Pilot? {
        let (data, response) = try await session.data(for: request("GET", "/api/me"))
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        switch status {
        case 200: return try JSONDecoder().decode(Pilot.self, from: data)
        case 204, 401: return nil
        default: throw Failure(status: status)
        }
    }

    /// Apple's identity token from the system's sheet, checked by the
    /// gateway against this app's bundle id (AppleNativeSignInController).
    static func signInWithApple(identityToken: String) async throws {
        struct Token: Encodable { let identityToken: String }
        let (_, response) = try await session.data(for: request("POST", "/api/auth/apple/native", json: Token(identityToken: identityToken)))
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else { throw Failure(status: status) }
    }

    /// A sign-in link emailed to the pilot; the gateway answers 202
    /// whether or not the address is known.
    static func requestMagicLink(email: String) async throws {
        struct Request: Encodable { let email: String }
        let (_, response) = try await session.data(for: request("POST", "/api/auth/magic-link", json: Request(email: email)))
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(status) else { throw Failure(status: status) }
    }

    /// The link's one-time token, posted as the website's page posts it.
    static func verifyMagicLink(token: String) async throws {
        let (_, response) = try await session.data(for: request("POST", "/api/auth/magic-link/verify", form: ["token": token]))
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...399).contains(status) else { throw Failure(status: status) }
    }

    /// Spring Security's own logout, which answers 204.
    static func signOut() async throws {
        _ = try await session.data(for: request("POST", "/logout"))
    }
}

/// Encodes whatever Encodable it is given, for one request builder.
private struct AnyEncodable: Encodable {
    let value: any Encodable
    init(_ value: any Encodable) { self.value = value }
    func encode(to encoder: any Encoder) throws { try value.encode(to: encoder) }
}
