import CoreLocation
import Foundation

/// A hold the pilot put on a point of the route, as Garmin's and
/// ForeFlight's pilot-defined holds are, written as the planner reads it
/// (vfr.holds, the web app's lib/holds): the point, its inbound course
/// (magnetic), R or L, its legs by minutes ("1M") or nm ("4N"), and how
/// long, turns ("2T") or minutes ("10M"): "VPBNG/090/30:270:R:1M:2T". The
/// planner works out the entry and adds its time and fuel.
struct Hold: Codable, Hashable, Sendable, Identifiable {
    var fix: String
    /// The inbound course to the fix, magnetic degrees, 0 to 359.
    var inbound: Int
    var right: Bool
    /// Its legs: timed, or by distance; one of the two.
    var legMin: Double?
    var legNm: Double?
    /// How long it is held: turns round it, or minutes; one of the two.
    var turns: Int?
    var minutes: Int?

    var id: String { fix }

    /// The legs' minutes where none is picked: a minute at or below
    /// 14,000 ft MSL, a minute and a half above (AIM 5-3-8, holding
    /// pattern leg lengths).
    static func legMinutes(altitudeFt: Double) -> Double { altitudeFt > 14_000 ? 1.5 : 1 }

    private static func figure(_ value: Double) -> String { String(format: "%g", value) }

    /// As the planner reads it, the course in three figures, 000 for north.
    var text: String {
        let leg = legMin.map { "\(Self.figure($0))M" } ?? "\(Self.figure(legNm ?? 4))N"
        let length = turns.map { "\($0)T" } ?? "\(minutes ?? 10)M"
        return "\(fix):\(String(format: "%03d", inbound % 360)):\(right ? "R" : "L"):\(leg):\(length)"
    }

    /// "Right turns · 270° inbound · 1 min legs · 2 turns", north as 360°.
    var words: String {
        let course = inbound % 360 == 0 ? 360 : inbound % 360
        let leg = legMin.map { "\(Self.figure($0)) min legs" } ?? "\(Self.figure(legNm ?? 4)) nm legs"
        let length = turns.map { "\($0) \($0 == 1 ? "turn" : "turns")" } ?? "\(minutes ?? 10) min"
        return "\(right ? "Right" : "Left") turns · \(String(format: "%03d", course))° inbound · \(leg) · \(length)"
    }

    /// One read back from its text, or nil for one that is not.
    static func parse(_ text: String) -> Hold? {
        let parts = text.trimmingCharacters(in: .whitespaces).uppercased().split(separator: ":").map(String.init)
        guard parts.count == 5, let course = Int(parts[1]), parts[1].count <= 3, course <= 360,
              parts[2] == "R" || parts[2] == "L" else { return nil }
        var hold = Hold(fix: parts[0], inbound: course % 360, right: parts[2] == "R")
        guard let legUnit = parts[3].last, let leg = Double(parts[3].dropLast()), leg > 0,
              let lengthUnit = parts[4].last, let length = Int(parts[4].dropLast()), length > 0 else { return nil }
        switch legUnit {
        case "M": hold.legMin = leg
        case "N": hold.legNm = leg
        default: return nil
        }
        switch lengthUnit {
        case "T": hold.turns = length
        case "M": hold.minutes = length
        default: return nil
        }
        return hold
    }
}

/// The route before a Direct to, for its Cancel.
struct RouteWas: Codable, Equatable, Sendable {
    var dep: String
    var stops: [String]
    var dest: String
}

/// What the pilot set on the route beyond its points, as the web app keeps
/// it in its address (PlanWorkspace) and the planner reads it (PlanQuery):
/// points' own altitudes, holds, the altitudes to cross procedures' fixes
/// at, a fix of a procedure flown direct, and a Direct to with the route
/// as it was.
struct RouteExtras: Equatable, Sendable {
    /// Feet MSL by point: a waypoint's is flown to it, an airport's is
    /// what a flight landing there comes down to.
    var altitudes: [String: Int] = [:]
    var holds: [Hold] = []
    /// Feet MSL ATC gave to cross a procedure's fix at.
    var crossings: [String: Int] = [:]
    /// A procedure's fix flown direct to, by "FIELD:PROCEDURE".
    var procedureDirect: [String: String] = [:]
    /// The point flown direct to now, and the route before it.
    var direct: String?
    var was: RouteWas?

    /// "IDENT:FEET" pairs, as the planner reads `altitudes` and `crossings`.
    static func pairs(_ feet: [String: Int]) -> String? {
        feet.isEmpty ? nil : feet.sorted { $0.key < $1.key }.map { "\($0.key):\($0.value)" }.joined(separator: ",")
    }

    /// The nav log's query for them, only the ones set: the procedures
    /// written again only where one is flown direct, "KELD:I22::BXCMB"
    /// (PlanQuery.procedures: the fix after a fourth colon).
    func query(procedures: [ProcedurePick]) -> [String: String?] {
        var query: [String: String?] = [:]
        if let altitudes = Self.pairs(altitudes) { query["altitudes"] = altitudes }
        if let crossings = Self.pairs(crossings) { query["crossings"] = crossings }
        if !holds.isEmpty { query["holds"] = holds.map(\.text).joined(separator: ",") }
        if !procedureDirect.isEmpty, !procedures.isEmpty {
            query["procedures"] = procedures.map { pick in
                guard let fix = procedureDirect["\(pick.ident):\(pick.id)"] else { return pick.param }
                return "\(pick.ident):\(pick.id):\(pick.transition ?? ""):\(fix)"
            }.joined(separator: ",")
        }
        return query
    }

    /// Where the airplane is, as a route's point (the web app's
    /// positionIdent): "@42.3246,-88.0741", with its altitude to the
    /// hundred feet where it has one, "@42.3246,-88.0741,4500".
    static func position(_ fix: OwnShip.Fix) -> String {
        let at = String(format: "@%.4f,%.4f", fix.coordinate.latitude, fix.coordinate.longitude)
        guard let feet = fix.altitudeFt, feet >= 0 else { return at }
        return "\(at),\(Int((feet / 100).rounded()) * 100)"
    }

    /// A point off a fix, as a flight plan writes a fix/radial/distance
    /// (FAA Form 7233-4, item 10; AIM 5-1-8) and the planner reads it
    /// (vfr.fixes.frd_ident): "VPBNG/090/30".
    static func frd(_ base: String, courseDeg: Int, nm: Double) -> String {
        "\(base.uppercased())/\(String(format: "%03d", ((courseDeg % 360) + 360) % 360))/\(String(format: "%g", nm))"
    }

    /// Where a point goes into the route so it bends it least: after the
    /// point whose leg it adds the fewest miles to (the web app's
    /// bestStopIndex), as an index into the stops.
    static func bestStopIndex(_ points: [CLLocationCoordinate2D], at: CLLocationCoordinate2D) -> Int {
        var best = 0, added = Double.infinity
        for i in 0..<max(0, points.count - 1) {
            let more = Flight.nm(from: points[i], to: at) + Flight.nm(from: at, to: points[i + 1]) - Flight.nm(from: points[i], to: points[i + 1])
            if more < added { best = i; added = more }
        }
        return best
    }

    /// The route flown direct to a point of it, as ATC sends an airplane:
    /// from where the airplane is, else from the departure, on from the
    /// point as planned; nil for a point not on the route after the start.
    static func directed(_ was: RouteWas, to ident: String, from position: String?) -> RouteWas? {
        let at = was.stops.firstIndex { $0.uppercased() == ident.uppercased() }
        guard at != nil || was.dest.uppercased() == ident.uppercased() else { return nil }
        return RouteWas(dep: position ?? was.dep, stops: at.map { Array(was.stops[$0...]) } ?? [], dest: was.dest)
    }
}

extension Plan {
    private var current: RouteWas { RouteWas(dep: dep, stops: stops, dest: dest) }

    /// The route flown direct to one of its points from where the airplane
    /// is (the dry run's airplane while it flies); one at a time, a
    /// procedure's own direct given back. The route as it was kept for
    /// Cancel.
    func directTo(_ ident: String, from fix: OwnShip.Fix?) {
        let was = extras.was ?? current
        guard let route = RouteExtras.directed(was, to: ident, from: fix.map(RouteExtras.position)) else { return }
        dep = route.dep; stops = route.stops; dest = route.dest
        extras.was = was
        extras.direct = ident
        extras.procedureDirect = [:]
        plan()
    }

    /// The Direct to taken back: the route as it was.
    func cancelDirect() {
        guard let was = extras.was else { return }
        dep = was.dep; stops = was.stops; dest = was.dest
        extras.was = nil
        extras.direct = nil
        plan()
    }

    /// A diversion to a field from where the airplane is, planned by the
    /// planner as any route is (its heading, time and fuel), the route as
    /// it was kept for Cancel.
    func divert(to ident: String, from fix: OwnShip.Fix) {
        let was = extras.was ?? current
        dep = RouteExtras.position(fix); stops = []; dest = ident
        extras.was = was
        extras.direct = ident
        extras.procedureDirect = [:]
        plan()
    }

    /// A hold set at a point, changed, or (nil) taken off: one a point.
    func setHold(at fix: String, _ hold: Hold?) {
        extras.holds.removeAll { $0.fix.uppercased() == fix.uppercased() }
        if let hold { extras.holds.append(hold) }
        plan()
    }

    func hold(at fix: String) -> Hold? { extras.holds.first { $0.fix.uppercased() == fix.uppercased() } }

    /// A point's own altitude, or (nil) the plan's again.
    func setAltitude(at ident: String, feet: Int?) {
        extras.altitudes[ident.uppercased()] = feet
        plan()
    }

    /// The altitude to cross a procedure's fix at, or (nil) the chart's.
    func setCrossing(at fix: String, feet: Int?) {
        extras.crossings[fix.uppercased()] = feet
        plan()
    }

    /// A procedure's fix flown direct to, or (nil) the procedure as charted.
    func setProcedureDirect(_ pick: ProcedurePick, fix: String?) {
        if fix != nil {
            // One direct at a time: a Direct to a point of the route given back.
            if let was = extras.was { dep = was.dep; stops = was.stops; dest = was.dest }
            extras.was = nil
            extras.direct = nil
            extras.procedureDirect = [:]
        }
        extras.procedureDirect["\(pick.ident):\(pick.id)"] = fix
        plan()
    }

    /// The pilot's own point off one of the route's, flown over next: after
    /// a stop, first after the departure, last before the destination.
    func insertFix(_ ident: String, after point: String) {
        if let at = stops.firstIndex(where: { $0.uppercased() == point.uppercased() }) {
            stops.insert(ident, at: at + 1)
        } else if point.uppercased() == dep.uppercased() {
            stops.insert(ident, at: 0)
        } else {
            stops.append(ident)
        }
        plan()
    }

    /// What is done with a point dropped on the map.
    enum Drop { case add, direct, hold }

    /// A point dropped on the map into the route where it bends it least,
    /// and flown to direct, or held at (the web app's dropIntoRoute).
    func drop(_ ident: String, at point: CLLocationCoordinate2D, then: Drop, from fix: OwnShip.Fix?) {
        guard let course else { return }
        let ends = [course.departure] + (course.stops ?? []) + [course.destination]
        let index = min(stops.count, RouteExtras.bestStopIndex(ends.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) }, at: point))
        if then == .direct {
            let was = extras.was ?? current
            if let fix { dep = RouteExtras.position(fix) }
            stops = [ident] + stops[index...]
            extras.was = was
            extras.direct = ident
            extras.procedureDirect = [:]
        } else {
            stops.insert(ident, at: index)
        }
        plan()
    }
}
