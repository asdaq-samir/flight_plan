import Foundation

/// A link opened in the app, read into what it asks for: the site's own
/// addresses (universal links, the associated domain in project.yml) as
/// the web app's ShareMenu, AirportCard and AirplaneCard write them --
/// `/app/plan?dep=C81&stops=KJVL&dest=KDLH` a route shared, `?place=KDLH`
/// a field's card, `?flight=a1b2c3` an airplane tracked -- and a track
/// file (GPX, KML) handed over from Files or Mail, which the app is a
/// viewer of (CFBundleDocumentTypes). The sign-in link is not one of
/// these: Session.open takes it. The answer is a PendingCommand, done by
/// RootView once the screen is up, as Siri's asks are.
enum Links {
    /// The file types the app opens, as Finder and Files name them.
    static let trackExtensions: Set<String> = ["gpx", "kml"]

    static func command(for url: URL) -> PendingCommand.Command? {
        if url.isFileURL {
            return trackExtensions.contains(url.pathExtension.lowercased()) ? .track(url) : nil
        }
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let query = Dictionary(parts.queryItems?.map { ($0.name, $0.value ?? "") } ?? [], uniquingKeysWith: { _, last in last })
        guard parts.path.hasSuffix("/app/plan") else { return nil }
        if let place = ident(query["place"]) { return .weather(ident: place) }
        if let hex = query["flight"]?.trimmingCharacters(in: .whitespaces).lowercased(), !hex.isEmpty { return .aircraft(hex: hex) }
        // The route as the web app's URL has it: idents, the stops
        // comma-separated; a link with only a destination plans from the
        // field nearest the airplane, as Siri's "plan a trip to" does.
        let stops = (query["stops"] ?? "").split(separator: ",").compactMap { ident(String($0)) }
        switch (ident(query["dep"]), ident(query["dest"])) {
        case (let dep?, let dest?): return .planRoute(dep: dep, stops: stops, dest: dest)
        case (nil, let dest?): return .planTo(ident: dest)
        default: return nil
        }
    }

    /// An ident as the planner takes one: letters and figures, upper case.
    private static func ident(_ raw: String?) -> String? {
        let text = raw?.trimmingCharacters(in: .whitespaces).uppercased() ?? ""
        guard !text.isEmpty, text.count <= 8, text.allSatisfy({ $0.isLetter || $0.isNumber }) else { return nil }
        return text
    }
}
