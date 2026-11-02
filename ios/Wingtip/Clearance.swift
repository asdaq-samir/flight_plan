import Foundation

/// An ATC clearance as the phone heard it, read into its items by the
/// engine (wingtip_engine::clearance, Engine.hear) -- the web app's
/// lib/clearance, both held to the same fixture (clearances.json, the
/// engine's tests/clearance.rs and SharedFixturesTests): its limit, its
/// departure procedure, the route, the altitudes, the frequency and the
/// beacon code, as AIM 4-4-3 lists what a clearance holds. The places it
/// names are found by the planner (/api/clearance/places, vfr.spoken), or
/// with no signal by the engine in the kept packs, and the route goes in
/// only from the sheet, the pilot having read it (ClearanceSheet).
struct Clearance: Codable, Equatable, Sendable {
    /// The clearance limit as said ("duluth airport").
    var limit: String?
    var route: [ClearedItem] = []
    /// "...then as filed" (AIM 5-2-6): the filed route after what was
    /// said, which leaves out the filed altitude.
    var asFiled = false
    var maintainFt: Int?
    /// "at or below" or "at or above".
    var maintainLimit: String?
    var vfr = false
    var expectFt: Int?
    /// Minutes after departure the expected altitude comes.
    var expectMin: Int?
    var frequency: String?
    /// Whose frequency: "departure", "center", "approach".
    var facility: String?
    var squawk: String?
    /// "Cleared into the Class Bravo airspace" (14 CFR 91.131(a)(1)).
    var classB = false

    /// Whether anything of a clearance was heard at all.
    var heardAny: Bool {
        limit != nil || !route.isEmpty || asFiled || maintainFt != nil || expectFt != nil || frequency != nil || squawk != nil || classB
    }
}

/// A part of the route, in the order it was said: "vectors", "heading",
/// "airway", "departure", "arrival", or "places" (words naming one place
/// or more, for the planner to find).
struct ClearedItem: Codable, Equatable, Sendable {
    var kind: String
    var degrees: Int?
    var ident: String?
    var name: String?
    var number: String?
    var transition: String?
    var said: String?
}

extension Clearance {
    /// The clearance in what was heard, read by the engine
    /// (wingtip_engine::clearance, the web's lib/clearance), with no
    /// signal needed.
    static func read(_ text: String) -> Clearance {
        Engine.hear(text, tail: nil, packs: [], near: [], dep: "", stops: [], dest: "")?.clearance ?? Clearance()
    }
}

/// What the planner found of a clearance's places (ClearancePlaces).
struct ClearancePlaces: Codable, Equatable, Sendable {
    struct Place: Codable, Equatable, Sendable {
        var said: String
        var ident: String?
        var name: String?
        var kind: String?
        var sure: Bool?
    }
    struct Procedure: Codable, Equatable, Sendable {
        var id: String
        var transition: String?
    }
    var limit: Place?
    var route: [[Place]]?
    var departure: Procedure?
    var arrival: Procedure?
}

/// What the planner is asked to find (ClearanceAsk).
struct ClearanceAsk: Encodable, Sendable {
    struct Procedure: Encodable, Sendable { let name: String; let number: String; let transition: String? }
    var near = ""
    var dep: String?
    var dest: String?
    var limit: String?
    var route: [String] = []
    var departure: Procedure?
    var arrival: Procedure?
}

extension Clearance {
    /// The planner's question for the clearance's places.
    func asked(near: String, dep: String, dest: String) -> ClearanceAsk {
        func named(_ kind: String) -> ClearanceAsk.Procedure? {
            route.first { $0.kind == kind }.map { ClearanceAsk.Procedure(name: $0.name ?? "", number: $0.number ?? "", transition: $0.transition) }
        }
        return ClearanceAsk(near: near, dep: dep.isEmpty ? nil : dep, dest: dest.isEmpty ? nil : dest, limit: limit,
                            route: route.compactMap { $0.kind == "places" ? $0.said : nil },
                            departure: named("departure"), arrival: named("arrival"))
    }

    /// Two idents one field: "KDLH" and "DLH" (the web's sameField).
    static func sameField(_ a: String, _ b: String) -> Bool {
        func bare(_ ident: String) -> String {
            ident.trimmingCharacters(in: .whitespaces).uppercased().replacingOccurrences(of: "^K(?=[A-Z0-9]{3}$)", with: "", options: .regularExpression)
        }
        return bare(a) == bare(b)
    }

    /// A procedure to pick, as the web's typed one: its name and the
    /// points either side of it.
    struct Typed: Codable, Equatable, Sendable {
        let name: String
        let before: String?
        let after: String?
    }

    /// The route this clearance gives, from the one planned: its
    /// destination the limit where that is an airport; its stops the
    /// places and airways said in order, the SID's transition after the
    /// departure and the STAR's before the destination; with "then as
    /// filed" the filed stops after the last one said that is among them,
    /// or all of them where none is (AIM 5-2-6). The web's clearedRoute.
    func clearedRoute(_ found: ClearancePlaces, dep: String, stops planned: [String], dest plannedDest: String) -> (dep: String, stops: [String], dest: String, typed: [Typed]) {
        let dest = found.limit?.kind == "airport" ? (found.limit?.ident ?? plannedDest) : plannedDest
        var said: [String] = []
        var typed: [Typed] = []
        var run = 0
        for item in route {
            switch item.kind {
            case "places":
                said += (found.route.flatMap { run < $0.count ? $0[run] : nil } ?? []).compactMap(\.ident)
                run += 1
            case "airway":
                if let ident = item.ident { said.append(ident) }
            case "departure":
                if let departure = found.departure {
                    typed.append(Typed(name: departure.id, before: dep.isEmpty ? nil : dep, after: departure.transition))
                    if let transition = departure.transition { said.append(transition) }
                }
            case "arrival":
                if let arrival = found.arrival {
                    if let transition = arrival.transition { said.append(transition) }
                    typed.append(Typed(name: arrival.id, before: arrival.transition, after: dest.isEmpty ? nil : dest))
                }
            default:
                break
            }
        }
        var stops = said
        if asFiled {
            let last = said.reversed().first { s in !FilingForm.airwayToken(s) && planned.contains { Self.sameField($0, s) } }
            let from = last.flatMap { l in planned.firstIndex { Self.sameField($0, l) } }.map { $0 + 1 } ?? 0
            stops = said + planned[from...]
        }
        let ends = stops
        stops = ends.enumerated().filter { i, s in !(i == 0 && Self.sameField(s, dep)) && !(i == ends.count - 1 && Self.sameField(s, dest)) }.map(\.element)
        stops = stops.enumerated().filter { i, s in i == 0 || !Self.sameField(s, stops[i - 1]) }.map(\.element)
        return (dep, Array(stops.prefix(16)), dest, typed)
    }
}
