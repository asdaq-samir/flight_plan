import Foundation

/// Where the servers are: the host the build was made for (Info.plist's
/// WingtipHost, from the WINGTIP_HOST build setting), the gateway at its
/// root and the planner behind the gateway's proxy, as the website has
/// them (PlannerProxyController: `/api/planner/course` upstream is
/// `/api/course`).
enum Config {
    static let host: String = {
        let fromPlist = Bundle.main.object(forInfoDictionaryKey: "WingtipHost") as? String
        let host = fromPlist?.trimmingCharacters(in: .whitespaces) ?? ""
        return host.isEmpty ? "wingtipmaps.app" : host
    }()

    /// The gateway: accounts, flights, the planner's proxy.
    static var gateway: URL { URL(string: "https://\(host)")! }

    /// The planner's operation paths are `/api/…`; through the gateway
    /// they are `/api/planner/…` (PlannerPath rewrites them).
    static let plannerPrefix = "/api/planner"

    /// A planner path as the gateway serves it.
    static func plannerPath(_ path: String) -> String {
        guard path.hasPrefix("/api/") else { return path }
        return plannerPrefix + path.dropFirst("/api".count)
    }
}
