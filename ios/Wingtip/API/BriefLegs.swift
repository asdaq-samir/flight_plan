import CoreLocation
import Foundation

/// Where and when the flight meets a hazard in the briefing (OnRoute,
/// app.exposure): the legs it is on, 0-based as the planner gives them,
/// from how far along to how far, when the airplane gets there and
/// leaves, the hazard's own valid times and when it was issued, and
/// whether the airplane is there while it is valid ("during", "before",
/// "after"; none for a report or a field's forecast). The planner works
/// all of it out; the app says it.
struct OnRoute: Codable, Equatable, Sendable {
    var legs: [Int]
    var fromNm: Double
    var toNm: Double
    var enter: String?
    var leave: String?
    var validFrom: String?
    var validTo: String?
    var when: String?
    var source: String
    var issued: String?
}

/// A field below VFR where the flight meets it (FieldBelowVfr): its
/// METAR's IFR or LIFR now, or a TAF's for when the airplane is there.
struct FieldBelowVfr: Codable, Equatable, Sendable {
    var ident: String
    var source: String
    var flightCategory: String?
    var ceilingFt: Double?
    var visibilitySm: Double?
    var onRoute: OnRoute
}

/// One of the fixes the briefing's legs run between (Briefing.leg_fixes).
struct RoutePoint: Codable, Equatable, Sendable {
    var lat: Double
    var lon: Double
}

/// When the planner fetched what the map's weather layers are drawn
/// from (MapLayerAges, /api/map/ages).
struct MapLayerAges: Codable, Equatable, Sendable {
    var metarsAt: String?
    var tfrsAt: String?
}

/// The legs a hazard tapped in the Brief is on, for the map to draw and
/// bring into view: `key` says which hazard, so a second tap puts them
/// away.
struct HazardLegs: Equatable {
    var key: String
    var lines: [[CLLocationCoordinate2D]]

    static func == (a: HazardLegs, b: HazardLegs) -> Bool {
        a.key == b.key && a.lines.map { $0.map(\.latitude) } == b.lines.map { $0.map(\.latitude) }
    }
}

enum BriefLegs {
    /// The nav log's legs as /api/briefing asks for them, for the planner
    /// to place each hazard on the legs the pilot sees and time it by
    /// their ETEs: the fixes the rows are at (the departure, each hop's
    /// checkpoints, the stop it lands at, the destination, as the web
    /// app's navLogRows lays them out), each leg's minutes and each one's
    /// minutes on the ground after it. Nil where they do not make the
    /// legs the log has, or a leg has no time: the planner then places
    /// them on the route as entered.
    struct Query: Equatable, Sendable {
        var fixes: String
        var legMin: String
        var groundMin: String
    }

    static func query(course: Course?, checkpoints: [Checkpoint], legs: [Leg]) -> Query? {
        guard let course, !legs.isEmpty, legs.allSatisfy({ $0.eteMin != nil }) else { return nil }
        let stops = course.stops ?? []
        var points: [(Double, Double)] = [(course.departure.lat, course.departure.lon)]
        for hop in 0...stops.count {
            points += checkpoints.filter { ($0.hop ?? 0) == hop }.map { ($0.lat, $0.lon) }
            if hop < stops.count { points.append((stops[hop].lat, stops[hop].lon)) }
        }
        points.append((course.destination.lat, course.destination.lon))
        guard points.count == legs.count + 1 else { return nil }
        return Query(
            fixes: points.map { String(format: "%.5f,%.5f", $0.0, $0.1) }.joined(separator: ";"),
            legMin: legs.map { String(format: "%.1f", $0.eteMin ?? 0) }.joined(separator: ","),
            groundMin: legs.map { String(format: "%.0f", $0.groundMin ?? 0) }.joined(separator: ",")
        )
    }

    /// Legs said 1-based as the nav log numbers its rows: "Leg 2",
    /// "Legs 2–3", "Legs 1, 3–4".
    static func legWords(_ legs: [Int]) -> String {
        let sorted = Array(Set(legs)).sorted()
        guard !sorted.isEmpty else { return "" }
        var runs: [(Int, Int)] = []
        for leg in sorted {
            if let last = runs.last, leg == last.1 + 1 { runs[runs.count - 1].1 = leg } else { runs.append((leg, leg)) }
        }
        func say(_ run: (Int, Int)) -> String {
            run.0 == run.1 ? "\(run.0 + 1)" : "\(run.0 + 1)–\(run.1 + 1)"
        }
        let said = runs.map(say).joined(separator: ", ")
        return "\(sorted.count == 1 ? "Leg" : "Legs") \(said)"
    }

    private static let plain: ISO8601DateFormatter = ISO8601DateFormatter()
    private static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    static func date(_ iso: String?) -> Date? {
        guard let iso else { return nil }
        return plain.date(from: iso) ?? fractional.date(from: iso)
    }

    /// "14:20", the hours and minutes in `zone`, as the web app's
    /// clockTime gives the device's own.
    static func clock(_ iso: String?, zone: TimeZone = .current) -> String? {
        guard let at = date(iso) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let parts = calendar.dateComponents([.hour, .minute], from: at)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }

    /// "Legs 2–3 · 14:20–14:45, valid till 15:00": the legs, when the
    /// airplane is there, and the hazard's own time against it -- before
    /// it starts, after it ends, until when it is valid; a report's when
    /// it was made. A G-AIRMET's window is its snapshot's, set by the
    /// planner, so only before or after is said for one.
    static func line(_ on: OnRoute, zone: TimeZone = .current) -> String {
        let enter = clock(on.enter, zone: zone), leave = clock(on.leave, zone: zone)
        var when = enter
        if let enter, let leave, enter != leave { when = "\(enter)–\(leave)" }
        var valid: String?
        switch on.when ?? "" {
        case "before": valid = "before it starts at \(clock(on.validFrom, zone: zone) ?? "—")"
        case "after": valid = "after it ends at \(clock(on.validTo, zone: zone) ?? "—")"
        case "during":
            if on.source == "G-AIRMET" { valid = nil }
            else if let to = clock(on.validTo, zone: zone) { valid = "valid till \(to)" }
            else if let from = clock(on.validFrom, zone: zone) { valid = "in effect from \(from)" }
            else { valid = "in effect" }
        default:
            if on.source == "PIREP", let at = clock(on.issued, zone: zone) { valid = "reported \(at)" }
            else if on.source == "METAR", let at = clock(on.issued, zone: zone) { valid = "observed \(at)" }
            else if on.source == "TAF" { valid = "forecast for then" }
        }
        let time = [when, valid].compactMap { $0 }.joined(separator: ", ")
        return [legWords(on.legs), time].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// The stretches of the route the legs make, each a line of fixes:
    /// legs next to each other are one line; legs past the fixes are left
    /// out.
    static func lines(_ legs: [Int], fixes: [RoutePoint]) -> [[CLLocationCoordinate2D]] {
        let at = { (i: Int) in CLLocationCoordinate2D(latitude: fixes[i].lat, longitude: fixes[i].lon) }
        var out: [[CLLocationCoordinate2D]] = []
        var last = -2
        for leg in Array(Set(legs)).sorted() where leg >= 0 && leg + 1 < fixes.count {
            if leg == last + 1, !out.isEmpty { out[out.count - 1].append(at(leg + 1)) } else { out.append([at(leg), at(leg + 1)]) }
            last = leg
        }
        return out
    }

    /// How long ago `at` was: "just now" under a minute, "4 min ago",
    /// "2 h 5 min ago".
    static func age(_ at: Date?, now: Date = Date()) -> String? {
        guard let at else { return nil }
        let minutes = max(0, Int(now.timeIntervalSince(at) / 60))
        if minutes < 1 { return "just now" }
        return minutes < 60 ? "\(minutes) min ago" : "\(minutes / 60) h \(minutes % 60) min ago"
    }
}

extension Planner {
    /// The briefing, its hazards placed on the nav log's legs where they
    /// are given (/api/briefing's fixes, leg_min, ground_min).
    static func briefing(dep: String, dest: String, stops: [String], eteMin: Double?, legs: BriefLegs.Query?) async throws -> Briefing {
        try await fetch(Briefing.self, "/api/briefing", route(dep, dest, stops).merging([
            "ete_min": eteMin.map { String(Int($0.rounded())) },
            "fixes": legs?.fixes, "leg_min": legs?.legMin, "ground_min": legs?.groundMin,
        ]) { $1 })
    }

    /// When the planner fetched the METARs and TFRs the map draws
    /// (/api/map/ages).
    static func mapAges() async throws -> MapLayerAges {
        try await fetch(MapLayerAges.self, "/api/map/ages")
    }
}
